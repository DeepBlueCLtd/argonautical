/** Our stores. Counts are always read from stored rows (acceptance 12). */
import { ServiceUnavailable, type ClimatologyFile, type ExportBundle, type Feature, type FeatureWriter, type Forecast, type ForecastWriter, type Observation, type ObservationWriter, type Values } from '../contracts.ts';

export class ObservationsDb implements ObservationWriter {
  private readonly rows: Observation[] = [];
  /** Presenter can stop and start the database (FLT-3). */
  up = true;
  append(rows: readonly Observation[]): void {
    if (!this.up) throw new ServiceUnavailable('Observations DB');
    this.rows.push(...rows);
  }
  get all(): readonly Observation[] {
    return this.rows;
  }
  get count(): number {
    return this.rows.length;
  }
}

/** Coverage files: climatology and committed forecasts. Commits are atomic (whole record or nothing). */
export class NetcdfStore implements ForecastWriter {
  private readonly forecasts: Forecast[] = [];
  /** SHR-3: climatology versions committed, newest last (v1 ships with the system). */
  readonly climatologyVersions: { version: number; committedAt: number }[] = [{ version: 1, committedAt: 0 }];
  climatology: Values;
  constructor(climatology: Values) {
    this.climatology = climatology;
  }
  get climatologyVersion(): number {
    return this.climatologyVersions[this.climatologyVersions.length - 1]!.version;
  }
  /** SHR-3: stage, then swap the manifest: the new version replaces climatology.nc atomically. */
  commitClimatology(f: ClimatologyFile, tick: number): void {
    this.climatology = Object.freeze({ ...f.values });
    this.climatologyVersions.push({ version: f.version, committedAt: tick });
  }
  commit(forecast: Forecast): void {
    if (this.forecasts.some((f) => f.id === forecast.id)) throw new Error(`forecast ${forecast.id} already committed`);
    this.forecasts.push(Object.freeze({ ...forecast }));
  }
  get all(): readonly Forecast[] {
    return this.forecasts;
  }
  get latest(): Forecast | undefined {
    return this.forecasts[this.forecasts.length - 1];
  }
  /** MOD-2: the previous forecast is the background of the latest. */
  get background(): Forecast | undefined {
    return this.forecasts[this.forecasts.length - 2];
  }
  byId(id: string): Forecast | undefined {
    return this.forecasts.find((f) => f.id === id);
  }
  /** Coverage files held: climatology plus forecasts. */
  get fileCount(): number {
    return 1 + this.forecasts.length;
  }
}

export class FeaturesDb implements FeatureWriter {
  private readonly rows: Feature[] = [];
  writeAll(forecastId: string, features: readonly Feature[]): void {
    if (this.rows.some((r) => r.forecastId === forecastId)) throw new Error(`features for ${forecastId} already written`);
    this.rows.push(...features.map((f) => Object.freeze({ ...f })));
  }
  get all(): readonly Feature[] {
    return this.rows;
  }
  get count(): number {
    return this.rows.length;
  }
  byForecast(id: string): Feature[] {
    return this.rows.filter((r) => r.forecastId === id);
  }
  /** Latest forecast id that has features, in write order. */
  get latestForecastId(): string | undefined {
    return this.rows[this.rows.length - 1]?.forecastId;
  }
}

/**
 * SHR: the transfer area on the ops node (a filesystem; adopted). The inbox holds verified files from
 * shore; the outbox holds export bundles waiting for the link.
 */
export class TransferArea {
  readonly inbox: ClimatologyFile[] = [];
  readonly outbox: ExportBundle[] = [];
  /** Bundles the sync agent has sent, newest last (for the inspector). */
  readonly sent: { id: string; at: number }[] = [];
}
