import { JevClient, JevError } from "../shared/jev/client";
import type { AnyMessage, ClassifyResponse, StatusResponse, TabStateResponse, TestKeyResponse } from "../shared/messages";
import { sendToTab } from "../shared/messages";
import { hostnameOf } from "../shared/sanitize";
import { setBadge } from "./badge";
import { clearAllCache, deleteCacheEntry } from "./cache";
import { classifyCandidates, snapshot, statusFor } from "./classify";
import { getApiKey, getOverrides, getSettings, overrideKey, patchHealth, patchSettings, setOverrides } from "./settings";
import { applyRuleFeedback, purgeAllSiteRules, purgeSiteRules, removeSiteRuleByFp } from "./siteRules";
import { getTabState, removeHidden, resetTabState, setHiddenItems, updateTabState } from "./tabState";

type Sender = chrome.runtime.MessageSender;

/** Popup and options pages. The options page opens in a tab, so `sender.tab` may be set; the URL origin is what matters. */
function isExtensionPage(sender: Sender): boolean {
  return !!sender.url && sender.url.startsWith(chrome.runtime.getURL(""));
}

function tabHost(sender: Sender): { tabId: number; host: string } | undefined {
  const tabId = sender.tab?.id;
  const host = hostnameOf(sender.url ?? sender.tab?.url);
  if (tabId === undefined || !host) return undefined;
  return { tabId, host };
}

async function hostForTab(tabId: number): Promise<string> {
  const s = await getTabState(tabId);
  if (s?.host) return s.host;
  try {
    const t = await chrome.tabs.get(tabId);
    return hostnameOf(t.url) ?? "";
  } catch {
    return "";
  }
}

