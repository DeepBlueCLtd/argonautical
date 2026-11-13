import { DRIFT_BOUNDS, EDGES, INPUTS, NOISE_BOUNDS, PROFILES, STANDARDS, clockLabel, type InputDecl, type Snapshot, type Token } from '@argonautical/sim';
import { useMemo, useRef, type ReactNode } from 'react';
import type { Rate, Runner } from '../runner.ts';
import { CONSUMER_AREA, CONTROL, RECTS, REGIONS, TOKEN_KEY, VIEW, consumerRect, forecastLoop, lengthOf, midpoint, pathD, pointAt, routeAll, type Pt, type Rect, type Route } from './layout.ts';


const MATERIALISING_TICKS = 3;
/** CAT-5: badge colour per consumer status. */
const STATUS_TONE: Record<string, 'good' | 'pending' | 'basic' | 'neutral'> = { 'HI RES': 'good', '48 h': 'good', OK: 'good', 'HI RES pending': 'pending', '48 h pending': 'pending', 'LOW RES': 'basic', '12 h': 'basic' };
/** Gap, in diagram pixels, between reads a caller sends together (a token is ~12 px long). */
const ABREAST_GAP = 18;

const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.max(0, Math.floor(s % 60))).padStart(2, '0')}`;
const fmt = (v: number | undefined, d = 2) => (v === undefined ? '—' : Number.isFinite(v) ? v.toFixed(d) : String(v));

// ---- primitives ----

type Style = 'ours' | 'ots' | 'world' | 'asset';

function Box({ r, style, cls = '', children, title }: { r: Rect; style: Style; cls?: string; children?: ReactNode; title?: string }) {
  return (
    <g className={`box ${style} ${cls}`}>
      {title && <title>{title}</title>}
      <rect x={r.x} y={r.y} width={r.w} height={r.h} rx={style === 'asset' ? 10 : 4} />
      {children}
    </g>
  );
}

/** Our data store: double border (§5.3). */
function Store({ r, ours = true, cls = '', children }: { r: Rect; ours?: boolean; cls?: string; children?: ReactNode }) {
  return (
    <g className={`store ${ours ? 'ours' : 'ots'} ${cls}`}>
      <rect x={r.x} y={r.y} width={r.w} height={r.h} rx={6} />
      {ours && <rect className="inner" x={r.x + 4} y={r.y + 4} width={r.w - 8} height={r.h - 8} rx={4} />}
      {children}
    </g>
  );
}

function T({ x, y, children, cls = '', anchor = 'start' }: { x: number; y: number; children: ReactNode; cls?: string; anchor?: 'start' | 'middle' | 'end' }) {
  return (
    <text x={x} y={y} className={cls} textAnchor={anchor}>
      {children}
    </text>
  );
}

function Bar({ x, y, w, frac, cls = '' }: { x: number; y: number; w: number; frac: number; cls?: string }) {
  return (
    <g className={`bar ${cls}`}>
      <rect className="track" x={x} y={y} width={w} height={6} rx={3} />
      <rect className="fill" x={x} y={y} width={Math.max(0, Math.min(1, frac)) * w} height={6} rx={3} />
    </g>
  );
}

function Shim({ r, name, retryIn }: { r: Rect; name: string; retryIn?: number }) {
  const retry = retryIn !== undefined;
  return (
    <g className={`shim ${retry ? 'retry' : ''}`}>
      <rect x={r.x} y={r.y} width={r.w} height={r.h} rx={3} />
      <T x={r.x + 6} y={r.y + 14} cls="shim-label">
        shim · {name}
      </T>
      {retry && (
        <T x={r.x + r.w - 6} y={r.y + 14} cls="shim-retry" anchor="end">
          retry in {retryIn}s
        </T>
      )}
    </g>
  );
}

// ---- diagram ----

export interface Picked {
  readonly token: Token;
  readonly x: number;
  readonly y: number;
  /** Picked from an input slot: open while running too (the document stays put). */
  readonly fromSlot?: boolean;
}

/** Hovering a moving token: what it carries (MOT-6). */
export interface TokenTip {
  readonly token: Token;
  readonly box: { left: number; top: number; right: number; bottom: number };
}

/** Hovering (or focusing) an input slot: what the document is and what its reader uses it for. */
export interface SlotTip {
  readonly decl: InputDecl;
  readonly who: string;
  readonly reader: string;
  readonly instance?: string;
  /** Screen box of the slot icon. */
  readonly box: { left: number; top: number; right: number; bottom: number };
}

/** What the Control panel needs from the app (§5.4). */
export interface Controls {
  readonly logOpen: boolean;
  readonly onLog: () => void;
  readonly onWalkthrough: () => void;
}

export function Diagram(props: { snap: Snapshot; runner: Runner; onPick: (p: Picked) => void; onTip: (t: SlotTip | null) => void; onTokenTip: (t: TokenTip | null) => void; spotlight?: Rect | null; controls: Controls }) {
  const { snap, runner, onPick, onTip, onTokenTip, spotlight, controls } = props;
  const consumerIds = snap.consumers.map((c) => c.id);
  const routes = useMemo(() => routeAll(EDGES, consumerIds), [consumerIds.join(',')]);
  const byKey = useMemo(() => new Map(routes.map((r) => [r.key, r])), [routes]);
  const loop = useMemo(() => forecastLoop(), []);

  const t = snap.tick;
  const materialising = (a: keyof Snapshot['assets']) => {
    const m = snap.assets[a];
    return m !== undefined && t - m < MATERIALISING_TICKS ? 'materialising' : '';
  };
  const run = snap.run;
  const retryOn = (step: 'run' | 'detect') => (run && run.step === step && run.retryIn !== undefined ? run.retryIn : undefined);
  // While the step's reads are in flight it waits for its inputs; the countdown starts once they have arrived.
  const reading = (step: 'run' | 'detect') => !!run && run.step === step && run.retryIn === undefined && run.reading;
  const executing = (step: 'run' | 'detect') => (run && run.step === step && run.retryIn === undefined && !run.reading ? run : undefined);
  // A step first retrieves its inputs. It says "retrieving data" until the simulation's read phase is over
  // AND the replies have visibly arrived (at faster rates the animation can lag the clock), and only then
  // shows its own label ("replacing F1"), with the bar counting from that moment.
  const READER = { run: 'modelRunner', detect: 'featureDetector' } as const;
  const retrieving = (step: 'run' | 'detect') => reading(step) || (!!executing(step) && runner.readsPending(READER[step]));
  const execLabel = (step: 'run' | 'detect') => (retrieving(step) ? 'retrieving data' : (executing(step)?.label ?? (retryOn(step) !== undefined ? 'waiting for retry' : '')));
  const dataIn = useRef(new Map<string, number>());
  const shownProgress = (step: 'run' | 'detect', dur: number) => {
    const r = executing(step);
    if (!r || retrieving(step)) return 0;
    const key = `${r.id}#${step}#${r.attempt}`;
    const p = smoothProgress(step, dur);
    if (!dataIn.current.has(key)) dataIn.current.set(key, p);
    const p0 = Math.min(dataIn.current.get(key)!, 0.95);
    return Math.max(0, (p - p0) / (1 - p0));
  };
  const smoothProgress = (step: 'run' | 'detect', dur: number) => {
    const r = executing(step);
    return r ? Math.min(1, r.progress + runner.frac / dur) : 0;
  };

  const R = RECTS;
  const f = snap.forecast;
  /** CAT-1: a feature detector is present (the toggle takes effect from the next run). */
  const detector = snap.capabilities.featureDetector;
  // Staleness countdown (ORC-1, MOT-3): smooth between ticks; "replacing" once a run is under way.
  const staleRemaining = f ? Math.max(0, snap.schedule.staleIn - (snap.schedule.staleIn > 0 ? runner.frac : 0)) : 0;
  const stale = { replacing: !!run && f !== undefined && snap.schedule.staleIn === 0 };

  return (
    <svg className="diagram" viewBox={`0 0 ${VIEW.w} ${VIEW.h}`} preserveAspectRatio="xMidYMid meet" role="img" aria-label="Forecast pipeline information flow">
      <defs>
        <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M0,0 L10,5 L0,10 z" className="arrowhead" />
        </marker>
 <marker id="arrow-release" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5.5" markerHeight="5.5" orient="auto-start-reverse">
          <path d="M0,0 L10,5 L0,10 z" className="arrowhead release" />
        </marker>
        <marker id="arrow-heavy" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5.5" markerHeight="5.5" orient="auto-start-reverse">
          <path d="M0,0 L10,5 L0,10 z" className="arrowhead heavy" />
        </marker>
        <filter id="offline-halo" x="-30%" y="-30%" width="160%" height="160%">
          <feGaussianBlur in="SourceAlpha" stdDeviation="5" result="b" />
          <feFlood floodColor="var(--offline)" floodOpacity="0.85" />
          <feComposite in2="b" operator="in" />
          <feMerge>
            <feMergeNode />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      {/* Regions (UI-1) */}
      <g className="regions">
        <rect className="region world" x={0} y={0} width={REGIONS.worldRight} height={VIEW.h} />
        <rect className="region consumers" x={REGIONS.consumersLeft} y={0} width={VIEW.w - REGIONS.consumersLeft} height={VIEW.h} />
        <line className="boundary" x1={REGIONS.worldRight} y1={0} x2={REGIONS.worldRight} y2={VIEW.h} />
        <line className="boundary" x1={REGIONS.consumersLeft} y1={0} x2={REGIONS.consumersLeft} y2={VIEW.h} />
        <T x={REGIONS.worldRight / 2} y={222} cls="region-label" anchor="middle">
          WORLD
        </T>
        <T x={(REGIONS.worldRight + REGIONS.consumersLeft) / 2} y={24} cls="region-label" anchor="middle">
          SYSTEM
        </T>
        <T x={(REGIONS.consumersLeft + VIEW.w) / 2} y={34} cls="region-label" anchor="middle">
          ONBOARD CONSUMERS
        </T>
      </g>

      {/* Orchestrator frame (UI-2): off-the-shelf, mocked */}
      <Box r={REGIONS.orchestrator} style="ots" cls="orchestrator-frame">
        <T x={REGIONS.orchestrator.x + 14} y={REGIONS.orchestrator.y + 22} cls="frame-title">
          Orchestrator · asset graph
        </T>
        <T x={REGIONS.orchestrator.x + 214} y={REGIONS.orchestrator.y + 22} cls="muted small">
          off-the-shelf (mocked) · one run at a time
        </T>
      </Box>

      {/* Edges */}
      <g className="edges">
        {routes.map((r) => (
          <EdgePath key={r.key} r={r} />
        ))}
        <path className="edge lineage" d={pathD(loop)} markerEnd="url(#arrow-heavy)" />
        <T x={loop[2]!.x + 8} y={loop[2]!.y + 14} cls="small loop-label">
          background = previous forecast{snap.background ? ` (${snap.background.id})` : ''}
        </T>
      </g>

      <ControlPanel snap={snap} runner={runner} controls={controls} />

      {/* World */}
      <Box r={R.ocean} style="world">
        <T x={R.ocean.x + 10} y={R.ocean.y + 22} cls="title">
          Ocean
        </T>
        <T x={R.ocean.x + 10} y={R.ocean.y + 38} cls="muted small">
          true values, σ from climatology
        </T>
        {snap.inputs.map((s, i) => {
          const y = R.ocean.y + 58 + i * 30;
          const z = (s.truth - s.base) / s.sigma;
          const cx = R.ocean.x + 95;
          return (
            <g key={s.key}>
              <T x={R.ocean.x + 10} y={y} cls="small">
                {s.label}
              </T>
              {/* Scenario: a front moves this input +5σ over 20 s (toggle). The label says what a click does. */}
              <SvgButton
                x={R.ocean.x + R.ocean.w - 74}
                y={y - 13}
                w={64}
                label={s.shiftOn ? 'clear front' : '+5σ front'}
                title={s.shiftOn ? `Clear the front: ${s.label} returns to climatology` : `Scenario: a front moves ${s.label} +5σ over 20 s`}
                cls={`scenario ${s.shiftOn ? 'on' : ''}`}
                onClick={() => runner.apply({ type: 'shift', input: s.key, on: !s.shiftOn })}
              />
              <line className="axis" x1={cx - 80} x2={cx + 80} y1={y + 10} y2={y + 10} />
              <line className="axis zero" x1={cx} x2={cx} y1={y + 5} y2={y + 15} />
              <rect className="zbar" x={Math.min(cx, cx + z * 13)} y={y + 7} width={Math.abs(z * 13)} height={6} />
            </g>
          );
        })}
      </Box>
      <Box r={R.sensors} style="world">
        <T x={R.sensors.x + 10} y={R.sensors.y + 22} cls="title">
          Sensors
        </T>
        <T x={R.sensors.x + 10} y={R.sensors.y + 38} cls="muted small">
          latest reading · noise
        </T>
        {snap.inputs.map((s, i) => (
          <g key={s.key}>
            <T x={R.sensors.x + 10} y={R.sensors.y + 64 + i * 36} cls="small">
              {s.label}
            </T>
            <T x={R.sensors.x + 10} y={R.sensors.y + 80 + i * 36} cls="small mono">
              {fmt(s.reading, s.sigma < 1 ? 2 : 1)} {s.unit}
            </T>
            <Stepper
              x={R.sensors.x + R.sensors.w - 90}
              y={R.sensors.y + 67 + i * 36}
              vw={48}
              value={`±${s.noise}σ`}
              what={`${s.label} sensor noise`}
              cls="scenario"
              dec={stepIn(NOISE_STEPS, s.noise, -1)}
              inc={stepIn(NOISE_STEPS, s.noise, 1)}
              onSet={(v) => runner.apply({ type: 'noise', input: s.key, sigma: v })}
            />
          </g>
        ))}
      </Box>

      {/* Ingestion: ours, not orchestrated (UI-4); presenter can stop/start it (FLT-3) */}
      <g filter={snap.ingestion.running ? undefined : 'url(#offline-halo)'}>
        <Box r={R.ingestion} style="ours" cls={snap.ingestion.running ? '' : 'stopped'}>
          <T x={R.ingestion.x + 32} y={R.ingestion.y + 22} cls="title">
            Ingestion
          </T>
          <T x={R.ingestion.x + 10} y={R.ingestion.y + 38} cls="tag">
            not orchestrated
          </T>
          <T x={R.ingestion.x + 10} y={R.ingestion.y + 62} cls="small">
            accepted {snap.ingestion.accepted}
          </T>
          <T x={R.ingestion.x + 10} y={R.ingestion.y + 80} cls="small">
            rejected {snap.ingestion.rejected}
          </T>
          <T x={R.ingestion.x + 10} y={R.ingestion.y + 99} cls={`small ${snap.ingestion.status === 'running' ? 'muted' : 'offline-label'}`}>
            {snap.ingestion.status === 'waiting for Observations DB' ? 'waiting for DB' : snap.ingestion.status}
          </T>
        </Box>
      </g>
      <PlayPause at={{ x: R.ingestion.x + 18, y: R.ingestion.y + 17 }} running={snap.ingestion.running} what="ingestion (readings queue in the sensor broker)" onToggle={() => runner.apply({ type: 'ingestion', running: !snap.ingestion.running })} />

      {/* Sensor broker: persistent queue between the DAQ gateway and ingestion (FLT-3) */}
      <Box r={R.sensorBroker} style="ots">
        <T x={R.sensorBroker.x + 10} y={R.sensorBroker.y + 22} cls="title">
          Sensor broker
        </T>
        <T x={R.sensorBroker.x + 10} y={R.sensorBroker.y + 38} cls="muted tiny">
          persistent queue · QoS 1
        </T>
        <T x={R.sensorBroker.x + 10} y={R.sensorBroker.y + 62} cls="tiny muted">
          acked after DB commit
        </T>
        <T x={R.sensorBroker.x + 10} y={R.sensorBroker.y + 84} cls="tiny muted">
          {snap.sensorBroker.queued > snap.inputs.length ? `oldest waiting ${snap.sensorBroker.oldestAge}s` : ''}
        </T>
      </Box>
      {/* Queue tab on the exit edge (towards ingestion), only while a backlog builds */}
      {snap.sensorBroker.queued > snap.inputs.length && (
        <QueueTab x={R.sensorBroker.x + R.sensorBroker.w - 100} edgeY={R.sensorBroker.y} w={92} label={`${snap.sensorBroker.queued} queued`} />
      )}

      {/* Observations DB = the observations source asset (UI-8); presenter can stop/start it (FLT-3) */}
      <g filter={snap.stores.observationsUp ? undefined : 'url(#offline-halo)'}>
      <Store r={R.observationsDb} cls={snap.stores.observationsUp ? '' : 'stopped'}>
        <T x={R.observationsDb.x + 32} y={R.observationsDb.y + 26} cls="title">
          Observations
        </T>
        <T x={R.observationsDb.x + 32} y={R.observationsDb.y + 42} cls="title">
          DB
        </T>
        <T x={R.observationsDb.x + 12} y={R.observationsDb.y + 62} cls="tag">
          source asset
        </T>
        <T x={R.observationsDb.x + 12} y={R.observationsDb.y + 92} cls={snap.stores.observationsUp ? 'small mono' : 'small offline-label'}>
          {snap.stores.observationsUp ? `${snap.stores.observations} rows` : 'stopped'}
        </T>
      </Store>
      </g>
      <PlayPause at={{ x: R.observationsDb.x + 19, y: R.observationsDb.y + 21 }} running={snap.stores.observationsUp} what="the Observations DB (ingestion holds off, observation reads fail)" onToggle={() => runner.apply({ type: 'observationsDb', up: !snap.stores.observationsUp })} />

      {/* Triggers */}
      <Box r={R.driftSensor} style="ots">
        <T x={R.driftSensor.x + 32} y={R.driftSensor.y + 22} cls="title">
          Drift sensor
        </T>
        <T x={R.driftSensor.x + 10} y={R.driftSensor.y + 36} cls="muted small">
          every {snap.drift.interval} s
        </T>
        <Ring cx={R.driftSensor.x + R.driftSensor.w - 22} cy={R.driftSensor.y + 22} frac={1 - (snap.drift.nextCheckIn - runner.frac) / snap.drift.interval} label={`${snap.drift.nextCheckIn}s`} />
      </Box>
      <InputSlots x={R.driftSensor.x + 150} y={R.driftSensor.y + 22} reader="driftMonitor" who="Drift monitor" inputs={INPUTS.driftMonitor} runner={runner} onPick={onPick} onTip={onTip} />
      <Shim r={R.shimCheck} name="check" />
      <g filter={snap.offline.driftMonitor ? 'url(#offline-halo)' : undefined}>
      <Box r={R.driftMonitor} style="ours" cls={snap.offline.driftMonitor ? 'stopped' : ''}>
        <T x={R.driftMonitor.x + 8} y={R.driftMonitor.y + 16} cls="title small-title">
          Drift monitor
        </T>
        <ResidualBars r={R.driftMonitor} snap={snap} />
        <T x={R.driftMonitor.x + 8} y={R.driftMonitor.y + R.driftMonitor.h - 8} cls={`small status ${snap.drift.status.startsWith('drift') ? 'alert' : ''}`}>
          {snap.drift.status}
        </T>
      </Box>
      </g>
      <OperatorControls snap={snap} runner={runner} />
      <PlayPause at={{ x: R.driftSensor.x + 18, y: R.driftSensor.y + 17 }} running={!snap.offline.driftMonitor} what="the drift monitor (checks fail, no drift runs)" onToggle={() => runner.apply({ type: 'offline', module: 'driftMonitor', offline: !snap.offline.driftMonitor })} />
      <Box r={R.stalenessSchedule} style="ots">
        <T x={R.stalenessSchedule.x + 10} y={R.stalenessSchedule.y + 22} cls="title">
          Staleness schedule
        </T>
        <T x={R.stalenessSchedule.x + 10} y={R.stalenessSchedule.y + 40} cls="muted tiny">
          replaces a forecast
        </T>
        <T x={R.stalenessSchedule.x + 10} y={R.stalenessSchedule.y + 54} cls="muted tiny">
          older than {snap.schedule.staleAfter} s
        </T>
        <T x={R.stalenessSchedule.x + 10} y={R.stalenessSchedule.y + 70} cls="tiny">
          {!f ? 'no forecast yet' : staleRemaining > 0 ? 'stale in' : stale.replacing ? 'stale · replacing' : 'stale'}
        </T>
        <Ring
          cx={R.stalenessSchedule.x + R.stalenessSchedule.w - 30}
          cy={R.stalenessSchedule.y + 46}
          r={21}
          frac={f ? 1 - staleRemaining / snap.schedule.staleAfter : 0}
          label={f ? mmss(snap.schedule.staleIn) : '—'}
          cls="stale-ring"
        />
      </Box>
      <Box r={R.manualRequest} style="ots">
        <T x={R.manualRequest.x + 10} y={R.manualRequest.y + 22} cls="title">
          Manual request
        </T>
        <T x={R.manualRequest.x + 10} y={R.manualRequest.y + 42} cls="small">
          {snap.queued ? `queued: ${snap.queued}` : 'nothing queued'}
        </T>
        {/* Operator control (violet, §5.4): the operator asks for a run from here */}
        <SvgButton
          x={R.manualRequest.x + 10}
          y={R.manualRequest.y + 52}
          w={104}
          label="Request a run"
          title="Operator: request a forecast run"
          cls="operator"
          onClick={() => runner.apply({ type: 'requestRun' })}
        />
      </Box>
      {/* Private store (UI-9): internal, no edges */}
      <Store r={R.privateStore} ours={false}>
        <T x={R.privateStore.x + 10} y={R.privateStore.y + 20} cls="small title-sm">
          Private store
        </T>
        <T x={R.privateStore.x + 10} y={R.privateStore.y + 38} cls="muted tiny">
          run history · schedule
        </T>
        <T x={R.privateStore.x + 10} y={R.privateStore.y + 52} cls="muted tiny">
          sensor state
        </T>
        <T x={R.privateStore.x + 10} y={R.privateStore.y + 76} cls="small mono">
          {snap.privateStore.runs} runs
        </T>
      </Store>

      {/* Assets */}
      <Box r={R.climatology} style="asset" cls={materialising('climatology')}>
        <T x={R.climatology.x + 10} y={R.climatology.y + 24} cls="asset-title">
          climatology
        </T>
        <T x={R.climatology.x + 10} y={R.climatology.y + 48} cls="muted small">
          from NetCDF store
        </T>
      </Box>

      <Box r={R.forecast} style="asset" cls={materialising('forecast')}>
        <T x={R.forecast.x + 34} y={R.forecast.y + 24} cls="asset-title">
          forecast
        </T>
        <T x={R.forecast.x + 12} y={R.forecast.y + 44} cls="small">
          {f ? `${f.id} · ${f.cause} · ${f.horizon} h` : 'none yet'}
        </T>
        {/* The asset states when it goes out of date; the countdown ring belongs to the Staleness schedule (the trigger). */}
        {f && (
          <T x={R.forecast.x + 12} y={R.forecast.y + 62} cls={`tiny ${staleRemaining > 0 ? 'muted' : 'strong'}`}>
            {staleRemaining > 0 ? `valid until ${clockLabel(f.validUntil)}` : stale.replacing ? 'stale · replacing' : 'stale'}
          </T>
        )}
        <T x={R.forecast.x + 12} y={R.forecast.y + R.forecast.h - 46} cls="tiny waiting">
          {snap.capabilities.longRange !== (f ? f.horizon === 48 : false) ? `${snap.capabilities.longRange ? 48 : 12} h from the next run` : ''}
        </T>
        <T x={R.forecast.x + 12} y={R.forecast.y + R.forecast.h - 30} cls="tiny muted">
          {run ? `${run.id} → ${run.forecastId} · ${run.causes}` : 'idle'}
        </T>
        <T x={R.forecast.x + 12} y={R.forecast.y + R.forecast.h - 14} cls="tiny muted">
          {snap.assets.forecast !== undefined ? `materialised ${clockLabel(snap.assets.forecast)}` : ''}
        </T>
      </Box>
      <InputSlots x={R.forecast.x + 144} y={R.forecast.y + 22} reader="modelRunner" who="Model runner" inputs={INPUTS.modelRunner} runner={runner} onPick={onPick} onTip={onTip} />
      <PlayPause at={{ x: R.forecast.x + 20, y: R.forecast.y + 19 }} running={!snap.offline.modelRunner} what="the model runner (every run fails until resumed)" onToggle={() => runner.apply({ type: 'offline', module: 'modelRunner', offline: !snap.offline.modelRunner })} />
      <Shim r={R.shimRun} name="run" retryIn={retryOn('run')} />
      <Module r={R.modelRunner} name="Model runner" offline={snap.offline.modelRunner}>
        <ExecLine r={R.modelRunner} label={execLabel('run')} frac={shownProgress('run', 8)} active={!!executing('run') && !retrieving('run')} />
        {retryOn('run') !== undefined && run?.lastFailure && (
          <T x={R.modelRunner.x + 8} y={R.modelRunner.y + 58} cls="tiny muted">
            {run.lastFailure}
          </T>
        )}
        <T x={R.modelRunner.x + 8} y={R.modelRunner.y + R.modelRunner.h - 10} cls="tiny muted">
          nudges background 60% to obs
        </T>
      </Module>

      <Box r={R.features} style="asset" cls={`${materialising('features')} ${detector ? '' : 'absent'}`}>
        <T x={R.features.x + 34} y={R.features.y + 24} cls="asset-title">
          features
        </T>
        <T x={R.features.x + 12} y={R.features.y + 44} cls="small">
          {snap.stores.features} stored
        </T>
        {!detector && (
          <T x={R.features.x + 12} y={R.features.y + 60} cls="tiny strong">
            no feature detector{snap.stores.features ? ' · not updated' : ''}
          </T>
        )}
        <T x={R.features.x + 12} y={R.features.y + R.features.h - 30} cls="tiny waiting">
          {run && run.step === 'run' ? `waiting for forecast ${run.forecastId}` : ''}
        </T>
        <T x={R.features.x + 12} y={R.features.y + R.features.h - 14} cls="tiny muted">
          {snap.assets.features !== undefined ? `materialised ${clockLabel(snap.assets.features)}` : ''}
        </T>
      </Box>
      {detector && <InputSlots x={R.features.x + 96} y={R.features.y + 66} reader="featureDetector" who="Feature detector" inputs={INPUTS.featureDetector} runner={runner} onPick={onPick} onTip={onTip} />}
      {detector && <PlayPause at={{ x: R.features.x + 20, y: R.features.y + 19 }} running={!snap.offline.featureDetector} what="the feature detector (detection fails until resumed)" onToggle={() => runner.apply({ type: 'offline', module: 'featureDetector', offline: !snap.offline.featureDetector })} />}
      <g className={detector ? '' : 'absent-part'}>
      <Shim r={R.shimDetect} name="detect" retryIn={retryOn('detect')} />
      <Module r={R.featureDetector} name="Feature detector" offline={snap.offline.featureDetector}>
        <ExecLine r={R.featureDetector} label={execLabel('detect')} frac={shownProgress('detect', 5)} active={!!executing('detect') && !retrieving('detect')} />
        <T x={R.featureDetector.x + 8} y={R.featureDetector.y + R.featureDetector.h - 10} cls="tiny muted">
          fronts &amp; eddies
        </T>
      </Module>
      </g>

      <Box r={R.announcement} style="asset" cls={materialising('announcement')}>
        <T x={R.announcement.x + 12} y={R.announcement.y + 24} cls="asset-title">
          announcement
        </T>
        <T x={R.announcement.x + 12} y={R.announcement.y + R.announcement.h - 30} cls="tiny waiting">
          {run && (run.step === 'run' || run.step === 'detect') ? 'waiting for features' : ''}
        </T>
        <T x={R.announcement.x + 12} y={R.announcement.y + R.announcement.h - 14} cls="tiny muted">
          {snap.assets.announcement !== undefined ? `materialised ${clockLabel(snap.assets.announcement)}` : ''}
        </T>
      </Box>
      <Shim r={R.shimAnnounce} name="announce" />
      <Module r={R.announcer} name="Announcer" offline={false}>
        <T x={R.announcer.x + 8} y={R.announcer.y + 40} cls="tiny muted">
          id · valid-until
        </T>
        <T x={R.announcer.x + 8} y={R.announcer.y + 54} cls="tiny muted">
          cause · digest
        </T>
        <T x={R.announcer.x + 8} y={R.announcer.y + 68} cls="tiny muted">
          feature count
        </T>
      </Module>

      {/* Stores and read path (UI-5) */}
      <Store r={R.netcdfStore}>
        <T x={R.netcdfStore.x + 12} y={R.netcdfStore.y + 26} cls="title">
          NetCDF store
        </T>
        <T x={R.netcdfStore.x + 12} y={R.netcdfStore.y + 46} cls="muted small">
          climatology + forecasts
        </T>
        <T x={R.netcdfStore.x + 12} y={R.netcdfStore.y + 70} cls="small mono">
          {snap.stores.coverageFiles} files
        </T>
      </Store>
      <Store r={R.featuresDb}>
        <T x={R.featuresDb.x + 12} y={R.featuresDb.y + 26} cls="title">
          Features DB
        </T>
        <T x={R.featuresDb.x + 12} y={R.featuresDb.y + 46} cls="muted small">
          PostGIS
        </T>
        <T x={R.featuresDb.x + 12} y={R.featuresDb.y + 70} cls="small mono">
          {snap.stores.features} rows
        </T>
      </Store>
      <Box r={R.pygeoapi} style="ots">
        <T x={R.pygeoapi.x + 12} y={R.pygeoapi.y + 24} cls="title">
          pygeoapi
        </T>
        <T x={R.pygeoapi.x + 12} y={R.pygeoapi.y + 42} cls="tag">
          read only
        </T>
        <T x={R.pygeoapi.x + 120} y={R.pygeoapi.y + 24} cls="tiny muted">
          /collections
        </T>
        {/* CAT-3: the catalogue, as consumers discover it */}
        {snap.catalogue.map((c, i) => (
          <T key={c.id} x={R.pygeoapi.x + 12} y={R.pygeoapi.y + 60 + i * 14} cls={`tiny cat-${c.status.replace(/ /g, '-')}`}>
            {`${c.id}${c.horizon ? ` · ${c.horizon} h${c.nextHorizon ? ` → ${c.nextHorizon} h next run` : ''}` : ''}${c.status === 'available' ? '' : ` · ${c.status}`}`}
          </T>
        ))}
      </Box>

      {/* Broker straddles the boundary */}
      <Box r={R.broker} style="ots">
        <T x={R.broker.x + 10} y={R.broker.y + 24} cls="title">
          Broker
        </T>
        {/* CAT-4: topics and their subscriber counts */}
        {(
          [
            ['forecast/new', 'forecast'],
            ['features/new', 'features'],
            ['catalogue/changed', 'catalogue'],
          ] as const
        ).map(([topic, label], i) => (
          <T key={topic} x={R.broker.x + 10} y={R.broker.y + 46 + i * 16} cls={`tiny mono ${snap.topics[topic] ? '' : 'muted'}`}>
            {`${label} ×${snap.topics[topic]}`}
          </T>
        ))}
      </Box>

      {/* Consumers */}
      {snap.consumers.slice(0, CONSUMER_AREA.max).map((c, i) => {
        const r = consumerRect(i);
        const l = c.latest;
        const tone = STATUS_TONE[c.status] ?? 'neutral';
        return (
          <Box key={c.id} r={r} style="world">
            <T x={r.x + 10} y={r.y + 20} cls="title">
              {c.id}
            </T>
            <T x={r.x + 34} y={r.y + 19} cls="tiny muted">
              {PROFILES[c.profile].title}
            </T>
            <T x={r.x + r.w - 10} y={r.y + 21} cls={`verdict ${l ? (l.ok ? 'ok' : 'bad') : ''}`} anchor="end">
              {l ? (l.ok ? '✓' : '✗') : '·'}
            </T>
            {/* CAT-5: the level of service it can give with what is offered */}
            <g className={`status-badge ${tone}`}>
              <title>{PROFILES[c.profile].about}</title>
              <rect x={r.x + 10} y={r.y + 28} width={c.status.length * 6.4 + 14} height={17} rx={8.5} />
              <text x={r.x + 17} y={r.y + 40.5} className="tiny">
                {c.status}
              </text>
            </g>
            <InputSlots x={r.x + r.w - 52} y={r.y + 37} reader="consumer" instance={c.id} who={c.id} inputs={INPUTS.consumer[c.profile]} runner={runner} onPick={onPick} onTip={onTip} label={false} />
            <T x={r.x + 10} y={r.y + 62} cls="small">
              {l ? `${l.forecastId}${c.waiting ? ' …' : ''}` : 'no data'}
            </T>
            <T x={r.x + 10} y={r.y + 82} cls="tiny muted">
              {`subs: ${c.topics.filter((t) => t !== 'catalogue/changed').map((t) => t.split('/')[0]).join(', ') || '—'}`}
            </T>
            {/* CON-3: the app's user reconfigures it, so it discovers and fetches again (no new data implied) */}
            <g
              className="svg-button"
              role="button"
              tabIndex={0}
              aria-label={`Reconfigure ${c.id}`}
              onClick={() => runner.apply({ type: 'reconfigureConsumer', consumer: c.id })}
              onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && runner.apply({ type: 'reconfigureConsumer', consumer: c.id })}
            >
              <title>The app's user changes what it shows, so it discovers the catalogue and fetches again</title>
              <rect x={r.x + r.w - 82} y={r.y + 50} width={74} height={18} rx={4} />
              <text x={r.x + r.w - 45} y={r.y + 63} textAnchor="middle" className="tiny">
                Reconfigure
              </text>
            </g>
          </Box>
        );
      })}
      {snap.consumers.length > CONSUMER_AREA.max && (
        <T x={CONSUMER_AREA.x} y={consumerRect(CONSUMER_AREA.max).y + 16} cls="small muted">
          +{snap.consumers.length - CONSUMER_AREA.max} more
        </T>
      )}

      {/* Token key: the standard each document's letter stands for */}
      <g className="token-key" aria-label="Token key">
        <rect x={TOKEN_KEY.x} y={TOKEN_KEY.y} width={TOKEN_KEY.w} height={TOKEN_KEY.h} rx={6} />
        <T x={TOKEN_KEY.x + 12} y={TOKEN_KEY.y + 22} cls="title">
          Token key
        </T>
        <T x={TOKEN_KEY.x + 12} y={TOKEN_KEY.y + 38} cls="tiny muted">
          letter = standard of the content
        </T>
        {Object.entries(STANDARDS).map(([code, name], i) => (
          <g key={code}>
            <DocToken x={TOKEN_KEY.x + 22} y={TOKEN_KEY.y + 58 + i * 21} size={1.4} letter={code} cls="token" />
            <T x={TOKEN_KEY.x + 40} y={TOKEN_KEY.y + 63 + i * 21} cls="small">
              {name}
            </T>
          </g>
        ))}
      </g>

      {/* Tokens: one per recorded interaction (MOT-1) */}
      <Tokens runner={runner} byKey={byKey} loop={loop} onPick={onPick} onTokenTip={onTokenTip} />

      {/* WALK-2: the walkthrough dims everything but the current region or component. */}
      {spotlight !== undefined && (
        <g className="spotlight">
          <path
            className="dim"
            fillRule="evenodd"
            d={`M0,0 H${VIEW.w} V${VIEW.h} H0 Z${spotlight ? ` M${spotlight.x},${spotlight.y} v${spotlight.h} h${spotlight.w} v${-spotlight.h} Z` : ''}`}
          />
          {spotlight && <rect className="ring" x={spotlight.x} y={spotlight.y} width={spotlight.w} height={spotlight.h} rx={8} />}
        </g>
      )}
    </svg>
  );
}

