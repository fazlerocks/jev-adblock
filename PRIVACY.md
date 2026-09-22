# Privacy

Jev Ad Blocker is designed so that the least possible information leaves your browser, and none of it goes to the project's authors.

## What is sent, and to whom

The only network destination is `https://api.typesafe.ai`, using the API key **you** create and paste in. There is no server operated by this project, no analytics and no crash reporting.

For each page element that the extension considers a possible ad, one request may include:

| Field | Example |
|---|---|
| Page hostname, title, language | `example-news.com`, `Markets rally as…`, `en` |
| Element tag and class names | `div`, `card card--promo` |
| ARIA role and label | `region`, `Advertisement` |
| Size, standard ad-size name, position, page region | `300x250`, `medium_rectangle`, `static`, `aside` |
| Hostnames of links and iframes inside it, iframe title | `outbrain.com`, `safeframe.googlesyndication.com` |
| Whether a link is marked `rel="sponsored"`, share of text inside links, image count | `true`, `0.9`, `1` |
| Names of ad-tech attributes on it | `data-google-query-id` |
| Which heuristics flagged it | `third_party_iframe`, `iab_size` |
| Up to 150 characters of visible text | `Sponsored · Meet the SUV built for everything` |

The element's `id` attribute is used locally for caching but is **not** sent.

## What is never sent

- Form values, input contents, passwords or payment details
- Cookies, local storage or anything from other tabs
- Full URLs or query strings
- Page text outside the candidate element
- Your API key, to anyone other than TypeSafe

Pages that contain a password field or a payment iframe are skipped entirely, and this is re-checked on every scan so forms that appear after load also stop analysis. Any element that contains something you can type into is never described. You can add any host to a never-analyse list in Settings.

## What is stored locally

In the extension's own storage on your device:

- Your API key
- Settings
- A cache of decisions keyed by hostname and a structural fingerprint of the element (no page content)
- Site rules (CSS selectors) derived from repeated decisions
- Your corrections ("Not an ad")
- Token usage counters

All of it can be cleared from the Settings page. Uninstalling the extension removes it.

## TypeSafe

Requests are governed by TypeSafe's own terms and privacy policy, available from [typesafe.ai](https://typesafe.ai). This project has no special relationship with TypeSafe and receives no data from them.
