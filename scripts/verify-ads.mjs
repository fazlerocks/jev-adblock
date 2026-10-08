import { chromium } from "@playwright/test";
import { mkdtemp, readFile, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";

// Live tests use the real model and a disposable profile. Nothing is injected
// into the page to simulate extension behavior.
const configPath = process.argv[2] ?? "test/sites/pihole.json";
const sites = JSON.parse(await readFile(configPath, "utf8"));
if (!Array.isArray(sites) || !sites.length) throw new Error("Site configuration must be a nonempty array.");
for (const site of sites) {
  if (!site.url || !Array.isArray(site.ads) || !site.ads.length || !Array.isArray(site.keep) || !site.keep.length) {
    throw new Error("Each site needs url, ads selectors and keep selectors.");
  }
  new URL(site.url);
}
const apiKey = process.env.JEV_API_KEY;
if (!apiKey) throw new Error("Set JEV_API_KEY to run real-model verification.");
const output = resolve("test-results/live-ads");
await mkdir(output, { recursive: true });
const profile = await mkdtemp(join(tmpdir(), "jev-verify-"));
let context;
const results = [];
try {
  const extension = resolve("dist-safari");
  context = await chromium.launchPersistentContext(profile, {
    channel: "chromium", headless: !process.env.HEADED,
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  });
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent("serviceworker");
  await worker.evaluate(async (key) => {
    await chrome.storage.local.clear();
    await chrome.storage.local.set({
      apiKey: key,
      settings: { disclosureAccepted: true, snapEffect: false },
      health: { hasKey: true, keyInvalid: false, consecutiveFailures: 0, circuitOpenUntil: 0, offline: false, keyUpdatedAt: Date.now() },
    });
  }, apiKey);
  for (const [index, site] of sites.entries()) {
    const page = await context.newPage();
    const result = { url: site.url, passed: false };
    try {
      // The disabled run proves ads exist on this network and selectors still
      // match. DNS filtering or a changed site cannot silently count as success.
      await worker.evaluate(() => chrome.storage.local.set({ settings: { disclosureAccepted: true, enabled: false, snapEffect: false } }));
      await page.goto(site.url, { waitUntil: "domcontentloaded", timeout: 60000 });
      await page.waitForTimeout(site.waitMs ?? 10000);
      const counts = [];
      for (const selector of site.ads) {
        const count = await page.locator(selector).count();
        let visible = 0;
        for (const node of await page.locator(selector).all()) if (await node.isVisible()) visible++;
        counts.push({ selector, count, visible });
        if (!visible) throw new Error(`Baseline has no visible ad matching ${selector}; inconclusive, check DNS and selectors.`);
      }
      result.baseline = counts;
      await page.screenshot({ path: join(output, `${index}-before.png`), fullPage: true });
      await worker.evaluate(() => chrome.storage.local.set({ settings: { disclosureAccepted: true, enabled: true, snapEffect: false } }));
      await page.reload({ waitUntil: "domcontentloaded" });
      await page.waitForFunction((selectors) => selectors.every((selector) => {
        const nodes = [...document.querySelectorAll(selector)];
        return nodes.length > 0 && nodes.every((node) => {
          const marked = node.closest("[data-jb-hidden]");
          if (!marked) return false;
          const style = getComputedStyle(marked);
          return style.display === "none" || style.visibility === "hidden";
        });
      }), site.ads, { timeout: site.timeoutMs ?? 45000 });
      for (const selector of site.keep) {
        const nodes = await page.locator(selector).all();
        if (!nodes.length) throw new Error(`Content selector missing: ${selector}`);
        for (const node of nodes) if (!(await node.isVisible())) throw new Error(`Content hidden: ${selector}`);
      }
      result.hidden = await page.locator("[data-jb-hidden]").count();
      result.passed = true;
    } catch (error) {
      result.error = error.message;
    } finally {
      await page.screenshot({ path: join(output, `${index}-after.png`), fullPage: true }).catch(() => {});
      await page.close();
    }
    results.push(result);
    console.log(`${result.passed ? "PASS" : "FAIL"} ${site.url}${result.error ? `: ${result.error}` : ""}`);
  }
} finally {
  await context?.close();
  await rm(profile, { recursive: true, force: true });
  await writeFile(join(output, "report.json"), JSON.stringify(results, null, 2) + "\n");
}
if (!results.length || results.some((result) => !result.passed)) process.exitCode = 1;
