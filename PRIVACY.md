# Privacy

Jev Ad Blocker is designed so that the least possible information leaves your browser, and none of it goes to the project's authors.

## What is sent, and to whom

The only network destination is `https://api.typesafe.ai`, using the API key **you** create and paste in. There is no server operated by this project, no analytics and no crash reporting.

For each page element that the extension considers a possible ad, one request may include:

| Field | Example |
|---|---|
| Page hostname, title, language | `example-news.com`, `Markets rally as…`, `en` |
| Element tag, id, class names | `div`, `ad-slot`, `card card--promo` |
| ARIA role and label | `region`, `Advertisement` |
| Size, position, page region | `300x250`, `static`, `aside` |
| Hostnames of links and iframes inside it | `outbrain.com`, `safeframe.googlesyndication.com` |
| Up to 150 characters of visible text | `Sponsored · Meet the SUV built for everything` |
| Which heuristics flagged it | `third_party_iframe`, `iab_size` |

## What is never sent

- Form values, input contents, passwords or payment details
- Cookies, local storage or anything from other tabs
- Full URLs or query strings
- Page text outside the candidate element
- Your API key, to anyone other than TypeSafe

Pages that contain a password field or a payment iframe are skipped entirely. You can add any host to a never-analyse list in Settings.

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
