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
const ctx = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), "jevsnap-")), { headless: true, channel: "chromium", viewport: { width: 1280, height: 900 }, args: [`--disable-extensions-except=${DIST}`, `--load-extension=${DIST}`, "--headless=new"] });
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
// Poll until the animation starts, then screenshot as fast as possible until it ends.
const clip = { x: 80, y: 300, width: 1200, height: 600 };
let started = 0;
for (let i = 0; i < 150; i++) {
  if (await page.evaluate(() => document.querySelectorAll("[data-jb-snapping]").length)) { started = Date.now(); break; }
  await page.waitForTimeout(20);
}
if (!started) { console.log("snap never started"); await ctx.close(); server.close(); process.exit(1); }
const { execSync } = await import("node:child_process");
const { rmSync } = await import("node:fs");
let n = 0;
let tail = 0;
while (tail < 4 && n < 60) {
  await page.screenshot({ path: join(OUT, `frame-${String(n).padStart(3, "0")}.png`), clip, animations: "allow", caret: "hide" });
  n++;
  const active = await page.evaluate(() => document.querySelectorAll("[data-jb-snapping]").length);
  if (!active) tail++;
}
console.log("hidden after:", await page.evaluate(() => [...document.querySelectorAll("[data-jb-hidden]")].map((e) => e.id)), "frames:", n);
await ctx.close(); server.close();
// GIF with a generated palette (keeps greys grey) and a contact sheet.
execSync(`ffmpeg -y -loglevel error -framerate 8 -i "${join(OUT, "frame-%03d.png")}" -vf "scale=720:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=128:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=3" -loop 0 "${join(OUT, "snap.gif")}"`);
execSync(`ffmpeg -y -loglevel error -framerate 8 -i "${join(OUT, "frame-%03d.png")}" -vf "scale=600:-1,tile=4x3:padding=4:color=white" -frames:v 1 "${join(OUT, "sheet.png")}"`);
console.log("gif:", join(OUT, "snap.gif"));
