import { DEFAULT_SETTINGS, STORAGE_KEYS, USD_PER_MILLION_INPUT_TOKENS } from "../shared/constants";
import { icon, mountIcons } from "../shared/icons";
import { sendToBackground, type TestKeyResponse } from "../shared/messages";
import type { ModelId, Settings, Usage } from "../shared/types";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

async function loadSettings(): Promise<Settings> {
  const r = await chrome.storage.local.get(STORAGE_KEYS.settings);
  const stored = (r[STORAGE_KEYS.settings] ?? {}) as Partial<Settings>;
  return { ...DEFAULT_SETTINGS, ...stored, thresholds: { ...DEFAULT_SETTINGS.thresholds, ...(stored.thresholds ?? {}) } };
}

async function saveSettings(patch: Partial<Settings>): Promise<void> {
  const cur = await loadSettings();
  await chrome.storage.local.set({ [STORAGE_KEYS.settings]: { ...cur, ...patch } });
  toast();
  await renderStatus();
}

let toastTimer: number | undefined;
function toast(): void {
  const el = $("toast");
  el.classList.remove("hidden");
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => el.classList.add("hidden"), 1200);
}

function setStatus(id: string, text: string, kind: "ok" | "err" | "busy" | "" = ""): void {
  const el = $(id);
  const ic = kind === "ok" ? icon("circleCheck", 15) : kind === "err" ? icon("alert", 15) : kind === "busy" ? icon("loader", 15, "spin") : "";
  el.innerHTML = `${ic}<span></span>`;
  el.querySelector("span")!.textContent = text;
  el.className = `status ${kind === "busy" ? "" : kind}`.trim();
}

function lines(s: string): string[] {
  return s
    .split(/\r?\n/)
    .map((x) => x.trim().toLowerCase())
    .filter(Boolean);
}

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(2) + "M";
  if (n >= 1000) return (n / 1000).toFixed(1) + "k";
  return String(n);
}

async function renderStatus(): Promise<void> {
  const [s, keyRes, usageRes] = await Promise.all([
    loadSettings(),
    chrome.storage.local.get(STORAGE_KEYS.apiKey),
    chrome.storage.local.get(STORAGE_KEYS.usage),
  ]);
  const hasKey = typeof keyRes[STORAGE_KEYS.apiKey] === "string" && (keyRes[STORAGE_KEYS.apiKey] as string).trim().length > 0;
  const setCheck = (id: string, ok: boolean, sub: string) => {
    const li = $(id);
    li.classList.toggle("ok", ok);
    li.querySelector(".chk")!.innerHTML = ok ? icon("check", 13) : "";
    (li.querySelector(".chk-sub") as HTMLElement).textContent = sub;
  };
  setCheck("chkKey", hasKey, hasKey ? "Saved in this browser only." : "Paste a key from the TypeSafe console below.");
  setCheck("chkDisclosure", s.disclosureAccepted, s.disclosureAccepted ? "Accepted." : "Read the Privacy section and switch it on.");
  setCheck("chkEnabled", s.enabled, s.enabled ? "On." : "Turned off in the popup.");

  const u = (usageRes[STORAGE_KEYS.usage] ?? {}) as Partial<Usage>;
  const tokens = u.inputTokens ?? 0;
  $("uTokens").textContent = fmtTokens(tokens);
  $("uCost").textContent = "$" + ((tokens / 1_000_000) * USD_PER_MILLION_INPUT_TOKENS).toFixed(4);
  $("uRequests").textContent = String(u.requests ?? 0);
  $("uToday").textContent = fmtTokens(u.today?.inputTokens ?? 0);
}

async function renderOverrides(): Promise<void> {
  const r = await chrome.storage.local.get(STORAGE_KEYS.overrides);
  const o = (r[STORAGE_KEYS.overrides] ?? {}) as Record<string, string>;
  const ul = $<HTMLUListElement>("overrides");
  ul.innerHTML = "";
  const keys = Object.keys(o);
  const clearBtn = $<HTMLButtonElement>("clearOverrides");
  clearBtn.disabled = keys.length === 0;
  if (!keys.length) {
    const li = document.createElement("li");
    li.className = "empty";
    li.textContent = "No corrections yet. Use “Not an ad” in the popup when something is hidden by mistake.";
    ul.append(li);
    return;
  }
  for (const key of keys) {
    const li = document.createElement("li");
    const span = document.createElement("span");
    const [host, fp] = key.split(":");
    span.textContent = `${host}  ·  ${fp}`;
    const btn = document.createElement("button");
    btn.className = "link";
    btn.type = "button";
    btn.textContent = "Remove";
    btn.onclick = async () => {
      await sendToBackground({ type: "remove_override", key });
      await renderOverrides();
      toast();
    };
    li.append(span, btn);
    ul.append(li);
  }
}

function setupNav(): void {
  const links = Array.from(document.querySelectorAll<HTMLAnchorElement>("#nav a"));
  const sections = links.map((a) => document.querySelector<HTMLElement>(a.getAttribute("href")!)!);
  const io = new IntersectionObserver(
    (entries) => {
      const visible = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
      if (!visible) return;
      links.forEach((a) => a.classList.toggle("active", a.getAttribute("href") === `#${visible.target.id}`));
    },
    { rootMargin: "-20% 0px -70% 0px", threshold: 0 },
  );
  sections.forEach((s) => io.observe(s));
}

