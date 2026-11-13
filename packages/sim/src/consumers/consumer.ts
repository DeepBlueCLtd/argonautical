/** Onboard consumer: CON-1 (announcement), CON-2 (catch-up on subscribe), CON-3 (refresh on demand). */
import { TIMING } from '../config.ts';
import type { Announcement } from '../contracts.ts';
import { forecastDigest } from '../contracts.ts';
import type { EventLog } from '../events.ts';
import type { Broker } from '../platform/broker.ts';
import type { Caller, PygeoApi } from '../platform/pygeoapi.ts';
import type { Stream } from '../rng.ts';

export interface ConsumerResult {
  readonly tick: number;
  readonly forecastId: string;
  readonly ok: boolean;
  readonly digestOk: boolean;
  readonly countOk: boolean;
  readonly featureCount: number;
  /** What made the consumer query: an announcement, subscribing late, or its Refresh button. */
  readonly trigger: 'announcement' | 'catch-up' | 'refresh';
}

export class Consumer {
  readonly results: ConsumerResult[] = [];
  private readonly pending: { due: number; msg: Announcement }[] = [];
  private readonly caller: Caller;

  constructor(
    readonly id: string,
    readonly subscribedAt: number,
    private readonly api: PygeoApi,
    broker: Broker,
    private readonly rng: Stream,
    private readonly log: EventLog,
    private readonly now: () => number,
  ) {
    this.caller = { element: 'consumer', instance: id };
    broker.subscribe(id, (msg) => this.onAnnouncement(msg));
  }

  get latest(): ConsumerResult | undefined {
    return this.results[this.results.length - 1];
  }

  get waiting(): number {
    return this.pending.length;
  }

  private onAnnouncement(msg: Announcement): void {
    const [lo, hi] = TIMING.consumerDelay;
    this.pending.push({ due: this.now() + this.rng.int(lo, hi), msg });
  }

  tick(t: number): void {
    while (this.pending.length && this.pending[0]!.due <= t) {
      this.verify(t, this.pending.shift()!.msg);
    }
  }

  private verify(t: number, msg: Announcement): void {
    const f = this.api.forecast(this.caller, msg.forecastId);
    const feats = this.api.features(this.caller, msg.forecastId);
    const digestOk = !!f && f.digest === msg.digest && forecastDigest(f) === msg.digest;
    const countOk = feats.length === msg.featureCount;
    this.record({ tick: t, forecastId: msg.forecastId, ok: digestOk && countOk, digestOk, countOk, featureCount: feats.length, trigger: 'announcement' });
  }

  /**
   * Query straight away for the latest complete forecast (one whose features exist) and verify it.
   * CON-2 on subscribing late ('catch-up'); CON-3 when its Refresh button is pressed ('refresh').
   */
  query(t: number, trigger: 'catch-up' | 'refresh'): void {
    const id = this.api.latestFeatureForecastId(this.caller);
    if (!id) {
      this.log.append(t, 'consumer', trigger === 'catch-up' ? `${this.id} subscribed; no forecast yet` : `${this.id} refresh: no forecast yet`);
      return;
    }
    const f = this.api.forecast(this.caller, id);
    const feats = this.api.features(this.caller, id);
    const digestOk = !!f && forecastDigest(f) === f.digest;
    const countOk = feats.length > 0 && feats.every((x) => x.forecastId === id);
    this.record({ tick: t, forecastId: id, ok: digestOk && countOk, digestOk, countOk, featureCount: feats.length, trigger });
  }

  private record(r: ConsumerResult): void {
    this.results.push(r);
    const mark = r.ok ? '✓' : '✗';
    const detail = r.ok ? `digest ok, ${r.featureCount} features` : `${r.digestOk ? '' : 'digest mismatch '}${r.countOk ? '' : 'feature count mismatch'}`.trim();
    this.log.append(r.tick, 'consumer', `${this.id} ${mark} ${r.forecastId}${r.trigger === 'announcement' ? '' : ` (${r.trigger})`}: ${detail}`);
  }
}
