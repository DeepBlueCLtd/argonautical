# Spec: hand-drawn ("draft") makeover of the demonstrator

Status: **draft for review**. Implementation starts once this is approved.

## 1. Goal

Make the demonstrator (`/demo/`) look like a whiteboard sketch: wobbly hand-drawn outlines and arrows, hand-lettered headings, on graph paper. The reference is a hand-drawn system diagram (ink outlines, light colour, handwritten titles). We are copying the **drawing style** only, not its pictures of components.

The meaning of the diagram must not change. Every rule in SRD §5.3 (colour semantics), §5.4 (control kinds) and UI-1…UI-9 still applies.

## 2. Scope

| In | Out |
|---|---|
| Demonstrator at `/demo/`: all three views (Artefacts, Logical, Physical) | The site shell at `/` (`site.css`): no change |
| Diagram boxes, regions, connectors, arrowheads, tokens | Simulation (`packages/sim`): no change |
| Control panel and inline controls | Layout geometry (`layout.ts`, `physical.ts`, `graph.ts`): positions and sizes stay the same |
| Popups (walkthrough, token popup, slot tips, store inspector, event log) and the bottom legend | Component illustrations (no drawn servos, boards etc.) |

## 3. Decisions (from the interview)

| # | Topic | Decision |
|---|---|---|
| D1 | Scope | Demonstrator only |
| D2 | How outlines are drawn | Real sketchy SVG strokes generated with **rough.js** (not a CSS imitation) |
| D3 | Motion | Each shape has a **fixed seed**, so it does not jitter from frame to frame. A shape is **redrawn with a new seed when its state changes** (e.g. idle → materialising → idle, online → offline) as a "redrawn" cue |
| D4 | Fonts | **Hand font for headings only**: region labels, card titles, popup titles, legend headings. Values, numbers, body text and mono text keep the current fonts |
| D5 | Background | **Graph paper**: faint engineering grid behind the canvas |
| D6 | Fills | **Flat pale fills** as now (ours steel pale, materialising green, retry amber), inside sketchy outlines. No hachure |
| D7 | What goes sketchy | Diagram boxes and regions; connector lines and arrows; controls; popups and legend: **all of them** |
| D8 | Roughness | **Light**: slight wobble, small corner overshoot, single stroke. No user toggle |
| D9 | Lineage tokens | **Sketchy, pre-drawn**: each token shape is generated once and reused while it moves |
| D10 | Heading colour | **Single dark ink** for all headings and frames. Colour stays reserved for meaning (§5.3) |
| D11 | Dependencies | Bundle locally: `roughjs` as an npm dependency and a self-hosted OFL hand font (woff2). No CDN, so the demonstrator still works offline |
| D12 | Build vs adopt coding | Unchanged in meaning: **ours = solid** sketchy steel stroke; **off-the-shelf = dashed** sketchy grey stroke; **our store = double** sketchy stroke. Legend swatches redrawn sketchy |

## 4. Design

### 4.1 Look

- **Paper.** Page and canvas background: off-white (about `#fbfaf6`), with a faint grid: minor lines every 10 px and major every 50 px in diagram units, very low contrast (major ≈ `rgba(60,90,120,0.10)`, minor ≈ half that). The grid sits in the SVG behind everything, so it scales with the diagram. Panels and cards keep a near-white fill so text stays on a clean background.
- **Ink.** One dark ink (`--ink`, about `#1f2933`) for headings, frames and neutral strokes. All §5.3 and §5.4 colours keep their current values.
- **Strokes.** rough.js with: `roughness ≈ 0.8`, `bowing ≈ 0.6`, `disableMultiStroke: true`, `preserveVertices: true` for connectors, stroke widths as today (lineage stays 2 px, UI-2). Corner overshoot comes from rough.js's default line ends.
- **Rounded rectangles.** rough.js has no rounded rect; build a rounded-rect path string and pass it to `rc.path()`. Keep today's `rx` values.
- **Dashed.** Off-the-shelf boxes use rough.js `strokeLineDash` with today's dash pattern. Check the dash is still obvious after the wobble (see §6).
- **Double border (stores).** Two sketchy outlines with different seeds, inset 4 px as today.
- **Arrowheads.** Replace the `<marker>` triangles with a small sketchy open "V" (two strokes) drawn at the path end, oriented along the last segment. Same colours as now (normal, release green, heavy).
- **Fills.** Flat pale fill drawn as a plain (non-rough) shape just inside the sketchy outline, so the fill stays crisp and cheap. `fillStyle: 'solid'` is not used.

### 4.2 Typography

- Hand font: one OFL font, self-hosted, suggested **Architects Daughter** (closest to the reference). Fallback: Caveat or Patrick Hand. Final choice made on a legibility check at 1920×1080 (UI-6).
- Applied to: region labels (CONTROL, WORLD, SYSTEM, CONSUMERS), card and asset titles, popup titles, legend and key headings, token letters (D9).
- Not applied to: numbers, clock, values, mono text (`--mono`), body text in popups, button labels. These keep `--font` / `--mono`.
- Headings may need a slightly larger size because hand fonts read smaller. Any change must not cause overflow (UI-6).

### 4.3 Controls (HTML, not SVG)

Buttons, segmented toggles, steppers, the run/pause button and inputs are HTML. They get sketchy borders from a small `<SketchBorder>` component: an absolutely positioned SVG overlay sized with a `ResizeObserver`, drawing a rough rounded rect with the element's border colour. The CSS border becomes transparent (kept for layout so nothing moves).

