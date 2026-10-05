import { afterEach, describe, expect, it, vi } from "vitest";
import { Hider } from "../../src/content/hider";

function modal(): HTMLElement {
  document.body.innerHTML = `<div id="m" style="position:fixed">Quer navegar sem anúncios?</div>`;
  const el = document.getElementById("m")!;
  vi.spyOn(el, "getBoundingClientRect").mockReturnValue({ width: innerWidth, height: innerHeight, top: 0, left: 0 } as DOMRect);
  return el;
}

describe("hiding a full-screen modal", () => {
  afterEach(() => {
    document.body.removeAttribute("style");
    document.documentElement.removeAttribute("style");
  });

  it("releases the scroll lock and puts it back on restore", () => {
    document.body.style.overflow = "hidden";
    const h = new Hider();
    h.hide("n1", modal(), "fp", "consent_or_popup", "modal", "jev", "display");
    expect(getComputedStyle(document.body).overflowY).not.toBe("hidden");
    h.restore("n1");
    expect(document.body.style.overflow).toBe("hidden");
  });

  it("leaves scrolling alone for elements that do not cover the viewport", () => {
    document.body.style.overflow = "hidden";
    document.body.innerHTML = `<div id="b" style="position:fixed">ad</div>`;
    new Hider().hide("n2", document.getElementById("b")!, "fp", "display_ad", "bar", "jev", "display");
    expect(document.body.style.overflow).toBe("hidden");
  });
});
