/**
 * Owns the wall clock: run/pause, step, rate, and token animation timing.
 * It drives the simulation only through its control API and step() (ARC-4).
 */
import { EDGES, Simulation, type ControlAction, type Token } from '@argonautical/sim';

export type Rate = 0.5 | 1 | 10 | 60;
/** Default speed: half real time, so a live audience can follow each step. */
export const DEFAULT_RATE: Rate = 0.5;

export interface VisualToken {
  readonly token: Token;
  readonly born: number;
  readonly dur: number;
  readonly lineage: boolean;
}

const LINEAGE = new Set(EDGES.filter((e) => e.kind === 'lineage').map((e) => e.id));
/** MOT-1: minimum on-screen time, in wall-clock seconds, at any speed. */
const MIN_WALL = { lineage: 1.2, other: 0.6 };
/** The four legs of a pygeoapi read play one after another, each this long (wall seconds), so a round trip takes ~4.8 s at any speed. */
const LEG = 1.2;
const LEG_ORDER: Record<string, number> = { request: 0, 'db-query': 1, 'db-rows': 2, response: 3 };
/** Cap concurrent tokens per edge instance so 60× stays readable. */
const MAX_PER_EDGE = 4;
/** Longest wall-clock gap we will catch up on (e.g. after a background tab). */
const MAX_FRAME = 0.25;

export class Runner {
  sim: Simulation;
  rate: Rate = DEFAULT_RATE;
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

  /** Advance exactly one tick and let its tokens fly part-way, then stay paused so they can be inspected. */
  step(): void {
    this.running = false;
    this.sim.step();
    this.frac = 0;
    this.ingestTokens();
    // Stop tokens mid-flight (25–50% along) rather than letting them finish and vanish.
    this.stepBudget = MIN_WALL.other / 2;
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
      // Round trips through pygeoapi: each leg starts when the previous one arrives.
      const leg = t.role ? LEG_ORDER[t.role] : undefined;
      const dur = leg !== undefined ? LEG : Math.max(t.duration * secondsPerTick, lineage ? MIN_WALL.lineage : MIN_WALL.other);
      const born = this.anim + (leg ?? 0) * LEG;
      const key = `${t.edge}#${t.instance ?? ''}#${t.role ?? ''}`;
      const same = this.visuals.filter((v) => `${v.token.edge}#${v.token.instance ?? ''}#${v.token.role ?? ''}` === key);
      if (same.length >= MAX_PER_EDGE) this.visuals.splice(this.visuals.indexOf(same[0]!), 1);
      this.visuals.push({ token: t, born, dur, lineage });
    }
  }

  /** Paused with nothing left to animate: tokens are frozen and can be clicked. */
  get frozen(): boolean {
    return !this.running && this.stepBudget <= 0;
  }

  /** Tokens in flight with their progress 0–1. */
  get tokens(): { v: VisualToken; p: number }[] {
    // Legs not yet started (born in the future) are not shown.
    return this.visuals.filter((v) => this.anim >= v.born).map((v) => ({ v, p: Math.min(1, (this.anim - v.born) / v.dur) }));
  }
}
