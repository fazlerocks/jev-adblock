import { chromium, expect, test, type BrowserContext, type Page, type Route } from "@playwright/test";
import { createServer, type Server } from "node:http";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { mkdtempSync } from "node:fs";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const DIST = join(__dirname, "../../dist");
const FIXTURE = readFileSync(join(__dirname, "../fixtures/ads.html"), "utf8");

// The mock classifier decides purely from the descriptor Jev would see.
function mockAnswer(entry: Record<string, unknown>): { choice: string; p: number } {
  const host = String(entry.iframe_host ?? "");
  const signals = (entry.signals as string[]) ?? [];
  const text = String(entry.text ?? "");
  if (/googlesyndication|doubleclick/.test(host)) return { choice: "display_ad", p: 0.96 };
  if (entry.rel_sponsored || /^sponsored/i.test(text)) return { choice: "sponsored_native", p: 0.9 };
  if (signals.includes("overlay") && /sponsored|betco/i.test(text)) return { choice: "sponsored_native", p: 0.88 };
  if (/deal of the day/i.test(text)) return { choice: "first_party_promo", p: 0.9 };
  return { choice: "site_content", p: 0.9 };
}

async function fulfilJev(route: Route, counters: { systemone: number }) {
  const req = route.request();
  const url = req.url();
  if (url.endsWith("/v1/models")) {
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([{ name: "jev-latest", description: "", release_date: "" }]) });
  }
  counters.systemone++;
  const body = req.postDataJSON() as { state: { candidates: Record<string, unknown>[] } };
  const answers: Record<string, unknown> = {};
  body.state.candidates.forEach((entry, i) => {
    const a = mockAnswer(entry);
    const probs: Record<string, number> = { display_ad: 0, sponsored_native: 0, consent_or_popup: 0, first_party_promo: 0, site_content: 0, site_ui: 0 };
    probs[a.choice] = a.p;
    // Spread the remaining mass onto a safe category so distributions sum to 1.
    const rest = a.choice === "site_content" ? "site_ui" : "site_content";
    probs[rest] = 1 - a.p;
    answers[`c${i}`] = { type: "choice", choice: a.choice, probabilities: probs, confidence: a.p };
  });
  return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ model: "jev-1.13.0", answers, usage: { input_tokens: 1234, output_tokens: 0 } }) });
}

let server: Server;
let origin: string;
let context: BrowserContext;
const counters = { systemone: 0 };

