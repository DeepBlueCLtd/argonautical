/**
 * Presenter fault injection (FLT-1, FLT-2). Part of the simulation harness,
 * not of our modules or the orchestrator: it wraps a module so that calls fail.
 */
import { NUMERICS } from './config.ts';
import type { Feature, Forecast, Job } from './contracts.ts';
import type { DriftCheckInput, DriftCheckResult, DriftMonitor } from './modules/driftMonitor.ts';
import type { FeatureDetector } from './modules/featureDetector.ts';
import type { ModelRunner, RunRequest } from './modules/modelRunner.ts';
import type { Stream } from './rng.ts';

export type FaultTarget = 'modelRunner' | 'featureDetector' | 'driftMonitor';

export class ModuleFailure extends Error {
  constructor(
    readonly target: FaultTarget,
    readonly reason: 'offline' | 'injected failure' | 'random failure',
  ) {
    super(`${target}: ${reason}`);
  }
}

export class Faults {
  readonly offline: Record<FaultTarget, boolean> = { modelRunner: false, featureDetector: false, driftMonitor: false };
  failNextRun = false;
  constructor(private readonly rng: Stream) {}

  /** Decide, at the start of an attempt, whether it will fail at completion. Always draws, so the stream stays aligned. */
  drawFailure(target: FaultTarget): ModuleFailure['reason'] | undefined {
    const random = this.rng.chance(NUMERICS.randomFailureRate);
    if (target === 'modelRunner' && this.failNextRun) {
      this.failNextRun = false;
      return 'injected failure';
    }
    return random ? 'random failure' : undefined;
  }

  private guard(target: FaultTarget): void {
    if (this.offline[target]) throw new ModuleFailure(target, 'offline');
  }

  wrapJob<R>(target: FaultTarget, start: () => Job<R>): Job<R> {
    this.guard(target);
    const fails = this.drawFailure(target);
    const job = start();
    return {
      readDuration: job.readDuration,
      duration: job.duration,
      label: job.label,
      progress: () => {
        this.guard(target);
        job.progress();
      },
      complete: () => {
        this.guard(target);
        if (fails) throw new ModuleFailure(target, fails);
        return job.complete();
      },
    };
  }

  runner(inner: ModelRunner): Pick<ModelRunner, 'start'> {
    return { start: (req: RunRequest): Job<Forecast> => this.wrapJob('modelRunner', () => inner.start(req)) };
  }

  /** The drift monitor has no long job: while offline, each check fails. */
  monitor(inner: DriftMonitor): Pick<DriftMonitor, 'check'> {
    return {
      check: (input: DriftCheckInput): DriftCheckResult => {
        this.guard('driftMonitor');
        return inner.check(input);
      },
    };
  }

  detector(inner: FeatureDetector): Pick<FeatureDetector, 'start'> {
    return { start: (id: string): Job<readonly Feature[]> => this.wrapJob('featureDetector', () => inner.start(id)) };
  }
}
