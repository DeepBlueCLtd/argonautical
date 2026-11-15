/**
 * Physical view geometry (SYS-1–9). Placement, zones and links come from the simulation's declared
 * deployment (ARC-7); this file supplies geometry only. A token between nodes leaves its element,
 * runs along the inside of its node (a gutter) to the node's port for that link, along the link
 * (through a firewall gate where it crosses a zone boundary), then in to the target element.
 */
import { LINKS, NODES, PLACEMENT, linkBetween, type Edge, type ElementId, type NodeId, type ZoneId } from '@argonautical/sim';
import { CONTROL, orthogonalRoute, type Pt, type Rect, type Route } from './layout.ts';

/** Zone bands, left to right (SYS-3); the shore is a box at the foot. */
export const ZONE_BANDS: Record<Exclude<ZoneId, 'environment' | 'shore'>, { x0: number; x1: number }> = {
  ot: { x0: 0, x1: 256 },
  proc: { x0: 256, x1: 1040 },
  dmz: { x0: 1040, x1: 1276 },
  mission: { x0: 1276, x1: 1600 },
};
export const SHORE_ZONE: Rect = { x: 262, y: 646, w: 600, h: 150 };

export const NODE_RECTS: Record<Exclude<NodeId, 'sea'>, Rect> = {
  daq: { x: 12, y: 250, w: 232, h: 122 },
  ingest: { x: 12, y: 386, w: 232, h: 230 },
  orch: { x: 274, y: 40, w: 520, h: 400 },
  compute: { x: 640, y: 456, w: 154, h: 128 },
  data: { x: 806, y: 40, w: 216, h: 400 },
  ops: { x: 274, y: 456, w: 354, h: 128 },
  dist: { x: 1052, y: 40, w: 212, h: 560 },
  wk: { x: 1288, y: 40, w: 300, h: 84 },
  mission: { x: 1288, y: 140, w: 300, h: 470 },
  shore: { x: 470, y: 690, w: 200, h: 90 },
};

/** Processes drawn as frames inside the orchestration node (SYS-4). */
export const PROCESS_RECTS = {
  daemon: { x: 414, y: 58, w: 370, h: 64 },
  codeLocation: { x: 284, y: 132, w: 500, h: 298 },
} as const;

const ROW = (i: number) => 160 + i * 44;
const col = { asset: 292, shim: 408, module: 516 } as const;
const chip = (x: number, i: number, w: number): Rect => ({ x, y: ROW(i), w, h: 34 });

export const CONSUMER_SLOT = { x: 1300, y: 166, w: 276, h: 98, gap: 10, max: 4 } as const;
export const consumerRectP = (i: number): Rect => ({ x: CONSUMER_SLOT.x, y: CONSUMER_SLOT.y + i * (CONSUMER_SLOT.h + CONSUMER_SLOT.gap), w: CONSUMER_SLOT.w, h: CONSUMER_SLOT.h });

export const P_RECTS: Record<Exclude<ElementId, 'consumer'>, Rect> = {
  // OT
  ocean: { x: 24, y: 262, w: 208, h: 36 },
  sensors: { x: 24, y: 306, w: 208, h: 56 },
  sensorBroker: { x: 24, y: 412, w: 208, h: 84 },
  ingestion: { x: 24, y: 512, w: 208, h: 92 },
  // Orchestration node: webserver, metadata DB, daemon (sensors, schedule), code location rows
  privateStore: { x: 284, y: 84, w: 120, h: 42 },
  orchestrator: PROCESS_RECTS.daemon,
  driftSensor: { x: 422, y: 80, w: 112, h: 34 },
  stalenessSchedule: { x: 540, y: 80, w: 112, h: 34 },
  manualRequest: { x: 658, y: 80, w: 118, h: 34 },
  shimCheck: chip(col.shim, 0, 102),
  driftMonitor: chip(col.module, 0, 172),
  climatology: chip(col.asset, 1, 108),
  shimImport: chip(col.shim, 1, 102),
  climatologyImporter: chip(col.module, 1, 172),
  forecast: chip(col.asset, 2, 108),
  shimRun: chip(col.shim, 2, 102),
  features: chip(col.asset, 3, 108),
  shimDetect: chip(col.shim, 3, 102),
  featureDetector: chip(col.module, 3, 172),
  announcement: chip(col.asset, 4, 108),
  shimAnnounce: chip(col.shim, 4, 102),
  announcer: chip(col.module, 4, 172),
  shoreExport: chip(col.asset, 5, 108),
  shimExport: chip(col.shim, 5, 102),
  shoreExporter: chip(col.module, 5, 172),
  // Compute node
  modelRunner: { x: 652, y: 484, w: 130, h: 80 },
  // Data node
  observationsDb: { x: 820, y: 70, w: 188, h: 110 },
  netcdfStore: { x: 820, y: 194, w: 188, h: 110 },
  featuresDb: { x: 820, y: 318, w: 188, h: 110 },
  // Ops node
  shoreSync: { x: 286, y: 482, w: 130, h: 34 },
  transferArea: { x: 286, y: 526, w: 130, h: 42 },
  // Distribution host
  pygeoapi: { x: 1066, y: 70, w: 184, h: 120 },
  broker: { x: 1066, y: 214, w: 184, h: 110 },
  runRequestApi: { x: 1066, y: 348, w: 184, h: 64 },
  // Mission
  watchkeeper: { x: 1300, y: 66, w: 276, h: 46 },
  // Shore
  shore: { x: 486, y: 708, w: 176, h: 66 },
};

