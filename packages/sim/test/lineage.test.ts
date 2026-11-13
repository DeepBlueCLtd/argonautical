import { describe, expect, it } from 'vitest';
import { runScript } from '../src/scenario.ts';
import type { Token } from '../src/tokens.ts';
import { EDGES } from '../src/topology/elements.ts';
import { loadScenarios } from './helpers.ts';

/** MOT-8: lineage tokens mark moments, not data: a release when an upstream materialises, a check at run start. */
describe('lineage signals', () => {
  const lineage = new Set(EDGES.filter((e) => e.kind === 'lineage').map((e) => e.id));
  const tokens: Token[] = [];
  for (const s of loadScenarios()) {
    let last = 0;
    runScript(s, (sim) => {
      for (const t of sim.tokens.tokens) if (t.seq > last) (last = t.seq), lineage.has(t.edge) && tokens.push(t);
    });
  }

  it('every lineage token is a release or a check', () => {
    expect(tokens.length).toBeGreaterThan(0);
    for (const t of tokens) expect(['release', 'check'], t.edge).toContain(t.signal);
  });

  it('only forecast → features and features → announcement release a step, or forecast → announcement when there is no feature detector', () => {
    const released = new Set(tokens.filter((t) => t.signal === 'release').map((t) => t.edge));
    expect([...released].sort()).toEqual(['features>lineage>announcement', 'forecast>lineage>announcement', 'forecast>lineage>features']);
  });

  it('observations, climatology and the background loop are only ever checked', () => {
    for (const e of ['observationsDb>lineage>forecast', 'climatology>lineage>forecast', 'forecast>lineage>forecast']) {
      const ts = tokens.filter((t) => t.edge === e);
      expect(ts.length, e).toBeGreaterThan(0);
      expect(ts.every((t) => t.signal === 'check'), e).toBe(true);
    }
  });
});
