import type { Candidate, ErrorCode, HiddenItem, ModelId, Status, Usage, Verdict } from "./types";

export type ContentToBackground =
  | { type: "classify"; candidates: Candidate[]; page: { title?: string; lang?: string } }
  | { type: "hidden_report"; items: HiddenItem[]; ruleHidden: number; analysed: number; sensitive?: boolean }
  | { type: "restored"; nids: string[] }
  | { type: "get_status" }
  | { type: "rule_feedback"; fp: string; sel: string; matched: number; stillAd: boolean | null };

export type PopupToBackground =
  | { type: "get_tab_state"; tabId: number }
  | { type: "restore"; tabId: number; nid: string }
  | { type: "not_an_ad"; tabId: number; nid: string; fp: string }
  | { type: "set_enabled"; value: boolean }
  | { type: "pause_host"; host: string; paused: boolean }
  | { type: "purge_site_rules"; host: string };

export type OptionsToBackground =
  | { type: "test_key" }
  | { type: "clear_cache" }
  | { type: "clear_overrides" }
  | { type: "purge_all_site_rules" }
  | { type: "remove_override"; key: string };

export type BackgroundToContent =
  | { type: "restore_element"; nid: string }
  | { type: "restore_fp"; fp: string }
  | { type: "rescan" };

export type AnyMessage = ContentToBackground | PopupToBackground | OptionsToBackground | BackgroundToContent;

export interface ClassifyResponse {
  verdicts: Verdict[];
  error?: ErrorCode;
}

export interface StatusResponse {
  status: Status;
}

export interface TabStateResponse {
  host: string;
  status: Status;
  hidden: HiddenItem[];
  ruleHidden: number;
  analysed: number;
  usage: Usage;
  model: ModelId;
  enabled: boolean;
  paused: boolean;
}

export interface TestKeyResponse {
  ok: boolean;
  models?: string[];
  error?: string;
}

export function sendToBackground<T>(msg: ContentToBackground | PopupToBackground | OptionsToBackground): Promise<T> {
  return chrome.runtime.sendMessage(msg) as Promise<T>;
}

export function sendToTab(tabId: number, msg: BackgroundToContent): Promise<unknown> {
  return chrome.tabs.sendMessage(tabId, msg).catch(() => undefined);
}
