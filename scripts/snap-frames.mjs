// Captures frames of the snap effect on the fixture page for visual inspection.
import { chromium } from "@playwright/test";
import { createServer } from "node:http";
import { readFileSync, mkdtempSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const DIST = join(process.cwd(), "dist");
const OUT = process.argv[2] ?? join(process.cwd(), "test-results/snap");
mkdirSync(OUT, { recursive: true });
const FIXTURE = readFileSync(join(process.cwd(), "test/fixtures/ads.html"), "utf8");
const server = createServer((req, res) => { res.writeHead(200, { "content-type": "text/html" }); res.end(req.url.startsWith("/ads") ? FIXTURE : "<body style='margin:0;background:#dfe6f3;height:100vh'></body>"); });
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const origin = `http://127.0.0.1:${server.address().port}`;
const ctx = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), "jevsnap-")), { headless: true, channel: "chromium", viewport: { width: 1280, height: 900 }, recordVideo: { dir: OUT, size: { width: 1280, height: 900 } }, args: [`--disable-extensions-except=${DIST}`, `--load-extension=${DIST}`, "--headless=new"] });
await ctx.route("https://api.typesafe.ai/**", async (route) => {
  const body = route.request().postDataJSON(); const answers = {};
  body.state.candidates.forEach((c, i) => { const ad = /googlesyndication|doubleclick/.test(c.iframe_host ?? "") || c.rel_sponsored; answers[`c${i}`] = { type: "choice", choice: ad ? "display_ad" : "site_content", probabilities: ad ? { display_ad: 0.94, site_content: 0.06 } : { site_content: 0.9, site_ui: 0.1 }, confidence: 0.92 }; });
  await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ model: "jev-1.13.0", answers, usage: { input_tokens: 9800, output_tokens: 0 } }) });
});
await ctx.route(/^https:\/\/(safeframe|ads\.|www\.youtube|newassets\.hcaptcha|shop\.|betco)/, (r) => r.fulfill({ status: 200, contentType: "text/html", body: "<body style='margin:0;background:linear-gradient(135deg,#f2481f,#ffb199);height:100vh;font:700 28px sans-serif;color:#fff;display:flex;align-items:center;justify-content:center'>AD</body>" }));
let [sw] = ctx.serviceWorkers(); if (!sw) sw = await ctx.waitForEvent("serviceworker");
await sw.evaluate(async () => chrome.storage.local.set({ apiKey: "sk-demo", settings: { model: "jev-latest", enabled: true, pausedHosts: [], neverAnalyzeHosts: [], thresholds: { display_ad: 0.7, sponsored_native: 0.8, consent_or_popup: 0.85 }, hideConsentPopups: false, hideFirstPartyPromo: false, collapseMode: "display", snapEffect: true, dailyTokenBudget: 5000000, disclosureAccepted: true } }));
const page = await ctx.newPage();
const pageCreated = Date.now();
await page.goto(`${origin}/ads.html`);
// Poll until the animation starts, then grab frames.
let started = 0;
for (let i = 0; i < 60; i++) {
  const snapping = await page.evaluate(() => document.querySelectorAll("[data-jb-snapping]").length);
  if (snapping) { started = Date.now(); break; }
  await page.waitForTimeout(50);
}
if (!started) { console.log("snap never started"); await ctx.close(); server.close(); process.exit(1); }
for (const ms of [0, 250, 500, 750, 1000, 1400]) {
  const wait = started + ms - Date.now();
  if (wait > 0) await page.waitForTimeout(wait);
  await page.screenshot({ path: join(OUT, `frame-${String(ms).padStart(4, "0")}.png`), clip: { x: 80, y: 300, width: 1200, height: 600 } });
}
console.log("hidden after:", await page.evaluate(() => [...document.querySelectorAll("[data-jb-hidden]")].map((e) => e.id)));
await page.waitForTimeout(800);
const video = page.video();
await ctx.close(); server.close();
const videoPath = await video.path();
const offset = Math.max(0, (started - pageCreated) / 1000 - 0.15);
const { execSync } = await import("node:child_process");
execSync(`ffmpeg -y -loglevel error -ss ${offset.toFixed(2)} -t 1.6 -i "${videoPath}" -vf "fps=10,crop=1200:600:80:300,scale=600:-1,tile=4x4:padding=4:color=white" "${join(OUT, "sheet.png")}"`);
console.log("sheet:", join(OUT, "sheet.png"), "offset", offset.toFixed(2));
