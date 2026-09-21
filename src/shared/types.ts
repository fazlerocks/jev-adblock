export type Category =
  | "display_ad"
  | "sponsored_native"
  | "consent_or_popup"
  | "first_party_promo"
  | "site_content"
  | "site_ui";

export const AD_CATEGORIES = ["display_ad", "sponsored_native", "consent_or_popup", "first_party_promo"] as const;
export const SAFE_CATEGORIES = ["site_content", "site_ui"] as const;

export type Signal =
  | "third_party_iframe"
  | "iab_size"
  | "rel_sponsored"
  | "adtech_attr"
  | "ad_token"
  | "sponsored_text"
  | "overlay"
  | "weak_token";

export type Container = "main" | "article" | "aside" | "nav" | "header" | "footer" | "body";
export type Position = "static" | "fixed" | "sticky" | "absolute";

export interface Candidate {
  nid: string;
  fp: string;
  tag: string;
  id?: string;
  classes?: string[];
  role?: string;
  ariaLabel?: string;
  w: number;
  h: number;
  iab?: string;
  position: Position;
  aboveFold: boolean;
  hasCloseControl: boolean;
  iframeHost?: string;
  iframeTitle?: string;
  linkHosts?: string[];
  relSponsored: boolean;
  adTechAttrs: string[];
  text?: string;
  textLinkRatio: number;
  imgCount: number;
  hasVideo: boolean;
  container: Container;
  signals: Signal[];
  /** Stable, page-unique CSS selector (already validated by the content script) used for site rules. */
  sel?: string;
}

export type VerdictSource = "override" | "cache" | "rule" | "jev";

export interface Verdict {
  nid: string;
  fp: string;
  label: Category;
  pAd: number;
  confidence: number;
  hide: boolean;
  source: VerdictSource;
}

export interface HiddenItem {
  nid: string;
  fp: string;
  label: Category;
  summary: string;
  source: VerdictSource;
}

export type Status =
  | "ok"
  | "no_key"
  | "invalid_key"
  | "disabled"
  | "paused"
  | "never_analyze"
  | "sensitive_page"
  | "budget_exhausted"
  | "circuit_open"
  | "offline"
  | "disclosure_required";

export type ErrorCode = Exclude<Status, "ok">;

export type ModelId = "jev-latest" | "jev-1.13.0" | "jev-preview";

export interface Settings {
  model: ModelId;
  enabled: boolean;
  pausedHosts: string[];
  neverAnalyzeHosts: string[];
  thresholds: { display_ad: number; sponsored_native: number; consent_or_popup: number };
  hideConsentPopups: boolean;
  hideFirstPartyPromo: boolean;
  collapseMode: "display" | "visibility";
  dailyTokenBudget: number;
  disclosureAccepted: boolean;
}

export interface CacheEntry {
  label: Category;
  pAd: number;
  confidence: number;
  hide: boolean;
  ts: number;
  hits: number;
  ttlDays: number;
}

export type HostCache = Record<string, CacheEntry>;

export interface SiteRule {
  sel: string;
  fp: string;
  ts: number;
  misses: number;
}

export interface Usage {
  inputTokens: number;
  requests: number;
  since: number;
  today: { day: string; inputTokens: number };
}

export interface TabState {
  host: string;
  hidden: HiddenItem[];
  analysed: number;
  batches: number;
  ruleHidden: number;
  sensitive?: boolean;
}

export interface RuntimeHealth {
  keyInvalid: boolean;
  circuitOpenUntil: number;
  consecutiveFailures: number;
  offline: boolean;
  /** Bumped by the background whenever the API key changes, so content scripts can re-check status without reading the key. */
  keyUpdatedAt: number;
}
