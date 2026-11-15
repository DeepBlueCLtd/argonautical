/**
 * Shims (ARC-2): one-line pass-throughs, one per crossing. They hold no logic.
 * The orchestrator reaches our modules only through these (ORC-6).
 */
import type { AnnounceInput, Announcer } from '../modules/announcer.ts';
import type { ClimatologyImporter } from '../modules/climatologyImporter.ts';
import type { DriftCheckInput, DriftMonitor } from '../modules/driftMonitor.ts';
import type { ShoreExporter } from '../modules/shoreExporter.ts';
import type { FeatureDetector } from '../modules/featureDetector.ts';
import type { ModelRunner, RunRequest } from '../modules/modelRunner.ts';

export const check = (m: Pick<DriftMonitor, 'check'>, input: DriftCheckInput) => m.check(input);
export const run = (m: Pick<ModelRunner, 'start'>, req: RunRequest) => m.start(req);
export const detect = (m: Pick<FeatureDetector, 'start'>, forecastId: string) => m.start(forecastId);
export const announce = (m: Pick<Announcer, 'announce'>, input: AnnounceInput) => m.announce(input);
export const importClimatology = (m: Pick<ClimatologyImporter, 'import'>) => m.import();
export const exportForShore = (m: Pick<ShoreExporter, 'export'>, tick: number) => m.export(tick);
