/**
 * Onboard consumer: CON-1..3 and CAT-5.
 *
 * On start, on Reconfigure and on `catalogue/changed`, it discovers what pygeoapi offers
 * (`GET /collections`) and subscribes to the topics it will use. It then fetches and verifies
 * what is announced. Its status says what level of service it can give with what is offered:
 * a chart display is LOW RES without features and HI RES with them; a passage planner works to
 * 12 h, or 48 h once the long-range forecast is served.
 */
import { TIMING } from '../config.ts';
import type { Announcement, BrokerMessage, CollectionInfo, FeaturesReady, Topic } from '../contracts.ts';
import { forecastDigest } from '../contracts.ts';
import type { EventLog } from '../events.ts';
import type { Broker } from '../platform/broker.ts';
import type { Caller, PygeoApi } from '../platform/pygeoapi.ts';
import * as P from '../payloads.ts';
import type { Stream } from '../rng.ts';
import type { TokenRecorder } from '../tokens.ts';
import { edgeId } from '../topology/elements.ts';
import type { ConsumerProfile } from '../topology/inputs.ts';

export interface ConsumerResult {
  readonly tick: number;
  readonly forecastId: string;
  readonly ok: boolean;
  readonly digestOk: boolean;
  readonly countOk: boolean;
  /** Set when this result covers features too. */
  readonly featureCount?: number;
  readonly horizon?: number;
  /** What made the consumer fetch: an announcement, subscribing late, or its user reconfiguring the app. */
  readonly trigger: 'announcement' | 'catch-up' | 'reconfigure';
}

const SUFFIX: Record<ConsumerResult['trigger'], string> = { announcement: '', 'catch-up': ' (catch-up)', reconfigure: ' (reconfigured)' };

type Pending = { due: number; kind: 'forecast'; msg: Announcement; trigger: ConsumerResult['trigger'] } | { due: number; kind: 'features'; msg: FeaturesReady; trigger: ConsumerResult['trigger'] };

export class Consumer {
  readonly results: ConsumerResult[] = [];
  private readonly pending: Pending[] = [];
  private readonly caller: Caller;
  /** Topics it is subscribed to now. */
  readonly topics = new Set<Topic>();
  /** The catalogue as this consumer last saw it (it only learns of changes by discovering again). */
  catalogue: readonly CollectionInfo[] = [];
  /** The forecast it holds and verified, and the forecast its features belong to. */
  private coverage?: { forecastId: string; horizon: number };
  private featuresFor?: string;

  constructor(
    readonly id: string,
    readonly subscribedAt: number,
    private readonly api: PygeoApi,
    private readonly broker: Broker,
    private readonly rng: Stream,
    private readonly log: EventLog,
    private readonly now: () => number,
    readonly profile: ConsumerProfile,
    private readonly tokens: TokenRecorder,
    private readonly catalogueNow: () => readonly CollectionInfo[],
  ) {
    this.caller = { element: 'consumer', instance: id };
    this.discover(subscribedAt, 'start');
  }

  get latest(): ConsumerResult | undefined {
    return this.results[this.results.length - 1];
  }

  get waiting(): number {
    return this.pending.length;
  }

  private offered(id: CollectionInfo['id']): CollectionInfo | undefined {
    return this.catalogue.find((c) => c.id === id);
  }

  /** CAT-5: the level of service it can give now. */
  get status(): string {
    if (!this.coverage) return 'waiting';
    switch (this.profile) {
      case 'chart': {
        if (this.featuresFor === this.coverage.forecastId) return 'HI RES';
        // Offered and being produced, but not yet in hand for this forecast.
        const st = this.offered('features')?.status;
        return st === 'from next run' || st === 'available' ? 'HI RES pending' : 'LOW RES';
      }
      case 'planner': {
        if (this.coverage.horizon >= 48) return '48 h';
        const fc = this.offered('forecast');
        return fc?.horizon === 48 || fc?.nextHorizon === 48 ? '48 h pending' : '12 h';
      }
      case 'basic':
        return 'OK';
    }
  }

  /** Topics this profile uses, given what is offered. */
  private wantedTopics(): Topic[] {
    const t: Topic[] = ['catalogue/changed', 'forecast/new'];
    if (this.profile === 'chart' && this.offered('features')) t.push('features/new');
    return t;
  }

