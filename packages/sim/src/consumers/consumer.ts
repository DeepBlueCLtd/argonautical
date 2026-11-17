/**
 * Onboard consumer: CON-1..3 and CAT-5.
 *
 * When the system comes on (and on Reconfigure) it shakes hands: it reads what pygeoapi offers
 * (`GET /collections`), tailors itself to it, and subscribes to the topics it will use. It then
 * fetches and verifies what is announced. Its status is how it tailored itself: a chart display
 * is HI RES if features are offered, else LOW RES; a passage planner works to the forecast's furthest
 * window (NOW-CAST, or 48 h with future forecasts), + WAVES when wave height is offered; a basic display just shows the forecast.
 *
 * CAT-4: a profile that declares the measurements it uses subscribes to `forecast/<key>` for each one
 * offered, and fetches just that measurement (EDR `parameter-name`), rather than the whole forecast.
 */
import { TIMING } from '../config.ts';
import type { Announcement, BrokerMessage, CollectionInfo, FeaturesReady, InputKey, MeasurementReady, Topic, Windows } from '../contracts.ts';
import { forecastDigest, furthestWindow, isMeasurementMessage, measurementTopic, NOWCAST, parameterDigest, topicMeasurement, windowsLabel } from '../contracts.ts';
import type { EventLog } from '../events.ts';
import type { Broker } from '../platform/broker.ts';
import type { Caller, PygeoApi } from '../platform/pygeoapi.ts';
import * as P from '../payloads.ts';
import type { Stream } from '../rng.ts';
import type { TokenRecorder } from '../tokens.ts';
import { edgeId } from '../topology/elements.ts';
import { PROFILES, type ConsumerProfile } from '../topology/inputs.ts';

export interface ConsumerResult {
  readonly tick: number;
  readonly forecastId: string;
  readonly ok: boolean;
  readonly digestOk: boolean;
  readonly countOk: boolean;
  /** Set when this result covers features too. */
  readonly featureCount?: number;
  readonly windows?: Windows;
  /** Set when this result covers one measurement (CAT-4). */
  readonly measurement?: InputKey;
  /** What made the consumer fetch: an announcement, subscribing late, or its user reconfiguring the app. */
  readonly trigger: 'announcement' | 'catch-up' | 'reconfigure';
}

const SUFFIX: Record<ConsumerResult['trigger'], string> = { announcement: '', 'catch-up': ' (catch-up)', reconfigure: ' (reconfigured)' };

type Pending =
  | { due: number; kind: 'forecast'; msg: Announcement; trigger: ConsumerResult['trigger'] }
  | { due: number; kind: 'features'; msg: FeaturesReady; trigger: ConsumerResult['trigger'] }
  | { due: number; kind: 'measurement'; msg: MeasurementReady; trigger: ConsumerResult['trigger'] };

/** CAT-5: how far ahead a passage planner can plan: NOW-CAST, or its furthest window ("48 h"). */
export function plannerReach(w: Windows): string {
  const h = furthestWindow(w);
  return h === 0 ? 'NOW-CAST' : `${h} h`;
}

export class Consumer {
  readonly results: ConsumerResult[] = [];
  private readonly pending: Pending[] = [];
  private readonly caller: Caller;
  /** Topics it is subscribed to now. */
  readonly topics = new Set<Topic>();
  /** The catalogue as this consumer last saw it (it only learns of changes by discovering again). */
  catalogue: readonly CollectionInfo[] = [];
  /** The forecast it holds and verified, and the forecast its features belong to. */
  private coverage?: { forecastId: string; windows: Windows };
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

  /** CAT-4: the measurements this profile uses that the forecast offers, in the profile's order. */
  get measurements(): InputKey[] {
    const params = this.offered('forecast')?.parameters ?? [];
    return PROFILES[this.profile].measurements.filter((k) => params.includes(k));
  }

  /** CAT-5: how it tailored itself to what is offered. */
  get status(): string {
    switch (this.profile) {
      case 'chart':
        return this.offered('features') ? 'HI RES' : 'LOW RES';
      case 'planner':
        return `${plannerReach(this.offered('forecast')?.windows ?? NOWCAST)}${this.measurements.includes('wave') ? ' + WAVES' : ''}`;
      case 'basic':
        return 'OK';
    }
  }

  /** Topics this profile uses, given what is offered: its measurements' topics, else the whole forecast. */
  private wantedTopics(): Topic[] {
    const m = this.measurements;
    const t: Topic[] = m.length ? m.map(measurementTopic) : ['forecast/new'];
    if (this.profile === 'chart' && this.offered('features')) t.push('features/new');
    return t;
  }

