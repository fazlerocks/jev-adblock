import type { Settings } from "./types";

export const API_BASE = "https://api.typesafe.ai";
export const SYSTEMONE_PATH = "/v1/systemone";
export const MODELS_PATH = "/v1/models";
export const CONSOLE_KEYS_URL = "https://console.typesafe.ai/keys";

export const USD_PER_MILLION_INPUT_TOKENS = 0.042;

export const DEFAULT_SETTINGS: Settings = {
  model: "jev-latest",
  enabled: true,
  pausedHosts: [],
  neverAnalyzeHosts: [],
  thresholds: { display_ad: 0.7, sponsored_native: 0.8, consent_or_popup: 0.85 },
  hideConsentPopups: false,
  hideFirstPartyPromo: false,
  collapseMode: "display",
  snapEffect: true,
  dailyTokenBudget: 5_000_000,
  disclosureAccepted: false,
};

export const STORAGE_KEYS = {
  settings: "settings",
  apiKey: "apiKey",
  overrides: "overrides",
  siteRules: "siteRules",
  usage: "usage",
  health: "health",
  cachePrefix: "dc:",
} as const;

// Decision guards
export const MARGIN_GUARD = 0.35;
export const CONFIDENCE_FLOOR = 0.4;
export const CONTAINER_BUMP = 0.1;
export const NEGATIVE_CACHE_MIN_SAFE = 0.8;
export const POSITIVE_TTL_DAYS = 7;
export const NEGATIVE_TTL_DAYS = 7;
export const UNCERTAIN_TTL_DAYS = 1;

// Caps
export const MAX_CANDIDATES_PER_SCAN = 40;
export const MAX_CANDIDATES_PER_PAGE = 200;
export const MAX_BATCH = 40;
export const MAX_BATCHES_PER_PAGE = 10;
export const MAX_INFLIGHT_PER_TAB = 3;
export const COALESCE_MS = 150;
export const MUTATION_DEBOUNCE_MS = 750;
export const IDLE_TIMEOUT_MS = 1000;
export const CLASSIFY_TIMEOUT_MS = 10_000;

// Cache
export const CACHE_MAX_TOTAL = 5000;
export const CACHE_MAX_PER_HOST = 300;
export const CACHE_GC_ALARM = "jb-cache-gc";
export const CACHE_GC_PERIOD_MIN = 360;

// Site rules
export const SITE_RULE_MIN_HITS = 3;
export const SITE_RULE_MAX_PER_HOST = 20;
export const SITE_RULE_TTL_DAYS = 14;
export const SITE_RULE_MAX_MATCHES = 3;
export const SITE_RULE_MAX_MISSES = 3;

// Client
export const REQUEST_TIMEOUT_MS = 8000;
export const CIRCUIT_FAILURES = 5;
export const CIRCUIT_OPEN_MS = 5 * 60_000;

// Descriptor caps
export const CAPS = {
  text: 150,
  classes: 6,
  classLen: 32,
  idLen: 48,
  aria: 80,
  iframeTitle: 60,
  linkHosts: 3,
  title: 120,
} as const;

export const IAB_SIZES: ReadonlyArray<readonly [number, number, string]> = [
  [300, 250, "medium_rectangle"],
  [728, 90, "leaderboard"],
  [320, 50, "mobile_banner"],
  [160, 600, "wide_skyscraper"],
  [300, 600, "half_page"],
  [970, 250, "billboard"],
  [336, 280, "large_rectangle"],
  [320, 100, "large_mobile_banner"],
  [970, 90, "super_leaderboard"],
  [250, 250, "square"],
];
export const IAB_TOLERANCE = 4;

export const STRONG_TOKEN_RE =
  /(^|[^a-z0-9])(ad|ads|advert|adverts|advertisement|advertising|adsense|adslot|ad-slot|ad_slot|sponsor|sponsored|sponsorship|dfp|gpt|doubleclick|taboola|trc|outbrain|ob-widget|mgid|mgwidget|mgbox|mgline|mgheader|revcontent|zergnet|adblade|contentad|nativeads|native-ad|adsbygoogle)(?![a-z0-9])/i;
export const WEAK_TOKEN_RE = /(^|[^a-z0-9])(banner|promo|promotion|promoted)(?![a-z0-9])/i;
export const SPONSORED_TEXT_RE =
  /^\s*(sponsored|promoted|advertisement|advertisements|ad|ads|paid partnership|paid post|paid content|sponsored content|presented by)\s*[:·•\-–—]?\s*$/i;

export const ADTECH_ATTRS = [
  "data-google-query-id",
  "data-ad-client",
  "data-ad-slot",
  "data-ad-unit",
  "data-adunit",
  "data-freestar-ad",
  "data-revive-zoneid",
  "data-taboola",
  "data-outbrain",
  "data-aaad",
  "data-ad",
];

/** Hosts whose iframes are never nominated (payments, auth, captcha, embeds, chat). */
export const NEVER_NOMINATE_HOSTS = [
  "stripe.com",
  "paypal.com",
  "paypalobjects.com",
  "adyen.com",
  "braintreegateway.com",
  "braintree-api.com",
  "checkout.com",
  "squareup.com",
  "klarna.com",
  "afterpay.com",
  "razorpay.com",
  "accounts.google.com",
  "appleid.apple.com",
  "login.microsoftonline.com",
  "auth0.com",
  "okta.com",
  "recaptcha.net",
  "hcaptcha.com",
  "challenges.cloudflare.com",
  "youtube.com",
  "youtube-nocookie.com",
  "player.vimeo.com",
  "vimeo.com",
  "open.spotify.com",
  "platform.twitter.com",
  "x.com",
  "twitter.com",
  "instagram.com",
  "disqus.com",
  "intercom.io",
  "intercomcdn.com",
  "crisp.chat",
  "drift.com",
  "zendesk.com",
  "zdassets.com",
  "hubspot.com",
  "hsforms.com",
  "typeform.com",
  "calendly.com",
  "maps.googleapis.com",
  "docs.google.com",
  "codepen.io",
  "codesandbox.io",
  "stackblitz.com",
  "figma.com",
  "loom.com",
  "wistia.com",
  "soundcloud.com",
];

export const PAYMENT_IFRAME_HOSTS = [
  "stripe.com",
  "paypal.com",
  "adyen.com",
  "braintreegateway.com",
  "checkout.com",
  "squareup.com",
  "klarna.com",
  "razorpay.com",
];
