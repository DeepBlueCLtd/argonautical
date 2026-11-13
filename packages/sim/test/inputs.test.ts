import { describe, expect, it } from 'vitest';
import { runScript } from '../src/scenario.ts';
import type { Token } from '../src/tokens.ts';
import { INPUTS, consumerNeeds } from '../src/topology/inputs.ts';
import { loadScenarios } from './helpers.ts';

/** MOT-7: every declared input is filled by a response of the declared standard, and nothing else is. */
describe('declared inputs', () => {
  const tokens = new Map<number, Token>();
  const consumersNeed = new Map<string, string>();
  for (const s of loadScenarios()) {
    runScript(s, (sim) => {
      for (const t of sim.tokens.tokens) tokens.set(t.seq * 1000 + s.name.length, t);
      for (const c of sim.consumers) consumersNeed.set(c.id, c.needs);
    });
  }
  const responses = [...tokens.values()].filter((t) => t.role === 'response' && t.slot);
  const caller = (t: Token) => t.edge.split('>')[0]!;

  it('each slot-filling response matches a declared input of its caller, with that standard', () => {
    for (const t of responses) {
      const c = caller(t);
      const decl = c === 'consumer' ? INPUTS.consumer[consumersNeed.get(t.instance!) as 'coverage'] : INPUTS[c as 'driftMonitor'];
      const d = decl.find((x) => x.slot === t.slot);
      expect(d, `${c} ${t.slot}`).toBeDefined();
      expect(t.payload!.standard, `${c} ${t.slot}`).toBe(d!.standard);
    }
  });

  it('every declared input is filled at some point', () => {
    const seen = new Set(responses.map((t) => `${caller(t)}:${caller(t) === 'consumer' ? consumersNeed.get(t.instance!) : ''}:${t.slot}`));
    for (const [el, list] of Object.entries(INPUTS)) {
      if (el === 'consumer') {
        for (const [needs, l] of Object.entries(INPUTS.consumer)) for (const d of l) expect(seen.has(`consumer:${needs}:${d.slot}`), `${needs} ${d.slot}`).toBe(true);
      } else for (const d of list as readonly { slot: string }[]) expect(seen.has(`${el}::${d.slot}`), `${el} ${d.slot}`).toBe(true);
    }
  });

  it('consumers alternate between coverage+features and coverage only; coverage-only ones never read features', () => {
    expect([0, 1, 2, 3].map(consumerNeeds)).toEqual(['coverage+features', 'coverage', 'coverage+features', 'coverage']);
    const coverageOnly = [...consumersNeed].filter(([, n]) => n === 'coverage').map(([id]) => id);
    expect(coverageOnly.length).toBeGreaterThan(0);
    const featureReads = [...tokens.values()].filter((t) => t.edge === 'consumer>query>pygeoapi' && t.slot === 'features');
    expect(featureReads.some((t) => coverageOnly.includes(t.instance!))).toBe(false);
  });
});
