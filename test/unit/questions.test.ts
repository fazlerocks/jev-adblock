import { describe, expect, it } from "vitest";
import { buildRequest, estimateTokens, toStateEntry } from "../../src/shared/jev/questions";
import type { Candidate } from "../../src/shared/types";

const cand = (i: number, over: Partial<Candidate> = {}): Candidate => ({
  nid: `n${i}`,
  fp: `fp${i}`,
  tag: "div",
  id: "ad-slot-1",
  classes: ["card", "card--promo"],
  w: 600,
  h: 180,
  position: "static",
  aboveFold: true,
  hasCloseControl: false,
  linkHosts: ["outbrain.com"],
  relSponsored: true,
  adTechAttrs: [],
  text: "Sponsored · Meet the SUV built for everything. Learn more about the all-new model today and save big.",
  textLinkRatio: 0.9,
  imgCount: 1,
  hasVideo: false,
  container: "main",
  signals: ["sponsored_text", "rel_sponsored"],
  sel: "#ad-slot-1",
  ...over,
});

describe("buildRequest", () => {
  it("emits one choice question per candidate referencing candidates[i]", () => {
    const req = buildRequest("jev-latest", { host: "example.com", title: "T" }, [cand(0), cand(1)]);
    expect(Object.keys(req.questions)).toEqual(["c0", "c1"]);
    expect(req.questions.c1!.instructions).toContain("`candidates[1]`");
    expect(req.questions.c0!.type).toBe("choice");
    expect(Object.keys((req.questions.c0 as { criteria: object }).criteria)).toHaveLength(6);
  });
  it("strips identity and selector fields from the state", () => {
    const e = toStateEntry(cand(0), 0);
    expect(e).not.toHaveProperty("nid");
    expect(e).not.toHaveProperty("fp");
    expect(e).not.toHaveProperty("sel");
    expect(e).not.toHaveProperty("id");
    expect(e.link_hosts).toEqual(["outbrain.com"]);
  });
  it("keeps a 40-candidate batch far under the 32k state+question limit", () => {
    const cands = Array.from({ length: 40 }, (_, i) => cand(i));
    const req = buildRequest("jev-latest", { host: "example.com", title: "A fairly long page title for testing" }, cands);
    const tokens = estimateTokens(req);
    expect(tokens).toBeLessThan(32_000);
    // state alone plus one question must fit the 32k rule too
    const stateTokens = Math.ceil(JSON.stringify(req.state).length / 4);
    expect(stateTokens).toBeLessThan(16_000);
  });
});
