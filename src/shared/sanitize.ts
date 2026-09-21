// Backticks (Jev state addressing), ASCII/C1 control chars, zero-width and line/paragraph separators.
const cc = (n: number) => String.fromCharCode(n);
const UNSAFE_RE = new RegExp(
  "[`" + cc(0) + "-" + cc(31) + cc(127) + "-" + cc(159) + cc(0x200b) + "-" + cc(0x200f) + cc(0x2028) + cc(0x2029) + cc(0xfeff) + "]",
  "g",
);

/** Remove characters that could confuse Jev's state addressing or inject structure, then cap length. */
export function cleanText(input: string | null | undefined, max: number): string | undefined {
  if (!input) return undefined;
  const s = input.replace(UNSAFE_RE, " ").replace(/\s+/g, " ").trim();
  if (!s) return undefined;
  return s.length > max ? s.slice(0, max - 1).trimEnd() + "…" : s;
}

export function cleanToken(input: string, max: number): string | undefined {
  const s = input.replace(/[^\w\-:.]/g, "").slice(0, max);
  return s || undefined;
}

export function hostnameOf(url: string | null | undefined): string | undefined {
  if (!url) return undefined;
  try {
    const u = new URL(url, "https://invalid.local/");
    if (u.protocol !== "http:" && u.protocol !== "https:") return undefined;
    if (u.hostname === "invalid.local") return undefined;
    return u.hostname.toLowerCase();
  } catch {
    return undefined;
  }
}

/** Crude registrable-domain approximation: last two labels, or three for common second-level TLDs. */
export function registrableDomain(host: string): string {
  const parts = host.toLowerCase().split(".").filter(Boolean);
  if (parts.length <= 2) return parts.join(".");
  const sld = parts[parts.length - 2]!;
  const tld = parts[parts.length - 1]!;
  const twoLevel = new Set(["co", "com", "org", "net", "gov", "edu", "ac", "or", "ne", "go"]);
  if (tld.length === 2 && twoLevel.has(sld) && parts.length >= 3) return parts.slice(-3).join(".");
  return parts.slice(-2).join(".");
}

export function hostMatches(host: string, pattern: string): boolean {
  const p = pattern.trim().toLowerCase();
  if (!p || p.includes("/")) return false;
  if (p.startsWith("*.")) {
    const base = p.slice(2);
    return host === base || host.endsWith("." + base);
  }
  return host === p || host.endsWith("." + p);
}

export function hostInList(host: string, list: readonly string[]): boolean {
  return list.some((p) => hostMatches(host, p));
}
