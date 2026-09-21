import { USD_PER_MILLION_INPUT_TOKENS } from "../shared/constants";
import { icon, mountIcons, type IconName } from "../shared/icons";
import { sendToBackground, type TabStateResponse } from "../shared/messages";
import type { Category, Status } from "../shared/types";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const LABELS: Record<Category, string> = {
  display_ad: "Display ad",
  sponsored_native: "Sponsored",
  consent_or_popup: "Popup",
  first_party_promo: "Site promo",
  site_content: "Content",
  site_ui: "UI",
};

interface Notice {
  text: string;
  tone: "warn" | "error" | "ok" | "neutral";
  icon: IconName;
  action?: { label: string; run: () => void };
}

const openSettings = () => void chrome.runtime.openOptionsPage();

function noticeFor(status: Status): Notice | null {
  switch (status) {
    case "no_key":
      return { text: "Add your TypeSafe API key to start blocking ads.", tone: "warn", icon: "key", action: { label: "Add key", run: openSettings } };
    case "disclosure_required":
      return { text: "Review what leaves your browser and accept the disclosure.", tone: "warn", icon: "info", action: { label: "Review", run: openSettings } };
    case "invalid_key":
      return { text: "The API rejected your key.", tone: "error", icon: "alert", action: { label: "Check key", run: openSettings } };
    case "budget_exhausted":
      return { text: "Daily token budget reached. Resumes tomorrow.", tone: "error", icon: "wallet", action: { label: "Raise budget", run: openSettings } };
    case "circuit_open":
      return { text: "TypeSafe API failed repeatedly. Paused for a few minutes.", tone: "error", icon: "alert" };
    case "offline":
      return { text: "Could not reach api.typesafe.ai.", tone: "error", icon: "wifiOff" };
    case "sensitive_page":
      return { text: "Not analysed: this page has a password or payment field.", tone: "neutral", icon: "lock" };
    case "never_analyze":
      return { text: "This site is on your never-analyse list.", tone: "neutral", icon: "ban" };
    case "paused":
      return { text: "Paused on this site.", tone: "neutral", icon: "pause" };
    case "disabled":
      return { text: "Jev Ad Blocker is turned off.", tone: "neutral", icon: "shieldOff" };
    default:
      return null;
  }
}

async function currentTabId(): Promise<number | undefined> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab?.id;
}

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(2) + "M";
  if (n >= 1000) return (n / 1000).toFixed(1) + "k";
  return String(n);
}
function fmtUsd(tokens: number): string {
  const usd = (tokens / 1_000_000) * USD_PER_MILLION_INPUT_TOKENS;
  if (usd === 0) return "$0";
  if (usd < 0.001) return "<$0.001";
  return "$" + usd.toFixed(usd < 0.01 ? 4 : 3);
}

function iconButton(name: IconName, title: string, danger = false): HTMLButtonElement {
  const b = document.createElement("button");
  b.className = "btn icon" + (danger ? " danger" : "");
  b.type = "button";
  b.title = title;
  b.setAttribute("aria-label", title);
  b.innerHTML = icon(name, 16);
  return b;
}

async function render(): Promise<void> {
  const tabId = await currentTabId();
  if (tabId === undefined) return;
  const s = await sendToBackground<TabStateResponse | undefined>({ type: "get_tab_state", tabId });
  if (!s) return;

  $<HTMLInputElement>("enabled").checked = s.enabled;
  $("modelLabel").textContent = s.model;
  $("host").textContent = s.host || "This page";

  const pause = $<HTMLButtonElement>("pause");
  pause.classList.toggle("active", s.paused);
  pause.disabled = !s.host;
  $("pauseLabel").textContent = s.paused ? "Resume site" : "Pause site";
  pause.querySelector("svg")?.replaceWith(rangeSvg(s.paused ? "play" : "pause"));

  const n = noticeFor(s.status);
  const notice = $("notice");
  notice.className = "notice" + (n ? ` ${n.tone}` : " hidden");
  if (n) {
    $("noticeIcon").innerHTML = icon(n.icon, 16);
    $("noticeText").textContent = n.text;
    const a = $<HTMLAnchorElement>("noticeAction");
    a.classList.toggle("hidden", !n.action);
    if (n.action) {
      a.textContent = n.action.label + " →";
      a.onclick = (e) => {
        e.preventDefault();
        n.action!.run();
      };
    }
  }

  $("hiddenCount").textContent = String(s.hidden.length + s.ruleHidden);
  $("analysedCount").textContent = String(s.analysed);
  $("pageCost").textContent = fmtUsd(s.pageTokens ?? 0);
  $("pageCost").title = `${fmtTokens(s.pageTokens ?? 0)} input tokens on this page`;
  $("ruleCount").textContent = String(s.ruleHidden);
  $("rulesRow").classList.toggle("hidden", s.ruleHidden === 0);

  const list = $<HTMLUListElement>("list");
  list.innerHTML = "";
  $("empty").classList.toggle("hidden", s.hidden.length > 0 || s.ruleHidden > 0);
  for (const h of s.hidden) {
    const li = document.createElement("li");
    const ic = document.createElement("div");
    ic.className = "item-icon" + (h.source === "rule" ? " rule" : "");
    ic.innerHTML = icon(h.label === "sponsored_native" ? "sparkles" : h.label === "consent_or_popup" ? "layers" : "shield", 16);
    const meta = document.createElement("div");
    meta.className = "meta";
    const cat = document.createElement("div");
    cat.className = "cat";
    cat.innerHTML = `<span>${LABELS[h.label] ?? h.label}</span><span class="dot"></span><span>${h.source === "cache" ? "cached" : h.source === "jev" ? "Jev" : h.source}</span>`;
    const sum = document.createElement("span");
    sum.className = "sum";
    sum.textContent = h.summary;
    sum.title = h.summary;
    meta.append(cat, sum);

    const acts = document.createElement("div");
    acts.className = "acts";
    const restore = iconButton("undo", "Restore on this page");
    restore.onclick = async () => {
      await sendToBackground({ type: "restore", tabId, nid: h.nid });
      await render();
    };
    const notAd = iconButton("ban", "Not an ad: never hide this on this site", true);
    notAd.onclick = async () => {
      await sendToBackground({ type: "not_an_ad", tabId, nid: h.nid, fp: h.fp });
      await render();
    };
    acts.append(restore, notAd);
    li.append(ic, meta, acts);
    list.append(li);
  }

  $("usage").textContent = `${fmtTokens(s.usage.inputTokens)} tokens · ${fmtUsd(s.usage.inputTokens)} total · ${fmtTokens(s.usage.today.inputTokens)} today`;

  $<HTMLButtonElement>("purgeRules").onclick = async () => {
    if (!s.host) return;
    await sendToBackground({ type: "purge_site_rules", host: s.host });
    await chrome.tabs.reload(tabId);
    window.close();
  };
  pause.onclick = async () => {
    if (!s.host) return;
    await sendToBackground({ type: "pause_host", host: s.host, paused: !s.paused });
    await render();
  };
}

function rangeSvg(name: IconName): SVGElement {
  const t = document.createElement("template");
  t.innerHTML = icon(name, 14);
  return t.content.firstElementChild as SVGElement;
}

$<HTMLInputElement>("enabled").addEventListener("change", async (e) => {
  await sendToBackground({ type: "set_enabled", value: (e.target as HTMLInputElement).checked });
  await render();
});
$("openOptions").addEventListener("click", (e) => {
  e.preventDefault();
  openSettings();
});

mountIcons();
void render();
