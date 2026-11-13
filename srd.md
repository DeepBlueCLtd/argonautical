# Forecast Pipeline Demonstrator — Software Requirements Document (v2)

Supersedes the SRD of Oct 3, 2026 (@Ian Mayo). Written for a fresh implementation in a GitHub repository, drawing on what was learned building the browser prototype (`Forecast Pipeline Demonstrator.dc.html` + `sim/`).

---

## 1. Purpose

The demonstrator is a browser simulation of an onboard ocean-forecast pipeline. It exists to explain, to people who will not read the code, three things:

1. **The pipeline is asset-driven.** An orchestrator (Dagster-style) keeps a graph of data assets — observations, climatology, background, forecast, features, announcement — and materialises them when something triggers it: detected drift, a stale forecast, or an operator request.
2. **Our software is separate from the off-the-shelf parts.** Our modules (ingestion, drift monitor, model runner, feature detector, announcer) are run by the orchestrator but import nothing from it. They are reached only through thin shims, so the orchestrator could be replaced.
3. **The system is robust.** Failures are retried with backoff, one run happens at a time, consumers verify what they receive, and late joiners catch up.

### Audience

- Programme stakeholders and reviewers watching a presenter drive the demo live.
- Engineers who want a concrete picture of the module boundary before building the real system.

### Aspirations

- **See the whole system at once.** Data visibly moves from the sea, through ingestion, the asset graph and the stores, out to consumers, on one screen with no scrolling.
- **The logic is the layout.** Someone looking at the screen should be able to read the asset graph, what triggers it and which code runs where, without narration.
- **Nothing moves unless something happened.** Every moving token corresponds to a real call, write, read or message in the simulation. A paused clock stops everything.
- **Honest.** The data is synthetic and the numerics are illustrative. The engines are mocks; this runs no Dagster, Postgres or pygeoapi. The screen says so.
- **Repeatable.** The same seed and the same sequence of control actions always produce the same event log, so a demo can be rehearsed and a defect reproduced.

### Non-goals

- Real oceanography, real data assimilation or realistic numerics.
- Running or wrapping real Dagster, pygeoapi, Postgres/PostGIS, NetCDF or a broker.
- A backend, accounts or persistence beyond the browser.

---

## 2. System model

The screen and the simulation share one model, in three regions separated by two boundary lines:

**World** (not our system)
- **Ocean**: the real environment. Each input has a true value that drifts slowly, and a scenario shift moves it the way a passing front would.
- **Sensors**: onboard instruments. Each input has its own noise stream and noise level. The DAQ gateway publishes each reading to the sensor broker as a SensorThings Observation message (SensorThings MQTT topic, one Datastream per input).

**System**
- **Sensor broker** (off-the-shelf, mocked): a persistent queue between the DAQ gateway and ingestion. Ingestion holds a persistent session (QoS 1) and acknowledges messages only after the database commit, so an ingestion or database restart loses nothing.
- **Ingestion** (ours, not orchestrated): consumes the sensor broker in order, validates every observation (keeping its measurement time) and is the only writer to the Observations DB. It runs continuously, not when the orchestrator calls it. After an outage it drains the backlog faster than new messages arrive.
- **Orchestrator** (off-the-shelf, mocked): the asset graph and its triggers.
  - Assets: `observations`, `climatology`, `background` (the previous forecast), `forecast`, `features`, `announcement`. `observations` is a source asset: a declaration pointing at the Observations DB, not a separate thing, so it is drawn as the Observations DB itself (UI-8). `background` is drawn as a loop on `forecast` (UI-10).
  - Lineage: observations + climatology + background → forecast → features → announcement; forecast → announcement.
  - Triggers: the drift sensor (every 10 s), the staleness schedule (a forecast older than 180 s) and manual requests.
  - Run policy: one run at a time. A request arriving during a run queues; later requests merge into the queued one. Failed steps are retried until they succeed, with backoff.
  - Its own private store (run history, schedule, sensor state). This is modelled and drawn small, inside the orchestrator (UI-9).
