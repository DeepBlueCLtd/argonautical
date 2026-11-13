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
  orchestrator: { x: 470, y: 40, w: 870, h: 560 },
} as const;

export const RECTS: Record<Exclude<ElementId, 'consumer'>, Rect> = {
  ocean: { x: 20, y: 70, w: 190, h: 290 },
  sensors: { x: 20, y: 420, w: 190, h: 300 },
  ingestion: { x: 258, y: 430, w: 150, h: 130 },
  // Persistent queue between the DAQ gateway and ingestion (FLT-3).
  sensorBroker: { x: 252, y: 612, w: 162, h: 104 },
  // UI-8: straddles the orchestrator's left edge (x = 470).
  observationsDb: { x: 415, y: 270, w: 110, h: 120 },
  orchestrator: REGIONS.orchestrator,
  driftSensor: { x: 560, y: 72, w: 250, h: 172 },
  shimCheck: { x: 574, y: 112, w: 222, h: 20 },
  driftMonitor: { x: 574, y: 138, w: 222, h: 96 },
  stalenessSchedule: { x: 830, y: 72, w: 180, h: 84 },
  manualRequest: { x: 830, y: 168, w: 180, h: 64 },
  privateStore: { x: 1160, y: 72, w: 165, h: 92 },
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
  // Straddles the System | Consumers boundary (UI-1).
  broker: { x: 1308, y: 330, w: 104, h: 110 },
};

export const CONSUMER_AREA = { x: 1430, y: 110, w: 160, cardH: 66, gap: 10, max: 9 } as const;

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
  'modelRunner>query>pygeoapi': { from: 'bottom', to: 'top' },
  'featureDetector>query>pygeoapi': { from: 'bottom', to: 'top' },
  'modelRunner>write>netcdfStore': { from: 'bottom', to: 'top' },
  'featureDetector>write>featuresDb': { from: 'bottom', to: 'top' },
  'observationsDb>read>pygeoapi': { from: 'bottom', to: 'bottom', drop: 812 },
  'netcdfStore>read>pygeoapi': { from: 'bottom', to: 'bottom', drop: 792 },
  'featuresDb>read>pygeoapi': { from: 'right', to: 'left' },
  'observationsDb>lineage>forecast': { from: 'right', to: 'left' },
  'climatology>lineage>forecast': { from: 'right', to: 'left' },
  'forecast>lineage>features': { from: 'right', to: 'left' },
  'forecast>lineage>announcement': { from: 'bottom', to: 'bottom', drop: 588 },
  'features>lineage>announcement': { from: 'right', to: 'left' },
  'driftSensor>trigger>forecast': { from: 'bottom', to: 'top' },
  'stalenessSchedule>trigger>forecast': { from: 'bottom', to: 'top' },
  'manualRequest>trigger>forecast': { from: 'bottom', to: 'top' },
  'announcer>publish>broker': { from: 'right', to: 'left' },
  'broker>deliver>consumer': { from: 'right', to: 'left' },
  'consumer>query>pygeoapi': { from: 'left', to: 'right' },
  'sensors>publish>sensorBroker': { from: 'right', to: 'left' },
  'sensorBroker>deliver>ingestion': { from: 'top', to: 'bottom' },
  'ingestion>write>observationsDb': { from: 'right', to: 'left' },
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
    const my = (a.y + b.y) / 2;
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

export function midpoint(pts: readonly Pt[]): Pt {
  return pointAt(pts, 0.5);
}
