/**
 * pygeoapi (off-the-shelf, mocked, read-only): SensorThings, EDR and Features.
 * The only read path for our modules and for consumers. Every call emits a
 * query token from the caller and a read token from the store it touches.
 */
import type { Feature, Forecast, InputKey, Values } from '../contracts.ts';
import type { FeaturesDb, NetcdfStore, ObservationsDb } from '../stores/stores.ts';
import type { TokenRecorder } from '../tokens.ts';
import { edgeId, type ElementId } from '../topology/elements.ts';

export interface Caller {
  readonly element: ElementId;
  readonly instance?: string;
}

export class PygeoApi {
  constructor(
    private readonly obs: ObservationsDb,
    private readonly netcdf: NetcdfStore,
    private readonly featuresDb: FeaturesDb,
    private readonly tokens: TokenRecorder,
  ) {}

  private touch(caller: Caller, store: 'observationsDb' | 'netcdfStore' | 'featuresDb'): void {
    const inst = caller.instance ? { instance: caller.instance } : {};
    this.tokens.emit(edgeId(caller.element, 'query', 'pygeoapi'), inst);
    this.tokens.emit(edgeId(store, 'read', 'pygeoapi'), inst);
  }

  /** SensorThings: latest observation per input. */
  latestObservations(caller: Caller): Partial<Record<InputKey, number>> {
    this.touch(caller, 'observationsDb');
    const out: Partial<Record<InputKey, number>> = {};
    const rows = this.obs.all;
    for (let i = rows.length - 1; i >= 0; i--) {
      const r = rows[i]!;
      if (out[r.input] === undefined) out[r.input] = r.value;
    }
    return out;
  }

  /** SensorThings: the last `n` observations per input, oldest first. */
  recentObservations(caller: Caller, n: number): Partial<Record<InputKey, number[]>> {
    this.touch(caller, 'observationsDb');
    const out: Partial<Record<InputKey, number[]>> = {};
    const rows = this.obs.all;
    for (let i = rows.length - 1; i >= 0; i--) {
      const r = rows[i]!;
      const list = (out[r.input] ??= []);
      if (list.length < n) list.unshift(r.value);
    }
    return out;
  }

  /** EDR: climatology coverage. */
  climatology(caller: Caller): Values {
    this.touch(caller, 'netcdfStore');
    return this.netcdf.climatology;
  }

  /** EDR: a forecast coverage by id, or the latest. */
  forecast(caller: Caller, id?: string): Forecast | undefined {
    this.touch(caller, 'netcdfStore');
    return id === undefined ? this.netcdf.latest : this.netcdf.byId(id);
  }

  /** Features: all features of a forecast. */
  features(caller: Caller, forecastId: string): Feature[] {
    this.touch(caller, 'featuresDb');
    return this.featuresDb.byForecast(forecastId);
  }

  /** Features: id of the latest forecast with features (used for catch-up). */
  latestFeatureForecastId(caller: Caller): string | undefined {
    this.touch(caller, 'featuresDb');
    return this.featuresDb.latestForecastId;
  }
}
