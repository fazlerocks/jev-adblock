# Jev Ad Blocker in Safari

This guide covers the local Safari conversion and the setup that successfully blocked ads on `fuzzthepiguy.tech`. The extension uses Jev to classify page elements and hide ads. You supply your own TypeSafe API key; classification consumes billable API tokens.

## Requirements

- A Mac with Safari 16.4 or later (the extension uses `storage.session`).
- Full Xcode, installed and opened to complete its initial setup. The standalone Command Line Tools package is insufficient for Safari packaging.
- Node.js and npm.
- A TypeSafe API key from [the TypeSafe console](https://console.typesafe.ai/keys).

## 1. Build and generate the Xcode project

From the repository directory:

```sh
npm ci
npm run safari:convert
```

This builds the Safari JavaScript bundle in `dist-safari/` and generates the containing macOS app and Safari Web Extension project in `safari-build/`.

If the packaging tool cannot be found, select your full Xcode installation for this command:

```sh
DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer npm run safari:convert
```

Adjust the path if Xcode is installed elsewhere. This does not change the system-wide developer directory.

Open this project in Xcode:

```text
safari-build/Jev Ad Blocker/Jev Ad Blocker.xcodeproj
```

If the project already exists, open it directly rather than regenerating it. Generated projects are ignored by version control, and regeneration can require reapplying local signing and identifier settings.

## 2. Configure identifiers and signing

Select each target in Xcode and open **Signing & Capabilities**. The working local configuration uses:

| Target | Bundle identifier |
| --- | --- |
| Jev Ad Blocker | `org.icosahedron.decision-adblock` |
| Jev Ad Blocker Extension | `org.icosahedron.decision-adblock.Extension` |

Apply these identifiers to both Debug and Release configurations. If you choose another identifier, the extension's identifier must begin with the app's identifier followed by a period.

The converter produced mismatched identifiers during setup: `org.icosahedron.Jev-Ad-Blocker` for the app and `org.icosahedron.jev-adblock.Extension` for the extension. This caused Xcode to fail with:

```text
Embedded binary's bundle identifier is not prefixed with the parent app's bundle identifier.
```

Correct both targets before building. Passing a bundle identifier to the converter did not prevent this mismatch with the installed Xcode version.

Local testing succeeded with the self-signed certificate configuration retained and Safari's **Allow Unsigned Extensions** enabled. This guide documents local testing; it does not cover distribution signing.

Select the **Jev Ad Blocker** scheme and **My Mac**, then build and run the app.

## 3. Enable the extension and website permissions

In Safari:

1. Open **Settings → Advanced** and enable developer features (the label may be **Show features for web developers**).
2. Open the **Develop** menu and enable **Allow Unsigned Extensions**.
3. Open **Settings → Extensions** and enable **Jev Ad Blocker**.
4. Use **Edit Websites** to allow access to the sites you want filtered.
5. Also allow access to **`api.typesafe.ai`**. This permission is needed for the extension's API requests, including testing the key.

For an initial test, you can temporarily allow all websites, then restrict access to the API domain and sites you want filtered.

## 4. Save the API key and accept the disclosure

Open the extension's settings page from its popup.

1. Paste your TypeSafe API key and click **Save & test**.
2. Confirm that the key test succeeds.
3. In the **Privacy** section, read the disclosure and enable its acceptance toggle.
4. Confirm that blocking is enabled and the test site is not paused or excluded.

**Saving a valid key alone does not activate scanning.** The privacy disclosure must also be accepted. It explains that compact descriptions of candidate elements, including short text snippets, are sent to TypeSafe for classification. See [PRIVACY.md](PRIVACY.md) for details.

## 5. Test in Safari

Reload an ad-heavy page after granting permissions and accepting the disclosure. The page used successfully during local testing was:

```text
https://fuzzthepiguy.tech/
```

Ads can remain visible briefly while the extension scans and waits for Jev. Check that ads disappear and ordinary text and navigation remain visible. Open the popup to check the hidden-ad count.

Additional checks:

- Compare the page with the extension disabled and enabled, reloading between runs.
- Use **Restore** to bring an element back.
- Use **Not an ad**, then reload to confirm that the correction persists.
- Pause the site and reload to confirm that it remains unfiltered.
- Remove the API key and reload to confirm that the page is left unchanged.

The extension hides DOM elements; it does not perform DNS or network-level ad blocking, and it cannot remove ads embedded in a video stream.

## 6. Apply code changes

After editing extension source:

```sh
npm run build:safari
```

Rebuild and run in Xcode, then reload the Safari page. The generated project references `dist-safari/` directly by default, so a JavaScript build must be followed by an Xcode rebuild to update the packaged extension.

If Safari appears to be using old code:

1. In Xcode, choose **Product → Clean Build Folder**.
2. Build and run the app again.
3. Disable and re-enable the extension in Safari.
4. Reload the test page with Web Inspector open.

## Troubleshooting

### “Could not reach api.typesafe.ai. Check your connection.”

In the confirmed local case, the same key worked in Chrome but failed in Safari because Safari had not granted the extension access to `api.typesafe.ai`.

Open **Safari → Settings → Extensions → Jev Ad Blocker → Edit Websites**, allow the API domain, and retry **Save & test**. A manifest permission requests access; it does not replace Safari's user-granted permission.

### The key works, but no ads are hidden

Check website access for the page itself, privacy disclosure acceptance, the global enabled toggle, and site pause/exclusion settings. Reload after correcting these settings.

The confirmed cause during local testing was this diagnostic:

```text
[jev-adblock] scan status – {status: "disclosure_required", receivedResponse: true}
```

`disclosure_required` means scanning is deliberately stopped until the privacy disclosure is accepted. Enable its toggle in the extension's settings, then reload. The status should become `ok`, followed by scanning and classification logs.

### Where to find diagnostic logs

Enable Info messages in Web Inspector and look for the `[jev-adblock]` prefix.

| Inspector | What it shows |
| --- | --- |
| The test page's Web Inspector | Content-script startup, scan status, candidate counts, classification results, and sensitive-page stops |
| **Develop → Web Extension Background Content → Jev Ad Blocker**, or the extension's service worker inspector | Background startup, received messages, classification gates, cache counts, and Jev request results |

The content script emits this startup warning:

```text
[jev-adblock] diagnostics active: content script started
```

If it is absent after a reload, check the page's website permission, console filters, and whether Safari loaded the rebuilt extension. If status is `ok` but no candidates are found, the page's visible ads may not match the current discovery heuristics. If candidates are found, inspect the classification results and background request logs.

The added diagnostic logs contain counts and status information, not API keys or page text. Do not paste your API key into debugging reports.

### Cross-origin iframe errors

Safari reported errors resembling:

```text
Blocked a frame with origin "https://fuzzthepiguy.tech" from accessing a frame
with origin "https://googleads.g.doubleclick.net".
```

The scanner now skips document access for known cross-origin frames and retains a guarded access check for redirects. It still considers the iframe element itself for classification and hiding. The earlier access failures were caught; those console errors alone did not establish why blocking stopped.

## Automated checks

```sh
npm test
npm run typecheck
npm run build:safari
npx playwright install chromium
npm run e2e:safari-bundle
```

After the diagnostic and iframe changes, **49 unit tests and 9 browser tests passed**, along with type checking and the Safari bundle build. The browser suite loads the Safari-targeted bundle in Chromium with mocked Jev responses. It does not validate Safari's permission UI, signing, or runtime APIs; the manual Safari steps above cover that setup.

For optional verification using a real key, see the **Verify ad blocking** section of [README.md](README.md#verify-ad-blocking). That runner also uses Chromium and consumes API tokens.
