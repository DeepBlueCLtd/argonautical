/**
 * Climatology importer (ours, inside the climatology asset): SHR-3. Takes the oldest verified file from
 * the transfer area's inbox and commits it to the NetCDF store (stage + manifest swap).
 */
import type { ClimatologyFile } from '../contracts.ts';

export interface InboxReader {
  /** Removes and returns the oldest file in the inbox, if any. */
  take(): ClimatologyFile | undefined;
}
export interface ClimatologyWriter {
  commitClimatology(f: ClimatologyFile): void;
}

export class ClimatologyImporter {
  constructor(
    private readonly inbox: InboxReader,
    private readonly writer: ClimatologyWriter,
  ) {}

  import(): ClimatologyFile | undefined {
    const f = this.inbox.take();
    if (f) this.writer.commitClimatology(f);
    return f;
  }
}
