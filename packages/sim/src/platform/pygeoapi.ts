/**
 * pygeoapi (off-the-shelf, mocked, read-only): SensorThings, EDR and Features.
 * The only read path for our modules and for consumers. Every call emits a
 * query token from the caller and a read token from the store it touches.
 */
import { ServiceUnavailable, type Feature, type Forecast, type InputKey, type Observation, type Values } from '../contracts.ts';
import * as P from '../payloads.ts';
import type { Payload } from '../payloads.ts';
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

  private exchange<T>(caller: Caller, store: 'observationsDb' | 'netcdfStore' | 'featuresDb', req: Payload, result: T, res: (r: T) => Payload): T {
    const inst = caller.instance ? { instance: caller.instance } : {};
    this.tokens.emit(edgeId(caller.element, 'query', 'pygeoapi'), { ...inst, payload: req });
    this.tokens.emit(edgeId(store, 'read', 'pygeoapi'), { ...inst, payload: res(result) });
    return result;
  }

  /** The query reaches pygeoapi, but the Observations DB is down: no read, and the caller gets an error. */
  private requireObservations(caller: Caller, req: Payload): void {
    if (this.obs.up) return;
    this.tokens.emit(edgeId(caller.element, 'query', 'pygeoapi'), { ...(caller.instance ? { instance: caller.instance } : {}), payload: req });
    throw new ServiceUnavailable('Observations DB');
  }

  /** SensorThings: latest observation per input. */
  latestObservations(caller: Caller): Partial<Record<InputKey, number>> {
    this.requireObservations(caller, P.request('Latest observation of each input', 'SensorThings', P.urls.latest));
    const latest = new Map<InputKey, Observation>();
    const rows = this.obs.all;
    for (let i = rows.length - 1; i >= 0; i--) {
      const r = rows[i]!;
      if (!latest.has(r.input)) latest.set(r.input, r);
    }
    const out: Partial<Record<InputKey, number>> = Object.fromEntries([...latest].map(([k, o]) => [k, o.value]));
    return this.exchange(caller, 'observationsDb', P.request('Latest observation of each input', 'SensorThings', P.urls.latest), out, () => P.sensorThingsLatest([...latest.values()]));
  }

  /** SensorThings: the last `n` observations per input, oldest first. */
  recentObservations(caller: Caller, n: number): Partial<Record<InputKey, number[]>> {
    this.requireObservations(caller, P.request(`Recent observations (${n} per input)`, 'SensorThings', P.urls.recent(n)));
    const out: Partial<Record<InputKey, number[]>> = {};
    const rows = this.obs.all;
    for (let i = rows.length - 1; i >= 0; i--) {
      const r = rows[i]!;
      const list = (out[r.input] ??= []);
      if (list.length < n) list.unshift(r.value);
    }
    return this.exchange(caller, 'observationsDb', P.request(`Recent observations (${n} per input)`, 'SensorThings', P.urls.recent(n)), out, (o) => P.sensorThingsRecent(n, o));
  }

  /** EDR: climatology coverage. */
  climatology(caller: Caller): Values {
    return this.exchange(caller, 'netcdfStore', P.request('Climatology at the ship', 'EDR', P.urls.climatology()), this.netcdf.climatology, (v) => P.coverage('Climatology at the ship', v));
  }

  /** EDR: a forecast coverage by id, or the latest. */
  forecast(caller: Caller, id?: string): Forecast | undefined {
    const f = id === undefined ? this.netcdf.latest : this.netcdf.byId(id);
    return this.exchange(caller, 'netcdfStore', P.request(id ? `Forecast ${id} at the ship` : 'Latest forecast at the ship', 'EDR', P.urls.forecast(id)), f, P.forecastCoverage);
  }

  /** Features: all features of a forecast. */
  features(caller: Caller, forecastId: string): Feature[] {
    return this.exchange(caller, 'featuresDb', P.request(`Features of ${forecastId}`, 'Features', P.urls.features(forecastId)), this.featuresDb.byForecast(forecastId), (f) => P.featureCollection(forecastId, f));
  }

  /** Features: id of the latest forecast with features (used for catch-up). */
  latestFeatureForecastId(caller: Caller): string | undefined {
    return this.exchange(caller, 'featuresDb', P.request('Which is the latest forecast with features?', 'Features', P.urls.latestFeatures), this.featuresDb.latestForecastId, P.latestFeatureId);
  }
}
