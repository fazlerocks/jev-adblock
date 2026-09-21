import { describe, expect, it } from "vitest";
import { cacheKey, gcCache, getHostCache, isExpired, setHostCache } from "../../src/background/cache";
import { CACHE_MAX_PER_HOST } from "../../src/shared/constants";
import type { CacheEntry } from "../../src/shared/types";

const entry = (over: Partial<CacheEntry> = {}): CacheEntry => ({
  label: "display_ad",
  pAd: 0.9,
  confidence: 0.9,
  hide: true,
  ts: Date.now(),
  hits: 1,
  ttlDays: 7,
  ...over,
});

describe("cache", () => {
  it("stores per-host buckets", async () => {
    await setHostCache("a.com", { fp1: entry() });
    await setHostCache("b.com", { fp2: entry() });
    expect(Object.keys(await getHostCache("a.com"))).toEqual(["fp1"]);
    expect(Object.keys(await getHostCache("b.com"))).toEqual(["fp2"]);
    expect(cacheKey("a.com")).toBe("dc:a.com");
  });
  it("expires by ttl", () => {
    const old = entry({ ts: Date.now() - 8 * 86_400_000, ttlDays: 7 });
    expect(isExpired(old)).toBe(true);
    expect(isExpired(entry())).toBe(false);
  });
  it("trims per-host by lowest hits", async () => {
    const big: Record<string, CacheEntry> = {};
    for (let i = 0; i < CACHE_MAX_PER_HOST + 10; i++) big[`fp${i}`] = entry({ hits: i });
    await setHostCache("a.com", big);
    const c = await getHostCache("a.com");
    expect(Object.keys(c).length).toBe(CACHE_MAX_PER_HOST);
    expect(c.fp0).toBeUndefined();
    expect(c[`fp${CACHE_MAX_PER_HOST + 9}`]).toBeDefined();
  });
  it("gc removes expired entries and empty hosts", async () => {
    await setHostCache("a.com", { live: entry(), dead: entry({ ts: 0 }) });
    await setHostCache("b.com", { dead: entry({ ts: 0 }) });
    const r = await gcCache();
    expect(r.hosts).toBe(1);
    expect(Object.keys(await getHostCache("a.com"))).toEqual(["live"]);
    expect(await getHostCache("b.com")).toEqual({});
  });
});
