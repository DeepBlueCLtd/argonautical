import { describe, expect, it } from 'vitest';
import { FUTURE_WINDOWS, NOWCAST, furthestWindow, windowLabel, windowsFor, windowsLabel } from '../src/contracts.ts';
import { plannerReach } from '../src/consumers/consumer.ts';

/** CAT-1: the now-cast by default; future forecasts add 12, 24 and 48 h windows. */
describe('forecast windows', () => {
  it('follow the future-forecasts capability', () => {
    expect(windowsFor(false)).toEqual([0]);
    expect(windowsFor(true)).toEqual([0, 12, 24, 48]);
  });

  it('are labelled the same way everywhere', () => {
    expect(windowsLabel(NOWCAST)).toBe('now-cast');
    expect(windowsLabel(FUTURE_WINDOWS)).toBe('now-cast + 12/24/48 h');
    expect(windowLabel(0)).toBe('now-cast');
    expect(windowLabel(24)).toBe('24 h');
  });

  it('give the passage planner its reach: NOW-CAST, or the furthest window', () => {
    expect(furthestWindow(NOWCAST)).toBe(0);
    expect(plannerReach(NOWCAST)).toBe('NOW-CAST');
    expect(plannerReach(FUTURE_WINDOWS)).toBe('48 h');
  });
});
