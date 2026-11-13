import { describe, expect, it } from 'vitest';
import { runScript } from '../src/scenario.ts';
import { Simulation } from '../src/simulation.ts';
import { loadScenarios } from './helpers.ts';

/** CAT-1..5: capabilities, the catalogue, discovery, subscriptions and consumer status. */
describe('catalogue and consumer status', () => {
  const script = loadScenarios().find((s) => s.name === 'capabilities')!;
  const statuses = new Map<string, string[]>();
  const catalogues: string[] = [];
  const sim = runScript(script, (s) => {
    for (const c of s.consumers) {
      const list = statuses.get(c.id) ?? statuses.set(c.id, []).get(c.id)!;
      if (list.at(-1) !== c.status) list.push(c.status);
    }
    const cat = JSON.stringify(s.catalogue());
    if (catalogues.at(-1) !== cat) catalogues.push(cat);
  });

  it('CAT-5: the chart display goes LOW RES → HI RES pending → HI RES (pending again between a forecast and its features) → LOW RES', () => {
    const seq = statuses.get('C1')!.filter((x) => x !== 'waiting');
    expect(seq[0]).toBe('LOW RES');
    expect(seq.slice(1, 3)).toEqual(['HI RES pending', 'HI RES']);
    expect(seq.at(-1)).toBe('LOW RES');
    expect(new Set(seq)).toEqual(new Set(['LOW RES', 'HI RES pending', 'HI RES']));
  });

  it('CAT-5: the passage planner goes 12 h → 48 h pending → 48 h', () => {
    expect(statuses.get('C2')!.filter((x) => x !== 'waiting')).toEqual(['12 h', '48 h pending', '48 h']);
  });

  it('CAT-3: features are listed from next run, then available, then no longer updated', () => {
    const feat = catalogues.map((c) => (JSON.parse(c) as { id: string; status: string }[]).find((x) => x.id === 'features')?.status ?? 'absent');
    expect([...new Set(feat)]).toEqual(['absent', 'from next run', 'available', 'no longer updated']);
  });

  it('CAT-2: runs without a detector skip detection and announce without a feature count', () => {
    const announces = sim.log.entries.filter((e) => e.kind === 'announce').map((e) => e.text);
    expect(announces[0]).toMatch(/12 h, no feature detector/);
    expect(announces.some((a) => /48 h, \d+ features/.test(a))).toBe(true);
    expect(announces.at(-1)).toMatch(/48 h, no feature detector/);
  });

  it('CAT-4: consumers subscribe per topic; only the chart display takes features/new', () => {
    const [c1, c2, c3] = sim.consumers;
    expect([...c1!.topics].sort()).toEqual(['catalogue/changed', 'features/new', 'forecast/new']);
    expect([...c2!.topics].sort()).toEqual(['catalogue/changed', 'forecast/new']);
    expect([...c3!.topics].sort()).toEqual(['catalogue/changed', 'forecast/new']);
    expect(sim.broker.topics).toEqual({ 'forecast/new': 3, 'features/new': 1, 'catalogue/changed': 3 });
  });

  it('CAT-4: a catalogue change makes every consumer discover again', () => {
    const s = new Simulation({ seed: 'cat', consumers: 2, capabilities: { featureDetector: false } });
    const reads = () => s.tokens.tokens.filter((t) => t.payload?.standard === 'O' && t.role === 'request').length;
    const before = reads();
    s.setCapability('featureDetector', true);
    expect(reads()).toBe(before + 2);
    expect(s.tokens.tokens.some((t) => t.edge === 'pygeoapi>publish>broker')).toBe(true);
  });

  it('CON-2: a late consumer catches up from the retained announcement, with no extra query', () => {
    const s = new Simulation({ seed: 'late', consumers: 1 });
    s.step(40);
    const c = s.addConsumer();
    expect(c.results[0]).toMatchObject({ trigger: 'catch-up', ok: true, forecastId: s.netcdf.latest!.id });
  });
});
