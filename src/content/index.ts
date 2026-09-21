import { CLASSIFY_TIMEOUT_MS, COALESCE_MS, IDLE_TIMEOUT_MS, MAX_BATCHES_PER_PAGE, MAX_CANDIDATES_PER_PAGE, STORAGE_KEYS } from "../shared/constants";
import type { BackgroundToContent, ClassifyResponse, ContentToBackground, StatusResponse } from "../shared/messages";
import type { Candidate, Settings, SiteRule, Status } from "../shared/types";
import { findCandidates, isSensitivePage } from "./candidates";
import { describe, summarise } from "./describe";
import { Hider } from "./hider";
import { domMeasurer } from "./measure";
import { createObserver } from "./observer";
import { auditSiteRules, injectSiteRules } from "./siteRules";

// Guard against double injection (manifest + programmatic injection on install).
const FLAG = "__jevAdblockLoaded";
if (!(window as unknown as Record<string, boolean>)[FLAG]) {
  (window as unknown as Record<string, boolean>)[FLAG] = true;
  void main();
}

async function main(): Promise<void> {
  if (window.top !== window) return; // top frame only; same-origin frames are reached from the parent
  const host = location.hostname;
  if (!host) return;

  const hider = new Hider();
  const seen = new WeakSet<Element>();
  const nidToEl = new Map<string, Element>();
  let status: Status = "disabled";
  let siteRules: SiteRule[] = [];
  let collapseMode: Settings["collapseMode"] = "display";
  let snapEffect = true;
  let pageCount = 0;
  let batches = 0;
  let nidSeq = 0;
  let queue: { c: Candidate; el: Element }[] = [];
  let coalesceTimer: number | undefined;
  let inflight = 0;
  let scannedOnce = false;
  let sensitive = false;

  // ---- flash prevention: materialised site rules, before first paint ----
  siteRules = await injectSiteRules(host);

  const refreshStatus = async (): Promise<Status> => {
    try {
      const r = (await send({ type: "get_status" })) as StatusResponse | undefined;
      status = r?.status ?? "disabled";
    } catch {
      status = "disabled";
    }
    try {
      const s = await chrome.storage.local.get(STORAGE_KEYS.settings);
      const st = s[STORAGE_KEYS.settings] as Partial<Settings> | undefined;
      collapseMode = (st?.collapseMode ?? "display") as Settings["collapseMode"];
      snapEffect = st?.snapEffect ?? true;
    } catch {
      /* ignore */
    }
    return status;
  };

  void send({ type: "page_start" }).catch(() => undefined);
  await refreshStatus();

  const report = () =>
    void send({ type: "hidden_report", items: hider.list(), ruleHidden: countRuleHidden(), analysed: pageCount, sensitive }).catch(() => undefined);

  const countRuleHidden = () => document.querySelectorAll('[data-jb-hidden="rule"]').length;

  const nextNid = () => `jb${++nidSeq}-${Math.random().toString(36).slice(2, 7)}`;

  const flush = async () => {
    coalesceTimer = undefined;
    if (!queue.length || status !== "ok") {
      queue = [];
      return;
    }
    if (batches >= MAX_BATCHES_PER_PAGE) {
      queue = [];
      return;
    }
    const batch = queue;
    queue = [];
    batches++;
    inflight++;
    try {
      const res = await classify(batch.map((b) => b.c));
      if (res.error) {
        status = res.error;
      }
      for (const v of res.verdicts) {
        const item = batch.find((b) => b.c.nid === v.nid);
        if (!item || !v.hide) continue;
        if (!item.el.isConnected) continue;
        // Cached decisions apply silently; only fresh Jev verdicts get the snap so the page settles fast on repeat visits.
        hider.hide(v.nid, item.el, v.fp, v.label, summarise(item.c), v.source, collapseMode, snapEffect && v.source === "jev");
      }
    } catch (e) {
      console.debug("[jev-adblock] classify failed", e);
    } finally {
      inflight--;
      report();
    }
  };

  const classify = async (candidates: Candidate[]): Promise<ClassifyResponse> => {
    const page = { title: document.title, lang: document.documentElement.lang || undefined };
    const attempt = () =>
      Promise.race<ClassifyResponse>([
        send({ type: "classify", candidates, page }) as Promise<ClassifyResponse>,
        new Promise<ClassifyResponse>((_, rej) => setTimeout(() => rej(new Error("timeout")), CLASSIFY_TIMEOUT_MS)),
      ]);
    try {
      const r = await attempt();
      if (!r) throw new Error("empty response");
      return r;
    } catch {
      const r = await attempt();
      return r ?? { verdicts: [] };
    }
  };

  const scan = (roots?: Element[]) => {
    if (status !== "ok") return;
    if (!document.body) return;
    if (!scannedOnce) {
      scannedOnce = true;
      sensitive = isSensitivePage(document);
      if (sensitive) {
        status = "sensitive_page";
        report();
        return;
      }
      // Audit materialised rules now that the DOM exists.
      for (const a of auditSiteRules(siteRules)) {
        void send({ type: "rule_feedback", fp: a.fp, sel: a.sel, matched: a.matched, stillAd: null }).catch(() => undefined);
      }
    }
    if (pageCount >= MAX_CANDIDATES_PER_PAGE) return;

    // When roots are supplied (mutations), scanning the whole document is still cheapest and dedupes via `seen`.
    void roots;
    const found = findCandidates(document, { measurer: domMeasurer, pageHost: host, seen, limit: MAX_CANDIDATES_PER_PAGE - pageCount });
    for (const f of found) {
      seen.add(f.el);
      pageCount++;
      const nid = nextNid();
      const c = describe(f.el, { nid, signals: f.signals, measurer: domMeasurer, allowSelector: !f.frameDoc });
      nidToEl.set(nid, f.el);
      queue.push({ c, el: f.el });
    }
    if (queue.length && coalesceTimer === undefined) coalesceTimer = window.setTimeout(() => void flush(), COALESCE_MS);
    if (!found.length) report();
  };

  const scheduleScan = () => {
    const run = () => scan();
    if ("requestIdleCallback" in window) (window as Window).requestIdleCallback(run, { timeout: IDLE_TIMEOUT_MS });
    else setTimeout(run, 50);
  };

  // ---- lifecycle -------------------------------------------------------
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", scheduleScan, { once: true });
  else scheduleScan();
  window.addEventListener("load", scheduleScan, { once: true });

  const observer = createObserver(
    (roots) => scan(roots),
    () => {
      // SPA navigation: new page budget, keep what is hidden.
      void send({ type: "page_start" }).catch(() => undefined);
      pageCount = 0;
      batches = 0;
      scannedOnce = false;
      void refreshStatus().then(() => scheduleScan());
    },
  );
  observer.start();

  // Re-arm when the key or settings change (e.g. user just pasted a key in options).
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    if (changes[STORAGE_KEYS.settings] || changes[STORAGE_KEYS.health]) {
      const wasOk = status === "ok";
      void refreshStatus().then((s) => {
        if (s === "ok" && !wasOk) scheduleScan();
      });
    }
  });

  chrome.runtime.onMessage.addListener((msg: BackgroundToContent, _sender, sendResponse) => {
    switch (msg.type) {
      case "restore_element": {
        const ok = hider.restore(msg.nid);
        if (!ok) {
          // Rule-hidden element: nothing in registry; try attribute lookup.
          const el = nidToEl.get(msg.nid);
          el?.removeAttribute("data-jb-hidden");
        }
        void send({ type: "restored", nids: [msg.nid] }).catch(() => undefined);
        report();
        sendResponse({ ok });
        break;
      }
      case "restore_fp": {
        const nids = hider.restoreByFp(msg.fp);
        if (nids.length) void send({ type: "restored", nids }).catch(() => undefined);
        report();
        sendResponse({ ok: true, nids });
        break;
      }
      case "rescan": {
        void refreshStatus().then(() => scheduleScan());
        sendResponse({ ok: true });
        break;
      }
    }
    return false;
  });

  void inflight;
}

function send(msg: ContentToBackground): Promise<unknown> {
  return chrome.runtime.sendMessage<ContentToBackground, unknown>(msg);
}
