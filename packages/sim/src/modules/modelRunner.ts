/** Model runner (ours, inside forecast): MOD-1, MOD-2. */
import type { InputSpec } from '../config.ts';
import { NUMERICS, TIMING } from '../config.ts';
import type { Forecast, ForecastWriter, Job, ModelReader } from '../contracts.ts';
import { forecastDigest } from '../contracts.ts';

export interface RunRequest {
  readonly id: string;
  readonly cause: string;
  readonly tick: number;
}

export class ModelRunner {
  constructor(
    private readonly inputs: readonly InputSpec[],
    private readonly reader: ModelReader,
    private readonly writer: ForecastWriter,
  ) {}

  /** Read inputs and stage the forecast now; commit it atomically when the job completes. */
  start(req: RunRequest): Job<Forecast> {
    const clim = this.reader.climatology();
    const background = this.reader.latestForecast();
    const recent = this.reader.recentObservations(NUMERICS.recentObservations);
    const values: Record<string, number> = {};
    for (const spec of this.inputs) {
      const c = clim[spec.key] ?? spec.base;
      const bg = background?.values[spec.key] ?? c;
      const obs = recent[spec.key];
      const target = obs && obs.length ? obs.reduce((a, b) => a + b, 0) / obs.length : c;
      values[spec.key] = bg + NUMERICS.nudge * (target - bg);
    }
    const label = background ? `replacing ${req.tick >= background.validUntil ? 'stale ' : ''}${background.id}` : 'first forecast';
    const writer = this.writer;
    const inputs = this.inputs.map((s) => s.key);
    let staged: Forecast | undefined;
    return {
      duration: TIMING.modelRunDuration,
      label,
      progress() {},
      complete() {
        const validUntil = req.tick + TIMING.modelRunDuration + TIMING.staleAfter;
        const base = { id: req.id, cause: req.cause, issuedAt: req.tick + TIMING.modelRunDuration, validUntil, inputs, values };
        staged = { ...base, digest: forecastDigest(base) };
        writer.commit(staged);
        return staged;
      },
    };
  }
}
