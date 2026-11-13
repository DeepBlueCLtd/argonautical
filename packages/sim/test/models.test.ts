import { describe, expect, it } from 'vitest';
import { NUMERICS, inputsFor } from '../src/config.ts';
import { forecastDigest, type Forecast } from '../src/contracts.ts';
import { FeatureDetector } from '../src/modules/featureDetector.ts';
import { ModelRunner } from '../src/modules/modelRunner.ts';

const inputs = inputsFor(3);
const clim = { temp: 12, sal: 35, snd: 1500 };

function runner(background?: Forecast, obs: Record<string, number[]> = {}) {
  const committed: Forecast[] = [];
  const r = new ModelRunner(inputs, { climatology: () => clim, latestForecast: () => background, recentObservations: () => obs }, { commit: (f) => committed.push(f) });
  return { r, committed };
}

describe('model runner', () => {
  it('MOD-1 stages, then commits atomically only on completion, with id, cause, valid-until and digest', () => {
    const { r, committed } = runner(undefined, { temp: [13, 13], sal: [35], snd: [1500] });
    const job = r.start({ id: 'F1', cause: 'manual', tick: 10 });
    expect(job.readDuration).toBe(6);
    expect(job.duration).toBe(8);
    expect(committed).toHaveLength(0);
    const f = job.complete();
    expect(committed).toEqual([f]);
    expect(f).toMatchObject({ id: 'F1', cause: 'manual', issuedAt: 24, validUntil: 204 });
    expect(f.digest).toBe(forecastDigest(f));
  });

  it('moves the background 60% of the way towards the mean of recent observations', () => {
    const bg: Forecast = { id: 'F1', cause: 's', issuedAt: 0, validUntil: 180, inputs: ['temp', 'sal', 'snd'], values: { temp: 12, sal: 35, snd: 1500 }, digest: '' };
    const { r } = runner(bg, { temp: [13, 15], sal: [], snd: [1500] });
    const f = r.start({ id: 'F2', cause: 'drift', tick: 0 }).complete();
    expect(f.values.temp).toBeCloseTo(12 + NUMERICS.nudge * (14 - 12));
    // no observations: falls back to climatology
    expect(f.values.sal).toBeCloseTo(35);
  });

  it('falls back to climatology when there is no background', () => {
    const { r } = runner(undefined, { temp: [14] });
    expect(r.start({ id: 'F1', cause: 's', tick: 0 }).complete().values.temp).toBeCloseTo(12 + 0.6 * 2);
  });

  it('labels the execution bar with what it replaces', () => {
    const bg: Forecast = { id: 'F2', cause: 's', issuedAt: 0, validUntil: 100, inputs: [], values: {}, digest: '' };
    expect(runner(undefined).r.start({ id: 'F1', cause: 's', tick: 0 }).label).toBe('first forecast');
    expect(runner(bg).r.start({ id: 'F3', cause: 's', tick: 50 }).label).toBe('replacing F2');
    expect(runner(bg).r.start({ id: 'F3', cause: 's', tick: 100 }).label).toBe('replacing stale F2');
  });
});

describe('feature detector', () => {
  const values = { temp: 12 + 0.8 * 0.5, sal: 35 + 0.7 * 0.2, snd: 1500 - 2 * 3 };
  const base = { id: 'F7', validUntil: 200, inputs: ['temp', 'sal', 'snd'], values };
  const f: Forecast = { ...base, cause: 's', issuedAt: 0, digest: forecastDigest(base) };

  it('DET-1 reports a front for each input more than 0.75σ from climatology, and 1–3 eddies from the digest', () => {
    const d = new FeatureDetector(inputs, { forecast: () => f, climatology: () => clim }, { writeAll: () => {} });
    const feats = d.detect('F7');
    expect(feats.filter((x) => x.kind === 'front').map((x) => x.input)).toEqual(['temp', 'snd']);
    const eddies = feats.filter((x) => x.kind === 'eddy').length;
    expect(eddies).toBe((parseInt(f.digest.slice(0, 2), 16) % 3) + 1);
  });

  it('DET-2 tags every feature with its forecast id; writes all at completion after 5 s', () => {
    const written: unknown[] = [];
    const d = new FeatureDetector(inputs, { forecast: () => f, climatology: () => clim }, { writeAll: (_id, x) => written.push(...x) });
    const job = d.start('F7');
    expect(job.duration).toBe(5);
    expect(written).toHaveLength(0);
    const feats = job.complete();
    expect(feats.every((x) => x.forecastId === 'F7')).toBe(true);
    expect(written).toHaveLength(feats.length);
  });
});
