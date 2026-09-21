import { chromium } from "@playwright/test";
import { createServer } from "node:http";
import { readFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const DIST = join(process.cwd(), "dist");
const FIXTURE = readFileSync(join(process.cwd(), "test/fixtures/ads.html"), "utf8");
const server = createServer((req, res) => { res.writeHead(200, { "content-type": "text/html" }); res.end(req.url.startsWith("/ads") ? FIXTURE : "<body></body>"); });
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const origin = `http://127.0.0.1:${server.address().port}`;
const ctx = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), "jevdbg-")), { headless: true, channel: "chromium", args: [`--disable-extensions-except=${DIST}`, `--load-extension=${DIST}`, "--headless=new"] });
let apiCalls = 0;
await ctx.route("https://api.typesafe.ai/**", async (route) => {
  apiCalls++;
  const body = route.request().postDataJSON();
  console.log("API CALL candidates:", body.state.candidates.length, JSON.stringify(body.state.candidates.map(c=>({tag:c.tag,size:c.size,host:c.iframe_host,sig:c.signals,text:(c.text||"").slice(0,30)}))));
  const answers = {};
  body.state.candidates.forEach((c, i) => { answers[`c${i}`] = { type: "choice", choice: "display_ad", probabilities: { display_ad: 0.95, site_content: 0.05 }, confidence: 0.95 }; });
  await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ model: "jev", answers, usage: { input_tokens: 10, output_tokens: 0 } }) });
});
await ctx.route(/^https:\/\/(safeframe|ads\.|www\.youtube|newassets\.hcaptcha|shop\.|betco)/, (r) => r.fulfill({ status: 200, contentType: "text/html", body: "<body></body>" }));
let [sw] = ctx.serviceWorkers(); if (!sw) sw = await ctx.waitForEvent("serviceworker");
sw.on("console", (m) => console.log("SW:", m.text()));
await sw.evaluate(async () => { await chrome.storage.local.set({ apiKey: "sk-test", settings: { model: "jev-latest", enabled: true, pausedHosts: [], neverAnalyzeHosts: [], thresholds: { display_ad: 0.7, sponsored_native: 0.8, consent_or_popup: 0.85 }, hideConsentPopups: false, hideFirstPartyPromo: false, collapseMode: "display", snapEffect: false, dailyTokenBudget: 5000000, disclosureAccepted: true } }); });
const page = await ctx.newPage();
page.on("console", (m) => console.log("PAGE:", m.type(), m.text()));
page.on("pageerror", (e) => console.log("PAGEERR:", e.message));
await page.goto(`${origin}/ads.html`);
await page.waitForTimeout(3000);
console.log("apiCalls", apiCalls);
const probe = await sw.evaluate(async (url) => {
  const [tab] = await chrome.tabs.query({ url });
  const out = { tabId: tab?.id, tabUrl: tab?.url };
  try { out.ping = await chrome.tabs.sendMessage(tab.id, { type: "rescan" }); } catch (e) { out.pingErr = String(e); }
  try { const r = await chrome.scripting.executeScript({ target: { tabId: tab.id }, world: "ISOLATED", func: () => ({ flag: window.__jevAdblockLoaded, tagged: document.querySelectorAll("[data-jb-id]").length, ready: document.readyState }) }); out.iso = r[0]?.result; } catch (e) { out.isoErr = String(e); }
  return out;
}, `${origin}/ads.html`);
console.log("probe", JSON.stringify(probe));
console.log("loaded flag", await page.evaluate(() => window.__jevAdblockLoaded));
console.log("hidden", await page.evaluate(() => [...document.querySelectorAll("[data-jb-hidden]")].map((e) => e.id)));
console.log("storage", JSON.stringify(await sw.evaluate(async () => ({ local: await chrome.storage.local.get(null), session: await chrome.storage.session.get(null) })), null, 0).slice(0, 1500));
await ctx.close(); server.close();
