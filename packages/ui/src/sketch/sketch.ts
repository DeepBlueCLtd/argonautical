/**
 * Hand-drawn outlines (docs/sketch-makeover-spec.md). rough.js turns crisp geometry into a lightly
 * wobbly stroke. Every drawing is seeded from its geometry and state, so a shape looks the same on
 * every frame and every reload, and redraws once when its state changes (D3). Results are cached:
 * the diagram re-renders every tick, but rough.js runs only for geometry it has not seen.
 */
import rough from 'roughjs';

const gen = rough.generator();
const BASE = { roughness: 0.8, bowing: 0.6, disableMultiStroke: true } as const;

const cache = new Map<string, string>();
const CACHE_MAX = 4000;

/** FNV-1a, folded to a positive 31-bit seed (rough.js treats 0 as "random"). */
export function seedOf(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 1) % 2147483646 + 1;
}

/** Shorter DOM: one decimal is plenty at diagram scale. */
const tidy = (d: string) => d.replace(/-?\d+\.\d+(e-?\d+)?/g, (n) => String(Math.round(Number(n) * 10) / 10));

function memo(key: string, draw: () => string): string {
  let d = cache.get(key);
  if (d === undefined) {
    if (cache.size >= CACHE_MAX) cache.clear();
    d = tidy(draw());
    cache.set(key, d);
  }
  return d;
}

const pathsOf = (drawable: ReturnType<typeof gen.path>) => gen.toPaths(drawable).map((p) => p.d).join(' ');

/** Rough segments each start with their own M; joined, a line dashes and sweeps as one stroke. */
const joined = (d: string) => d.replace(/(?!^)M/g, 'L');

/** A crisp rounded-rectangle outline (rough.js has no rounded rect of its own). */
export function roundRectD(x: number, y: number, w: number, h: number, rx = 0): string {
  const r = Math.max(0, Math.min(rx, w / 2, h / 2));
  if (!r) return `M${x},${y} H${x + w} V${y + h} H${x} Z`;
  return `M${x + r},${y} H${x + w - r} Q${x + w},${y} ${x + w},${y + r} V${y + h - r} Q${x + w},${y + h} ${x + w - r},${y + h} H${x + r} Q${x},${y + h} ${x},${y + h - r} V${y + r} Q${x},${y} ${x + r},${y} Z`;
}

/** Sketchy outline of a (rounded) rectangle; separate strokes, so the corners overshoot slightly. */
export function sketchRect(x: number, y: number, w: number, h: number, rx = 0, state = ''): string {
  const geo = `${x},${y},${w},${h},${rx}`;
  return memo(`r|${geo}|${state}`, () => pathsOf(gen.path(roundRectD(x, y, w, h, rx), { ...BASE, seed: seedOf(geo + '|' + state) })));
}

export function sketchCircle(cx: number, cy: number, r: number, state = ''): string {
  const geo = `${cx},${cy},${r}`;
  return memo(`c|${geo}|${state}`, () => pathsOf(gen.circle(cx, cy, r * 2, { ...BASE, roughness: 0.6, seed: seedOf(geo + '|' + state) })));
}

/** Any path as one continuous wobbly stroke (connectors, lines). Vertices stay put, so arrows and tokens still meet them. */
export function sketchLine(d: string, state = ''): string {
  return memo(`l|${d}|${state}`, () => joined(pathsOf(gen.path(d, { ...BASE, preserveVertices: true, seed: seedOf(d + '|' + state) }))));
}

/** Any closed outline drawn as separate strokes, like sketchRect. */
export function sketchOutline(d: string, state = ''): string {
  return memo(`o|${d}|${state}`, () => pathsOf(gen.path(d, { ...BASE, seed: seedOf(d + '|' + state) })));
}

const byPoints = new WeakMap<readonly { x: number; y: number }[], string>();

/** sketchLine for a route's points, cached on the array itself (routes are rebuilt only when the layout changes). */
export function sketchPts(pts: readonly { x: number; y: number }[]): string {
  let d = byPoints.get(pts);
  if (d === undefined) {
    d = sketchLine(pts.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' '));
    byPoints.set(pts, d);
  }
  return d;
}
