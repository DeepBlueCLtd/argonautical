/**
 * Graph view geometry (issue #34): the orchestrator's dependency graph. It keeps the flow from the
 * ocean through ingestion into the `observations` source asset, then draws only what Dagster itself
 * knows about: triggers (sensors, schedule, run-request sensor), asset lineage, and each asset's shim
 * calling our module. Outside the orchestrator it shows the messages that feed or start it and
 * those its output sends: readings from the sensors through the sensor broker and ingestion into
 * observations, the watchkeeper's run requests through the run-request API, and the announcer's
 * broadcast through the broker to the consumers. Reads through pygeoapi, the other store writes and
 * the consumers' SUBSCRIBE handshake are not drawn, and their tokens are not shown.
 *
 * Geometry only (ARC-3): which edges exist still comes from the simulation's declared EDGES.
 */
import type { Edge, ElementId } from '@argonautical/sim';
import { orthogonalRoute, type Pt, type Rect, type Route } from './layout.ts';

/** Edge kinds Dagster knows about, plus the pub-sub broadcast to the consumers. */
const GRAPH_KINDS: ReadonlySet<Edge['kind']> = new Set(['lineage', 'trigger', 'call']);
/** Messages outside the orchestrator that feed it, start it, or carry its output away. */
export const EXTERNAL: ReadonlySet<string> = new Set([
  // Readings → the `observations` source asset
  'sensors>publish>sensorBroker',
  'sensorBroker>deliver>ingestion',
  'ingestion>write>observationsDb',
  // The watchkeeper's run requests, picked up by the run-request sensor
  'watchkeeper>send>runRequestApi',
  'manualRequest>query>runRequestApi',
  'manualRequest>send>runRequestApi',
  // The announcement's broadcast
  'announcer>publish>broker',
  'broker>deliver>consumer',
]);

/** Whether an edge (and its tokens) belongs to the graph view. */
export function inGraph(e: Edge): boolean {
  return GRAPH_KINDS.has(e.kind) || EXTERNAL.has(e.id);
}

export const G_REGIONS = {
  worldRight: 230,
  consumersLeft: 1440,
  frame: { x: 430, y: 40, w: 880, h: 780 },
} as const;

type GraphId = Exclude<ElementId, 'consumer'>;

export const G_RECTS: Partial<Record<GraphId, Rect>> = {
  ocean: { x: 20, y: 278, w: 190, h: 202 },
  sensors: { x: 20, y: 488, w: 190, h: 254 },
  ingestion: { x: 252, y: 300, w: 150, h: 110 },
  sensorBroker: { x: 252, y: 470, w: 150, h: 76 },
  // UI-8: the Observations DB is the `observations` source asset.
  observationsDb: { x: 452, y: 300, w: 196, h: 92 },
  // Triggers
  driftSensor: { x: 452, y: 84, w: 330, h: 196 },
  shimCheck: { x: 466, y: 112, w: 222, h: 20 },
  driftMonitor: { x: 466, y: 138, w: 222, h: 130 },
  stalenessSchedule: { x: 800, y: 84, w: 196, h: 96 },
  manualRequest: { x: 1014, y: 84, w: 180, h: 96 },
  // Assets
  climatology: { x: 452, y: 420, w: 196, h: 150 },
  shimImport: { x: 464, y: 470, w: 172, h: 20 },
  climatologyImporter: { x: 464, y: 496, w: 172, h: 62 },
  forecast: { x: 690, y: 300, w: 220, h: 270 },
  shimRun: { x: 702, y: 372, w: 196, h: 20 },
  modelRunner: { x: 702, y: 398, w: 196, h: 110 },
  features: { x: 956, y: 300, w: 176, h: 270 },
  shimDetect: { x: 968, y: 372, w: 152, h: 20 },
  featureDetector: { x: 968, y: 398, w: 152, h: 110 },
  announcement: { x: 1170, y: 300, w: 124, h: 270 },
  shimAnnounce: { x: 1178, y: 372, w: 108, h: 20 },
  announcer: { x: 1178, y: 398, w: 108, h: 92 },
  shoreExport: { x: 690, y: 640, w: 220, h: 150 },
  shimExport: { x: 702, y: 690, w: 196, h: 20 },
  shoreExporter: { x: 702, y: 716, w: 196, h: 62 },
  // Pub-sub broadcast: straddles the System | Consumers boundary.
  broker: { x: 1352, y: 330, w: 108, h: 104 },
  // Run requests: the API sits outside the orchestrator, the watchkeeper above the consumers.
  runRequestApi: { x: 1322, y: 92, w: 112, h: 80 },
  watchkeeper: { x: 1474, y: 52, w: 116, h: 58 },
};

/** What this view shows: a key card in the frame's empty lower-left corner. */
export const G_NOTE: Rect = { x: 452, y: 610, w: 210, h: 180 };
/** The Token key: lower right, under the consumers. */
export const G_KEY: Rect = { x: 940, y: 640, w: 354, h: 150 };

export const G_CONSUMERS = { x: 1474, y: 124, w: 116, h: 92, gap: 10, max: 6 } as const;
export const consumerRectG = (i: number): Rect => ({ x: G_CONSUMERS.x, y: G_CONSUMERS.y + i * (G_CONSUMERS.h + G_CONSUMERS.gap), w: G_CONSUMERS.w, h: G_CONSUMERS.h });

const rectOfG = (id: ElementId, i = 0): Rect | undefined => (id === 'consumer' ? consumerRectG(i) : G_RECTS[id]);

const cx = (r: Rect) => r.x + r.w / 2;
const cy = (r: Rect) => r.y + r.h / 2;

