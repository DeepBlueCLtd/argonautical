/** Ingestion (ours, not orchestrated): ING-1..4. The only writer to the Observations DB. */
import type { InputSpec } from '../config.ts';
import { NUMERICS } from '../config.ts';
import type { InputKey, Observation, ObservationWriter } from '../contracts.ts';

export type RejectReason = 'not a finite number' | 'outside ±10σ of climatology' | 'jump > 4σ from last accepted';

export interface Rejection {
  readonly input: InputKey;
  readonly value: number;
  readonly reason: RejectReason;
}

export interface IngestResult {
  readonly accepted: readonly Observation[];
  readonly rejected: readonly Rejection[];
}

export class Ingestion {
  private readonly lastAccepted = new Map<InputKey, number>();
  acceptedCount = 0;
  rejectedCount = 0;

  constructor(
    private readonly inputs: readonly InputSpec[],
    private readonly writer: ObservationWriter,
  ) {}

  validate(spec: InputSpec, value: number): RejectReason | undefined {
    if (!Number.isFinite(value)) return 'not a finite number';
    if (Math.abs(value - spec.base) > NUMERICS.climatologyLimitSigma * spec.sigma) return 'outside ±10σ of climatology';
    const last = this.lastAccepted.get(spec.key);
    if (last !== undefined && Math.abs(value - last) > NUMERICS.jumpLimitSigma * spec.sigma) return 'jump > 4σ from last accepted';
    return undefined;
  }

  ingest(tick: number, readings: Readonly<Record<InputKey, number>>): IngestResult {
    const accepted: Observation[] = [];
    const rejected: Rejection[] = [];
    for (const spec of this.inputs) {
      const value = readings[spec.key] ?? NaN;
      const reason = this.validate(spec, value);
      if (reason) {
        rejected.push({ input: spec.key, value, reason });
      } else {
        accepted.push({ tick, input: spec.key, value });
        this.lastAccepted.set(spec.key, value);
      }
    }
    if (accepted.length) this.writer.append(accepted);
    this.acceptedCount += accepted.length;
    this.rejectedCount += rejected.length;
    return { accepted, rejected };
  }
}
