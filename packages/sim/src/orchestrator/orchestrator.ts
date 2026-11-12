/**
 * Orchestrator (off-the-shelf, mocked; Dagster-style): asset graph, triggers,
 * run queue with merge, and retry with backoff. ORC-1..6, DRF-5.
 */
import { TIMING } from '../config.ts';
import type { Feature, Forecast, Job } from '../contracts.ts';
import type { EventLog } from '../events.ts';
import { clockLabel } from '../events.ts';
import { ModuleFailure } from '../faults.ts';
import type { Announcer } from '../modules/announcer.ts';
import type { DriftCheckResult, DriftMonitor, DriftParams } from '../modules/driftMonitor.ts';
import type { FeatureDetector } from '../modules/featureDetector.ts';
import type { ModelRunner } from '../modules/modelRunner.ts';
import type { TokenRecorder } from '../tokens.ts';
import { edgeId, type ElementId } from '../topology/elements.ts';
import * as shims from './shims.ts';

export type AssetId = 'climatology' | 'forecast' | 'features' | 'announcement';
export type StepName = 'run' | 'detect' | 'announce';
export type Cause = 'drift' | 'schedule' | 'manual';

export interface ActiveRun {
  readonly id: string;
  readonly forecastId: string;
  readonly causes: readonly Cause[];
  readonly startedAt: number;
  step: StepName;
  /** Attempts of the current step. */
  attempt: number;
  /** Failures of the current step. */
  failures: number;
  attemptStart?: number;
  retryAt?: number;
  /** Execution-bar label, e.g. "replacing stale F2". */
  label: string;
  lastFailure?: string;
  forecast?: Forecast;
  featureCount?: number;
  totalFailures: number;
  job?: Job<unknown>;
}

/** Private store rows (UI-9). */
export interface RunRecord {
  readonly id: string;
  readonly forecastId: string;
  readonly causes: string;
  readonly startedAt: number;
  readonly endedAt: number;
  readonly failures: number;
  readonly featureCount: number;
}

export interface SensorCursor {
  streak: number;
  status: string;
  lastCheck?: number;
  residuals: DriftCheckResult['residuals'];
  exceeding: readonly string[];
}

export interface OrchestratorDeps {
  readonly log: EventLog;
  readonly tokens: TokenRecorder;
  readonly now: () => number;
  readonly monitor: Pick<DriftMonitor, 'check'>;
  readonly runner: Pick<ModelRunner, 'start'>;
  readonly detector: Pick<FeatureDetector, 'start'>;
  readonly announcer: Pick<Announcer, 'announce'>;
  readonly params: DriftParams;
}

const STEP_MODULE: Record<'run' | 'detect', { shim: ElementId; module: ElementId; name: string }> = {
  run: { shim: 'shimRun', module: 'modelRunner', name: 'Model runner' },
  detect: { shim: 'shimDetect', module: 'featureDetector', name: 'Feature detector' },
};

export class Orchestrator {
  readonly materialisedAt: Record<AssetId, number | undefined> = { climatology: undefined, forecast: undefined, features: undefined, announcement: undefined };
  /** Private store: run history, schedule, sensor state. */
  readonly history: RunRecord[] = [];
  readonly cursor: SensorCursor = { streak: 0, status: 'no forecast yet', residuals: {}, exceeding: [] };
  params: DriftParams;
  pending: { causes: Cause[]; since: number } | null = null;
  active: ActiveRun | null = null;
  current: { id: string; validUntil: number; digest: string; cause: string } | undefined;
  private runSeq = 0;

  constructor(private readonly d: OrchestratorDeps) {
    this.params = d.params;
  }

  /** DRF-5: is a run that includes drift among its causes already queued or running? */
  get driftRunState(): 'queued' | 'running' | undefined {
    if (this.pending?.causes.includes('drift')) return 'queued';
    if (this.active?.causes.includes('drift')) return 'running';
    return undefined;
  }

  get runPending(): boolean {
    return this.active !== null || this.pending !== null;
  }

