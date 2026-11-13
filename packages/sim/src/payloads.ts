/**
 * What a token carries, for drill-down in the UI. Each payload has a one-line summary, the
 * real-world format it stands for in production (SensorThings, EDR, MQTT, Dagster…), and a
 * mock data object filled with the simulation's actual values. Payloads never affect the event
 * log or its digest. They are plain JSON: non-finite numbers become strings.
 */
import type { BrokerMessage, CollectionInfo, Feature, Forecast, InputKey, Observation, SensorMessage, Topic } from './contracts.ts';

/** The standard (or format) a token's content follows, shown as a letter on the token. */
export const STANDARDS = {
  S: 'OGC SensorThings',
  Q: 'SQL',
  E: 'OGC API – EDR',
  C: 'CoverageJSON',
  F: 'OGC API – Features',
  G: 'GeoJSON',
  N: 'NetCDF',
  M: 'MQTT announcement',
  D: 'Dagster',
  H: 'HTTP status',
  O: 'OGC API – Common',
} as const;
export type StandardCode = keyof typeof STANDARDS;

export interface Payload {
  readonly summary: string;
  readonly format: string;
  /** Letter for the standard the content follows (by payload, e.g. a response body is C or G). */
  readonly standard: StandardCode;
  readonly data: unknown;
}

/** Illustrative ship position and clock origin for mock timestamps. */
const SHIP = { lon: -4.2, lat: 50.1 } as const;
const EPOCH = Date.UTC(2026, 10, 13, 0, 0, 0);

export const iso = (tick: number) => new Date(EPOCH + tick * 1000).toISOString().replace('.000Z', 'Z');
export const num = (v: number | undefined): number | string => (v === undefined ? 'missing' : Number.isFinite(v) ? Math.round(v * 1e4) / 1e4 : String(v));
const point = () => `POINT(${SHIP.lon} ${SHIP.lat})`;
const lonlat = (x: number, y: number) => [num(SHIP.lon - 0.5 + x), num(SHIP.lat - 0.5 + y)];

/** Classify by what the content is: SQL text or rows, SensorThings entities, an EDR/Features request, etc. */
export function standardOf(format: string): StandardCode | undefined {
  const rules: [RegExp, StandardCode][] = [
    [/^HTTP \d{3}/, 'H'],
    [/^OGC API – Common/, 'O'],
    [/^SQL|SQL from|Database connection/, 'Q'],
    [/Dagster/, 'D'],
    [/SensorThings/, 'S'],
    [/EDR request/, 'E'],
    [/Features request/, 'F'],
    [/CoverageJSON/, 'C'],
    [/GeoJSON/, 'G'],
    [/NetCDF/, 'N'],
    [/^MQTT/, 'M'],
  ];
  return rules.find(([re]) => re.test(format))?.[1];
}

const p = (summary: string, format: string, data: unknown): Payload => {
  const standard = standardOf(format);
  if (!standard) throw new Error(`payload format has no standard: ${format}`);
  return { summary, format, standard, data };
};

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
    'MQTT messages carrying SensorThings Observations, persistent session (QoS 1); acknowledged only after the database commit',
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

// ---- pygeoapi ↔ store: the provider's query and the raw result ----

const OBS_SQL_COLS = 'datastream_id, phenomenon_time_start, result_number';
export const sql = {
  latest: `SELECT DISTINCT ON (datastream_id) ${OBS_SQL_COLS} FROM observations ORDER BY datastream_id, phenomenon_time_start DESC`,
  recent: (n: number) =>
    `SELECT ${OBS_SQL_COLS} FROM (SELECT *, ROW_NUMBER() OVER (PARTITION BY datastream_id ORDER BY phenomenon_time_start DESC) AS rn FROM observations) o WHERE rn <= ${n}`,
  features: (id: string) => `SELECT id, forecast_id, kind, input, ST_AsGeoJSON(geom) FROM features WHERE forecast_id = '${id}'`,
  latestFeatures: 'SELECT forecast_id FROM features ORDER BY written_at DESC LIMIT 1',
};

export const dbQuery = (store: 'Observations DB' | 'Features DB', statement: string) =>
  p(`Query to the ${store}`, `SQL from pygeoapi's ${store === 'Features DB' ? 'PostGIS' : 'PostgreSQL'} provider`, { sql: statement });

export const netcdfRead = (file: string | undefined, variables: readonly string[]) =>
  p(file ? `Read ${file} at the ship` : 'Read the latest forecast file', "NetCDF read (pygeoapi's xarray provider)", { file: file ?? 'no forecast file yet', variables, select: { lon: SHIP.lon, lat: SHIP.lat, method: 'nearest' } });

export const obsRows = (rows: readonly Observation[]) =>
  p(`${rows.length} row(s) from the Observations DB`, 'SQL result set (TimescaleDB)', {
    rows: rows.map((o) => ({ datastream_id: datastream(o.input), phenomenon_time_start: iso(o.tick), result_number: num(o.value) })),
  });

export const netcdfValues = (file: string | undefined, values: Readonly<Record<InputKey, number>> | undefined) =>
  values
    ? p(`Values read from ${file}`, 'NetCDF variables (values at the nearest grid point)', { file, values: Object.fromEntries(Object.entries(values).map(([k, v]) => [k, num(v)])) })
    : p('No such file', 'NetCDF read error', { error: 'FileNotFoundError', file: file ?? null });

export const featureRows = (feats: readonly Feature[]) =>
  p(`${feats.length} row(s) from the Features DB`, 'SQL result set (PostGIS)', {
    rows: feats.map((f) => ({ id: f.id, forecast_id: f.forecastId, kind: f.kind, input: f.input ?? null, geom: { type: 'Point', coordinates: lonlat(f.x, f.y) } })),
  });

