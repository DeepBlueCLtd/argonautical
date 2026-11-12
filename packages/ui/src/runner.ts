/**
 * Owns the wall clock: run/pause, step, rate, and token animation timing.
 * It drives the simulation only through its control API and step() (ARC-4).
 */
import { EDGES, Simulation, type ControlAction, type Token } from '@argonautical/sim';

export type Rate = 1 | 10 | 60;

export interface VisualToken {
  readonly token: Token;
  readonly born: number;
  readonly dur: number;
  readonly lineage: boolean;
}

const LINEAGE = new Set(EDGES.filter((e) => e.kind === 'lineage').map((e) => e.id));
/** MOT-1: minimum on-screen time, in wall-clock seconds, at any speed. */
const MIN_WALL = { lineage: 1.2, other: 0.6 };
/** Cap concurrent tokens per edge instance so 60× stays readable. */
const MAX_PER_EDGE = 4;
/** Longest wall-clock gap we will catch up on (e.g. after a background tab). */
const MAX_FRAME = 0.25;

export class Runner {
  sim: Simulation;
  rate: Rate = 1;
  running = true;
  /** Animation clock in wall seconds; stops when paused (acceptance 10). */
  anim = 0;
  /** Fraction of the next tick elapsed, for smooth countdowns. */
  frac = 0;
  private stepBudget = 0;
  private lastSeq = 0;
  private visuals: VisualToken[] = [];
  private listeners = new Set<() => void>();

  constructor(
    public seed: string,
    public inputs: number,
  ) {
    this.sim = new Simulation({ seed, inputs });
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  private emit(): void {
    for (const fn of this.listeners) fn();
  }

  restart(seed: string, inputs: number): void {
    this.seed = seed;
    this.inputs = inputs;
    this.sim = new Simulation({ seed, inputs });
    this.visuals = [];
    this.lastSeq = 0;
    this.frac = 0;
    this.emit();
  }

  apply(action: ControlAction): void {
    this.sim.apply(action);
    this.ingestTokens();
    this.emit();
  }

  setRunning(on: boolean): void {
    this.running = on;
    this.emit();
  }

  setRate(rate: Rate): void {
    this.rate = rate;
    this.emit();
  }

  /** Advance exactly one tick and let its tokens animate, then stay paused. */
  step(): void {
    this.running = false;
    this.sim.step();
    this.frac = 0;
    this.ingestTokens();
    this.stepBudget = Math.max(1 / this.rate, MIN_WALL.lineage);
    this.emit();
  }

  frame(dtWall: number): void {
    const dt = Math.min(dtWall, MAX_FRAME);
    let animDt = 0;
    if (this.running) {
      animDt = dt;
      this.frac += dt * this.rate;
      let n = Math.floor(this.frac);
      this.frac -= n;
      while (n-- > 0) {
        this.sim.step();
        this.ingestTokens();
      }
    } else if (this.stepBudget > 0) {
      animDt = Math.min(dt, this.stepBudget);
      this.stepBudget -= animDt;
    }
    this.anim += animDt;
    this.visuals = this.visuals.filter((v) => this.anim - v.born < v.dur);
  }

  private ingestTokens(): void {
    const secondsPerTick = 1 / this.rate;
    for (const t of this.sim.tokens.tokens) {
      if (t.seq <= this.lastSeq) continue;
      this.lastSeq = t.seq;
      const lineage = LINEAGE.has(t.edge);
      const dur = Math.max(t.duration * secondsPerTick, lineage ? MIN_WALL.lineage : MIN_WALL.other);
      const key = `${t.edge}#${t.instance ?? ''}`;
      const same = this.visuals.filter((v) => `${v.token.edge}#${v.token.instance ?? ''}` === key);
      if (same.length >= MAX_PER_EDGE) this.visuals.splice(this.visuals.indexOf(same[0]!), 1);
      this.visuals.push({ token: t, born: this.anim, dur, lineage });
    }
  }

  /** Tokens in flight with their progress 0–1. */
  get tokens(): { v: VisualToken; p: number }[] {
    return this.visuals.map((v) => ({ v, p: Math.min(1, (this.anim - v.born) / v.dur) }));
  }
}
