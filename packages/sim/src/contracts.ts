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
  /** Forecast horizon in hours (12, or 48 with the long-range capability). Not part of the digest. */
  readonly horizon: number;
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
  readonly horizon: number;
}

/** CAT-1: what the installed system can do. Fixed while the system is on; change it by switching off and on. */
export interface Capabilities {
  /** A feature detector is installed: runs detect fronts and eddies. */
  readonly featureDetector: boolean;
  /** The model produces 48 h forecasts instead of 12 h. */
  readonly longRange: boolean;
}

/** CAT-3: one entry in pygeoapi's `/collections`. */
export interface CollectionInfo {
  readonly id: 'observations' | 'climatology' | 'forecast' | 'features';
  readonly title: string;
  readonly api: 'SensorThings' | 'EDR' | 'Features';
  /** Forecast only: its horizon in hours. */
  readonly horizon?: number;
}

/** Broker topics (CAT-4). */
export type Topic = 'forecast/new' | 'features/new';

/** A `features/new` message: features for a forecast are ready. */
export interface FeaturesReady {
  readonly forecastId: string;
  readonly featureCount: number;
}

export type BrokerMessage = { readonly topic: 'forecast/new'; readonly body: Announcement } | { readonly topic: 'features/new'; readonly body: FeaturesReady };

export function forecastDigest(f: Pick<Forecast, 'id' | 'validUntil' | 'inputs' | 'values'>): string {
  const body = f.inputs.map((k) => `${k}=${(f.values[k] ?? NaN).toFixed(6)}`).join(',');
  return hash53(`${f.id}|${f.validUntil}|${body}`);
}

/** Read ports. Our modules see only these; the simulation wires them to pygeoapi (the only read path). */
export interface DriftReader {
  latestObservations(): Partial<Record<InputKey, number>>;
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