- **Shims** (thin wrappers, one per crossing): check, run, detect and announce. Each one calls a single module of ours and holds no logic.
- **Our modules**, each embedded in the asset or sensor it computes:
  - **Drift monitor** (inside the drift sensor): scores the latest observations against the current forecast.
  - **Model runner** (inside forecast): moves the background 60% of the way towards recent observations, falling back to climatology. It stages the result, then commits it atomically with a digest.
  - **Feature detector** (inside features): finds fronts and eddies in the new forecast.
  - **Announcer** (inside announcement): builds the announcement (ORC-5) and publishes it to the broker. The message contract is ours.
- **Stores** (ours): the Observations DB (time series in the SensorThings data model: one Thing, the ship; a Datastream per input; Observations with `phenomenonTime` and `result`. Ingestion writes Observation entities over SQL and pygeoapi serves them as SensorThings), the NetCDF store (coverage files: climatology and forecasts) and the Features DB (PostGIS).
- **pygeoapi** (off-the-shelf, mocked, read-only): SensorThings, EDR and Features. It is the only read path, both for our modules and for consumers.
- **Broker** (off-the-shelf, mocked): sits on the System–Consumers boundary and delivers only to subscribers.

**Onboard consumers**
- Subscribe to the broker. On an announcement, they query pygeoapi for the forecast and its features and verify the digest and the feature count.
- A consumer added mid-run queries pygeoapi straight away, without waiting for the next announcement.
- When a consumer app's user reconfigures it, the app queries pygeoapi again (no new data is implied).

---

## 3. Functional requirements

### 3.1 Simulation core

| ID | Requirement |
|---|---|
| SIM-1 | The simulation runs on a discrete tick clock (1 tick = 1 simulated second), shown as `T+mm:ss`. |
| SIM-2 | All randomness comes from seeded, named streams (ocean, one per sensor, failures, consumers). No `Math.random`. |
| SIM-3 | The number of inputs is configurable from 3 to 6: temperature, salinity, sound speed, current, dissolved O₂, turbidity. Each has a base value, a σ and a unit. |
| SIM-4 | The simulation is a pure library with no UI imports. It can run headless (in tests or Node) at any speed. |
| SIM-5 | Every significant action appends to an event log of `{tick, kind, text}`. A digest of the log is exposed for replay comparison. |
| SIM-6 | Each interaction on a declared edge (call, write, read, publish, lineage, trigger) emits a token record `{edge, start, duration, retry?}`. Emitting on an undeclared edge is recorded as a defect. |

### 3.2 Ingestion

| ID | Requirement |
|---|---|
| ING-1 | Reject values that are not finite numbers. |
| ING-2 | Reject values outside ±10σ of climatology. |
| ING-3 | Reject a value that jumps more than 4σ from that input's last accepted value. |
| ING-4 | Log each rejection with its value and reason. Count accepted and rejected readings. |

### 3.3 Drift monitor

| ID | Requirement |
|---|---|
| DRF-1 | On each sensor tick, compute each input's residual (latest observation − forecast) in σ. |
| DRF-2 | Declare drift when at least *quorum* inputs exceed ±*threshold*σ for *persistence* consecutive checks. |
| DRF-3 | Operator-tunable, within declared bounds: threshold 1–6σ (step 0.5), quorum 1–N inputs, persistence 1–5 checks. The value actually in force is always displayed. |
| DRF-4 | Report a status line: no forecast yet / nothing out of range / below quorum / quorum met, persistence k of n / drift declared / drift persists, drift run already queued / drift persists, drift run in progress. |
| DRF-5 | While a run that includes drift among its causes is queued or running, persistent drift does not raise a new request. Drift can still queue behind a manual or scheduled run, so `drift + manual` merges remain possible. |

### 3.4 Model runner and feature detector

