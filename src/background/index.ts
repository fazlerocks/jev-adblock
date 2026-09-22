import { CACHE_GC_ALARM, CACHE_GC_PERIOD_MIN, STORAGE_KEYS } from "../shared/constants";
import type { AnyMessage } from "../shared/messages";
import { gcCache } from "./cache";
import { handleMessage } from "./router";
import { getApiKey, patchHealth } from "./settings";
import { dropTab } from "./tabState";

chrome.runtime.onMessage.addListener((msg: AnyMessage, sender, sendResponse) => {
  handleMessage(msg, sender)
    .then((r) => sendResponse(r))
    .catch((e) => {
      console.error("[jev-adblock] handler failed", msg?.type, e);
      sendResponse(undefined);
    });
  return true; // async response
});

chrome.runtime.onInstalled.addListener(async (details) => {
  await chrome.alarms.create(CACHE_GC_ALARM, { periodInMinutes: CACHE_GC_PERIOD_MIN });

  // Inject into tabs that were already open so the user does not have to reload them.
  try {
    const tabs = await chrome.tabs.query({ url: ["http://*/*", "https://*/*"] });
    await Promise.all(
      tabs.map(async (t) => {
        if (t.id === undefined) return;
        try {
          await chrome.scripting.insertCSS({ target: { tabId: t.id }, files: ["content.css"] });
          await chrome.scripting.executeScript({ target: { tabId: t.id }, files: ["content.js"] });
        } catch {
          /* chrome:// pages, store pages, etc. */
        }
      }),
    );
  } catch (e) {
    console.warn("[jev-adblock] could not inject into open tabs", e);
  }

  if (details.reason === "install") {
    await chrome.runtime.openOptionsPage();
  }
});

// Keep health.hasKey in sync so content scripts can gate pre-paint rules without touching the key.
void getApiKey().then((k) => patchHealth({ hasKey: !!k }));
chrome.runtime.onStartup.addListener(() => void getApiKey().then((k) => patchHealth({ hasKey: !!k })));

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === CACHE_GC_ALARM) void gcCache();
});

chrome.tabs.onRemoved.addListener((tabId) => {
  void dropTab(tabId);
});

// Saving a new key clears the "invalid key" flag so the next request can try it.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes[STORAGE_KEYS.apiKey]) {
    const v = changes[STORAGE_KEYS.apiKey]!.newValue;
    void patchHealth({ keyInvalid: false, consecutiveFailures: 0, circuitOpenUntil: 0, offline: false, keyUpdatedAt: Date.now(), hasKey: typeof v === "string" && v.trim().length > 0 });
  }
});
