/**
 * The simulation façade: builds the world, our modules, the mocked platform and
 * the orchestrator; advances the tick clock; exposes the control API (the only
 * way to mutate state, ARC-4) and a read-only snapshot.
 */
import type { InputSpec } from './config.ts';
import { DEFAULT_CONSUMERS, DRIFT_BOUNDS, NOISE_BOUNDS, NUMERICS, TIMING, inputsFor } from './config.ts';
import type { Values } from './contracts.ts';
import { Consumer } from './consumers/consumer.ts';
import { consumerNeeds } from './topology/inputs.ts';
import { EventLog, clockLabel } from './events.ts';
import { Faults, type FaultTarget } from './faults.ts';
import { Announcer } from './modules/announcer.ts';
import { DriftMonitor } from './modules/driftMonitor.ts';
import { FeatureDetector } from './modules/featureDetector.ts';
import { Ingestion } from './modules/ingestion.ts';
import { ModelRunner } from './modules/modelRunner.ts';
import { Orchestrator } from './orchestrator/orchestrator.ts';
import { Broker } from './platform/broker.ts';
import { SensorBroker } from './platform/sensorBroker.ts';
import { PygeoApi } from './platform/pygeoapi.ts';
import * as P from './payloads.ts';
import { Streams } from './rng.ts';
import { FeaturesDb, NetcdfStore, ObservationsDb } from './stores/stores.ts';
import { TokenRecorder } from './tokens.ts';
import { edgeId } from './topology/elements.ts';
import { Ocean } from './world/ocean.ts';
import { Sensors } from './world/sensors.ts';

export interface SimOptions {
  readonly seed: string;
  /** 3–6 (SIM-3). Default 4. */
  readonly inputs?: number;
  /** Consumers present at T+00:00. Default 2. */
  readonly consumers?: number;
}

/** Every presenter/operator/scenario action, as data (used by replay scripts and tours). */
export type ControlAction =
  | { readonly type: 'shift'; readonly input: string; readonly on: boolean }
  | { readonly type: 'noise'; readonly input: string; readonly sigma: number }
  | { readonly type: 'threshold'; readonly value: number }
  | { readonly type: 'quorum'; readonly value: number }
  | { readonly type: 'persistence'; readonly value: number }
  | { readonly type: 'requestRun' }
  | { readonly type: 'offline'; readonly module: FaultTarget; readonly offline: boolean }
  | { readonly type: 'failNextRun' }
  | { readonly type: 'addConsumer' }
  | { readonly type: 'reconfigureConsumer'; readonly consumer: string }
  | { readonly type: 'ingestion'; readonly running: boolean }
  | { readonly type: 'observationsDb'; readonly up: boolean };

export class Simulation {
  readonly seed: string;
  readonly inputs: readonly InputSpec[];
  readonly log = new EventLog();
  readonly tokens: TokenRecorder;
  readonly streams: Streams;
  readonly ocean: Ocean;
  readonly sensors: Sensors;
  readonly observationsDb = new ObservationsDb();
  readonly netcdf: NetcdfStore;
  readonly featuresDb = new FeaturesDb();
  readonly pygeoapi: PygeoApi;
  readonly broker: Broker;
  readonly sensorBroker: SensorBroker;
  /** Presenter can stop and start ingestion (FLT-3). */
  ingestionRunning = true;
  private backlogPeak = 0;
  readonly ingestion: Ingestion;
  readonly orchestrator: Orchestrator;
  readonly faults: Faults;
  readonly consumers: Consumer[] = [];
  private t = 0;
  private readonly units: Record<string, string>;