/** Hand routes where the generic orthogonal route reads badly. */
const CUSTOM: Record<string, (a: Rect, b: Rect) => Pt[]> = {
  // Lineage into forecast's left side, one row each.
  'observationsDb>lineage>forecast': (a, b) => [{ x: a.x + a.w, y: cy(a) }, { x: b.x, y: cy(a) }],
  'climatology>lineage>forecast': (a, b) => {
    const y = b.y + b.h - 70;
    return [{ x: a.x + a.w, y: a.y + 40 }, { x: 668, y: a.y + 40 }, { x: 668, y }, { x: b.x, y }];
  },
  'forecast>lineage>features': (a, b) => [{ x: a.x + a.w, y: a.y + 40 }, { x: b.x, y: b.y + 40 }],
  'features>lineage>announcement': (a, b) => [{ x: a.x + a.w, y: a.y + 40 }, { x: b.x, y: b.y + 40 }],
  // Under features, so it never crosses it.
  'forecast>lineage>announcement': (a, b) => {
    const y = 600;
    return [{ x: a.x + a.w - 30, y: a.y + a.h }, { x: a.x + a.w - 30, y }, { x: cx(b), y }, { x: cx(b), y: b.y + b.h }];
  },
  // Triggers into forecast's top, one landing point each.
  'driftSensor>trigger>forecast': (a, b) => {
    const x = b.x + 30;
    return [{ x: cx(a), y: a.y + a.h }, { x: cx(a), y: 288 }, { x, y: 288 }, { x, y: b.y }];
  },
  // The schedule's line runs above the manual request's, so the two never cross.
  'stalenessSchedule>trigger>forecast': (a, b) => {
    const x = b.x + 110;
    return [{ x: cx(a), y: a.y + a.h }, { x: cx(a), y: 236 }, { x, y: 236 }, { x, y: b.y }];
  },
  'manualRequest>trigger>forecast': (a, b) => {
    const x = b.x + 160;
    return [{ x: cx(a), y: a.y + a.h }, { x: cx(a), y: 256 }, { x, y: 256 }, { x, y: b.y }];
  },
  // Ingest: sensors → sensor broker → ingestion (up into its foot) → observations.
  'sensors>publish>sensorBroker': (a, b) => [{ x: a.x + a.w, y: b.y + 30 }, { x: b.x, y: b.y + 30 }],
  'sensorBroker>deliver>ingestion': (a, b) => [{ x: a.x + 40, y: a.y }, { x: a.x + 40, y: b.y + b.h }],
  'ingestion>write>observationsDb': (a, b) => [{ x: a.x + a.w, y: cy(b) }, { x: b.x, y: cy(b) }],
  // Run requests: the sensor's poll and its status post on two rows; the watchkeeper's request from the right.
  'manualRequest>query>runRequestApi': (a, b) => [{ x: a.x + a.w, y: b.y + 22 }, { x: b.x, y: b.y + 22 }],
  'manualRequest>send>runRequestApi': (a, b) => [{ x: a.x + a.w, y: b.y + 56 }, { x: b.x, y: b.y + 56 }],
  'watchkeeper>send>runRequestApi': (a, b) => [{ x: a.x, y: cy(a) }, { x: 1452, y: cy(a) }, { x: 1452, y: cy(b) }, { x: b.x + b.w, y: cy(b) }],
  // Announcer → broker: right, then along to the broker's left side.
  'announcer>publish>broker': (a, b) => {
    const y = cy(b);
    return [{ x: a.x + a.w, y: cy(a) }, { x: 1326, y: cy(a) }, { x: 1326, y }, { x: b.x, y }];
  },
  // Broker → consumer: a bus in the consumers region, one row per consumer.
  'broker>deliver>consumer': (a, b) => {
    const x = 1466;
    const y = cy(b);
    return [{ x: a.x + a.w, y: cy(a) }, { x, y: cy(a) }, { x, y }, { x: b.x, y }];
  },
};

/** Lay out the graph view's edges; edges outside the view get no route, so their tokens are not drawn. */
export function routeGraph(edges: readonly Edge[], consumers: readonly string[]): Route[] {
  const out: Route[] = [];
  for (const e of edges) {
    if (!inGraph(e) || e.from === e.to || e.kind === 'subscribe') continue;
    const instances = e.from === 'consumer' || e.to === 'consumer' ? consumers.slice(0, G_CONSUMERS.max).map((c, i) => ({ c, i })) : [{ c: undefined as string | undefined, i: 0 }];
    for (const { c, i } of instances) {
      const a = rectOfG(e.from, i);
      const b = rectOfG(e.to, i);
      if (!a || !b) continue;
      const custom = CUSTOM[e.id];
      // A shim calls the module straight below it.
      const points = custom ? custom(a, b) : e.kind === 'call' ? [{ x: a.x + 24, y: a.y + a.h }, { x: a.x + 24, y: b.y }] : orthogonalRoute(a, b);
      out.push({ key: c ? `${e.id}#${c}` : e.id, edge: e, instance: c, points });
    }
  }
  return out;
}

/** UI-10: the background loop on forecast (previous forecast feeds the next). */
export function forecastLoopG(): Pt[] {
  const r = G_RECTS.forecast!;
  const x1 = r.x + r.w - 40;
  return [
    { x: x1, y: r.y },
    { x: x1, y: r.y - 22 },
    { x: r.x + r.w + 18, y: r.y - 22 },
    { x: r.x + r.w + 18, y: r.y + 16 },
    { x: r.x + r.w, y: r.y + 16 },
  ];
}

/** Ocean → sensors: what the instruments measure (not a message; drawn without tokens). */
export function oceanLine(): Pt[] {
  const o = G_RECTS.ocean!;
  return [{ x: cx(o), y: o.y + o.h }, { x: cx(o), y: G_RECTS.sensors!.y }];
}
