# Jev Ad Blocker

An **AI-only** ad blocker for Chrome. There are no filter lists. Page elements that look like they might be ads are
described in a handful of structural fields and judged by [TypeSafe AI's Jev](https://typesafe.ai) model, a
"System One" decision model that returns calibrated probabilities instead of generated text.

**Bring your own key.** Nothing is analysed until you paste a TypeSafe API key from
[console.typesafe.ai/keys](https://console.typesafe.ai/keys). The key lives only in the extension's local storage and
is only ever sent to `api.typesafe.ai`.

## How it works

```
page DOM ─► content script
   1. find candidates cheaply and deterministically (third-party iframes, IAB ad sizes, ad-tech attributes,
      rel="sponsored" links, "Sponsored" labels, id/class tokens, fixed overlays)
   2. describe each one in ≤ 150 chars of text plus tag, classes, size, position, region, link/iframe hostnames
   3. send the batch to the service worker
service worker
   4. overrides ("not an ad") ► keep · cache hit ► reuse · miss ► one Jev request per batch (≤ 40 candidates)
   5. one Choice question per candidate: display_ad / sponsored_native / consent_or_popup /
      first_party_promo / site_content / site_ui
   6. hide when the aggregate ad probability clears a per-category threshold, beats the safe categories by a
      margin, and the answer is confident. Store the decision per host + structural fingerprint.
   7. after three consistent hits, materialise a CSS selector so the element is hidden before first paint next time
```

Jev cannot read HTML, generate text, or look anything up, so the whole design is about giving it a compact, honest
descriptor and letting code own every threshold. See `src/shared/jev/questions.ts` for the exact request shape.

## Install (developer mode)

```bash
npm install
npm run build
```

Then open `chrome://extensions`, enable **Developer mode**, click **Load unpacked** and pick the `dist/` folder.
The options page opens automatically on first install:

1. Paste your TypeSafe API key and click **Test key** (calls `GET /v1/models`).
2. Read the disclosure of what leaves your browser and tick the checkbox.
3. Browse. The badge shows how many elements were hidden on the current tab.

`npm run dev` rebuilds on change; reload the extension from `chrome://extensions` to pick up a new build.

## What leaves your browser

For each candidate element: the page hostname, title and language; the element's tag, id, class names, ARIA
role/label, size, position and page region; the hostnames (never full URLs) of links and iframes inside it; up to
150 characters of its visible text. Never sent: form values, cookies, full URLs, or page text outside the candidate.
Pages containing a password field or a payment iframe are never analysed. Decisions are cached locally so repeat
visits usually send nothing. There is no telemetry.

## Cost

Input tokens cost $0.042 per million and output is free. A typical first visit to a heavy news page sends one
request of roughly 10k tokens, about half a cent per thousand pages. Cached visits are free. A daily token budget
(default 5M tokens ≈ $0.21) is enforced in settings.

## Popup and settings

- **Popup**: global on/off, pause on this site, counts, a list of hidden elements with **Restore** (this page) and
  **Not an ad** (never hide this element on this site again), token usage and estimated cost.
- **Settings**: key management, disclosure, model (`jev-latest`, pinned `jev-1.13.0`, `jev-preview`), thresholds per
  category, optional hiding of consent popups and first-party promotions, collapse mode, daily budget,
  never-analyse and paused host lists, your corrections, cache and site-rule maintenance.

## Development

```bash
npm run typecheck   # tsc
npm test            # vitest unit tests (pure modules + chrome storage stub)
npm run e2e         # Playwright: loads dist/ into Chromium, mocks api.typesafe.ai, runs the fixture page
node scripts/debug-fixture.mjs   # prints the exact candidate descriptors sent to Jev for the fixture
```

`test/fixtures/ads.html` contains display ads, a sponsored card, a sticky promo bar, and a set of things that must
never be hidden (hero banner, related stories, a first-party deals carousel, a YouTube embed, a captcha iframe, nav,
comments).

## Layout

```
static/            manifest.json, popup/options HTML+CSS, content.css, icons
src/shared/        types, constants, message contracts, sanitizer, fingerprint, Jev client + question builder
src/content/       candidates, describe, hider, observer, site-rule injection, orchestrator
src/background/    router, classify pipeline, decisions, cache, site rules, usage, tab state, badge
src/popup/  src/options/
test/unit/  test/e2e/  test/fixtures/  test/mock/
```

## Known limitations

- First visit to a page shows ads for the scan plus Jev latency (70–500 ms). Cache hits hide on the first idle pass
  and materialised site rules hide before paint.
- Cross-origin iframes are judged from the parent; ads nested inside them are hidden as a whole or not at all.
- Rule-hidden elements are re-verified by match count and TTL, not re-classified (they have no layout to describe).
- Anti-adblock scripts that react to `display: none` are out of scope; use **Restore** or pause the site.
- Requires the `<all_urls>` host permission to run on every site, which the Chrome Web Store reviews closely.

## License

MIT
