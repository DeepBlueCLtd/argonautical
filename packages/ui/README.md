# @argonautical/ui

The browser demonstrator and the explanatory site shell. React + SVG, built with Vite into a static site that works offline (ARC-6).

| Path | Page |
|---|---|
| `index.html`, `src/site.css` | The explanatory site at `/`. **Placeholder sections** (`<section class="placeholder">`) mark where the explanatory content goes. |
| `demo/index.html`, `src/` | The demonstrator at `/demo/`. |

## How it is built

- **The simulation drives everything.** `src/runner.ts` owns the wall clock (run/pause, step, ½×/1×/10×/60×, default ½×) and calls the simulation's control API and `step()`. Nothing else mutates simulation state (ARC-4).
- **Wiring is declared, not drawn (ARC-3).** `src/diagram/layout.ts` holds only rectangles and routing hints. Every edge drawn comes from the simulation's declared `EDGES`; consumer edges are drawn per consumer instance.
- **Tokens are real interactions (MOT-1).** Each token record from the simulation becomes one moving dot. It stays on screen for at least 0.6 s (1.2 s for lineage) at any speed; each leg of a pygeoapi round trip takes 2 s (about 8 s per round trip), and stops when paused. A step animates that one tick's tokens and then stays paused.
- **Control panel (§5.4).** No toolbar: the presenter controls sit in the top fifth of the World column (run/pause, also Space; clock; ½×/1×/10×/60×; Step; + Consumer; ? walkthrough; event log). Seed and inputs are URL parameters (`?seed=`, `?inputs=`).
- **Power, capabilities and handshake (CAT-1..5).** A power button sits beside play/pause. Switch off to choose what to install (Feature detector, 48 h); switch on to install a fresh system: the consumers shake hands (GET /collections, then SUBSCRIBE) with the clock held, then press play. pygeoapi's card lists its catalogue, the broker's card its topics, and each consumer shows how it tailored itself (HI RES / LOW RES, 12 h / 48 h, OK).
- **Walkthrough (WALK-1..5).** Opens by default, paused at T+00:00: the three regions, then each component in data-flow order, each spotlit with a caption card (← → Esc). Restart it from the ? button in the Control panel; skip it with `?walkthrough=off`. Steps live in `src/walkthrough.ts`.
- **Drill-down (MOT-6).** Hover any moving token for a page-styled panel (summary, route, standard, format) that follows it. When paused, the frozen dots can be clicked or tapped (or reached with Tab and Enter). The popup shows the interaction, what was passed, its production format and a mock JSON object built from the simulation's values. Step leaves the tokens part-way so there is something to click. Payloads are built in `packages/sim/src/payloads.ts`. A read through pygeoapi plays as four legs in sequence (request → DB query → DB rows → response), with the replies running back along their lines, so each can be opened. A caller's same-tick reads leave together, side by side; NetCDF reads are slower than SQL ones, so their replies arrive later.
- **Declared inputs (MOT-7).** The drift sensor, `forecast`, `features` and each consumer show the documents their reader needs. They go pale when it starts reading and fill as each response lands; click a filled one to open it. Hover (or focus) any slot, empty or not, for a page-styled panel saying what the document is and what it is for. C1, C3… need coverage and features; C2, C4… the coverage only.
- **Dependency signals (MOT-8).** Lineage lines carry no tokens. A green sweep and arrowhead flash marks an upstream materialisation releasing the next step (what it starts waits for the pulse to land); a faint sweep marks a dependency checked at run start. Downstream assets show "waiting for …" until released.
- **Fault controls (FLT-1, FLT-3).** Fragile components have a play/pause button inline before their title: forecast (model runner), features (feature detector), drift sensor (drift monitor), Ingestion and the Observations DB. A paused component gets the red halo.
- **Buffering (FLT-3).** Pausing Ingestion or the Observations DB makes readings queue in the sensor broker. While a backlog builds, a dark tab on the Sensor broker's exit edge shows "N queued". The tab is square where it meets the card and rounded on its outer corners. The card shows how long the oldest message has waited. The `buffering` scenario walks through it.
- **Token letters.** Each token is a white document lettered with the standard its content follows (`STANDARDS` in `packages/sim/src/payloads.ts`), and a Token key card sits at the foot of the Onboard consumers column. That column shows up to five consumer cards, then "+N more". The letter is by payload, so an EDR request is **E** and its CoverageJSON response is **C**.
- **No reduced-motion mode.** Tokens are always shown (MOT-2 withdrawn).
- **Boundary check (ARC-1).** `npm run boundary` writes `src/generated/boundary.json` before `dev`, `build` and `typecheck`; a violation fails the build. (The on-screen banner that showed it was removed with the toolbar.)
- **Controls live on the cards they affect (UI-6).** Scenario controls are on the World cards (shift in Ocean, noise in Sensors) and operator controls on the Drift sensor card, so there is no control strip and the diagram gets the whole window.
- **URL parameters:** `?seed=`, `?inputs=3..6`, `?layout=`.

## Not built yet

- The system-architecture view (§5.6) and tour mode (§5.7).
- A single self-contained HTML build (ARC-6).
- Playwright layout tests at 1920×1080 (acceptance 11). The layout was checked by hand with screenshots, including the "runner offline, retrying" state with 6 inputs.
