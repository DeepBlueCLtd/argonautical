/** Issue #35: a triggered run starts on screen only once its RunRequest has visibly arrived. */
import { describe, expect, it } from 'vitest';
import { Runner } from '../src/runner.ts';

/** Run the wall clock in small frames, calling `look` after each. */
function play(r: Runner, seconds: number, look: () => void) {
  for (let i = 0; i < seconds * 50; i++) {
    r.frame(0.02);
    look();
  }
}

describe('trigger timing (issue #35)', () => {
  it('a drift RunRequest leaves after the drift monitor’s reads are back, and the run shows only once it lands', () => {
    const r = new Runner('demo', 4);
    r.running = true;
    // Let the first (schedule) run finish, then push every input off the forecast so the drift sensor fires.
    play(r, 120, () => {});
    for (const s of r.sim.snapshot().inputs) r.apply({ type: 'shift', input: s.key, on: true });
    let checked = 0;
    let gatedSeen = false;
    play(r, 240, () => {
      const snap = r.sim.snapshot();
      const trig = r.tokens.find(({ v }) => v.token.edge === 'driftSensor>trigger>forecast');
      if (trig) {
        // While the RunRequest is in flight the drift monitor's reads are back...
        expect(r.readsPending('driftMonitor')).toBe(false);
        // ...and the run it starts is not yet shown, nor is its run call under way.
        if (snap.run && trig.p < 1) {
          expect(r.visibleRun(snap)).toBeUndefined();
          expect(r.tokens.some(({ v }) => v.token.edge === 'shimRun>call>modelRunner' && v.token.start === trig.v.token.start)).toBe(false);
          gatedSeen = true;
        }
        checked++;
      }
    });
    expect(checked).toBeGreaterThan(0);
    expect(gatedSeen).toBe(true);
  });
});

describe('announcement timing', () => {
  it('the broker delivers only once the publish has reached it, and consumers read only after delivery', () => {
    const r = new Runner('demo', 4);
    r.running = true;
    let publish: { born: number; dur: number } | undefined;
    let deliveries = 0;
    let reads = 0;
    play(r, 60, () => {
      for (const { v } of r.tokens) {
        const e = v.token.edge;
        if (e === 'announcer>publish>broker') publish ??= { born: v.born, dur: v.dur };
        if (!publish) continue;
        const lands = publish.born + publish.dur;
        if (e === 'broker>deliver>consumer' && v.token.start >= 16) {
          expect(v.born).toBeGreaterThanOrEqual(lands - 1e-6);
          deliveries++;
        }
        if (e === 'consumer>query>pygeoapi' && v.token.role === 'request') {
          expect(v.born).toBeGreaterThanOrEqual(lands + v.dur - 1e-6);
          reads++;
        }
      }
    });
    expect(publish).toBeDefined();
    expect(deliveries).toBeGreaterThan(0);
    expect(reads).toBeGreaterThan(0);
  });
});
