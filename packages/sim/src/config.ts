/** Declared configuration. Values here are shown on screen (ORC-1) but are not operator-tunable. */

export interface InputSpec {
  readonly key: string;
  readonly label: string;
  readonly unit: string;
  /** Climatological base value. */
  readonly base: number;
  /** One standard deviation, in `unit`. */
  readonly sigma: number;
}

/** SIM-3: the catalogue, in the order inputs are enabled (3–6). */
export const INPUT_CATALOGUE: readonly InputSpec[] = [
  { key: 'temp', label: 'Temperature', unit: '°C', base: 12.0, sigma: 0.5 },
  { key: 'sal', label: 'Salinity', unit: 'PSU', base: 35.0, sigma: 0.2 },
  { key: 'snd', label: 'Sound speed', unit: 'm/s', base: 1500.0, sigma: 3.0 },
  { key: 'cur', label: 'Current', unit: 'm/s', base: 0.5, sigma: 0.1 },
  { key: 'o2', label: 'Dissolved O₂', unit: 'mg/L', base: 7.0, sigma: 0.4 },
  { key: 'turb', label: 'Turbidity', unit: 'NTU', base: 2.0, sigma: 0.5 },
];

export const MIN_INPUTS = 3;
export const MAX_INPUTS = 6;

export const TIMING = {
  /** ORC-1 */
  driftSensorInterval: 4,
  /** ORC-1: a forecast older than this is stale. */
  staleAfter: 180,
  /** MOD-1 */
  modelRunDuration: 8,
  /** DET-1 */
  detectDuration: 5,
  /** ORC-3: backoff after the 1st, 2nd, 3rd failure, then the last value thereafter. */
  retryBackoff: [2, 4, 8, 10] as readonly number[],
  /** CON-1: consumer query delay after an announcement, inclusive range. */
  consumerDelay: [1, 3] as readonly [number, number],
  /** Scenario shift: +5σ reached over 20 s. */
  shiftSigma: 5,
  shiftRampTicks: 20,
} as const;

export const NUMERICS = {
  /** MOD: fraction of the way from background towards recent observations. */
  nudge: 0.6,
  /** MOD: how many recent accepted observations are averaged per input. */
  recentObservations: 10,
  /** DET-1 */
  frontSigma: 0.75,
  /** ING-2 */
  climatologyLimitSigma: 10,
  /** ING-3 */
  jumpLimitSigma: 4,
  /** FLT-2: seeded random step failure rate. */
  randomFailureRate: 0.03,
  /** Sensor glitches, so ING-1/ING-2 are exercised: probability per reading. */
  nanGlitchRate: 0.002,
  wildGlitchRate: 0.001,
  wildGlitchSigma: 50,
  /** Ingestion drains the sensor broker at up to this many ticks' worth of messages per tick. */
  ingestCatchUp: 5,
  /** Default sensor noise, in σ. */
  defaultNoiseSigma: 0.3,
  /** Ocean natural drift (mean-reverting random walk, in σ). */
  oceanReversion: 0.02,
  oceanStep: 0.05,
} as const;

/** DRF-3: operator-tunable bounds. */
export const DRIFT_BOUNDS = {
  threshold: { min: 1, max: 6, step: 0.5, default: 3 },
  quorum: { min: 1, default: 2 },
  persistence: { min: 1, max: 5, default: 2 },
} as const;

export const NOISE_BOUNDS = { min: 0, max: 3 } as const;

export const DEFAULT_CONSUMERS = 2;

export function inputsFor(count: number): InputSpec[] {
  if (!Number.isInteger(count) || count < MIN_INPUTS || count > MAX_INPUTS) {
    throw new RangeError(`input count must be an integer ${MIN_INPUTS}–${MAX_INPUTS}, got ${count}`);
  }
  return INPUT_CATALOGUE.slice(0, count);
}
