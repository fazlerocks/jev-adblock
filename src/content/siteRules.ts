import { SITE_RULE_MAX_MISSES, SITE_RULE_TTL_DAYS, STORAGE_KEYS } from "../shared/constants";
import type { SiteRule } from "../shared/types";

const STYLE_ID = "jb-site-rules";
const DAY = 86_400_000;

export function ruleCss(selectors: string[]): string {
  return selectors.map((s) => `html ${s}:not(#\\9){display:none!important}`).join("\n");
}

/** Read this host's materialised rules straight from storage (no service-worker hop) and inject before first paint. */
export async function injectSiteRules(host: string): Promise<SiteRule[]> {
  let rules: SiteRule[] = [];
  try {
    const r = await chrome.storage.local.get(STORAGE_KEYS.siteRules);
    const all = (r[STORAGE_KEYS.siteRules] ?? {}) as Record<string, SiteRule[]>;
    const now = Date.now();
    rules = (all[host] ?? []).filter((x) => now - x.ts <= SITE_RULE_TTL_DAYS * DAY && x.misses < SITE_RULE_MAX_MISSES);
  } catch {
    return [];
  }
  if (!rules.length) return [];
  let style = document.getElementById(STYLE_ID) as HTMLStyleElement | null;
  if (!style) {
    style = document.createElement("style");
    style.id = STYLE_ID;
    (document.head ?? document.documentElement).appendChild(style);
  }
  style.textContent = ruleCss(rules.map((r) => r.sel));
  return rules;
}

export function removeSiteRuleStyles(): void {
  document.getElementById(STYLE_ID)?.remove();
}

/** Count matches per rule once the DOM is ready, and tag them so the popup can count/restore them. */
export function auditSiteRules(rules: SiteRule[]): { sel: string; fp: string; matched: number }[] {
  return rules.map((r) => {
    let matched = 0;
    try {
      const els = document.querySelectorAll(r.sel);
      matched = els.length;
      els.forEach((el) => {
        if (!el.hasAttribute("data-jb-hidden")) el.setAttribute("data-jb-hidden", "rule");
      });
    } catch {
      matched = 0;
    }
    return { sel: r.sel, fp: r.fp, matched };
  });
}
