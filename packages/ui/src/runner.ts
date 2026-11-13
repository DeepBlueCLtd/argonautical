/**
 * Owns the wall clock: run/pause, step, rate, and token animation timing.
 * It drives the simulation only through its control API and step() (ARC-4).
 */
import { EDGES, Simulation, type ControlAction, type InputSlot, type Token } from '@argonautical/sim';

export type Rate = 0.5 | 1 | 10 | 60;
/** Default speed: half real time, so a live audience can follow each step. */
export const DEFAULT_RATE: Rate = 0.5;

export interface VisualToken {
  readonly token: Token;
  readonly born: number;
  readonly dur: number;
  readonly lineage: boolean;
}

/** One gathering of a reader's inputs: begins with its first request of a tick (MOT-7). */
interface Gathering {
  readonly tick: number;
  readonly start: number;
  readonly fills: Map<InputSlot, { at: number; token: Token }>;
}

export type SlotState = { state: 'awaiting' } | { state: 'filled'; token: Token };

const LINEAGE = new Set(EDGES.filter((e) => e.kind === 'lineage').map((e) => e.id));
/** MOT-1: minimum on-screen time, in wall-clock seconds, at any speed. */
const MIN_WALL = { lineage: 1.2, other: 0.6 };
/** The four legs of a pygeoapi read play one after another, each this long (wall seconds), so a round trip takes ~8 s at any speed. */
const LEG = 2.0;
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
  /** Sequencing of pygeoapi reads made by one caller within one tick. */
  private exchangesThisTick = new Map<string, number>();
  private exchangeOffset = 0;
  private listeners = new Set<() => void>();
  /** Per reader (element#instance): the latest gathering and the one before it. */
  private gatherings = new Map<string, Gathering[]>();

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
    this.exchangesThisTick.clear();
    this.gatherings.clear();
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
    if (this.exchangesThisTick.size > 200) this.exchangesThisTick.clear();
    for (const t of this.sim.tokens.tokens) {
      if (t.seq <= this.lastSeq) continue;
      this.lastSeq = t.seq;
      const lineage = LINEAGE.has(t.edge);
      // Round trips through pygeoapi: each leg starts when the previous one arrives, and several
      // reads by the same caller in the same tick play one after another (a second request leaves
      // once the first response is back), so separate requests never look like one fanning out.
      const leg = t.role ? LEG_ORDER[t.role] : undefined;
      if (t.role === 'request') {
        const key = `${t.edge}#${t.instance ?? ''}#${t.start}`;
        const n = this.exchangesThisTick.get(key) ?? 0;
        this.exchangesThisTick.set(key, n + 1);
        this.exchangeOffset = n * 4 * LEG;
      }
      const dur = leg !== undefined ? LEG : Math.max(t.duration * secondsPerTick, lineage ? MIN_WALL.lineage : MIN_WALL.other);
      const born = this.anim + (leg !== undefined ? this.exchangeOffset + leg * LEG : 0);
      const key = `${t.edge}#${t.instance ?? ''}#${t.role ?? ''}`;
      const same = this.visuals.filter((v) => `${v.token.edge}#${v.token.instance ?? ''}#${v.token.role ?? ''}` === key);
      if (same.length >= MAX_PER_EDGE) this.visuals.splice(this.visuals.indexOf(same[0]!), 1);
      this.visuals.push({ token: t, born, dur, lineage });
      if (t.role === 'request' || t.slot) this.gather(t, born, dur);
    }
  }

  /** A reader's first request in a tick empties its input slots; each response that fills one lands when it arrives. */
  private gather(t: Token, born: number, dur: number): void {
    const reader = `${t.edge.split('>')[0]}#${t.instance ?? ''}`;
    const list = this.gatherings.get(reader) ?? [];
    let g = list[list.length - 1];
    if (t.role === 'request' && (!g || g.tick !== t.start)) {
      g = { tick: t.start, start: born, fills: new Map() };
      list.push(g);
      if (list.length > 3) list.shift();
      this.gatherings.set(reader, list);
    }
    if (t.slot && g) g.fills.set(t.slot, { at: born + dur, token: t });
  }

  /** What a reader's input slot shows now: the document it last received, or pale while it waits for one. */
  slot(element: string, slot: InputSlot, instance?: string): SlotState {
    const list = this.gatherings.get(`${element}#${instance ?? ''}`) ?? [];
    // The newest gathering under way (one whose first request has not yet left does not count).
    const g = [...list].reverse().find((x) => this.anim >= x.start);
    // The newest document that has landed in this slot. It shows if it landed after that gathering
    // began: when reads overlap (faster rates) a slot fills late rather than never.
    let f: { at: number; token: Token } | undefined;
    for (const x of list) {
      const y = x.fills.get(slot);
      if (y && this.anim >= y.at && (!f || y.at > f.at)) f = y;
    }
    return g && f && f.at >= g.start ? { state: 'filled', token: f.token } : { state: 'awaiting' };
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