/** An SVG button: rounded rect, an icon and/or label, a tooltip; Enter/Space activate it. */
function CtlButton(props: { x: number; y: number; w: number; h: number; title: string; onClick: () => void; cls?: string; pressed?: boolean; children: ReactNode; role?: 'button' | 'radio' }) {
  const { x, y, w, h, title, onClick, cls = '', pressed, children, role = 'button' } = props;
  return (
    <g
      className={`ctl-btn ${cls} ${pressed ? 'on' : ''}`}
      role={role}
      tabIndex={0}
      aria-label={title}
      {...(role === 'radio' ? { 'aria-checked': !!pressed } : pressed !== undefined ? { 'aria-pressed': pressed } : {})}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick();
        }
      }}
    >
      <title>{title}</title>
      <rect x={x} y={y} width={w} height={h} rx={h / 2 > 12 ? 8 : h / 2} />
      {children}
    </g>
  );
}

/**
 * §5.4 Presenter controls, in the top fifth of the World column: a large play/pause, the clock,
 * Step, the rate (½×/1×/10×/60× as a radio group), Add consumer, Walkthrough and the event log.
 */
function ControlPanel({ snap, runner, controls }: { snap: Snapshot; runner: Runner; controls: Controls }) {
  const c = CONTROL;
  const playing = runner.running;
  const cx = c.x + 34;
  const cy = c.y + 50;
  const rates: Rate[] = [0.5, 1, 10, 60];
  const rw = 44;
  return (
    <g className="control-panel" aria-label="Presenter controls">
      <rect className="frame" x={c.x} y={c.y} width={c.w} height={c.h} rx={8} />
      <T x={c.x + 12} y={c.y + 18} cls="region-label control-label">
        CONTROL
      </T>
      {/* Play / pause */}
      <g
        className={`ctl-play ${playing ? 'playing' : 'paused'}`}
        role="button"
        tabIndex={0}
        aria-label={playing ? 'Pause the simulation' : 'Run the simulation'}
        onClick={() => runner.setRunning(!playing)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            runner.setRunning(!playing);
          }
        }}
      >
        <title>{playing ? 'Pause (Space)' : 'Run (Space)'}</title>
        <circle cx={cx} cy={cy} r={24} />
        {playing ? (
          <path className="glyph" d={`M${cx - 8},${cy - 10} v20 h5 v-20 z M${cx + 3},${cy - 10} v20 h5 v-20 z`} />
        ) : (
          <path className="glyph" d={`M${cx - 6},${cy - 12} L${cx + 12},${cy} L${cx - 6},${cy + 12} z`} />
        )}
      </g>
      <text x={c.x + 66} y={c.y + 58} className="ctl-clock mono">
        {snap.clock}
      </text>
      {/* Rate: one of four (radio group) */}
      <g role="radiogroup" aria-label="Rate">
        {rates.map((r, i) => (
          <CtlButton key={r} role="radio" x={c.x + 12 + i * (rw + 3)} y={c.y + 84} w={rw} h={24} title={`Rate ${r === 0.5 ? '½' : r}×`} pressed={runner.rate === r} onClick={() => runner.setRate(r)}>
            <text x={c.x + 12 + i * (rw + 3) + rw / 2} y={c.y + 100.5} textAnchor="middle" className="ctl-text">
              {r === 0.5 ? '½' : r}×
            </text>
          </CtlButton>
        ))}
      </g>
      {/* Step, Add consumer, Walkthrough, Event log */}
      <CtlButton x={c.x + 12} y={c.y + 120} w={52} h={28} title="Step: advance one second, then pause" onClick={() => runner.step()}>
        <path className="glyph" d={`M${c.x + 20},${c.y + 128} l8,6 l-8,6 z M${c.x + 29},${c.y + 128} h2.5 v12 h-2.5 z`} />
        <text x={c.x + 36} y={c.y + 138} className="ctl-text sm">
          Step
        </text>
      </CtlButton>
      <CtlButton x={c.x + 68} y={c.y + 120} w={76} h={28} title="Add a consumer: it subscribes now and catches up" onClick={() => runner.apply({ type: 'addConsumer' })}>
        <path className="glyph-stroke" d={`M${c.x + 78},${c.y + 129} v10 M${c.x + 73},${c.y + 134} h10`} />
        <text x={c.x + 86} y={c.y + 138} className="ctl-text sm">
          Consumer
        </text>
      </CtlButton>
      <CtlButton x={c.x + 148} y={c.y + 120} w={26} h={28} title="Walkthrough: introduce each region and component" onClick={controls.onWalkthrough}>
        <circle className="glyph-stroke" cx={c.x + 161} cy={c.y + 134} r={7.5} />
        <text x={c.x + 161} y={c.y + 138} textAnchor="middle" className="ctl-text sm">
          ?
        </text>
      </CtlButton>
      <CtlButton x={c.x + 178} y={c.y + 120} w={26} h={28} title={`Event log (${snap.events.count} events)`} pressed={controls.logOpen} onClick={controls.onLog}>
        <path className="glyph-stroke" d={[0, 5, 10].map((k) => `M${c.x + 185},${c.y + 129 + k} h12`).join(' ')} />
      </CtlButton>
      {/* CAT-1: capabilities of the deployed system; each takes effect from the next run */}
      <T x={c.x + 12} y={c.y + 168} cls="tiny muted">
        Capabilities · from next run
      </T>
      <CtlButton x={c.x + 12} y={c.y + 174} w={118} h={16} title="Feature detector: present or absent (takes effect from the next run)" pressed={snap.capabilities.featureDetector} onClick={() => runner.apply({ type: 'capability', name: 'featureDetector', on: !snap.capabilities.featureDetector })} cls="cap">
        <text x={c.x + 71} y={c.y + 185.5} textAnchor="middle" className="ctl-text cap-text">
          {snap.capabilities.featureDetector ? '✓ ' : ''}Feature detector
        </text>
      </CtlButton>
      <CtlButton x={c.x + 136} y={c.y + 174} w={64} h={16} title="48 h forecasts instead of 12 h (from the next run)" pressed={snap.capabilities.longRange} onClick={() => runner.apply({ type: 'capability', name: 'longRange', on: !snap.capabilities.longRange })} cls="cap">
        <text x={c.x + 168} y={c.y + 185.5} textAnchor="middle" className="ctl-text cap-text">
          {snap.capabilities.longRange ? '✓ ' : ''}48 h
        </text>
      </CtlButton>
      {/* Event count, as a badge on the log icon */}
      <g className="ctl-badge" aria-hidden>
        <rect x={c.x + 187} y={c.y + 112} width={22} height={13} rx={6.5} />
        <text x={c.x + 198} y={c.y + 121.5} textAnchor="middle" className="mono">
          {snap.events.count > 999 ? '1k+' : snap.events.count}
        </text>
      </g>
    </g>
  );
}