export const latestFeatureRow = (id: string | undefined) =>
  p(id ? `1 row: ${id}` : 'No rows', 'SQL result set (PostGIS)', { rows: id ? [{ forecast_id: id }] : [] });

export const connectionRefused = (store: string) => p(`Query attempt: ${store} not accepting connections`, 'Database connection attempt (refused)', { error: 'connection refused', store });

export const serviceUnavailable = (service: string) =>
  p(`503: ${service} unavailable`, 'HTTP 503 response', { status: 503, title: 'Service Unavailable', detail: `${service} is not accepting connections; retry later` });

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
  coverage(f ? `Forecast ${f.id} (${f.cause}, ${f.horizon} h)` : 'Forecast', f?.values, f ? { id: f.id, cause: f.cause, horizon_hours: f.horizon, issued: iso(f.issuedAt), validUntil: iso(f.validUntil), digest: f.digest } : {});

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

/** A dependency that was already satisfied when the run began: checked, never a trigger. */
export const dependencyChecked = (upstream: string, downstream: string, runId: string, extra: Record<string, unknown> = {}) =>
  p(`${upstream} is already available, so ${downstream} need not wait for it (${runId})`, 'Dagster run plan: upstream dependency satisfied (no data moves on this line)', { upstream, downstream, run_id: runId, status: 'satisfied', ...extra });

/** The upstream asset has just been materialised, which releases the downstream step. */
export const dependencyReleased = (upstream: string, downstream: string, runId: string, partition: string) =>
  p(`${upstream} ${partition} materialised, so ${downstream} can now run (${runId})`, 'Dagster ASSET_MATERIALIZATION event releases the downstream step (no data moves on this line)', {
    event: 'ASSET_MATERIALIZATION',
    asset: upstream,
    partition,
    run_id: runId,
    unblocks: downstream,
  });

/** UI-10: the previous forecast is the background of this run. */
export const backgroundChecked = (prev: { id: string; digest: string }, runId: string) =>
  p(`${prev.id} is available as the background for ${runId}`, 'Dagster run plan: upstream dependency satisfied (no data moves on this line)', { upstream: 'forecast', partition: prev.id, digest: prev.digest, downstream: 'forecast', role: 'background', run_id: runId, status: 'satisfied' });

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

const topicPath = (t: Topic) => `argonautical/${t}`;
/** Announcements are retained, so a new subscriber gets the latest straight away; catalogue changes are not. */
const RETAINED: Record<Topic, boolean> = { 'forecast/new': true, 'features/new': true, 'catalogue/changed': false };

const messageBody = (m: BrokerMessage): { summary: string; payload: unknown } => {
  switch (m.topic) {
    case 'forecast/new': {
      const a = m.body;
      return {
        summary: `${a.forecastId} is ready (${a.horizon} h${a.featureCount === undefined ? '' : `, ${a.featureCount} features`})`,
        payload: { forecast_id: a.forecastId, valid_until: iso(a.validUntil), horizon_hours: a.horizon, cause: a.cause, digest: a.digest, ...(a.featureCount !== undefined ? { feature_count: a.featureCount } : {}) },
      };
    }
    case 'features/new':
      return { summary: `Features of ${m.body.forecastId} are ready`, payload: { forecast_id: m.body.forecastId, feature_count: m.body.featureCount } };
    case 'catalogue/changed':
      return { summary: 'The catalogue changed: discover again', payload: { collections: m.body.collections, href: '/collections' } };
  }
};

export const mqtt = (msg: BrokerMessage, to?: string) => {
  const { summary, payload } = messageBody(msg);
  return p(to ? `${summary} → ${to}` : summary, `MQTT ${to ? 'message' : 'PUBLISH'} on '${topicPath(msg.topic)}' (QoS 1${RETAINED[msg.topic] ? ', retained' : ''})`, { topic: topicPath(msg.topic), retained: RETAINED[msg.topic], payload });
};

export const catalogueHook = (msg: BrokerMessage) => {
  const { summary, payload } = messageBody(msg);
  return p(summary, `MQTT PUBLISH on '${topicPath(msg.topic)}' by the deployment hook (pygeoapi does not announce its own configuration)`, { topic: topicPath(msg.topic), payload });
};

export const subscribe = (topic: Topic, who: string, on: boolean) =>
  p(`${who} ${on ? 'subscribes to' : 'unsubscribes from'} ${topic}`, `MQTT ${on ? 'SUBSCRIBE' : 'UNSUBSCRIBE'} (QoS 1)`, { client_id: who, topic: topicPath(topic) });

// ---- catalogue (CAT-3) ----

export const collectionsRequest = () => p('Which collections are offered?', 'OGC API – Common request', { method: 'GET', url: '/collections' });

export const collectionsResponse = (cols: readonly CollectionInfo[]) =>
  p(`${cols.length} collection(s): ${cols.map((c) => c.id + (c.status === 'available' ? '' : ` (${c.status})`)).join(', ')}`, 'OGC API – Common collections (JSON)', {
    collections: cols.map((c) => ({
      id: c.id,
      title: c.title,
      itemType: c.api === 'Features' ? 'feature' : c.api === 'EDR' ? 'coverage' : 'observation',
      links: [{ rel: 'items', href: c.api === 'SensorThings' ? '/v1.1/Datastreams' : `/collections/${c.id}${c.api === 'EDR' ? '/position' : '/items'}` }],
      ...(c.horizon !== undefined ? { extent: { temporal: { horizon_hours: c.horizon } } } : {}),
      ...(c.status !== 'available' ? { 'x-status': c.status } : {}),
      ...(c.nextHorizon !== undefined ? { 'x-next-run': { horizon_hours: c.nextHorizon } } : {}),
    })),
  });
