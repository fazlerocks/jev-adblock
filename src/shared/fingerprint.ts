import { CAPS } from "./constants";

export function fnv1a(str: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

// Hex hashes, long base64-ish blobs, CSS-in-JS classes, framework-generated ids.
const GENERATED_RE = /^(?:[a-f0-9]{8,}|[A-Za-z0-9_-]{20,}|_[A-Za-z0-9]{5,}|css-[a-z0-9]+|sc-[a-zA-Z0-9]+|jsx-\d+|[a-z]{1,3}\d{4,})$/;

/** Normalise an id/class token for fingerprinting: strip digits, drop generated-looking tokens. */
export function normaliseToken(tok: string): string | undefined {
  if (!tok) return undefined;
  if (GENERATED_RE.test(tok)) return undefined;
  const stripped = tok
    .replace(/\d+/g, "")
    .replace(/[-_]{2,}/g, "-")
    .replace(/^[-_]+|[-_]+$/g, "");
  if (stripped.length < 2) return undefined;
  return stripped.toLowerCase();
}

export function aspectClass(w: number, h: number): string {
  if (w <= 0 || h <= 0) return "none";
  const r = w / h;
  if (r >= 6) return "leaderboard";
  if (r >= 2.2) return "wide";
  if (r > 0.75) return "square";
  if (r > 0.3) return "tall";
  return "skyscraper";
}

/** Coarse size tier: each tier spans a 4x range of area, so responsive reflow rarely changes it. */
export function sizeTier(w: number, h: number): string {
  const area = Math.max(1, w * h);
  return "t" + Math.round(Math.log2(area) / 2);
}

export interface FingerprintInput {
  tag: string;
  id?: string;
  classes?: string[];
  w: number;
  h: number;
  iframeHost?: string;
  container: string;
}

export function fingerprint(c: FingerprintInput): string {
  const id = c.id ? normaliseToken(c.id) : undefined;
  const classes = (c.classes ?? [])
    .map(normaliseToken)
    .filter((x): x is string => !!x)
    .sort()
    .slice(0, CAPS.classes);
  const parts = [
    c.tag.toLowerCase(),
    id ?? "",
    classes.join("."),
    aspectClass(c.w, c.h),
    sizeTier(c.w, c.h),
    c.iframeHost ?? "",
    c.container,
  ];
  return fnv1a(parts.join("|"));
}
