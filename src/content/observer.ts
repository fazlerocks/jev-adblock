import { MUTATION_DEBOUNCE_MS } from "../shared/constants";

export interface ObserverHandle {
  stop(): void;
  start(): void;
}

/**
 * Watches for added subtrees and SPA navigations.
 * onAdded receives the roots of newly inserted subtrees (debounced); onUrlChange fires when location changes.
 */
export function createObserver(onAdded: (roots: Element[]) => void, onUrlChange: (url: string) => void): ObserverHandle {
  let pending = new Set<Element>();
  let timer: number | undefined;
  let lastUrl = location.href;
  let active = false;

  const flush = () => {
    timer = undefined;
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      pending = new Set();
      onUrlChange(lastUrl);
      return;
    }
    if (!pending.size) return;
    const roots = [...pending].filter((el) => el.isConnected && !el.closest("[data-jb-hidden]"));
    pending = new Set();
    if (roots.length) onAdded(roots);
  };

  const schedule = () => {
    if (timer !== undefined) return;
    timer = window.setTimeout(flush, MUTATION_DEBOUNCE_MS);
  };

  const mo = new MutationObserver((records) => {
    for (const rec of records) {
      for (const n of Array.from(rec.addedNodes)) {
        if (n.nodeType !== Node.ELEMENT_NODE) continue;
        const el = n as Element;
        if (el.id === "jb-site-rules" || el.hasAttribute("data-jb-hidden")) continue;
        pending.add(el);
      }
    }
    if (pending.size) schedule();
  });

  const checkUrl = () => {
    if (location.href !== lastUrl) schedule();
  };

  // Detect pushState/replaceState navigations without touching page globals in a way scripts can observe.
  const nav = (window as Window & { navigation?: EventTarget }).navigation;
  const start = () => {
    if (active) return;
    active = true;
    mo.observe(document.documentElement, { childList: true, subtree: true });
    window.addEventListener("popstate", checkUrl);
    window.addEventListener("hashchange", checkUrl);
    nav?.addEventListener("navigatesuccess", checkUrl);
  };
  const stop = () => {
    if (!active) return;
    active = false;
    mo.disconnect();
    window.removeEventListener("popstate", checkUrl);
    window.removeEventListener("hashchange", checkUrl);
    nav?.removeEventListener("navigatesuccess", checkUrl);
    if (timer !== undefined) {
      clearTimeout(timer);
      timer = undefined;
    }
  };

  // Fallback for frameworks that call history.pushState without the navigation API: poll cheaply.
  window.setInterval(checkUrl, 1500);

  window.addEventListener("pagehide", stop);
  window.addEventListener("pageshow", start);
  return { start, stop };
}