| ID | Requirement |
|---|---|
| MOD-1 | A model run takes 8 s, counted from when its inputs (climatology, background, observations) have arrived; its call and reads through pygeoapi take 7 s, so a run completes 15 s after it starts. Until its inputs have arrived, both in the simulation and on screen, the model runner says "retrieving data"; only then does it show what it is doing ("replacing F1") and start its progress bar. The feature detector does the same. It stages a forecast, then commits it atomically with an id (`F1`, `F2`, …), cause, values, valid-until and digest. A failed run commits nothing. |
| MOD-2 | When a forecast is committed, the previous one becomes the background. |
| DET-1 | Detection takes 5 s, counted from when its inputs (forecast, climatology) have arrived; its call and reads take 7 s. A front is reported for each input more than 0.75σ from climatology; 1–3 eddies are reported, derived from the digest. |
| DET-2 | Features are tagged with their forecast id, so consumers can verify the feature count. |
| FLT-1 | The presenter can take the model runner, the feature detector or the drift monitor **offline**. While a module is offline, every call to it fails: runs retry with backoff; drift checks fail and request nothing. The control is a play/pause button inline before the title of the component that hosts it (forecast, features, drift sensor). |
| FLT-2 | A scenario script can make the next run fail once (no on-screen control). In addition, a seeded random failure rate of about 3% applies. |
| FLT-3 | The presenter can **stop and start ingestion** and **stop and start the Observations DB**. While either is stopped, messages queue in the sensor broker, and its queued count is shown. While the DB is stopped, reads of observations fail: model runs retry with backoff and the drift monitor reports observations unavailable. On restart the backlog drains in order, with nothing lost. |

### 3.5 Orchestrator

| ID | Requirement |
|---|---|
| ORC-1 | Drift sensor every 10 s. Staleness schedule at 180 s. Both are declared configuration that is shown on screen, not operator-tunable. The 10 s interval is demo time-compression: production keeps the Dagster sensor at ≥30 s. |
| ORC-2 | One run at a time; queue, then merge. Log the causes of merged requests (e.g. `drift + manual`). |
| ORC-3 | Retry failed steps (run or detect) until they succeed, with exponential backoff of 2, 4, 8 s, then 10 s thereafter. |
| ORC-4 | Each run progresses through run → detect → announce. Each asset records when it was materialised. |
| ORC-5 | An announcement carries `{forecastId, validUntil, cause, digest, featureCount}`. |
| ORC-6 | The orchestrator reaches our modules **only** through the shims. |

### 3.6 Consumers

| ID | Requirement |
|---|---|
| CON-1 | On an announcement, after a short delay, query pygeoapi for what the consumer needs and verify it (✓/✗). Consumers come in two kinds, alternating as they are added: C1, C3… need the forecast coverage (CoverageJSON via EDR) **and** its features (GeoJSON via OGC API-Features), and verify the digest and feature count; C2, C4… need the coverage only and verify the digest. |
| CON-2 | The presenter can add consumers at any time. A new consumer subscribes from that moment and immediately queries for the current forecast. The publisher is unchanged. |
| CON-3 | Each consumer has a Reconfigure button, standing for the consumer app's user changing what it shows. That makes the consumer query pygeoapi again for the latest complete forecast and verify it, without waiting for an announcement. No new data is implied. The result is labelled "reconfigured". |

---

## 4. Architecture requirements

| ID | Requirement |
|---|---|
| ARC-1 | **Module boundary.** Our modules (ingestion, drift monitor, model runner, feature detector, announcer) must not import the orchestrator or the shims. CI enforces this (e.g. an ESLint `no-restricted-imports` rule or a dependency-cruiser rule) and the result is shown on screen. |
| ARC-2 | Shims are one-line pass-throughs, one per crossing. |
| ARC-3 | **Wiring is declared, not drawn.** Each element declares its relations (sends, calls, writes, reads, publishes, subscribes, queries, materialises). Edges are derived from these declarations. Layout supplies geometry only. |
| ARC-4 | Simulation and rendering are separate. The UI reads simulation state each frame and never mutates it, except through the control API. |
| ARC-5 | **Deterministic replay.** A test runs seed + a scripted sequence of control actions headless and asserts the event-log digest. Golden digests are checked in. |
| ARC-6 | The app is a static site that works offline. It deploys to GitHub Pages and can also be built as a single self-contained HTML file. |
| ARC-7 | **Deployment is declared.** Each element declares a placement (node, process); nodes declare a zone; links between nodes are declared. Tests assert that every element is placed and every edge between nodes maps to a declared link. Our modules must not import the deployment model (it joins the ARC-1 restricted list). See `docs/system-architecture.md`. |

Suggested stack (not mandated): TypeScript, Vite, a pure `sim` package with Vitest unit tests, an SVG-based UI in React or Svelte, and Playwright for screenshot and interaction checks.

