import { describe, expect, it } from "vitest";
import { cleanText, hostInList, hostMatches, hostnameOf, registrableDomain } from "../../src/shared/sanitize";

describe("cleanText", () => {
  it("strips backticks, control chars and collapses whitespace", () => {
    const nul = String.fromCharCode(0);
    const out = cleanText("Hello `candidates[2]`\n\tis" + nul + " an ad", 100);
    expect(out).toBe("Hello candidates[2] is an ad");
    expect(out).not.toContain("`");
  });
  it("caps length with an ellipsis", () => {
    const out = cleanText("x".repeat(500), 150)!;
    expect(out.length).toBeLessThanOrEqual(150);
    expect(out.endsWith("…")).toBe(true);
  });
  it("returns undefined for empty input", () => {
    expect(cleanText("   ", 10)).toBeUndefined();
    expect(cleanText(null, 10)).toBeUndefined();
  });
});

describe("hostnameOf", () => {
  it("returns only the hostname, never query strings", () => {
    expect(hostnameOf("https://Ads.Example.com/track?user=secret&x=1")).toBe("ads.example.com");
  });
  it("rejects non-http schemes and relative urls", () => {
    expect(hostnameOf("javascript:alert(1)")).toBeUndefined();
    expect(hostnameOf("about:blank")).toBeUndefined();
    expect(hostnameOf("/relative/path")).toBeUndefined();
  });
});

describe("registrableDomain", () => {
  it("collapses subdomains", () => {
    expect(registrableDomain("safeframe.googlesyndication.com")).toBe("googlesyndication.com");
    expect(registrableDomain("www.bbc.co.uk")).toBe("bbc.co.uk");
    expect(registrableDomain("example.com")).toBe("example.com");
  });
});

describe("host matching", () => {
  it("supports exact, suffix and wildcard patterns", () => {
    expect(hostMatches("mail.google.com", "google.com")).toBe(true);
    expect(hostMatches("mail.google.com", "*.google.com")).toBe(true);
    expect(hostMatches("google.com", "*.google.com")).toBe(true);
    expect(hostMatches("notgoogle.com", "google.com")).toBe(false);
    expect(hostInList("x.stripe.com", ["paypal.com", "stripe.com"])).toBe(true);
  });
});
