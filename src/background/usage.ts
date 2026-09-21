import { STORAGE_KEYS, USD_PER_MILLION_INPUT_TOKENS } from "../shared/constants";
import type { Usage } from "../shared/types";

export function localDay(d = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export async function getUsage(): Promise<Usage> {
  const r = await chrome.storage.local.get(STORAGE_KEYS.usage);
  const u = (r[STORAGE_KEYS.usage] ?? {}) as Partial<Usage>;
  const today = localDay();
  return {
    inputTokens: u.inputTokens ?? 0,
    requests: u.requests ?? 0,
    since: u.since ?? Date.now(),
    today: u.today && u.today.day === today ? u.today : { day: today, inputTokens: 0 },
  };
}

export async function addUsage(inputTokens: number): Promise<Usage> {
  const u = await getUsage();
  u.inputTokens += inputTokens;
  u.requests += 1;
  u.today.inputTokens += inputTokens;
  await chrome.storage.local.set({ [STORAGE_KEYS.usage]: u });
  return u;
}

export function estimateUsd(inputTokens: number): number {
  return (inputTokens / 1_000_000) * USD_PER_MILLION_INPUT_TOKENS;
}