---

## 5. Presentation requirements

### 5.1 Layout

| ID | Requirement |
|---|---|
| UI-1 | Three labelled regions (World \| System \| Onboard consumers) separated by visible boundary lines, with the broker straddling the right-hand line, above the consumers, so its deliveries and the consumers' pygeoapi queries run along visibly different paths. Up to four consumer cards are drawn; more show as "+N more". |
| UI-2 | **The orchestrator is the dominant element** and is drawn as its asset graph. Assets are the primary visual objects. Lineage is drawn as thin (2 px) lines in a distinct blue-grey, so the larger lineage tokens show each dependency being resolved; heavy lines were tried and hid the tokens. |
| UI-3 | Each of our modules sits **inside** the asset or sensor it computes, with a shim strip above it. Our software is visually distinct from the off-the-shelf parts. Containment replaces arrows from the orchestrator to its shims. |
| UI-4 | Ingestion sits outside the orchestrator and is marked "not orchestrated". |
| UI-5 | The stores and pygeoapi sit below the orchestrator, except the Observations DB (UI-8). Read lines are labelled "read only", and their arrows show the direction the data moves. |
| UI-6 | **The whole diagram fits the viewport with no scrolling** and scales with the window. It must stay legible at 1920×1080. |
| UI-7 | The event log is a popup panel opened from the Control panel, showing the event count, newest first. It is not a permanent column. |
| UI-8 | **The Observations DB is the `observations` source asset; it is drawn once.** It is a store (double border, our data) straddling the orchestrator frame's left edge, as the broker straddles the consumer boundary. Ingestion writes into its outer half; the lineage flow to `forecast` leaves its inner half. It has one name: "Observations DB", with the subtitle "source asset". |
| UI-9 | The orchestrator's private store is drawn as a small off-the-shelf store (dashed border) inside the orchestrator frame, labelled "run history · schedule · sensor state", with its run count read from stored rows. It is internal to the orchestrator, so it has no external edges and no tokens. It must not compete with the asset graph (UI-2) or break UI-6. |
| UI-10 | `background` is drawn as a loop arrow on `forecast`, labelled "background = previous forecast", not as a separate node. When a forecast commits (MOD-2), one lineage token runs round the loop. |

### 5.2 Motion and state cues

