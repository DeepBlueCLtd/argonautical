import { describe, expect, it } from 'vitest';
import { inputsFor } from '../src/config.ts';
import type { Observation } from '../src/contracts.ts';
import { Ingestion } from '../src/modules/ingestion.ts';

const inputs = inputsFor(3); // temp base 12 σ0.5, sal 35 σ0.2, snd 1500 σ3
function setup() {
  const rows: Observation[] = [];
  const ing = new Ingestion(inputs, { append: (r) => rows.push(...r) });
  return { ing, rows };
}
const ok = { temp: 12, sal: 35, snd: 1500 };

describe('ingestion', () => {
  it('ING-1 rejects values that are not finite numbers', () => {
    const { ing, rows } = setup();
    const r = ing.ingest(1, { ...ok, temp: NaN, sal: Infinity });
    expect(r.rejected.map((x) => [x.input, x.reason])).toEqual([
      ['temp', 'not a finite number'],
      ['sal', 'not a finite number'],
    ]);
    expect(rows.map((x) => x.input)).toEqual(['snd']);
  });

  it('ING-2 rejects values outside ±10σ of climatology', () => {
    const { ing } = setup();
    expect(ing.ingest(1, { ...ok, temp: 12 + 10 * 0.5 + 0.01 }).rejected[0]?.reason).toBe('outside ±10σ of climatology');
    expect(ing.ingest(2, { ...ok, temp: 12 - 10 * 0.5 + 0.01 }).rejected).toHaveLength(0);
  });

  it('ING-3 rejects a jump of more than 4σ from the last accepted value', () => {
    const { ing } = setup();
    ing.ingest(1, ok);
    expect(ing.ingest(2, { ...ok, temp: 12 + 4 * 0.5 + 0.01 }).rejected[0]?.reason).toBe('jump > 4σ from last accepted');
    // compared with the last *accepted* value, which is still 12
    expect(ing.ingest(3, { ...ok, temp: 12 + 4 * 0.5 - 0.01 }).rejected).toHaveLength(0);
  });

  it('ING-4 counts accepted and rejected readings; only accepted ones are written', () => {
    const { ing, rows } = setup();
    ing.ingest(1, ok);
    ing.ingest(2, { ...ok, sal: NaN });
    expect(ing.acceptedCount).toBe(5);
    expect(ing.rejectedCount).toBe(1);
    expect(rows).toHaveLength(5);
  });
});
