import { describe, expect, it } from "vitest";
import { findCandidates } from "../../src/content/candidates";
import type { Measurer, Rect } from "../../src/content/measure";

const VP = { w: 1080, h: 1865 };

/** Layout comes from data-* attributes, since jsdom has no layout engine. */
const measurer: Measurer = {
  rect(el): Rect {
    const [top, left, width, height] = (el.getAttribute("data-rect") ?? "0,0,0,0").split(",").map(Number);
    return { top: top!, left: left!, width: width!, height: height! };
  },
  style(el) {
    return { position: el.getAttribute("data-pos") ?? "static", display: "block", visibility: "visible", zIndex: el.getAttribute("data-z") ?? "auto", opacity: "1" };
  },
  viewport: () => VP,
};

function find(html: string) {
  document.body.innerHTML = html;
  return findCandidates(document, { measurer, pageHost: "www.uol.com.br", seen: new WeakSet() });
}

describe("overlay candidates", () => {
  it("nominates a thin bottom consent bar whose class has no overlay word (UOL)", () => {
    const found = find(`<div id="wrap"><div class="banner-lgpd-consent-container" data-pos="fixed" data-z="29999999" data-rect="1795,0,1080,70">
      <div class="banner-lgpd-consent">Utilizamos cookies essenciais <button>OK</button></div></div></div>`);
    expect(found.map((f) => f.el.className)).toContain("banner-lgpd-consent-container");
    expect(found.find((f) => f.el.className === "banner-lgpd-consent-container")!.signals).toContain("overlay");
  });

  it("nominates the same bar when it is stacked above another fixed bar", () => {
    const found = find(`<div class="banner-lgpd-consent-container" data-pos="fixed" data-z="29999999" data-rect="1660,0,1080,70">Utilizamos cookies</div>`);
    expect(found.map((f) => f.el.className)).toEqual(["banner-lgpd-consent-container"]);
  });

  it("still ignores thin fixed boxes that are not edge bars", () => {
    const found = find(`<div class="cookie-note" data-pos="fixed" data-z="5" data-rect="600,300,400,60">Cookies</div>`);
    expect(found).toHaveLength(0);
  });
});

describe("full-screen modals", () => {
  // Structure of Google Funding Choices' ad-block recovery message as served on uol.com.br (05/10/2026).
  const FC = `<div class="fc-ab-root"><div class="fc-dialog-container" data-pos="fixed" data-z="2147483647" data-rect="0,0,1080,1865">
    <div class="fc-dialog-overlay"></div><div class="fc-ab-dialog fc-dialog" role="dialog" aria-label="Quer navegar sem anúncios?" data-pos="relative" data-rect="700,284,512,452">
    <h1 class="fc-dialog-headline-text">Quer navegar sem anúncios?</h1><button class="fc-button fc-button-whitelist">Não, prefiro permitir anúncios</button></div></div></div>`;

  it("nominates the fixed Funding Choices container, not its role=dialog child", () => {
    const found = find(FC);
    expect(found.map((f) => f.el.className)).toEqual(["fc-dialog-container"]);
  });
});
