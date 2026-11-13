/**
 * Declared inputs (MOT-7): the data objects each reader needs before it can run, in the order it
 * reads them. The UI draws one document slot per input; a pygeoapi response fills the slot named
 * by its `slot`. Kept beside the topology so the diagram never decides what a component depends on.
 */
import { NUMERICS } from '../config.ts';
import type { StandardCode } from '../payloads.ts';

export type InputSlot = 'forecast' | 'observations' | 'climatology' | 'features';

export interface InputDecl {
  readonly slot: InputSlot;
  /** What the reader calls it (the model runner's forecast is its background). */
  readonly label: string;
  /** Standard of the response that fills it. */
  readonly standard: StandardCode;
  /** What the document is and where it comes from. */
  readonly what: string;
  /** What this reader uses it for. */
  readonly use: string;
  /** Why it can stay empty, where that is expected. */
  readonly whenEmpty?: string;
}

/** What a consumer app needs: the forecast coverage only, or the coverage and its features. */
export type ConsumerNeeds = 'coverage' | 'coverage+features';

const EDR = 'CoverageJSON from OGC API-EDR (pygeoapi reads it from the NetCDF store).';
const ST = 'SensorThings Observations from pygeoapi (rows in the Observations DB).';
const consumerForecast: InputDecl = {
  slot: 'forecast',
  label: 'forecast',
  standard: 'C',
  what: `The announced forecast at the ship. ${EDR}`,
  use: "Shown to the app's user. Its digest is checked against the announcement (✓/✗).",
};

export const INPUTS = {
  driftMonitor: [
    { slot: 'forecast', label: 'current forecast', standard: 'C', what: `The latest forecast's value for each input. ${EDR}`, use: 'The expected value: each observation is compared with it.', whenEmpty: 'No forecast has been issued yet, so the check stops here.' },
    { slot: 'observations', label: 'latest observations', standard: 'S', what: `The latest reading of each input. ${ST}`, use: 'Compared with the forecast to give each residual in σ; drift is when enough residuals pass the threshold for long enough.', whenEmpty: 'Not read when there is no forecast; refused (503) while the Observations DB is stopped.' },
  ],
  modelRunner: [
    { slot: 'climatology', label: 'climatology', standard: 'C', what: `The long-term mean of each input at the ship. ${EDR}`, use: 'The fallback: stands in for the background or the observations when either is missing.' },
    { slot: 'forecast', label: 'background (previous forecast)', standard: 'C', what: `The previous forecast. ${EDR}`, use: 'The starting point the model nudges 60% of the way towards the observations.', whenEmpty: 'The first run has no previous forecast, so it starts from climatology.' },
    { slot: 'observations', label: 'recent observations', standard: 'S', what: `The last ${NUMERICS.recentObservations} readings of each input. ${ST}`, use: 'Averaged to give the target the background is nudged towards.', whenEmpty: 'Refused (503) while the Observations DB is stopped, so the run fails and retries.' },
  ],
  featureDetector: [
    { slot: 'forecast', label: 'new forecast', standard: 'C', what: `The forecast just produced, fetched by its id. ${EDR}`, use: 'Searched for fronts and eddies.' },
    { slot: 'climatology', label: 'climatology', standard: 'C', what: `The long-term mean of each input at the ship. ${EDR}`, use: 'The reference: a forecast value far enough from it (in σ) marks a front.' },
  ],
  consumer: {
    coverage: [consumerForecast],
    'coverage+features': [
      consumerForecast,
      { slot: 'features', label: 'features', standard: 'G', what: "The forecast's fronts and eddies. GeoJSON from OGC API-Features (pygeoapi reads them from the Features DB).", use: "Drawn on the app's map. Their count is checked against the announcement." },
    ],
  } satisfies Record<ConsumerNeeds, InputDecl[]>,
} satisfies Record<string, readonly InputDecl[] | Record<ConsumerNeeds, InputDecl[]>>;

/** Consumers alternate: C1, C3… need coverage and features; C2, C4… need the coverage only. */
export function consumerNeeds(index: number): ConsumerNeeds {
  return index % 2 === 0 ? 'coverage+features' : 'coverage';
}
