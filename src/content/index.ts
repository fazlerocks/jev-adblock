import { CLASSIFY_TIMEOUT_MS, COALESCE_MS, IDLE_TIMEOUT_MS, MAX_BATCHES_PER_PAGE, MAX_CANDIDATES_PER_PAGE, STORAGE_KEYS } from "../shared/constants";
import type { BackgroundToContent, ClassifyResponse, ContentToBackground, StatusResponse } from "../shared/messages";
import type { Candidate, Settings, Status } from "../shared/types";
import { findCandidates, isSensitivePage } from "./candidates";
import { describe, summarise } from "./describe";
import { Hider } from "./hider";
import { domMeasurer } from "./measure";
import { createObserver } from "./observer";
import { loadSiteRules, readGate, rulesAllowed, SiteRuleStyles } from "./siteRules";

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
  const ruleStyles = new SiteRuleStyles(host);
  let status: Status = "disabled";
  /**
   * Local privacy gate. Set whenever a scan finds a password field or payment iframe anywhere we can see.
   * It is checked on every scan and is never overwritten by the worker's status.
   */
  let sensitive = false;
  let collapseMode: Settings["collapseMode"] = "display";
  let snapEffect = true;
  let pageCount = 0;
  let batches = 0;
  let nidSeq = 0;
  let queue: { c: Candidate; el: Element }[] = [];
  let coalesceTimer: number | undefined;
  let rulesAudited = false;
  let observer: ReturnType<typeof createObserver>;

  const nextNid = () => `jb${++nidSeq}-${Math.random().toString(36).slice(2, 7)}`;

  // ---- pre-paint site rules, gated on storage alone (no worker hop) --------
  const applyGate = async () => {
    const { settings, health } = await readGate();
    collapseMode = (settings?.collapseMode ?? "display") as Settings["collapseMode"];
    snapEffect = settings?.snapEffect ?? true;
    if (rulesAllowed(host, settings, health) && !sensitive) {
      ruleStyles.apply(await loadSiteRules(host));
    } else {
      ruleStyles.clear();
    }
  };
  await applyGate();

  const refreshStatus = async (): Promise<Status> => {
    try {
      const r = (await send({ type: "get_status" })) as StatusResponse | undefined;
      status = r?.status ?? "disabled";
    } catch {
      status = "disabled";
    }
    return status;
  };

  void send({ type: "page_start" }).catch(() => undefined);
  await refreshStatus();

  const countRuleHidden = () => hider.list().filter((h) => h.source === "rule").length;
  const report = () =>
    void send({ type: "hidden_report", items: hider.list(), ruleHidden: countRuleHidden(), analysed: pageCount, sensitive }).catch(() => undefined);

  hider.onRuleRestored = (sel) => ruleStyles.disable(sel);

  const canScan = () => status === "ok" && !sensitive;

  // ---- classification --------------------------------------------------------
  const flush = async () => {
    coalesceTimer = undefined;
    if (!queue.length || !canScan() || batches >= MAX_BATCHES_PER_PAGE) {
      queue = [];
      return;
    }
    const batch = queue;
    queue = [];
    batches++;
    try {
      const res = await classify(batch.map((b) => b.c));
      if (res.error) status = res.error;
      // A page may have become sensitive while the request was in flight; if so, do not act on the answer.
      if (sensitive) return;
      for (const v of res.verdicts) {
        const item = batch.find((b) => b.c.nid === v.nid);
        if (!item || !v.hide || !item.el.isConnected) continue;
        hider.hide(v.nid, item.el, v.fp, v.label, summarise(item.c), v.source, collapseMode, snapEffect);
      }
    } catch (e) {
      console.debug("[jev-adblock] classify failed", e);
    } finally {
      report();
    }
  };

  /** One attempt only. A timeout means the worker is still retrying with backoff; re-sending would bill twice. */
  const classify = (candidates: Candidate[]): Promise<ClassifyResponse> => {
    const page = { title: document.title, lang: document.documentElement.lang || undefined };
    return Promise.race<ClassifyResponse>([
      (send({ type: "classify", candidates, page }) as Promise<ClassifyResponse | undefined>).then((r) => r ?? { verdicts: [] }),
      new Promise<ClassifyResponse>((_, rej) => setTimeout(() => rej(new Error("classify timed out")), CLASSIFY_TIMEOUT_MS)),
    ]);
  };

  const auditRules = () => {
    if (rulesAudited) return;
    rulesAudited = true;
    for (const a of ruleStyles.audit()) {
      void send({ type: "rule_feedback", fp: a.fp, sel: a.sel, matched: a.matched, stillAd: null }).catch(() => undefined);
      for (const el of a.elements) {
        seen.add(el);
        hider.trackRuleHidden(nextNid(), el, a.fp, a.sel, `${a.sel} · hidden before paint`);
      }
    }
  };

  const scan = () => {
    if (!document.body) return;
    // Privacy gate first, every time: forms hydrate late and modals open on click.
    if (isSensitivePage(document)) {
      if (!sensitive) {
        sensitive = true;
        queue = [];
        ruleStyles.clear();
        report();
      }
      return;
    }
    if (!canScan()) return;
    auditRules();
    if (pageCount >= MAX_CANDIDATES_PER_PAGE) return;

    const found = findCandidates(document, {
      measurer: domMeasurer,
      pageHost: host,
      seen,
      limit: MAX_CANDIDATES_PER_PAGE - pageCount,
      onShadowRoot: (root) => observer.watchShadowRoot(root),
    });
    for (const f of found) {
      seen.add(f.el);
      pageCount++;
      const nid = nextNid();
      queue.push({ c: describe(f.el, { nid, signals: f.signals, measurer: domMeasurer, allowSelector: !f.frameDoc }), el: f.el });
    }
    if (queue.length && coalesceTimer === undefined) coalesceTimer = window.setTimeout(() => void flush(), COALESCE_MS);
    if (!found.length) report();
  };

  const scheduleScan = () => {
    if ("requestIdleCallback" in window) (window as Window).requestIdleCallback(() => scan(), { timeout: IDLE_TIMEOUT_MS });
    else setTimeout(() => scan(), 50);
  };

  // ---- lifecycle -----------------------------------------------------------
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", scheduleScan, { once: true });
  else scheduleScan();
  window.addEventListener("load", scheduleScan, { once: true });

  // eslint-disable-next-line prefer-const
  observer = createObserver(
    () => scan(),
    () => {
      // SPA navigation: new page budget; the sensitivity gate is re-evaluated on the next scan.
      void send({ type: "page_start" }).catch(() => undefined);
      pageCount = 0;
      batches = 0;
      rulesAudited = false;
      sensitive = false;
      void refreshStatus().then(() => scheduleScan());
    },
  );
  observer.start();

  // Settings or health changed (key saved, toggles flipped, budget hit, ...): re-evaluate the gate and status.
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    if (!changes[STORAGE_KEYS.settings] && !changes[STORAGE_KEYS.health] && !changes[STORAGE_KEYS.siteRules]) return;
    const wasOk = canScan();
    void applyGate().then(refreshStatus).then(() => {
      if (canScan() && !wasOk) scheduleScan();
    });
  });

  chrome.runtime.onMessage.addListener((msg: BackgroundToContent, _sender, sendResponse) => {
    switch (msg.type) {
      case "restore_element": {
        const ok = hider.restore(msg.nid);
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
}

function send(msg: ContentToBackground): Promise<unknown> {
  return chrome.runtime.sendMessage<ContentToBackground, unknown>(msg);
}
