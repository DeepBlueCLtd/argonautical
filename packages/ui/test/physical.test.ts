import { EDGES, LINKS, PLACEMENT, ZONES, runScript, type Script } from '@argonautical/sim';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { LINK_GEOM, NODE_RECTS, P_RECTS, gatesOn, routePhysical } from '../src/diagram/physical.ts';

const dir = join(import.meta.dirname, '../../sim/scenarios');
const scenarios: Script[] = readdirSync(dir).map((f) => JSON.parse(readFileSync(join(dir, f), 'utf8')));
const zoneOf = (id: keyof typeof PLACEMENT) => (NODE_RECTS as Record<string, unknown>)[PLACEMENT[id].node] && (PLACEMENT[id].node === 'sea' ? 'environment' : (({ daq: 'ot', ingest: 'ot', orch: 'proc', compute: 'proc', data: 'proc', ops: 'proc', dist: 'dmz', mission: 'mission', wk: 'mission', shore: 'shore' }) as const)[PLACEMENT[id].node]);

describe('physical view (SYS-2, acceptance 22)', () => {
  const routes = routePhysical(EDGES, ['C1', 'C2', 'C3', 'C4']);
  const byKey = new Map(routes.map((r) => [r.key, r]));

  it('every declared link has geometry, and every element has a rectangle', () => {
    for (const l of LINKS) expect(LINK_GEOM[`${l.a}|${l.b}`], `${l.a}|${l.b}`).toBeDefined();
    for (const id of Object.keys(PLACEMENT)) if (id !== 'consumer') expect(P_RECTS[id as keyof typeof P_RECTS], id).toBeDefined();
  });

  it('every token of every scenario follows a route that exists', () => {
    for (const s of scenarios) {
      const sim = runScript(s, (x) => {
        for (const t of x.tokens.tokens) {
          if (t.start !== x.tick) continue;
          const k = t.edge === 'consumer>subscribe>broker' ? `broker>deliver>consumer#${t.instance}` : t.instance && t.edge.includes('consumer') ? `${t.edge}#${t.instance}` : t.edge;
          if (t.instance && Number(t.instance.slice(1)) > 4) continue; // only four consumer cards are drawn
          expect(byKey.get(k), `${s.name}: ${k}`).toBeDefined();
        }
      });
      expect(sim.tokens.defects).toEqual([]);
    }
  });

  it('every route that crosses a zone boundary passes a firewall gate', () => {
    for (const r of routes) {
      if (r.edge.logical) continue;
      const za = zoneOf(r.edge.from);
      const zb = zoneOf(r.edge.to);
      if (za !== zb) expect(gatesOn(r.points).length, r.key).toBeGreaterThan(0);
    }
    expect(Object.keys(ZONES)).toContain('shore');
  });

  it('routes are orthogonal (no diagonal segments)', () => {
    for (const r of routes)
      for (let i = 1; i < r.points.length; i++) {
        const p = r.points[i - 1]!;
        const q = r.points[i]!;
        expect(Math.abs(p.x - q.x) < 0.5 || Math.abs(p.y - q.y) < 0.5, r.key).toBe(true);
      }
  });
});
