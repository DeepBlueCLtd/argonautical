/** Onboard instruments: each input has its own noise stream and noise level. */
import type { InputSpec } from '../config.ts';
import { NUMERICS } from '../config.ts';
import type { Streams } from '../rng.ts';
import type { Ocean } from './ocean.ts';

export class Sensors {
  readonly noise = new Map<string, number>();
  last: Record<string, number> = {};

  constructor(
    private readonly inputs: readonly InputSpec[],
    private readonly ocean: Ocean,
    private readonly streams: Streams,
  ) {
    for (const s of inputs) this.noise.set(s.key, NUMERICS.defaultNoiseSigma);
  }

  sample(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const s of this.inputs) {
      const rng = this.streams.get(`sensor:${s.key}`);
      const n = this.noise.get(s.key) ?? 0;
      let v = this.ocean.truth(s.key) + s.sigma * n * rng.gaussian();
      const g = rng.next();
      if (g < NUMERICS.nanGlitchRate) v = NaN;
      else if (g < NUMERICS.nanGlitchRate + NUMERICS.wildGlitchRate) v = s.base + NUMERICS.wildGlitchSigma * s.sigma;
      out[s.key] = v;
    }
    this.last = out;
    return out;
  }
}
