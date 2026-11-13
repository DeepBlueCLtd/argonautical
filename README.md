# argonautical
Considering ocean data collection and forecasting

## Documents

- [`srd.md`](srd.md) — Software Requirements Document for the Forecast Pipeline Demonstrator.
- [`docs/system-architecture.md`](docs/system-architecture.md) — candidate production architecture, how the demonstrator mocks it, and the optional system-architecture view.
- [`packages/sim`](packages/sim) — the deterministic simulation library (headless, tested).

## Development

```bash
npm ci
npm run ci   # typecheck, module-boundary check, tests
```

## Site and PR previews

`.github/workflows/site.yml` publishes to the `gh-pages` branch:

- **Push to `main`:** the site is published at the root. Existing previews are kept.
- **Pull request from a branch in this repo:** a fresh build is published to `previews/pr-<n>/`, and the PR gets one comment with the preview link, updated on each push. Every preview page carries a small "PR #n preview · all previews" tab.
- **Previews list:** `previews/` lists every PR with its title, a short summary (the first paragraph of the PR description), its status (open, merged or closed), the commit, and links to the preview and the PR. Previews are kept after a PR closes.

One-time setup: Settings → Pages → *Deploy from a branch* → `gh-pages`, folder `/`. If the Pages URL is not `https://<owner>.github.io/<repo>/` (for example, a custom domain), set the repository variable `PAGES_URL`.

The site build is `npm run build` at the repo root, with output in `packages/ui/dist` (`SITE_DIR` in the workflow). If there is no build, a placeholder page is published instead. PRs from forks are not previewed, because their token cannot push.

