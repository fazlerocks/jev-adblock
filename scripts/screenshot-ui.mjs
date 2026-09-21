import { chromium } from "@playwright/test";
import { createServer } from "node:http";
import { readFileSync, mkdtempSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const DIST = join(process.cwd(), "dist");
const OUT = process.argv[2] ?? join(process.cwd(), "test-results");
mkdirSync(OUT, { recursive: true });
const FIXTURE = readFileSync(join(process.cwd(), "test/fixtures/ads.html"), "utf8");
const server = createServer((req, res) => { res.writeHead(200, { "content-type": "text/html" }); res.end(req.url.startsWith("/ads") ? FIXTURE : "<body></body>"); });
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const origin = `http://127.0.0.1:${server.address().port}`;
const ctx = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), "jevui-")), { headless: true, channel: "chromium", args: [`--disable-extensions-except=${DIST}`, `--load-extension=${DIST}`, "--headless=new"] });
const errors = [];
await ctx.route("https://api.typesafe.ai/**", async (route) => {
  if (route.request().url().endsWith("/v1/models")) return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([{ name: "jev-latest" }, { name: "jev-1.13.0" }]) });
  const body = route.request().postDataJSON(); const answers = {};
  body.state.candidates.forEach((c, i) => { const ad = /googlesyndication|doubleclick/.test(c.iframe_host ?? "") || c.rel_sponsored; answers[`c${i}`] = { type: "choice", choice: ad ? "display_ad" : "site_content", probabilities: ad ? { display_ad: 0.94, site_content: 0.06 } : { site_content: 0.9, site_ui: 0.1 }, confidence: 0.92 }; });
  await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ model: "jev-1.13.0", answers, usage: { input_tokens: 9800, output_tokens: 0 } }) });
});
await ctx.route(/^https:\/\/(safeframe|ads\.|www\.youtube|newassets\.hcaptcha|shop\.|betco)/, (r) => r.fulfill({ status: 200, contentType: "text/html", body: "<body></body>" }));
let [sw] = ctx.serviceWorkers(); if (!sw) sw = await ctx.waitForEvent("serviceworker");
const extId = new URL(sw.url()).host;
await sw.evaluate(async () => chrome.storage.local.set({ apiKey: "sk-demo", settings: { model: "jev-latest", enabled: true, pausedHosts: [], neverAnalyzeHosts: [], thresholds: { display_ad: 0.7, sponsored_native: 0.8, consent_or_popup: 0.85 }, hideConsentPopups: false, hideFirstPartyPromo: false, collapseMode: "display", snapEffect: false, dailyTokenBudget: 5000000, disclosureAccepted: true } }));

const page = await ctx.newPage();
page.on("pageerror", (e) => errors.push("fixture: " + e.message));
await page.goto(`${origin}/ads.html`); await page.waitForTimeout(2500);
await page.screenshot({ path: join(OUT, "fixture-after.png"), fullPage: false });

// The popup queries the active tab; make the fixture tab active and open popup.html in its own page.
await page.bringToFront();
const popup = await ctx.newPage();
popup.on("pageerror", (e) => errors.push("popup: " + e.message));
popup.on("console", (m) => { if (m.type() === "error") errors.push("popup console: " + m.text()); });
// chrome.tabs.query({active, currentWindow}) from an extension page in a tab returns that page itself; patch by pointing the popup at the fixture tab id.
const tabId = await sw.evaluate(async (url) => (await chrome.tabs.query({ url }))[0].id, `${origin}/ads.html`);
await popup.addInitScript((tabId) => { const q = chrome.tabs.query.bind(chrome.tabs); chrome.tabs.query = async (info) => info?.active ? [{ id: tabId }] : q(info); }, tabId);
await popup.setViewportSize({ width: 400, height: 640 });
await popup.goto(`chrome-extension://${extId}/popup/popup.html`); await popup.waitForTimeout(800);
await popup.screenshot({ path: join(OUT, "popup.png") });
console.log("popup text:", (await popup.innerText("body")).replace(/\s+/g, " ").slice(0, 400));

const options = await ctx.newPage();
options.on("pageerror", (e) => errors.push("options: " + e.message));
options.on("console", (m) => { if (m.type() === "error") errors.push("options console: " + m.text()); });
await options.setViewportSize({ width: 1040, height: 1200 });
await options.goto(`chrome-extension://${extId}/options/options.html`); await options.waitForTimeout(500);
await options.click("#saveKey"); await options.waitForTimeout(800);
console.log("key status:", await options.innerText("#keyStatus"));
await options.screenshot({ path: join(OUT, "options.png"), fullPage: true });

console.log("errors:", errors.length ? errors : "none");
await ctx.close(); server.close();
