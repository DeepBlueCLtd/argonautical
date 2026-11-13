/**
 * Declared inputs (MOT-7): the data objects each reader needs before it can run, in the order it
 * reads them. The UI draws one document slot per input; a pygeoapi response fills the slot named
 * by its `slot`. Kept beside the topology so the diagram never decides what a component depends on.
 */
import type { StandardCode } from '../payloads.ts';

export type InputSlot = 'forecast' | 'observations' | 'climatology' | 'features';

export interface InputDecl {
  readonly slot: InputSlot;
  /** What the reader calls it (the model runner's forecast is its background). */
  readonly label: string;
  /** Standard of the response that fills it. */
  readonly standard: StandardCode;
}

const forecast: InputDecl = { slot: 'forecast', label: 'forecast', standard: 'C' };
const observations: InputDecl = { slot: 'observations', label: 'observations', standard: 'S' };
const climatology: InputDecl = { slot: 'climatology', label: 'climatology', standard: 'C' };
const features: InputDecl = { slot: 'features', label: 'features', standard: 'G' };

/** What a consumer app needs: the forecast coverage only, or the coverage and its features. */
export type ConsumerNeeds = 'coverage' | 'coverage+features';

export const INPUTS = {
  driftMonitor: [forecast, observations],
  modelRunner: [climatology, { ...forecast, label: 'background (previous forecast)' }, observations],
  featureDetector: [forecast, climatology],
  consumer: { coverage: [forecast], 'coverage+features': [forecast, features] } satisfies Record<ConsumerNeeds, InputDecl[]>,
} as const;

/** Consumers alternate: C1, C3… need coverage and features; C2, C4… need the coverage only. */
export function consumerNeeds(index: number): ConsumerNeeds {
  return index % 2 === 0 ? 'coverage+features' : 'coverage';
}