  get nextCheckTick(): number {
    const t = this.d.now();
    return t - (t % TIMING.driftSensorInterval) + TIMING.driftSensorInterval;
  }

  /** Ticks until the current forecast is stale (0 when stale or absent). */
  get staleIn(): number {
    return this.current ? Math.max(0, this.current.validUntil - this.d.now()) : 0;
  }

  materialise(asset: AssetId, tick: number): void {
    this.materialisedAt[asset] = tick;
    this.d.log.append(tick, 'materialise', `${asset} materialised`);
  }

  /** Manual request from the operator (and the entry point for all triggers). */
  request(cause: Cause, from: ElementId, note = ''): void {
    const t = this.d.now();
    this.d.tokens.emit(edgeId(from, 'trigger', 'forecast'));
    const why = note ? ` (${note})` : '';
    if (this.pending) {
      this.pending.causes.push(cause);
      this.d.log.append(t, 'request', `${cause} request${why} merged into queued run: ${this.pending.causes.join(' + ')}`);
    } else if (this.active) {
      this.pending = { causes: [cause], since: t };
      this.d.log.append(t, 'request', `${cause} request${why} queued behind ${this.active.id}`);
    } else {
      this.pending = { causes: [cause], since: t };
      this.d.log.append(t, 'request', `${cause} request${why}`);
    }
  }

  /** Order within a tick: progress the active run (so a commit lands first), evaluate triggers, then start a queued run. */
  tick(t: number): void {
    this.advance(t);
    if (t % TIMING.driftSensorInterval === 0) this.driftCheck(t);
    this.staleness(t);
    if (!this.active && this.pending) this.startRun(t);
  }

  private driftCheck(t: number): void {
    this.d.tokens.emit(edgeId('shimCheck', 'call', 'driftMonitor'));
    const res = shims.check(this.d.monitor, { params: this.params, streak: this.cursor.streak, driftRun: this.driftRunState });
    const changed = res.status !== this.cursor.status;
    Object.assign(this.cursor, { streak: res.streak, status: res.status, lastCheck: t, residuals: res.residuals, exceeding: res.exceeding });
    if (res.requestRun) {
      const list = res.exceeding.join(', ');
      this.d.log.append(t, 'drift', `drift declared: ${list} beyond ±${this.params.threshold}σ for ${this.params.persistence} check(s)`);
      this.request('drift', 'driftSensor');
    } else if (changed) {
      this.d.log.append(t, 'drift', `drift monitor: ${res.status}`);
    }
  }

  /** The schedule does not request while any run is queued or running: that run will refresh the forecast. */
  private staleness(t: number): void {
    if (this.runPending) return;
    if (!this.current) {
      this.request('schedule', 'stalenessSchedule', 'no forecast yet');
    } else if (t >= this.current.validUntil) {
      this.request('schedule', 'stalenessSchedule', `${this.current.id} stale`);
    }
  }

  private startRun(t: number): void {
    const p = this.pending!;
    this.pending = null;
    const n = ++this.runSeq;
    this.active = { id: `R${n}`, forecastId: `F${n}`, causes: p.causes, startedAt: t, step: 'run', attempt: 0, failures: 0, label: '', totalFailures: 0 };
    this.d.log.append(t, 'run', `${this.active.id} started (${p.causes.join(' + ')}) → ${this.active.forecastId}`);
    this.beginAttempt(t);
  }

  private beginAttempt(t: number): void {
    const a = this.active!;
    a.attempt++;
    a.retryAt = undefined;
    a.job = undefined;
    const first = a.attempt === 1;
    const retry = first ? {} : { retry: true };
    try {
      if (a.step === 'run') {
        if (first) {
          this.d.tokens.emit(edgeId('observationsDb', 'lineage', 'forecast'));
          this.d.tokens.emit(edgeId('climatology', 'lineage', 'forecast'));
        }
        this.d.tokens.emit(edgeId('shimRun', 'call', 'modelRunner'), retry);
        if (!first) this.d.log.append(t, 'retry', `${a.id}: retry ${a.attempt - 1} of model run`);
        a.job = shims.run(this.d.runner, { id: a.forecastId, cause: a.causes.join(' + '), tick: t });
      } else if (a.step === 'detect') {
        if (first) this.d.tokens.emit(edgeId('forecast', 'lineage', 'features'));
        this.d.tokens.emit(edgeId('shimDetect', 'call', 'featureDetector'), retry);
        if (!first) this.d.log.append(t, 'retry', `${a.id}: retry ${a.attempt - 1} of detection`);
        a.job = shims.detect(this.d.detector, a.forecastId);
      } else {
        this.announce(t);
        return;
      }
      a.attemptStart = t;
      a.label = a.job.label;
    } catch (e) {
      this.fail(t, e);
    }
  }

