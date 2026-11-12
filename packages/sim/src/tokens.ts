/** SIM-6: token records for every interaction on a declared edge. */
import type { EventLog } from './events.ts';
import { EDGE_IDS } from './topology/elements.ts';

export interface Token {
  readonly seq: number;
  readonly edge: string;
  readonly start: number;
  readonly duration: number;
  readonly retry?: boolean;
  /** Consumer instance for template edges (e.g. 'C2'). */
  readonly instance?: string;
}

export interface EdgeStat {
  readonly count: number;
  readonly last: number;
}

export interface EmitOptions {
  duration?: number;
  retry?: boolean;
  instance?: string;
}

const KEEP_TICKS = 60;

export class TokenRecorder {
  private seq = 0;
  private recent: Token[] = [];
  private readonly stats = new Map<string, EdgeStat>();
  readonly defects: string[] = [];

  constructor(
    private readonly log: EventLog,
    private readonly now: () => number,
  ) {}

  emit(edge: string, opts: EmitOptions = {}): void {
    const tick = this.now();
    if (!EDGE_IDS.has(edge)) {
      const msg = `token on undeclared edge ${edge}`;
      this.defects.push(msg);
      this.log.append(tick, 'defect', msg);
      return;
    }
    const t: Token = { seq: ++this.seq, edge, start: tick, duration: opts.duration ?? 1, ...(opts.retry ? { retry: true } : {}), ...(opts.instance ? { instance: opts.instance } : {}) };
    this.recent.push(t);
    const s = this.stats.get(edge);
    this.stats.set(edge, { count: (s?.count ?? 0) + 1, last: tick });
  }

  prune(): void {
    const cutoff = this.now() - KEEP_TICKS;
    if (this.recent.length && this.recent[0]!.start < cutoff) this.recent = this.recent.filter((t) => t.start >= cutoff);
  }

  /** Tokens started in the last KEEP_TICKS ticks. */
  get tokens(): readonly Token[] {
    return this.recent;
  }
  /** MOT-2: "n · last time" per edge. */
  get edgeStats(): ReadonlyMap<string, EdgeStat> {
    return this.stats;
  }
  get total(): number {
    return this.seq;
  }
}
