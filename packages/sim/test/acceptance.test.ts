/** SRD §6 acceptance criteria that the simulation can prove headless. */
import { describe, expect, it } from 'vitest';
import { runScript } from '../src/scenario.ts';
import { Simulation } from '../src/simulation.ts';
import { events, loadScenario } from './helpers.ts';

describe('acceptance criteria', () => {
  it('1. same seed + same actions give identical digests; a different seed differs', () => {
    const s = loadScenario('drift');
    expect(runScript(s).digest).toBe(runScript(s).digest);
    expect(runScript({ ...s, seed: 'other' }).digest).not.toBe(runScript(s).digest);
  });

  it('3. a shift meeting quorum declares drift within threshold/persistence checks; the drift forecast is committed, detected, announced and every consumer reports ✓', () => {
    const sim = runScript(loadScenario('drift'));
    const declared = events(sim, 'drift').find((e) => e.text.startsWith('drift declared'));
    expect(declared).toBeDefined();
    // shift starts at 30 and needs ~12 s to pass 3σ, then quorum on 2 consecutive 4 s checks
    expect(declared!.tick).toBeLessThanOrEqual(30 + 12 + 2 * 4 + 4);
    const f = sim.netcdf.all.find((x) => x.cause === 'drift');
    expect(f).toBeDefined();
    expect(sim.featuresDb.byForecast(f!.id).length).toBeGreaterThan(0);
    expect(events(sim, 'announce').some((e) => e.text.startsWith(`announce ${f!.id}`))).toBe(true);
    for (const c of sim.consumers) {
      const r = c.results.find((x) => x.forecastId === f!.id);
      expect(r?.ok, c.id).toBe(true);
    }
  });

  it('4. with no drift, a scheduled run fires when the forecast countdown reaches 0:00', () => {
    const sim = runScript(loadScenario('schedule'));
    const f1 = sim.netcdf.byId('F1')!;
    const req = events(sim, 'request').filter((e) => e.text.includes('F1 stale'));
    expect(req).toHaveLength(1);
    expect(req[0]!.tick).toBe(f1.validUntil);
    expect(sim.netcdf.byId('F2')?.cause).toBe('schedule');
    expect(events(sim, 'drift').some((e) => e.text.startsWith('drift declared'))).toBe(false);
  });

  it('5. a request during a run queues; another merges into it and the log shows both causes', () => {
    const sim = runScript(loadScenario('queue-merge'));
    const req = events(sim, 'request').map((e) => e.text);
    expect(req.some((t) => /^drift request queued behind R1/.test(t))).toBe(true);
    expect(req.some((t) => t === 'manual request merged into queued run: drift + manual')).toBe(true);
    expect(events(sim, 'run').some((e) => e.text === 'R2 started (drift + manual) → F2')).toBe(true);
    expect(sim.netcdf.byId('F2')?.cause).toBe('drift + manual');
  });

  it('DRF-5: while a drift run is queued or running, persistent drift raises no new request', () => {
    const sim = runScript(loadScenario('queue-merge'));
    const r2 = sim.orchestrator.history.find((r) => r.id === 'R2')!;
    expect(r2.causes).toBe('drift + manual');
    const driftRequests = events(sim, 'request').filter((e) => e.text.startsWith('drift request'));
    expect(driftRequests.filter((e) => e.tick > r2.startedAt && e.tick <= r2.endedAt)).toEqual([]);
    expect(events(sim, 'drift').some((e) => e.text === 'drift monitor: drift persists, drift run in progress')).toBe(true);
  });

  it('5b. one run at a time', () => {
    const sim = new Simulation({ seed: 'busy' });
    let maxActive = 0;
    for (let i = 0; i < 200; i++) {
      if (i % 3 === 0) sim.requestRun();
      sim.step();
      maxActive = Math.max(maxActive, sim.orchestrator.active ? 1 : 0);
      const starts = events(sim, 'run').filter((e) => e.text.includes('started')).length;
      const ends = events(sim, 'run').filter((e) => e.text.includes('complete')).length;
      expect(starts - ends).toBeLessThanOrEqual(1);
    }
  });

  it('6. model runner offline: amber retry on 2, 4, 8, 10, 10 s backoff, no progress, nothing committed; back online, the next retry commits', () => {
    const s = loadScenario('runner-offline');
    let sawRetry = false;
    let sawProgressWhileOffline = false;
    const sim = runScript(s, (x) => {
      const snap = x.snapshot();
      if (x.tick > 22 && x.tick < 50) {
        if (snap.run?.retryIn !== undefined) sawRetry = true;
        if (snap.run?.progress) sawProgressWhileOffline = true;
        expect(snap.offline.modelRunner).toBe(true);
      }
    });
    const fails = events(sim, 'fail').map((e) => [e.tick, Number(/retry in (\d+)s/.exec(e.text)![1])]);
    expect(fails.map((f) => f[1])).toEqual([2, 4, 8, 10, 10]);
    expect(fails.map((f) => f[0])).toEqual([22, 24, 28, 36, 46]);
    expect(sawRetry).toBe(true);
    expect(sawProgressWhileOffline).toBe(false);
    expect(events(sim, 'commit').filter((e) => e.tick > 20 && e.tick < 56)).toHaveLength(0);
    const commit = events(sim, 'commit').find((e) => e.text.startsWith('F2 committed'));
    expect(commit?.tick).toBe(56 + 8);
    // MOT-4: retries send an amber token from the shim into the module
    const retryTokens = [...sim.tokens.tokens].filter((t) => t.edge === 'shimRun>call>modelRunner' && t.retry);
    expect(retryTokens.length).toBeGreaterThan(0);
    // MOT-4: lineage tokens are not re-sent on a retry
    expect(sim.tokens.edgeStats.get('climatology>lineage>forecast')!.count).toBe(2);
  });

  it('7. feature detector offline with the forecast already committed: retries until back, then announces', () => {
    const sim = runScript(loadScenario('detector-offline'));
    const commit = events(sim, 'commit').find((e) => e.text.startsWith('F2 committed'))!;
    const fails = events(sim, 'fail');
    expect(fails.length).toBeGreaterThanOrEqual(4);
    expect(fails.every((e) => e.text.includes('Feature detector failed (offline)'))).toBe(true);
    expect(fails[0]!.tick).toBe(commit.tick);
    expect(fails.map((e) => Number(/retry in (\d+)s/.exec(e.text)![1]))).toEqual([2, 4, 8, 10]);
    const ann = events(sim, 'announce').find((e) => e.text.startsWith('announce F2'));
    expect(ann!.tick).toBeGreaterThan(50);
    for (const c of sim.consumers) expect(c.latest).toMatchObject({ forecastId: 'F2', ok: true });
  });

  it('8. 3σ noise produces spike rejections with reasons; rejected values never reach the Observations DB', () => {
    const sim = runScript(loadScenario('noise'));
    const rejected = events(sim, 'ingest');
    expect(rejected.some((e) => e.text.includes('jump > 4σ from last accepted'))).toBe(true);
    for (const e of rejected) {
      const m = /^rejected (\w+) = (\S+): /.exec(e.text)!;
      const hit = sim.observationsDb.all.find((r) => r.tick === e.tick && r.input === m[1]);
      expect(hit, e.text).toBeUndefined();
    }
    expect(sim.observationsDb.all.every((r) => Number.isFinite(r.value))).toBe(true);
  });

  it('9. a consumer added after the first announcement shows the current forecast immediately', () => {
    const sim = runScript(loadScenario('late-consumer'));
    const c3 = sim.consumers.find((c) => c.id === 'C3')!;
    expect(c3.subscribedAt).toBe(40);
    expect(c3.results[0]).toMatchObject({ tick: 40, catchUp: true, ok: true, forecastId: sim.netcdf.latest!.id });
  });

  it('10. nothing changes without a step; step advances exactly one tick', () => {
    const sim = new Simulation({ seed: 'pause' });
    sim.step(25);
    const before = JSON.stringify(sim.snapshot());
    expect(JSON.stringify(sim.snapshot())).toBe(before);
    sim.step();
    expect(sim.tick).toBe(26);
  });

  it('12. store counts are read from the stored rows', () => {
    const sim = runScript(loadScenario('failures'));
    const snap = sim.snapshot();
    expect(snap.stores.observations).toBe(sim.observationsDb.all.length);
    expect(snap.stores.features).toBe(sim.featuresDb.all.length);
    expect(snap.stores.coverageFiles).toBe(1 + sim.netcdf.all.length);
    expect(snap.ingestion.accepted).toBe(sim.observationsDb.all.length);
  });
});

describe('robustness over a long run (FLT-2)', () => {
  const sim = runScript(loadScenario('failures'));

  it('an injected failure and random failures are retried and every run completes', () => {
    expect(events(sim, 'fail').some((e) => e.text.includes('injected failure'))).toBe(true);
    expect(events(sim, 'fail').some((e) => e.text.includes('random failure'))).toBe(true);
    const runs = sim.orchestrator.history;
    expect(runs.length).toBeGreaterThan(4);
    expect(runs.every((r) => r.endedAt >= r.startedAt)).toBe(true);
  });

  it('every consumer verifies every announcement it receives', () => {
    for (const c of sim.consumers) {
      expect(c.results.length, c.id).toBeGreaterThan(0);
      expect(c.results.every((r) => r.ok), c.id).toBe(true);
    }
  });

  it('a failed run commits nothing (MOD-1): forecast ids are contiguous and unique', () => {
    const ids = sim.netcdf.all.map((f) => f.id);
    expect(ids).toEqual(ids.map((_, i) => `F${i + 1}`));
  });

  it('MOD-2: the previous forecast is the background', () => {
    const all = sim.netcdf.all;
    expect(sim.netcdf.background).toBe(all[all.length - 2]);
  });
});
