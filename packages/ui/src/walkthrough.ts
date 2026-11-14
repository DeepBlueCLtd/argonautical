/**
 * WALK-1..5: the opening walkthrough. One region ("world") at a time, then one component at a time,
 * in the order data flows. Each step spotlights a rectangle of the diagram (viewBox coordinates).
 */
import { CONSUMER_SLOT, NODE_RECTS, OPS_STATIC, PROCESS_RECTS, SHORE_ZONE, TOKEN_KEY_P, ZONE_BANDS, consumerRectP } from './diagram/physical.ts';
import { CONSUMER_AREA, CONTROL, RECTS, REGIONS, TOKEN_KEY, VIEW, consumerRect, type Rect } from './diagram/layout.ts';

export interface WalkStep {
  readonly id: string;
  /** "World", "Component" …: shown above the title. */
  readonly kind: 'Overview' | 'Region' | 'Component' | 'Key' | 'Start';
  readonly title: string;
  readonly body: string;
  /** What to spotlight; undefined spotlights nothing (the whole diagram stays visible). */
  readonly rect?: (consumers: number) => Rect;
}

const pad = (r: Rect, p = 8): Rect => ({ x: r.x - p, y: r.y - p, w: r.w + 2 * p, h: r.h + 2 * p });
const R = RECTS;

