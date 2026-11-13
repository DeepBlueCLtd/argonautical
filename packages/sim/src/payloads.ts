/**
 * What a token carries, for drill-down in the UI. Each payload has a one-line summary, the
 * real-world format it stands for in production (SensorThings, EDR, MQTT, Dagster…), and a
 * mock data object filled with the simulation's actual values. Payloads never affect the event
 * log or its digest. They are plain JSON: non-finite numbers become strings.
 */
import type { Announcement, Feature, Forecast, InputKey, Observation, SensorMessage } from './contracts.ts';

export interface Payload {
  readonly summary: string;
  readonly format: string;
  readonly data: unknown;
}

/** Illustrative ship position and clock origin for mock timestamps. */
const SHIP = { lon: -4.2, lat: 50.1 } as const;
const EPOCH = Date.UTC(2026, 10, 13, 0, 0, 0);

export const iso = (tick: number) => new Date(EPOCH + tick * 1000).toISOString().replace('.000Z', 'Z');
export const num = (v: number | undefined): number | string => (v === undefined ? 'missing' : Number.isFinite(v) ? Math.round(v * 1e4) / 1e4 : String(v));
const point = () => `POINT(${SHIP.lon} ${SHIP.lat})`;
const lonlat = (x: number, y: number) => [num(SHIP.lon - 0.5 + x), num(SHIP.lat - 0.5 + y)];

const p = (summary: string, format: string, data: unknown): Payload => ({ summary, format, data });

// ---- world → ingestion → store ----

/** A SensorThings Datastream id for an input (one Thing: this ship; one Datastream per input). */
const datastream = (input: InputKey) => `ship-1:${input}`;

const sensorThingsMessage = (m: SensorMessage, units?: Record<InputKey, string>) => ({
  topic: `v1.1/Datastreams('${datastream(m.input)}')/Observations`,
  payload: { phenomenonTime: iso(m.tick), result: num(m.value), ...(units ? { parameters: { unitOfMeasurement: units[m.input] } } : {}) },
});

/**
 * The DAQ gateway translates raw instrument output (serial, NMEA, vendor formats) into SensorThings
 * Observation messages and publishes them to the sensor broker. No SensorThings server is involved:
 * the schema travels in the messages. Values are raw and not yet validated.
 */
export const sensorPublish = (msgs: readonly SensorMessage[], units: Record<InputKey, string>) =>
  p(`${msgs.length} raw SensorThings Observation message(s), one per instrument, not yet validated`, 'MQTT PUBLISH to the sensor broker (QoS 1), SensorThings topics and schema', {
    messages: msgs.map((m) => sensorThingsMessage(m, units)),
  });

/** The broker delivers queued messages in order; ingestion acknowledges them only after its DB commit. */
export const sensorDelivery = (batch: readonly SensorMessage[], stillQueued: number, now: number) => {
  const late = batch.filter((m) => m.tick < now).length;
  return p(
    `${batch.length} message(s) delivered to ingestion${late ? `, ${late} from the backlog` : ''}${stillQueued ? `; ${stillQueued} still queued` : ''}`,
    'MQTT messages, persistent session (QoS 1); acknowledged only after the database commit',
    { delivered: batch.length, still_queued: stillQueued, messages: batch.slice(0, 6).map((m) => sensorThingsMessage(m)), ...(batch.length > 6 ? { more: batch.length - 6 } : {}) },
  );
};

/**
 * Ingestion writes SensorThings Observation entities over SQL into the SensorThings schema that
 * pygeoapi serves. The data model is SensorThings end to end; the transport is plain SQL.
 */
export const observationInsert = (rows: readonly Observation[], rejected: number) =>
  p(
    `${rows.length} SensorThings Observation(s) written${rejected ? `; ${rejected} rejected and not written` : ''}`,
    'SQL INSERT of SensorThings Observation entities (schema served by pygeoapi)',
    {
      table: 'OBSERVATIONS',
      rows: rows.map((r) => ({ 'Datastream@iot.id': datastream(r.input), phenomenonTime: iso(r.tick), resultTime: iso(r.tick), result: num(r.value), resultQuality: 'passed ingestion QC' })),
    },
  );

// ---- read path: pygeoapi ----

export const request = (summary: string, api: 'SensorThings' | 'EDR' | 'Features', url: string) =>
  p(summary, `OGC API ${api === 'SensorThings' ? 'SensorThings' : api === 'EDR' ? '– EDR' : '– Features'} request`, { method: 'GET', url });

export const sensorThingsLatest = (latest: readonly Observation[]) =>
  p(`Latest observation of ${latest.length} datastream(s)`, 'SensorThings Observations (JSON)', {
    value: latest.map((o) => ({ 'Datastream@iot.id': datastream(o.input), phenomenonTime: iso(o.tick), result: num(o.value) })),
  });

export const sensorThingsRecent = (n: number, recent: Partial<Record<InputKey, readonly number[]>>) =>
  p(`Up to ${n} recent observations per datastream`, 'SensorThings Observations (JSON)', {
    value: Object.entries(recent).map(([ds, vals]) => ({ 'Datastream@iot.id': datastream(ds), results: (vals ?? []).map(num) })),
  });

