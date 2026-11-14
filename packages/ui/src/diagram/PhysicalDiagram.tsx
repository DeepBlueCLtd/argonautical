/**
 * The physical view (SYS-1–9): the same running simulation drawn on the candidate production
 * deployment (docs/c4-model.md §6.1). A projection of the same token records: it never alters the
 * simulation. Stores open the live inspector (SYS-8).
 */
import { EDGES, STANDARDS, type Snapshot } from '@argonautical/sim';
import { useMemo, type ReactNode } from 'react';
import type { Runner } from '../runner.ts';
import { Box, ControlPanel, DocToken, Module, PlayPause, QueueTab, Shim, Store, T, Tokens, type Controls, type Picked, type TokenTip } from './Diagram.tsx';
import { pathD, pointAt, VIEW, type Pt, type Rect } from './layout.ts';
import { ALL_GATES, CONSUMER_SLOT, LINK_GEOM, NODE_RECTS, OPS_STATIC, PIPES_CHIP, PROCESS_RECTS, P_RECTS, SHORE_ZONE, TOKEN_KEY_P, ZONE_BANDS, consumerRectP, routePhysical } from './physical.ts';

/** What the inspector can open (SYS-8). */
export type InspectId = 'observationsDb' | 'netcdfStore' | 'featuresDb' | 'sensorBroker' | 'broker' | 'privateStore' | 'transferArea';

