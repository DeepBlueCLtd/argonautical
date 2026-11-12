# argonautical
Considering ocean data collection and forecasting

## Documents

- [`srd.md`](srd.md) — Software Requirements Document for the Forecast Pipeline Demonstrator.
- [`docs/system-architecture.md`](docs/system-architecture.md) — candidate production architecture, how the demonstrator mocks it, and the optional system-architecture view.
- [`packages/sim`](packages/sim) — the deterministic simulation library (headless, tested).
- [`packages/ui`](packages/ui) — the browser demonstrator (`/demo/`) and the explanatory site shell (`/`), published to GitHub Pages.

## Development

```bash
npm ci
npm run ci   # typecheck, module-boundary check, tests
npm run dev  # demonstrator at http://localhost:5173/demo/, site at /
npm run build
```

Pushing to `main` publishes `packages/ui/dist` to the `gh-pages` branch (`.github/workflows/pages.yml`). One-time setup: Settings → Pages → deploy from branch `gh-pages`, folder `/`.