export const coverage = (what: string, values: Readonly<Record<InputKey, number>> | undefined, meta: Record<string, unknown> = {}) =>
  values
    ? p(what, 'CoverageJSON (excerpt)', {
        type: 'Coverage',
        ...meta,
        domain: { type: 'Domain', domainType: 'Point', axes: { x: { values: [SHIP.lon] }, y: { values: [SHIP.lat] } } },
        ranges: Object.fromEntries(Object.entries(values).map(([k, v]) => [k, { type: 'NdArray', values: [num(v)] }])),
      })
    : p(`${what}: not found`, 'HTTP 404 response', { status: 404, title: 'Not Found' });

export const forecastCoverage = (f: Forecast | undefined) =>
  coverage(f ? `Forecast ${f.id} (${f.cause})` : 'Forecast', f?.values, f ? { id: f.id, cause: f.cause, issued: iso(f.issuedAt), validUntil: iso(f.validUntil), digest: f.digest } : {});

export const featureCollection = (forecastId: string, feats: readonly Feature[]) =>
  p(`${feats.length} feature(s) of ${forecastId}`, 'GeoJSON FeatureCollection', {
    type: 'FeatureCollection',
    numberReturned: feats.length,
    features: feats.map((f) => ({ type: 'Feature', id: f.id, geometry: { type: 'Point', coordinates: lonlat(f.x, f.y) }, properties: { kind: f.kind, input: f.input ?? null, forecast_id: f.forecastId } })),
  });

export const latestFeatureId = (id: string | undefined) =>
  p(id ? `Latest forecast with features: ${id}` : 'No features yet', 'GeoJSON FeatureCollection (one property)', { type: 'FeatureCollection', numberReturned: id ? 1 : 0, features: id ? [{ properties: { forecast_id: id } }] : [] });

export const urls = {
  latest: '/v1.1/Datastreams?$expand=Observations($top=1;$orderby=phenomenonTime desc)',
  recent: (n: number) => `/v1.1/Datastreams?$expand=Observations($top=${n};$orderby=phenomenonTime desc)`,
  climatology: () => `/collections/climatology/position?coords=${point()}`,
  forecast: (id?: string) => (id ? `/collections/forecast/instances/${id}/position?coords=${point()}` : `/collections/forecast/position?coords=${point()}&instance=latest`),
  features: (id: string) => `/collections/features/items?forecast_id=${id}`,
  latestFeatures: '/collections/features/items?sortby=-forecast_id&limit=1&properties=forecast_id',
};

// ---- orchestrator ----

const ASSETS = ['forecast', 'features', 'announcement'];

export const runRequest = (cause: string, from: string, note: string, tick: number) =>
  p(
    `Run request (${cause})${note ? `: ${note}` : ''}`,
    from === 'manualRequest' ? 'Dagster run launched from the UI' : from === 'driftSensor' ? 'Dagster RunRequest from a sensor' : 'Dagster RunRequest from a schedule',
    { run_key: `${cause}-${tick}`, asset_selection: ASSETS, tags: { cause, ...(note ? { reason: note } : {}) }, requested_at: iso(tick) },
  );

export const lineage = (upstream: string, downstream: string, runId: string, extra: Record<string, unknown> = {}) =>
  p(`${upstream} is an input of ${downstream} in ${runId}`, 'Dagster asset lineage (metadata; no data moves on this line)', { upstream, downstream, run_id: runId, ...extra });

export const backgroundLoop = (f: Forecast) =>
  p(`${f.id} committed; it becomes the background of the next run`, 'Dagster asset materialisation event', { asset: 'forecast', partition: f.id, metadata: { digest: f.digest, valid_until: iso(f.validUntil) }, next_role: 'background' });

export const shimCall = (fn: string, transport: string, args: Record<string, unknown>, attempt?: number) =>
  p(`Call ${fn}${attempt && attempt > 1 ? ` (retry ${attempt - 1})` : ''}`, transport, { function: fn, args, ...(attempt ? { attempt } : {}) });

// ---- writes from our modules ----

export const forecastCommit = (f: Forecast) =>
  p(`Atomic commit of forecast ${f.id}`, 'NetCDF file (header excerpt), written to staging then renamed', {
    file: `forecast_${f.id}.nc`,
    global_attributes: { forecast_id: f.id, cause: f.cause, issued: iso(f.issuedAt), valid_until: iso(f.validUntil), digest: f.digest },
    variables: Object.fromEntries(f.inputs.map((k) => [k, { value: num(f.values[k]) }])),
  });

export const featuresInsert = (forecastId: string, feats: readonly Feature[]) =>
  p(`${feats.length} feature(s) of ${forecastId}, written together`, 'SQL INSERT into the Features DB (PostGIS)', {
    table: 'features',
    rows: feats.map((f) => ({ id: f.id, forecast_id: f.forecastId, kind: f.kind, input: f.input ?? null, geom: `ST_Point(${lonlat(f.x, f.y).join(', ')})` })),
  });

// ---- broker ----

export const TOPIC = 'argonautical/forecast/announcements';

export const mqtt = (msg: Announcement, to?: string) =>
  p(to ? `Announcement of ${msg.forecastId} delivered to ${to}` : `Announcement of ${msg.forecastId}`, `MQTT ${to ? 'message' : 'PUBLISH'} on '${TOPIC}' (QoS 1, retained)`, {
    topic: TOPIC,
    payload: { forecast_id: msg.forecastId, valid_until: iso(msg.validUntil), cause: msg.cause, digest: msg.digest, feature_count: msg.featureCount },
  });
