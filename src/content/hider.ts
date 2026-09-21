import type { Category, HiddenItem, VerdictSource } from "../shared/types";

interface Entry {
  el: Element;
  fp: string;
  label: Category;
  summary: string;
  source: VerdictSource;
  prevDisplay: string;
  prevPriority: string;
  prevVisibility: string;
}

export type CollapseMode = "display" | "visibility";

export class Hider {
  private readonly entries = new Map<string, Entry>();

  hide(nid: string, el: Element, fp: string, label: Category, summary: string, source: VerdictSource, mode: CollapseMode): void {
    if (this.entries.has(nid)) return;
    const h = el as HTMLElement;
    const prevDisplay = h.style.getPropertyValue("display");
    const prevPriority = h.style.getPropertyPriority("display");
    const prevVisibility = h.style.getPropertyValue("visibility");
    el.setAttribute("data-jb-id", nid);
    if (mode === "visibility") {
      el.setAttribute("data-jb-hidden", "__collapse");
      h.style.setProperty("visibility", "hidden", "important");
    } else {
      el.setAttribute("data-jb-hidden", label);
      h.style.setProperty("display", "none", "important");
    }
    this.entries.set(nid, { el, fp, label, summary, source, prevDisplay, prevPriority, prevVisibility });
  }

  restore(nid: string): boolean {
    const e = this.entries.get(nid);
    if (!e) return false;
    const h = e.el as HTMLElement;
    h.style.removeProperty("display");
    if (e.prevDisplay) h.style.setProperty("display", e.prevDisplay, e.prevPriority);
    h.style.removeProperty("visibility");
    if (e.prevVisibility) h.style.setProperty("visibility", e.prevVisibility);
    e.el.removeAttribute("data-jb-hidden");
    e.el.removeAttribute("data-jb-id");
    e.el.setAttribute("data-jb-restored", "");
    this.entries.delete(nid);
    return true;
  }

  restoreByFp(fp: string): string[] {
    const nids = [...this.entries.entries()].filter(([, e]) => e.fp === fp).map(([nid]) => nid);
    for (const nid of nids) this.restore(nid);
    return nids;
  }

  has(nid: string): boolean {
    return this.entries.has(nid);
  }

  list(): HiddenItem[] {
    return [...this.entries.entries()].map(([nid, e]) => ({ nid, fp: e.fp, label: e.label, summary: e.summary, source: e.source }));
  }

  get size(): number {
    return this.entries.size;
  }
}
