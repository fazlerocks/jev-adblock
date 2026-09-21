import { SITE_RULE_MAX_MISSES, SITE_RULE_MAX_PER_HOST, SITE_RULE_TTL_DAYS, STORAGE_KEYS } from "../shared/constants";
import type { SiteRule } from "../shared/types";

const DAY = 86_400_000;
export type SiteRules = Record<string, SiteRule[]>;

export async function getAllSiteRules(): Promise<SiteRules> {
  const r = await chrome.storage.local.get(STORAGE_KEYS.siteRules);
  return (r[STORAGE_KEYS.siteRules] ?? {}) as SiteRules;
}

async function saveAll(rules: SiteRules): Promise<void> {
  for (const host of Object.keys(rules)) if (!rules[host]?.length) delete rules[host];
  await chrome.storage.local.set({ [STORAGE_KEYS.siteRules]: rules });
}

export function pruneExpired(list: SiteRule[], now = Date.now()): SiteRule[] {
  return list.filter((r) => now - r.ts <= SITE_RULE_TTL_DAYS * DAY && r.misses < SITE_RULE_MAX_MISSES);
}

export async function getSiteRules(host: string): Promise<SiteRule[]> {
  const all = await getAllSiteRules();
  return pruneExpired(all[host] ?? []);
}

/** Add a rule if under the per-host cap and not already present. Returns true when added. */
export async function addSiteRule(host: string, rule: Omit<SiteRule, "ts" | "misses">): Promise<boolean> {
  const all = await getAllSiteRules();
  const list = pruneExpired(all[host] ?? []);
  if (list.some((r) => r.sel === rule.sel || r.fp === rule.fp)) return false;
  if (list.length >= SITE_RULE_MAX_PER_HOST) return false;
  list.push({ ...rule, ts: Date.now(), misses: 0 });
  all[host] = list;
  await saveAll(all);
  return true;
}

export async function removeSiteRuleByFp(host: string, fp: string): Promise<void> {
  const all = await getAllSiteRules();
  const list = all[host];
  if (!list) return;
  all[host] = list.filter((r) => r.fp !== fp);
  await saveAll(all);
}

/** Feedback from the content script after each load: bump misses when the selector matched nothing, drop when re-classified as not-ad. */
export async function applyRuleFeedback(host: string, sel: string, matched: number, stillAd: boolean | null): Promise<void> {
  const all = await getAllSiteRules();
  const list = all[host];
  if (!list) return;
  const idx = list.findIndex((r) => r.sel === sel);
  if (idx < 0) return;
  const rule = list[idx]!;
  if (stillAd === false) {
    list.splice(idx, 1);
  } else if (matched === 0) {
    rule.misses += 1;
    if (rule.misses >= SITE_RULE_MAX_MISSES) list.splice(idx, 1);
  } else {
    rule.misses = 0;
    if (stillAd === true) rule.ts = Date.now();
  }
  all[host] = list;
  await saveAll(all);
}

export async function purgeSiteRules(host: string): Promise<void> {
  const all = await getAllSiteRules();
  delete all[host];
  await saveAll(all);
}

export async function purgeAllSiteRules(): Promise<void> {
  await chrome.storage.local.set({ [STORAGE_KEYS.siteRules]: {} });
}
