/** Drift monitor (ours, inside the drift sensor): DRF-1..5. */
import type { InputSpec } from '../config.ts';
import type { DriftReader, InputKey } from '../contracts.ts';

export interface DriftParams {
  readonly threshold: number;
  readonly quorum: number;
  readonly persistence: number;
}

export interface DriftCheckInput {
  readonly params: DriftParams;
  /** Consecutive checks so far with quorum met (the sensor's cursor). */
  readonly streak: number;
  /** A run is already queued (DRF-5). Plain data, not orchestrator state. */
  readonly runQueued: boolean;
}

export interface DriftCheckResult {
  readonly residuals: Partial<Record<InputKey, number>>;
  readonly exceeding: readonly InputKey[];
  readonly quorumMet: boolean;
  /** Cursor to store for the next check. */
  readonly streak: number;
  /** True when a new run should be requested. */
  readonly requestRun: boolean;
  /** DRF-4 */
  readonly status: string;
}

export class DriftMonitor {
  constructor(
    private readonly inputs: readonly InputSpec[],
    private readonly reader: DriftReader,
  ) {}

  check({ params, streak, runQueued }: DriftCheckInput): DriftCheckResult {
    const forecast = this.reader.currentForecast();
    if (!forecast) {
      return { residuals: {}, exceeding: [], quorumMet: false, streak: 0, requestRun: false, status: 'no forecast yet' };
    }
    const obs = this.reader.latestObservations();
    const residuals: Partial<Record<InputKey, number>> = {};
    const exceeding: InputKey[] = [];
    for (const spec of this.inputs) {
      const o = obs[spec.key];
      const f = forecast.values[spec.key];
      if (o === undefined || f === undefined) continue;
      const r = (o - f) / spec.sigma;
      residuals[spec.key] = r;
      if (Math.abs(r) > params.threshold) exceeding.push(spec.key);
    }
    const q = params.quorum;
    if (exceeding.length === 0) {
      return { residuals, exceeding, quorumMet: false, streak: 0, requestRun: false, status: 'nothing out of range' };
    }
    if (exceeding.length < q) {
      return { residuals, exceeding, quorumMet: false, streak: 0, requestRun: false, status: `below quorum (${exceeding.length} of ${q})` };
    }
    const next = Math.min(streak + 1, params.persistence);
    if (next < params.persistence) {
      return { residuals, exceeding, quorumMet: true, streak: next, requestRun: false, status: `quorum met, persistence ${next} of ${params.persistence}` };
    }
    if (runQueued) {
      return { residuals, exceeding, quorumMet: true, streak: next, requestRun: false, status: 'drift persists, run already queued' };
    }
    return { residuals, exceeding, quorumMet: true, streak: 0, requestRun: true, status: 'drift declared' };
  }
}
