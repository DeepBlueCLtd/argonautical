/** Ingestion (ours, not orchestrated): ING-1..4. The only writer to the Observations DB. */
import type { InputSpec } from '../config.ts';
import { NUMERICS } from '../config.ts';
import type { InputKey, Observation, ObservationWriter, SensorMessage } from '../contracts.ts';

export type RejectReason = 'not a finite number' | 'outside ±10σ of climatology' | 'jump > 4σ from last accepted';

export interface Rejection {
  /** Measurement time of the rejected reading. */
  readonly tick: number;
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

  /** Convenience: one reading per input, all measured at `tick`. */
  ingest(tick: number, readings: Readonly<Record<InputKey, number>>): IngestResult {
    return this.ingestMessages(this.inputs.map((s) => ({ tick, input: s.key, value: readings[s.key] ?? NaN })));
  }

  /** Validate messages in order (each keeps its measurement time) and write the accepted ones in one commit. */
  ingestMessages(messages: readonly SensorMessage[]): IngestResult {
    const accepted: Observation[] = [];
    const rejected: Rejection[] = [];
    for (const m of messages) {
      const spec = this.inputs.find((s) => s.key === m.input);
      if (!spec) continue;
      const reason = this.validate(spec, m.value);
      if (reason) {
        rejected.push({ tick: m.tick, input: m.input, value: m.value, reason });
      } else {
        accepted.push({ tick: m.tick, input: m.input, value: m.value });
        this.lastAccepted.set(m.input, m.value);
      }
    }
    if (accepted.length) this.writer.append(accepted);
    this.acceptedCount += accepted.length;
    this.rejectedCount += rejected.length;
    return { accepted, rejected };
  }
}
