import {
  ADTECH_ATTRS,
  IAB_SIZES,
  IAB_TOLERANCE,
  MAX_CANDIDATES_PER_SCAN,
  NEVER_NOMINATE_HOSTS,
  PAYMENT_IFRAME_HOSTS,
  SPONSORED_TEXT_RE,
  STRONG_TOKEN_RE,
  WEAK_TOKEN_RE,
} from "../shared/constants";
import { hostInList, hostnameOf, registrableDomain } from "../shared/sanitize";
import type { Signal } from "../shared/types";
import { containerOf } from "./describe";
import type { Measurer } from "./measure";

export interface Found {
  el: Element;
  signals: Signal[];
  /** Same-origin iframe document the element lives in, if not the top document. */
  frameDoc?: Document;
}

export interface FindOptions {
  measurer: Measurer;
  pageHost: string;
  /** Elements already analysed on this page; skipped. */
  seen: WeakSet<Element>;
  limit?: number;
  depth?: number;
  /** Called for every open shadow root discovered so the caller can watch it for lazy-loaded content. */
  onShadowRoot?: (root: ShadowRoot) => void;
}

const MAX_SHADOW_HOSTS = 60;

/** Elements with an open shadow root. Closed roots are invisible to extensions and are skipped by nature. */
function shadowHosts(doc: Document): Element[] {
  const out: Element[] = [];
  const walker = doc.createTreeWalker(doc.documentElement, NodeFilter.SHOW_ELEMENT);
  let n: Node | null;
  while ((n = walker.nextNode())) {
    if ((n as Element).shadowRoot) {
      out.push(n as Element);
      if (out.length >= MAX_SHADOW_HOSTS) break;
    }
  }
  return out;
}

const SIGNAL_PRIORITY: Record<Signal, number> = {
  third_party_iframe: 0,
  rel_sponsored: 1,
  adtech_attr: 1,
  iab_size: 2,
  sponsored_text: 3,
  ad_token: 4,
  overlay: 5,
  weak_token: 6,
};

// Signals strong enough to nominate on their own anywhere on the page.
const STANDALONE = new Set<Signal>(["third_party_iframe", "rel_sponsored", "adtech_attr"]);

const TOKEN_QUERY = [
  '[class*="ad" i]',
  '[id*="ad" i]',
  '[class*="spons" i]',
  '[id*="spons" i]',
  '[class*="promo" i]',
  '[id*="promo" i]',
  '[class*="banner" i]',
  '[id*="banner" i]',
  '[class*="taboola" i]',
  '[class*="outbrain" i]',
  '[class*="mgid" i]',
  '[class*="dfp" i]',
  '[class*="gpt" i]',
  '[id*="dfp" i]',
  '[id*="gpt" i]',
  '[id*="taboola" i]',
  '[id*="outbrain" i]',
  '[data-testid*="ad" i]',
].join(",");

const OVERLAY_QUERY = [
  '[class*="sticky" i]',
  '[class*="fixed" i]',
  '[class*="overlay" i]',
  '[class*="modal" i]',
  '[class*="popup" i]',
  '[class*="pop-up" i]',
  '[class*="toast" i]',
  '[class*="drawer" i]',
  '[class*="interstitial" i]',
  '[id*="overlay" i]',
  '[id*="modal" i]',
  '[id*="popup" i]',
  '[role="dialog"]',
  '[aria-modal="true"]',
  "body > *",
].join(",");

const LEAF_TEXT_QUERY = "span,small,p,div,a,b,strong,em,i,figcaption,h2,h3,h4,h5,h6,label,cite";

const SENSITIVE_INPUT = 'input[type="password"], input[type="email"], input[autocomplete^="cc-"], input[type="tel"], input[name*="card" i], input[name*="cvv" i]';

function attrBlob(el: Element): string {
  const parts = [el.id, el.getAttribute("class") ?? ""];
  for (const a of Array.from(el.attributes)) {
    if (a.name.startsWith("data-") || a.name === "aria-label") parts.push(a.name + "=" + a.value.slice(0, 64));
  }
  return parts.join(" ");
}

function matchesIab(w: number, h: number): boolean {
  return IAB_SIZES.some(([iw, ih]) => Math.abs(w - iw) <= IAB_TOLERANCE && Math.abs(h - ih) <= IAB_TOLERANCE);
}

/** Page-level sensitivity: never analyse pages with password fields or payment iframes. */
export function isSensitivePage(doc: Document): boolean {
  if (doc.querySelector('input[type="password"]')) return true;
  for (const f of Array.from(doc.querySelectorAll("iframe[src]"))) {
    const h = hostnameOf(f.getAttribute("src"));
    if (h && hostInList(h, PAYMENT_IFRAME_HOSTS)) return true;
  }
  return false;
}