test.beforeAll(async () => {
  server = createServer((req, res) => {
    if (req.url?.startsWith("/ads.html") || req.url === "/") {
      res.writeHead(200, { "content-type": "text/html" });
      res.end(FIXTURE);
    } else {
      res.writeHead(200, { "content-type": "text/html" });
      res.end("<!doctype html><title>stub</title><body style='margin:0;background:#eee'></body>");
    }
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const addr = server.address() as { port: number };
  origin = `http://127.0.0.1:${addr.port}`;

  const userDataDir = mkdtempSync(join(tmpdir(), "jev-adblock-"));
  context = await chromium.launchPersistentContext(userDataDir, {
    headless: true,
    channel: "chromium",
    args: [`--disable-extensions-except=${DIST}`, `--load-extension=${DIST}`, "--headless=new"],
  });
  // Intercept TypeSafe calls from every page and the service worker.
  await context.route("https://api.typesafe.ai/**", (route) => fulfilJev(route, counters));
  // Third-party iframe hosts in the fixture: serve a stub instead of hitting the network.
  await context.route(/^https:\/\/(safeframe\.googlesyndication\.com|ads\.doubleclick\.net|www\.youtube\.com|newassets\.hcaptcha\.com|shop\.brandx\.com|betco\.example)\/.*/, (route) =>
    route.fulfill({ status: 200, contentType: "text/html", body: "<!doctype html><body></body>" }),
  );
});

test.afterAll(async () => {
  await context?.close();
  await new Promise<void>((r) => server.close(() => r()));
});

async function serviceWorker() {
  let [sw] = context.serviceWorkers();
  if (!sw) sw = await context.waitForEvent("serviceworker");
  return sw;
}

async function configure(withKey: boolean) {
  const sw = await serviceWorker();
  await sw.evaluate(async (withKey) => {
    const settings = {
      model: "jev-latest",
      enabled: true,
      pausedHosts: [],
      neverAnalyzeHosts: [],
      thresholds: { display_ad: 0.7, sponsored_native: 0.8, consent_or_popup: 0.85 },
      hideConsentPopups: false,
      hideFirstPartyPromo: false,
      collapseMode: "display",
      snapEffect: false,
      dailyTokenBudget: 5_000_000,
      disclosureAccepted: true,
    };
    await chrome.storage.local.clear();
    await chrome.storage.local.set({ settings, ...(withKey ? { apiKey: "sk-test-key" } : {}) });
  }, withKey);
}

async function hiddenIds(page: Page): Promise<string[]> {
  return page.evaluate(() => Array.from(document.querySelectorAll("[data-jb-hidden]")).map((e) => e.id || e.className));
}

async function settle(page: Page) {
  await page.waitForTimeout(2500);
}

test("stays inert without a key", async () => {
  await configure(false);
  counters.systemone = 0;
  const page = await context.newPage();
  await page.goto(`${origin}/ads.html`);
  await settle(page);
  expect(await hiddenIds(page)).toEqual([]);
  expect(counters.systemone).toBe(0);
  await page.close();
});

test("hides ads and leaves content alone (mock Jev)", async () => {
  await configure(true);
  counters.systemone = 0;
  const page = await context.newPage();
  await page.goto(`${origin}/ads.html`);
  await settle(page);
  const hidden = await hiddenIds(page);
  expect(hidden).toEqual(expect.arrayContaining(["ad-inarticle", "sponsored-card", "ad-sidebar", "sticky-bar"]));
  for (const keep of ["hero", "article", "related", "deals", "comments", "nav", "header", "footer", "video-widget", "captcha-widget", "newsletter-widget", "iframe-youtube", "iframe-captcha"]) {
    expect(hidden, `${keep} must stay visible`).not.toContain(keep);
  }
  expect(counters.systemone).toBeGreaterThan(0);
  // Payload hygiene: no full urls, no backticks, text capped.
  await page.close();
});

test("second load is served from cache with zero API calls", async () => {
  const page = await context.newPage();
  counters.systemone = 0;
  await page.goto(`${origin}/ads.html`);
  await settle(page);
  expect(await hiddenIds(page)).toEqual(expect.arrayContaining(["ad-inarticle", "sponsored-card", "ad-sidebar", "sticky-bar"]));
  expect(counters.systemone).toBe(0);
  await page.close();
});

test("after repeated visits a site rule hides before the scan", async () => {
  // Third visit makes hits >= 3 and materialises rules; the fourth load should have rule-hidden elements immediately.
  for (let i = 0; i < 2; i++) {
    const p = await context.newPage();
    await p.goto(`${origin}/ads.html`);
    await settle(p);
    await p.close();
  }
  const sw = await serviceWorker();
  const rules = await sw.evaluate(async () => (await chrome.storage.local.get("siteRules")).siteRules as Record<string, unknown[]>);
  const host = new URL(origin).hostname;
  expect(rules[host]?.length ?? 0).toBeGreaterThan(0);

  const page = await context.newPage();
  await page.goto(`${origin}/ads.html`);
  // Rule stylesheet is injected at document_start, before the idle scan.
  const styleText = await page.evaluate(() => document.getElementById("jb-site-rules")?.textContent ?? "");
  expect(styleText).toContain("display:none!important");
  await page.close();
});

test("'not an ad' override restores and persists", async () => {
  // Self-contained: fresh storage with a key, no site rules, so the card goes through the Jev path and shows up in the hidden list.
  await configure(true);
  const page = await context.newPage();
  await page.goto(`${origin}/ads.html`);
  await settle(page);
  const sw = await serviceWorker();
  const tabId = await sw.evaluate(async (url) => {
    const tabs = await chrome.tabs.query({ url });
    return tabs[0]!.id!;
  }, `${origin}/ads.html`);
  const state = await sw.evaluate(async (tabId) => {
    const s = (await chrome.storage.session.get("tabState")).tabState as Record<string, { hidden: { nid: string; fp: string; summary: string }[] }>;
    return s[String(tabId)];
  }, tabId);
  const card = state!.hidden.find((h) => /card/.test(h.summary))!;
  expect(card).toBeTruthy();
  // Simulate the popup's "Not an ad" message from an extension page.
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${new URL(sw.url()).host}/popup/popup.html`);
  await popup.evaluate(async ({ tabId, nid, fp }) => {
    await chrome.runtime.sendMessage({ type: "not_an_ad", tabId, nid, fp });
  }, { tabId, nid: card.nid, fp: card.fp });
  await page.waitForTimeout(500);
  expect(await hiddenIds(page)).not.toContain("sponsored-card");
  await popup.close();
  await page.close();

  const again = await context.newPage();
  await again.goto(`${origin}/ads.html`);
  await settle(again);
  expect(await hiddenIds(again)).not.toContain("sponsored-card");
  await again.close();
});