  constructor(opts: SimOptions) {
    this.seed = opts.seed;
    this.inputs = inputsFor(opts.inputs ?? 4);
    this.units = Object.fromEntries(this.inputs.map((s) => [s.key, s.unit]));
    this.streams = new Streams(opts.seed);
    const now = () => this.t;
    this.tokens = new TokenRecorder(this.log, now);
    this.ocean = new Ocean(this.inputs, this.streams.get('ocean'));
    this.sensors = new Sensors(this.inputs, this.ocean, this.streams);
    const clim: Values = Object.fromEntries(this.inputs.map((s) => [s.key, s.base]));
    this.netcdf = new NetcdfStore(clim);
    this.pygeoapi = new PygeoApi(this.observationsDb, this.netcdf, this.featuresDb, this.tokens);
    this.broker = new Broker(this.tokens);
    this.sensorBroker = new SensorBroker(this.tokens, this.units);
    this.faults = new Faults(this.streams.get('failures'));

    // Our modules, wired to the read path (pygeoapi) and to our stores. They never see the orchestrator.
    const api = this.pygeoapi;
    this.ingestion = new Ingestion(this.inputs, this.observationsDb);
    const monitor = new DriftMonitor(this.inputs, {
      latestObservations: () => api.latestObservations({ element: 'driftMonitor' }),
      currentForecast: () => api.forecast({ element: 'driftMonitor' }),
    });
    const tokens = this.tokens;
    const runner = new ModelRunner(
      this.inputs,
      {
        recentObservations: (n) => api.recentObservations({ element: 'modelRunner' }, n),
        climatology: () => api.climatology({ element: 'modelRunner' }),
        latestForecast: () => api.forecast({ element: 'modelRunner' }),
      },
      {
        commit: (f) => {
          tokens.emit(edgeId('modelRunner', 'write', 'netcdfStore'), { payload: P.forecastCommit(f) });
          this.netcdf.commit(f);
        },
      },
    );
    const detector = new FeatureDetector(
      this.inputs,
      {
        forecast: (id) => api.forecast({ element: 'featureDetector' }, id),
        climatology: () => api.climatology({ element: 'featureDetector' }),
      },
      {
        writeAll: (id, feats) => {
          tokens.emit(edgeId('featureDetector', 'write', 'featuresDb'), { payload: P.featuresInsert(id, feats) });
          this.featuresDb.writeAll(id, feats);
        },
      },
    );

    this.orchestrator = new Orchestrator({
      log: this.log,
      tokens: this.tokens,
      now,
      monitor: this.faults.monitor(monitor),
      runner: this.faults.runner(runner),
      detector: this.faults.detector(detector),
      announcer: new Announcer({ publish: (msg) => this.broker.publish('announcer', msg) }),
      params: { threshold: DRIFT_BOUNDS.threshold.default, quorum: Math.min(DRIFT_BOUNDS.quorum.default, this.inputs.length), persistence: DRIFT_BOUNDS.persistence.default },
    });

    this.log.append(0, 'control', `start: seed "${opts.seed}", ${this.inputs.length} inputs`);
    this.orchestrator.materialise('climatology', 0);
    for (let i = 0; i < (opts.consumers ?? DEFAULT_CONSUMERS); i++) this.newConsumer();
  }

  get tick(): number {
    return this.t;
  }
  get clock(): string {
    return clockLabel(this.t);
  }
  get digest(): string {
    return this.log.digest;
  }

  /** Advance exactly `n` ticks (SIM-1). */
  step(n = 1): void {
    for (let i = 0; i < n; i++) this.stepOnce();
  }

  private stepOnce(): void {
    this.t++;
    const t = this.t;
    this.ocean.step();
    this.sensorBroker.publish(t, this.sensors.sample());
    this.ingest(t);
    this.orchestrator.tick(t);
    for (const c of this.consumers) c.tick(t);
    this.tokens.prune();
  }

  /**
   * Ingestion drains the sensor broker in order, faster than it fills, and acknowledges only after the
   * database commit. While ingestion or the database is stopped, messages stay queued.
   */
  private ingest(t: number): void {
    if (!this.ingestionRunning || !this.observationsDb.up) return;
    const batch = this.sensorBroker.deliver(NUMERICS.ingestCatchUp * this.inputs.length, t);
    if (!batch.length) return;
    const res = this.ingestion.ingestMessages(batch);
    if (res.accepted.length) this.tokens.emit(edgeId('ingestion', 'write', 'observationsDb'), { payload: P.observationInsert(res.accepted, res.rejected.length) });
    this.sensorBroker.ack(batch.length);
    for (const r of res.rejected) {
      const v = Number.isFinite(r.value) ? r.value.toFixed(3) : String(r.value);
      const late = r.tick < t ? ` (measured ${clockLabel(r.tick)})` : '';
      this.log.append(t, 'ingest', `rejected ${r.input} = ${v}: ${r.reason}${late}`);
    }
    const queued = this.sensorBroker.queued;
    if (queued > 0) this.backlogPeak = Math.max(this.backlogPeak, queued + batch.length);
    else if (this.backlogPeak > 0) {
      this.log.append(t, 'ingest', `sensor broker backlog drained (peak ${this.backlogPeak} messages, none lost)`);
      this.backlogPeak = 0;
    }
  }

