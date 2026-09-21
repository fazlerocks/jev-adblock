import { DEFAULT_SETTINGS, STORAGE_KEYS } from "../shared/constants";
import type { RuntimeHealth, Settings } from "../shared/types";

export async function getSettings(): Promise<Settings> {
  const r = await chrome.storage.local.get(STORAGE_KEYS.settings);
  const stored = (r[STORAGE_KEYS.settings] ?? {}) as Partial<Settings>;
  return {
    ...DEFAULT_SETTINGS,
    ...stored,
    thresholds: { ...DEFAULT_SETTINGS.thresholds, ...(stored.thresholds ?? {}) },
  };
}

export async function patchSettings(patch: Partial<Settings>): Promise<Settings> {
  const cur = await getSettings();
  const next = { ...cur, ...patch };
  await chrome.storage.local.set({ [STORAGE_KEYS.settings]: next });
  return next;
}

export async function getApiKey(): Promise<string | undefined> {
  const r = await chrome.storage.local.get(STORAGE_KEYS.apiKey);
  const k = r[STORAGE_KEYS.apiKey];
  return typeof k === "string" && k.trim() ? k.trim() : undefined;
}

export type Overrides = Record<string, "never_hide">;

export async function getOverrides(): Promise<Overrides> {
  const r = await chrome.storage.local.get(STORAGE_KEYS.overrides);
  return (r[STORAGE_KEYS.overrides] ?? {}) as Overrides;
}

export async function setOverrides(o: Overrides): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEYS.overrides]: o });
}

export function overrideKey(host: string, fp: string): string {
  return `${host}:${fp}`;
}

const DEFAULT_HEALTH: RuntimeHealth = { keyInvalid: false, circuitOpenUntil: 0, consecutiveFailures: 0, offline: false, keyUpdatedAt: 0 };

export async function getHealth(): Promise<RuntimeHealth> {
  const r = await chrome.storage.local.get(STORAGE_KEYS.health);
  return { ...DEFAULT_HEALTH, ...((r[STORAGE_KEYS.health] ?? {}) as Partial<RuntimeHealth>) };
}

export async function patchHealth(patch: Partial<RuntimeHealth>): Promise<RuntimeHealth> {
  const cur = await getHealth();
  const next = { ...cur, ...patch };
  await chrome.storage.local.set({ [STORAGE_KEYS.health]: next });
  return next;
}
