/**
 * Shore exporter (ours, inside the shore_export asset): SHR-4. Reads new data through pygeoapi (the only
 * read path) and writes one signed bundle to the transfer area's outbox.
 */
import { hash53 } from '../digest.ts';
import type { ExportBundle, Feature, Forecast, Observation } from '../contracts.ts';

export interface ExportReader {
  observationsSince(tick: number): readonly Observation[];
  latestForecast(): Forecast | undefined;
  /** Undefined when the forecast has no features (no detector ran). */
  features(forecastId: string): readonly Feature[] | undefined;
}
export interface OutboxWriter {
  put(b: ExportBundle): void;
}

export class ShoreExporter {
  private cursor = 0;
  private seq = 0;
  constructor(
    private readonly reader: ExportReader,
    private readonly writer: OutboxWriter,
  ) {}

  export(now: number): ExportBundle {
    const obs = this.reader.observationsSince(this.cursor);
    const f = this.reader.latestForecast();
    const feats = f ? this.reader.features(f.id) : undefined;
    const toTick = obs.length ? obs[obs.length - 1]!.tick : this.cursor;
    const body = { from: this.cursor, to: toTick, n: obs.length, f: f?.digest ?? '', k: feats?.length ?? -1 };
    const b: ExportBundle = {
      id: `B${++this.seq}`,
      createdAt: now,
      fromTick: this.cursor,
      toTick,
      observations: obs.length,
      ...(f ? { forecastId: f.id } : {}),
      ...(feats !== undefined ? { featureCount: feats.length } : {}),
      digest: hash53(JSON.stringify(body)),
    };
    this.writer.put(b);
    this.cursor = toTick;
    return b;
  }
}
