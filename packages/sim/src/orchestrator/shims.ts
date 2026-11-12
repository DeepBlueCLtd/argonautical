/**
 * Shims (ARC-2): one-line pass-throughs, one per crossing. They hold no logic.
 * The orchestrator reaches our modules only through these (ORC-6).
 */
import type { Announcement } from '../contracts.ts';
import type { DriftCheckInput, DriftMonitor } from '../modules/driftMonitor.ts';
import type { FeatureDetector } from '../modules/featureDetector.ts';
import type { ModelRunner, RunRequest } from '../modules/modelRunner.ts';
import type { Broker } from '../platform/broker.ts';

export const check = (m: Pick<DriftMonitor, 'check'>, input: DriftCheckInput) => m.check(input);
export const run = (m: Pick<ModelRunner, 'start'>, req: RunRequest) => m.start(req);
export const detect = (m: Pick<FeatureDetector, 'start'>, forecastId: string) => m.start(forecastId);
export const announce = (b: Pick<Broker, 'publish'>, msg: Announcement) => b.publish('shimAnnounce', msg);
