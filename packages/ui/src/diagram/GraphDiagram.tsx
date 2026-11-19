/**
 * The artefacts view (issue #34; `View` id 'graph'), the default view: the same running simulation drawn as the orchestrator's dependency
 * graph. The flow starts with the ocean and ingestion, then shows only Dagster's own wiring
 * (triggers, asset lineage, shim calls) and the announcer's broadcast to the consumers. Reads,
 * writes and the sensor broker's messages are left out, and so are their tokens. Presentation
 * only: it never alters the simulation (SYS-1).
 */
import { EDGES, STANDARDS, clockLabel, windowsLabel, type Snapshot } from '@argonautical/sim';
import { useMemo } from 'react';
import { topicShort, type Runner } from '../runner.ts';
import { Box, ControlPanel, DocToken, EdgePath, ExecLine, SvgButton, useExecState, Inspectable, Module, OceanCard, OperatorControls, PlayPause, ResidualBars, Ring, SensorsCard, Shim, Store, T, Tokens, measurementTopicRows, type Controls, type InspectId, type Picked, type TokenTip } from './Diagram.tsx';
import { G_CONSUMERS, G_KEY, G_NOTE, G_RECTS, G_REGIONS, consumerRectG, forecastLoopG, oceanLine, routeGraph } from './graph.ts';
import { pathD, VIEW, type Rect } from './layout.ts';