/**
 * A token drawn as a tiny document: a white page with a folded top-right corner, centred on (x, y),
 * lettered with the standard its content follows (S SensorThings, Q SQL, E EDR…). Unlettered
 * tokens show ruled lines instead.
 */
export function DocToken({ x, y, size, cls, letter }: { x: number; y: number; size: number; cls: string; letter?: string }) {
  const w = 10 * size;
  const h = 12 * size;
  const f = 3 * size; // fold
  const x0 = x - w / 2;
  const y0 = y - h / 2;
  return (
    <g className={`${cls} ${letter ? `std-${letter}` : ''}`}>
      <path className="page" d={`M${x0},${y0} H${x0 + w - f} L${x0 + w},${y0 + f} V${y0 + h} H${x0} Z`} />
      <path className="fold" d={`M${x0 + w - f},${y0} V${y0 + f} H${x0 + w}`} />
      {letter ? (
        <text className="std" x={x} y={y0 + h * 0.78} textAnchor="middle" fontSize={8 * size}>
          {letter}
        </text>
      ) : (
        <path className="rules" d={[0.45, 0.62, 0.79].map((k) => `M${x0 + 2 * size},${y0 + h * k} H${x0 + w - 2 * size}`).join(' ')} />
      )}
    </g>
  );
}