| ID | Requirement |
|---|---|
| MOT-1 | Tokens (drawn as small white document icons, lettered with the standard their content follows: S SensorThings, Q SQL, E OGC API – EDR, C CoverageJSON, F OGC API – Features, G GeoJSON, N NetCDF, M MQTT announcement, D Dagster, H HTTP status, lettered by payload, drawn as a white page whose outline and letter take a vivid colour per standard; a token key sits at the foot of the Onboard consumers column, which shows up to five consumer cards) travel along edges only when the simulation records an interaction. Lineage tokens are larger and stay visible for at least about 1.2 s of wall-clock time at any speed. |
| MOT-2 | *(Withdrawn, Nov 13, 2026.)* There is no reduced-motion mode: tokens are always shown, whatever the OS setting. The per-edge counters it used were judged too cluttered. |
| MOT-3 | Countdowns show what triggers things: a ring on the drift sensor (time to the next check), a "stale in m:ss" ring on the staleness schedule (the trigger owns the countdown), while forecast states its expiry as text ("valid until T+03:09", then "stale · replacing" once the scheduled run starts), an execution bar on the model runner ("replacing stale F2"), an execution bar on the feature detector, and a retry countdown on the shim. |
| MOT-4 | **Retry state belongs to the orchestrator, not our code.** The retry countdown appears on the shim strip, which turns amber. A retry sends one amber token from the shim into the module. Lineage tokens are not re-sent on a retry. |
| MOT-5 | While a module is offline it shows an offline state (a red halo) and no progress, and stops "running". |
| MOT-6 | **Drill-down.** Every token record carries what was passed: a one-line summary, the real-world format it stands for in production (e.g. a SensorThings or EDR request and response, an MQTT message, a Dagster RunRequest, a NetCDF commit) and a mock data object filled with the simulation's values. Hovering any token, running or paused, shows the same page-styled panel as the input slots (MOT-7): its summary, the kind of interaction and route, its standard and format; the panel follows the token and goes when it arrives. When the simulation is paused, clicking a frozen token opens a popup with the full mock data. Step leaves the new tick's tokens part-way along their edges so they can be inspected. Payloads never affect the event log or its digest. Every read through pygeoapi is a round trip of four tokens, played in sequence: the **request** (caller → pygeoapi), the provider's **DB query** (pygeoapi → store), the **DB rows** (store → pygeoapi) and the **response** (pygeoapi → caller). Replies travel back along the same line, against its arrow. When one caller makes several reads in the same tick (e.g. the drift monitor reads the forecast via EDR and the observations via SensorThings), they are separate requests (an EDR query targets a single collection and cannot also return SensorThings observations). They leave together, drawn side by side along the line a few pixels apart rather than on top of each other. Reading a NetCDF file is slower than a SQL query (its DB legs take 3.5 s on screen against 2 s), so the replies come back staggered: the observations before the forecast. If the Observations DB is stopped, the query is refused and the caller receives an HTTP 503. |
| MOT-7 | **Declared inputs.** Each reader shows the data objects it needs as document slots, lettered and coloured like tokens: the drift monitor (forecast C, observations S) in the Drift sensor card; the model runner (climatology C, background C, observations S) in `forecast`; the feature detector (forecast C, climatology C) in `features`; each consumer its own kind (C, or C and G). The list is declared in the simulation (`topology/inputs.ts`), not the diagram. When the reader starts its reads, its slots go pale; each fills when its response token arrives. A slot that is not filled stays pale (no forecast yet, Observations DB down). Clicking a filled slot opens the document it holds, at any time, not only when paused. Hovering or focusing a slot, filled or empty, shows a small page-styled panel (not a browser tooltip): what the document is, what the reader uses it for, and either when it arrived or, if empty, why it may be. |
| MOT-8 | **Dependency signals.** Nothing travels on a lineage (Dagster dependency) line, so it carries no document token. Instead it shows two kinds of moment. A **release**: when an upstream asset is materialised and that lets the downstream step start (`forecast` → `features`, then `features` → `announcement`), a bright green pulse sweeps along the line, the whole line and its arrowhead turn green, and the arrowhead flashes before the colour fades back; whatever the release starts (the shim call, its reads) leaves only once the pulse lands, so cause visibly precedes effect. A **check**: at run start, the dependencies that are already available (`observations`, `climatology`, and the previous forecast as background) get a fainter sweep with no flash, and likewise `forecast` → `announcement` when features release it. Checks are dependencies, never triggers: new observations start nothing. While a run is under way, a downstream asset not yet released shows "waiting for …". Paused, a pulse can be clicked to open the event it stands for (an ASSET_MATERIALIZATION, or the satisfied dependency). |

### 5.3 Colour semantics

Each colour has one meaning:

- **Steel accent, pale fill**: our software.
- **Green fill**: an asset being materialised (shown for a few ticks after it is materialised).
- **Amber**: retry (shim strip and token).
- **Red halo**: offline module.
- **Dashed border**: off-the-shelf (mocked). **Double border**: our data store.

These styles show the **production** build-vs-adopt decision (`docs/system-architecture.md` §5). In the demonstrator itself everything is custom code; off-the-shelf parts are mocks.

The prototype used the Industry design system (steel blue, Barlow Condensed and Barlow, square blueprint frames with corner marks). A fresh UI may choose another system, but should keep the one-meaning-per-colour rule. Green, amber and red were added beyond the mono-accent palette.

### 5.4 Controls

Controls fall into three kinds, and each kind looks different so the audience can tell who would really have it:

| Kind | Who would really have it | Controls |
|---|---|---|
| **Scenario** | Nobody (the sea, the sensors) | Per-input shift (+5σ over 20 s, toggle); per-input sensor noise (0–3σ) |
| **Operator** | The ship's operator | Drift threshold, quorum, persistence; Request a run (a violet button on the Manual request card) |
| **Presenter** | The person giving the demo | In a **Control panel** occupying the top fifth of the World column (there is no toolbar): a large run/pause button (also Space), the clock, step, rate ½×/1×/10×/60× as a radio group (default ½×), add consumer, walkthrough and event log (with the event count). Elsewhere: play/pause buttons inline before the titles of fragile components (forecast, features, drift sensor, Ingestion, Observations DB) and view (information flow / system). Seed and number of inputs are URL parameters only (`?seed=`, `?inputs=`); F5 restarts. |

