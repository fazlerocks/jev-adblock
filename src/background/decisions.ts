import {
  CONFIDENCE_FLOOR,
  CONTAINER_BUMP,
  MARGIN_GUARD,
  NEGATIVE_CACHE_MIN_SAFE,
  NEGATIVE_TTL_DAYS,
  POSITIVE_TTL_DAYS,
  UNCERTAIN_TTL_DAYS,
} from "../shared/constants";
import type { ChoiceAnswer } from "../shared/jev/types";
import type { CacheEntry, Candidate, Category, Settings } from "../shared/types";

const ALL: Category[] = ["display_ad", "sponsored_native", "consent_or_popup", "first_party_promo", "site_content", "site_ui"];

export interface Decision {
  label: Category;
  pAd: number;
  pSafe: number;
  confidence: number;
  hide: boolean;
  p?: Record<Category, number>;
}

function isCategory(x: string): x is Category {
  return (ALL as string[]).includes(x);
}

/** Normalise the answer into a full probability map over our categories. */
export function probabilitiesOf(answer: ChoiceAnswer): Record<Category, number> {
  const out = Object.fromEntries(ALL.map((c) => [c, 0])) as Record<Category, number>;
  const probs = answer.probabilities;
  if (probs && Object.keys(probs).length) {
    for (const [k, v] of Object.entries(probs)) if (isCategory(k) && Number.isFinite(v)) out[k] = Math.max(0, v);
  } else if (isCategory(answer.choice)) {
    // Fallback when the response omits probabilities: treat confidence as the chosen option's mass.
    const c = Math.min(1, Math.max(0, answer.confidence));
    out[answer.choice] = c;
    out.site_content += 1 - c;
  }
  return out;
}

export function decide(answer: ChoiceAnswer, candidate: Pick<Candidate, "container">, settings: Settings): Decision {
  const p = probabilitiesOf(answer);
  const hideConsent = settings.hideConsentPopups;
  const hidePromo = settings.hideFirstPartyPromo;

  const pAd = p.display_ad + p.sponsored_native + (hideConsent ? p.consent_or_popup : 0) + (hidePromo ? p.first_party_promo : 0);
  const pSafe = p.site_content + p.site_ui + (hideConsent ? 0 : p.consent_or_popup) + (hidePromo ? 0 : p.first_party_promo);

  let label: Category = "site_content";
  let best = -1;
  for (const c of ALL) {
    if (p[c] > best) {
      best = p[c];
      label = c;
    }
  }

  // Threshold keyed by the strongest *enabled* ad category.
  const adCats: Category[] = ["display_ad", "sponsored_native"];
  if (hideConsent) adCats.push("consent_or_popup");
  if (hidePromo) adCats.push("first_party_promo");
  let strongest: Category = "display_ad";
  for (const c of adCats) if (p[c] > p[strongest]) strongest = c;
  const thresholdFor: Record<Category, number> = {
    display_ad: settings.thresholds.display_ad,
    sponsored_native: settings.thresholds.sponsored_native,
    consent_or_popup: settings.thresholds.consent_or_popup,
    first_party_promo: settings.thresholds.sponsored_native,
    site_content: 2,
    site_ui: 2,
  };
  let threshold = thresholdFor[strongest];
  if (candidate.container === "main" || candidate.container === "article") threshold += CONTAINER_BUMP;

  const confidence = Number.isFinite(answer.confidence) ? answer.confidence : 0;
  const hide = pAd >= threshold && pAd - pSafe >= MARGIN_GUARD && confidence >= CONFIDENCE_FLOOR;
  return { label, pAd, pSafe, confidence, hide, p };
}

/** Re-run the decision for a cached entry with the current settings. Entries from before the probability map was stored keep their original verdict. */
export function decideCached(entry: CacheEntry, candidate: Pick<Candidate, "container">, settings: Settings): Decision {
  if (!entry.p) return { label: entry.label, pAd: entry.pAd, pSafe: 1 - entry.pAd, confidence: entry.confidence, hide: entry.hide };
  return decide({ type: "choice", choice: entry.label, probabilities: entry.p, confidence: entry.confidence }, candidate, settings);
}

/** Turn a decision into a cache entry with an appropriate TTL, or null when it should not be cached. */
export function toCacheEntry(d: Decision, now = Date.now()): CacheEntry | null {
  let ttlDays: number;
  if (d.hide) ttlDays = POSITIVE_TTL_DAYS;
  else if (d.pSafe >= NEGATIVE_CACHE_MIN_SAFE) ttlDays = NEGATIVE_TTL_DAYS;
  else ttlDays = UNCERTAIN_TTL_DAYS;
  return { label: d.label, pAd: d.pAd, confidence: d.confidence, hide: d.hide, ts: now, hits: 1, ttlDays, p: d.p };
}
