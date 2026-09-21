import {
  CIRCUIT_FAILURES,
  CIRCUIT_OPEN_MS,
  MAX_BATCH,
  MAX_INFLIGHT_PER_TAB,
  PAYMENT_IFRAME_HOSTS,
  SITE_RULE_MIN_HITS,
} from "../shared/constants";
import { JevClient, JevError } from "../shared/jev/client";
import { buildRequest, type PageContext } from "../shared/jev/questions";
import type { ChoiceAnswer } from "../shared/jev/types";
import type { ClassifyResponse } from "../shared/messages";
import { hostInList } from "../shared/sanitize";
import type { Candidate, ErrorCode, RuntimeHealth, Settings, Status, Usage, Verdict } from "../shared/types";
import { getHostCache, setHostCache } from "./cache";
import { decide, toCacheEntry } from "./decisions";
import { getApiKey, getHealth, getOverrides, getSettings, overrideKey, patchHealth } from "./settings";
import { addSiteRule } from "./siteRules";
import { addUsage, getUsage } from "./usage";

export interface Snapshot {
  settings: Settings;
  apiKey: string | undefined;
  health: RuntimeHealth;
  usage: Usage;
}

export async function snapshot(): Promise<Snapshot> {
  const [settings, apiKey, health, usage] = await Promise.all([getSettings(), getApiKey(), getHealth(), getUsage()]);
  return { settings, apiKey, health, usage };
}

export function statusFor(host: string, s: Snapshot, now = Date.now()): Status {
  if (!s.settings.enabled) return "disabled";
  if (hostInList(host, s.settings.pausedHosts)) return "paused";
  if (hostInList(host, s.settings.neverAnalyzeHosts)) return "never_analyze";
  if (!s.apiKey) return "no_key";
  if (!s.settings.disclosureAccepted) return "disclosure_required";
  if (s.health.keyInvalid) return "invalid_key";
  if (s.usage.today.inputTokens >= s.settings.dailyTokenBudget) return "budget_exhausted";
  if (s.health.circuitOpenUntil > now) return "circuit_open";
  if (s.health.offline) return "offline";
  return "ok";
}

export function isPaymentHost(host: string | undefined): boolean {
  return !!host && hostInList(host, PAYMENT_IFRAME_HOSTS);
}

let clientCache: { key: string; client: JevClient } | undefined;
function clientFor(apiKey: string): JevClient {
  if (!clientCache || clientCache.key !== apiKey) clientCache = { key: apiKey, client: new JevClient({ apiKey }) };
  return clientCache.client;
}

async function recordFailure(e: JevError): Promise<ErrorCode> {
  if (e.kind === "auth") {
    await patchHealth({ keyInvalid: true, consecutiveFailures: 0 });
    return "invalid_key";
  }
  if (e.kind === "validation") {
    console.warn("[jev-adblock] request rejected by API:", e.message);
    return "offline";
  }
  const h = await getHealth();
  const failures = h.consecutiveFailures + 1;
  const patch: Partial<RuntimeHealth> = { consecutiveFailures: failures };
  if (failures >= CIRCUIT_FAILURES) {
    patch.circuitOpenUntil = Date.now() + CIRCUIT_OPEN_MS;
    patch.consecutiveFailures = 0;
  }
  if (e.kind === "network" || e.kind === "timeout") patch.offline = true;
  await patchHealth(patch);
  return patch.circuitOpenUntil ? "circuit_open" : e.kind === "network" || e.kind === "timeout" ? "offline" : "circuit_open";
}

async function recordSuccess(): Promise<void> {
  const h = await getHealth();
  if (h.consecutiveFailures || h.offline || h.keyInvalid) await patchHealth({ consecutiveFailures: 0, offline: false, keyInvalid: false });
}

async function runPool<T>(tasks: (() => Promise<T>)[], limit: number): Promise<T[]> {
  const results: T[] = new Array(tasks.length);
  let next = 0;
  const worker = async () => {
    for (;;) {
      const i = next++;
      if (i >= tasks.length) return;
      results[i] = await tasks[i]!();
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, worker));
  return results;
}

/**
 * Classify a page's candidates for one tab. Splits overrides / cache hits / misses,
 * sends misses to Jev in batches, writes results back to the per-host cache,
 * and materialises site rules for repeatedly confirmed elements.
 */
export async function classifyCandidates(host: string, page: PageContext, candidates: Candidate[]): Promise<ClassifyResponse> {
  const snap = await snapshot();
  const status = statusFor(host, snap);
  if (status !== "ok") return { verdicts: [], error: status };

  const [overrides, cache] = await Promise.all([getOverrides(), getHostCache(host)]);
  const verdicts: Verdict[] = [];
  const now = Date.now();
  const byFp = new Map<string, Candidate[]>();

  for (const c of candidates) {
    if (overrides[overrideKey(host, c.fp)]) {
      verdicts.push({ nid: c.nid, fp: c.fp, label: "site_content", pAd: 0, confidence: 1, hide: false, source: "override" });
      continue;
    }
    const e = cache[c.fp];
    if (e && now - e.ts <= e.ttlDays * 86_400_000) {
      e.hits += 1;
      verdicts.push({ nid: c.nid, fp: c.fp, label: e.label, pAd: e.pAd, confidence: e.confidence, hide: e.hide, source: "cache" });
      if (e.hide && e.hits >= SITE_RULE_MIN_HITS && c.sel) void addSiteRule(host, { sel: c.sel, fp: c.fp });
      continue;
    }
    const list = byFp.get(c.fp);
    if (list) list.push(c);
    else byFp.set(c.fp, [c]);
  }

  const uniques = Array.from(byFp.values()).map((l) => l[0]!);
  let error: ErrorCode | undefined;
  let inputTokens = 0;

  if (uniques.length) {
    const client = clientFor(snap.apiKey!);
    const batches: Candidate[][] = [];
    for (let i = 0; i < uniques.length; i += MAX_BATCH) batches.push(uniques.slice(i, i + MAX_BATCH));

    const tasks = batches.map((batch) => async () => {
      if (error) return; // stop launching new batches once one failed hard
      const req = buildRequest(snap.settings.model, page, batch);
      try {
        const res = await client.systemOne(req);
        await recordSuccess();
        inputTokens += res.usage?.input_tokens ?? 0;
        await addUsage(res.usage?.input_tokens ?? 0);
        batch.forEach((rep, i) => {
          const ans = res.answers[`c${i}`];
          if (!ans || ans.type !== "choice") return;
          const d = decide(ans as ChoiceAnswer, rep, snap.settings);
          const entry = toCacheEntry(d, now);
          if (entry) cache[rep.fp] = entry;
          for (const c of byFp.get(rep.fp) ?? [rep]) {
            verdicts.push({ nid: c.nid, fp: c.fp, label: d.label, pAd: d.pAd, confidence: d.confidence, hide: d.hide, source: "jev" });
          }
        });
      } catch (e) {
        if (e instanceof JevError) error = await recordFailure(e);
        else {
          console.error("[jev-adblock] unexpected error", e);
          error = "offline";
        }
      }
    });
    await runPool(tasks, MAX_INFLIGHT_PER_TAB);
  }

  await setHostCache(host, cache);
  return error ? { verdicts, error, inputTokens } : { verdicts, inputTokens };
}
