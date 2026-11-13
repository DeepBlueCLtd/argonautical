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
- **Drill-down (MOT-6).** When paused, the frozen dots can be clicked or tapped (or reached with Tab and Enter). The popup shows the interaction, what was passed, its production format and a mock JSON object built from the simulation's values. Step leaves the tokens part-way so there is something to click. Payloads are built in `packages/sim/src/payloads.ts`. A read through pygeoapi plays as four legs in sequence (request → DB query → DB rows → response), with the replies running back along their lines, so each can be opened.
- **Fault controls (FLT-1, FLT-3).** Fragile components have a play/pause button inline before their title: forecast (model runner), features (feature detector), drift sensor (drift monitor), Ingestion and the Observations DB. A paused component gets the red halo.
- **Buffering (FLT-3).** Pausing Ingestion or the Observations DB makes readings queue in the sensor broker. While a backlog builds, a dark tab on the Sensor broker's exit edge shows "N queued". The tab is square where it meets the card and rounded on its outer corners. The card shows how long the oldest message has waited. The `buffering` scenario walks through it.
- **Token letters.** Each token is a white document lettered with the standard its content follows (`STANDARDS` in `packages/sim/src/payloads.ts`), and a Token key card sits at the foot of the Onboard consumers column. That column shows up to five consumer cards, then "+N more". The letter is by payload, so an EDR request is **E** and its CoverageJSON response is **C**.
- **No reduced-motion mode.** Tokens are always shown (MOT-2 withdrawn).
- **Boundary check on screen (ARC-1).** `npm run boundary` writes `src/generated/boundary.json` before `dev`, `build` and `typecheck`, and the banner shows the result. A violation fails the build.
- **Adaptive layout (UI-6).** The scenario and operator controls sit in a bottom strip or a left sidebar, whichever leaves the diagram bigger. On each resize the strip's real height is measured before paint. Wide screens (1366×1024 and up) keep the strip. Tablets and 1280×720 get the sidebar: at about 1000×590 the diagram grows from 337 px to 714 px wide with 4 inputs. With 5–6 inputs on a small tablet, the sidebar scrolls. `?layout=side|bottom` forces a layout.
- **URL parameters:** `?seed=`, `?inputs=3..6`, `?layout=`.

## Not built yet

- The system-architecture view (§5.6) and tour mode (§5.7).
- A single self-contained HTML build (ARC-6).
- Playwright layout tests at 1920×1080 (acceptance 11). The layout was checked by hand with screenshots, including the "runner offline, retrying" state with 6 inputs.
