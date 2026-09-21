import { describe, expect, it } from "vitest";
import { addSiteRule, applyRuleFeedback, getSiteRules, purgeSiteRules, removeSiteRuleByFp } from "../../src/background/siteRules";
import { SITE_RULE_MAX_MISSES, SITE_RULE_MAX_PER_HOST } from "../../src/shared/constants";
import { ruleCss } from "../../src/content/siteRules";

describe("site rules", () => {
  it("adds, dedupes and caps per host", async () => {
    expect(await addSiteRule("a.com", { sel: "#ad", fp: "f1" })).toBe(true);
    expect(await addSiteRule("a.com", { sel: "#ad", fp: "f9" })).toBe(false);
    for (let i = 0; i < SITE_RULE_MAX_PER_HOST + 5; i++) await addSiteRule("a.com", { sel: `.x${i}.y`, fp: `x${i}` });
    expect((await getSiteRules("a.com")).length).toBe(SITE_RULE_MAX_PER_HOST);
  });
  it("drops a rule after repeated misses or when re-classified as not-ad", async () => {
    await addSiteRule("a.com", { sel: "#ad", fp: "f1" });
    for (let i = 0; i < SITE_RULE_MAX_MISSES; i++) await applyRuleFeedback("a.com", "#ad", 0, null);
    expect(await getSiteRules("a.com")).toEqual([]);
    await addSiteRule("a.com", { sel: "#ad2", fp: "f2" });
    await applyRuleFeedback("a.com", "#ad2", 1, false);
    expect(await getSiteRules("a.com")).toEqual([]);
  });
  it("resets misses on a match", async () => {
    await addSiteRule("a.com", { sel: "#ad", fp: "f1" });
    await applyRuleFeedback("a.com", "#ad", 0, null);
    await applyRuleFeedback("a.com", "#ad", 2, null);
    expect((await getSiteRules("a.com"))[0]!.misses).toBe(0);
  });
  it("removes by fingerprint and purges by host", async () => {
    await addSiteRule("a.com", { sel: "#ad", fp: "f1" });
    await addSiteRule("a.com", { sel: "#ad2", fp: "f2" });
    await removeSiteRuleByFp("a.com", "f1");
    expect((await getSiteRules("a.com")).map((r) => r.fp)).toEqual(["f2"]);
    await purgeSiteRules("a.com");
    expect(await getSiteRules("a.com")).toEqual([]);
  });
  it("emits high-specificity css", () => {
    expect(ruleCss(["#ad", "div.a.b"])).toContain("html #ad:not(#\\9){display:none!important}");
  });
});
