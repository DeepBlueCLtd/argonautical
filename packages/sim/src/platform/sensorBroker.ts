/**
 * Sensor broker (off-the-shelf, mocked; e.g. Mosquitto on the OT network). The DAQ gateway publishes one
 * SensorThings Observation message per reading. Ingestion holds a persistent session (QoS 1): messages
 * stay queued until ingestion acknowledges them, which it does only after the database commit. So an
 * ingestion or database restart loses nothing; the backlog drains in order afterwards.
 */
import type { InputKey, SensorMessage } from '../contracts.ts';
import * as P from '../payloads.ts';
import type { TokenRecorder } from '../tokens.ts';
import { edgeId } from '../topology/elements.ts';

export class SensorBroker {
  private queue: SensorMessage[] = [];
  published = 0;
  delivered = 0;

  constructor(
    private readonly tokens: TokenRecorder,
    private readonly units: Record<InputKey, string>,
  ) {}

  publish(tick: number, readings: Readonly<Record<InputKey, number>>): void {
    const msgs = Object.entries(readings).map(([input, value]) => ({ tick, input, value }));
    this.queue.push(...msgs);
    this.published += msgs.length;
    this.tokens.emit(edgeId('sensors', 'publish', 'sensorBroker'), { payload: P.sensorPublish(msgs, this.units) });
  }

  /** Unacknowledged messages, oldest first (for the inspector). */
  get pending(): readonly SensorMessage[] {
    return this.queue;
  }

  get queued(): number {
    return this.queue.length;
  }

  /** Measurement time of the oldest unacknowledged message. */
  get oldest(): number | undefined {
    return this.queue[0]?.tick;
  }

  /** Deliver up to `max` of the oldest messages; they stay queued until acknowledged. */
  deliver(max: number, now: number): readonly SensorMessage[] {
    const batch = this.queue.slice(0, max);
    if (batch.length) this.tokens.emit(edgeId('sensorBroker', 'deliver', 'ingestion'), { payload: P.sensorDelivery(batch, this.queue.length - batch.length, now) });
    return batch;
  }

  /** Ingestion acknowledges after its database commit. */
  ack(n: number): void {
    this.queue = this.queue.slice(n);
    this.delivered += n;
  }
}
