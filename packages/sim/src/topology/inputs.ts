/**
 * Declared inputs (MOT-7): the data objects each reader needs before it can run, in the order it
 * reads them. The UI draws one document slot per input; a pygeoapi response fills the slot named
 * by its `slot`. Kept beside the topology so the diagram never decides what a component depends on.
 */
import { NUMERICS, TIMING } from '../config.ts';
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
  /** CAT-5: used if offered; the reader works without it (at a lower level of service). */
  readonly optional?: boolean;
}

/**
 * CAT-5: consumer profiles. Each needs the forecast; what else it uses decides its status.
 * Chart display: features optional (LOW RES → HI RES). Passage planner: plans as far ahead as the
 * forecast reaches (NOW-CAST → 48 h with future forecasts) and uses wave height when it is offered (+ WAVES). Basic: the forecast only.
 *
 * CAT-4: `measurements` are the forecast measurements a profile uses. It subscribes to `forecast/<key>`
 * for each one the catalogue offers, rather than to the whole forecast; with none offered (or none
 * declared, as for basic) it subscribes to `forecast/new`.
 */
export type ConsumerProfile = 'chart' | 'planner' | 'basic';

export const PROFILES: Record<ConsumerProfile, { readonly title: string; readonly about: string; readonly measurements: readonly string[] }> = {
  chart: { title: 'Chart display', about: 'Draws sea temperature and current on a chart; with features it draws fronts and eddies too (HI RES).', measurements: ['temp', 'cur'] },
  planner: { title: 'Passage planner', about: 'Plans the route ahead from current and, when a wave-height sensor is fitted, wave height (+ WAVES); with future forecasts it can plan up to 48 h ahead instead of from the now-cast alone.', measurements: ['cur', 'wave'] },
  basic: { title: 'Basic', about: 'Shows the whole forecast at the ship.', measurements: [] },
};

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
    { slot: 'observations', label: 'recent observations (last 10 s)', standard: 'S', what: `The last ${TIMING.driftSensorInterval} readings of each input: every reading since the previous check. ${ST}`, use: 'Averaged per input, then compared with the forecast to give each residual in σ; drift is when enough residuals pass the threshold for long enough. Averaging uses all the data and damps sensor noise.', whenEmpty: 'Not read when there is no forecast; refused (503) while the Observations DB is stopped.' },
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
    chart: [
      { ...consumerForecast, label: 'forecast: temp, cur', what: `Sea temperature and current from the announced forecast, one measurement per request (parameter-name). ${EDR}`, use: 'Drawn on the chart. Each measurement is checked against the digest on its own topic (✓/✗).' },
      {
        slot: 'features',
        label: 'features (optional)',
        standard: 'G',
        optional: true,
        what: "The forecast's fronts and eddies. GeoJSON from OGC API-Features (pygeoapi reads them from the Features DB).",
        use: 'Drawn on the chart (HI RES). Their count is checked against the announcement.',
        whenEmpty: 'Only offered while a feature detector is present; without them the chart is LOW RES.',
      },
    ],
    planner: [
      {
        ...consumerForecast,
        label: 'forecast: cur, wave',
        what: `Current and, if a wave-height sensor is fitted, wave height from the announced forecast, one measurement per request (parameter-name). ${EDR}`,
        use: 'Plans the route ahead: from the now-cast, or up to 48 h once future forecasts are offered. Each measurement is checked against the digest on its own topic (✓/✗).',
      },
    ],
    basic: [consumerForecast],
  } satisfies Record<ConsumerProfile, InputDecl[]>,
} satisfies Record<string, readonly InputDecl[] | Record<ConsumerProfile, InputDecl[]>>;

/** Consumers take the profiles in turn: C1 chart display, C2 passage planner, C3 basic, C4 chart… */
export function consumerProfile(index: number): ConsumerProfile {
  return (['chart', 'planner', 'basic'] as const)[index % 3]!;
}