const MATERIALISING_TICKS = 3;
const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.max(0, Math.floor(s % 60))).padStart(2, '0')}`;

const ZONE_LABELS = { ot: 'INSTRUMENT NETWORK (OT)', proc: 'PROCESSING ENCLAVE', dmz: 'DISTRIBUTION ZONE', mission: 'MISSION NETWORK' } as const;
const NODE_LABELS: Record<keyof typeof NODE_RECTS, string> = {
  daq: 'DAQ gateways · vendor hardware',
  ingest: 'Ingestion host',
  orch: 'Orchestration node',
  compute: 'Compute node',
  data: 'Data node',
  ops: 'Ops node',
  dist: 'Distribution host',
  wk: 'Watchkeeper workstation',
  mission: 'Consumer hosts',
  shore: '',
};

export function PhysicalDiagram(props: { snap: Snapshot; runner: Runner; onPick: (p: Picked) => void; onTokenTip: (t: TokenTip | null) => void; controls: Controls; spotlight?: Rect | null; inspecting: InspectId | null; onInspect: (id: InspectId) => void }) {
  const { snap, runner, onPick, onTokenTip, controls, spotlight, inspecting, onInspect } = props;
  const consumerIds = snap.consumers.map((c) => c.id);
  const routes = useMemo(() => routePhysical(EDGES, consumerIds), [consumerIds.join(',')]);
  const byKey = useMemo(() => new Map(routes.map((r) => [r.key, r])), [routes]);
  const loop = byKey.get('forecast>lineage>forecast')?.points ?? [];
  const R = P_RECTS;
  const t = snap.tick;
  const recently = (m: number | undefined) => m !== undefined && t - m < MATERIALISING_TICKS;
  const mat = (a: keyof Snapshot['assets']) => (recently(snap.assets[a]) ? 'materialising' : '');
  const run = snap.run;
  const retryOn = (step: 'run' | 'detect') => (run && run.step === step && run.retryIn !== undefined ? run.retryIn : undefined);
  const busy = (step: 'run' | 'detect') => !!run && run.step === step && run.retryIn === undefined;

  // A gate lights while a token is passing through it (SYS-2).
  const lit = new Set<number>();
  for (const { v, p } of runner.tokens) {
    const tk = v.token;
    const k = tk.instance && tk.edge.includes('consumer') ? `${tk.edge}#${tk.instance}` : tk.edge;
    const pts = byKey.get(k)?.points;
    if (!pts || tk.signal) continue;
    const at = pointAt(pts, tk.reverse ? 1 - p : p);
    ALL_GATES.forEach((g, i) => Math.hypot(g.at.x - at.x, g.at.y - at.y) < 14 && lit.add(i));
  }

  const nodeState = {
    compute: snap.offline.modelRunner ? 'offline' : '',
    ingest: snap.ingestion.running ? '' : 'offline',
    data: snap.stores.observationsUp ? '' : 'degraded',
  } as Record<string, string>;

  const inspectable = (id: InspectId, r: Rect, children: ReactNode, ours = true) => (
    <g
      className={`inspectable-store ${inspecting === id ? 'inspecting' : ''}`}
      role="button"
      tabIndex={0}
      aria-label={`Inspect ${id}`}
      onClick={() => onInspect(id)}
      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && onInspect(id)}
    >
      <title>Click to inspect its contents</title>
      <Store r={r} ours={ours}>
        {children}
      </Store>
      <text x={r.x + r.w - 8} y={r.y + 16} textAnchor="end" className="inspect-glyph">
        ⌕
      </text>
    </g>
  );

  return (
    <svg className="diagram physical" viewBox={`0 0 ${VIEW.w} ${VIEW.h}`} preserveAspectRatio="xMidYMid meet" role="img" aria-label="Forecast pipeline physical view">
      <defs>
        <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M0,0 L10,5 L0,10 z" className="arrowhead" />
        </marker>
        <marker id="arrow-release" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5.5" markerHeight="5.5" orient="auto-start-reverse">
          <path d="M0,0 L10,5 L0,10 z" className="arrowhead release" />
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

      {/* Zones, left to right (SYS-3) */}
      <g className="zones">
        {(Object.keys(ZONE_BANDS) as (keyof typeof ZONE_BANDS)[]).map((z, i) => {
          const b = ZONE_BANDS[z];
          return (
            <g key={z}>
              <rect className={`zone-band z${i % 2}`} x={b.x0} y={0} width={b.x1 - b.x0} height={VIEW.h} />
              {i > 0 && <line className="boundary" x1={b.x0} y1={0} x2={b.x0} y2={VIEW.h} />}
              <T x={(b.x0 + b.x1) / 2} y={z === 'ot' ? 834 : 14} cls="region-label" anchor="middle">
                {ZONE_LABELS[z]}
              </T>
            </g>
          );
        })}
        <rect className="zone-shore" x={SHORE_ZONE.x} y={SHORE_ZONE.y} width={SHORE_ZONE.w} height={SHORE_ZONE.h} rx={8} />
        <T x={SHORE_ZONE.x + 12} y={SHORE_ZONE.y + 18} cls="region-label">
          SHORE · OFF SHIP
        </T>
        <T x={SHORE_ZONE.x + 12} y={SHORE_ZONE.y + 34} cls="tiny muted">
          over an intermittent satcom link (SHR-1)
        </T>
      </g>

      {/* Nodes */}
      <g className="nodes">
        {(Object.keys(NODE_RECTS) as (keyof typeof NODE_RECTS)[])
          .filter((n) => n !== 'shore')
          .map((n) => {
            const r = NODE_RECTS[n];
            return (
              <g key={n} className={`node ${nodeState[n] ?? ''}`} filter={nodeState[n] === 'offline' ? 'url(#offline-halo)' : undefined}>
                <rect x={r.x} y={r.y} width={r.w} height={r.h} rx={6} />
                <T x={r.x + 6} y={r.y - 4} cls="node-label">
                  {NODE_LABELS[n]}
                  {nodeState[n] === 'offline' ? ' · OFFLINE' : ''}
                </T>
              </g>
            );
          })}
        <g className="process">
          <rect x={PROCESS_RECTS.daemon.x} y={PROCESS_RECTS.daemon.y} width={PROCESS_RECTS.daemon.w} height={PROCESS_RECTS.daemon.h} rx={4} />
          <T x={PROCESS_RECTS.daemon.x + 8} y={PROCESS_RECTS.daemon.y + 14} cls="tiny process-label">
            dagster-daemon · sensors, schedules, run queue
          </T>
          <rect x={PROCESS_RECTS.codeLocation.x} y={PROCESS_RECTS.codeLocation.y} width={PROCESS_RECTS.codeLocation.w} height={PROCESS_RECTS.codeLocation.h} rx={4} />
          <T x={PROCESS_RECTS.codeLocation.x + 8} y={PROCESS_RECTS.codeLocation.y + 16} cls="tiny process-label">
            code-location process · assets · shims · our in-process modules
          </T>
          <T x={PROCESS_RECTS.codeLocation.x + 8} y={PROCESS_RECTS.codeLocation.y + PROCESS_RECTS.codeLocation.h - 6} cls="tiny muted">
            one process: the import boundary is not a process boundary
          </T>
        </g>
      </g>

      {/* Network links; firewall gates where they cross a zone boundary */}
      <g className="links">
        {Object.entries(LINK_GEOM).map(([k, g]) => (
          <path key={k} className={`link ${k === 'ops|shore' ? `satcom ${snap.shore.linkUp ? 'up' : 'down'}` : ''}`} d={pathD(g.pts)} />
        ))}
        {routes
          .filter((r) => !r.edge.logical)
          .map((r) => (
            <path key={r.key} className="track" d={pathD(r.points)} />
          ))}
      </g>

      <ControlPanel snap={snap} runner={runner} controls={controls} />

      {/* OT */}
      <Box r={R.ocean} style="world">
        <T x={R.ocean.x + 8} y={R.ocean.y + 15} cls="small title-sm">
          Sea
        </T>
        <T x={R.ocean.x + 8} y={R.ocean.y + 29} cls="tiny muted">
          not a network
        </T>
      </Box>
      <Box r={R.sensors} style="ours">
        <T x={R.sensors.x + 8} y={R.sensors.y + 17} cls="small title-sm">
          DAQ gateway
        </T>
        <T x={R.sensors.x + 8} y={R.sensors.y + 33} cls="tiny muted">
          {snap.inputs.length} instruments · MQTT
        </T>
        <T x={R.sensors.x + 8} y={R.sensors.y + 48} cls="tiny muted">
          SensorThings adapter (ours)
        </T>
      </Box>
      {inspectable(
        'sensorBroker',
        R.sensorBroker,
        <>
          <T x={R.sensorBroker.x + 10} y={R.sensorBroker.y + 20} cls="small title-sm">
            Sensor broker
          </T>
          <T x={R.sensorBroker.x + 10} y={R.sensorBroker.y + 36} cls="tiny muted">
            Mosquitto · QoS 1 queue
          </T>
          <T x={R.sensorBroker.x + 10} y={R.sensorBroker.y + 60} cls="small mono">
            {snap.sensorBroker.queued} queued
          </T>
        </>,
        false,
      )}
      {snap.sensorBroker.queued > snap.inputs.length && <QueueTab x={R.sensorBroker.x + R.sensorBroker.w - 100} edgeY={R.sensorBroker.y + R.sensorBroker.h + 20} w={92} label={`${snap.sensorBroker.queued} queued`} />}
      <g filter={snap.ingestion.running ? undefined : 'url(#offline-halo)'}>
        <Box r={R.ingestion} style="ours" cls={snap.ingestion.running ? '' : 'stopped'}>
          <T x={R.ingestion.x + 30} y={R.ingestion.y + 20} cls="small title-sm">
            Ingestion service
          </T>
          <T x={R.ingestion.x + 10} y={R.ingestion.y + 38} cls="tiny muted">
            ioos_qc · not orchestrated
          </T>
          <T x={R.ingestion.x + 10} y={R.ingestion.y + 58} cls="small">
            accepted {snap.ingestion.accepted} · rejected {snap.ingestion.rejected}
          </T>
          <T x={R.ingestion.x + 10} y={R.ingestion.y + 78} cls={`small ${snap.ingestion.status === 'running' ? 'muted' : 'offline-label'}`}>
            {snap.ingestion.status}
          </T>
        </Box>
      </g>
      <PlayPause at={{ x: R.ingestion.x + 16, y: R.ingestion.y + 15 }} running={snap.ingestion.running} what="ingestion" onToggle={() => runner.apply({ type: 'ingestion', running: !snap.ingestion.running })} />

      {/* Orchestration node */}
      <g className="static-part">
        <rect x={284} y={50} width={120} height={30} rx={3} />
        <T x={290} y={62} cls="tiny">
          Dagster webserver
        </T>
        <T x={290} y={74} cls="tiny">
          not simulated
        </T>
      </g>
      {inspectable(
        'privateStore',
        R.privateStore,
        <>
          <T x={R.privateStore.x + 8} y={R.privateStore.y + 18} cls="tiny title-sm">
            Metadata DB
          </T>
          <T x={R.privateStore.x + 8} y={R.privateStore.y + 34} cls="tiny mono">
            {snap.privateStore.runs} runs
          </T>
        </>,
        false,
      )}
      <Chip r={R.driftSensor} cls="ots" title="drift sensor" sub={`every ${snap.drift.interval} s · next ${snap.drift.nextCheckIn}s`} />
      <Chip r={R.stalenessSchedule} cls="ots" title="staleness" sub={snap.forecast ? `stale in ${mmss(snap.schedule.staleIn)}` : 'no forecast yet'} />
      <Chip r={R.manualRequest} cls="ots" title="run-request sensor" sub={snap.runRequests.pending ? `${snap.runRequests.pending} pending · poll ${snap.runRequests.nextPollIn}s` : 'polls the API · 5 s'} />

      {/* Code location rows: asset · shim · module */}
      <Chip r={{ ...R.climatology, x: 292, y: R.shimCheck.y }} cls="ots" title="drift sensor" sub="(a sensor)" />
      <Shim r={R.shimCheck} name="check" />
      <Module r={R.driftMonitor} name="Drift monitor" offline={snap.offline.driftMonitor}>
        <T x={R.driftMonitor.x + 8} y={R.driftMonitor.y + 29} cls="tiny muted">
          {snap.drift.status}
        </T>
      </Module>

      <Chip r={R.climatology} cls={`asset ${mat('climatology')}`} title="climatology" sub={`v${snap.shore.climatologyVersion}`} />
      <Shim r={R.shimImport} name="import" />
      <Module r={R.climatologyImporter} name="Climatology importer" offline={false}>
        <T x={R.climatologyImporter.x + 8} y={R.climatologyImporter.y + 29} cls="tiny muted">
          {snap.shore.inbox ? `${snap.shore.inbox} in inbox` : 'inbox empty'}
        </T>
      </Module>

      <Chip r={R.forecast} cls={`asset ${mat('forecast')}`} title="forecast" sub={snap.forecast ? `${snap.forecast.id} · ${snap.forecast.cause}` : 'none yet'} />
      <Shim r={R.shimRun} name="run" retryIn={retryOn('run')} />
      <Chip r={PIPES_CHIP} cls="ots" title="Dagster Pipes client" sub="launches the model runner →" />

      <Chip r={R.features} cls={`asset ${mat('features')} ${snap.capabilities.featureDetector ? '' : 'absent'}`} title="features" sub={snap.capabilities.featureDetector ? `${snap.stores.features} stored` : 'no detector'} />
      <Shim r={R.shimDetect} name="detect" retryIn={retryOn('detect')} />
      <Module r={R.featureDetector} name="Feature detector" offline={snap.offline.featureDetector} running={busy('detect')}>
        <T x={R.featureDetector.x + 8} y={R.featureDetector.y + 29} cls="tiny muted">
          {busy('detect') ? run!.label || 'detecting' : snap.capabilities.featureDetector ? 'idle' : 'absent'}
        </T>
      </Module>
      <PlayPause at={{ x: R.featureDetector.x + R.featureDetector.w - 12, y: R.featureDetector.y + 12 }} running={!snap.offline.featureDetector} what="the feature detector (take it offline)" onToggle={() => runner.apply({ type: 'offline', module: 'featureDetector', offline: !snap.offline.featureDetector })} />

      <Chip r={R.announcement} cls={`asset ${mat('announcement')}`} title="announcement" sub="" />
      <Shim r={R.shimAnnounce} name="announce" />
      <Module r={R.announcer} name="Announcer" offline={false}>
        <T x={R.announcer.x + 8} y={R.announcer.y + 29} cls="tiny muted">
          publishes to the broker
        </T>
      </Module>

      <Chip r={R.shoreExport} cls={`asset ${mat('shoreExport')}`} title="shore_export" sub="every 120 s" />
      <Shim r={R.shimExport} name="export" />
      <Module r={R.shoreExporter} name="Shore exporter" offline={false}>
        <T x={R.shoreExporter.x + 8} y={R.shoreExporter.y + 29} cls="tiny muted">
          reads via pygeoapi → outbox
        </T>
      </Module>

      {/* Compute node */}
      <Module r={R.modelRunner} name="Model runner" offline={snap.offline.modelRunner} running={busy('run')}>
        <T x={R.modelRunner.x + 8} y={R.modelRunner.y + 34} cls="tiny muted">
          own process (Pipes)
        </T>
        <T x={R.modelRunner.x + 8} y={R.modelRunner.y + 54} cls="tiny">
          {busy('run') ? run!.label || 'running' : retryOn('run') !== undefined ? 'waiting for retry' : 'idle'}
        </T>
      </Module>
      <PlayPause at={{ x: R.modelRunner.x + R.modelRunner.w - 12, y: R.modelRunner.y + 12 }} running={!snap.offline.modelRunner} what="the model runner (take it offline)" onToggle={() => runner.apply({ type: 'offline', module: 'modelRunner', offline: !snap.offline.modelRunner })} />

      {/* Data node: stores, each opens the inspector */}
      <g filter={snap.stores.observationsUp ? undefined : 'url(#offline-halo)'}>
        {inspectable(
          'observationsDb',
          R.observationsDb,
          <>
            <T x={R.observationsDb.x + 30} y={R.observationsDb.y + 22} cls="small title-sm">
              Observations DB
            </T>
            <T x={R.observationsDb.x + 12} y={R.observationsDb.y + 40} cls="tiny muted">
              Postgres + Timescale
            </T>
            <T x={R.observationsDb.x + 12} y={R.observationsDb.y + 53} cls="tiny muted">
              SensorThings schema
            </T>
            <T x={R.observationsDb.x + 12} y={R.observationsDb.y + 74} cls="small mono">
              {snap.stores.observations} rows
            </T>
            <T x={R.observationsDb.x + 12} y={R.observationsDb.y + 94} cls={`tiny ${snap.stores.observationsUp ? 'muted' : 'offline-label'}`}>
              {snap.stores.observationsUp ? 'accepting writes' : 'STOPPED'}
            </T>
          </>,
        )}
      </g>
      <PlayPause at={{ x: R.observationsDb.x + 18, y: R.observationsDb.y + 17 }} running={snap.stores.observationsUp} what="the Observations DB" onToggle={() => runner.apply({ type: 'observationsDb', up: !snap.stores.observationsUp })} />
      <g className={recently(snap.assets.forecast) || recently(snap.assets.climatology) ? 'store-mat' : ''}>
        {inspectable(
          'netcdfStore',
          R.netcdfStore,
          <>
            <T x={R.netcdfStore.x + 12} y={R.netcdfStore.y + 22} cls="small title-sm">
              NetCDF store
            </T>
            <T x={R.netcdfStore.x + 12} y={R.netcdfStore.y + 40} cls="tiny muted">
              NetCDF / Zarr on a filesystem
            </T>
            <T x={R.netcdfStore.x + 12} y={R.netcdfStore.y + 66} cls="small mono">
              {snap.stores.coverageFiles} files · clim v{snap.shore.climatologyVersion}
            </T>
          </>,
        )}
      </g>
      <g className={recently(snap.assets.features) ? 'store-mat' : ''}>
        {inspectable(
          'featuresDb',
          R.featuresDb,
          <>
            <T x={R.featuresDb.x + 12} y={R.featuresDb.y + 22} cls="small title-sm">
              Features DB
            </T>
            <T x={R.featuresDb.x + 12} y={R.featuresDb.y + 40} cls="tiny muted">
              PostGIS
            </T>
            <T x={R.featuresDb.x + 12} y={R.featuresDb.y + 66} cls="small mono">
              {snap.stores.features} rows
            </T>
          </>,
        )}
      </g>

      {/* Ops node */}
      <Box r={R.shoreSync} style="ours">
        <T x={R.shoreSync.x + 8} y={R.shoreSync.y + 15} cls="tiny title-sm">
          Shore sync agent
        </T>
        <T x={R.shoreSync.x + 8} y={R.shoreSync.y + 28} cls="tiny muted">
          moves files only
        </T>
      </Box>
      <g className={recently(snap.assets.shoreExport) ? 'store-mat' : ''}>
        {inspectable(
          'transferArea',
          R.transferArea,
          <>
            <T x={R.transferArea.x + 8} y={R.transferArea.y + 17} cls="tiny title-sm">
              Transfer area
            </T>
            <T x={R.transferArea.x + 8} y={R.transferArea.y + 32} cls="tiny mono">
              in {snap.shore.inbox} · out {snap.shore.outbox}
            </T>
          </>,
          false,
        )}
      </g>
      {(['registry', 'observability', 'backup'] as const).map((k) => (
        <g key={k} className="static-part">
          <rect x={OPS_STATIC[k].x} y={OPS_STATIC[k].y} width={OPS_STATIC[k].w} height={OPS_STATIC[k].h} rx={3} />
          <T x={OPS_STATIC[k].x + 6} y={OPS_STATIC[k].y + 12} cls="tiny">
            {k === 'registry' ? 'Registry · N, N-1' : k === 'observability' ? 'Observability' : 'Backup · nightly'}
          </T>
          <T x={OPS_STATIC[k].x + 6} y={OPS_STATIC[k].y + 25} cls="tiny muted">
            not simulated
          </T>
        </g>
      ))}
      <g className={`terminal ${snap.shore.linkUp ? 'up' : 'down'}`}>
        <rect x={OPS_STATIC.terminal.x} y={OPS_STATIC.terminal.y} width={OPS_STATIC.terminal.w} height={OPS_STATIC.terminal.h} rx={3} />
        <T x={OPS_STATIC.terminal.x + 6} y={OPS_STATIC.terminal.y + 14} cls="tiny title-sm">
          Satcom
        </T>
        <T x={OPS_STATIC.terminal.x + 6} y={OPS_STATIC.terminal.y + 28} cls={`tiny ${snap.shore.linkUp ? '' : 'offline-label'}`}>
          link {snap.shore.linkUp ? 'up' : 'down'}
        </T>
        <T x={OPS_STATIC.terminal.x + 6} y={OPS_STATIC.terminal.y + 40} cls="tiny muted">
          {snap.shore.linkUp ? 'down' : 'up'} in {mmss(snap.shore.linkChangeIn)}
        </T>
      </g>
      <g className="static-part">
        <rect x={OPS_STATIC.time.x} y={OPS_STATIC.time.y} width={OPS_STATIC.time.w} height={OPS_STATIC.time.h} rx={3} />
        <T x={OPS_STATIC.time.x + 6} y={OPS_STATIC.time.y + 13} cls="tiny">
          Time (GNSS)
        </T>
        <T x={OPS_STATIC.time.x + 6} y={OPS_STATIC.time.y + 27} cls="tiny muted">
          NTP/PTP · zones
        </T>
        <T x={OPS_STATIC.time.x + 6} y={OPS_STATIC.time.y + 41} cls="tiny muted">
          not simulated
        </T>
      </g>

      {/* Distribution host */}
      <Box r={R.pygeoapi} style="ots">
        <T x={R.pygeoapi.x + 10} y={R.pygeoapi.y + 20} cls="small title-sm">
          pygeoapi
        </T>
        <T x={R.pygeoapi.x + 10} y={R.pygeoapi.y + 36} cls="tiny muted">
          read only · OGC APIs
        </T>
        {snap.catalogue.map((c, i) => (
          <T key={c.id} x={R.pygeoapi.x + 10} y={R.pygeoapi.y + 58 + i * 14} cls="tiny">
            {c.id}
            {c.status === 'available' ? '' : ` (${c.status})`}
          </T>
        ))}
      </Box>
      {inspectable(
        'broker',
        R.broker,
        <>
          <T x={R.broker.x + 10} y={R.broker.y + 20} cls="small title-sm">
            Broker
          </T>
          <T x={R.broker.x + 10} y={R.broker.y + 36} cls="tiny muted">
            Mosquitto · retained
          </T>
          {Object.entries(snap.topics).map(([topic, n], i) => (
            <T key={topic} x={R.broker.x + 10} y={R.broker.y + 58 + i * 14} cls="tiny mono">
              {topic} ×{n}
            </T>
          ))}
        </>,
        false,
      )}
      <Box r={R.runRequestApi} style="ours">
        <T x={R.runRequestApi.x + 10} y={R.runRequestApi.y + 20} cls="small title-sm">
          Run-request API
        </T>
        <T x={R.runRequestApi.x + 10} y={R.runRequestApi.y + 36} cls="tiny muted">
          ours · polled from the enclave
        </T>
        <T x={R.runRequestApi.x + 10} y={R.runRequestApi.y + 54} cls="tiny mono">
          {snap.runRequests.pending} pending · {snap.runRequests.total} total
        </T>
      </Box>

      {/* Mission network */}
      <Box r={R.watchkeeper} style="world">
        <T x={R.watchkeeper.x + 10} y={R.watchkeeper.y + 19} cls="small title-sm">
          Watchkeeper
        </T>
        <T x={R.watchkeeper.x + 10} y={R.watchkeeper.y + 35} cls="tiny muted">
          requests runs through the run-request API
        </T>
      </Box>
      {snap.consumers.slice(0, CONSUMER_SLOT.max).map((c, i) => {
        const r = consumerRectP(i);
        return (
          <Box key={c.id} r={r} style="world">
            <T x={r.x + 10} y={r.y + 20} cls="small title-sm">
              {c.id} · {c.profile}
            </T>
            <T x={r.x + 10} y={r.y + 40} cls="tiny">
              {c.status}
            </T>
            <T x={r.x + 10} y={r.y + 58} cls="tiny mono">
              {c.latest ? `${c.latest.forecastId} ${c.latest.ok ? '✓' : '✗'}` : 'no data'}
            </T>
            <T x={r.x + 10} y={r.y + 76} cls="tiny muted">
              subs: {c.topics.map((x) => x.split('/')[0]).join(', ')}
            </T>
          </Box>
        );
      })}
      {snap.consumers.length > CONSUMER_SLOT.max && (
        <T x={CONSUMER_SLOT.x} y={consumerRectP(CONSUMER_SLOT.max).y - 2} cls="small muted">
          +{snap.consumers.length - CONSUMER_SLOT.max} more
        </T>
      )}

      {/* Shore */}
      <Box r={R.shore} style="world">
        <T x={R.shore.x + 10} y={R.shore.y + 20} cls="small title-sm">
          Shore support
        </T>
        <T x={R.shore.x + 10} y={R.shore.y + 38} cls="tiny muted">
          {snap.shore.waiting ? `climatology waiting: ${snap.shore.waiting}` : 'nothing waiting to send'}
        </T>
        <T x={R.shore.x + 10} y={R.shore.y + 54} cls="tiny muted">
          bundles received: {snap.shore.received}
        </T>
      </Box>

      {/* Gates */}
      <g className="gates">
        {ALL_GATES.map((g, i) => (
          <g key={i} className={`gate ${lit.has(i) ? 'lit' : ''}`}>
            <title>{g.label ?? 'firewall'}</title>
            <rect x={g.at.x - 7} y={g.at.y - 9} width={14} height={18} rx={2} />
            <text x={g.at.x} y={g.at.y + 3} textAnchor="middle" className="gate-text">
              FW
            </text>
          </g>
        ))}
      </g>

      {/* Compact token key */}
      <g className="token-key" aria-label="Token key">
        <rect x={TOKEN_KEY_P.x} y={TOKEN_KEY_P.y} width={TOKEN_KEY_P.w} height={TOKEN_KEY_P.h} rx={6} />
        <T x={TOKEN_KEY_P.x + 12} y={TOKEN_KEY_P.y + 20} cls="small title-sm">
          Token key · letter = standard of the content
        </T>
        {Object.entries(STANDARDS).map(([code, name], i) => {
          const x = TOKEN_KEY_P.x + 18 + (i % 2) * 146;
          const y = TOKEN_KEY_P.y + 40 + Math.floor(i / 2) * 22;
          return (
            <g key={code}>
              <DocToken x={x} y={y} size={1.2} letter={code} cls="token" />
              <T x={x + 14} y={y + 4} cls="tiny">
                {name}
              </T>
            </g>
          );
        })}
      </g>

      <Tokens runner={runner} byKey={byKey} loop={loop as Pt[]} onPick={onPick} onTokenTip={onTokenTip} />

      {/* The physical walkthrough dims everything but the current zone or part. */}
      {spotlight !== undefined && (
        <g className="spotlight">
          <path className="dim" fillRule="evenodd" d={`M0,0 H${VIEW.w} V${VIEW.h} H0 Z${spotlight ? ` M${spotlight.x},${spotlight.y} v${spotlight.h} h${spotlight.w} v${-spotlight.h} Z` : ''}`} />
          {spotlight && <rect className="ring" x={spotlight.x} y={spotlight.y} width={spotlight.w} height={spotlight.h} rx={8} />}
        </g>
      )}
    </svg>
  );
}

function Chip({ r, cls, title, sub }: { r: Rect; cls: string; title: string; sub: string }) {
  return (
    <g className={`chip ${cls}`}>
      <rect x={r.x} y={r.y} width={r.w} height={r.h} rx={cls.startsWith('asset') ? 8 : 3} />
      <text x={r.x + 7} y={r.y + 14} className="tiny title-sm chip-title">
        {title}
      </text>
      <text x={r.x + 7} y={r.y + 27} className="tiny muted">
        {sub}
      </text>
    </g>
  );
}