export async function handleMessage(msg: AnyMessage, sender: Sender): Promise<unknown> {
  if (sender.id !== chrome.runtime.id) return undefined;

  switch (msg.type) {
    // ---- content script ------------------------------------------------
    case "classify": {
      const th = tabHost(sender);
      if (!th) return { verdicts: [], error: "disabled" } satisfies ClassifyResponse;
      const res = await classifyCandidates(th.host, { host: th.host, title: msg.page?.title, lang: msg.page?.lang }, msg.candidates);
      if (res.error) await setBadge(th.tabId, res.error, 0);
      if (res.inputTokens) await updateTabState(th.tabId, th.host, (s) => void (s.pageTokens += res.inputTokens ?? 0));
      return res;
    }
    case "page_start": {
      const th = tabHost(sender);
      if (th) await resetTabState(th.tabId, th.host);
      return undefined;
    }
    case "get_status": {
      const th = tabHost(sender);
      if (!th) return { status: "disabled" } satisfies StatusResponse;
      const status = statusFor(th.host, await snapshot());
      return { status } satisfies StatusResponse;
    }
    case "hidden_report": {
      const th = tabHost(sender);
      if (!th) return undefined;
      await setHiddenItems(th.tabId, th.host, msg.items, msg.ruleHidden, msg.analysed, msg.sensitive);
      await setBadge(th.tabId, msg.sensitive ? "sensitive_page" : "ok", msg.items.length + msg.ruleHidden);
      return undefined;
    }
    case "restored": {
      const th = tabHost(sender);
      if (!th) return undefined;
      const set = new Set(msg.nids);
      await removeHidden(th.tabId, (h) => set.has(h.nid));
      return undefined;
    }
    case "rule_feedback": {
      const th = tabHost(sender);
      if (!th) return undefined;
      await applyRuleFeedback(th.host, msg.sel, msg.matched, msg.stillAd);
      return undefined;
    }

    // ---- popup ---------------------------------------------------------
    case "get_tab_state": {
      if (!isExtensionPage(sender)) return undefined;
      const host = await hostForTab(msg.tabId);
      const snap = await snapshot();
      const state = await getTabState(msg.tabId);
      let status = host ? statusFor(host, snap) : "disabled";
      if (status === "ok" && state?.sensitive) status = "sensitive_page";
      return {
        host,
        status,
        hidden: state?.hidden ?? [],
        ruleHidden: state?.ruleHidden ?? 0,
        analysed: state?.analysed ?? 0,
        pageTokens: state?.pageTokens ?? 0,
        usage: snap.usage,
        model: snap.settings.model,
        enabled: snap.settings.enabled,
        paused: snap.settings.pausedHosts.includes(host),
      } satisfies TabStateResponse;
    }
    case "restore": {
      if (!isExtensionPage(sender)) return undefined;
      await sendToTab(msg.tabId, { type: "restore_element", nid: msg.nid });
      await removeHidden(msg.tabId, (h) => h.nid === msg.nid);
      return { ok: true };
    }
    case "not_an_ad": {
      if (!isExtensionPage(sender)) return undefined;
      const host = await hostForTab(msg.tabId);
      if (host) {
        const o = await getOverrides();
        o[overrideKey(host, msg.fp)] = "never_hide";
        await setOverrides(o);
        await deleteCacheEntry(host, msg.fp);
        await removeSiteRuleByFp(host, msg.fp);
      }
      await sendToTab(msg.tabId, { type: "restore_fp", fp: msg.fp });
      await removeHidden(msg.tabId, (h) => h.fp === msg.fp);
      return { ok: true };
    }
    case "set_enabled": {
      if (!isExtensionPage(sender)) return undefined;
      await patchSettings({ enabled: msg.value });
      return { ok: true };
    }
    case "pause_host": {
      if (!isExtensionPage(sender)) return undefined;
      const s = await getSettings();
      const set = new Set(s.pausedHosts);
      if (msg.paused) set.add(msg.host);
      else set.delete(msg.host);
      await patchSettings({ pausedHosts: [...set] });
      return { ok: true };
    }
    case "purge_site_rules": {
      if (!isExtensionPage(sender)) return undefined;
      await purgeSiteRules(msg.host);
      return { ok: true };
    }

    // ---- options -------------------------------------------------------
    case "test_key": {
      if (!isExtensionPage(sender)) return undefined;
      const key = await getApiKey();
      if (!key) return { ok: false, error: "No API key saved." } satisfies TestKeyResponse;
      try {
        const models = await new JevClient({ apiKey: key }).listModels();
        await patchHealth({ keyInvalid: false, consecutiveFailures: 0, offline: false, circuitOpenUntil: 0 });
        return { ok: true, models: models.map((m) => m.name) } satisfies TestKeyResponse;
      } catch (e) {
        const err = e instanceof JevError ? e : new JevError("network", undefined, String(e));
        if (err.kind === "auth") await patchHealth({ keyInvalid: true });
        return { ok: false, error: describe(err) } satisfies TestKeyResponse;
      }
    }
    case "clear_cache": {
      if (!isExtensionPage(sender)) return undefined;
      await clearAllCache();
      return { ok: true };
    }
    case "clear_overrides": {
      if (!isExtensionPage(sender)) return undefined;
      await setOverrides({});
      return { ok: true };
    }
    case "remove_override": {
      if (!isExtensionPage(sender)) return undefined;
      const o = await getOverrides();
      delete o[msg.key];
      await setOverrides(o);
      return { ok: true };
    }
    case "purge_all_site_rules": {
      if (!isExtensionPage(sender)) return undefined;
      await purgeAllSiteRules();
      return { ok: true };
    }
    default:
      return undefined;
  }
}

function describe(e: JevError): string {
  switch (e.kind) {
    case "auth":
      return "The API rejected this key (401). Check it in the TypeSafe console.";
    case "rate_limit":
      return "Rate limited by the API (429). Try again in a moment.";
    case "overloaded":
      return "The API is overloaded (529). Try again shortly.";
    case "timeout":
      return "The request timed out.";
    case "network":
      return "Could not reach api.typesafe.ai. Check your connection.";
    case "validation":
      return `The API rejected the request: ${e.message}`;
    default:
      return `Unexpected API error: ${e.message}`;
  }
}
