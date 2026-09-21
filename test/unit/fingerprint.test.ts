import { describe, expect, it } from "vitest";
import { aspectClass, fingerprint, normaliseToken, sizeTier } from "../../src/shared/fingerprint";

describe("normaliseToken", () => {
  it("strips digits so generated slot ids collide", () => {
    expect(normaliseToken("ad-slot-123")).toBe(normaliseToken("ad-slot-456"));
  });
  it("drops generated-looking tokens", () => {
    expect(normaliseToken("css-1x2y3z")).toBeUndefined();
    expect(normaliseToken("a1b2c3d4e5f6")).toBeUndefined();
    expect(normaliseToken("sc-bdVaJa")).toBeUndefined();
    expect(normaliseToken("card--promo")).toBe("card-promo");
  });
});

describe("fingerprint", () => {
  const base = { tag: "div", id: "ad-slot-1", classes: ["card", "card--promo"], w: 600, h: 180, container: "main" };
  it("is stable across digit changes and modest responsive reflow", () => {
    const a = fingerprint(base);
    const b = fingerprint({ ...base, id: "ad-slot-9", w: 640, h: 190 });
    expect(a).toBe(b);
  });
  it("differs across containers and iframe hosts", () => {
    expect(fingerprint(base)).not.toBe(fingerprint({ ...base, container: "aside" }));
    expect(fingerprint({ ...base, tag: "iframe", iframeHost: "a.com" })).not.toBe(fingerprint({ ...base, tag: "iframe", iframeHost: "b.com" }));
  });
  it("distinguishes very different shapes", () => {
    expect(aspectClass(728, 90)).toBe("leaderboard");
    expect(aspectClass(300, 250)).toBe("square");
    expect(aspectClass(160, 600)).toBe("skyscraper");
    expect(sizeTier(300, 250)).not.toBe(sizeTier(1200, 1000));
  });
});
