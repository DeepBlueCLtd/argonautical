import { describe, expect, it } from 'vitest';
import { inputsFor } from '../src/config.ts';
import type { Forecast } from '../src/contracts.ts';
import { DriftMonitor, type DriftParams } from '../src/modules/driftMonitor.ts';

const inputs = inputsFor(3);
const forecast: Forecast = { id: 'F1', cause: 'schedule', issuedAt: 0, validUntil: 180, inputs: ['temp', 'sal', 'snd'], values: { temp: 12, sal: 35, snd: 1500 }, digest: 'x', horizon: 12 };
const params: DriftParams = { threshold: 3, quorum: 2, persistence: 2 };

function monitor(obs: Record<string, number | number[]>, f: Forecast | null = forecast) {
  const recent = Object.fromEntries(Object.entries(obs).map(([k, v]) => [k, Array.isArray(v) ? v : [v]]));
  return new DriftMonitor(inputs, { recentObservations: () => recent, currentForecast: () => f ?? undefined });
}

describe('drift monitor', () => {
  it('DRF-1 averages the readings since the last check before comparing with the forecast', () => {
    // temp (σ 0.5) readings alternate 12.5 / 13.5: the latest alone would say +3σ; their mean (13.0) says +2σ.
    const r = monitor({ temp: [12.5, 13.5, 12.5, 13.5, 12.5, 13.5, 12.5, 13.5, 12.5, 13.5], sal: 35, snd: 1500 }).check({ params, streak: 0 });
    expect(r.residuals.temp).toBeCloseTo(2);
  });

  it('DRF-1 computes residuals in σ', () => {
    const r = monitor({ temp: 13, sal: 34.8, snd: 1500 }).check({ params, streak: 0 });
    expect(r.residuals.temp).toBeCloseTo(2);
    expect(r.residuals.sal).toBeCloseTo(-1);
  });

  it('DRF-4 status: no forecast yet', () => {
    expect(monitor({}, null).check({ params, streak: 0 }).status).toBe('no forecast yet');
  });

  it('DRF-4 status: nothing out of range / below quorum', () => {
    expect(monitor({ temp: 12, sal: 35, snd: 1500 }).check({ params, streak: 0 }).status).toBe('nothing out of range');
    expect(monitor({ temp: 14, sal: 35, snd: 1500 }).check({ params, streak: 0 }).status).toBe('below quorum (1 of 2)');
  });

  it('DRF-2 declares drift after quorum is met for persistence consecutive checks', () => {
    const m = monitor({ temp: 14, sal: 36, snd: 1500 }); // +4σ, +5σ
    const a = m.check({ params, streak: 0 });
    expect(a).toMatchObject({ requestRun: false, streak: 1, status: 'quorum met, persistence 1 of 2' });
    const b = m.check({ params, streak: a.streak });
    expect(b).toMatchObject({ requestRun: true, streak: 0, status: 'drift declared' });
  });

  it('DRF-2 negative residuals count too (±threshold)', () => {
    const r = monitor({ temp: 10, sal: 34, snd: 1500 }).check({ params: { ...params, persistence: 1 }, streak: 0 });
    expect(r.requestRun).toBe(true);
  });

  it('DRF-5 while a drift run is queued or running, persistent drift does not raise a new request', () => {
    const m = monitor({ temp: 14, sal: 36, snd: 1500 });
    expect(m.check({ params, streak: 1, driftRun: 'queued' })).toMatchObject({ requestRun: false, status: 'drift persists, drift run already queued' });
    expect(m.check({ params, streak: 1, driftRun: 'running' })).toMatchObject({ requestRun: false, status: 'drift persists, drift run in progress' });
  });

  it('a check below quorum resets the persistence streak', () => {
    const r = monitor({ temp: 14, sal: 35, snd: 1500 }).check({ params, streak: 1 });
    expect(r.streak).toBe(0);
  });
});