const MATERIALISING_TICKS = 3;
const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.max(0, Math.floor(s % 60))).padStart(2, '0')}`;
/** Token letters this view can show: Dagster, MQTT announcement, JSON (subscribe). */
const KEY_CODES = ['S', 'Q', 'D', 'M', 'J'] as const;

export function GraphDiagram(props: { snap: Snapshot; runner: Runner; onPick: (p: Picked) => void; onTokenTip: (t: TokenTip | null) => void; controls: Controls; spotlight?: Rect | null; inspecting: InspectId | null; onInspect: (id: InspectId) => void }) {
  const { snap, runner, onPick, onTokenTip, controls, spotlight, inspecting, onInspect } = props;
  const consumerIds = snap.consumers.map((c) => c.id);
  const routes = useMemo(() => routeGraph(EDGES, consumerIds), [consumerIds.join(',')]);
  const byKey = useMemo(() => new Map(routes.map((r) => [r.key, r])), [routes]);
  const loop = useMemo(() => forecastLoopG(), []);
  const ocean = useMemo(() => oceanLine(), []);
  const R = G_RECTS as Required<typeof G_RECTS>;
  const t = snap.tick;
  const mat = (a: keyof Snapshot['assets']) => {
    const m = snap.assets[a];
    return m !== undefined && t - m < MATERIALISING_TICKS ? 'materialising' : '';
  };
  // Issue #35: a triggered run shows only once its RunRequest has landed. Timers as in the logical view.
  const { run, retryOn, reading, executing, retrieving, execLabel, shownProgress } = useExecState(snap, runner);
  const busy = (step: 'run' | 'detect') => !!executing(step) || reading(step) || runner.readsPending(step === 'run' ? 'modelRunner' : 'featureDetector');
  const f = snap.forecast;
  // Staleness countdown (ORC-1, MOT-3): smooth between ticks, as in the logical view.
  const staleRemaining = f ? Math.max(0, snap.schedule.staleIn - (snap.schedule.staleIn > 0 ? runner.frac : 0)) : 0;
  const replacing = !!run && f !== undefined && snap.schedule.staleIn === 0;
  const detector = snap.capabilities.featureDetector;
  const F = G_REGIONS.frame;

  return (
    <svg className="diagram graph" viewBox={`0 0 ${VIEW.w} ${VIEW.h}`} preserveAspectRatio="xMidYMid meet" role="img" aria-label="Forecast pipeline dependency graph">
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

      {/* Regions */}
      <g className="regions">
        <rect className="region world" x={0} y={0} width={G_REGIONS.worldRight} height={VIEW.h} />
        <rect className="region consumers" x={G_REGIONS.consumersLeft} y={0} width={VIEW.w - G_REGIONS.consumersLeft} height={VIEW.h} />
        <line className="boundary" x1={G_REGIONS.worldRight} y1={0} x2={G_REGIONS.worldRight} y2={VIEW.h} />
        <line className="boundary" x1={G_REGIONS.consumersLeft} y1={0} x2={G_REGIONS.consumersLeft} y2={VIEW.h} />
        <T x={G_REGIONS.worldRight / 2} y={273} cls="region-label" anchor="middle">
          WORLD
        </T>
        <T x={(G_REGIONS.worldRight + G_REGIONS.consumersLeft) / 2} y={24} cls="region-label" anchor="middle">
          SYSTEM
        </T>
        <T x={(G_REGIONS.consumersLeft + VIEW.w) / 2} y={34} cls="region-label" anchor="middle">
          CONSUMERS
        </T>
      </g>

      <Box r={F} style="ots" cls="orchestrator-frame">
        <T x={F.x + 14} y={F.y + 22} cls="frame-title">
          Orchestrator · dependency graph
        </T>
        <T x={F.x + 290} y={F.y + 22} cls="muted small">
          what Dagster knows: triggers, lineage, shim calls
        </T>
      </Box>

      {/* Ocean → sensors: what the instruments measure, not a message */}
      <path className="edge feed" d={pathD(ocean)} markerEnd="url(#arrow)" />

      {/* Edges */}
      <g className="edges">
        {routes.map((r) => (
          <EdgePath key={r.key} r={r} />
        ))}
        <path className="edge lineage" d={pathD(loop)} markerEnd="url(#arrow-heavy)" />
      </g>

      <ControlPanel snap={snap} runner={runner} controls={controls} />

      {/* World */}
      <OceanCard r={R.ocean} snap={snap} runner={runner} />
      <SensorsCard r={R.sensors} snap={snap} runner={runner} />
      <g filter={snap.ingestion.running ? undefined : 'url(#offline-halo)'}>
        <Box r={R.ingestion} style="ours" cls={snap.ingestion.running ? '' : 'stopped'}>
          <T x={R.ingestion.x + 32} y={R.ingestion.y + 22} cls="title">
            Ingestion
          </T>
          <T x={R.ingestion.x + 10} y={R.ingestion.y + 40} cls="tiny muted">
            not orchestrated
          </T>
          <T x={R.ingestion.x + 10} y={R.ingestion.y + 62} cls="small">
            accepted {snap.ingestion.accepted}
          </T>
          <T x={R.ingestion.x + 10} y={R.ingestion.y + 80} cls={`tiny ${snap.ingestion.status === 'running' ? 'muted' : 'offline-label'}`}>
            {snap.ingestion.status}
          </T>
        </Box>
      </g>
      <PlayPause at={{ x: R.ingestion.x + 18, y: R.ingestion.y + 17 }} running={snap.ingestion.running} what="ingestion" onToggle={() => runner.apply({ type: 'ingestion', running: !snap.ingestion.running })} />

      {/* Sensor broker: the persistent queue between the instruments and ingestion */}
      <Inspectable id="sensorBroker" r={R.sensorBroker} active={inspecting === 'sensorBroker'} onInspect={onInspect}>
        <Box r={R.sensorBroker} style="ots">
          <T x={R.sensorBroker.x + 10} y={R.sensorBroker.y + 20} cls="title">
            Sensor broker
          </T>
          <T x={R.sensorBroker.x + 10} y={R.sensorBroker.y + 37} cls="tiny muted">
            persistent queue · QoS 1
          </T>
          <T x={R.sensorBroker.x + 10} y={R.sensorBroker.y + 58} cls={`small mono ${snap.sensorBroker.queued > snap.inputs.length ? 'strong' : ''}`}>
            {snap.sensorBroker.queued} queued
          </T>
        </Box>
      </Inspectable>

      {/* Run requests: the watchkeeper → the run-request API, polled by the run-request sensor */}
      <Box r={R.runRequestApi} style="ours">
        <T x={R.runRequestApi.x + 8} y={R.runRequestApi.y + 18} cls="small title-sm">
          Run-request API
        </T>
        <T x={R.runRequestApi.x + 8} y={R.runRequestApi.y + 33} cls="tiny muted">
          distribution zone
        </T>
        <T x={R.runRequestApi.x + 8} y={R.runRequestApi.y + 52} cls="tiny mono">
          {snap.runRequests.pending} pending
        </T>
        <T x={R.runRequestApi.x + 8} y={R.runRequestApi.y + 66} cls="tiny mono">
          {snap.runRequests.total} total
        </T>
      </Box>
      <Box r={R.watchkeeper} style="world">
        <T x={R.watchkeeper.x + 8} y={R.watchkeeper.y + 18} cls="small title-sm">
          Watchkeeper
        </T>
        <SvgButton x={R.watchkeeper.x + 8} y={R.watchkeeper.y + 28} w={R.watchkeeper.w - 16} label="Request a run" title="Watchkeeper: request a forecast run (through the run-request API)" cls="operator" onClick={() => runner.apply({ type: 'requestRun' })} />
      </Box>

      {/* Source asset: the Observations DB */}
      <Inspectable id="observationsDb" r={R.observationsDb} active={inspecting === 'observationsDb'} onInspect={onInspect}>
        <Store r={R.observationsDb}>
          <T x={R.observationsDb.x + 12} y={R.observationsDb.y + 24} cls="asset-title">
            observations
          </T>
          <T x={R.observationsDb.x + 12} y={R.observationsDb.y + 42} cls="tiny muted">
            source asset · Observations DB
          </T>
          <T x={R.observationsDb.x + 12} y={R.observationsDb.y + 64} cls="small mono">
            {snap.stores.observations} rows
          </T>
          <T x={R.observationsDb.x + 12} y={R.observationsDb.y + 80} cls={`tiny ${snap.stores.observationsUp ? 'muted' : 'offline-label'}`}>
            {snap.stores.observationsUp ? 'a dependency, never a trigger' : 'STOPPED'}
          </T>
        </Store>
      </Inspectable>

      {/* Triggers */}
      <Box r={R.driftSensor} style="ots">
        <T x={R.driftSensor.x + 32} y={R.driftSensor.y + 20} cls="title">
          Drift sensor
        </T>
        <T x={R.driftSensor.x + 140} y={R.driftSensor.y + 20} cls="tiny muted">
          every {snap.drift.interval} s
        </T>
        <Ring cx={R.driftSensor.x + R.driftSensor.w - 20} cy={R.driftSensor.y + 18} r={11} frac={1 - (snap.drift.nextCheckIn - runner.frac) / snap.drift.interval} label={`${snap.drift.nextCheckIn}s`} />
      </Box>
      <PlayPause at={{ x: R.driftSensor.x + 18, y: R.driftSensor.y + 16 }} running={!snap.offline.driftMonitor} what="the drift monitor (checks fail, no drift runs)" onToggle={() => runner.apply({ type: 'offline', module: 'driftMonitor', offline: !snap.offline.driftMonitor })} />
      <Shim r={R.shimCheck} name="check" />
      <g filter={snap.offline.driftMonitor ? 'url(#offline-halo)' : undefined}>
        <Box r={R.driftMonitor} style="ours" cls={snap.offline.driftMonitor ? 'stopped' : runner.readsPending('driftMonitor') ? 'running' : ''}>
          <T x={R.driftMonitor.x + 8} y={R.driftMonitor.y + 16} cls="title small-title">
            Drift monitor
          </T>
          <ResidualBars r={R.driftMonitor} snap={snap} arrived={!runner.readsPending('driftMonitor')} />
          <T x={R.driftMonitor.x + 8} y={R.driftMonitor.y + R.driftMonitor.h - 8} cls={`small status ${snap.drift.status.startsWith('drift') ? 'alert' : ''}`}>
            {snap.drift.status}
          </T>
        </Box>
      </g>
      <OperatorControls snap={snap} runner={runner} sensor={R.driftSensor} monitor={R.driftMonitor} top={R.shimCheck.y} />
      <Box r={R.stalenessSchedule} style="ots">
        <T x={R.stalenessSchedule.x + 12} y={R.stalenessSchedule.y + 22} cls="title">
          Staleness schedule
        </T>
        <T x={R.stalenessSchedule.x + 12} y={R.stalenessSchedule.y + 42} cls="tiny muted">
          replaces a forecast
        </T>
        <T x={R.stalenessSchedule.x + 12} y={R.stalenessSchedule.y + 55} cls="tiny muted">
          older than {snap.schedule.staleAfter} s
        </T>
        <T x={R.stalenessSchedule.x + 12} y={R.stalenessSchedule.y + 78} cls="tiny">
          {!f ? 'no forecast yet' : staleRemaining > 0 ? 'stale in' : replacing ? 'stale · replacing' : 'stale'}
        </T>
        <Ring
          cx={R.stalenessSchedule.x + R.stalenessSchedule.w - 32}
          cy={R.stalenessSchedule.y + 56}
          r={21}
          frac={f ? 1 - staleRemaining / snap.schedule.staleAfter : 0}
          label={f ? mmss(snap.schedule.staleIn) : '—'}
          cls="stale-ring"
        />
      </Box>
      <Box r={R.manualRequest} style="ots">
        <T x={R.manualRequest.x + 12} y={R.manualRequest.y + 22} cls="title">
          Manual request
        </T>
        <T x={R.manualRequest.x + 12} y={R.manualRequest.y + 42} cls="tiny muted">
          run-request sensor
        </T>
        <T x={R.manualRequest.x + 12} y={R.manualRequest.y + 55} cls="tiny muted">
          polls the run-request API
        </T>
        <T x={R.manualRequest.x + 12} y={R.manualRequest.y + 78} cls="small">
          {snap.runRequests.pending ? `${snap.runRequests.pending} pending` : 'nothing queued'}
        </T>
      </Box>

      {/* Assets */}
      <Box r={R.climatology} style="asset" cls={mat('climatology')}>
        <T x={R.climatology.x + 12} y={R.climatology.y + 24} cls="asset-title">
          climatology
        </T>
        <T x={R.climatology.x + 12} y={R.climatology.y + 42} cls="tiny muted">
          v{snap.shore.climatologyVersion} · from shore
        </T>
      </Box>
      <Shim r={R.shimImport} name="import" />
      <Module r={R.climatologyImporter} name="Climatology importer" offline={false}>
        <T x={R.climatologyImporter.x + 8} y={R.climatologyImporter.y + 38} cls="tiny muted">
          {snap.shore.inbox ? `${snap.shore.inbox} in inbox` : 'inbox empty'}
        </T>
      </Module>

      <Box r={R.forecast} style="asset" cls={mat('forecast')}>
        <T x={R.forecast.x + 36} y={R.forecast.y + 24} cls="asset-title">
          forecast
        </T>
        <T x={R.forecast.x + 12} y={R.forecast.y + 44} cls="small">
          {f ? `${f.id} · ${f.cause} · ${windowsLabel(f.windows)}` : 'none yet'}
        </T>
        <T x={R.forecast.x + 12} y={R.forecast.y + 60} cls="tiny loop-label">
          ↻ background = previous forecast{snap.background ? ` (${snap.background.id})` : ''}
        </T>
        <T x={R.forecast.x + 12} y={R.forecast.y + R.forecast.h - 30} cls="tiny muted">
          {run ? `${run.id} → ${run.forecastId} · ${run.causes}` : snap.queued ? `queued: ${snap.queued}` : 'no run under way'}
        </T>
        <T x={R.forecast.x + 12} y={R.forecast.y + R.forecast.h - 14} cls="tiny muted">
          {snap.assets.forecast !== undefined ? `materialised ${clockLabel(snap.assets.forecast)}` : ''}
        </T>
      </Box>
      <PlayPause at={{ x: R.forecast.x + 20, y: R.forecast.y + 19 }} running={!snap.offline.modelRunner} what="the model runner (every run fails until resumed)" onToggle={() => runner.apply({ type: 'offline', module: 'modelRunner', offline: !snap.offline.modelRunner })} />
      <Shim r={R.shimRun} name="run" retryIn={retryOn('run')} />
      <Module r={R.modelRunner} name="Model runner" offline={snap.offline.modelRunner} running={busy('run')}>
        <ExecLine r={R.modelRunner} label={execLabel('run')} frac={shownProgress('run', 8)} active={!!executing('run') && !retrieving('run')} />
        {retryOn('run') !== undefined && run?.lastFailure && (
          <T x={R.modelRunner.x + 8} y={R.modelRunner.y + 58} cls="tiny muted">
            {run.lastFailure}
          </T>
        )}
      </Module>

      <Box r={R.features} style="asset" cls={`${mat('features')} ${detector ? '' : 'absent'}`}>
        <T x={R.features.x + 36} y={R.features.y + 24} cls="asset-title">
          features
        </T>
        <T x={R.features.x + 12} y={R.features.y + 44} cls="small">
          {detector ? `${snap.stores.features} stored` : 'no detector installed'}
        </T>
        <T x={R.features.x + 12} y={R.features.y + R.features.h - 30} cls="tiny waiting">
          {run && run.step === 'run' ? `waiting for forecast ${run.forecastId}` : ''}
        </T>
        <T x={R.features.x + 12} y={R.features.y + R.features.h - 14} cls="tiny muted">
          {snap.assets.features !== undefined ? `materialised ${clockLabel(snap.assets.features)}` : ''}
        </T>
      </Box>
      {detector && <PlayPause at={{ x: R.features.x + 20, y: R.features.y + 19 }} running={!snap.offline.featureDetector} what="the feature detector (detection fails until resumed)" onToggle={() => runner.apply({ type: 'offline', module: 'featureDetector', offline: !snap.offline.featureDetector })} />}
      <g className={detector ? '' : 'absent-part'}>
        <Shim r={R.shimDetect} name="detect" retryIn={retryOn('detect')} />
        <Module r={R.featureDetector} name="Feature detector" offline={snap.offline.featureDetector} running={busy('detect')}>
          {detector ? (
            <ExecLine r={R.featureDetector} label={execLabel('detect')} frac={shownProgress('detect', 5)} active={!!executing('detect') && !retrieving('detect')} />
          ) : (
            <T x={R.featureDetector.x + 8} y={R.featureDetector.y + 40} cls="tiny">
              absent
            </T>
          )}
        </Module>
      </g>

      <Box r={R.announcement} style="asset" cls={mat('announcement')}>
        <T x={R.announcement.x + 10} y={R.announcement.y + 24} cls="asset-title">
          announcement
        </T>
        <T x={R.announcement.x + 10} y={R.announcement.y + R.announcement.h - 30} cls="tiny waiting">
          {run && (run.step === 'run' || run.step === 'detect') ? 'waiting for features' : ''}
        </T>
        <T x={R.announcement.x + 10} y={R.announcement.y + R.announcement.h - 14} cls="tiny muted">
          {snap.assets.announcement !== undefined ? `materialised ${clockLabel(snap.assets.announcement)}` : ''}
        </T>
      </Box>
      <Shim r={R.shimAnnounce} name="announce" />
      <Module r={R.announcer} name="Announcer" offline={false}>
        <T x={R.announcer.x + 8} y={R.announcer.y + 40} cls="tiny muted">
          publishes to
        </T>
        <T x={R.announcer.x + 8} y={R.announcer.y + 54} cls="tiny muted">
          the broker
        </T>
      </Module>

      <Box r={R.shoreExport} style="asset" cls={mat('shoreExport')}>
        <T x={R.shoreExport.x + 12} y={R.shoreExport.y + 24} cls="asset-title">
          shore_export
        </T>
        <T x={R.shoreExport.x + 12} y={R.shoreExport.y + 42} cls="tiny muted">
          scheduled · every 120 s · next {mmss(snap.shore.nextExportIn)}
        </T>
      </Box>
      <Shim r={R.shimExport} name="export" />
      <Module r={R.shoreExporter} name="Shore exporter" offline={false}>
        <T x={R.shoreExporter.x + 8} y={R.shoreExporter.y + 38} cls="tiny muted">
          bundles new data for shore
        </T>
      </Module>

      {/* Pub-sub broadcast */}
      <Inspectable id="broker" r={R.broker} active={inspecting === 'broker'} onInspect={onInspect}>
        <Box r={R.broker} style="ots">
          <T x={R.broker.x + 10} y={R.broker.y + 20} cls="title">
            Broker
          </T>
          <T x={R.broker.x + 10} y={R.broker.y + 36} cls="tiny muted">
            pub-sub
          </T>
          {(['forecast/new', 'features/new'] as const).map((topic, i) => (
            <T key={topic} x={R.broker.x + 10} y={R.broker.y + 56 + i * 13} cls="tiny mono">
              {topicShort(topic)} ×{snap.topics[topic] ?? 0}
            </T>
          ))}
          {measurementTopicRows(snap.topics, 2).slice(0, 1).map((row, i) => (
            <T key={i} x={R.broker.x + 10} y={R.broker.y + 82 + i * 13} cls="tiny mono">
              {row}
            </T>
          ))}
        </Box>
      </Inspectable>

      {snap.consumers.slice(0, G_CONSUMERS.max).map((c, i) => {
        const r = consumerRectG(i);
        return (
          <Box key={c.id} r={r} style="world">
            <T x={r.x + 8} y={r.y + 18} cls="small title-sm">
              {c.id} · {c.profile}
            </T>
            <T x={r.x + 8} y={r.y + 36} cls="tiny">
              {c.status}
            </T>
            <T x={r.x + 8} y={r.y + 54} cls="tiny mono">
              {c.latest ? `${c.latest.forecastId} ${c.latest.ok ? '✓' : '✗'}` : 'no data'}
            </T>
            <T x={r.x + 8} y={r.y + 72} cls="tiny muted">
              subs: {c.topics.map(topicShort).join(', ')}
            </T>
          </Box>
        );
      })}
      {snap.consumers.length > G_CONSUMERS.max && (
        <T x={G_CONSUMERS.x} y={consumerRectG(G_CONSUMERS.max).y + 10} cls="small muted">
          +{snap.consumers.length - G_CONSUMERS.max} more
        </T>
      )}

      {/* What this view shows */}
      <g className="graph-note">
        <rect x={G_NOTE.x} y={G_NOTE.y} width={G_NOTE.w} height={G_NOTE.h} rx={6} />
        <T x={G_NOTE.x + 12} y={G_NOTE.y + 20} cls="small title-sm">
          This view
        </T>
        {[
          ['trigger', 'trigger: starts a run'],
          ['lineage', 'dependency (lineage)'],
          ['call', 'shim calls our module'],
          ['publish', 'message outside the orchestrator'],
          ['feed', 'ocean → sensors (measured)'],
        ].map(([k, label], i) => (
          <g key={k}>
            <path className={`edge ${k}`} d={`M${G_NOTE.x + 12},${G_NOTE.y + 40 + i * 20} h28`} />
            <T x={G_NOTE.x + 48} y={G_NOTE.y + 44 + i * 20} cls="tiny">
              {label}
            </T>
          </g>
        ))}
        <T x={G_NOTE.x + 12} y={G_NOTE.y + 152} cls="tiny muted">
          Hidden: pygeoapi reads, other writes,
        </T>
        <T x={G_NOTE.x + 12} y={G_NOTE.y + 166} cls="tiny muted">
          SUBSCRIBE. See the Logical view.
        </T>
      </g>

      <g className="token-key" aria-label="Token key">
        <rect x={G_KEY.x} y={G_KEY.y} width={G_KEY.w} height={G_KEY.h} rx={6} />
        <T x={G_KEY.x + 12} y={G_KEY.y + 20} cls="small title-sm">
          Tokens in this view
        </T>
        {KEY_CODES.map((code, i) => (
          <g key={code}>
            <DocToken x={G_KEY.x + 20 + Math.floor(i / 3) * 170} y={G_KEY.y + 42 + (i % 3) * 22} size={1.2} letter={code} cls="token" />
            <T x={G_KEY.x + 34 + Math.floor(i / 3) * 170} y={G_KEY.y + 46 + (i % 3) * 22} cls="tiny">
              {STANDARDS[code as keyof typeof STANDARDS]}
            </T>
          </g>
        ))}
        <T x={G_KEY.x + 12} y={G_KEY.y + 118} cls="tiny muted">
          Green sweep + flash: upstream materialised, next step released.
        </T>
        <T x={G_KEY.x + 12} y={G_KEY.y + 132} cls="tiny muted">
          Blue sweep + ✓: dependency checked at run start (never a trigger).
        </T>
      </g>

      {/* The consumers' SUBSCRIBE handshake is not an artefact message: hidden here. */}
      <Tokens runner={runner} byKey={byKey} loop={loop} onPick={onPick} onTokenTip={onTokenTip} show={(t) => t.edge !== 'consumer>subscribe>broker'} />

      {spotlight !== undefined && (
        <g className="spotlight">
          <path className="dim" fillRule="evenodd" d={`M0,0 H${VIEW.w} V${VIEW.h} H0 Z${spotlight ? ` M${spotlight.x},${spotlight.y} v${spotlight.h} h${spotlight.w} v${-spotlight.h} Z` : ''}`} />
          {spotlight && <rect className="ring" x={spotlight.x} y={spotlight.y} width={spotlight.w} height={spotlight.h} rx={8} />}
        </g>
      )}
    </svg>
  );
}
