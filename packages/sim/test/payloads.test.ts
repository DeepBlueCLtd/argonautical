import { describe, expect, it } from 'vitest';
import { runScript } from '../src/scenario.ts';
import type { Token } from '../src/tokens.ts';
import { loadScenarios } from './helpers.ts';

/** Collect every token a scenario emits (the recorder only keeps a recent window). */
function allTokens(name: string): Token[] {
  const s = loadScenarios().find((x) => x.name === name)!;
  const seen = new Map<number, Token>();
  runScript(s, (sim) => {
    for (const t of sim.tokens.tokens) seen.set(t.seq, t);
  });
  return [...seen.values()];
}

describe('token payloads (drill-down)', () => {
  const tokens = loadScenarios().flatMap((s) => allTokens(s.name));

  it('every token carries a payload with a summary, a format and data', () => {
    const missing = tokens.filter((t) => !t.payload?.summary || !t.payload.format || t.payload.data === undefined).map((t) => t.edge);
    expect([...new Set(missing)]).toEqual([]);
  });

  it('payloads are plain JSON (non-finite numbers are strings)', () => {
    for (const t of tokens) expect(JSON.parse(JSON.stringify(t.payload)), t.edge).toEqual(t.payload);
  });

  it('a retry call says it is a retry', () => {
    const retry = allTokens('runner-offline').find((t) => t.retry && t.edge === 'shimRun>call>modelRunner')!;
    expect(retry.payload!.summary).toMatch(/retry \d+/);
  });

  it('payloads carry real values: the committed forecast and the MQTT announcement agree', () => {
    const ts = allTokens('drift');
    const commit = ts.find((t) => t.edge === 'modelRunner>write>netcdfStore' && (t.payload!.data as { global_attributes: { cause: string } }).global_attributes.cause === 'drift')!;
    const digest = (commit.payload!.data as { global_attributes: { digest: string } }).global_attributes.digest;
    const delivered = ts.filter((t) => t.edge === 'broker>deliver>consumer' && (t.payload!.data as { payload: { digest: string } }).payload.digest === digest);
    expect(delivered.map((t) => t.instance).sort()).toEqual(['C1', 'C2']);
  });

  it('a rejected NaN reading is shown as a string, not lost', () => {
    const send = allTokens('failures').filter((t) => t.edge === 'sensors>publish>sensorBroker');
    const values = send.flatMap((t) => (t.payload!.data as { messages: { payload: { result: unknown } }[] }).messages.map((m) => m.payload.result));
    expect(values).toContain('NaN');
  });

  it('every read through pygeoapi is a round trip: request, db query, rows, response', () => {
    const ts = allTokens('drift');
    const reads = ts.filter((t) => t.role);
    expect(reads.length).toBeGreaterThan(0);
    // group consecutive legs by seq: each exchange is four tokens in order
    // The catalogue read (GET /collections) is answered from pygeoapi's configuration: two legs, no store.
    const requests = reads.filter((t) => t.role === 'request' && t.payload!.standard !== 'O');
    for (const req of requests.slice(0, 20)) {
      const legs = reads.filter((t) => t.seq > req.seq && t.seq <= req.seq + 3);
      expect(legs.map((t) => t.role), req.edge).toEqual(['db-query', 'db-rows', 'response']);
      expect(legs[0]!.reverse).toBe(true); // pygeoapi → store, against the read arrow
      expect(legs[1]!.reverse).toBeUndefined(); // store → pygeoapi
      expect(legs[2]!.reverse).toBe(true); // pygeoapi → caller, against the query arrow
      expect(legs[2]!.edge).toBe(req.edge);
      expect(legs[2]!.instance).toBe(req.instance);
    }
  });

  it('a consumer response carries the forecast it verified', () => {
    const ts = allTokens('drift');
    const resp = ts.find((t) => t.role === 'response' && t.instance === 'C1' && /Forecast F\d/.test(t.payload!.summary))!;
    expect(resp.edge).toBe('consumer>query>pygeoapi');
    expect((resp.payload!.data as { type: string }).type).toBe('Coverage');
  });

  it('with the Observations DB stopped, the caller gets a 503 and no rows', () => {
    const ts = allTokens('buffering').filter((t) => t.start > 80 && t.start <= 110 && t.edge.includes('observationsDb>read'));
    expect(ts.some((t) => t.role === 'db-rows')).toBe(false);
    const refused = allTokens('buffering').filter((t) => t.start > 80 && t.start <= 110 && t.role === 'response' && t.payload!.format === 'HTTP 503 response');
    expect(refused.length).toBeGreaterThan(0);
  });

  it('each token is lettered by the standard of its content', () => {
    const ts = [...allTokens('drift'), ...allTokens('buffering')];
    const std = (pred: (t: Token) => boolean) => [...new Set(ts.filter(pred).map((t) => t.payload!.standard))].sort();
    expect(std((t) => t.edge === 'sensors>publish>sensorBroker' || t.edge === 'sensorBroker>deliver>ingestion')).toEqual(['S']);
    expect(std((t) => t.edge === 'ingestion>write>observationsDb')).toEqual(['Q']);
    expect(std((t) => t.edge.endsWith('>read>pygeoapi') && t.edge.startsWith('observationsDb'))).toEqual(['Q']);
    expect(std((t) => t.edge.startsWith('netcdfStore>read'))).toEqual(['N']);
    expect(std((t) => t.edge === 'modelRunner>write>netcdfStore')).toEqual(['N']);
    expect(std((t) => t.edge === 'consumer>query>pygeoapi' && t.role === 'request')).toEqual(['E', 'F', 'O']);
    expect(std((t) => t.edge === 'consumer>query>pygeoapi' && t.role === 'response')).toEqual(['C', 'G', 'O']);
    expect(std((t) => t.edge === 'consumer>subscribe>broker')).toEqual(['M']);
    expect(std((t) => t.edge === 'driftMonitor>query>pygeoapi')).toEqual(['C', 'E', 'H', 'S']);
    expect(std((t) => t.edge.includes('>lineage>') || t.edge.includes('>trigger>') || t.edge.includes('>call>'))).toEqual(['D']);
    expect(std((t) => t.edge.endsWith('>publish>broker') || t.edge === 'broker>deliver>consumer')).toEqual(['M']);
  });

  it('the catalogue read is two legs: request, then response from pygeoapi itself', () => {
    const ts = allTokens('drift').filter((t) => t.payload?.standard === 'O');
    const req = ts.find((t) => t.role === 'request')!;
    const res = ts.find((t) => t.seq === req.seq + 1)!;
    expect(res).toMatchObject({ role: 'response', reverse: true, edge: req.edge, instance: req.instance });
  });
});