function neverNominate(el: Element, tag: string): boolean {
  if (tag === "html" || tag === "body" || tag === "main" || tag === "article" || tag === "head") return true;
  if (el.hasAttribute("data-jb-id") || el.hasAttribute("data-jb-hidden") || el.hasAttribute("data-jb-snapping")) return true;
  if (el.hasAttribute("data-jb-snap-canvas")) return true;
  if (el.closest("[data-jb-hidden]")) return true;
  if (tag === "iframe") {
    const h = hostnameOf(el.getAttribute("src"));
    if (h && hostInList(h, NEVER_NOMINATE_HOSTS)) return true;
    return false;
  }
  if (el.querySelector(SENSITIVE_INPUT)) return true;
  if (el.querySelector("form input, form select, form textarea")) return true;
  if (el.matches("form, input, select, textarea, [contenteditable='true'], [contenteditable='']")) return true;
  if (el.querySelector("[contenteditable='true'], [contenteditable='']")) return true;
  if (el.matches("video[controls]") || el.querySelector("video[controls]")) return true;
  return false;
}

/**
 * Climb from a small "Sponsored" label (or sponsored link) to the card that contains it:
 * the outermost ancestor that still looks like a single card rather than a feed or the article.
 */
function cardAncestor(label: Element, m: Measurer): Element | undefined {
  let cur: Element | null = label.parentElement;
  let best: Element | undefined;
  for (let i = 0; cur && i < 7; i++) {
    const tag = cur.tagName.toLowerCase();
    if (tag === "body" || tag === "main" || tag === "article" || tag === "html" || tag === "section" && cur.querySelectorAll("a[href]").length > 8) break;
    const r = m.rect(cur);
    const links = cur.querySelectorAll("a[href]").length;
    const hasMedia = !!cur.querySelector("img, picture, video, svg");
    const textLen = (cur.textContent ?? "").trim().length;
    const qualifies = r.height >= 60 && r.width >= 180 && r.height <= 700 && links >= 1 && links <= 6 && textLen <= 600 && (hasMedia || links >= 1);
    if (qualifies) best = cur;
    else if (best) break; // we already had a card and this ancestor is a container of many
    cur = cur.parentElement;
  }
  return best;
}

function scanDocument(doc: Document | Element | ShadowRoot, opts: FindOptions, out: Map<Element, Set<Signal>>, frameDoc?: Document): void {
  const m = opts.measurer;
  const add = (el: Element, s: Signal) => {
    let set = out.get(el);
    if (!set) {
      set = new Set();
      out.set(el, set);
    }
    set.add(s);
  };
  const root: ParentNode = doc;
  const pageDomain = registrableDomain(opts.pageHost);

  // 1. iframes
  for (const f of Array.from(root.querySelectorAll("iframe"))) {
    const h = hostnameOf(f.getAttribute("src"));
    if (h && registrableDomain(h) !== pageDomain) add(f, "third_party_iframe");
    const r = m.rect(f);
    if (matchesIab(r.width, r.height)) add(f, "iab_size");
  }

  // 2. ad-tech attributes
  for (const attr of ADTECH_ATTRS) {
    for (const el of Array.from(root.querySelectorAll(`[${attr}]`))) add(el, "adtech_attr");
  }

  // 3. rel=sponsored → card
  for (const a of Array.from(root.querySelectorAll('a[rel~="sponsored" i]'))) {
    const card = cardAncestor(a, m) ?? a;
    add(card, "rel_sponsored");
  }

  // 4. id/class tokens
  for (const el of Array.from(root.querySelectorAll(TOKEN_QUERY))) {
    const blob = attrBlob(el);
    if (STRONG_TOKEN_RE.test(blob)) add(el, "ad_token");
    else if (WEAK_TOKEN_RE.test(blob)) add(el, "weak_token");
  }

  // 5. "Sponsored" labels
  for (const leaf of Array.from(root.querySelectorAll(LEAF_TEXT_QUERY))) {
    if (leaf.childElementCount > 1) continue;
    const t = (leaf.textContent ?? "").trim();
    if (!t || t.length > 40 || !SPONSORED_TEXT_RE.test(t)) continue;
    const card = cardAncestor(leaf, m);
    if (card) add(card, "sponsored_text");
  }

  // 6. overlays (fixed / sticky)
  const vp = m.viewport();
  for (const el of Array.from(root.querySelectorAll(OVERLAY_QUERY))) {
    const st = m.style(el);
    if (st.position !== "fixed" && st.position !== "sticky") continue;
    const r = m.rect(el);
    if (r.width < 200 || r.height < 80) continue;
    const z = parseInt(st.zIndex, 10);
    const coversViewport = (r.width * r.height) / Math.max(1, vp.w * vp.h) > 0.25;
    const isBar = r.width >= vp.w * 0.6 && (r.top <= 2 || r.top + r.height >= vp.h - 2);
    if ((Number.isFinite(z) && z >= 100) || coversViewport || isBar) add(el, "overlay");
  }

  // 7. Enrich token hits: IAB size, and a contained third-party iframe counts as the iframe signal.
  for (const el of Array.from(out.keys())) {
    if (el.tagName.toLowerCase() === "iframe") continue;
    const r = m.rect(el);
    if (matchesIab(r.width, r.height)) add(el, "iab_size");
    for (const f of Array.from(el.querySelectorAll("iframe[src]")).slice(0, 5)) {
      const h = hostnameOf(f.getAttribute("src"));
      if (h && registrableDomain(h) !== pageDomain && !hostInList(h, NEVER_NOMINATE_HOSTS)) {
        add(el, "third_party_iframe");
        break;
      }
    }
  }

  if (frameDoc) for (const el of out.keys()) (el as Element & { __jbFrame?: Document }).__jbFrame = frameDoc;
}