### 5.5 Banner

~~A permanent banner line~~ **Withdrawn (Nov 13, 2026).** The banner was removed to give the diagram the height. The honesty statement (synthetic data, illustrative numerics, mocked engines) opens the walkthrough instead; the module-boundary check still runs in CI and at build time, and the event-log digest is in the event log and replay tests.

### 5.6 System-architecture view (optional)

The standard view is information flow (§5.1). A second, optional view shows the same running simulation as a candidate production deployment. Rationale, the production mapping and its critical analysis are in `docs/system-architecture.md`.

| ID | Requirement |
|---|---|
| SYS-1 | A presenter toggle (and `?view=system`) switches between the information-flow view (default) and the system-architecture view. Switching does not pause, reset, reseed or otherwise alter the simulation. |
| SYS-2 | The system view is a projection of the same token records (SIM-6). It introduces no new simulation events or token kinds. One interaction is one token, routed element → process → node → link → node → process → element. MOT-1's minimum on-screen duration applies to the whole route. |
| SYS-3 | Zones are drawn left to right, mirroring World \| System \| Consumers: instrument network (OT), processing enclave, distribution zone (pygeoapi, broker), mission network. Zone boundaries use neutral labelled rules, not a semantic colour. |
| SYS-4 | Orchestrator internals are shown on the orchestration node: webserver, daemon, code location and metadata DB (its private store). The shims, drift monitor and feature detector sit in the code-location process. The model runner sits in its own process (Dagster Pipes) on the compute node. |
| SYS-5 | Node state is derived from existing state only: an offline module shows the offline state on its process and node. No node- or link-level faults are simulated. A static note states that the shore link is not simulated. |
| SYS-6 | The system view meets UI-6 (fits 1920×1080, no overflow, tested in its longest states) and the colour semantics of §5.3. Materialising (green) applies to the store that received the write. |

### 5.7 Tour mode

| ID | Requirement |
|---|---|
| TOUR-1 | A tour mode walks through the acceptance scenarios (§6, 3–9) with no presenter. It is started from the Control panel or `?tour=<name>`. |
| TOUR-2 | A tour is a replay script in the ARC-5 format (seed + timed control actions) with a caption per step. Tours and replay tests share the same script files; no tour-only control path exists. |
| TOUR-3 | Captions appear in one fixed caption strip that does not cover the diagram (UI-6 still holds). They say what is about to happen and what to watch. |
| TOUR-4 | The viewer can pause, step, and leave the tour at any time. Leaving hands control to the presenter with the simulation state unchanged. |

### 5.8 Walkthrough

| ID | Requirement |
|---|---|
| WALK-1 | The app opens paused at T+00:00 with a walkthrough running, unless `?walkthrough=off`. A Walkthrough (?) button in the Control panel restarts it (and pauses the simulation). |
| WALK-2 | The walkthrough introduces the three regions (World, System, Onboard consumers) one at a time, then each component one at a time in the order data flows, then the token key. A step after the introduction presents the Control panel. Each step dims the rest of the diagram and spotlights its region or component. |
| WALK-3 | A caption card beside the spotlight gives the step's kind (region, component), title and a short explanation, with its position (n / total) and a progress bar. |
| WALK-4 | Next, Back and Skip buttons; → or Enter for next, ← for back, Esc to leave. Leaving keeps the simulation paused. |
| WALK-5 | The last step offers "Start the simulation" (runs it) or "Stay paused". The steps' text and spotlight areas are declared in one list (`packages/ui/src/walkthrough.ts`). |

---

## 6. Acceptance criteria