/**
 * A tab sitting on a component's top edge: square where it meets the component, rounded on its
 * outer corners. Shows how many items are queued on that side, only while they are.
 */
/**
 * MOT-7: a reader's declared inputs as document slots. Pale while it waits for a document
 * (from its first request of a run), filled in when the response lands. Click a filled one to read it.
 */
function InputSlots(props: { x: number; y: number; reader: string; instance?: string; who: string; inputs: readonly InputDecl[]; runner: Runner; onPick: (p: Picked) => void; onTip: (t: SlotTip | null) => void; label?: boolean }) {
  const { x, y, reader, instance, who, inputs, runner, onPick, onTip, label = true } = props;
  const step = 20;
  return (
    <g className="input-slots" aria-label={`${who} needs`}>
      {label && (
        <T x={x - 4} y={y + 4} cls="tiny muted" anchor="end">
          needs
        </T>
      )}
      {inputs.map((d, i) => {
        const s = runner.slot(reader, d.slot, instance);
        const filled = s.state === 'filled' ? s.token : undefined;
        const cx = x + 8 + i * step;
        const tip = (el: Element) => {
          const b = el.getBoundingClientRect();
          onTip({ decl: d, who, reader, ...(instance ? { instance } : {}), box: { left: b.left, top: b.top, right: b.right, bottom: b.bottom } });
        };
        const open = (el: Element) => {
          if (!filled) return tip(el); // an empty slot has nothing to open: show what it is waiting for
          const b = el.getBoundingClientRect();
          onTip(null);
          onPick({ token: filled, x: b.left + b.width / 2, y: b.top + b.height / 2, fromSlot: true });
        };
        return (
          <g
            key={d.slot}
            className={`slot-hit ${filled ? 'pickable' : ''}`}
            role="button"
            tabIndex={0}
            aria-label={`${who}: ${d.label}${filled ? '' : ' (waiting)'}`}
            onMouseEnter={(e) => tip(e.currentTarget)}
            onMouseLeave={() => onTip(null)}
            onFocus={(e) => tip(e.currentTarget)}
            onBlur={() => onTip(null)}
            onClick={(e) => open(e.currentTarget)}
            onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && open(e.currentTarget)}
          >
            <rect className="hit" x={cx - 10} y={y - 12} width={20} height={24} />
            <DocToken x={cx} y={y} size={1.45} letter={d.standard} cls={`token slot ${s.state}`} />
          </g>
        );
      })}
    </g>
  );
}

