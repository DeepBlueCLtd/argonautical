/**
 * Geometry only (ARC-3): rectangles per element. Wiring comes from the
 * simulation's declared EDGES; this file never decides what connects to what.
 * Coordinates are in a fixed viewBox; the SVG scales to the window (UI-6).
 */
import type { Edge, ElementId } from '@argonautical/sim';

export const VIEW = { w: 1600, h: 840 } as const;

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Region boundaries (UI-1). */
export const REGIONS = {
  worldRight: 230,
  consumersLeft: 1360,
  // Ends at x 1316, leaving a corridor (x 1316–1360) for the two lines up into the broker.
  orchestrator: { x: 470, y: 40, w: 846, h: 560 },
} as const;

export const RECTS: Record<Exclude<ElementId, 'consumer'>, Rect> = {
  // The top fifth of the World column is the presenter's Control panel (CONTROL below).
  ocean: { x: 20, y: 232, w: 190, h: 228 },
  sensors: { x: 20, y: 470, w: 190, h: 272 },
  ingestion: { x: 248, y: 430, w: 150, h: 130 },
  // Persistent queue between the DAQ gateway and ingestion (FLT-3).
  sensorBroker: { x: 252, y: 612, w: 162, h: 104 },
  // UI-8: straddles the orchestrator's left edge (x = 470).
  observationsDb: { x: 404, y: 270, w: 128, h: 120 },
  orchestrator: REGIONS.orchestrator,
  // Reaches left into the orchestrator's empty top-left corner: room for the operator's drift controls
  // in a column right of the drift monitor.
  driftSensor: { x: 486, y: 72, w: 324, h: 196 },
  shimCheck: { x: 500, y: 112, w: 222, h: 20 },
  driftMonitor: { x: 500, y: 138, w: 222, h: 120 },
  stalenessSchedule: { x: 830, y: 72, w: 180, h: 78 },
  manualRequest: { x: 830, y: 176, w: 180, h: 78 },
  privateStore: { x: 1160, y: 72, w: 138, h: 92 },
  climatology: { x: 548, y: 470, w: 140, h: 76 },
  forecast: { x: 720, y: 290, w: 215, h: 282 },
  shimRun: { x: 732, y: 368, w: 191, h: 20 },
  modelRunner: { x: 732, y: 394, w: 191, h: 120 },
  features: { x: 965, y: 290, w: 170, h: 282 },
  shimDetect: { x: 977, y: 368, w: 146, h: 20 },
  featureDetector: { x: 977, y: 394, w: 146, h: 120 },
  announcement: { x: 1160, y: 290, w: 140, h: 282 },
  shimAnnounce: { x: 1170, y: 368, w: 120, h: 20 },
  announcer: { x: 1170, y: 394, w: 120, h: 96 },
  netcdfStore: { x: 640, y: 668, w: 170, h: 88 },
  featuresDb: { x: 850, y: 668, w: 170, h: 88 },
  pygeoapi: { x: 1075, y: 652, w: 220, h: 120 },
  // Straddles the System | Consumers boundary (UI-1). Sits above the consumers so its deliveries
  // and the consumers' pygeoapi queries run along visibly different paths.
  broker: { x: 1308, y: 72, w: 104, h: 100 },
};

/** Presenter controls (§5.4): the top fifth of the World column. */
export const CONTROL: Rect = { x: 10, y: 8, w: 210, h: 196 };

export const CONSUMER_AREA = { x: 1430, y: 196, w: 160, cardH: 94, gap: 10, max: 3 } as const;

/** Token key, at the foot of the Onboard consumers column. */
export const TOKEN_KEY: Rect = { x: 1404, y: 540, w: 190, h: 292 };

export function consumerRect(index: number): Rect {
  const c = CONSUMER_AREA;
  return { x: c.x, y: c.y + index * (c.cardH + c.gap), w: c.w, h: c.cardH };
}

export function rectOf(id: ElementId, consumerIndex = 0): Rect {
  return id === 'consumer' ? consumerRect(consumerIndex) : RECTS[id];
}

type Side = 'left' | 'right' | 'top' | 'bottom';
export interface Pt {
  x: number;
  y: number;
}

