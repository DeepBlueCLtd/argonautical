/** Feature detector (ours, inside features): DET-1, DET-2. */
import type { InputSpec } from '../config.ts';
import { NUMERICS, TIMING } from '../config.ts';
import type { DetectorReader, Feature, FeatureWriter, Job } from '../contracts.ts';

export class FeatureDetector {
  constructor(
    private readonly inputs: readonly InputSpec[],
    private readonly reader: DetectorReader,
    private readonly writer: FeatureWriter,
  ) {}

  /** Pure detection, exposed for tests. */
  detect(forecastId: string): Feature[] {
    const f = this.reader.forecast(forecastId);
    if (!f) throw new Error(`forecast ${forecastId} not found`);
    const clim = this.reader.climatology();
    const out: Feature[] = [];
    this.inputs.forEach((spec, i) => {
      const v = f.values[spec.key];
      const c = clim[spec.key] ?? spec.base;
      if (v !== undefined && Math.abs(v - c) / spec.sigma > NUMERICS.frontSigma) {
        out.push({ id: `${f.id}-front-${spec.key}`, forecastId: f.id, kind: 'front', input: spec.key, x: (i + 0.5) / this.inputs.length, y: 0.5 });
      }
    });
    const d = f.digest;
    const eddies = (parseInt(d.slice(0, 2), 16) % 3) + 1;
    for (let k = 0; k < eddies; k++) {
      const x = parseInt(d.slice(2 + k * 4, 4 + k * 4), 16) / 255;
      const y = parseInt(d.slice(4 + k * 4, 6 + k * 4), 16) / 255;
      out.push({ id: `${f.id}-eddy-${k + 1}`, forecastId: f.id, kind: 'eddy', x, y });
    }
    return out;
  }

  /** Read and detect now; write all features atomically when the job completes. */
  start(forecastId: string): Job<readonly Feature[]> {
    const writer = this.writer;
    const features = this.detect(forecastId);
    return {
      duration: TIMING.detectDuration,
      label: `detecting in ${forecastId}`,
      progress() {},
      complete() {
        writer.writeAll(forecastId, features);
        return features;
      },
    };
  }
}
