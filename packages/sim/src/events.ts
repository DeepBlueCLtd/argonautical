import { hash53 } from './digest.ts';

export type EventKind =
  | 'control'
  | 'ingest'
  | 'drift'
  | 'request'
  | 'run'
  | 'fail'
  | 'retry'
  | 'commit'
  | 'detect'
  | 'announce'
  | 'consumer'
  | 'materialise'
  | 'defect';

export interface LogEvent {
  readonly tick: number;
  readonly kind: EventKind;
  readonly text: string;
}

/** SIM-5: append-only event log with a rolling digest for replay comparison. */
export class EventLog {
  private readonly items: LogEvent[] = [];
  private rolling = '00000000000000';

  append(tick: number, kind: EventKind, text: string): void {
    const e: LogEvent = { tick, kind, text };
    this.items.push(e);
    this.rolling = hash53(`${this.rolling}|${tick}|${kind}|${text}`);
  }
  get entries(): readonly LogEvent[] {
    return this.items;
  }
  get count(): number {
    return this.items.length;
  }
  get digest(): string {
    return this.rolling;
  }
}

export function clockLabel(tick: number): string {
  const m = Math.floor(tick / 60);
  const s = tick % 60;
  return `T+${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}