/** The "pipes client" chip in the forecast row: where the run shim's call leaves for the compute node. */
export const PIPES_CHIP: Rect = chip(col.module, 2, 172);

/** Parts with no simulated behaviour (SYS-5), drawn greyed. */
export const OPS_STATIC = {
  registry: { x: 426, y: 478, w: 98, h: 30 },
  observability: { x: 426, y: 512, w: 98, h: 30 },
  backup: { x: 426, y: 546, w: 98, h: 30 },
  terminal: { x: 530, y: 478, w: 90, h: 44 },
  time: { x: 530, y: 528, w: 90, h: 48 },
} as const;

export const TOKEN_KEY_P: Rect = { x: 1288, y: 630, w: 300, h: 200 };
export { CONTROL };

export function pRectOf(id: ElementId, consumerIndex = 0): Rect {
  return id === 'consumer' ? consumerRectP(consumerIndex) : P_RECTS[id];
}

// ---- links ----

export interface LinkGeom {
  /** Port on node a, then the waypoints, then the port on node b (a and b as declared in LINKS). */
  readonly pts: Pt[];
  /** Firewall gates on this link (zone crossings). */
  readonly gates: readonly Pt[];
  readonly label?: string;
}

const key = (a: NodeId, b: NodeId) => `${a}|${b}`;

export const LINK_GEOM: Record<string, LinkGeom> = {
  [key('daq', 'ingest')]: { pts: [{ x: 128, y: 372 }, { x: 128, y: 386 }], gates: [] },
  [key('ingest', 'data')]: {
    pts: [{ x: 244, y: 600 }, { x: 1031, y: 600 }, { x: 1031, y: 126 }, { x: 1022, y: 126 }],
    gates: [{ x: 256, y: 600 }],
    label: 'OT → enclave firewall',
  },
  [key('orch', 'compute')]: { pts: [{ x: 740, y: 440 }, { x: 740, y: 456 }], gates: [] },
  [key('orch', 'dist')]: { pts: [{ x: 760, y: 40 }, { x: 760, y: 26 }, { x: 1110, y: 26 }, { x: 1110, y: 40 }], gates: [{ x: 1040, y: 26 }], label: 'enclave → DMZ' },
  [key('compute', 'dist')]: { pts: [{ x: 794, y: 548 }, { x: 1052, y: 548 }], gates: [{ x: 1040, y: 548 }] },
  [key('compute', 'data')]: { pts: [{ x: 794, y: 470 }, { x: 812, y: 470 }, { x: 812, y: 440 }], gates: [] },
  [key('orch', 'data')]: { pts: [{ x: 794, y: 250 }, { x: 806, y: 250 }], gates: [] },
  [key('data', 'dist')]: { pts: [{ x: 1022, y: 250 }, { x: 1052, y: 250 }], gates: [{ x: 1040, y: 250 }] },
  [key('dist', 'mission')]: { pts: [{ x: 1264, y: 300 }, { x: 1288, y: 300 }], gates: [{ x: 1276, y: 300 }], label: 'DMZ → mission firewall' },
  [key('dist', 'wk')]: { pts: [{ x: 1264, y: 88 }, { x: 1288, y: 88 }], gates: [{ x: 1276, y: 88 }] },
  [key('orch', 'ops')]: { pts: [{ x: 460, y: 440 }, { x: 460, y: 456 }], gates: [] },
  [key('ops', 'shore')]: { pts: [{ x: 574, y: 584 }, { x: 574, y: 708 }], gates: [{ x: 574, y: SHORE_ZONE.y }], label: 'satcom (intermittent)' },
};

