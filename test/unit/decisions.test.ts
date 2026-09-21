import { describe, expect, it } from "vitest";
import { decide, toCacheEntry } from "../../src/background/decisions";
import { DEFAULT_SETTINGS } from "../../src/shared/constants";
import type { ChoiceAnswer } from "../../src/shared/jev/types";
import type { Category, Settings } from "../../src/shared/types";

const P = (p: Partial<Record<Category, number>>, confidence = 0.9): ChoiceAnswer => {
  const probs = { display_ad: 0, sponsored_native: 0, consent_or_popup: 0, first_party_promo: 0, site_content: 0, site_ui: 0, ...p };
  const choice = (Object.entries(probs) as [Category, number][]).sort((a, b) => b[1] - a[1])[0]![0];
  return { type: "choice", choice, probabilities: probs, confidence };
};
const S: Settings = { ...DEFAULT_SETTINGS, disclosureAccepted: true };
const aside = { container: "aside" as const };
const main = { container: "main" as const };

describe("decide", () => {
  it("hides a confident display ad", () => {
    const d = decide(P({ display_ad: 0.93, site_content: 0.05, site_ui: 0.02 }), aside, S);
    expect(d.hide).toBe(true);
    expect(d.label).toBe("display_ad");
  });
  it("aggregates ad categories instead of using argmax alone", () => {
    // argmax is display_ad at 0.45 (< 0.70) but P(ad) = 0.85
    const d = decide(P({ display_ad: 0.45, sponsored_native: 0.4, site_content: 0.1, site_ui: 0.05 }), aside, S);
    expect(d.pAd).toBeCloseTo(0.85);
    expect(d.hide).toBe(true);
  });
  it("respects the margin guard", () => {
    const d = decide(P({ display_ad: 0.6, site_content: 0.4 }), aside, S);
    expect(d.hide).toBe(false); // 0.6 - 0.4 = 0.2 < 0.35
  });
  it("raises the bar inside main/article", () => {
    const answer = P({ display_ad: 0.75, site_content: 0.2, site_ui: 0.05 });
    expect(decide(answer, aside, S).hide).toBe(true);
    expect(decide(answer, main, S).hide).toBe(false); // needs 0.80 in main
  });
  it("never hides consent popups or first-party promos unless enabled", () => {
    const consent = P({ consent_or_popup: 0.97, site_ui: 0.03 });
    expect(decide(consent, aside, S).hide).toBe(false);
    expect(decide(consent, aside, { ...S, hideConsentPopups: true }).hide).toBe(true);
    const promo = P({ first_party_promo: 0.95, site_content: 0.05 });
    expect(decide(promo, aside, S).hide).toBe(false);
    expect(decide(promo, aside, { ...S, hideFirstPartyPromo: true }).hide).toBe(true);
  });
  it("applies the confidence floor", () => {
    const d = decide(P({ display_ad: 0.9, site_content: 0.1 }, 0.2), aside, S);
    expect(d.hide).toBe(false);
  });
  it("falls back to confidence when probabilities are missing", () => {
    const a: ChoiceAnswer = { type: "choice", choice: "display_ad", confidence: 0.92 };
    expect(decide(a, aside, S).hide).toBe(true);
    const b: ChoiceAnswer = { type: "choice", choice: "display_ad", confidence: 0.6 };
    expect(decide(b, aside, S).hide).toBe(false);
  });
  it("never hides safe categories", () => {
    expect(decide(P({ site_content: 0.99 }), aside, S).hide).toBe(false);
    expect(decide(P({ site_ui: 0.99 }), aside, S).hide).toBe(false);
  });
});

describe("toCacheEntry", () => {
  it("uses long TTL for positives and confident negatives, short for uncertain", () => {
    expect(toCacheEntry(decide(P({ display_ad: 0.95, site_content: 0.05 }), aside, S))!.ttlDays).toBe(7);
    expect(toCacheEntry(decide(P({ site_content: 0.9, site_ui: 0.1 }), aside, S))!.ttlDays).toBe(7);
    expect(toCacheEntry(decide(P({ display_ad: 0.5, site_content: 0.5 }), aside, S))!.ttlDays).toBe(1);
  });
});
