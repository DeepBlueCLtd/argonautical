/** Artefacts view (issue #34): what it draws, and every token it shows has a route. */
import { EDGES, EDGE_IDS, runScript, type Script } from '@argonautical/sim';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { EXTERNAL, G_CONSUMERS, G_RECTS, inGraph, routeGraph } from '../src/diagram/graph.ts';

const dir = join(import.meta.dirname, '../../sim/scenarios');
const scenarios: Script[] = readdirSync(dir).map((f) => JSON.parse(readFileSync(join(dir, f), 'utf8')));
const consumers = Array.from({ length: G_CONSUMERS.max }, (_, i) => `C${i + 1}`);

describe('artefacts view', () => {
  const routes = routeGraph(EDGES, consumers);
  const byKey = new Map(routes.map((r) => [r.key, r]));

  it('draws the orchestrator’s wiring and the external messages, and nothing else', () => {
    for (const r of routes) expect(['lineage', 'trigger', 'call'].includes(r.edge.kind) || EXTERNAL.has(r.edge.id), r.edge.id).toBe(true);
    for (const id of EXTERNAL) expect(EDGE_IDS.has(id), id).toBe(true);
    // pygeoapi reads, other store writes and the SUBSCRIBE handshake are hidden.
    for (const e of EDGES) if (e.to === 'pygeoapi' || e.from === 'pygeoapi' || e.kind === 'subscribe' || (e.kind === 'write' && e.to !== 'observationsDb')) expect(inGraph(e), e.id).toBe(false);
  });

  it('every graph element has a rectangle', () => {
    for (const e of EDGES.filter(inGraph)) for (const id of [e.from, e.to]) if (id !== 'consumer') expect(G_RECTS[id], id).toBeDefined();
  });

  it('every graph token of every scenario follows a route; no other token does', () => {
    for (const s of scenarios) {
      runScript(s, (x) => {
        for (const t of x.tokens.tokens) {
          if (t.start !== x.tick || t.edge === 'forecast>lineage>forecast' || t.edge === 'consumer>subscribe>broker') continue;
          if (t.instance && Number(t.instance.slice(1)) > G_CONSUMERS.max) continue;
          const k = t.instance && t.edge.includes('consumer') ? `${t.edge}#${t.instance}` : t.edge;
          const edge = EDGES.find((e) => e.id === t.edge)!;
          expect(byKey.has(k), `${s.name}: ${k}`).toBe(inGraph(edge));
        }
      });
    }
  });
});
