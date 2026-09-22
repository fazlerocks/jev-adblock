import { describe, expect, it } from "vitest";
import { decideCached } from "../../src/background/decisions";
import { addSiteRule, applyRuleFeedback, getSiteRules } from "../../src/background/siteRules";
import { rulesAllowed } from "../../src/content/siteRules";
import { DEFAULT_SETTINGS, SITE_RULE_MAX_MATCHES } from "../../src/shared/constants";
import type { CacheEntry, RuntimeHealth, Settings } from "../../src/shared/types";

const S: Settings = { ...DEFAULT_SETTINGS, disclosureAccepted: true, snapEffect: false };
const H: RuntimeHealth = { keyInvalid: false, circuitOpenUntil: 0, consecutiveFailures: 0, offline: false, keyUpdatedAt: 0, hasKey: true };

describe("cached decisions follow current settings", () => {
  const consentEntry: CacheEntry = {
    label: "consent_or_popup",
    pAd: 0.95,
    confidence: 0.9,
    hide: true, // cached when consent hiding was on
    ts: Date.now(),
    hits: 1,
    ttlDays: 7,
    p: { display_ad: 0, sponsored_native: 0, consent_or_popup: 0.95, first_party_promo: 0, site_content: 0.05, site_ui: 0 },
  };
  it("stops hiding consent popups when the toggle is turned off", () => {
    expect(decideCached(consentEntry, { container: "body" }, { ...S, hideConsentPopups: true }).hide).toBe(true);
    expect(decideCached(consentEntry, { container: "body" }, { ...S, hideConsentPopups: false }).hide).toBe(false);
  });
  it("respects a raised threshold", () => {
    const e: CacheEntry = { ...consentEntry, label: "display_ad", p: { ...consentEntry.p!, consent_or_popup: 0, display_ad: 0.75, site_content: 0.25 } };
    expect(decideCached(e, { container: "aside" }, S).hide).toBe(true);
    expect(decideCached(e, { container: "aside" }, { ...S, thresholds: { ...S.thresholds, display_ad: 0.8 } }).hide).toBe(false);
  });
  it("keeps the stored verdict for legacy entries without probabilities", () => {
    const legacy: CacheEntry = { ...consentEntry, p: undefined };
    expect(decideCached(legacy, { container: "body" }, { ...S, hideConsentPopups: false }).hide).toBe(true);
  });
});

describe("pre-paint rule gate", () => {
  it("allows only when enabled, disclosed, keyed, snap off, and the host is not paused or excluded", () => {
    expect(rulesAllowed("a.com", S, H)).toBe(true);
    expect(rulesAllowed("a.com", { ...S, enabled: false }, H)).toBe(false);
    expect(rulesAllowed("a.com", { ...S, disclosureAccepted: false }, H)).toBe(false);
    expect(rulesAllowed("a.com", { ...S, snapEffect: true }, H)).toBe(false);
    expect(rulesAllowed("a.com", { ...S, pausedHosts: ["a.com"] }, H)).toBe(false);
    expect(rulesAllowed("www.a.com", { ...S, neverAnalyzeHosts: ["a.com"] }, H)).toBe(false);
    expect(rulesAllowed("a.com", S, { ...H, hasKey: false })).toBe(false);
    expect(rulesAllowed("a.com", S, { ...H, keyInvalid: true })).toBe(false);
    expect(rulesAllowed("a.com", undefined, H)).toBe(false);
  });
});

describe("site rules self-correct", () => {
  it("drops a rule whose selector now matches too many elements", async () => {
    await addSiteRule("a.com", { sel: "div.card.promo", fp: "f1" });
    await applyRuleFeedback("a.com", "div.card.promo", SITE_RULE_MAX_MATCHES + 1, null);
    expect(await getSiteRules("a.com")).toEqual([]);
  });
});