  /** CAT-5: the handshake. Read the catalogue, then subscribe to (or drop) topics to match it. */
  discover(t: number, why: 'start' | 'reconfigure'): void {
    this.catalogue = this.api.collections(this.caller, this.catalogueNow());
    const wanted = new Set(this.wantedTopics());
    const offered = this.catalogue.map((c) => c.id + (c.windows ? ` ${windowsLabel(c.windows)}` : '')).join(', ');
    this.log.append(t, 'consumer', `${this.id} handshake (${why}): ${offered} → ${this.status}`);
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
    const [lo, hi] = TIMING.consumerDelay;
    const due = trigger === 'catch-up' ? t : t + this.rng.int(lo, hi);
    if (isMeasurementMessage(msg)) this.pending.push({ due, kind: 'measurement', msg: msg.body, trigger });
    else if (msg.topic === 'forecast/new') this.pending.push({ due, kind: 'forecast', msg: msg.body, trigger });
    else this.pending.push({ due, kind: 'features', msg: msg.body, trigger });
    this.pending.sort((a, b) => a.due - b.due);
    if (trigger === 'catch-up') this.tick(t);
  }

  tick(t: number): void {
    while (this.pending.length && this.pending[0]!.due <= t) {
      const p = this.pending.shift()!;
      if (p.kind === 'forecast') this.fetchForecast(t, p.msg, p.trigger);
      else if (p.kind === 'measurement') this.fetchMeasurement(t, p.msg, p.trigger);
      else this.fetchFeatures(t, p.msg, p.trigger);
    }
  }

  private fetchForecast(t: number, msg: Announcement, trigger: ConsumerResult['trigger']): void {
    const f = this.api.forecast(this.caller, msg.forecastId);
    const digestOk = !!f && f.digest === msg.digest && forecastDigest(f) === msg.digest;
    if (f && digestOk) this.coverage = { forecastId: f.id, windows: f.windows };
    this.record({ tick: t, forecastId: msg.forecastId, ok: digestOk, digestOk, countOk: true, windows: f?.windows, trigger });
  }

  /** CAT-4: fetch one measurement of the announced forecast and check it against its topic's digest. */
  private fetchMeasurement(t: number, msg: MeasurementReady, trigger: ConsumerResult['trigger']): void {
    const r = this.api.forecastParameter(this.caller, msg.forecastId, msg.parameter);
    const digestOk = !!r && r.digest === msg.digest && parameterDigest(r.forecast, msg.parameter) === msg.digest;
    if (r && digestOk) this.coverage = { forecastId: r.forecast.id, windows: r.forecast.windows };
    this.record({ tick: t, forecastId: msg.forecastId, ok: digestOk, digestOk, countOk: true, windows: r?.forecast.windows, measurement: msg.parameter, trigger });
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
    const keys = [...this.topics].map(topicMeasurement).filter((k): k is InputKey => k !== undefined);
    if (keys.length) {
      for (const key of keys) {
        const r = this.api.forecastParameter(this.caller, undefined, key);
        if (!r) {
          this.log.append(t, 'consumer', `${this.id} ${trigger === 'catch-up' ? 'subscribed' : 'reconfigured'}; no forecast yet`);
          return;
        }
        const digestOk = parameterDigest(r.forecast, key) === r.digest;
        if (digestOk) this.coverage = { forecastId: r.forecast.id, windows: r.forecast.windows };
        this.record({ tick: t, forecastId: r.forecast.id, ok: digestOk, digestOk, countOk: true, windows: r.forecast.windows, measurement: key, trigger });
      }
      this.queryFeatures(t, this.coverage?.forecastId, trigger);
      return;
    }
    const f = this.api.forecast(this.caller);
    if (!f) {
      this.log.append(t, 'consumer', `${this.id} ${trigger === 'catch-up' ? 'subscribed' : 'reconfigured'}; no forecast yet`);
      return;
    }
    const digestOk = forecastDigest(f) === f.digest;
    if (digestOk) this.coverage = { forecastId: f.id, windows: f.windows };
    this.record({ tick: t, forecastId: f.id, ok: digestOk, digestOk, countOk: true, windows: f.windows, trigger });
    this.queryFeatures(t, f.id, trigger);
  }

  /** CON-3: for a chart display, that forecast's features too, if they exist. */
  private queryFeatures(t: number, forecastId: string | undefined, trigger: ConsumerResult['trigger']): void {
    if (!forecastId || !this.topics.has('features/new') || this.api.latestFeatureForecastId(this.caller) !== forecastId) return;
    const feats = this.api.features(this.caller, forecastId);
    if (feats.length) this.featuresFor = forecastId;
    this.record({ tick: t, forecastId, ok: feats.length > 0, digestOk: true, countOk: feats.length > 0, featureCount: feats.length, trigger });
  }

  private record(r: ConsumerResult): void {
    this.results.push(r);
    const mark = r.ok ? '✓' : '✗';
    const what = r.featureCount !== undefined ? `${r.featureCount} features` : `${r.measurement ?? 'forecast'}${r.windows ? ` ${windowsLabel(r.windows)}` : ''}`;
    const detail = r.ok ? `${what} ok` : `${r.digestOk ? '' : 'digest mismatch '}${r.countOk ? '' : 'feature count mismatch'}`.trim();
    this.log.append(r.tick, 'consumer', `${this.id} ${mark} ${r.forecastId}${SUFFIX[r.trigger]}: ${detail} · ${this.status}`);
  }
}
