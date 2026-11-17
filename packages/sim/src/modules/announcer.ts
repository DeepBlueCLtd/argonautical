/**
 * Announcer (ours, inside the announcement asset): builds the ORC-5 message and publishes it.
 * The whole run is announced once on `forecast/new`; when features were detected, `features/new`
 * says they are ready too; and each measurement is announced on its own topic, `forecast/<key>`, so a
 * consumer can subscribe to just the measurements it uses (CAT-4). Only the announcer knows the run is complete.
 */
import { measurementTopic, parameterDigest, type Announcement, type AnnouncementPublisher, type Forecast } from '../contracts.ts';

export interface AnnounceInput {
  readonly forecast: Forecast;
  /** Undefined when no feature detector ran. */
  readonly featureCount?: number;
}

export class Announcer {
  constructor(private readonly publisher: AnnouncementPublisher) {}

  announce({ forecast: f, featureCount }: AnnounceInput): Announcement {
    const msg: Announcement = { forecastId: f.id, validUntil: f.validUntil, cause: f.cause, digest: f.digest, windows: f.windows, ...(featureCount !== undefined ? { featureCount } : {}) };
    this.publisher.publish({ topic: 'forecast/new', body: msg });
    for (const key of f.inputs) {
      this.publisher.publish({ topic: measurementTopic(key), body: { forecastId: f.id, parameter: key, validUntil: f.validUntil, windows: f.windows, digest: parameterDigest(f, key) } });
    }
    if (featureCount !== undefined) this.publisher.publish({ topic: 'features/new', body: { forecastId: f.id, featureCount } });
    return msg;
  }
}
