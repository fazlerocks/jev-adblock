import { DEFAULT_SETTINGS, STORAGE_KEYS } from "../shared/constants";
import { sendToBackground, type TestKeyResponse } from "../shared/messages";
import type { ModelId, Settings } from "../shared/types";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

async function loadSettings(): Promise<Settings> {
  const r = await chrome.storage.local.get(STORAGE_KEYS.settings);
  const stored = (r[STORAGE_KEYS.settings] ?? {}) as Partial<Settings>;
  return { ...DEFAULT_SETTINGS, ...stored, thresholds: { ...DEFAULT_SETTINGS.thresholds, ...(stored.thresholds ?? {}) } };
}

let saveTimer: number | undefined;
async function saveSettings(patch: Partial<Settings>): Promise<void> {
  const cur = await loadSettings();
  await chrome.storage.local.set({ [STORAGE_KEYS.settings]: { ...cur, ...patch } });
  flashSaved();
}

function flashSaved(): void {
  const el = $("saved");
  el.classList.remove("hidden");
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => el.classList.add("hidden"), 1200);
}

function setStatus(id: string, text: string, kind: "ok" | "err" | "" = ""): void {
  const el = $(id);
  el.textContent = text;
  el.className = `status ${kind}`.trim();
}

function lines(s: string): string[] {
  return s
    .split(/\r?\n/)
    .map((x) => x.trim().toLowerCase())
    .filter(Boolean);
}

async function renderOverrides(): Promise<void> {
  const r = await chrome.storage.local.get(STORAGE_KEYS.overrides);
  const o = (r[STORAGE_KEYS.overrides] ?? {}) as Record<string, string>;
  const ul = $<HTMLUListElement>("overrides");
  ul.innerHTML = "";
  const keys = Object.keys(o);
  if (!keys.length) {
    const li = document.createElement("li");
    li.textContent = "None yet.";
    ul.append(li);
    return;
  }
  for (const key of keys) {
    const li = document.createElement("li");
    const span = document.createElement("span");
    span.textContent = key;
    const btn = document.createElement("button");
    btn.className = "link";
    btn.textContent = "Remove";
    btn.onclick = async () => {
      await sendToBackground({ type: "remove_override", key });
      await renderOverrides();
    };
    li.append(span, btn);
    ul.append(li);
  }
}

async function init(): Promise<void> {
  const s = await loadSettings();
  const keyRes = await chrome.storage.local.get(STORAGE_KEYS.apiKey);
  const key = (keyRes[STORAGE_KEYS.apiKey] as string | undefined) ?? "";

  const apiKey = $<HTMLInputElement>("apiKey");
  apiKey.value = key;
  setStatus("keyStatus", key ? "A key is saved." : "No key saved yet.");

  $("toggleKey").onclick = () => {
    apiKey.type = apiKey.type === "password" ? "text" : "password";
  };
  $("saveKey").onclick = async () => {
    const v = apiKey.value.trim();
    if (!v) {
      setStatus("keyStatus", "Paste a key first.", "err");
      return;
    }
    await chrome.storage.local.set({ [STORAGE_KEYS.apiKey]: v });
    setStatus("keyStatus", "Key saved. Testing…");
    flashSaved();
    await testKey();
  };
  $("testKey").onclick = () => void testKey();
  $("clearKey").onclick = async () => {
    await chrome.storage.local.remove(STORAGE_KEYS.apiKey);
    apiKey.value = "";
    setStatus("keyStatus", "Key removed. The extension is now inactive.");
    flashSaved();
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
    val.textContent = Number(input.value).toFixed(2);
    input.oninput = () => (val.textContent = Number(input.value).toFixed(2));
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
  const hint = () => (budgetHint.textContent = `≈ $${((Number(budget.value) / 1_000_000) * 0.042).toFixed(2)} per day at $0.042 per million tokens`);
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
    flashSaved();
  };
  $("clearCache").onclick = async () => {
    await sendToBackground({ type: "clear_cache" });
    setStatus("maintStatus", "Decision cache cleared.", "ok");
  };
  $("purgeAllRules").onclick = async () => {
    await sendToBackground({ type: "purge_all_site_rules" });
    setStatus("maintStatus", "All site rules purged.", "ok");
  };

  await renderOverrides();
}

async function testKey(): Promise<void> {
  setStatus("keyStatus", "Testing key…");
  const r = await sendToBackground<TestKeyResponse | undefined>({ type: "test_key" });
  if (!r) {
    setStatus("keyStatus", "No response from the extension. Try reloading it.", "err");
    return;
  }
  if (r.ok) setStatus("keyStatus", `Key works. Models available: ${r.models?.join(", ") || "(none listed)"}`, "ok");
  else setStatus("keyStatus", r.error ?? "Key test failed.", "err");
}

void init();
