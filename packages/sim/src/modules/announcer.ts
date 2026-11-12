/** Announcer (ours, inside the announcement asset): builds the ORC-5 message and publishes it. */
import type { Announcement, AnnouncementPublisher, Forecast } from '../contracts.ts';

export interface AnnounceInput {
  readonly forecast: Forecast;
  readonly featureCount: number;
}

export class Announcer {
  constructor(private readonly publisher: AnnouncementPublisher) {}

  announce({ forecast: f, featureCount }: AnnounceInput): Announcement {
    const msg: Announcement = { forecastId: f.id, validUntil: f.validUntil, cause: f.cause, digest: f.digest, featureCount };
    this.publisher.publish(msg);
    return msg;
  }
}
