import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Script } from '../src/scenario.ts';
import type { Simulation } from '../src/simulation.ts';

export const SCENARIO_DIR = join(import.meta.dirname, '..', 'scenarios');

export function loadScenarios(): Script[] {
  return readdirSync(SCENARIO_DIR)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => JSON.parse(readFileSync(join(SCENARIO_DIR, f), 'utf8')) as Script);
}

export function loadScenario(name: string): Script {
  const s = loadScenarios().find((x) => x.name === name);
  if (!s) throw new Error(`no scenario ${name}`);
  return s;
}

export function events(sim: Simulation, kind?: string) {
  return sim.log.entries.filter((e) => !kind || e.kind === kind);
}