/** Optional per-edge side hints where the default choice reads badly. `drop` sets the y of a bottom→bottom run. */
const HINTS: Record<string, { from: Side; to: Side; drop?: number }> = {
  'driftMonitor>query>pygeoapi': { from: 'right', to: 'top' },
  // Distinct rows below the assets (y 572) and the orchestrator frame (y 600), so the horizontals never stack.
  'modelRunner>write>netcdfStore': { from: 'bottom', to: 'top', drop: 640 },
  'featureDetector>write>featuresDb': { from: 'bottom', to: 'top', drop: 640 },
  'netcdfStore>read>pygeoapi': { from: 'bottom', to: 'bottom', drop: 792 },
  'observationsDb>lineage>forecast': { from: 'right', to: 'left' },
  'climatology>lineage>forecast': { from: 'right', to: 'left' },
  'forecast>lineage>features': { from: 'right', to: 'left' },
  'forecast>lineage>announcement': { from: 'bottom', to: 'bottom', drop: 586 },
  'features>lineage>announcement': { from: 'right', to: 'left' },
  'driftSensor>trigger>forecast': { from: 'bottom', to: 'top' },
  'manualRequest>trigger>forecast': { from: 'bottom', to: 'top' },
  'broker>deliver>consumer': { from: 'right', to: 'left' },
  'sensorBroker>deliver>ingestion': { from: 'top', to: 'bottom' },
};

function chooseSides(a: Rect, b: Rect): { from: Side; to: Side } {
  const dx = b.x + b.w / 2 - (a.x + a.w / 2);
  const dy = b.y + b.h / 2 - (a.y + a.h / 2);
  if (Math.abs(dx) > Math.abs(dy)) return dx > 0 ? { from: 'right', to: 'left' } : { from: 'left', to: 'right' };
  return dy > 0 ? { from: 'bottom', to: 'top' } : { from: 'top', to: 'bottom' };
}

function port(r: Rect, side: Side, t: number): Pt {
  switch (side) {
    case 'left':
      return { x: r.x, y: r.y + r.h * t };
    case 'right':
      return { x: r.x + r.w, y: r.y + r.h * t };
    case 'top':
      return { x: r.x + r.w * t, y: r.y };
    case 'bottom':
      return { x: r.x + r.w * t, y: r.y + r.h };
  }
}

const horizontal = (s: Side) => s === 'left' || s === 'right';

