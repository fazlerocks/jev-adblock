<p align="center">
  <img src="assets/icon-source.png" width="96" alt="Jev Ad Blocker logo: an orange shield with a diagonal slash" />
</p>

<h1 align="center">Jev Ad Blocker</h1>

<p align="center">
  <strong>An open-source AI ad blocker for Chrome, built on TypeSafe AI's Jev model.</strong> No filter lists. Jev looks at each suspicious element and decides.<br />
  Bring your own <a href="https://typesafe.ai">TypeSafe AI</a> key. Everything else runs in your browser.
</p>

<p align="center">
  <a href="#install">Install</a> ·
  <a href="#how-it-works">How it works</a> ·
  <a href="#how-is-this-different-from-ublock-origin-or-adblock-plus">vs uBlock Origin</a> ·
  <a href="#faq">FAQ</a> ·
  <a href="PRIVACY.md">Privacy</a>
</p>

<p align="center">
  <img src="docs/snap.gif" width="720" alt="Jev Ad Blocker Chrome extension removing ads from a news article: each ad turns to ash, crumbles and blows away as dust" />
</p>

Jev Ad Blocker is a free, open-source Chrome extension (Manifest V3) that blocks ads without downloading or maintaining a single filter list. Instead of matching URLs and CSS selectors against rules like uBlock Origin or AdBlock Plus, it describes each ad-shaped element on a page in a few structural fields and asks [Jev](https://docs.typesafe.ai), TypeSafe AI's System One decision model, one question: *is this an ad?* You supply your own Jev API key from the TypeSafe console, so there is no account, no subscription and no server in between.

It is also a complete, working example of what you can build with Jev: one Choice question per element, batched into a single request, with code owning every threshold. If you are evaluating Jev for classification, routing or moderation, the request builder in [`src/shared/jev/questions.ts`](src/shared/jev/questions.ts) and the decision logic in [`src/background/decisions.ts`](src/background/decisions.ts) are the two files to read.

---

## Why

Traditional ad blockers ship megabytes of hand-maintained filter rules and lose the arms race one selector at a time. Jev Ad Blocker takes a different bet: describe each ad-looking element in a few structural fields and ask a model that is built for exactly this kind of narrow, fast judgement.

[Jev](https://docs.typesafe.ai) is TypeSafe's "System One" model. You send it *state* and typed *questions*; it returns calibrated probabilities, not generated text. It is fast (tens to hundreds of milliseconds), cheap ($0.042 per million input tokens, output free) and cannot hallucinate outside the answer space you give it. That makes it a good fit for "is this thing an ad?" at page scale.

## Built with Jev

Jev is not a chat model. You send it *state* (here: a list of compact element descriptions) and typed *questions* (here: one `choice` question per element with six options), and it returns a probability for every option plus a confidence score, in one round trip, typically 70 to 500 ms. There is no prompt, no generated text and no parsing. The full request this extension sends looks like this:

```json
{
  "model": "jev-latest",
  "state": {
    "page": { "host": "example-news.com", "title": "Markets rally…" },
    "candidates": [
      { "i": 0, "tag": "iframe", "size": "300x250", "iframe_host": "safeframe.googlesyndication.com", "container": "aside", "signals": ["third_party_iframe", "iab_size"] },
      { "i": 1, "tag": "div", "classes": ["card", "card--promo"], "text": "Sponsored · Meet the SUV built for everything", "link_hosts": ["outbrain.com"], "rel_sponsored": true, "container": "main" }
    ]
  },
  "questions": {
    "c0": { "type": "choice", "instructions": "What is `candidates[0]` on this web page?", "criteria": { "display_ad": "…", "sponsored_native": "…", "consent_or_popup": "…", "first_party_promo": "…", "site_content": "…", "site_ui": "…" } },
    "c1": { "type": "choice", "instructions": "What is `candidates[1]` on this web page?", "criteria": { "…": "…" } }
  }
}
```

Everything else in the repository is plumbing around that call: finding candidates, caching answers, and hiding elements.

## How it works

```
page ──► content script
          find candidates       third-party iframes, IAB ad sizes, ad-tech attributes, rel="sponsored",
                                "Sponsored" labels, id/class tokens, fixed overlays
          describe each one     tag, classes, size, position, page region, link/iframe hostnames,
                                up to 150 chars of visible text
          ──► service worker
                overrides  ►  keep
                cache hit  ►  reuse
                miss       ►  one Jev request per batch, one Choice question per candidate:
                              display_ad · sponsored_native · consent_or_popup ·
                              first_party_promo · site_content · site_ui
          hide when the aggregate ad probability clears a per-category threshold,
          beats the safe categories by a margin, and the answer is confident
```

Decisions are cached per host and structural fingerprint, so repeat visits usually send nothing. After a few consistent hits the extension materialises a CSS selector and hides the element before the page paints.

The exact request shape lives in [`src/shared/jev/questions.ts`](src/shared/jev/questions.ts). Code owns every threshold; the model only judges.

## Install

There is no store listing yet. Load it as an unpacked extension:

```bash
git clone https://github.com/fazlerocks/jev-adblock
cd jev-adblock
npm install
npm run build
```

1. Open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked**, pick the `dist/` folder.
2. The settings page opens. Create a key at [console.typesafe.ai/keys](https://console.typesafe.ai/keys), paste it, click **Save & test**.
3. Read the privacy section and switch on the disclosure. The **Status** card turns green when everything is in place.

<p align="center">
  <img src="docs/popup.png" width="400" alt="Jev Ad Blocker popup showing hidden ads on the current page, analysed count and per-page cost" />
</p>

## What leaves your browser

For each element that looks like it might be an ad, the extension sends TypeSafe:

- the page hostname, title and language
- the element's tag, class names, ARIA role and label, size, position and page region
- the hostnames of links and iframes inside it (never full URLs), and which heuristics flagged it
- up to 150 characters of its visible text

Never sent: form values, cookies, full URLs, or page text outside the candidate element. Pages containing a password field or a payment iframe are never analysed. Your API key is stored in the extension's local storage and sent only to `api.typesafe.ai`. There is no telemetry. See [PRIVACY.md](PRIVACY.md).

## Features

- **Bring your own key.** Nothing is analysed until a key is saved and the disclosure accepted.
- **Six categories, per-category thresholds.** Consent banners and a site's own promotions are recognised but never hidden unless you opt in.
- **Cache and site rules.** Decisions persist for seven days; repeated positives become pre-paint CSS rules that expire and self-correct.
- **Corrections.** "Not an ad" restores an element and pins it as never-hide for that site.
- **Budget and safety rails.** Daily token budget, circuit breaker on API failures, hard never-touch list for payment, auth, captcha and embed iframes.
- **Snap effect.** Optional: the ad turns to ash, crumbles from one corner and blows away as dust on a page-wide wind, then the space closes smoothly. Works on cross-site ad iframes too, and respects `prefers-reduced-motion`.
- **Per-page cost.** The popup shows tokens and dollars for the current page and lifetime.

<p align="center">
  <img src="docs/settings.png" width="760" alt="Jev Ad Blocker settings page: API key, privacy disclosure, blocking thresholds and site lists" />
</p>

## Cost

A first visit to a heavy news page sends one request of roughly 10k input tokens, about $0.0004. Cached visits are free. At 250 new pages a day that is around 13 cents a month. The default daily budget is 5M tokens (about $0.21) and is enforced.

## Development

```bash
npm run dev         # rebuild on change; reload the extension from chrome://extensions
npm run typecheck   # tsc
npm test            # vitest unit tests
npm run e2e         # Playwright: loads dist/ into Chromium with api.typesafe.ai mocked
```

Useful scripts:

| Script | What it does |
|---|---|
| `node scripts/debug-fixture.mjs` | Prints the exact candidate descriptors sent to Jev for the fixture page |
| `node scripts/screenshot-ui.mjs <dir>` | Renders the popup and settings in a real extension context |
| `node scripts/snap-frames.mjs <dir>` | Records the snap effect and cuts a contact sheet |

### Layout

```
static/            manifest.json, popup and settings HTML/CSS, content.css, icons
src/shared/        types, constants, message contracts, sanitizer, fingerprint, Jev client, question builder, icons
src/content/       candidate discovery, descriptor, hider, snap effect, observer, site-rule injection
src/background/    router, classify pipeline, decisions, cache, site rules, usage, tab state, badge
src/popup/  src/options/
test/unit/  test/e2e/  test/fixtures/  test/mock/
```

No runtime dependencies. Icons are inlined [Lucide](https://lucide.dev) SVGs.

### Design notes

- **Jev cannot read HTML.** The descriptor in `src/content/describe.ts` is the accuracy lever. If you improve recall, improve it there.
- **Aggregate, don't argmax.** `decisions.ts` sums the ad categories before comparing to the threshold, so a 45/40 split between display and sponsored still hides.
- **Fail open.** Any error, timeout or budget stop results in nothing being hidden. The page always works.
- **The key never reaches content scripts.** A unit test fails if anything under `src/content/` references it.

## Known limitations

- The first visit to a page shows ads for the scan plus Jev latency before they are hidden. Cache hits hide on the first idle pass; site rules hide before paint (unless the snap effect is on, which deliberately lets the ad appear so it can be snapped).
- In-stream video ads inside a site's own player cannot be removed by hiding elements. That needs network-level blocking, which this project intentionally does not do.
- Cross-origin iframes are judged from the parent page; ads nested inside them are hidden as a whole or not at all.
- Native widgets that render inside an **open** shadow root (MGID, Taboola, Outbrain) are scanned and hidden at the host element. Closed shadow roots are not reachable by any extension.
- Requires the `<all_urls>` host permission to run on every site.

## How is this different from uBlock Origin or AdBlock Plus?

| | Jev Ad Blocker | uBlock Origin / AdBlock Plus |
|---|---|---|
| How ads are identified | A model judges each suspicious element from a short structural description | Community-maintained filter lists (EasyList and friends) matched against URLs and CSS selectors |
| Blocks network requests and trackers | No, element hiding only | Yes |
| Handles new or unusual ad layouts | Yes, if the element looks like an ad it gets judged | Only once someone writes a rule for it |
| Blocks in-stream video ads (YouTube, site players) | No | Partially, depends on the list and the platform |
| Works under Chrome Manifest V3 | Yes, no `declarativeNetRequest` rule limits because there are no lists | uBlock Origin Lite and ABP work within the MV3 rule caps |
| Cost | Your own TypeSafe API key; a fraction of a cent per new page, cached after that | Free |
| Data leaves the browser | Compact element descriptions to `api.typesafe.ai`, listed field by field in [PRIVACY.md](PRIVACY.md) | Filter list downloads only |
| Setup | Paste a key, accept the disclosure | Install and go |

If you want the broadest possible blocking with zero setup, use uBlock Origin. Jev Ad Blocker is for people who want to see what a list-free, model-driven blocker looks like, and who are comfortable with a pay-per-page model where the bill is their own.

## FAQ

**Is Jev Ad Blocker safe to use?**
The code is small enough to read in an afternoon, has no runtime dependencies and no telemetry. Your API key stays in the extension's local storage and is sent only to TypeSafe. Pages with a visible password field or payment form are never analysed, and anything you can type into is never described. See [PRIVACY.md](PRIVACY.md) for the exact payload.

**How does an AI ad blocker work?**
Cheap heuristics pick out elements that might be ads: third-party iframes, standard ad sizes, ad-tech attributes, `rel="sponsored"` links, "Sponsored" labels, sticky overlays. Each one is described in about twenty words (tag, classes, size, position, page region, link hostnames, a snippet of text). Those descriptions go to Jev in one batch, and Jev returns a probability for each of six categories. Code applies the thresholds and hides what qualifies. Decisions are cached per site for a week.

**Does it block YouTube ads?**
No. Ads inside a video stream are part of the video, and removing them needs network-level blocking, which this extension deliberately does not do. Display ads and sponsored cards around the player are handled like on any other site.

**Is it free?**
The extension is free and MIT-licensed. Requests to TypeSafe are billed to your own key at $0.042 per million input tokens. A typical first visit to an ad-heavy page costs about $0.0004; repeat visits are served from cache and cost nothing. A daily budget cap is on by default.

**Does it work with Chrome Manifest V3?**
Yes. It is built as a Manifest V3 extension and does not use `declarativeNetRequest`, so the MV3 rule limits that constrain list-based blockers do not apply. Firefox and Safari are not supported yet.

**Can I fix a wrong decision?**
Yes. The popup lists everything hidden on the current page. "Restore" brings an element back for now; "Not an ad" restores it and pins that decision for the site permanently. Thresholds and category toggles in Settings apply immediately, including to cached decisions.

**What is Jev?**
[Jev](https://docs.typesafe.ai) is TypeSafe AI's "System One" model. It does not generate text; it takes structured state and typed questions and returns calibrated probabilities in tens to hundreds of milliseconds. That makes it suited to narrow, high-volume judgements like "is this element an ad?".

## Contributing

Issues and pull requests are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md). The most valuable contributions right now are real-world false positives and false negatives with the descriptor that was sent, which `scripts/debug-fixture.mjs` and the service worker's Network tab both show.

## License

[MIT](LICENSE)
