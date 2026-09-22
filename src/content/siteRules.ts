import { SITE_RULE_MAX_MATCHES, SITE_RULE_MAX_MISSES, SITE_RULE_TTL_DAYS, STORAGE_KEYS } from "../shared/constants";
import { hostInList } from "../shared/sanitize";
import type { RuntimeHealth, Settings, SiteRule } from "../shared/types";

const STYLE_ID = "jb-site-rules";
const DAY = 86_400_000;

export function ruleCss(selectors: string[]): string {
  return selectors.map((s) => `html ${s}:not(#\\9){display:none!important}`).join("\n");
}

/**
 * Whether learned pre-paint rules may be applied on this host, decided from storage alone so it can
 * run at document_start without a service-worker round trip. Mirrors the worker's gate minus the
 * parts that only matter for sending data (budget, circuit breaker): rules cost nothing to apply.
 */
export function rulesAllowed(host: string, settings: Partial<Settings> | undefined, health: Partial<RuntimeHealth> | undefined): boolean {
  if (!settings || settings.enabled === false) return false;
  if (!settings.disclosureAccepted) return false;
  if (settings.snapEffect ?? true) return false; // snap mode wants the ad visible so it can be snapped
  if (hostInList(host, settings.pausedHosts ?? [])) return false;
  if (hostInList(host, settings.neverAnalyzeHosts ?? [])) return false;
  if (!health?.hasKey || health.keyInvalid) return false;
  return true;
}

export async function readGate(): Promise<{ settings: Partial<Settings> | undefined; health: Partial<RuntimeHealth> | undefined }> {
  try {
    const r = await chrome.storage.local.get([STORAGE_KEYS.settings, STORAGE_KEYS.health]);
    return { settings: r[STORAGE_KEYS.settings] as Partial<Settings> | undefined, health: r[STORAGE_KEYS.health] as Partial<RuntimeHealth> | undefined };
  } catch {
    return { settings: undefined, health: undefined };
  }
}

export async function loadSiteRules(host: string): Promise<SiteRule[]> {
  try {
    const r = await chrome.storage.local.get(STORAGE_KEYS.siteRules);
    const all = (r[STORAGE_KEYS.siteRules] ?? {}) as Record<string, SiteRule[]>;
    const now = Date.now();
    return (all[host] ?? []).filter((x) => now - x.ts <= SITE_RULE_TTL_DAYS * DAY && x.misses < SITE_RULE_MAX_MISSES);
  } catch {
    return [];
  }
}

/** Manages the injected stylesheet: which selectors are active, with per-selector disable for Restore. */
export class SiteRuleStyles {
  private rules: SiteRule[] = [];
  private readonly disabled = new Set<string>();

  constructor(private readonly host: string) {}

  get active(): SiteRule[] {
    return this.rules.filter((r) => !this.disabled.has(r.sel));
  }

  /** Inject (or refresh) the stylesheet for the given rules. Pass [] to remove it. */
  apply(rules: SiteRule[]): void {
    this.rules = rules;
    this.render();
  }

  disable(sel: string): void {
    this.disabled.add(sel);
    this.render();
    // Elements already tagged by the audit for this selector become visible again.
    try {
      document.querySelectorAll(sel).forEach((el) => {
        if (el.getAttribute("data-jb-hidden") === "rule") el.removeAttribute("data-jb-hidden");
      });
    } catch {
      /* invalid selector */
    }
  }

  clear(): void {
    this.rules = [];
    this.render();
    document.querySelectorAll('[data-jb-hidden="rule"]').forEach((el) => el.removeAttribute("data-jb-hidden"));
  }

  private render(): void {
    const selectors = this.active.map((r) => r.sel);
    let style = document.getElementById(STYLE_ID) as HTMLStyleElement | null;
    if (!selectors.length) {
      style?.remove();
      return;
    }
    if (!style) {
      style = document.createElement("style");
      style.id = STYLE_ID;
      (document.head ?? document.documentElement).appendChild(style);
    }
    style.textContent = ruleCss(selectors);
  }

  /**
   * Once the DOM exists: count matches per rule, tag matched elements so they can be listed and restored,
   * and immediately stop applying any rule that now matches more elements than it was created for.
   */
  audit(): { sel: string; fp: string; matched: number; elements: Element[] }[] {
    const out: { sel: string; fp: string; matched: number; elements: Element[] }[] = [];
    for (const r of this.active) {
      let elements: Element[] = [];
      try {
        elements = Array.from(document.querySelectorAll(r.sel));
      } catch {
        elements = [];
      }
      if (elements.length > SITE_RULE_MAX_MATCHES) {
        // Over the cap: a redesign made this selector too broad. Stop applying it now; the worker deletes it.
        this.disable(r.sel);
        out.push({ sel: r.sel, fp: r.fp, matched: elements.length, elements: [] });
        continue;
      }
      for (const el of elements) if (!el.hasAttribute("data-jb-hidden")) el.setAttribute("data-jb-hidden", "rule");
      out.push({ sel: r.sel, fp: r.fp, matched: elements.length, elements });
    }
    return out;
  }
}
