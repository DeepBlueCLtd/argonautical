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
    const send = allTokens('failures').filter((t) => t.edge === 'sensors>send>ingestion');
    const values = send.flatMap((t) => (t.payload!.data as { readings: { value: unknown }[] }).readings.map((r) => r.value));
    expect(values).toContain('NaN');
  });
});
