import { hash32 } from './digest.ts';

/**
 * Seeded, named random streams (SIM-2). No Math.random anywhere.
 *
 * Gaussian samples use the Irwin–Hall approximation (sum of 12 uniforms − 6)
 * rather than Box–Muller, so no transcendental functions are involved and the
 * results are bit-identical across JS engines (browser vs Node replay, ARC-5).
 */
export class Stream {
  private state: number;
  constructor(readonly name: string, seed: string) {
    this.state = hash32(`${seed}::${name}`) || 0x9e3779b9;
  }
  /** Uniform in [0, 1). mulberry32. */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  /** Approximately standard normal, range (−6, 6). */
  gaussian(): number {
    let s = 0;
    for (let i = 0; i < 12; i++) s += this.next();
    return s - 6;
  }
  /** Integer in [min, max]. */
  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }
  chance(p: number): boolean {
    return this.next() < p;
  }
}

export class Streams {
  private readonly streams = new Map<string, Stream>();
  constructor(readonly seed: string) {}
  get(name: string): Stream {
    let s = this.streams.get(name);
    if (!s) {
      s = new Stream(name, this.seed);
      this.streams.set(name, s);
    }
    return s;
  }
}
