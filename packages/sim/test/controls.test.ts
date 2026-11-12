import { describe, expect, it } from 'vitest';
import { Simulation } from '../src/simulation.ts';

describe('control API bounds (DRF-3, SIM-3)', () => {
  const sim = new Simulation({ seed: 'c', inputs: 4 });

  it('threshold 1–6σ in steps of 0.5', () => {
    expect(() => sim.setThreshold(0.5)).toThrow(RangeError);
    expect(() => sim.setThreshold(6.5)).toThrow(RangeError);
    expect(() => sim.setThreshold(2.25)).toThrow(RangeError);
    sim.setThreshold(4.5);
    expect(sim.snapshot().drift.threshold).toBe(4.5);
  });

  it('quorum 1–N inputs', () => {
    expect(() => sim.setQuorum(0)).toThrow(RangeError);
    expect(() => sim.setQuorum(5)).toThrow(RangeError);
    sim.setQuorum(4);
    expect(sim.snapshot().drift.quorum).toBe(4);
  });

  it('persistence 1–5 checks', () => {
    expect(() => sim.setPersistence(6)).toThrow(RangeError);
    sim.setPersistence(5);
    expect(sim.snapshot().drift.persistence).toBe(5);
  });

  it('noise 0–3σ, known inputs only', () => {
    expect(() => sim.setNoise('temp', 3.1)).toThrow(RangeError);
    expect(() => sim.setNoise('turb', 1)).toThrow(RangeError); // only 4 inputs enabled
    sim.setNoise('temp', 3);
  });

  it('input count 3–6', () => {
    expect(() => new Simulation({ seed: 'x', inputs: 2 })).toThrow(RangeError);
    expect(() => new Simulation({ seed: 'x', inputs: 7 })).toThrow(RangeError);
    expect(new Simulation({ seed: 'x', inputs: 6 }).inputs).toHaveLength(6);
  });

  it('every control action is logged', () => {
    const s = new Simulation({ seed: 'log' });
    const n = s.log.count;
    s.failNextRun();
    s.setOffline('featureDetector', true);
    expect(s.log.entries.slice(n).map((e) => e.kind)).toEqual(['control', 'control']);
  });
});