function QueueTab({ x, edgeY, w, label, h = 20, r = 6 }: { x: number; edgeY: number; w: number; label: string; h?: number; r?: number }) {
  const top = edgeY - h;
  const d = `M${x},${edgeY} L${x},${top + r} Q${x},${top} ${x + r},${top} L${x + w - r},${top} Q${x + w},${top} ${x + w},${top + r} L${x + w},${edgeY} Z`;
  return (
    <g className="queue-tab" aria-label={label}>
      <path d={d} />
      <text x={x + w / 2} y={edgeY - 6} textAnchor="middle">
        {label}
      </text>
    </g>
  );
}

/**
 * Presenter control inline before a fragile component's title: pause takes it down (red halo),
 * play brings it back.
 */
function PlayPause({ at, running, what, onToggle }: { at: { x: number; y: number }; running: boolean; what: string; onToggle: () => void }) {
  const cx = at.x;
  const cy = at.y;
  const label = `${running ? 'Pause' : 'Resume'} ${what}`;
  return (
    <g className={`play-pause ${running ? '' : 'paused'}`} role="button" tabIndex={0} aria-label={label} onClick={onToggle} onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && onToggle()}>
      <title>{label}</title>
      <circle cx={cx} cy={cy} r={9} />
      {running ? (
        <path className="glyph" d={`M${cx - 3},${cy - 4} v8 M${cx + 3},${cy - 4} v8`} />
      ) : (
        <path className="glyph-fill" d={`M${cx - 3},${cy - 5} L${cx + 5},${cy} L${cx - 3},${cy + 5} Z`} />
      )}
    </g>
  );
}