/** Every declared link has geometry (a test checks this too). */
export function linkGeom(a: NodeId, b: NodeId): { pts: Pt[]; gates: readonly Pt[] } | undefined {
  const l = linkBetween(a, b);
  if (!l) return undefined;
  const g = LINK_GEOM[key(l.a, l.b)];
  if (!g) return undefined;
  return l.a === a ? { pts: g.pts, gates: g.gates } : { pts: [...g.pts].reverse(), gates: g.gates };
}

export const ALL_GATES: { at: Pt; label?: string }[] = Object.values(LINK_GEOM).flatMap((g) => g.gates.map((at) => ({ at, label: g.label })));

// ---- routing ----

type Side = 'left' | 'right' | 'top' | 'bottom';
const GUTTER = 6;

/** Where an element leaves for a port: the side facing it. */
function exitSide(e: Rect, port: Pt): Side {
  if (port.x >= e.x + e.w) return 'right';
  if (port.x <= e.x) return 'left';
  return port.y < e.y ? 'top' : 'bottom';
}

function sidePoint(e: Rect, s: Side): Pt {
  switch (s) {
    case 'left':
      return { x: e.x, y: e.y + e.h / 2 };
    case 'right':
      return { x: e.x + e.w, y: e.y + e.h / 2 };
    case 'top':
      return { x: e.x + e.w / 2, y: e.y };
    case 'bottom':
      return { x: e.x + e.w / 2, y: e.y + e.h };
  }
}

/** Perimeter position (0…P) of a point on rectangle g's border. */
function perim(g: Rect, p: Pt): number {
  const { x, y, w, h } = g;
  if (Math.abs(p.y - y) < 0.5) return p.x - x;
  if (Math.abs(p.x - (x + w)) < 0.5) return w + (p.y - y);
  if (Math.abs(p.y - (y + h)) < 0.5) return w + h + (x + w - p.x);
  return 2 * w + h + (y + h - p.y);
}

/** Walk along the gutter rectangle from a to b, the shorter way round, including corners. */
function walk(g: Rect, a: Pt, b: Pt): Pt[] {
  const P = 2 * (g.w + g.h);
  const corners = [
    { t: 0, p: { x: g.x, y: g.y } },
    { t: g.w, p: { x: g.x + g.w, y: g.y } },
    { t: g.w + g.h, p: { x: g.x + g.w, y: g.y + g.h } },
    { t: 2 * g.w + g.h, p: { x: g.x, y: g.y + g.h } },
  ];
  const ta = perim(g, a);
  const tb = perim(g, b);
  const fwd = (tb - ta + P) % P;
  const out: Pt[] = [a];
  if (fwd <= P - fwd) {
    for (const c of [...corners, ...corners.map((c) => ({ t: c.t + P, p: c.p }))]) if (c.t > ta && c.t < ta + fwd) out.push(c.p);
  } else {
    const back = P - fwd;
    for (const c of [...corners, ...corners.map((c) => ({ t: c.t - P, p: c.p }))].sort((u, v) => v.t - u.t)) if (c.t < ta && c.t > ta - back) out.push(c.p);
  }
  out.push(b);
  return out;
}

/** Project a point onto the gutter rectangle along the given side's normal. */
function toGutter(g: Rect, p: Pt, s: Side): Pt {
  switch (s) {
    case 'left':
      return { x: g.x, y: clamp(p.y, g.y, g.y + g.h) };
    case 'right':
      return { x: g.x + g.w, y: clamp(p.y, g.y, g.y + g.h) };
    case 'top':
      return { x: clamp(p.x, g.x, g.x + g.w), y: g.y };
    case 'bottom':
      return { x: clamp(p.x, g.x, g.x + g.w), y: g.y + g.h };
  }
}
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

/** The port's own side of its node. */
function portSide(n: Rect, p: Pt): Side {
  if (Math.abs(p.x - n.x) < 0.5) return 'left';
  if (Math.abs(p.x - (n.x + n.w)) < 0.5) return 'right';
  if (Math.abs(p.y - n.y) < 0.5) return 'top';
  return 'bottom';
}