export const WALKTHROUGH: readonly WalkStep[] = [
  {
    id: 'intro',
    kind: 'Overview',
    title: 'An ocean forecast, end to end',
    body: 'Readings from a ship’s sensors flow through a pipeline that produces a forecast, finds features in it and tells the apps on board. Everything here is simulated: synthetic data, illustrative numbers, mocked engines. The simulation is paused. This walkthrough introduces the controls and the three regions, then each component in the order data flows.',
  },
  {
    id: 'control',
    kind: 'Overview',
    title: 'Control',
    body: 'Run or pause (also Space), the simulated clock, and the speed: ½× is the default so each step can be followed. Step advances one second and leaves its tokens part-way so you can click them. + Consumer adds an onboard app; ? reopens this walkthrough; the list icon opens the event log. Capabilities grow the system: add a feature detector, or move to 48 h forecasts. Each takes effect from the next run, and the consumers adapt.',
    rect: () => pad(CONTROL, 4),
  },
  // ---- regions ----
  {
    id: 'world',
    kind: 'Region',
    title: 'World',
    body: 'The sea and the ship’s instruments. Nobody in the project builds these. In the demo, the teal Scenario controls play the sea: “+5σ front” in Ocean moves an input away from the forecast, and − / + in Sensors adds noise.',
    rect: () => ({ x: 0, y: CONTROL.y + CONTROL.h + 6, w: REGIONS.worldRight, h: VIEW.h - CONTROL.y - CONTROL.h - 6 }),
  },
  {
    id: 'system',
    kind: 'Region',
    title: 'System',
    body: 'The pipeline itself. Solid blue boxes are our own code (build); dashed boxes are off-the-shelf products (adopt), mocked here. The big dashed frame is the orchestrator, which runs the forecast steps.',
    rect: () => ({ x: REGIONS.worldRight, y: 0, w: REGIONS.consumersLeft - REGIONS.worldRight, h: VIEW.h }),
  },
  {
    id: 'consumers',
    kind: 'Region',
    title: 'Onboard consumers',
    body: 'Apps aboard the ship that use the forecast. They are told when a new one is ready, fetch what they need and check it arrived intact (✓ or ✗).',
    rect: () => ({ x: REGIONS.consumersLeft, y: 0, w: VIEW.w - REGIONS.consumersLeft, h: VIEW.h }),
  },
  // ---- components, in data-flow order ----
  { id: 'ocean', kind: 'Component', title: 'Ocean', body: 'The true state of the sea at the ship, shown as how far each input sits from its long-term mean (in σ). Only the simulation knows these values.', rect: () => pad(R.ocean) },
  { id: 'sensors', kind: 'Component', title: 'Sensors', body: 'One reading per input per second: the true value plus instrument noise. Each reading is sent as a SensorThings Observation.', rect: () => pad(R.sensors) },
  { id: 'sensorBroker', kind: 'Component', title: 'Sensor broker', body: 'An off-the-shelf MQTT broker with a persistent queue. Readings wait here until ingestion has stored them, so if ingestion or the database stops, nothing is lost: a “queued” tab shows the backlog.', rect: () => pad(R.sensorBroker) },
  { id: 'ingestion', kind: 'Component', title: 'Ingestion', body: 'Our code. It validates each reading and writes it to the Observations DB. It is not orchestrated: it runs continuously. The ⏸ button stops it, to show the broker buffering.', rect: () => pad(R.ingestion) },
  { id: 'observationsDb', kind: 'Component', title: 'Observations DB', body: 'Our data store of every validated reading, and the orchestrator’s source asset: it straddles the orchestrator frame because the pipeline reads from it but does not produce it. ⏸ stops it.', rect: () => pad(R.observationsDb) },
  { id: 'orchestrator', kind: 'Component', title: 'Orchestrator', body: 'Off-the-shelf (Dagster in production, mocked here). It decides when to run, runs the steps in dependency order and retries failures. One run at a time. Our code plugs in through thin “shim” strips.', rect: () => pad(REGIONS.orchestrator, 4) },
  { id: 'driftSensor', kind: 'Component', title: 'Drift sensor', body: 'Every 10 s it calls our drift monitor, which compares the latest observations with the current forecast. If enough inputs stay out of range for long enough, it asks for a new run. The violet Operator steppers along its bottom set how far is out of range (threshold), how many inputs (quorum) and for how many checks (persistence). The document icons show what it needs; hover them.', rect: () => pad(R.driftSensor) },
  { id: 'stalenessSchedule', kind: 'Component', title: 'Staleness schedule', body: 'The second trigger: when the forecast is more than 180 s old, it asks for a replacement, drift or no drift. The ring counts down.', rect: () => pad(R.stalenessSchedule) },
  { id: 'manualRequest', kind: 'Component', title: 'Manual request', body: 'The third trigger: the ship’s operator can ask for a run at any time. Requests that arrive during a run are queued and merged.', rect: () => pad(R.manualRequest) },
  { id: 'climatology', kind: 'Component', title: 'climatology', body: 'An asset: the long-term mean of each input. The model falls back on it when there is no previous forecast.', rect: () => pad(R.climatology) },
  { id: 'forecast', kind: 'Component', title: 'forecast', body: 'An asset, produced by our model runner. It reads climatology, the previous forecast and recent observations (the icons), then nudges the previous forecast towards the observations. Green while it is being saved.', rect: () => pad(R.forecast) },
  { id: 'features', kind: 'Component', title: 'features', body: 'An asset, produced by our feature detector from the new forecast: fronts and eddies. The demo starts without a feature detector, so this step is greyed out and runs skip it. Switch it on under Capabilities: from the next run, features are detected after the forecast is saved (a green pulse shows that release).', rect: () => pad(R.features) },
  { id: 'announcement', kind: 'Component', title: 'announcement', body: 'The last step. Once features are saved, our announcer publishes the forecast’s id, validity, digest and feature count, so consumers can check what they fetch.', rect: () => pad(R.announcement) },
  { id: 'privateStore', kind: 'Component', title: 'Private store', body: 'The orchestrator’s own bookkeeping: run history, the schedule and the drift sensor’s state. Nothing else reads it.', rect: () => pad(R.privateStore) },
  { id: 'netcdfStore', kind: 'Component', title: 'NetCDF store', body: 'Our store of gridded data: climatology and every forecast, as NetCDF files.', rect: () => pad(R.netcdfStore) },
  { id: 'featuresDb', kind: 'Component', title: 'Features DB', body: 'Our PostGIS database of detected features.', rect: () => pad(R.featuresDb) },
  { id: 'pygeoapi', kind: 'Component', title: 'pygeoapi', body: 'Off-the-shelf and read-only: the only way anyone reads data. It speaks open standards (SensorThings, OGC API-EDR, OGC API-Features) and queries the stores on the caller’s behalf. Each read is a round trip of four tokens. Its card lists its catalogue (/collections): what it offers now, and what changes from the next run.', rect: () => pad(R.pygeoapi) },
  { id: 'broker', kind: 'Component', title: 'Broker', body: 'Off-the-shelf publish/subscribe, by topic: forecast, features and catalogue (the card shows how many subscribe to each). It delivers only to a topic’s subscribers and keeps the latest announcement, so a late subscriber catches up at once. Announcements only say what is new; consumers fetch the data from pygeoapi.', rect: () => pad(R.broker) },
  {
    id: 'consumerCards',
    kind: 'Component',
    title: 'Consumers',
    body: 'Each consumer first asks pygeoapi what it offers (GET /collections), then subscribes to the topics it will use, and does so again whenever the catalogue changes. Its badge says what it can do with what is offered: a chart display is LOW RES without features and HI RES with them; a passage planner works to 12 h, or 48 h once long-range forecasts arrive; a basic display just shows the forecast. Reconfigure stands for its user changing what the app shows.',
    rect: (n) => {
      const first = consumerRect(0);
      const last = consumerRect(Math.max(0, Math.min(n, CONSUMER_AREA.max) - 1));
      return pad({ x: first.x, y: first.y, w: first.w, h: last.y + last.h - first.y });
    },
  },
  { id: 'tokenKey', kind: 'Key', title: 'Tokens', body: 'Each moving document is one interaction; its letter and colour give the standard of what it carries. Hover a token to see what it is; pause and click it for the full data.', rect: () => pad(TOKEN_KEY, 4) },
  {
    id: 'start',
    kind: 'Start',
    title: 'Ready',
    body: 'Start the simulation. The first forecast is produced in its first ten simulated seconds. Try the ⏸ buttons, the Scenario and Operator controls, or Step to go one second at a time.',
  },
];

