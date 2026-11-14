import { describe, expect, it } from 'vitest';
import { runScript } from '../src/scenario.ts';
import { Simulation } from '../src/simulation.ts';
import { loadScenarios } from './helpers.ts';

/** CAT-1..5: installed capabilities, the catalogue, the power-on handshake and subscriptions. */
describe('capabilities, catalogue and handshake', () => {
  const minimal = () => new Simulation({ seed: 'cat', consumers: 3, capabilities: { featureDetector: false, longRange: false } });
  const full = () => new Simulation({ seed: 'cat', consumers: 3, capabilities: { featureDetector: true, longRange: true } });

  it('CAT-3: the catalogue follows what is installed', () => {
    expect(minimal().catalogue().map((c) => c.id + (c.horizon ? `:${c.horizon}` : ''))).toEqual(['observations', 'climatology', 'forecast:12']);
    expect(full().catalogue().map((c) => c.id + (c.horizon ? `:${c.horizon}` : ''))).toEqual(['observations', 'climatology', 'forecast:48', 'features']);
  });

  it('CAT-5: at power-on each consumer shakes hands at T+00:00 and tailors itself', () => {
    for (const [sim, want] of [
      [minimal(), ['LOW RES', '12 h', 'OK']],
      [full(), ['HI RES', '48 h', 'OK']],
    ] as const) {
      expect(sim.tick).toBe(0);
      expect(sim.consumers.map((c) => c.status)).toEqual(want);
      const handshakes = sim.tokens.tokens.filter((t) => t.payload?.standard === 'O' && t.role === 'request');
      expect(handshakes.map((t) => t.instance)).toEqual(['C1', 'C2', 'C3']);
    }
  });

  it('CAT-4: consumers subscribe per topic; only a chart display with features offered takes features/new', () => {
    expect(minimal().broker.topics).toEqual({ 'forecast/new': 3, 'features/new': 0 });
    const s = full();
    expect(s.broker.topics).toEqual({ 'forecast/new': 3, 'features/new': 1 });
    expect([...s.consumers[0]!.topics].sort()).toEqual(['features/new', 'forecast/new']);
  });

  it('CAT-2: without a detector, runs skip detection and announce without a feature count', () => {
    const s = minimal();
    s.step(30);
    const a = s.log.entries.filter((e) => e.kind === 'announce').map((e) => e.text);
    expect(a[0]).toMatch(/12 h, no feature detector/);
    expect(s.featuresDb.count).toBe(0);
  });

  it('CAT-5: the chart display fetches features and the planner a 48 h forecast', () => {
    const sim = runScript(loadScenarios().find((x) => x.name === 'capabilities')!);
    const [c1, c2, c3] = sim.consumers;
    expect(c1!.results.some((r) => r.featureCount !== undefined && r.ok)).toBe(true);
    expect(c2!.results.some((r) => r.horizon === 48 && r.ok)).toBe(true);
    expect(c3!.results.every((r) => r.featureCount === undefined)).toBe(true);
  });

  it('CON-2: a late consumer catches up from the retained announcement, with no extra query', () => {
    const s = new Simulation({ seed: 'late', consumers: 1 });
    s.step(40);
    const c = s.addConsumer();
    expect(c.results[0]).toMatchObject({ trigger: 'catch-up', ok: true, forecastId: s.netcdf.latest!.id });
  });
});
