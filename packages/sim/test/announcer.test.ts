import { describe, expect, it } from 'vitest';
import type { BrokerMessage, Forecast } from '../src/contracts.ts';
import { Announcer } from '../src/modules/announcer.ts';

describe('announcer', () => {
  const f: Forecast = { id: 'F3', cause: 'drift + manual', issuedAt: 10, validUntil: 190, inputs: [], values: {}, digest: 'abc', horizon: 12 };

  it('ORC-5 builds {forecastId, validUntil, cause, digest, horizon, featureCount}; publishes forecast/new, then features/new', () => {
    const sent: BrokerMessage[] = [];
    const msg = new Announcer({ publish: (m) => sent.push(m) }).announce({ forecast: f, featureCount: 4 });
    expect(msg).toEqual({ forecastId: 'F3', validUntil: 190, cause: 'drift + manual', digest: 'abc', horizon: 12, featureCount: 4 });
    expect(sent).toEqual([
      { topic: 'forecast/new', body: msg },
      { topic: 'features/new', body: { forecastId: 'F3', featureCount: 4 } },
    ]);
  });

  it('CAT-2: with no feature detector, only forecast/new, with no feature count', () => {
    const sent: BrokerMessage[] = [];
    const msg = new Announcer({ publish: (m) => sent.push(m) }).announce({ forecast: { ...f, horizon: 48 } });
    expect(msg).toEqual({ forecastId: 'F3', validUntil: 190, cause: 'drift + manual', digest: 'abc', horizon: 48 });
    expect(sent).toEqual([{ topic: 'forecast/new', body: msg }]);
  });
});