  private advance(t: number): void {
    const a = this.active;
    if (!a) return;
    if (a.retryAt !== undefined) {
      if (t >= a.retryAt) this.beginAttempt(t);
      return;
    }
    const job = a.job;
    if (!job || a.attemptStart === undefined) return;
    try {
      job.progress();
      if (t - a.attemptStart >= job.duration) {
        const result = job.complete();
        a.job = undefined;
        this.stepComplete(t, result);
      }
    } catch (e) {
      this.fail(t, e);
    }
  }

  private stepComplete(t: number, result: unknown): void {
    const a = this.active!;
    if (a.step === 'run') {
      const f = result as Forecast;
      a.forecast = f;
      this.current = { id: f.id, validUntil: f.validUntil, digest: f.digest, cause: f.cause };
      this.d.log.append(t, 'commit', `${f.id} committed (${f.cause}), valid until ${clockLabel(f.validUntil)}, digest ${f.digest}`);
      // UI-10: the committed forecast becomes the next background.
      this.d.tokens.emit(edgeId('forecast', 'lineage', 'forecast'));
      this.materialise('forecast', t);
      this.nextStep('detect', t);
    } else if (a.step === 'detect') {
      const feats = result as readonly Feature[];
      a.featureCount = feats.length;
      const fronts = feats.filter((x) => x.kind === 'front').length;
      this.d.log.append(t, 'detect', `${a.forecastId}: ${fronts} front(s), ${feats.length - fronts} eddy(ies)`);
      this.materialise('features', t);
      this.nextStep('announce', t);
    }
  }

  private nextStep(step: StepName, t: number): void {
    const a = this.active!;
    a.step = step;
    a.attempt = 0;
    a.failures = 0;
    a.label = '';
    a.lastFailure = undefined;
    this.beginAttempt(t);
  }

  private announce(t: number): void {
    const a = this.active!;
    const f = a.forecast!;
    this.d.tokens.emit(edgeId('features', 'lineage', 'announcement'));
    this.d.tokens.emit(edgeId('forecast', 'lineage', 'announcement'));
    this.d.tokens.emit(edgeId('shimAnnounce', 'call', 'announcer'));
    const msg = shims.announce(this.d.announcer, { forecast: f, featureCount: a.featureCount ?? 0 });
    this.d.log.append(t, 'announce', `announce ${msg.forecastId} (${msg.cause}), ${msg.featureCount} features, digest ${msg.digest}`);
    this.materialise('announcement', t);
    this.history.push({ id: a.id, forecastId: f.id, causes: a.causes.join(' + '), startedAt: a.startedAt, endedAt: t, failures: a.totalFailures, featureCount: msg.featureCount });
    this.d.log.append(t, 'run', `${a.id} complete in ${t - a.startedAt}s`);
    this.active = null;
  }

  private fail(t: number, e: unknown): void {
    if (!(e instanceof ModuleFailure)) throw e;
    const a = this.active!;
    a.failures++;
    a.totalFailures++;
    a.job = undefined;
    a.attemptStart = undefined;
    const b = TIMING.retryBackoff;
    const delay = b[Math.min(a.failures - 1, b.length - 1)]!;
    a.retryAt = t + delay;
    a.lastFailure = e.reason;
    const name = STEP_MODULE[a.step as 'run' | 'detect'].name;
    this.d.log.append(t, 'fail', `${a.id}: ${name} failed (${e.reason}); retry in ${delay}s`);
  }
}
