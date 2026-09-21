import { ADTECH_ATTRS, CAPS, IAB_SIZES, IAB_TOLERANCE, SITE_RULE_MAX_MATCHES } from "../shared/constants";
import { fingerprint, normaliseToken } from "../shared/fingerprint";
import { cleanText, cleanToken, hostnameOf } from "../shared/sanitize";
import type { Candidate, Container, Position, Signal } from "../shared/types";
import type { Measurer } from "./measure";

export interface DescribeContext {
  nid: string;
  signals: Signal[];
  measurer: Measurer;
  /** Whether a page-unique selector may be computed (only for the top document). */
  allowSelector: boolean;
}

const CONTAINER_TAGS = new Set(["main", "article", "aside", "nav", "header", "footer"]);
const CLOSE_RE = /(close|dismiss|schlie|fermer|cerrar)/i;

export function iabLabel(w: number, h: number): string | undefined {
  for (const [iw, ih, name] of IAB_SIZES) {
    if (Math.abs(w - iw) <= IAB_TOLERANCE && Math.abs(h - ih) <= IAB_TOLERANCE) return name;
  }
  return undefined;
}

export function containerOf(el: Element): Container {
  let cur: Element | null = el.parentElement;
  while (cur) {
    const t = cur.tagName.toLowerCase();
    if (CONTAINER_TAGS.has(t)) return t as Container;
    const role = cur.getAttribute("role");
    if (role === "main") return "main";
    if (role === "navigation") return "nav";
    if (role === "banner") return "header";
    if (role === "contentinfo") return "footer";
    if (role === "complementary") return "aside";
    cur = cur.parentElement;
  }
  return "body";
}

function positionOf(pos: string): Position {
  if (pos === "fixed" || pos === "sticky" || pos === "absolute") return pos;
  return "static";
}

function classList(el: Element): string[] {
  const out: string[] = [];
  for (const c of Array.from(el.classList)) {
    const t = cleanToken(c, CAPS.classLen);
    if (t) out.push(t);
    if (out.length >= CAPS.classes) break;
  }
  return out;
}

function hasCloseControl(el: Element): boolean {
  const btn = el.querySelector('button, [role="button"], a');
  if (!btn) return false;
  for (const b of Array.from(el.querySelectorAll('button, [role="button"], a')).slice(0, 12)) {
    const label = `${b.getAttribute("aria-label") ?? ""} ${b.getAttribute("title") ?? ""} ${b.className ?? ""} ${(b.textContent ?? "").trim().slice(0, 4)}`;
    if (CLOSE_RE.test(label) || /^[×✕✖x]$/i.test((b.textContent ?? "").trim())) return true;
  }
  return false;
}

/** Build a selector that is stable across loads and matches at most a few elements on the page. */
export function stableSelector(el: Element): string | undefined {
  const doc = el.ownerDocument;
  const tag = el.tagName.toLowerCase();
  const tryIt = (sel: string): string | undefined => {
    try {
      const matches = doc.querySelectorAll(sel);
      if (matches.length >= 1 && matches.length <= SITE_RULE_MAX_MATCHES && Array.from(matches).includes(el)) return sel;
    } catch {
      /* invalid selector */
    }
    return undefined;
  };
  if (el.id && normaliseToken(el.id) && !/\d{3,}/.test(el.id)) {
    const s = tryIt(`#${CSS.escape(el.id)}`);
    if (s) return s;
  }
  const classes = Array.from(el.classList).filter((c) => normaliseToken(c) && !/\d{3,}/.test(c));
  if (classes.length >= 2) {
    const s = tryIt(`${tag}.${classes.slice(0, 3).map((c) => CSS.escape(c)).join(".")}`);
    if (s) return s;
  }
  return undefined;
}