/** Scenario noise levels (σ), within NOISE_BOUNDS; includes the default. */
const NOISE_STEPS = [0, 0.3, 0.5, 1, 1.5, 2, 2.5, 3].filter((v) => v >= NOISE_BOUNDS.min && v <= NOISE_BOUNDS.max);

/** The neighbouring value in `steps` (or undefined at either end). */
function stepIn(steps: readonly number[], v: number, dir: 1 | -1): number | undefined {
  return dir > 0 ? steps.find((x) => x > v) : [...steps].reverse().find((x) => x < v);
}

function range(min: number, max: number, step: number): number[] {
  const out: number[] = [];
  for (let v = min; v <= max + 1e-9; v += step) out.push(Math.round(v / step) * step);
  return out;
}

/** Operator: the drift monitor's parameters (DRF-3), in a column right of the drift monitor. */
function OperatorControls({ snap, runner }: { snap: Snapshot; runner: Runner }) {
  const r = RECTS.driftSensor;
  const d = snap.drift;
  const b = DRIFT_BOUNDS;
  const m = RECTS.driftMonitor;
  const left = m.x + m.w;
  const cx = (left + r.x + r.w) / 2;
  const thresholds = range(b.threshold.min, b.threshold.max, b.threshold.step);
  const quorums = range(b.quorum.min, snap.inputs.length, 1);
  const persistences = range(b.persistence.min, b.persistence.max, 1);
  // vw: width of the value between − and + (the threshold needs room for "2.5σ").
  const items: { label: string; value: string; vw: number; v: number; steps: number[]; act: (v: number) => void }[] = [
    { label: 'threshold', value: `${d.threshold}σ`, vw: 42, v: d.threshold, steps: thresholds, act: (v) => runner.apply({ type: 'threshold', value: v }) },
    { label: 'quorum', value: String(d.quorum), vw: 26, v: d.quorum, steps: quorums, act: (v) => runner.apply({ type: 'quorum', value: v }) },
    { label: 'persistence', value: String(d.persistence), vw: 26, v: d.persistence, steps: persistences, act: (v) => runner.apply({ type: 'persistence', value: v }) },
  ];
  return (
    <g className="operator-controls" aria-label="Operator controls">
      {items.map((it, i) => {
        const y = RECTS.shimCheck.y + 16 + i * 40;
        return (
          <g key={it.label}>
            <T x={cx} y={y - 5} cls="tiny operator-label" anchor="middle">
              {it.label}
            </T>
            <Stepper x={cx - (32 + it.vw) / 2} y={y} vw={it.vw} value={it.value} what={`Drift ${it.label}`} cls="operator" dec={stepIn(it.steps, it.v, -1)} inc={stepIn(it.steps, it.v, 1)} onSet={it.act} />
          </g>
        );
      })}
    </g>
  );
}

