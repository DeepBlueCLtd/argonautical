/**
 * ARC-5: deterministic replay against checked-in golden digests.
 * Regenerate after an intended behaviour change: npm run golden:update -w @argonautical/sim
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { runScript } from '../src/scenario.ts';
import { loadScenarios } from './helpers.ts';

const GOLDEN = join(import.meta.dirname, 'golden.json');
const update = process.env.UPDATE_GOLDEN === '1';
const golden: Record<string, string> = existsSync(GOLDEN) ? JSON.parse(readFileSync(GOLDEN, 'utf8')) : {};
const scenarios = loadScenarios();

describe('golden replay (ARC-5)', () => {
  if (update) {
    it('writes golden digests', () => {
      const out = Object.fromEntries(scenarios.map((s) => [s.name, runScript(s).digest]));
      writeFileSync(GOLDEN, JSON.stringify(out, null, 2) + '\n');
    });
    return;
  }

  it('every scenario has a golden digest', () => {
    expect(Object.keys(golden).sort()).toEqual(scenarios.map((s) => s.name).sort());
  });

  for (const s of scenarios) {
    it(`${s.name} replays to its golden digest`, () => {
      expect(runScript(s).digest).toBe(golden[s.name]);
    });
  }
});