export function describe(el: Element, ctx: DescribeContext): Candidate {
  const m = ctx.measurer;
  const rect = m.rect(el);
  const style = m.style(el);
  const vp = m.viewport();
  const tag = el.tagName.toLowerCase();
  const isIframe = tag === "iframe";

  const id = el.id ? cleanToken(el.id, CAPS.idLen) : undefined;
  const classes = classList(el);
  const role = el.getAttribute("role") ?? undefined;
  const ariaLabel = cleanText(el.getAttribute("aria-label"), CAPS.aria);

  let iframeHost: string | undefined;
  let iframeTitle: string | undefined;
  if (isIframe) {
    iframeHost = hostnameOf(el.getAttribute("src"));
    iframeTitle = cleanText(el.getAttribute("title"), CAPS.iframeTitle);
  } else {
    // A wrapper around an ad iframe inherits the iframe's host: it is the strongest single signal Jev can see.
    for (const f of Array.from(el.querySelectorAll("iframe[src]")).slice(0, 5)) {
      const h = hostnameOf(f.getAttribute("src"));
      if (h) {
        iframeHost = h;
        iframeTitle = cleanText(f.getAttribute("title"), CAPS.iframeTitle);
        break;
      }
    }
  }

  const linkHostSet = new Set<string>();
  let relSponsored = false;
  let linkTextLen = 0;
  for (const a of Array.from(el.querySelectorAll("a[href]")).slice(0, 60)) {
    const h = hostnameOf(a.getAttribute("href") ? (a as HTMLAnchorElement).href : null);
    if (h && linkHostSet.size < CAPS.linkHosts) linkHostSet.add(h);
    const rel = a.getAttribute("rel") ?? "";
    if (/\bsponsored\b/i.test(rel)) relSponsored = true;
    linkTextLen += (a.textContent ?? "").trim().length;
  }
  const linkHosts = [...linkHostSet];

  const adTechAttrs: string[] = [];
  for (const attr of ADTECH_ATTRS) {
    if (el.hasAttribute(attr) || el.parentElement?.hasAttribute(attr)) adTechAttrs.push(attr);
  }

  const rawText = isIframe ? "" : ((el as HTMLElement).innerText ?? el.textContent ?? "");
  const text = cleanText(rawText, CAPS.text);
  const totalLen = rawText.trim().length;
  const textLinkRatio = totalLen > 0 ? Math.min(1, linkTextLen / totalLen) : 0;

  const imgCount = Math.min(20, el.querySelectorAll("img, picture, [role='img']").length + (tag === "img" ? 1 : 0));
  const hasVideo = tag === "video" || !!el.querySelector("video");
  const container = containerOf(el);

  const c: Candidate = {
    nid: ctx.nid,
    fp: "",
    tag,
    w: Math.round(rect.width),
    h: Math.round(rect.height),
    position: positionOf(style.position),
    aboveFold: rect.top < vp.h && rect.top + rect.height > 0,
    hasCloseControl: isIframe ? false : hasCloseControl(el),
    relSponsored,
    adTechAttrs,
    textLinkRatio,
    imgCount,
    hasVideo,
    container,
    signals: [...ctx.signals],
  };
  if (id) c.id = id;
  if (classes.length) c.classes = classes;
  if (role) c.role = role.slice(0, 32);
  if (ariaLabel) c.ariaLabel = ariaLabel;
  const iab = iabLabel(rect.width, rect.height);
  if (iab) c.iab = iab;
  if (iframeHost) c.iframeHost = iframeHost;
  if (iframeTitle) c.iframeTitle = iframeTitle;
  if (linkHosts.length) c.linkHosts = linkHosts;
  if (text) c.text = text;
  if (ctx.allowSelector) {
    const sel = stableSelector(el);
    if (sel) c.sel = sel;
  }
  c.fp = fingerprint({ tag, id: el.id || undefined, classes: Array.from(el.classList), w: rect.width, h: rect.height, iframeHost, container });
  return c;
}

/** Short human-readable label for the popup list. */
export function summarise(c: Candidate): string {
  const bits: string[] = [];
  if (c.iframeHost) bits.push(`iframe from ${c.iframeHost}`);
  else bits.push(c.tag + (c.classes?.length ? "." + c.classes.slice(0, 2).join(".") : c.id ? "#" + c.id : ""));
  bits.push(`${c.w}×${c.h}`);
  if (c.text) bits.push(`“${c.text.slice(0, 60)}${c.text.length > 60 ? "…" : ""}”`);
  return bits.join(" · ");
}