/** − value + : steps a control through its allowed values; an end stop greys its button out. */
function Stepper({ x, y, value, what, cls, dec, inc, onSet, vw = 36 }: { x: number; y: number; value: string; what: string; cls: string; dec?: number; inc?: number; onSet: (v: number) => void; vw?: number }) {
  const btn = (bx: number, label: string, to: number | undefined, verb: string) => (
    <g
      className={`svg-button stepper ${cls} ${to === undefined ? 'disabled' : ''}`}
      role="button"
      tabIndex={to === undefined ? -1 : 0}
      aria-label={`${verb} ${what}`}
      aria-disabled={to === undefined}
      onClick={() => to !== undefined && onSet(to)}
      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && to !== undefined && onSet(to)}
    >
      <title>{to === undefined ? `${what}: at its ${verb === 'Lower' ? 'minimum' : 'maximum'}` : `${verb} ${what} to ${to}`}</title>
      <rect x={bx} y={y} width={16} height={16} rx={3} />
      <text x={bx + 8} y={y + 12} textAnchor="middle" className="small">
        {label}
      </text>
    </g>
  );
  return (
    <g>
      {btn(x, '−', dec, 'Lower')}
      <text x={x + 16 + vw / 2} y={y + 12} textAnchor="middle" className="small mono strong">
        {value}
      </text>
      {btn(x + 16 + vw, '+', inc, 'Raise')}
    </g>
  );
}

/** A small clickable control drawn inside the diagram (keyboard accessible). */
function SvgButton({ x, y, w, label, title, onClick, cls = '' }: { x: number; y: number; w: number; label: string; title: string; onClick: () => void; cls?: string }) {
  return (
    <g className={`svg-button ${cls}`} role="button" tabIndex={0} aria-label={title} onClick={onClick} onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && onClick()}>
      <title>{title}</title>
      <rect x={x} y={y} width={w} height={18} rx={4} />
      <text x={x + w / 2} y={y + 13} textAnchor="middle" className="tiny">
        {label}
      </text>
    </g>
  );
}

function EdgePath({ r }: { r: Route }) {
  const k = r.edge.kind;
  const heavy = k === 'lineage';
  const m = midpoint(r.points);
  return (
    <g>
      <path className={`edge ${k}`} d={pathD(r.points)} markerEnd={heavy ? 'url(#arrow-heavy)' : 'url(#arrow)'} />
      {k === 'read' && (
        <T x={m.x} y={m.y - 5} cls="tiny edge-label" anchor="middle">
          read only
        </T>
      )}
    </g>
  );
}

function Module({ r, name, offline, children }: { r: Rect; name: string; offline: boolean; children?: ReactNode }) {
  return (
    <g className={`box ours module ${offline ? 'offline' : ''}`} filter={offline ? 'url(#offline-halo)' : undefined}>
      <rect x={r.x} y={r.y} width={r.w} height={r.h} rx={4} />
      <text x={r.x + 8} y={r.y + 18} className="title small-title">
        {name}
      </text>
      {offline ? (
        <text x={r.x + 8} y={r.y + 40} className="small offline-label">
          OFFLINE · every call fails
        </text>
      ) : (
        children
      )}
    </g>
  );
}

function ExecLine({ r, label, frac, active }: { r: Rect; label: string; frac: number; active: boolean }) {
  return (
    <g>
      <text x={r.x + 8} y={r.y + 40} className="tiny">
        {label || 'idle'}
      </text>
      {active && <Bar x={r.x + 8} y={r.y + 48} w={r.w - 16} frac={frac} cls="exec" />}
    </g>
  );
}

function Ring({ cx, cy, frac, label, r: rr = 13, cls = '' }: { cx: number; cy: number; frac: number; label: string; r?: number; cls?: string }) {
  const c = 2 * Math.PI * rr;
  const f = Math.max(0, Math.min(1, frac));
  return (
    <g className={`ring ${cls}`}>
      <circle cx={cx} cy={cy} r={rr} className="track" />
      <circle cx={cx} cy={cy} r={rr} className="fill" strokeDasharray={`${c * f} ${c}`} transform={`rotate(-90 ${cx} ${cy})`} />
      <text x={cx} y={cy + 4} textAnchor="middle" className={rr > 16 ? 'small mono strong' : 'tiny mono'}>
        {label}
      </text>
    </g>
  );
}