  /** CAT-5: read the catalogue, then subscribe to (or drop) topics to match it. */
  discover(t: number, why: 'start' | 'catalogue changed' | 'reconfigure'): void {
    this.catalogue = this.api.collections(this.caller, this.catalogueNow());
    const wanted = new Set(this.wantedTopics());
    const offered = this.catalogue.map((c) => c.id + (c.status === 'available' ? '' : ` (${c.status})`)).join(', ');
    this.log.append(t, 'consumer', `${this.id} discovers (${why}): ${offered}`);
    for (const topic of [...this.topics]) {
      if (wanted.has(topic)) continue;
      this.topics.delete(topic);
      this.tokens.emit(edgeId('consumer', 'subscribe', 'broker'), { instance: this.id, payload: P.subscribe(topic, this.id, false) });
      this.broker.unsubscribe(this.id, topic);
    }
    for (const topic of wanted) {
      if (this.topics.has(topic)) continue;
      this.topics.add(topic);
      this.tokens.emit(edgeId('consumer', 'subscribe', 'broker'), { instance: this.id, payload: P.subscribe(topic, this.id, true) });
      // A retained announcement arrives at once: that is the catch-up (CON-2).
      this.broker.subscribe(this.id, topic, (msg, retained) => this.onMessage(msg, retained ? 'catch-up' : 'announcement'));
    }
  }

  private onMessage(msg: BrokerMessage, trigger: ConsumerResult['trigger']): void {
    const t = this.now();
    if (msg.topic === 'catalogue/changed') {
      this.discover(t, 'catalogue changed');
      return;
    }
    const [lo, hi] = TIMING.consumerDelay;
    const due = trigger === 'catch-up' ? t : t + this.rng.int(lo, hi);
    if (msg.topic === 'forecast/new') this.pending.push({ due, kind: 'forecast', msg: msg.body, trigger });
    else this.pending.push({ due, kind: 'features', msg: msg.body, trigger });
    this.pending.sort((a, b) => a.due - b.due);
    if (trigger === 'catch-up') this.tick(t);
  }

  tick(t: number): void {
    while (this.pending.length && this.pending[0]!.due <= t) {
      const p = this.pending.shift()!;
      if (p.kind === 'forecast') this.fetchForecast(t, p.msg, p.trigger);
      else this.fetchFeatures(t, p.msg, p.trigger);
    }
  }

  private fetchForecast(t: number, msg: Announcement, trigger: ConsumerResult['trigger']): void {
    const f = this.api.forecast(this.caller, msg.forecastId);
    const digestOk = !!f && f.digest === msg.digest && forecastDigest(f) === msg.digest;
    if (f && digestOk) this.coverage = { forecastId: f.id, horizon: f.horizon };
    this.record({ tick: t, forecastId: msg.forecastId, ok: digestOk, digestOk, countOk: true, horizon: f?.horizon, trigger });
  }

  private fetchFeatures(t: number, msg: FeaturesReady, trigger: ConsumerResult['trigger']): void {
    const feats = this.api.features(this.caller, msg.forecastId);
    const countOk = feats.length === msg.featureCount;
    if (countOk) this.featuresFor = msg.forecastId;
    this.record({ tick: t, forecastId: msg.forecastId, ok: countOk, digestOk: true, countOk, featureCount: feats.length, trigger });
  }

  /**
   * CON-3: its user reconfigures the app. It discovers again and fetches the latest forecast
   * (and, for a chart display, that forecast's features if they exist) without waiting.
   */
  query(t: number, trigger: 'catch-up' | 'reconfigure'): void {
    if (trigger === 'reconfigure') this.discover(t, 'reconfigure');
    const f = this.api.forecast(this.caller);
    if (!f) {
      this.log.append(t, 'consumer', `${this.id} ${trigger === 'catch-up' ? 'subscribed' : 'reconfigured'}; no forecast yet`);
      return;
    }
    const digestOk = forecastDigest(f) === f.digest;
    if (digestOk) this.coverage = { forecastId: f.id, horizon: f.horizon };
    this.record({ tick: t, forecastId: f.id, ok: digestOk, digestOk, countOk: true, horizon: f.horizon, trigger });
    if (this.topics.has('features/new') && this.api.latestFeatureForecastId(this.caller) === f.id) {
      const feats = this.api.features(this.caller, f.id);
      if (feats.length) this.featuresFor = f.id;
      this.record({ tick: t, forecastId: f.id, ok: feats.length > 0, digestOk: true, countOk: feats.length > 0, featureCount: feats.length, trigger });
    }
  }

  private record(r: ConsumerResult): void {
    this.results.push(r);
    const mark = r.ok ? '✓' : '✗';
    const what = r.featureCount !== undefined ? `${r.featureCount} features` : `forecast${r.horizon ? ` ${r.horizon} h` : ''}`;
    const detail = r.ok ? `${what} ok` : `${r.digestOk ? '' : 'digest mismatch '}${r.countOk ? '' : 'feature count mismatch'}`.trim();
    this.log.append(r.tick, 'consumer', `${this.id} ${mark} ${r.forecastId}${SUFFIX[r.trigger]}: ${detail} · ${this.status}`);
  }
}
