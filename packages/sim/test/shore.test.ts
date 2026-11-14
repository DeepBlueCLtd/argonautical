import { describe, expect, it } from 'vitest';
import { TIMING, shoreLinkUp } from '../src/config.ts';
import { runScript } from '../src/scenario.ts';
import { ELEMENTS, EDGES } from '../src/topology/elements.ts';
import { loadScenario } from './helpers.ts';

const events = (sim: ReturnType<typeof runScript>, kind: string) => sim.log.entries.filter((e) => e.kind === kind);

describe('run requests (RRQ)', () => {
  const sim = runScript(loadScenario('shore'));

  it('19. a request waits for the next poll; two before it merge into one queued run', () => {
    const req = events(sim, 'request').filter((e) => e.text.startsWith('manual'));
    expect(req.map((e) => e.tick)).toEqual([45, 45]);
    expect(req[1]!.text).toMatch(/merged into queued run: manual \+ manual$/);
    expect(sim.runRequests.requests.map((r) => r.polledAt)).toEqual([45, 45]);
  });

  it('RRQ-3: the requests get the status of the run that served them', () => {
    const [a, b] = sim.runRequests.requests;
    expect(a!.status?.runId).toBeDefined();
    expect(b!.status).toEqual(a!.status);
  });

  it('RRQ-2: empty polls are not drawn', () => {
    expect(sim.tokens.edgeStats.get('manualRequest>query>runRequestApi')!.count).toBe(2);
  });
});

describe('shore transfer (SHR)', () => {
  const sim = runScript(loadScenario('shore'));
  const shore = events(sim, 'shore');

  it('SHR-1: the link follows its schedule, and each change is logged', () => {
    expect(shoreLinkUp(29)).toBe(false);
    expect(shoreLinkUp(30)).toBe(true);
    expect(shoreLinkUp(90)).toBe(false);
    expect(shoreLinkUp(210)).toBe(true);
    expect(shore.filter((e) => /^shore link/.test(e.text)).map((e) => [e.tick, e.text])).toEqual([
      [30, 'shore link up'],
      [90, 'shore link down'],
      [210, 'shore link up'],
      [270, 'shore link down'],
      [390, 'shore link up'],
      [450, 'shore link down'],
    ]);
  });

  it('20. climatology issued while the link is down waits, crosses when it is up, and commits between runs', () => {
    expect(shore.find((e) => e.text === 'shore issued climatology v2')!.tick).toBe(TIMING.climatologyIssue.first);
    const rx = shore.find((e) => e.text === 'climatology v2 received into the inbox')!;
    expect(rx.tick).toBe(210);
    const commit = events(sim, 'commit').find((e) => e.text.startsWith('climatology v2'))!;
    expect(commit.tick).toBeGreaterThanOrEqual(rx.tick);
    const runs = sim.orchestrator.history;
    expect(runs.some((r) => r.startedAt <= commit.tick && commit.tick < r.endedAt)).toBe(false);
    expect(sim.netcdf.climatologyVersion).toBe(2);
  });

  it('21. bundles written while the link is down wait, then all go, oldest first', () => {
    const written = events(sim, 'export').filter((e) => /→ outbox$/.test(e.text)).map((e) => e.text.split(':')[0]);
    const sent = shore.filter((e) => / sent to shore$/.test(e.text));
    expect(written.length).toBeGreaterThanOrEqual(3);
    expect(sent.every((e) => shoreLinkUp(e.tick))).toBe(true);
    expect(sent.map((e) => e.text.split(' ')[0])).toEqual(written.slice(0, sent.length));
    expect(sim.shore.received.map((b) => b.id)).toEqual(written.slice(0, sent.length));
  });

  it('SHR-6: the sync agent writes only the transfer area; the importer and exporter are reached only through shims', () => {
    expect(EDGES.filter((e) => e.from === 'shoreSync' && e.kind === 'write').map((e) => e.to)).toEqual(['transferArea']);
    for (const m of ['climatologyImporter', 'shoreExporter']) {
      expect(EDGES.filter((e) => e.to === m && e.kind === 'call').map((e) => e.from)).toEqual([m === 'shoreExporter' ? 'shimExport' : 'shimImport']);
      const parent = ELEMENTS.find((e) => e.id === m)!.parent;
      expect(ELEMENTS.find((e) => e.id === parent)!.kind).toBe('asset');
    }
  });
});