- Control-kind colours (§5.4: teal scenario, violet operator, grey presenter) are unchanged.
- `on` / `primary` buttons keep their solid dark fill; the sketchy outline sits on top.
- Hover: outline darkens, same as now. No redraw on hover (D3 is state changes only).
- Focus ring: keep the browser's visible focus outline for accessibility.

### 4.4 Popups and legend

Walkthrough card, token popup, slot tips, store inspector and event log get a sketchy frame (same `<SketchBorder>`), hand-font title, and a slightly offset sketchy shadow is **not** added (keep it simple). The bottom legend's swatches are drawn with the same sketch functions as the diagram, so a legend swatch always matches what it explains.

### 4.5 Motion (D3)

- Seed = stable hash of the element's id (e.g. asset key, edge key). Same element → same drawing on every frame and every reload.
- On a **state change** the seed becomes `hash(id + stateName)`, so the outline visibly redraws once. States that trigger a redraw: materialising on/off, retry on/off, offline on/off, working on/off (MOT-9).
- No continuous jitter. Pulses and sweeps (MOT-8 release, MOT-9 working pulse) keep their current animation, applied to the sketchy path (stroke colour / dash offset / opacity).
- `prefers-reduced-motion`: state-change redraws still happen (they are not animations), existing animation rules unchanged.

### 4.6 Tokens (D9)

- Each token kind (one per standard letter S, Q, E, C, …) has one sketchy outline generated once at load and kept as a path string.
- A moving token is a `<g transform="translate(x,y)">` reusing that path, so no rough.js work happens per frame.
- Letter in the hand font, colour as today (`--std-*`).
- Side-by-side tokens (MOT-6) and hover/click drill-down keep working; the hit area is the token's bounding box, not the wobbly path.

## 5. Implementation outline

1. Add `roughjs` and the font (`packages/ui/public/fonts/…woff2`, `@font-face` in `styles.css`).
2. New module `packages/ui/src/sketch/`:
   - `sketch.ts`: wraps rough.js `generator` (no DOM), returns path data for `rect`, `roundRect`, `line`, `polyline`, `arrowHead`, with seed and options. Results memoised by `(shape, geometry, seed, options)`.
   - `Sketch*.tsx`: small React components (`SketchRect`, `SketchPath`, `SketchArrow`) emitting `<path>` elements with the existing CSS classes, so current CSS colour rules still apply.
   - `SketchBorder.tsx`: HTML overlay for controls and popups.
3. Replace `<rect>` / `<path>` / `<line>` / `<marker>` in `Diagram.tsx`, `GraphDiagram.tsx`, `PhysicalDiagram.tsx` with the sketch components. Geometry inputs unchanged.
4. Graph-paper `<pattern>` in each view's SVG `<defs>`.
5. CSS: font, paper colours, transparent borders for overlaid controls. Classes and colour tokens otherwise kept.
6. Exclusions: the spotlight dim mask and ring in the walkthrough stay as clean shapes (they are overlays, not diagram content).

Behaviour, layout files, the simulation and the tests in `packages/sim` are not touched.

## 6. Risks and critical points

- **Performance.** The Artefacts view has hundreds of shapes, and the diagram re-renders on every tick. Generating rough paths per render would be too slow. Mitigation: memoise by geometry + seed (§5.2), pre-draw tokens (D9). Acceptance: no visible drop in frame rate at 60× rate compared with `main`.
- **Legibility at 1920×1080 (UI-6).** Wobble plus a hand font makes a dense screen busier. "Light" roughness and headings-only hand font are chosen for this; still the biggest risk. Check every view in its longest state.
- **Dashed vs solid must stay obvious.** A wobbly solid line can look broken, and a short dash can look like wobble. If the difference is not clear at a glance, lengthen the dash rather than reduce roughness.
- **Double border (stores).** Two wobbly outlines 4 px apart may cross each other. Use low roughness for the inner outline or increase the inset slightly.
- **Redraw-on-state-change could read as noise** when many assets change at once (e.g. a run materialising several assets). If it looks busy, limit redraws to offline and materialising only.
- **Thin lineage lines (UI-2, 2 px)** with wobble may look heavier or hide tokens. Keep the width and check token visibility.
- **HTML control overlays** add one SVG and one `ResizeObserver` per control (~40 controls). Acceptable, but share a single observer.
- **Screenshot determinism.** Fixed seeds mean screenshots are stable between runs; any visual test baselines need regenerating once.
- **SRD §5.3** mentions the prototype's "square blueprint frames". This makeover is a deliberate change of design system, which §5.3 allows; add a line to §5.3 noting the sketch style.

## 7. Acceptance criteria

1. All three views render with sketchy outlines, connectors, arrowheads and tokens; controls, popups and legend have sketchy frames.
2. Headings use the bundled hand font; values, numbers and mono text do not.
3. Graph-paper background visible behind the diagram in all views.
4. §5.3 meanings unchanged and distinguishable: ours solid, off-the-shelf dashed, store double, green/amber/red states, flat pale fills.
5. Shapes do not change between frames; a shape redraws once when its state changes.
6. UI-6: fits 1920×1080 with no scrolling in every view, in the longest states.
7. Works offline once loaded (no network requests for fonts or scripts).
8. `npm run ci` passes. No frame-rate drop at 60× compared with `main`.
9. Site shell (`/`) unchanged.

## 8. Open points for the reviewer

- Font choice (Architects Daughter suggested) to be confirmed from a screenshot.
- Whether the walkthrough spotlight ring should also be sketchy (spec says no).
