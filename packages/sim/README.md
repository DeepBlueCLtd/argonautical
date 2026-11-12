# @argonautical/sim

The pure, deterministic simulation behind the Forecast Pipeline Demonstrator (`srd.md`). It has no UI imports (SIM-4): `tsconfig.json` compiles `src/` with no DOM and no Node types. It runs headless at any speed.

```ts
import { Simulation } from '@argonautical/sim';

const sim = new Simulation({ seed: 'demo', inputs: 4 });
sim.setShift('temp', true);  // scenario
sim.requestRun();            // operator
sim.step(60);                // advance 60 ticks (1 tick = 1 simulated second)
sim.snapshot();              // read-only state for the UI (ARC-4)
sim.digest;                  // event-log digest (SIM-5)
```

## Layout

| Path | What it is | SRD |
|---|---|---|
| `src/world/` | Ocean and sensors: not our system. | §2 |
| `src/modules/` | **Our modules**: ingestion, drift monitor, model runner, feature detector. They see only data contracts and read/write ports. | §3.2–3.4 |
| `src/stores/` | Our stores: Observations DB, NetCDF store, Features DB. | §2 |
| `src/platform/` | Off-the-shelf mocks: pygeoapi (the only read path) and the broker. | §2 |
| `src/orchestrator/` | Off-the-shelf mock: asset graph, triggers, run queue with merge, retry with backoff, private store. `shims.ts` holds the one-line shims. | §3.5, ARC-2, ORC-6 |
| `src/consumers/` | Onboard consumers. | §3.6 |
| `src/faults.ts` | Presenter fault injection (offline, fail next run, ~3 % random failures). It wraps modules; it is not part of them. | FLT-1, FLT-2 |
| `src/topology/elements.ts` | Declared elements and relations; edges are derived. | ARC-3 |
| `src/topology/deployment.ts` | Candidate production deployment for the system view. | ARC-7 |
| `src/tokens.ts` | Token records per interaction; undeclared edges are logged as defects. | SIM-6 |
| `src/scenario.ts`, `scenarios/*.json` | Replay scripts. The same files are tour scripts (captions). | ARC-5, TOUR-2 |

## Checks

```bash
npm run typecheck   # src (no DOM/Node types) and tests
npm run boundary    # ARC-1: our modules import nothing from orchestrator, shims or deployment
npm test            # unit, acceptance (§6) and golden replay tests
```

After an intended behaviour change, regenerate the golden digests and review the diff in `test/golden.json`:

```bash
npm run golden:update
```

## Design notes

- **Determinism (ARC-5).** All randomness comes from named, seeded streams (`ocean`, `sensor:<input>`, `failures`, `consumers`). Gaussian noise uses a sum of uniforms, not Box–Muller, so no `Math.log`/`Math.cos` is involved, and browser and Node runs produce the same digests.
- **Tick order.** Ocean → sensors → ingestion → orchestrator (advance the active run, drift check every 4 s, staleness, start a queued run) → consumers. A commit therefore lands before the drift check in the same second.
- **Failures are exceptions.** The fault layer throws `ModuleFailure` from a module call. The orchestrator catches only that type and retries. Any other exception is a bug and propagates.
- **Shims.** `check`, `run`, `detect` and `announce` are each one line. `announce` calls the broker, not one of our modules; see the SRD note in the PR.