async function init(): Promise<void> {
  mountIcons();
  setupNav();
  const s = await loadSettings();
  const keyRes = await chrome.storage.local.get(STORAGE_KEYS.apiKey);
  const key = (keyRes[STORAGE_KEYS.apiKey] as string | undefined) ?? "";

  const apiKey = $<HTMLInputElement>("apiKey");
  apiKey.value = key;
  setStatus("keyStatus", key ? "A key is saved. Click “Save & test” to re-check it." : "No key saved yet.");

  $("toggleKey").onclick = () => {
    const show = apiKey.type === "password";
    apiKey.type = show ? "text" : "password";
    $("toggleKey").innerHTML = icon(show ? "eyeOff" : "eye", 16);
  };
  $("saveKey").onclick = async () => {
    const v = apiKey.value.trim();
    if (!v) {
      setStatus("keyStatus", "Paste a key first.", "err");
      return;
    }
    await chrome.storage.local.set({ [STORAGE_KEYS.apiKey]: v });
    toast();
    await renderStatus();
    await testKey();
  };
  apiKey.addEventListener("keydown", (e) => {
    if (e.key === "Enter") $("saveKey").click();
  });
  $("clearKey").onclick = async () => {
    await chrome.storage.local.remove(STORAGE_KEYS.apiKey);
    apiKey.value = "";
    setStatus("keyStatus", "Key removed. The extension is now inactive.");
    toast();
    await renderStatus();
  };

  const disclosure = $<HTMLInputElement>("disclosure");
  disclosure.checked = s.disclosureAccepted;
  disclosure.onchange = () => void saveSettings({ disclosureAccepted: disclosure.checked });

  const model = $<HTMLSelectElement>("model");
  model.value = s.model;
  model.onchange = () => void saveSettings({ model: model.value as ModelId });

  const collapse = $<HTMLSelectElement>("collapseMode");
  collapse.value = s.collapseMode;
  collapse.onchange = () => void saveSettings({ collapseMode: collapse.value as Settings["collapseMode"] });

  const bindRange = (id: string, valId: string, key: keyof Settings["thresholds"]) => {
    const input = $<HTMLInputElement>(id);
    const val = $(valId);
    input.value = String(s.thresholds[key]);
    const show = () => (val.textContent = Math.round(Number(input.value) * 100) + "%");
    show();
    input.oninput = show;
    input.onchange = async () => {
      const cur = await loadSettings();
      await saveSettings({ thresholds: { ...cur.thresholds, [key]: Number(input.value) } });
    };
  };
  bindRange("tDisplay", "tDisplayVal", "display_ad");
  bindRange("tSponsored", "tSponsoredVal", "sponsored_native");
  bindRange("tConsent", "tConsentVal", "consent_or_popup");

  const hideConsent = $<HTMLInputElement>("hideConsent");
  hideConsent.checked = s.hideConsentPopups;
  hideConsent.onchange = () => void saveSettings({ hideConsentPopups: hideConsent.checked });
  const hidePromo = $<HTMLInputElement>("hidePromo");
  hidePromo.checked = s.hideFirstPartyPromo;
  hidePromo.onchange = () => void saveSettings({ hideFirstPartyPromo: hidePromo.checked });

  const budget = $<HTMLInputElement>("budget");
  const budgetHint = $("budgetHint");
  const hint = () => (budgetHint.textContent = `≈ $${((Number(budget.value) / 1_000_000) * USD_PER_MILLION_INPUT_TOKENS).toFixed(2)} per day at $0.042 per million tokens`);
  budget.value = String(s.dailyTokenBudget);
  hint();
  budget.oninput = hint;
  budget.onchange = () => void saveSettings({ dailyTokenBudget: Math.max(10_000, Number(budget.value) || DEFAULT_SETTINGS.dailyTokenBudget) });

  const never = $<HTMLTextAreaElement>("never");
  never.value = s.neverAnalyzeHosts.join("\n");
  never.onchange = () => void saveSettings({ neverAnalyzeHosts: lines(never.value) });
  const paused = $<HTMLTextAreaElement>("paused");
  paused.value = s.pausedHosts.join("\n");
  paused.onchange = () => void saveSettings({ pausedHosts: lines(paused.value) });

  $("clearOverrides").onclick = async () => {
    await sendToBackground({ type: "clear_overrides" });
    await renderOverrides();
    toast();
  };
  $("clearCache").onclick = async () => {
    await sendToBackground({ type: "clear_cache" });
    setStatus("maintStatus", "Decision cache cleared.", "ok");
  };
  $("purgeAllRules").onclick = async () => {
    await sendToBackground({ type: "purge_all_site_rules" });
    setStatus("maintStatus", "All site rules purged.", "ok");
  };

  // Keep the status card live when the popup or background changes things.
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    if (changes[STORAGE_KEYS.settings] || changes[STORAGE_KEYS.apiKey] || changes[STORAGE_KEYS.usage]) void renderStatus();
    if (changes[STORAGE_KEYS.overrides]) void renderOverrides();
    if (changes[STORAGE_KEYS.settings]) {
      const next = changes[STORAGE_KEYS.settings]!.newValue as Partial<Settings> | undefined;
      if (next) {
        disclosure.checked = !!next.disclosureAccepted;
        paused.value = (next.pausedHosts ?? []).join("\n");
      }
    }
  });

  await Promise.all([renderStatus(), renderOverrides()]);
}

async function testKey(): Promise<void> {
  setStatus("keyStatus", "Testing key…", "busy");
  const r = await sendToBackground<TestKeyResponse | undefined>({ type: "test_key" });
  if (!r) {
    setStatus("keyStatus", "No response from the extension. Try reloading it.", "err");
    return;
  }
  if (r.ok) setStatus("keyStatus", `Key works. Models available: ${r.models?.join(", ") || "(none listed)"}`, "ok");
  else setStatus("keyStatus", r.error ?? "Key test failed.", "err");
}

void init();
