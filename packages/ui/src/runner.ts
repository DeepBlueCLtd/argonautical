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
  /** Second, third… read a caller sent in the same tick: drawn just behind the first, alongside it. */
  readonly abreast?: number;
}

/** One gathering of a reader's inputs: begins with its first request of a tick (MOT-7). */
interface Gathering {
  readonly tick: number;
  readonly start: number;
  readonly fills: Map<InputSlot, { at: number; token: Token }>;
  /** When the last leg of any of these reads lands (wall seconds). */
  lastAt: number;
}

export type SlotState = { state: 'awaiting' } | { state: 'filled'; token: Token };

/** Lineage signals (MOT-8), wall seconds at any speed: a release sweeps then flashes; a check is a brief light sweep. */
const SIGNAL_WALL = { release: 2.4, check: 1.4 } as const;
/** When a release's sweep reaches the arrowhead (fraction of its time); what it releases starts then. */
const RELEASE_LANDS = 0.65;

const LINEAGE = new Set(EDGES.filter((e) => e.kind === 'lineage').map((e) => e.id));
/** Orchestrator → module calls (via a shim): the module's reads leave only once its call has arrived. */
const CALLS = new Set(EDGES.filter((e) => e.kind === 'call').map((e) => e.id));
/** MOT-1: minimum on-screen time, in wall-clock seconds, at any speed. */
const MIN_WALL = { lineage: 1.2, other: 0.6 };
/** The four legs of a pygeoapi read play one after another, each this long (wall seconds), so a round trip takes ~8 s at any speed. */
const LEG = 2.0;
/** Reading a NetCDF file (xarray) is slower than a SQL query, so its store legs take longer and its reply comes back later. */
const NETCDF_LEG = 3.5;
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
  /** Where the current round trip has got to: when its next leg leaves (wall seconds). */
  private legCursor = 0;
  /** Which of the caller's same-tick reads the current round trip is (0 = the first). */
  private abreast = 0;
  /** After a release or a call, the rest of that tick's tokens wait until it lands, so cause visibly precedes effect. */
  private hold = { tick: -1, at: 0 };
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
    this.hold = { tick: -1, at: 0 };
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
      // Round trips through pygeoapi: each leg leaves when the previous one arrives. Several reads by
      // the same caller in the same tick leave together, side by side, and the slower NetCDF reads
      // come back later than SQL ones, so the replies arrive staggered.
      let dur: number;
      const now = t.start === this.hold.tick ? Math.max(this.anim, this.hold.at) : this.anim;
      let born = now;
      let abreast = 0;
      if (t.role) {
        if (t.role === 'request') {
          const key = `${t.edge}#${t.instance ?? ''}#${t.start}`;
          const n = this.exchangesThisTick.get(key) ?? 0;
          this.exchangesThisTick.set(key, n + 1);
          // All leave together; the diagram draws the nth a few pixels behind the first.
          this.legCursor = now;
          this.abreast = n;
        }
        dur = (t.role === 'db-query' || t.role === 'db-rows') && t.edge.startsWith('netcdfStore>') ? NETCDF_LEG : LEG;
        born = this.legCursor;
        this.legCursor += dur;
        abreast = this.abreast;
      } else if (t.signal) {
        dur = SIGNAL_WALL[t.signal];
        if (t.signal === 'release') this.hold = { tick: t.start, at: now + dur * RELEASE_LANDS };
      } else {
        dur = Math.max(t.duration * secondsPerTick, lineage ? MIN_WALL.lineage : MIN_WALL.other);
        // The module starts work (and sends its reads) when the call lands, not when it leaves.
        if (CALLS.has(t.edge)) this.hold = { tick: t.start, at: now + dur };
      }
      const key = `${t.edge}#${t.instance ?? ''}#${t.role ?? ''}`;
      const same = this.visuals.filter((v) => `${v.token.edge}#${v.token.instance ?? ''}#${v.token.role ?? ''}` === key);
      if (same.length >= MAX_PER_EDGE) this.visuals.splice(this.visuals.indexOf(same[0]!), 1);
      this.visuals.push({ token: t, born, dur, lineage, ...(abreast ? { abreast } : {}) });
      if (t.role) this.gather(t, born, dur);
    }
  }

  /** A reader's first request in a tick empties its input slots; each response that fills one lands when it arrives. */
  private gather(t: Token, born: number, dur: number): void {
    const reader = `${t.edge.split('>')[0]}#${t.instance ?? ''}`;
    const list = this.gatherings.get(reader) ?? [];
    let g = list[list.length - 1];
    if (t.role === 'request' && (!g || g.tick !== t.start)) {
      g = { tick: t.start, start: born, fills: new Map(), lastAt: born + dur };
      list.push(g);
      if (list.length > 3) list.shift();
      this.gatherings.set(reader, list);
    }
    if (!g) return;
    g.lastAt = Math.max(g.lastAt, born + dur);
    if (t.slot) g.fills.set(t.slot, { at: born + dur, token: t });
  }

  /**
   * True while the reader's latest reads are still on screen: requests out, replies not yet back.
   * The diagram shows "retrieving data" until then, so a step never looks busy before its inputs arrive.
   */
  readsPending(element: string, instance?: string): boolean {
    const list = this.gatherings.get(`${element}#${instance ?? ''}`) ?? [];
    const g = list[list.length - 1];
    return !!g && this.anim < g.lastAt;
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