  /** Readable state of ingestion for the UI. */
  get ingestionStatus(): 'running' | 'stopped' | 'waiting for Observations DB' {
    return !this.ingestionRunning ? 'stopped' : !this.observationsDb.up ? 'waiting for Observations DB' : 'running';
  }

  // ---- Control API (scenario, operator, presenter) ----

  apply(a: ControlAction): void {
    switch (a.type) {
      case 'shift':
        return this.setShift(a.input, a.on);
      case 'noise':
        return this.setNoise(a.input, a.sigma);
      case 'threshold':
        return this.setThreshold(a.value);
      case 'quorum':
        return this.setQuorum(a.value);
      case 'persistence':
        return this.setPersistence(a.value);
      case 'requestRun':
        return this.requestRun();
      case 'offline':
        return this.setOffline(a.module, a.offline);
      case 'failNextRun':
        return this.failNextRun();
      case 'addConsumer':
        return void this.addConsumer();
      case 'reconfigureConsumer':
        return this.reconfigureConsumer(a.consumer);
      case 'ingestion':
        return this.setIngestionRunning(a.running);
      case 'observationsDb':
        return this.setObservationsDbUp(a.up);
    }
  }

  private spec(key: string): InputSpec {
    const s = this.inputs.find((x) => x.key === key);
    if (!s) throw new RangeError(`unknown input ${key}`);
    return s;
  }

  private control(text: string): void {
    this.log.append(this.t, 'control', text);
  }

  /** Scenario: +5σ over 20 s (toggle). */
  setShift(input: string, on: boolean): void {
    this.spec(input);
    this.ocean.setShift(input, on);
    this.control(`scenario: shift ${input} ${on ? 'on' : 'off'}`);
  }

  /** Scenario: sensor noise 0–3σ. */
  setNoise(input: string, sigma: number): void {
    this.spec(input);
    if (!(sigma >= NOISE_BOUNDS.min && sigma <= NOISE_BOUNDS.max)) throw new RangeError(`noise must be ${NOISE_BOUNDS.min}–${NOISE_BOUNDS.max}σ`);
    this.sensors.noise.set(input, sigma);
    this.control(`scenario: noise ${input} ${sigma}σ`);
  }

  /** Operator: DRF-3. */
  setThreshold(v: number): void {
    const b = DRIFT_BOUNDS.threshold;
    if (!(v >= b.min && v <= b.max) || Math.round(v / b.step) * b.step !== v) throw new RangeError(`threshold must be ${b.min}–${b.max}σ in steps of ${b.step}`);
    this.orchestrator.params = { ...this.orchestrator.params, threshold: v };
    this.control(`operator: threshold ${v}σ`);
  }

  setQuorum(v: number): void {
    if (!Number.isInteger(v) || v < DRIFT_BOUNDS.quorum.min || v > this.inputs.length) throw new RangeError(`quorum must be 1–${this.inputs.length}`);
    this.orchestrator.params = { ...this.orchestrator.params, quorum: v };
    this.control(`operator: quorum ${v}`);
  }

  setPersistence(v: number): void {
    const b = DRIFT_BOUNDS.persistence;
    if (!Number.isInteger(v) || v < b.min || v > b.max) throw new RangeError(`persistence must be ${b.min}–${b.max}`);
    this.orchestrator.params = { ...this.orchestrator.params, persistence: v };
    this.control(`operator: persistence ${v}`);
  }

  /** Operator: request a run. */
  requestRun(): void {
    this.control('operator: request a run');
    this.orchestrator.request('manual', 'manualRequest');
  }

  /** Presenter: FLT-1. */
  setOffline(module: FaultTarget, offline: boolean): void {
    this.faults.offline[module] = offline;
    this.control(`presenter: ${module} ${offline ? 'offline' : 'online'}`);
  }

  /** Presenter: FLT-3, stop or start ingestion. Messages queue in the sensor broker while it is stopped. */
  setIngestionRunning(running: boolean): void {
    this.ingestionRunning = running;
    this.control(`presenter: ingestion ${running ? 'started' : 'stopped'}`);
  }