function ResidualBars({ r, snap }: { r: Rect; snap: Snapshot }) {
  const n = snap.inputs.length;
  const top = r.y + 26;
  const h = r.h - 50;
  const w = (r.w - 16) / n;
  const scale = h / 2 / 6; // ±6σ
  const mid = top + h / 2;
  const th = snap.drift.threshold * scale;
  return (
    <g className="residuals">
      <line className="threshold" x1={r.x + 8} x2={r.x + r.w - 8} y1={mid - th} y2={mid - th} />
      <line className="threshold" x1={r.x + 8} x2={r.x + r.w - 8} y1={mid + th} y2={mid + th} />
      <line className="axis" x1={r.x + 8} x2={r.x + r.w - 8} y1={mid} y2={mid} />
      {snap.inputs.map((s, i) => {
        const v = Math.max(-6, Math.min(6, s.residual ?? 0));
        const over = Math.abs(v) > snap.drift.threshold;
        const x = r.x + 8 + i * w + w * 0.25;
        return (
          <g key={s.key}>
            <rect className={`resid ${over ? 'over' : ''}`} x={x} width={w * 0.5} y={v > 0 ? mid - v * scale : mid} height={Math.abs(v) * scale} />
            <title>{`${s.label}: ${s.residual === undefined ? '—' : s.residual.toFixed(2)}σ`}</title>
          </g>
        );
      })}
    </g>
  );
}

/**
 * MOT-8: a moment on a lineage edge, not data. A release (upstream just materialised, so the
 * downstream step may start) sweeps a bright pulse along the line, then flashes the arrowhead.
 * A check (upstream already available at run start) is a fainter sweep with no flash.
 */
function Pulse({ pts, p, token, frozen, onPick }: { pts: Pt[]; p: number; token: Token; frozen: boolean; onPick: (p: Picked) => void }) {
  const release = token.signal === 'release';
  const L = lengthOf(pts);
  const sweepEnd = release ? 0.65 : 1;
  const s = Math.min(1, p / sweepEnd);
  const seg = Math.min(70, L * 0.45);
  const head = s * (L + seg * 0.4);
  const end = pts[pts.length - 1]!;
  const flash = release && p > sweepEnd ? (p - sweepEnd) / (1 - sweepEnd) : -1;
  const at = pointAt(pts, Math.min(1, head / L));
  const pick = (x: number, y: number) => onPick({ token, x, y });
  // The whole line (and its arrowhead) turns green as the pulse sweeps, holds through the flash, then fades back.
  const tint = release ? (p < sweepEnd ? s : 1 - Math.max(0, (p - sweepEnd) / (1 - sweepEnd) - 0.5) * 2) : 0;
  return (
    <g className={`pulse ${token.signal}`}>
      {release && <path d={pathD(pts)} className="tint" opacity={tint} markerEnd="url(#arrow-release)" />}
      {s < 1 || !release ? <path d={pathD(pts)} className="sweep" strokeDasharray={`${seg} ${L + seg * 2}`} strokeDashoffset={seg - head} opacity={release ? 1 : 1 - s * 0.6} /> : null}
      {flash >= 0 && <circle className="flash" cx={end.x} cy={end.y} r={5 + flash * 16} opacity={1 - flash} />}
      {flash >= 0 && <circle className="flash-core" cx={end.x} cy={end.y} r={5} opacity={1 - flash * 0.7} />}
      {frozen && (
        <circle
          className="hit pulse-hit"
          cx={flash >= 0 ? end.x : at.x}
          cy={flash >= 0 ? end.y : at.y}
          r={14}
          role="button"
          tabIndex={0}
          aria-label={`Inspect ${token.payload?.summary ?? token.edge}`}
          onClick={(e) => pick(e.clientX, e.clientY)}
          onKeyDown={(e) => {
            if (e.key !== 'Enter' && e.key !== ' ') return;
            const b = (e.currentTarget as SVGCircleElement).getBoundingClientRect();
            pick(b.x + b.width / 2, b.y + b.height / 2);
          }}
        />
      )}
    </g>
  );
}

function Tokens({ runner, byKey, loop, onPick, onTokenTip }: { runner: Runner; byKey: Map<string, Route>; loop: { x: number; y: number }[]; onPick: (p: Picked) => void; onTokenTip: (t: TokenTip | null) => void }) {
  // Drill-down: once paused, frozen tokens get a larger hit area and open a popup on click.
  const frozen = runner.frozen;
  return (
    <g className={`tokens ${frozen ? 'inspectable' : ''}`}>
      {runner.tokens.map(({ v, p }) => {
        const tk = v.token;
        // A SUBSCRIBE travels back along the consumer's delivery line: one MQTT connection, both ways (CAT-4).
        const sub = tk.edge === 'consumer>subscribe>broker';
        const routeKey = sub ? `broker>deliver>consumer#${tk.instance}` : tk.instance ? `${tk.edge}#${tk.instance}` : tk.edge;
        const pts = tk.edge === 'forecast>lineage>forecast' ? loop : byKey.get(routeKey)?.points;
        if (!pts) return null;
        if (tk.signal) return <Pulse key={tk.seq} pts={pts} p={p} token={tk} frozen={frozen} onPick={onPick} />;
        // Reads sent together travel side by side: the nth stays a constant ABREAST_GAP·n pixels behind
        // the first all the way (it appears once it has that much line behind it), so they never overlap.
        const lag = v.abreast ? (v.abreast * ABREAST_GAP) / Math.max(1, lengthOf(pts)) : 0;
        const q = Math.min(1, p - lag);
        if (q < 0) return null;
        // Replies travel back along the line, against its arrow.
        const pt = pointAt(pts, tk.reverse || sub ? 1 - q : q);
        const dot = <DocToken x={pt.x} y={pt.y} size={v.lineage ? 1.5 : 1.25} letter={tk.payload?.standard} cls={`token ${v.lineage ? 'lineage' : ''} ${tk.retry ? 'retry' : ''}`} />;
        // Hover (any time) shows what the token carries; paused, a click opens the full data.
        const tip = (el: Element) => {
          const b = el.getBoundingClientRect();
          onTokenTip({ token: tk, box: { left: b.left, top: b.top, right: b.right, bottom: b.bottom } });
        };
        const hover = { onMouseEnter: (e: { currentTarget: Element }) => tip(e.currentTarget), onMouseLeave: () => onTokenTip(null) };
        if (!frozen)
          return (
            <g key={tk.seq} className="hoverable" data-seq={tk.seq} {...hover}>
              <circle className="hit" cx={pt.x} cy={pt.y} r={9} />
              {dot}
            </g>
          );
        const pick = (e: { clientX: number; clientY: number }) => {
          onTokenTip(null);
          onPick({ token: tk, x: e.clientX, y: e.clientY });
        };
        return (
          <g
            key={tk.seq}
            className="pickable"
            data-seq={tk.seq}
            role="button"
            tabIndex={0}
            aria-label={`Inspect ${tk.payload?.summary ?? tk.edge}`}
            {...hover}
            onFocus={(e) => tip(e.currentTarget)}
            onBlur={() => onTokenTip(null)}
            onClick={pick}
            onKeyDown={(e) => {
              if (e.key !== 'Enter' && e.key !== ' ') return;
              const b = (e.currentTarget as SVGGElement).getBoundingClientRect();
              onTokenTip(null);
              onPick({ token: tk, x: b.x + b.width / 2, y: b.y + b.height / 2 });
            }}
          >
            <circle className="hit" cx={pt.x} cy={pt.y} r={9} />
            {dot}
          </g>
        );
      })}
    </g>
  );
}

