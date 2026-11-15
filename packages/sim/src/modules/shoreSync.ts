/**
 * Shore sync agent (ours, not orchestrated): SHR-2, SHR-5. While the link is up it brings verified
 * climatology into the inbox and sends outbox bundles to shore, oldest first, one per tick. It moves
 * files only: the transfer area is the only store it writes.
 */
import type { ClimatologyFile, ExportBundle } from '../contracts.ts';

export interface ShoreEnd {
  /** Climatology files shore has issued and not yet delivered. */
  collect(): readonly ClimatologyFile[];
  receive(b: ExportBundle): void;
}
export interface TransferStore {
  putInbox(f: ClimatologyFile): void;
  takeOutbox(): ExportBundle | undefined;
}

export class ShoreSync {
  constructor(
    private readonly shore: ShoreEnd,
    private readonly area: TransferStore,
  ) {}

  /** One tick with the link up. Returns what moved. */
  sync(): { received: readonly ClimatologyFile[]; sent?: ExportBundle } {
    const received = this.shore.collect();
    for (const f of received) this.area.putInbox(f);
    const sent = this.area.takeOutbox();
    if (sent) this.shore.receive(sent);
    return { received, ...(sent ? { sent } : {}) };
  }
}
