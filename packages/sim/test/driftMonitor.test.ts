import { describe, expect, it } from 'vitest';
import { inputsFor } from '../src/config.ts';
import type { Forecast } from '../src/contracts.ts';
import { DriftMonitor, type DriftParams } from '../src/modules/driftMonitor.ts';

const inputs = inputsFor(3);
const forecast: Forecast = { id: 'F1', cause: 'schedule', issuedAt: 0, validUntil: 180, inputs: ['temp', 'sal', 'snd'], values: { temp: 12, sal: 35, snd: 1500 }, digest: 'x' };
const params: DriftParams = { threshold: 3, quorum: 2, persistence: 2 };

function monitor(obs: Record<string, number>, f: Forecast | null = forecast) {
  return new DriftMonitor(inputs, { latestObservations: () => obs, currentForecast: () => f ?? undefined });
}

describe('drift monitor', () => {
  it('DRF-1 computes residuals in σ', () => {
    const r = monitor({ temp: 13, sal: 34.8, snd: 1500 }).check({ params, streak: 0, runQueued: false });
    expect(r.residuals.temp).toBeCloseTo(2);
    expect(r.residuals.sal).toBeCloseTo(-1);
  });

  it('DRF-4 status: no forecast yet', () => {
    expect(monitor({}, null).check({ params, streak: 0, runQueued: false }).status).toBe('no forecast yet');
  });

  it('DRF-4 status: nothing out of range / below quorum', () => {
    expect(monitor({ temp: 12, sal: 35, snd: 1500 }).check({ params, streak: 0, runQueued: false }).status).toBe('nothing out of range');
    expect(monitor({ temp: 14, sal: 35, snd: 1500 }).check({ params, streak: 0, runQueued: false }).status).toBe('below quorum (1 of 2)');
  });

  it('DRF-2 declares drift after quorum is met for persistence consecutive checks', () => {
    const m = monitor({ temp: 14, sal: 36, snd: 1500 }); // +4σ, +5σ
    const a = m.check({ params, streak: 0, runQueued: false });
    expect(a).toMatchObject({ requestRun: false, streak: 1, status: 'quorum met, persistence 1 of 2' });
    const b = m.check({ params, streak: a.streak, runQueued: false });
    expect(b).toMatchObject({ requestRun: true, streak: 0, status: 'drift declared' });
  });

  it('DRF-2 negative residuals count too (±threshold)', () => {
    const r = monitor({ temp: 10, sal: 34, snd: 1500 }).check({ params: { ...params, persistence: 1 }, streak: 0, runQueued: false });
    expect(r.requestRun).toBe(true);
  });

  it('DRF-5 while a run is queued, persistent drift does not raise a new request', () => {
    const r = monitor({ temp: 14, sal: 36, snd: 1500 }).check({ params, streak: 1, runQueued: true });
    expect(r).toMatchObject({ requestRun: false, status: 'drift persists, run already queued' });
  });

  it('a check below quorum resets the persistence streak', () => {
    const r = monitor({ temp: 14, sal: 35, snd: 1500 }).check({ params, streak: 1, runQueued: false });
    expect(r.streak).toBe(0);
  });
});
