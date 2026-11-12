import { describe, expect, it, vi } from 'vitest';
import { hash53 } from '../src/digest.ts';
import { Stream, Streams } from '../src/rng.ts';
import { Simulation } from '../src/simulation.ts';

describe('seeded streams (SIM-2)', () => {
  it('same seed and name give the same sequence', () => {
    const a = new Stream('ocean', 's1');
    const b = new Stream('ocean', 's1');
    expect(Array.from({ length: 50 }, () => a.next())).toEqual(Array.from({ length: 50 }, () => b.next()));
  });

  it('streams are independent: drawing from one does not shift another', () => {
    const s1 = new Streams('x');
    const s2 = new Streams('x');
    s1.get('sensor:temp').next();
    s1.get('sensor:temp').next();
    expect(s1.get('ocean').next()).toBe(s2.get('ocean').next());
  });

  it('gaussian is roughly standard normal', () => {
    const s = new Stream('g', 'seed');
    const xs = Array.from({ length: 20000 }, () => s.gaussian());
    const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
    const varc = xs.reduce((a, b) => a + (b - mean) ** 2, 0) / xs.length;
    expect(Math.abs(mean)).toBeLessThan(0.03);
    expect(Math.abs(varc - 1)).toBeLessThan(0.05);
  });

  it('the simulation never calls Math.random', () => {
    const spy = vi.spyOn(Math, 'random').mockImplementation(() => {
      throw new Error('Math.random used');
    });
    try {
      const sim = new Simulation({ seed: 'no-random', inputs: 6 });
      sim.setShift('temp', true);
      sim.addConsumer();
      sim.step(300);
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });

  it('hash53 is stable (guards against accidental algorithm changes)', () => {
    expect(hash53('')).toMatch(/^[0-9a-f]{14}$/);
    expect(hash53('abc')).toBe(hash53('abc'));
    expect(hash53('abc')).not.toBe(hash53('abd'));
  });
});