/** Hand-routed edges: a corridor the generic router would not find. */
const CUSTOM: Record<string, (a: Rect, b: Rect) => Pt[]> = {
  // Sensor broker → ingestion: straight up from the broker's left third, leaving room for its queue tab.
  'sensorBroker>deliver>ingestion': (a, b) => {
    const x = a.x + 44;
    return [{ x, y: a.y }, { x, y: b.y + b.h }];
  },
  // Staleness schedule → forecast: down the gap left of the schedule and manual-request cards, so it
  // never runs behind the Manual request card (which made it look like a second manual trigger).
  'stalenessSchedule>trigger>forecast': (a, b) => {
    const x = a.x - 11;
    const y = a.y + a.h / 2;
    return [{ x: a.x, y }, { x, y }, { x, y: b.y }];
  },
  // pygeoapi → broker: its deployment hook publishes catalogue changes (CAT-4), up the corridor
  // right of the orchestrator frame and into the broker from below.
  'pygeoapi>publish>broker': (a, b) => {
    const x = b.x + 40;
    const sx = a.x + a.w - 10;
    const y = 642;
    return [{ x: sx, y: a.y }, { x: sx, y }, { x, y }, { x, y: b.y + b.h }];
  },
  // Announcer → broker: out of the announcer's right side, then up into the broker from below,
  // clear of the orchestrator frame (x 1340) and the announcement card (x 1300).
  'announcer>publish>broker': (a, b) => {
    const x = b.x + 22;
    const y = a.y + a.h / 2;
    return [{ x: a.x + a.w, y }, { x, y }, { x, y: b.y + b.h }];
  },
  // Sensors → sensor broker: straight across the World | System line, never along it.
  'sensors>publish>sensorBroker': (a, b) => {
    const y = b.y + b.h / 2;
    return [{ x: a.x + a.w, y }, { x: b.x, y }];
  },
  // Ingestion → Observations DB: up from ingestion's top, then right into the DB, rather than squeezing
  // a vertical into the 6 px gap between the two boxes.
  'ingestion>write>observationsDb': (a, b) => {
    const x = a.x + a.w - 22;
    const y = b.y + b.h - 34;
    return [{ x, y: a.y }, { x, y }, { x: b.x, y }];
  },
  // Observations DB → pygeoapi: down from the DB's outer half, clear of the orchestrator frame's left edge (x 470).
  'observationsDb>read>pygeoapi': (a, b) => {
    const x = a.x + 28;
    const y = 812;
    const bx = b.x + b.w / 3;
    return [{ x, y: a.y + a.h }, { x, y }, { x: bx, y }, { x: bx, y: b.y + b.h }];
  },
  // Consumer → pygeoapi: a bus inside the consumers region, clear of its boundary (x 1360) and of the broker's
  // delivery bus (x ~1421), entering pygeoapi's right side one row per consumer.
  'consumer>query>pygeoapi': (a, b) => {
    const i = Math.round((a.y - CONSUMER_AREA.y) / (CONSUMER_AREA.cardH + CONSUMER_AREA.gap));
    const x = 1384;
    const ay = a.y + a.h * 0.72;
    const by = b.y + 28 + i * 20;
    return [{ x: a.x, y: ay }, { x, y: ay }, { x, y: by }, { x: b.x + b.w, y: by }];
  },
  // Module queries into pygeoapi's top: each on its own row and its own landing point (the drift
  // monitor lands at x 1147), so no two arrows merge.
  'featureDetector>query>pygeoapi': (a, b) => {
    const x = a.x + a.w * 0.62;
    const y = 610;
    const bx = b.x + 118;
    return [{ x, y: a.y + a.h }, { x, y }, { x: bx, y }, { x: bx, y: b.y }];
  },
  'modelRunner>query>pygeoapi': (a, b) => {
    const x = a.x + a.w * 0.68;
    const y = 626;
    const bx = b.x + 176;
    return [{ x, y: a.y + a.h }, { x, y }, { x: bx, y }, { x: bx, y: b.y }];
  },
  // Features DB → pygeoapi: one straight line, so it stays clear of its "read only" label.
  'featuresDb>read>pygeoapi': (a, b) => {
    const y = a.y + a.h / 2 + 10;
    return [{ x: a.x + a.w, y }, { x: b.x, y }];
  },
  // Drift monitor → pygeoapi: out between the schedule and manual-request cards, down the gap between features and announcement.
  'driftMonitor>query>pygeoapi': (a, b) => {
    const y = 162;
    const x = 1147;
    return [{ x: a.x + a.w, y }, { x, y }, { x, y: b.y }];
  },
};

function orthogonal(a: Pt, sa: Side, b: Pt, sb: Side, drop?: number): Pt[] {
  if (horizontal(sa) && horizontal(sb)) {
    const mx = (a.x + b.x) / 2;
    return [a, { x: mx, y: a.y }, { x: mx, y: b.y }, b];
  }
  if (!horizontal(sa) && !horizontal(sb)) {
    if (sa === sb) {
      // e.g. bottom → bottom: drop below both, then across.
      const y = drop ?? Math.max(a.y, b.y) + 22;
      return [a, { x: a.x, y }, { x: b.x, y }, b];
    }
    const my = drop ?? (a.y + b.y) / 2;
    return [a, { x: a.x, y: my }, { x: b.x, y: my }, b];
  }
  // one horizontal, one vertical: single elbow
  return horizontal(sa) ? [a, { x: b.x, y: a.y }, b] : [a, { x: a.x, y: b.y }, b];
}

export interface Route {
  readonly key: string;
  readonly edge: Edge;
  readonly instance?: string;
  readonly points: Pt[];
}

