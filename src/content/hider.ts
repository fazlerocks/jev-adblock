import type { Category, HiddenItem, VerdictSource } from "../shared/types";
import { snapOut } from "./snap";

interface Entry {
  el: Element;
  fp: string;
  label: Category;
  summary: string;
  source: VerdictSource;
  prevDisplay: string;
  prevPriority: string;
  prevVisibility: string;
  cancelSnap?: () => void;
  finalized: boolean;
}

export type CollapseMode = "display" | "visibility";

export class Hider {
  private readonly entries = new Map<string, Entry>();

  hide(nid: string, el: Element, fp: string, label: Category, summary: string, source: VerdictSource, mode: CollapseMode, snap = false): void {
    if (this.entries.has(nid)) return;
    const h = el as HTMLElement;
    const entry: Entry = {
      el,
      fp,
      label,
      summary,
      source,
      prevDisplay: h.style.getPropertyValue("display"),
      prevPriority: h.style.getPropertyPriority("display"),
      prevVisibility: h.style.getPropertyValue("visibility"),
      finalized: false,
    };
    el.setAttribute("data-jb-id", nid);
    this.entries.set(nid, entry);

    const finalize = () => {
      if (entry.finalized || !this.entries.has(nid)) return;
      entry.finalized = true;
      entry.cancelSnap = undefined;
      if (mode === "visibility") {
        el.setAttribute("data-jb-hidden", "__collapse");
        h.style.setProperty("visibility", "hidden", "important");
      } else {
        el.setAttribute("data-jb-hidden", label);
        h.style.setProperty("display", "none", "important");
      }
    };

    if (!snap) {
      finalize();
      return;
    }
    void snapOut(el, { onCancel: (cancel) => (entry.cancelSnap = cancel), collapse: mode === "display" }).then(finalize);
  }

  restore(nid: string): boolean {
    const e = this.entries.get(nid);
    if (!e) return false;
    // Restoring during the animation: stop it and put the element back untouched.
    this.entries.delete(nid);
    e.cancelSnap?.();
    const h = e.el as HTMLElement;
    h.style.removeProperty("display");
    if (e.prevDisplay) h.style.setProperty("display", e.prevDisplay, e.prevPriority);
    h.style.removeProperty("visibility");
    if (e.prevVisibility) h.style.setProperty("visibility", e.prevVisibility);
    e.el.removeAttribute("data-jb-hidden");
    e.el.removeAttribute("data-jb-id");
    e.el.setAttribute("data-jb-restored", "");
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