/** From an element to a port on its node's border, via the gutter. */
function toPort(e: Rect, node: Rect, port: Pt, exitFrom?: Rect): Pt[] {
  const from = exitFrom ?? e;
  const g: Rect = { x: node.x + GUTTER, y: node.y + GUTTER, w: node.w - 2 * GUTTER, h: node.h - 2 * GUTTER };
  const s = exitSide(from, port);
  const p0 = sidePoint(from, s);
  const g0 = toGutter(g, p0, s);
  const ps = portSide(node, port);
  const g1 = toGutter(g, port, ps);
  const lead = exitFrom ? [sidePoint(e, 'right'), p0] : [p0];
  return dedupe([...lead, ...walk(g, g0, g1), port]);
}

function dedupe(pts: Pt[]): Pt[] {
  return pts.filter((p, i) => i === 0 || Math.hypot(p.x - pts[i - 1]!.x, p.y - pts[i - 1]!.y) > 0.5);
}

/** Lineage and triggers (Dagster's own bookkeeping) stay inside the orchestration node (SYS-2). */
function logicalRoute(e: Edge): Pt[] {
  const a = e.from === 'observationsDb' ? { x: 794, y: 250, w: 0, h: 0 } : P_RECTS[e.from as Exclude<ElementId, 'consumer'>];
  const b = P_RECTS[e.to as Exclude<ElementId, 'consumer'>];
  if (e.from === e.to) {
    // background loop on forecast: out of its left side and back
    const x = b.x - 4;
    return [{ x: b.x, y: b.y + 8 }, { x, y: b.y + 8 }, { x, y: b.y + b.h - 8 }, { x: b.x, y: b.y + b.h - 8 }];
  }
  return orthogonalRoute(a, b);
}

export function routePhysical(edges: readonly Edge[], consumers: readonly string[]): Route[] {
  const out: Route[] = [];
  for (const e of edges) {
    const instances = e.from === 'consumer' || e.to === 'consumer' ? consumers.slice(0, CONSUMER_SLOT.max).map((c, i) => ({ c, i })) : [{ c: undefined as string | undefined, i: 0 }];
    for (const { c, i } of instances) {
      const k = c ? `${e.id}#${c}` : e.id;
      if (e.logical) {
        out.push({ key: k, edge: e, instance: c, points: logicalRoute(e) });
        continue;
      }
      const a = pRectOf(e.from, i);
      const b = pRectOf(e.to, i);
      const na = PLACEMENT[e.from].node as Exclude<NodeId, 'sea'>;
      const nb = PLACEMENT[e.to].node as Exclude<NodeId, 'sea'>;
      if (na === nb) {
        out.push({ key: k, edge: e, instance: c, points: orthogonalRoute(a, b) });
        continue;
      }
      const lg = linkGeom(na, nb);
      if (!lg) continue;
      // The run shim's call leaves through the Pipes client chip.
      const exitA = e.from === 'shimRun' ? PIPES_CHIP : undefined;
      const head = toPort(a, NODE_RECTS[na], lg.pts[0]!, exitA);
      const tail = toPort(b, NODE_RECTS[nb], lg.pts[lg.pts.length - 1]!).reverse();
      out.push({ key: k, edge: e, instance: c, points: dedupe([...head, ...lg.pts.slice(1, -1), ...tail]) });
    }
  }
  return out;
}

/** Gates a route passes through (for the gate light and the SYS-2 test). */
export function gatesOn(pts: readonly Pt[]): Pt[] {
  const hits: Pt[] = [];
  for (const { at } of ALL_GATES) {
    for (let i = 1; i < pts.length; i++) {
      const p = pts[i - 1]!;
      const q = pts[i]!;
      const onX = Math.abs(p.x - q.x) < 0.5 && Math.abs(p.x - at.x) < 0.5 && at.y >= Math.min(p.y, q.y) - 0.5 && at.y <= Math.max(p.y, q.y) + 0.5;
      const onY = Math.abs(p.y - q.y) < 0.5 && Math.abs(p.y - at.y) < 0.5 && at.x >= Math.min(p.x, q.x) - 0.5 && at.x <= Math.max(p.x, q.x) + 0.5;
      if (onX || onY) {
        hits.push(at);
        break;
      }
    }
  }
  return hits;
}

export { LINKS, NODES };
