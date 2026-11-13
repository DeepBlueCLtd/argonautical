/**
 * Replay scripts (ARC-5), also the format for tours (TOUR-2):
 * seed + timed control actions, run headless to a fixed tick.
 */
import { Simulation, type ControlAction } from './simulation.ts';

export interface ScriptStep {
  /** Applied when the clock reads this tick, before the next step. */
  readonly at: number;
  /** Omitted for caption-only steps. */
  readonly action?: ControlAction;
  /** Tour caption (TOUR-3); ignored by replay tests. */
  readonly caption?: string;
}

export interface Script {
  readonly name: string;
  readonly description: string;
  readonly seed: string;
  readonly inputs?: number;
  readonly consumers?: number;
  /** CAT-1: starting capabilities (default: feature detector present, 12 h). */
  readonly capabilities?: { readonly featureDetector?: boolean; readonly longRange?: boolean };
  /** Run until this tick. */
  readonly until: number;
  readonly steps: readonly ScriptStep[];
}

export function runScript(script: Script, onTick?: (sim: Simulation) => void): Simulation {
  const sim = new Simulation({ seed: script.seed, inputs: script.inputs, consumers: script.consumers, capabilities: script.capabilities });
  const steps = [...script.steps].sort((a, b) => a.at - b.at);
  let i = 0;
  while (sim.tick < script.until) {
    while (i < steps.length && steps[i]!.at <= sim.tick) applyStep(sim, steps[i++]!);
    sim.step();
    onTick?.(sim);
  }
  while (i < steps.length && steps[i]!.at <= sim.tick) applyStep(sim, steps[i++]!);
  return sim;
}

function applyStep(sim: Simulation, s: ScriptStep): void {
  if (s.action) sim.apply(s.action);
}
