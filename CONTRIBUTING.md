# Contributing

Thanks for taking a look. This is a small codebase with no runtime dependencies, so it should be quick to get into.

## Setup

```bash
npm install
npm run build          # produces dist/
npm run dev            # watch mode
```

Load `dist/` via `chrome://extensions` → Developer mode → Load unpacked. You need your own TypeSafe API key to exercise the real model; every automated test mocks the API.

## Before opening a pull request

```bash
npm run typecheck
npm test
npm run e2e            # first run: npx playwright install chromium
```

All three should pass. The end-to-end suite loads the built extension into Chromium and drives the fixture page in `test/fixtures/ads.html`, so rebuild before running it.

## Reporting a false positive or false negative

The most useful report includes the descriptor Jev saw. Two ways to get it:

1. `chrome://extensions` → Jev Ad Blocker → **service worker** → Network tab → the `POST /v1/systemone` request body.
2. For a reproducible page, add it to `test/fixtures/` and run `node scripts/debug-fixture.mjs`.

Please redact anything personal from the `text` field before pasting.

## Where things live

| Area | File |
|---|---|
| Which elements get considered | `src/content/candidates.ts` |
| What Jev sees for each element | `src/content/describe.ts`, `src/shared/jev/questions.ts` |
| Hide / don't hide thresholds | `src/background/decisions.ts`, `src/shared/constants.ts` |
| Cache and site rules | `src/background/cache.ts`, `src/background/siteRules.ts` |
| Message contracts between contexts | `src/shared/messages.ts` |

## Guidelines

- Keep the descriptor privacy-minimal. Never add full URLs, form values or page text outside the candidate.
- Content scripts must not reference the API key or call `fetch`. A unit test enforces this.
- Every hide decision must fail open: an error should mean nothing is hidden, never that content disappears.
- Add or update a unit test for pure logic and extend the fixture page for anything that changes what gets hidden.
- No new runtime dependencies without a discussion in an issue first.

## Commit messages

Short imperative subject line, optional body explaining why. Reference issues where relevant.
