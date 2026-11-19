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