// ---- Physical view (SYS-1): started only from the Walkthrough button, never on its own ----


const N = NODE_RECTS;
const band = (z: keyof typeof ZONE_BANDS): Rect => ({ x: ZONE_BANDS[z].x0, y: 0, w: ZONE_BANDS[z].x1 - ZONE_BANDS[z].x0, h: VIEW.h });

export const PHYSICAL_WALKTHROUGH: readonly WalkStep[] = [
  {
    id: 'p-intro',
    kind: 'Overview',
    title: 'The same system, where it would run',
    body: 'This is the physical view: the same running simulation, drawn on a candidate production deployment (docs/c4-model.md). Nothing here changes the simulation; switch back to the logical view at any time. The machines are logical nodes: they may share hardware, and their sizing is still to be measured.',
  },
  { id: 'p-ot', kind: 'Region', title: 'Instrument network (OT)', body: 'The ship’s operational-technology network. It accepts no traffic from the rest of the system: data only leaves it, through a firewall, when ingestion writes to the Observations DB.', rect: () => ({ ...band('ot'), y: CONTROL.y + CONTROL.h + 6, h: VIEW.h - CONTROL.y - CONTROL.h - 6 }) },
  { id: 'p-enclave', kind: 'Region', title: 'Processing enclave', body: 'Where the pipeline runs: the orchestration, compute, data and ops nodes. Nothing outside reaches in; the enclave calls out to the distribution zone and to shore.', rect: () => band('proc') },
  { id: 'p-dmz', kind: 'Region', title: 'Distribution zone', body: 'The only place the mission network can reach: pygeoapi, the broker and the run-request API.', rect: () => band('dmz') },
  { id: 'p-mission', kind: 'Region', title: 'Mission network', body: 'The watchkeeper’s workstation and the onboard consumer systems. They never reach the enclave directly.', rect: () => band('mission') },
  { id: 'p-gates', kind: 'Component', title: 'Firewall gates', body: 'Each FW box is a firewall where a network link crosses a zone boundary. It lights up while a document passes through it.', rect: () => pad({ x: 1030, y: 14, w: 20, h: 560 }, 4) },
  { id: 'p-orch', kind: 'Component', title: 'Orchestration node', body: 'Dagster’s processes. The daemon evaluates the sensors and the schedule; the code location holds the assets, the shims and our in-process modules. One process: the import boundary between our code and Dagster is not a process boundary.', rect: () => pad(N.orch, 4) },
  { id: 'p-daemon', kind: 'Component', title: 'Daemon', body: 'The drift sensor, the staleness schedule and the run-request sensor, which polls the run-request API every 5 s for the watchkeeper’s requests.', rect: () => pad(PROCESS_RECTS.daemon, 4) },
  { id: 'p-code', kind: 'Component', title: 'Code location', body: 'One row per asset: the asset, its shim, and the module of ours it calls. The run shim’s call leaves through the Dagster Pipes client for the compute node.', rect: () => pad(PROCESS_RECTS.codeLocation, 4) },
  { id: 'p-compute', kind: 'Component', title: 'Compute node', body: 'The model runner runs in its own process, launched through Dagster Pipes. Its ⏸ takes it offline: the node turns red and the run shim retries.', rect: () => pad(N.compute, 4) },
  { id: 'p-data', kind: 'Component', title: 'Data node · click a store', body: 'The Observations DB, the NetCDF store and the Features DB. Click any store (⌕) to open the inspector: it shows the contents in their native form and updates live while the simulation runs. Esc closes it.', rect: () => pad(N.data, 4) },
  { id: 'p-ops', kind: 'Component', title: 'Ops node', body: 'The shore sync agent moves files between the shore link and the transfer area, and writes nothing else. Registry, observability, backup and time sync are drawn but not simulated.', rect: () => pad(N.ops, 4) },
  { id: 'p-shore', kind: 'Component', title: 'Shore', body: 'Off ship, over an intermittent satcom link (up for 60 s in every 180 s here). Climatology updates wait on shore and export bundles wait in the outbox until the link is up.', rect: () => pad({ x: SHORE_ZONE.x, y: OPS_STATIC.terminal.y, w: SHORE_ZONE.w, h: SHORE_ZONE.y + SHORE_ZONE.h - OPS_STATIC.terminal.y }, 4) },
  { id: 'p-dist', kind: 'Component', title: 'Distribution host', body: 'pygeoapi is the only read path, for our modules and the consumers alike. The broker keeps the latest announcement (click it to inspect). The run-request API takes the watchkeeper’s requests.', rect: () => pad(N.dist, 4) },
  {
    id: 'p-consumers',
    kind: 'Component',
    title: 'Watchkeeper and consumers',
    body: 'The mission network’s side. Consumers subscribe to the broker and query pygeoapi; the watchkeeper requests runs through the run-request API.',
    rect: (n) => {
      const last = consumerRectP(Math.max(0, Math.min(n, CONSUMER_SLOT.max) - 1));
      return pad({ x: N.wk.x, y: N.wk.y, w: N.wk.w, h: last.y + last.h - N.wk.y + 12 }, 4);
    },
  },
  { id: 'p-key', kind: 'Key', title: 'Tokens', body: 'The same documents as in the logical view, routed along the network links. Hover one to see what it carries; pause and click it for the full data.', rect: () => pad(TOKEN_KEY_P, 4) },
  { id: 'p-start', kind: 'Start', title: 'Ready', body: 'Run the simulation and watch documents cross the zones. Try ⏸ on the model runner, or open a store.' },
];