/** Lay out every edge instance, spreading ports evenly where several edges share a side. */
export function routeAll(edges: readonly Edge[], consumers: readonly string[]): Route[] {
  interface Pending {
    key: string;
    edge: Edge;
    instance?: string;
    a: Rect;
    b: Rect;
    from: Side;
    to: Side;
    drop?: number;
  }
  const pending: Pending[] = [];
  for (const e of edges) {
    if (e.from === e.to) continue; // self-loop drawn separately (UI-10)
    if (e.kind === 'subscribe') continue; // CAT-4: rides the delivery line back (same MQTT connection)
    const instances = e.from === 'consumer' || e.to === 'consumer' ? consumers.map((c, i) => ({ c, i })) : [{ c: undefined, i: 0 }];
    for (const { c, i } of instances) {
      if (c !== undefined && i >= CONSUMER_AREA.max) continue;
      const a = rectOf(e.from, i);
      const b = rectOf(e.to, i);
      const sides = HINTS[e.id] ?? chooseSides(a, b);
      pending.push({ key: c ? `${e.id}#${c}` : e.id, edge: e, instance: c, a, b, ...sides });
    }
  }
  // Port allocation: group by (element-instance, side), order by the other end's position.
  const groups = new Map<string, { p: Pending; end: 'a' | 'b' }[]>();
  const gkey = (id: string, inst: string | undefined, side: Side) => `${id}|${inst ?? ''}|${side}`;
  for (const p of pending) {
    const ga = gkey(p.edge.from, p.edge.from === 'consumer' ? p.instance : undefined, p.from);
    const gb = gkey(p.edge.to, p.edge.to === 'consumer' ? p.instance : undefined, p.to);
    (groups.get(ga) ?? groups.set(ga, []).get(ga)!).push({ p, end: 'a' });
    (groups.get(gb) ?? groups.set(gb, []).get(gb)!).push({ p, end: 'b' });
  }
  const t = new Map<string, number>();
  for (const [k, list] of groups) {
    const side = k.split('|')[2] as Side;
    const other = (x: { p: Pending; end: 'a' | 'b' }) => (x.end === 'a' ? x.p.b : x.p.a);
    list.sort((u, v) => (horizontal(side) ? other(u).y - other(v).y : other(u).x - other(v).x));
    list.forEach((x, i) => t.set(`${x.p.key}|${x.end}`, (i + 1) / (list.length + 1)));
  }
  return pending.map((p) => {
    const custom = CUSTOM[p.edge.id];
    if (custom) return { key: p.key, edge: p.edge, instance: p.instance, points: custom(p.a, p.b) };
    const a = port(p.a, p.from, t.get(`${p.key}|a`) ?? 0.5);
    const b = port(p.b, p.to, t.get(`${p.key}|b`) ?? 0.5);
    return { key: p.key, edge: p.edge, instance: p.instance, points: orthogonal(a, p.from, b, p.to, p.drop) };
  });
}

/** UI-10: the background loop on forecast. */
export function forecastLoop(): Pt[] {
  const r = RECTS.forecast;
  const x1 = r.x + r.w - 40;
  const x2 = r.x + r.w - 12;
  return [
    { x: x1, y: r.y },
    { x: x1, y: r.y - 26 },
    { x: x2 + 22, y: r.y - 26 },
    { x: x2 + 22, y: r.y + 24 },
    { x: r.x + r.w, y: r.y + 24 },
  ];
}

export function pathD(pts: readonly Pt[]): string {
  return pts.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
}

export function pointAt(pts: readonly Pt[], frac: number): Pt {
  const segs: number[] = [];
  let total = 0;
  for (let i = 1; i < pts.length; i++) {
    const d = Math.hypot(pts[i]!.x - pts[i - 1]!.x, pts[i]!.y - pts[i - 1]!.y);
    segs.push(d);
    total += d;
  }
  let target = Math.max(0, Math.min(1, frac)) * total;
  for (let i = 0; i < segs.length; i++) {
    const d = segs[i]!;
    if (target <= d || i === segs.length - 1) {
      const k = d ? target / d : 0;
      const a = pts[i]!;
      const b = pts[i + 1]!;
      return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k };
    }
    target -= d;
  }
  return pts[pts.length - 1]!;
}

export function lengthOf(pts: readonly Pt[]): number {
  let total = 0;
  for (let i = 1; i < pts.length; i++) total += Math.hypot(pts[i]!.x - pts[i - 1]!.x, pts[i]!.y - pts[i - 1]!.y);
  return total;
}

export function midpoint(pts: readonly Pt[]): Pt {
  return pointAt(pts, 0.5);
}
