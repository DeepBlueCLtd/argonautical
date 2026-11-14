/** Drift monitor (ours, inside the drift sensor): DRF-1..5. */
import { TIMING, type InputSpec } from '../config.ts';
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
  /** DRF-5: a run caused (at least partly) by drift is already queued or running. Plain data, not orchestrator state. */
  readonly driftRun?: 'queued' | 'running';
}

export interface DriftCheckResult {
  readonly residuals: Partial<Record<InputKey, number>>;
  /** Each reading's own residual in σ, oldest first (what the mean was taken over). */
  readonly readings?: Partial<Record<InputKey, number[]>>;
  /** DRF-6: each reading, and the forecast, in σ from the input's long-term mean (a common scale for the trace). */
  readonly levels?: Partial<Record<InputKey, { readonly obs: number[]; readonly forecast: number }>>;
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

  check({ params, streak, driftRun }: DriftCheckInput): DriftCheckResult {
    const forecast = this.reader.currentForecast();
    if (!forecast) {
      return { residuals: {}, exceeding: [], quorumMet: false, streak: 0, requestRun: false, status: 'no forecast yet' };
    }
    // DRF-1: average every reading since the last check, not just the latest: uses all the data and
    // cuts sensor noise by about √n (a real shift shows up about half a window later).
    const recent = this.reader.recentObservations(TIMING.driftSensorInterval);
    const obs: Partial<Record<InputKey, number>> = {};
    for (const [k, vs] of Object.entries(recent)) if (vs && vs.length) obs[k] = vs.reduce((a, b) => a + b, 0) / vs.length;
    const residuals: Partial<Record<InputKey, number>> = {};
    const readings: Partial<Record<InputKey, number[]>> = {};
    const levels: Partial<Record<InputKey, { obs: number[]; forecast: number }>> = {};
    const exceeding: InputKey[] = [];
    for (const spec of this.inputs) {
      const o = obs[spec.key];
      const f = forecast.values[spec.key];
      if (o === undefined || f === undefined) continue;
      const r = (o - f) / spec.sigma;
      residuals[spec.key] = r;
      readings[spec.key] = (recent[spec.key] ?? []).map((v) => (v - f) / spec.sigma);
      levels[spec.key] = { obs: (recent[spec.key] ?? []).map((v) => (v - spec.base) / spec.sigma), forecast: (f - spec.base) / spec.sigma };
      if (Math.abs(r) > params.threshold) exceeding.push(spec.key);
    }
    const q = params.quorum;
    if (exceeding.length === 0) {
      return { residuals, readings, levels, exceeding, quorumMet: false, streak: 0, requestRun: false, status: 'nothing out of range' };
    }
    if (exceeding.length < q) {
      return { residuals, readings, levels, exceeding, quorumMet: false, streak: 0, requestRun: false, status: `below quorum (${exceeding.length} of ${q})` };
    }
    const next = Math.min(streak + 1, params.persistence);
    if (next < params.persistence) {
      return { residuals, readings, levels, exceeding, quorumMet: true, streak: next, requestRun: false, status: `quorum met, persistence ${next} of ${params.persistence}` };
    }
    if (driftRun) {
      return { residuals, readings, levels, exceeding, quorumMet: true, streak: next, requestRun: false, status: driftRun === 'queued' ? 'drift persists, drift run already queued' : 'drift persists, drift run in progress' };
    }
    return { residuals, readings, levels, exceeding, quorumMet: true, streak: 0, requestRun: true, status: 'drift declared' };
  }
}
