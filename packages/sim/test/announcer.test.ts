import { describe, expect, it } from 'vitest';
import type { Announcement, Forecast } from '../src/contracts.ts';
import { Announcer } from '../src/modules/announcer.ts';

describe('announcer', () => {
  it('ORC-5 builds {forecastId, validUntil, cause, digest, featureCount} and publishes it', () => {
    const sent: Announcement[] = [];
    const f: Forecast = { id: 'F3', cause: 'drift + manual', issuedAt: 10, validUntil: 190, inputs: [], values: {}, digest: 'abc' };
    const msg = new Announcer({ publish: (m) => sent.push(m) }).announce({ forecast: f, featureCount: 4 });
    expect(msg).toEqual({ forecastId: 'F3', validUntil: 190, cause: 'drift + manual', digest: 'abc', featureCount: 4 });
    expect(sent).toEqual([msg]);
  });
});
