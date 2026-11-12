/** The real environment (not our system). */
import type { InputSpec } from '../config.ts';
import { NUMERICS, TIMING } from '../config.ts';
import type { Stream } from '../rng.ts';

export class Ocean {
  /** Natural anomaly per input, in σ. */
  private readonly anomaly = new Map<string, number>();
  /** Scenario shift currently applied, in σ (ramps towards target). */
  private readonly shift = new Map<string, number>();
  private readonly shiftTarget = new Map<string, number>();

  constructor(
    private readonly inputs: readonly InputSpec[],
    private readonly rng: Stream,
  ) {
    for (const s of inputs) {
      this.anomaly.set(s.key, 0);
      this.shift.set(s.key, 0);
      this.shiftTarget.set(s.key, 0);
    }
  }

  setShift(key: string, on: boolean): void {
    this.shiftTarget.set(key, on ? TIMING.shiftSigma : 0);
  }
  shiftOn(key: string): boolean {
    return (this.shiftTarget.get(key) ?? 0) !== 0;
  }

  step(): void {
    const rate = TIMING.shiftSigma / TIMING.shiftRampTicks;
    for (const s of this.inputs) {
      const a = this.anomaly.get(s.key) ?? 0;
      this.anomaly.set(s.key, a - NUMERICS.oceanReversion * a + NUMERICS.oceanStep * this.rng.gaussian());
      const cur = this.shift.get(s.key) ?? 0;
      const tgt = this.shiftTarget.get(s.key) ?? 0;
      this.shift.set(s.key, cur < tgt ? Math.min(tgt, cur + rate) : Math.max(tgt, cur - rate));
    }
  }

  truth(key: string): number {
    const s = this.inputs.find((x) => x.key === key);
    if (!s) throw new Error(`unknown input ${key}`);
    return s.base + s.sigma * ((this.anomaly.get(key) ?? 0) + (this.shift.get(key) ?? 0));
  }

  /** Current shift in σ, for display. */
  shiftSigma(key: string): number {
    return this.shift.get(key) ?? 0;
  }
}
