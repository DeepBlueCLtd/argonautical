/**
 * WALK-1..5: the opening walkthrough. One region ("world") at a time, then one component at a time,
 * in the order data flows. Each step spotlights a rectangle of the diagram (viewBox coordinates).
 */
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
    body: 'Run or pause (also Space), the simulated clock, and the speed: ½× is the default so each step can be followed. Step advances one second and leaves its tokens part-way so you can click them. + Consumer adds an onboard app; ? reopens this walkthrough; the list icon opens the event log.',
    rect: () => pad(CONTROL, 4),
  },
  // ---- regions ----
  {
    id: 'world',
    kind: 'Region',
    title: 'World',
    body: 'The sea and the ship’s instruments. Nobody in the project builds these. In the demo, the Scenario controls play the sea: shift an input or add noise to make the ocean drift away from the forecast.',
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
  { id: 'driftSensor', kind: 'Component', title: 'Drift sensor', body: 'Every 10 s it calls our drift monitor, which compares the latest observations with the current forecast. If enough inputs stay out of range for long enough, it asks for a new run. The document icons show what it needs; hover them.', rect: () => pad(R.driftSensor) },
  { id: 'stalenessSchedule', kind: 'Component', title: 'Staleness schedule', body: 'The second trigger: when the forecast is more than 180 s old, it asks for a replacement, drift or no drift. The ring counts down.', rect: () => pad(R.stalenessSchedule) },
  { id: 'manualRequest', kind: 'Component', title: 'Manual request', body: 'The third trigger: the ship’s operator can ask for a run at any time. Requests that arrive during a run are queued and merged.', rect: () => pad(R.manualRequest) },
  { id: 'climatology', kind: 'Component', title: 'climatology', body: 'An asset: the long-term mean of each input. The model falls back on it when there is no previous forecast.', rect: () => pad(R.climatology) },
  { id: 'forecast', kind: 'Component', title: 'forecast', body: 'An asset, produced by our model runner. It reads climatology, the previous forecast and recent observations (the icons), then nudges the previous forecast towards the observations. Green while it is being saved.', rect: () => pad(R.forecast) },
  { id: 'features', kind: 'Component', title: 'features', body: 'An asset, produced by our feature detector from the new forecast: fronts and eddies. It waits until the forecast is saved; a green pulse on the dependency line shows that release.', rect: () => pad(R.features) },
  { id: 'announcement', kind: 'Component', title: 'announcement', body: 'The last step. Once features are saved, our announcer publishes the forecast’s id, validity, digest and feature count, so consumers can check what they fetch.', rect: () => pad(R.announcement) },
  { id: 'privateStore', kind: 'Component', title: 'Private store', body: 'The orchestrator’s own bookkeeping: run history, the schedule and the drift sensor’s state. Nothing else reads it.', rect: () => pad(R.privateStore) },
  { id: 'netcdfStore', kind: 'Component', title: 'NetCDF store', body: 'Our store of gridded data: climatology and every forecast, as NetCDF files.', rect: () => pad(R.netcdfStore) },
  { id: 'featuresDb', kind: 'Component', title: 'Features DB', body: 'Our PostGIS database of detected features.', rect: () => pad(R.featuresDb) },
  { id: 'pygeoapi', kind: 'Component', title: 'pygeoapi', body: 'Off-the-shelf and read-only: the only way anyone reads data. It speaks open standards (SensorThings, OGC API-EDR, OGC API-Features) and queries the stores on the caller’s behalf. Each read is a round trip of four tokens.', rect: () => pad(R.pygeoapi) },
  { id: 'broker', kind: 'Component', title: 'Broker', body: 'Off-the-shelf publish/subscribe. It delivers each announcement to the consumers that subscribed. Announcements only say what is new; consumers fetch the data from pygeoapi.', rect: () => pad(R.broker) },
  {
    id: 'consumerCards',
    kind: 'Component',
    title: 'Consumers',
    body: 'C1, C3… need the forecast and its features; C2, C4… need the forecast only. Reconfigure stands for a user changing what the app shows, which makes it query again. Add more with “Add consumer”.',
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