export function findCandidates(doc: Document, opts: FindOptions): Found[] {
  const raw = new Map<Element, Set<Signal>>();
  scanDocument(doc, opts, raw);

  // Native ad widgets (MGID, Taboola, Outbrain…) increasingly render inside an open shadow root on a bare
  // host element. Scan each shadow tree and pin whatever it finds onto the host, which is what we hide.
  for (const host of shadowHosts(doc)) {
    const root = host.shadowRoot!;
    opts.onShadowRoot?.(root);
    if (opts.seen.has(host) || host.closest("[data-jb-hidden]")) continue;
    const inner = new Map<Element, Set<Signal>>();
    scanDocument(root, opts, inner);
    const union = new Set<Signal>();
    for (const sigs of inner.values()) for (const s of sigs) union.add(s);
    // The host's own attributes count too (e.g. data-type="_mgwidget").
    const blob = attrBlob(host);
    if (STRONG_TOKEN_RE.test(blob)) union.add("ad_token");
    else if (WEAK_TOKEN_RE.test(blob)) union.add("weak_token");
    if (!union.size) continue;
    let set = raw.get(host);
    if (!set) {
      set = new Set();
      raw.set(host, set);
    }
    for (const s of union) set.add(s);
  }

  // Same-origin iframes, one level deep.
  if ((opts.depth ?? 0) < 1) {
    for (const f of Array.from(doc.querySelectorAll("iframe"))) {
      let inner: Document | null = null;
      try {
        inner = (f as HTMLIFrameElement).contentDocument;
      } catch {
        inner = null;
      }
      if (inner && inner.body && inner.body.childElementCount > 0) scanDocument(inner, { ...opts, depth: 1 }, raw, inner);
    }
  }

  const m = opts.measurer;
  const filtered: Found[] = [];
  for (const [el, sigSet] of raw) {
    if (opts.seen.has(el)) continue;
    const tag = el.tagName.toLowerCase();
    if (neverNominate(el, tag)) continue;
    const signals = [...sigSet].sort((a, b) => SIGNAL_PRIORITY[a] - SIGNAL_PRIORITY[b]);
    const strong = signals.filter((s) => s !== "weak_token");
    if (strong.length === 0) continue; // weak token alone never nominates
    const standalone = signals.some((s) => STANDALONE.has(s));
    const container = containerOf(el);
    if (!standalone && (container === "main" || container === "article") && signals.length < 2) continue;

    const r = m.rect(el);
    const st = m.style(el);
    if (r.width < 40 || r.height < 40) continue;
    if (st.display === "none" || st.visibility === "hidden" || st.opacity === "0") continue;

    const frameDoc = (el as Element & { __jbFrame?: Document }).__jbFrame;
    filtered.push(frameDoc ? { el, signals, frameDoc } : { el, signals });
  }

  // Keep outermost when nested; an ancestor analysed in an earlier scan also covers its descendants.
  const els = new Set(filtered.map((f) => f.el));
  const outermost = filtered.filter((f) => {
    let p = f.el.parentElement;
    while (p) {
      if (els.has(p) || opts.seen.has(p)) return false;
      p = p.parentElement;
    }
    return true;
  });

  outermost.sort((a, b) => SIGNAL_PRIORITY[a.signals[0]!] - SIGNAL_PRIORITY[b.signals[0]!] || b.signals.length - a.signals.length);
  return outermost.slice(0, opts.limit ?? MAX_CANDIDATES_PER_SCAN);
}
