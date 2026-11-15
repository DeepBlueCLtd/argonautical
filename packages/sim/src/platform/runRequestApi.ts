/**
 * Run-request API (ours, thin; distribution zone): RRQ-1–3. The watchkeeper posts requests; the
 * run-request sensor polls for pending ones from inside the enclave and posts run status back. The
 * mission network never reaches the enclave.
 */
import type { RunRequestRecord } from '../contracts.ts';
import * as P from '../payloads.ts';
import type { TokenRecorder } from '../tokens.ts';
import { edgeId } from '../topology/elements.ts';

export class RunRequestApi {
  readonly requests: RunRequestRecord[] = [];
  private seq = 0;

  constructor(private readonly tokens: TokenRecorder) {}

  /** RRQ-1: the watchkeeper's request. */
  post(tick: number, by = 'watchkeeper'): RunRequestRecord {
    const r: RunRequestRecord = { id: `Q${++this.seq}`, requestedAt: tick, by };
    this.requests.push(r);
    this.tokens.emit(edgeId('watchkeeper', 'send', 'runRequestApi'), { payload: P.runRequestPost(r) });
    return r;
  }

  get pending(): readonly RunRequestRecord[] {
    return this.requests.filter((r) => r.polledAt === undefined);
  }

  /** RRQ-2: a poll. Empty polls are neither drawn nor logged. */
  poll(tick: number): readonly RunRequestRecord[] {
    const got = this.pending;
    if (!got.length) return got;
    const q = edgeId('manualRequest', 'query', 'runRequestApi');
    this.tokens.emit(q, { payload: P.runRequestPoll(), role: 'request' });
    this.tokens.emit(q, { payload: P.runRequestBatch(got), role: 'response', reverse: true });
    for (const r of got) r.polledAt = tick;
    return got;
  }

  /** RRQ-3: status of a completed run, for the requests it served. */
  postStatus(ids: readonly string[], runId: string, forecastId: string, tick: number): void {
    if (!ids.length) return;
    this.tokens.emit(edgeId('manualRequest', 'send', 'runRequestApi'), { payload: P.runStatusPost(ids, runId, forecastId, tick) });
    for (const r of this.requests) if (ids.includes(r.id)) r.status = { runId, forecastId, at: tick };
  }
}
