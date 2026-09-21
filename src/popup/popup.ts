import { CONSOLE_KEYS_URL } from "../shared/constants";
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

function bannerFor(status: Status): { text: string; error: boolean; link?: boolean } | null {
  switch (status) {
    case "no_key":
      return { text: "Add your TypeSafe API key to start blocking ads.", error: false, link: true };
    case "disclosure_required":
      return { text: "Review what leaves your browser and accept the disclosure in Settings.", error: false, link: true };
    case "invalid_key":
      return { text: "The API rejected your key. Check it in Settings.", error: true, link: true };
    case "budget_exhausted":
      return { text: "Daily token budget reached. Blocking resumes tomorrow, or raise the budget in Settings.", error: true, link: true };
    case "circuit_open":
      return { text: "The TypeSafe API failed repeatedly. Paused for a few minutes.", error: true };
    case "offline":
      return { text: "Could not reach api.typesafe.ai.", error: true };
    case "sensitive_page":
      return { text: "Not analysed: this page has a password or payment field.", error: false };
    case "never_analyze":
      return { text: "This site is on your never-analyse list.", error: false };
    case "paused":
      return { text: "Paused on this site.", error: false };
    case "disabled":
      return { text: "Jev Ad Blocker is turned off.", error: false };
    default:
      return null;
  }
}

async function currentTabId(): Promise<number | undefined> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab?.id;
}

async function render(): Promise<void> {
  const tabId = await currentTabId();
  if (tabId === undefined) return;
  const s = await sendToBackground<TabStateResponse | undefined>({ type: "get_tab_state", tabId });
  if (!s) return;

  $<HTMLInputElement>("enabled").checked = s.enabled;
  $("host").textContent = s.host || "—";
  const pause = $<HTMLButtonElement>("pause");
  pause.textContent = s.paused ? "Resume on this site" : "Pause on this site";
  pause.classList.toggle("active", s.paused);
  pause.disabled = !s.host;

  const b = bannerFor(s.status);
  const banner = $("banner");
  banner.classList.toggle("hidden", !b);
  banner.classList.toggle("error", !!b?.error);
  banner.innerHTML = "";
  if (b) {
    banner.append(b.text + " ");
    if (b.link) {
      const a = document.createElement("a");
      a.href = "#";
      a.textContent = "Open Settings";
      a.onclick = (e) => {
        e.preventDefault();
        void chrome.runtime.openOptionsPage();
      };
      banner.append(a);
    }
  }

  $("hiddenCount").textContent = String(s.hidden.length + s.ruleHidden);
  $("analysedCount").textContent = String(s.analysed);
  $("ruleCount").textContent = String(s.ruleHidden);
  $("rulesRow").classList.toggle("hidden", s.ruleHidden === 0);

  const list = $<HTMLUListElement>("list");
  list.innerHTML = "";
  $("empty").classList.toggle("hidden", s.hidden.length > 0);
  for (const h of s.hidden) {
    const li = document.createElement("li");
    const meta = document.createElement("div");
    meta.className = "meta";
    const cat = document.createElement("span");
    cat.className = "cat";
    cat.textContent = `${LABELS[h.label] ?? h.label} · ${h.source}`;
    const sum = document.createElement("span");
    sum.className = "sum";
    sum.textContent = h.summary;
    sum.title = h.summary;
    meta.append(cat, sum);
    const acts = document.createElement("div");
    acts.className = "acts";
    const restore = document.createElement("button");
    restore.className = "btn small";
    restore.textContent = "Restore";
    restore.title = "Show this element again on this page";
    restore.onclick = async () => {
      await sendToBackground({ type: "restore", tabId, nid: h.nid });
      await render();
    };
    const notAd = document.createElement("button");
    notAd.className = "btn small";
    notAd.textContent = "Not an ad";
    notAd.title = "Restore and never hide this element on this site again";
    notAd.onclick = async () => {
      await sendToBackground({ type: "not_an_ad", tabId, nid: h.nid, fp: h.fp });
      await render();
    };
    acts.append(restore, notAd);
    li.append(meta, acts);
    list.append(li);
  }

  const usd = (s.usage.inputTokens / 1_000_000) * 0.042;
  $("usage").textContent = `${formatTokens(s.usage.inputTokens)} tokens · ~$${usd.toFixed(4)} · today ${formatTokens(s.usage.today.inputTokens)}`;

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

function formatTokens(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(2) + "M";
  if (n >= 1000) return (n / 1000).toFixed(1) + "k";
  return String(n);
}

$<HTMLInputElement>("enabled").addEventListener("change", async (e) => {
  await sendToBackground({ type: "set_enabled", value: (e.target as HTMLInputElement).checked });
  await render();
});
$("openOptions").addEventListener("click", (e) => {
  e.preventDefault();
  void chrome.runtime.openOptionsPage();
});

void render();
export { CONSOLE_KEYS_URL };
