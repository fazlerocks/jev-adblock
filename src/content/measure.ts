/** Layout measurement seam so pure logic can be unit-tested without a layout engine (jsdom has none). */
export interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}

export interface Measurer {
  rect(el: Element): Rect;
  style(el: Element): { position: string; display: string; visibility: string; zIndex: string; opacity: string };
  viewport(): { w: number; h: number };
}

export const domMeasurer: Measurer = {
  rect(el) {
    const r = el.getBoundingClientRect();
    return { top: r.top, left: r.left, width: r.width, height: r.height };
  },
  style(el) {
    const cs = el.ownerDocument.defaultView?.getComputedStyle(el);
    return {
      position: cs?.position ?? "static",
      display: cs?.display ?? "block",
      visibility: cs?.visibility ?? "visible",
      zIndex: cs?.zIndex ?? "auto",
      opacity: cs?.opacity ?? "1",
    };
  },
  viewport() {
    return { w: window.innerWidth || document.documentElement.clientWidth, h: window.innerHeight || document.documentElement.clientHeight };
  },
};
