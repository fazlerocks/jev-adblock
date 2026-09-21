import { CACHE_MAX_PER_HOST, CACHE_MAX_TOTAL, STORAGE_KEYS } from "../shared/constants";
import type { CacheEntry, HostCache } from "../shared/types";

const DAY = 86_400_000;

export function cacheKey(host: string): string {
  return STORAGE_KEYS.cachePrefix + host;
}

export function isExpired(e: CacheEntry, now = Date.now()): boolean {
  return now - e.ts > e.ttlDays * DAY;
}

export async function getHostCache(host: string): Promise<HostCache> {
  const k = cacheKey(host);
  const r = await chrome.storage.local.get(k);
  return (r[k] ?? {}) as HostCache;
}

export async function setHostCache(host: string, cache: HostCache): Promise<void> {
  const entries = Object.entries(cache);
  if (entries.length > CACHE_MAX_PER_HOST) {
    entries.sort((a, b) => a[1].hits - b[1].hits || a[1].ts - b[1].ts);
    cache = Object.fromEntries(entries.slice(entries.length - CACHE_MAX_PER_HOST));
  }
  await chrome.storage.local.set({ [cacheKey(host)]: cache });
}

export async function deleteCacheEntry(host: string, fp: string): Promise<void> {
  const c = await getHostCache(host);
  if (fp in c) {
    delete c[fp];
    await setHostCache(host, c);
  }
}

export async function clearAllCache(): Promise<void> {
  const all = await chrome.storage.local.get(null);
  const keys = Object.keys(all).filter((k) => k.startsWith(STORAGE_KEYS.cachePrefix));
  if (keys.length) await chrome.storage.local.remove(keys);
}

/** Evict expired entries, then trim globally to CACHE_MAX_TOTAL by lowest hits / oldest. */
export async function gcCache(now = Date.now()): Promise<{ hosts: number; entries: number }> {
  const all = await chrome.storage.local.get(null);
  const keys = Object.keys(all).filter((k) => k.startsWith(STORAGE_KEYS.cachePrefix));
  const flat: { key: string; fp: string; e: CacheEntry }[] = [];
  const updates: Record<string, HostCache> = {};
  const removals: string[] = [];

  for (const key of keys) {
    const hc = (all[key] ?? {}) as HostCache;
    const kept: HostCache = {};
    for (const [fp, e] of Object.entries(hc)) {
      if (!isExpired(e, now)) {
        kept[fp] = e;
        flat.push({ key, fp, e });
      }
    }
    if (Object.keys(kept).length === 0) removals.push(key);
    else updates[key] = kept;
  }

  if (flat.length > CACHE_MAX_TOTAL) {
    flat.sort((a, b) => a.e.hits - b.e.hits || a.e.ts - b.e.ts);
    const drop = flat.slice(0, flat.length - CACHE_MAX_TOTAL);
    for (const d of drop) {
      const hc = updates[d.key];
      if (hc) delete hc[d.fp];
    }
    for (const [key, hc] of Object.entries(updates)) {
      if (Object.keys(hc).length === 0) {
        removals.push(key);
        delete updates[key];
      }
    }
  }

  if (Object.keys(updates).length) await chrome.storage.local.set(updates);
  if (removals.length) await chrome.storage.local.remove(removals);
  const entries = Object.values(updates).reduce((n, hc) => n + Object.keys(hc).length, 0);
  return { hosts: Object.keys(updates).length, entries };
}
