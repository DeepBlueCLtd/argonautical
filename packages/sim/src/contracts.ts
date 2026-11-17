/**
 * Data contracts shared by our modules, stores, the read path and consumers.
 * Neither orchestrator nor shim: our modules may import this file (ARC-1).
 */
import { hash53 } from './digest.ts';

export type InputKey = string;
export type Values = Readonly<Record<InputKey, number>>;

/** One raw reading as published by the DAQ gateway (a SensorThings Observation message). */
export interface SensorMessage {
  /** Measurement time (phenomenonTime), not the time it is processed. */
  readonly tick: number;
  readonly input: InputKey;
  readonly value: number;
}

/** A dependency (e.g. the Observations DB) is not available. Callers treat it as a retryable failure. */
export class ServiceUnavailable extends Error {
  constructor(readonly service: string) {
    super(`${service} unavailable`);
  }
}

/** Hours ahead a forecast covers; 0 is the now-cast (conditions at issue time). */
export type ForecastWindow = 0 | 12 | 24 | 48;
export type Windows = readonly ForecastWindow[];
/** A run without future forecasts: the now-cast only. */
export const NOWCAST: Windows = [0];
/** A run with future forecasts: the now-cast plus 12, 24 and 48 h. */
export const FUTURE_WINDOWS: Windows = [0, 12, 24, 48];
export const windowsFor = (futureForecasts: boolean): Windows => (futureForecasts ? FUTURE_WINDOWS : NOWCAST);

/** The furthest window ahead, in hours (0 for a now-cast only). */
export const furthestWindow = (w: Windows): number => Math.max(0, ...w);

/** One window: "now-cast" or "24 h". */
export const windowLabel = (h: number): string => (h === 0 ? 'now-cast' : `${h} h`);

/** Every label in the system goes through here: "now-cast" or "now-cast + 12/24/48 h". */
export function windowsLabel(w: Windows): string {
  const ahead = w.filter((h) => h > 0);
  const now = w.includes(0) ? 'now-cast' : '';
  if (!ahead.length) return now || 'now-cast';
  const future = `${ahead.join('/')} h`;
  return now ? `${now} + ${future}` : future;
}

export interface Observation {
  readonly tick: number;
  readonly input: InputKey;
  readonly value: number;
}

export interface Forecast {
  readonly id: string;
  readonly cause: string;
  readonly issuedAt: number;
  readonly validUntil: number;
  /** Input keys in canonical order (the order the digest covers). */
  readonly inputs: readonly InputKey[];
  readonly values: Values;
  readonly digest: string;
  /** Forecast windows in hours ahead: [0] (now-cast only) or [0, 12, 24, 48] with future forecasts. Not part of the digest. */
  readonly windows: Windows;
}

export type FeatureKind = 'front' | 'eddy';

export interface Feature {
  readonly id: string;
  /** DET-2: tagged with the forecast it was detected in. */
  readonly forecastId: string;
  readonly kind: FeatureKind;
  readonly input?: InputKey;
  /** Normalised position 0–1, illustrative only. */
  readonly x: number;
  readonly y: number;
}

/** ORC-5 */
export interface Announcement {
  readonly forecastId: string;
  readonly validUntil: number;
  readonly cause: string;
  readonly digest: string;
  /** Undefined when no feature detector ran (CAT-2). */
  readonly featureCount?: number;
  readonly windows: Windows;
}

/** CAT-1: what the installed system can do. Fixed while the system is on; change it by switching off and on. */
export interface Capabilities {
  /** A feature detector is installed: runs detect fronts and eddies. */
  readonly featureDetector: boolean;
  /** Future forecasts: each run adds 12, 24 and 48 h windows to the now-cast. */
  readonly futureForecasts: boolean;
  /** A wave-height sensor is fitted: wave height is measured, ingested, monitored, forecast and announced like any other input. */
  readonly waveSensor: boolean;
}

/** CAT-3: one entry in pygeoapi's `/collections`. */
export interface CollectionInfo {
  readonly id: 'observations' | 'climatology' | 'forecast' | 'features';
  readonly title: string;
  readonly api: 'SensorThings' | 'EDR' | 'Features';
  /** Forecast only: its windows in hours ahead (0 = now-cast). */
  readonly windows?: Windows;
  /** Forecast only: the measurements it covers, each subscribable on `forecast/<key>` (CAT-4). */
  readonly parameters?: readonly InputKey[];
}

/**
 * Broker topics (CAT-4): the whole run (`forecast/new`), its features (`features/new`) and one topic per
 * measurement (`forecast/temp`, `forecast/wave`…), so a consumer subscribes only to what it uses.
 */
