/**
 * pygeoapi (off-the-shelf, mocked, read-only): SensorThings, EDR and Features.
 * The only read path for our modules and for consumers. Every read is a round trip of
 * four tokens: request, the provider's database query, the rows, and the response.
 */
import { ServiceUnavailable, type CollectionInfo, type Feature, type Forecast, type InputKey, type Observation, type Values } from '../contracts.ts';
import * as P from '../payloads.ts';
import type { Payload } from '../payloads.ts';
import type { FeaturesDb, NetcdfStore, ObservationsDb } from '../stores/stores.ts';
import type { TokenRecorder } from '../tokens.ts';
import type { InputSlot } from '../topology/inputs.ts';
import { edgeId, type ElementId } from '../topology/elements.ts';

export interface Caller {
  readonly element: ElementId;
  readonly instance?: string;
}

type Store = 'observationsDb' | 'netcdfStore' | 'featuresDb';

export class PygeoApi {
  constructor(
    private readonly obs: ObservationsDb,
    private readonly netcdf: NetcdfStore,
    private readonly featuresDb: FeaturesDb,
    private readonly tokens: TokenRecorder,
  ) {}

  /**
   * One read, as four tokens: the request (caller → pygeoapi), the provider's query (pygeoapi → store),
   * the raw rows (store → pygeoapi) and the formatted response (pygeoapi → caller).
   */
  private exchange<T>(caller: Caller, store: Store, req: Payload, query: Payload, rows: Payload, result: T, res: Payload, slot?: InputSlot): T {
    const inst = caller.instance ? { instance: caller.instance } : {};
    const q = edgeId(caller.element, 'query', 'pygeoapi');
    const r = edgeId(store, 'read', 'pygeoapi');
    this.tokens.emit(q, { ...inst, payload: req, role: 'request' });
    this.tokens.emit(r, { ...inst, payload: query, role: 'db-query', reverse: true });
    this.tokens.emit(r, { ...inst, payload: rows, role: 'db-rows' });
    this.tokens.emit(q, { ...inst, payload: res, role: 'response', reverse: true, ...(slot ? { slot } : {}) });
    return result;
  }

  /** The request reaches pygeoapi, but the Observations DB is down: the query is refused and the caller gets a 503. */
  private requireObservations(caller: Caller, req: Payload): void {
    if (this.obs.up) return;
    const inst = caller.instance ? { instance: caller.instance } : {};
    const q = edgeId(caller.element, 'query', 'pygeoapi');
    this.tokens.emit(q, { ...inst, payload: req, role: 'request' });
    this.tokens.emit(edgeId('observationsDb', 'read', 'pygeoapi'), { ...inst, payload: P.connectionRefused('Observations DB'), role: 'db-query', reverse: true });
    this.tokens.emit(q, { ...inst, payload: P.serviceUnavailable('Observations DB'), role: 'response', reverse: true });
    throw new ServiceUnavailable('Observations DB');
  }

  private latestRows(): Observation[] {
    const latest = new Map<InputKey, Observation>();
    const rows = this.obs.all;
    for (let i = rows.length - 1; i >= 0; i--) {
      const r = rows[i]!;
      if (!latest.has(r.input)) latest.set(r.input, r);
    }
    return [...latest.values()];
  }

  /**
   * CAT-3: the catalogue, `GET /collections`. pygeoapi answers from its own configuration, so this
   * read is two legs (request, response) with no store behind it.
   */
  collections(caller: Caller, cols: readonly CollectionInfo[]): readonly CollectionInfo[] {
    const inst = caller.instance ? { instance: caller.instance } : {};
    const q = edgeId(caller.element, 'query', 'pygeoapi');
    this.tokens.emit(q, { ...inst, payload: P.collectionsRequest(), role: 'request' });
    this.tokens.emit(q, { ...inst, payload: P.collectionsResponse(cols), role: 'response', reverse: true });
    return cols;
  }

  /** SensorThings: latest observation per input. */
  latestObservations(caller: Caller): Partial<Record<InputKey, number>> {
    const req = P.request('Latest observation of each input', 'SensorThings', P.urls.latest);
    this.requireObservations(caller, req);
    const latest = this.latestRows();
    const out: Partial<Record<InputKey, number>> = Object.fromEntries(latest.map((o) => [o.input, o.value]));
    return this.exchange(caller, 'observationsDb', req, P.dbQuery('Observations DB', P.sql.latest), P.obsRows(latest), out, P.sensorThingsLatest(latest), 'observations');
  }

  /** SensorThings: the last `n` observations per input, oldest first. */
  recentObservations(caller: Caller, n: number): Partial<Record<InputKey, number[]>> {
    const req = P.request(`Recent observations (${n} per input)`, 'SensorThings', P.urls.recent(n));
    this.requireObservations(caller, req);
    const out: Partial<Record<InputKey, number[]>> = {};
    const picked: Observation[] = [];
    const rows = this.obs.all;
    for (let i = rows.length - 1; i >= 0; i--) {
      const r = rows[i]!;
      const list = (out[r.input] ??= []);
      if (list.length < n) {
        list.unshift(r.value);
        picked.push(r);
      }
    }
    return this.exchange(caller, 'observationsDb', req, P.dbQuery('Observations DB', P.sql.recent(n)), P.obsRows(picked), out, P.sensorThingsRecent(n, out), 'observations');
  }

  /** EDR: climatology coverage. */
  climatology(caller: Caller): Values {
    const v = this.netcdf.climatology;
    const keys = Object.keys(v);
    return this.exchange(caller, 'netcdfStore', P.request('Climatology at the ship', 'EDR', P.urls.climatology()), P.netcdfRead('climatology.nc', keys), P.netcdfValues('climatology.nc', v), v, P.coverage('Climatology at the ship', v), 'climatology');
  }

  /** EDR: a forecast coverage by id, or the latest. */
  forecast(caller: Caller, id?: string): Forecast | undefined {
    const f = id === undefined ? this.netcdf.latest : this.netcdf.byId(id);
    const file = f ? `forecast_${f.id}.nc` : id ? `forecast_${id}.nc` : undefined;
    return this.exchange(
      caller,
      'netcdfStore',
      P.request(id ? `Forecast ${id} at the ship` : 'Latest forecast at the ship', 'EDR', P.urls.forecast(id)),
      P.netcdfRead(file, f ? [...f.inputs] : []),
      P.netcdfValues(file, f?.values),
      f,
      P.forecastCoverage(f),
      // No forecast yet (a 404): the slot stays empty.
      f ? 'forecast' : undefined,
    );
  }

  /** Features: all features of a forecast. */
  features(caller: Caller, forecastId: string): Feature[] {
    const feats = this.featuresDb.byForecast(forecastId);
    return this.exchange(caller, 'featuresDb', P.request(`Features of ${forecastId}`, 'Features', P.urls.features(forecastId)), P.dbQuery('Features DB', P.sql.features(forecastId)), P.featureRows(feats), feats, P.featureCollection(forecastId, feats), 'features');
  }

  /** Features: id of the latest forecast with features (used for catch-up). */
  latestFeatureForecastId(caller: Caller): string | undefined {
    const id = this.featuresDb.latestForecastId;
    return this.exchange(caller, 'featuresDb', P.request('Which is the latest forecast with features?', 'Features', P.urls.latestFeatures), P.dbQuery('Features DB', P.sql.latestFeatures), P.latestFeatureRow(id), id, P.latestFeatureId(id));
  }
}