  /** Presenter: FLT-3, stop or start the Observations DB. Ingestion holds off; observation reads fail. */
  setObservationsDbUp(up: boolean): void {
    this.observationsDb.up = up;
    this.control(`presenter: Observations DB ${up ? 'started' : 'stopped'}`);
  }

  /** Presenter: FLT-2. */
  failNextRun(): void {
    this.faults.failNextRun = true;
    this.control('presenter: fail next run');
  }

  /** Presenter: CON-2. */
  addConsumer(): Consumer {
    this.control(`presenter: add consumer C${this.consumers.length + 1}`);
    const c = this.newConsumer();
    c.query(this.t, 'catch-up');
    return c;
  }

  /**
   * Consumer: CON-3. The consumer app's user changes what it shows, so it queries pygeoapi again
   * for the latest forecast. No new data is implied.
   */
  reconfigureConsumer(id: string): void {
    const c = this.consumers.find((x) => x.id === id);
    if (!c) throw new RangeError(`unknown consumer ${id}`);
    this.log.append(this.t, 'control', `consumer: ${id} reconfigured by its user`);
    c.query(this.t, 'reconfigure');
  }

  private newConsumer(): Consumer {
    const c = new Consumer(`C${this.consumers.length + 1}`, this.t, this.pygeoapi, this.broker, this.streams.get('consumers'), this.log, () => this.t, consumerNeeds(this.consumers.length));
    this.consumers.push(c);
    return c;
  }

  // ---- Read-only view for the UI (ARC-4) ----

  snapshot() {
    const o = this.orchestrator;
    const a = o.active;
    const run = a
      ? {
          id: a.id,
          forecastId: a.forecastId,
          causes: a.causes.join(' + '),
          step: a.step,
          attempt: a.attempt,
          label: a.label,
          progress: a.attemptStart !== undefined && a.step !== 'announce' ? (this.t - a.attemptStart) / (a.step === 'run' ? TIMING.modelRunDuration : TIMING.detectDuration) : 0,
          retryIn: a.retryAt !== undefined ? a.retryAt - this.t : undefined,
          lastFailure: a.lastFailure,
        }
      : undefined;
    return {
      tick: this.t,
      clock: this.clock,
      seed: this.seed,
      inputs: this.inputs.map((s) => ({
        ...s,
        truth: this.ocean.truth(s.key),
        shiftOn: this.ocean.shiftOn(s.key),
        shiftSigma: this.ocean.shiftSigma(s.key),
        noise: this.sensors.noise.get(s.key) ?? 0,
        reading: this.sensors.last[s.key],
        residual: o.cursor.residuals[s.key],
      })),
      ingestion: { accepted: this.ingestion.acceptedCount, rejected: this.ingestion.rejectedCount, running: this.ingestionRunning, status: this.ingestionStatus },
      sensorBroker: { queued: this.sensorBroker.queued, oldestAge: this.sensorBroker.oldest === undefined ? 0 : this.t - this.sensorBroker.oldest, published: this.sensorBroker.published, delivered: this.sensorBroker.delivered },
      stores: {
        observations: this.observationsDb.count,
        observationsUp: this.observationsDb.up,
        coverageFiles: this.netcdf.fileCount,
        features: this.featuresDb.count,
      },
      forecast: this.netcdf.latest,
      background: this.netcdf.background,
      drift: { ...o.params, status: o.cursor.status, streak: o.cursor.streak, nextCheckIn: o.nextCheckTick - this.t, interval: TIMING.driftSensorInterval },
      schedule: { staleAfter: TIMING.staleAfter, staleIn: o.staleIn },
      run,
      queued: o.pending ? o.pending.causes.join(' + ') : undefined,
      assets: { ...o.materialisedAt },
      privateStore: { runs: o.history.length, sensorStreak: o.cursor.streak },
      offline: { ...this.faults.offline },
      failNextRun: this.faults.failNextRun,
      consumers: this.consumers.map((c) => ({ id: c.id, needs: c.needs, subscribedAt: c.subscribedAt, latest: c.latest, waiting: c.waiting })),
      tokens: this.tokens.tokens,
      edgeStats: Object.fromEntries(this.tokens.edgeStats),
      defects: [...this.tokens.defects],
      events: { count: this.log.count, digest: this.log.digest },
    };
  }
}

export type Snapshot = ReturnType<Simulation['snapshot']>;