export type MeasurementTopic = `forecast/${InputKey}`;
export type Topic = 'forecast/new' | 'features/new' | MeasurementTopic;

export const measurementTopic = (key: InputKey): MeasurementTopic => `forecast/${key}`;

/** The measurement a topic carries, or undefined for `forecast/new` and `features/new`. */
export function topicMeasurement(t: Topic): InputKey | undefined {
  return t === 'forecast/new' || t === 'features/new' ? undefined : t.slice('forecast/'.length);
}

/** A `forecast/<key>` message: one measurement of a new forecast is ready. */
export interface MeasurementReady {
  readonly forecastId: string;
  readonly parameter: InputKey;
  readonly validUntil: number;
  readonly windows: Windows;
  /** Digest of this measurement's value (see `parameterDigest`), checked by the consumer. */
  readonly digest: string;
}

/** A `features/new` message: features for a forecast are ready. */
export interface FeaturesReady {
  readonly forecastId: string;
  readonly featureCount: number;
}

export type BrokerMessage =
  | { readonly topic: 'forecast/new'; readonly body: Announcement }
  | { readonly topic: 'features/new'; readonly body: FeaturesReady }
  | { readonly topic: MeasurementTopic; readonly body: MeasurementReady };

export function isMeasurementMessage(m: BrokerMessage): m is { readonly topic: MeasurementTopic; readonly body: MeasurementReady } {
  return topicMeasurement(m.topic) !== undefined;
}

export function forecastDigest(f: Pick<Forecast, 'id' | 'validUntil' | 'inputs' | 'values'>): string {
  const body = f.inputs.map((k) => `${k}=${(f.values[k] ?? NaN).toFixed(6)}`).join(',');
  return hash53(`${f.id}|${f.validUntil}|${body}`);
}

/** CAT-4: digest of one measurement of a forecast, so a consumer can verify the part it fetched. */
export function parameterDigest(f: Pick<Forecast, 'id' | 'validUntil' | 'values'>, key: InputKey): string {
  return hash53(`${f.id}|${f.validUntil}|${key}=${(f.values[key] ?? NaN).toFixed(6)}`);
}

/** Read ports. Our modules see only these; the simulation wires them to pygeoapi (the only read path). */
export interface DriftReader {
  /** The last `n` observations of each input, oldest first (DRF-1: averaged over the check window). */
  recentObservations(n: number): Partial<Record<InputKey, number[]>>;
  currentForecast(): Forecast | undefined;
}

export interface ModelReader {
  recentObservations(perInput: number): Partial<Record<InputKey, readonly number[]>>;
  climatology(): Values;
  /** The latest committed forecast; it becomes the background of the next one (MOD-2). */
  latestForecast(): Forecast | undefined;
}

export interface DetectorReader {
  forecast(id: string): Forecast | undefined;
  climatology(): Values;
}

/** Write ports onto our stores. */
export interface ObservationWriter {
  append(rows: readonly Observation[]): void;
}
export interface ForecastWriter {
  commit(forecast: Forecast): void;
}
export interface FeatureWriter {
  writeAll(forecastId: string, features: readonly Feature[]): void;
}
export interface AnnouncementPublisher {
  publish(msg: BrokerMessage): void;
}

/** A long-running step (model run, detection). Pipes-style: start, report progress, complete. */
export interface Job<R> {
  /** Ticks for the job's inputs to arrive (its pygeoapi reads); the countdown starts only then. */
  readonly readDuration: number;
  /** Ticks of work once the inputs have arrived. */
  readonly duration: number;
  readonly label: string;
  /** Called each tick while running (a heartbeat). */
  progress(): void;
  /** Called once `readDuration + duration` ticks have elapsed. Performs the atomic write. */
  complete(): R;
}

/** RRQ-1: a run request held by the run-request API until the sensor polls it. */
export interface RunRequestRecord {
  readonly id: string;
  readonly requestedAt: number;
  readonly by: string;
  /** Set when the sensor has taken it into the run queue. */
  polledAt?: number;
  /** RRQ-3: posted back when the run completes. */
  status?: { readonly runId: string; readonly forecastId: string; readonly at: number };
}

/** SHR-2/3: a climatology file in transit or in the inbox. */
export interface ClimatologyFile {
  readonly version: number;
  readonly issuedAt: number;
  readonly values: Values;
}

/** SHR-4: one signed export bundle for shore. */
export interface ExportBundle {
  readonly id: string;
  readonly createdAt: number;
  readonly fromTick: number;
  readonly toTick: number;
  readonly observations: number;
  readonly forecastId?: string;
  readonly featureCount?: number;
  readonly digest: string;
}
