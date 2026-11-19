/** Graph view (issue #34): only Dagster's own wiring and the broadcast are drawn, and every such token has a route. */
import { EDGES, EDGE_IDS, runScript, type Script } from '@argonautical/sim';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FEED_EDGES, G_CONSUMERS, G_RECTS, inGraph, routeGraph } from '../src/diagram/graph.ts';

const dir = join(import.meta.dirname, '../../sim/scenarios');
const scenarios: Script[] = readdirSync(dir).map((f) => JSON.parse(readFileSync(join(dir, f), 'utf8')));
const consumers = Array.from({ length: G_CONSUMERS.max }, (_, i) => `C${i + 1}`);

describe('graph view', () => {
  const routes = routeGraph(EDGES, consumers);
  const byKey = new Map(routes.map((r) => [r.key, r]));

  it('draws triggers, lineage, shim calls and the broadcast, and nothing else', () => {
    for (const r of routes) expect(['lineage', 'trigger', 'call', 'publish', 'deliver']).toContain(r.edge.kind);
    for (const e of EDGES) if (e.kind === 'read' || e.kind === 'query' || e.kind === 'write') expect(inGraph(e), e.id).toBe(false);
    expect(byKey.has('announcer>publish>broker')).toBe(true);
    expect(byKey.has('broker>deliver>consumer#C1')).toBe(true);
  });

  it('every graph element has a rectangle, and the ingest feed summarises declared edges', () => {
    for (const e of EDGES.filter(inGraph)) for (const id of [e.from, e.to]) if (id !== 'consumer') expect(G_RECTS[id], id).toBeDefined();
    for (const id of FEED_EDGES) expect(EDGE_IDS.has(id), id).toBe(true);
  });

  it('every graph token of every scenario follows a route; no other token does', () => {
    for (const s of scenarios) {
      runScript(s, (x) => {
        for (const t of x.tokens.tokens) {
          if (t.start !== x.tick || t.edge === 'forecast>lineage>forecast') continue;
          if (t.instance && Number(t.instance.slice(1)) > G_CONSUMERS.max) continue;
          const k = t.edge === 'consumer>subscribe>broker' ? `broker>deliver>consumer#${t.instance}` : t.instance && t.edge.includes('consumer') ? `${t.edge}#${t.instance}` : t.edge;
          const edge = EDGES.find((e) => e.id === t.edge)!;
          expect(byKey.has(k), `${s.name}: ${k}`).toBe(inGraph(edge));
        }
      });
    }
  });
});