1. With the same seed and the same scripted actions, two runs (in the browser or headless) produce identical event-log digests.
2. The boundary check fails the build if any of our modules imports the orchestrator or a shim.
3. Injecting a shift on enough inputs to meet quorum declares drift within threshold/persistence checks. A drift-caused forecast is committed, its features are detected, and it is announced. Every consumer reports ✓.
4. With no drift, a scheduled run fires when the staleness schedule's countdown reaches 0:00.
5. Request a run during a run: it queues. Request again: the second merges into the first, and the log shows both causes.
6. Model runner offline: the run shim turns amber with a retry countdown on the 2, 4, 8, 10, 10… second backoff. The runner shows a red halo and no progress, and nothing is committed. Bring it back online: the next retry commits, and the pipeline continues.
7. Same as 6 for the feature detector, with the forecast already committed.
8. Raising sensor noise to 3σ produces spike rejections with reasons in the log. Rejected values never reach the Observations DB.
9. A consumer added after the first announcement shows the current forecast immediately (a catch-up query).
10. Pausing freezes every token and countdown. Step advances exactly one tick.
11. At 1920×1080 and above, the whole diagram is visible without scrolling and no text overflows its box.
12. Store counts are read from the stored rows and never kept as separate counters.
13. Running the same seed and script while toggling the view at arbitrary ticks gives the same event-log digest as running without toggling.
14. With the model runner offline, the system view shows the compute node offline, and the run token's route ends at the orchestration→compute link, with the amber retry on the shim.
15. Removing any element's placement, or a link that a cross-node edge needs, fails the test suite.
16. Each tour, run headless to completion, produces the same golden event-log digest as its replay test.
17. *(Withdrawn with MOT-2.)*
18. Stop ingestion for 30 s: the sensor broker's queued count grows by one per input per second. Start it: the queue drains to zero, and every observation is in the DB once, in measurement-time order. Stop the DB and request a run: the run retries until the DB is back, then commits.

---

## 7. Lessons from the prototype

- Layering two sections ("off-the-shelf" over "our software") hid the flow. Embedding our modules in the assets they compute made the asset-driven logic readable.
- Drawing both containment and arrows for the same relationship is noise; pick containment.
- Retry countdowns placed inside our modules misattributed responsibility. They belong on the shim.
- At 10× and 60×, tokens became invisible unless they had a minimum on-screen duration.
- Fixed-size cards overflowed repeatedly as status text grew. Design every card for its longest state (offline, retry, running), and test those states.
- Reusing a fill colour for two meanings (our software vs. materialising) confused viewers.

---

## 8. Open questions

None open. The six questions from v2 and three raised by the system-architecture work were decided on Nov 12, 2026.

### Decided (Nov 12, 2026)

- **Reduced motion.** Removed (MOT-2 withdrawn, Nov 13, 2026): tokens are always shown. The earlier decision to follow the OS setting is superseded.
- **Observations.** The `observations` source asset and the Observations DB are one element, straddling the orchestrator edge (UI-8).
- **Background.** Drawn as a loop arrow on `forecast` (UI-10).
- **Orchestrator private store.** Drawn in both views (UI-9, SYS-4).
- **Tour mode.** Wanted, built from the replay scripts (§5.7).
- **Target display.** 1920×1080 minimum (UI-6), raised from 1280×720 to give the straddling Observations DB (UI-8) room. Scales up to large monitors; below 1080p (e.g. an older 720p projector) legibility is not guaranteed.
- **Drift monitor cadence.** It stays a Dagster sensor. The 10 s interval (4 s before Nov 13, 2026) is demo-only; production uses ≥30 s (ORC-1).
- **Observation path.** Observations use the SensorThings schema end to end, with no SensorThings server (no FROST-Server). The DAQ gateway publishes SensorThings Observation messages to a **sensor broker** (a persistent queue), and ingestion acknowledges only after the DB commit. The broker is there for resilience: ingestion or DB restarts lose nothing. Buffering is commodity, so it is adopted rather than built into the gateway. It is a separate instance from the announcement broker, because the networks are separate.
- **Read path.** Our modules read only through pygeoapi, as §2 states. Revisit if forecast grids grow large enough for the HTTP hop to matter.
- **Network zones.** The instrument (OT) network and the mission network are separate, with a distribution zone between them (SYS-3).
- **Announce shim.** It calls a new module of ours, the announcer, which publishes to the broker, so every shim calls one of our modules (§2).
- **Drift during a run.** Drift is held back while a drift run is queued *or running* (DRF-5), so slow runs no longer trigger redundant drift runs.
