/**
 * Shore support, at the far end of the intermittent shore link (SHR-1, SHR-2). Not our onboard system:
 * it issues climatology versions on a fixed schedule and receives export bundles.
 */
import { TIMING } from '../config.ts';
import type { ClimatologyFile, ExportBundle, Values } from '../contracts.ts';

export class Shore {
  /** Issued, not yet collected by the sync agent. */
  private pending: ClimatologyFile[] = [];
  private version = 1;
  readonly received: ExportBundle[] = [];

  constructor(private readonly values: () => Values) {}

  /** SHR-2: issue on schedule. Returns the file issued this tick, if any. */
  tick(t: number): ClimatologyFile | undefined {
    const c = TIMING.climatologyIssue;
    if (t < c.first || (t - c.first) % c.every !== 0) return undefined;
    const f: ClimatologyFile = { version: ++this.version, issuedAt: t, values: this.values() };
    this.pending.push(f);
    return f;
  }

  get waiting(): readonly ClimatologyFile[] {
    return this.pending;
  }

  collect(): readonly ClimatologyFile[] {
    const out = this.pending;
    this.pending = [];
    return out;
  }

  receive(b: ExportBundle): void {
    this.received.push(b);
  }
}
