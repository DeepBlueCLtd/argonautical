/** Broker (off-the-shelf, mocked): delivers only to subscribers. */
import type { Announcement } from '../contracts.ts';
import type { TokenRecorder } from '../tokens.ts';
import { edgeId, type ElementId } from '../topology/elements.ts';

export type Handler = (msg: Announcement) => void;

export class Broker {
  private readonly subs = new Map<string, Handler>();
  published = 0;

  constructor(private readonly tokens: TokenRecorder) {}

  subscribe(instance: string, handler: Handler): void {
    this.subs.set(instance, handler);
  }

  get subscribers(): readonly string[] {
    return [...this.subs.keys()];
  }

  publish(from: ElementId, msg: Announcement): void {
    this.tokens.emit(edgeId(from, 'publish', 'broker'));
    this.published++;
    for (const [instance, handler] of this.subs) {
      this.tokens.emit(edgeId('broker', 'deliver', 'consumer'), { instance });
      handler(msg);
    }
  }
}
