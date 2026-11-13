import { EDGES, clockLabel, type Snapshot } from '@argonautical/sim';
import { useMemo, type ReactNode } from 'react';
import type { Runner } from '../runner.ts';
import { CONSUMER_AREA, RECTS, REGIONS, VIEW, consumerRect, forecastLoop, midpoint, pathD, pointAt, routeAll, type Rect, type Route } from './layout.ts';

export type Motion = 'tokens' | 'reduced';

const MATERIALISING_TICKS = 3;

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

export function Diagram({ snap, runner, motion }: { snap: Snapshot; runner: Runner; motion: Motion }) {
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
  const executing = (step: 'run' | 'detect') => (run && run.step === step && run.retryIn === undefined && run.progress > 0 ? run : undefined);
  const smoothProgress = (step: 'run' | 'detect', dur: number) => {
    const r = executing(step);
    return r ? Math.min(1, r.progress + runner.frac / dur) : 0;
  };

  const R = RECTS;
  const f = snap.forecast;
  // Staleness countdown (ORC-1, MOT-3): smooth between ticks; "replacing" once a run is under way.
  const staleRemaining = f ? Math.max(0, snap.schedule.staleIn - (snap.schedule.staleIn > 0 ? runner.frac : 0)) : 0;
  const stale = { replacing: !!run && f !== undefined && snap.schedule.staleIn === 0 };

  return (
    <svg className="diagram" viewBox={`0 0 ${VIEW.w} ${VIEW.h}`} preserveAspectRatio="xMidYMid meet" role="img" aria-label="Forecast pipeline information flow">
      <defs>
        <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M0,0 L10,5 L0,10 z" className="arrowhead" />
        </marker>
        <marker id="arrow-heavy" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="4.5" markerHeight="4.5" orient="auto-start-reverse">
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
        <T x={REGIONS.worldRight / 2} y={34} cls="region-label" anchor="middle">
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

      {/* World */}
      <Box r={R.ocean} style="world">
        <T x={R.ocean.x + 10} y={R.ocean.y + 22} cls="title">
          Ocean
        </T>
        <T x={R.ocean.x + 10} y={R.ocean.y + 38} cls="muted small">
          true values, σ from climatology
        </T>
        {snap.inputs.map((s, i) => {
          const y = R.ocean.y + 62 + i * 36;
          const z = (s.truth - s.base) / s.sigma;
          const cx = R.ocean.x + 95;
          return (
            <g key={s.key}>
              <T x={R.ocean.x + 10} y={y} cls="small">
                {s.label}
                {s.shiftOn ? ' ↑ shift' : ''}
              </T>
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
            <T x={R.sensors.x + R.sensors.w - 10} y={R.sensors.y + 80 + i * 36} cls="small muted" anchor="end">
              ±{s.noise}σ
            </T>
          </g>
        ))}
      </Box>

      {/* Ingestion: ours, not orchestrated (UI-4) */}
      <Box r={R.ingestion} style="ours">
        <T x={R.ingestion.x + 10} y={R.ingestion.y + 22} cls="title">
          Ingestion
        </T>
        <T x={R.ingestion.x + 10} y={R.ingestion.y + 38} cls="tag">
          not orchestrated
        </T>
        <T x={R.ingestion.x + 10} y={R.ingestion.y + 66} cls="small">
          accepted {snap.ingestion.accepted}
        </T>
        <T x={R.ingestion.x + 10} y={R.ingestion.y + 84} cls="small">
          rejected {snap.ingestion.rejected}
        </T>
        <T x={R.ingestion.x + 10} y={R.ingestion.y + 106} cls="muted small">
          validates every sample
        </T>
      </Box>

      {/* Observations DB = the observations source asset (UI-8) */}
      <Store r={R.observationsDb}>
        <T x={R.observationsDb.x + 12} y={R.observationsDb.y + 26} cls="title">
          Observations
        </T>
        <T x={R.observationsDb.x + 12} y={R.observationsDb.y + 42} cls="title">
          DB
        </T>
        <T x={R.observationsDb.x + 12} y={R.observationsDb.y + 62} cls="tag">
          source asset
        </T>
        <T x={R.observationsDb.x + 12} y={R.observationsDb.y + 92} cls="small mono">
          {snap.stores.observations} rows
        </T>
      </Store>

      {/* Triggers */}
      <Box r={R.driftSensor} style="ots">
        <T x={R.driftSensor.x + 10} y={R.driftSensor.y + 22} cls="title">
          Drift sensor
        </T>
        <T x={R.driftSensor.x + 10} y={R.driftSensor.y + 36} cls="muted small">
          every {snap.drift.interval} s
        </T>
        <Ring cx={R.driftSensor.x + R.driftSensor.w - 22} cy={R.driftSensor.y + 22} frac={1 - (snap.drift.nextCheckIn - runner.frac) / snap.drift.interval} label={`${snap.drift.nextCheckIn}s`} />
      </Box>
      <Shim r={R.shimCheck} name="check" />
      <Box r={R.driftMonitor} style="ours">
        <T x={R.driftMonitor.x + 8} y={R.driftMonitor.y + 16} cls="title small-title">
          Drift monitor
        </T>
        <T x={R.driftMonitor.x + R.driftMonitor.w - 8} y={R.driftMonitor.y + 16} cls="small mono" anchor="end">
          {snap.drift.threshold}σ · q{snap.drift.quorum} · p{snap.drift.persistence}
        </T>
        <ResidualBars r={R.driftMonitor} snap={snap} />
        <T x={R.driftMonitor.x + 8} y={R.driftMonitor.y + R.driftMonitor.h - 8} cls={`small status ${snap.drift.status.startsWith('drift') ? 'alert' : ''}`}>
          {snap.drift.status}
        </T>
      </Box>
      <Box r={R.stalenessSchedule} style="ots">
        <T x={R.stalenessSchedule.x + 10} y={R.stalenessSchedule.y + 22} cls="title">
          Staleness schedule
        </T>
        <T x={R.stalenessSchedule.x + 10} y={R.stalenessSchedule.y + 44} cls="muted tiny">
          replaces a forecast
        </T>
        <T x={R.stalenessSchedule.x + 10} y={R.stalenessSchedule.y + 58} cls="muted tiny">
          older than {snap.schedule.staleAfter} s
        </T>
        <T x={R.stalenessSchedule.x + 10} y={R.stalenessSchedule.y + 76} cls="tiny">
          {!f ? 'no forecast yet' : staleRemaining > 0 ? 'stale in' : stale.replacing ? 'stale · replacing' : 'stale'}
        </T>
        <Ring
          cx={R.stalenessSchedule.x + R.stalenessSchedule.w - 30}
          cy={R.stalenessSchedule.y + 52}
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
        <T x={R.manualRequest.x + 10} y={R.manualRequest.y + 44} cls="small">
          {snap.queued ? `queued: ${snap.queued}` : 'nothing queued'}
        </T>
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
        <T x={R.forecast.x + 12} y={R.forecast.y + 24} cls="asset-title">
          forecast
        </T>
        <T x={R.forecast.x + 12} y={R.forecast.y + 44} cls="small">
          {f ? `${f.id} · ${f.cause}` : 'none yet'}
        </T>
        {f && (
          <>
            <Ring
              cx={R.forecast.x + R.forecast.w - 30}
              cy={R.forecast.y + 32}
              r={19}
              frac={1 - staleRemaining / snap.schedule.staleAfter}
              label={mmss(snap.schedule.staleIn)}
              cls="stale-ring"
            />
            <T x={R.forecast.x + 12} y={R.forecast.y + 62} cls={`tiny ${staleRemaining > 0 ? 'muted' : 'strong'}`}>
              {staleRemaining > 0 ? 'stale in' : stale.replacing ? 'stale · replacing' : 'stale'}
            </T>
          </>
        )}
        <T x={R.forecast.x + 12} y={R.forecast.y + R.forecast.h - 30} cls="tiny muted">
          {run ? `${run.id} → ${run.forecastId} · ${run.causes}` : 'idle'}
        </T>
        <T x={R.forecast.x + 12} y={R.forecast.y + R.forecast.h - 14} cls="tiny muted">
          {snap.assets.forecast !== undefined ? `materialised ${clockLabel(snap.assets.forecast)}` : ''}
        </T>
      </Box>
      <Shim r={R.shimRun} name="run" retryIn={retryOn('run')} />
      <Module r={R.modelRunner} name="Model runner" offline={snap.offline.modelRunner}>
        <ExecLine r={R.modelRunner} label={executing('run')?.label ?? (retryOn('run') !== undefined ? `waiting for retry (${run?.lastFailure ?? ''})` : '')} frac={smoothProgress('run', 8)} active={!!executing('run')} />
        <T x={R.modelRunner.x + 8} y={R.modelRunner.y + R.modelRunner.h - 10} cls="tiny muted">
          nudges background 60% to obs
        </T>
      </Module>

      <Box r={R.features} style="asset" cls={materialising('features')}>
        <T x={R.features.x + 12} y={R.features.y + 24} cls="asset-title">
          features
        </T>
        <T x={R.features.x + 12} y={R.features.y + 44} cls="small">
          {snap.stores.features} stored
        </T>
        <T x={R.features.x + 12} y={R.features.y + R.features.h - 14} cls="tiny muted">
          {snap.assets.features !== undefined ? `materialised ${clockLabel(snap.assets.features)}` : ''}
        </T>
      </Box>
      <Shim r={R.shimDetect} name="detect" retryIn={retryOn('detect')} />
      <Module r={R.featureDetector} name="Feature detector" offline={snap.offline.featureDetector}>
        <ExecLine r={R.featureDetector} label={executing('detect')?.label ?? (retryOn('detect') !== undefined ? 'waiting for retry' : '')} frac={smoothProgress('detect', 5)} active={!!executing('detect')} />
        <T x={R.featureDetector.x + 8} y={R.featureDetector.y + R.featureDetector.h - 10} cls="tiny muted">
          fronts &amp; eddies
        </T>
      </Module>

      <Box r={R.announcement} style="asset" cls={materialising('announcement')}>
        <T x={R.announcement.x + 12} y={R.announcement.y + 24} cls="asset-title">
          announcement
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
        <T x={R.pygeoapi.x + 12} y={R.pygeoapi.y + 66} cls="small">
          SensorThings · EDR · Features
        </T>
        <T x={R.pygeoapi.x + 12} y={R.pygeoapi.y + 88} cls="muted small">
          the only read path
        </T>
      </Box>

      {/* Broker straddles the boundary */}
      <Box r={R.broker} style="ots">
        <T x={R.broker.x + 10} y={R.broker.y + 24} cls="title">
          Broker
        </T>
        <T x={R.broker.x + 10} y={R.broker.y + 50} cls="small">
          {snap.consumers.length} subs
        </T>
        <T x={R.broker.x + 10} y={R.broker.y + 72} cls="muted tiny">
          delivers to
        </T>
        <T x={R.broker.x + 10} y={R.broker.y + 86} cls="muted tiny">
          subscribers only
        </T>
      </Box>

      {/* Consumers */}
      {snap.consumers.slice(0, CONSUMER_AREA.max).map((c, i) => {
        const r = consumerRect(i);
        const l = c.latest;
        return (
          <Box key={c.id} r={r} style="world">
            <T x={r.x + 10} y={r.y + 22} cls="title">
              {c.id}
            </T>
            <T x={r.x + r.w - 10} y={r.y + 24} cls={`verdict ${l ? (l.ok ? 'ok' : 'bad') : ''}`} anchor="end">
              {l ? (l.ok ? '✓' : '✗') : '·'}
            </T>
            <T x={r.x + 10} y={r.y + 42} cls="small">
              {l ? `${l.forecastId}${l.catchUp ? ' (catch-up)' : ''}` : 'waiting'}
            </T>
            <T x={r.x + 10} y={r.y + 58} cls="tiny muted">
              {l ? `${l.featureCount} features${c.waiting ? ' · querying…' : ''}` : `since ${clockLabel(c.subscribedAt)}`}
            </T>
          </Box>
        );
      })}
      {snap.consumers.length > CONSUMER_AREA.max && (
        <T x={CONSUMER_AREA.x} y={consumerRect(CONSUMER_AREA.max).y + 16} cls="small muted">
          +{snap.consumers.length - CONSUMER_AREA.max} more
        </T>
      )}

      {/* Motion: tokens or per-edge counters (MOT-1, MOT-2) */}
      {motion === 'tokens' ? <Tokens runner={runner} byKey={byKey} loop={loop} /> : <EdgeCounters snap={snap} routes={routes} />}
    </svg>
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

function Tokens({ runner, byKey, loop }: { runner: Runner; byKey: Map<string, Route>; loop: { x: number; y: number }[] }) {
  return (
    <g className="tokens">
      {runner.tokens.map(({ v, p }) => {
        const tk = v.token;
        const pts = tk.edge === 'forecast>lineage>forecast' ? loop : byKey.get(tk.instance ? `${tk.edge}#${tk.instance}` : tk.edge)?.points;
        if (!pts) return null;
        const pt = pointAt(pts, p);
        return <circle key={tk.seq} className={`token ${v.lineage ? 'lineage' : ''} ${tk.retry ? 'retry' : ''}`} cx={pt.x} cy={pt.y} r={v.lineage ? 8 : 4.5} />;
      })}
    </g>
  );
}

/** MOT-2: "n · last time" per edge, instead of tokens. */
function EdgeCounters({ snap, routes }: { snap: Snapshot; routes: Route[] }) {
  const seen = new Set<string>();
  return (
    <g className="counters">
      {routes.map((r) => {
        if (seen.has(r.edge.id)) return null;
        seen.add(r.edge.id);
        const s = snap.edgeStats[r.edge.id];
        if (!s) return null;
        const m = midpoint(r.points);
        const recent = snap.tick - s.last < 2;
        return (
          <g key={r.key} className={`counter ${recent ? 'recent' : ''}`}>
            <rect x={m.x - 34} y={m.y - 8} width={68} height={14} rx={7} />
            <text x={m.x} y={m.y + 3} textAnchor="middle" className="tiny mono">
              {s.count} · {clockLabel(s.last).slice(2)}
            </text>
          </g>
        );
      })}
    </g>
  );
}
