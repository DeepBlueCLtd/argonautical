/**
 * Broker (off-the-shelf, mocked): topics, subscriptions and retained messages (CAT-4).
 * Delivers only to a topic's subscribers. Announcements are retained, so a consumer that
 * subscribes late gets the latest one at once (catch-up without a query).
 */
import type { BrokerMessage, Topic } from '../contracts.ts';
import { catalogueHook, mqtt } from '../payloads.ts';
import type { TokenRecorder } from '../tokens.ts';
import { edgeId, type ElementId } from '../topology/elements.ts';

/** `retained`: delivered on subscribing, from the broker's store, not as it was published. */
export type Handler = (msg: BrokerMessage, retained: boolean) => void;

const RETAIN: Record<Topic, boolean> = { 'forecast/new': true, 'features/new': true, 'catalogue/changed': false };

export class Broker {
  private readonly subs = new Map<Topic, Map<string, Handler>>();
  private readonly retained = new Map<Topic, BrokerMessage>();
  published = 0;

  constructor(private readonly tokens: TokenRecorder) {}

  /** Register a subscription; a retained message on the topic is delivered straight away. */
  subscribe(instance: string, topic: Topic, handler: Handler): void {
    let m = this.subs.get(topic);
    if (!m) this.subs.set(topic, (m = new Map()));
    m.set(instance, handler);
    const r = this.retained.get(topic);
    if (r) this.deliver(instance, r, handler, true);
  }

  unsubscribe(instance: string, topic: Topic): void {
    this.subs.get(topic)?.delete(instance);
  }

  /** Subscriber count per topic, for the broker card. */
  get topics(): Record<Topic, number> {
    return { 'forecast/new': this.subs.get('forecast/new')?.size ?? 0, 'features/new': this.subs.get('features/new')?.size ?? 0, 'catalogue/changed': this.subs.get('catalogue/changed')?.size ?? 0 };
  }

  /** Retained messages, by topic (for the inspector). */
  get retainedMessages(): readonly BrokerMessage[] {
    return [...this.retained.values()];
  }

  /** Subscribers per topic (for the inspector). */
  get subscriptions(): Record<string, readonly string[]> {
    return Object.fromEntries([...this.subs].map(([t, m]) => [t, [...m.keys()]]));
  }

  get subscribers(): readonly string[] {
    return [...new Set([...this.subs.values()].flatMap((m) => [...m.keys()]))];
  }

  publish(from: ElementId, msg: BrokerMessage): void {
    this.tokens.emit(edgeId(from, 'publish', 'broker'), { payload: from === 'pygeoapi' ? catalogueHook(msg) : mqtt(msg) });
    this.published++;
    if (RETAIN[msg.topic]) this.retained.set(msg.topic, msg);
    for (const [instance, handler] of [...(this.subs.get(msg.topic) ?? [])]) this.deliver(instance, msg, handler, false);
  }

  private deliver(instance: string, msg: BrokerMessage, handler: Handler, retained: boolean): void {
    this.tokens.emit(edgeId('broker', 'deliver', 'consumer'), { instance, payload: mqtt(msg, instance) });
    handler(msg, retained);
  }
}
