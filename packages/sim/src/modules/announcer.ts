/**
 * Announcer (ours, inside the announcement asset): builds the ORC-5 message and publishes it.
 * The whole run is announced once on `forecast/new`; when features were detected, `features/new`
 * says they are ready too (CAT-4). Only the announcer knows the run is complete.
 */
import type { Announcement, AnnouncementPublisher, Forecast } from '../contracts.ts';

export interface AnnounceInput {
  readonly forecast: Forecast;
  /** Undefined when no feature detector ran. */
  readonly featureCount?: number;
}

export class Announcer {
  constructor(private readonly publisher: AnnouncementPublisher) {}

  announce({ forecast: f, featureCount }: AnnounceInput): Announcement {
    const msg: Announcement = { forecastId: f.id, validUntil: f.validUntil, cause: f.cause, digest: f.digest, horizon: f.horizon, ...(featureCount !== undefined ? { featureCount } : {}) };
    this.publisher.publish({ topic: 'forecast/new', body: msg });
    if (featureCount !== undefined) this.publisher.publish({ topic: 'features/new', body: { forecastId: f.id, featureCount } });
    return msg;
  }
}
