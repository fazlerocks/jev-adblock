import type { ChoiceAnswer, SystemOneRequest, SystemOneResponse } from "../../src/shared/jev/types";
import type { Category } from "../../src/shared/types";

export type Script = Array<{ status: number; body?: unknown; headers?: Record<string, string> } | "network">;

/** Build a fetch stub that answers /v1/systemone with a canned classifier, and /v1/models with a fixed list. */
export function mockFetch(opts: {
  classify?: (entry: Record<string, unknown>, i: number) => Partial<ChoiceAnswer> & { choice: Category };
  script?: Script;
  onRequest?: (req: SystemOneRequest) => void;
}) {
  const calls: { url: string; init: RequestInit }[] = [];
  const script = [...(opts.script ?? [])];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const next = script.shift();
    if (next === "network") throw new TypeError("Failed to fetch");
    if (next) {
      return new Response(JSON.stringify(next.body ?? { error: "scripted" }), {
        status: next.status,
        headers: { "content-type": "application/json", ...(next.headers ?? {}) },
      });
    }
    if (url.endsWith("/v1/models")) {
      return new Response(JSON.stringify([{ name: "jev-latest", description: "", release_date: "" }]), { status: 200 });
    }
    const req = JSON.parse(String(init.body)) as SystemOneRequest;
    opts.onRequest?.(req);
    const state = req.state as { candidates: Record<string, unknown>[] };
    const answers: SystemOneResponse["answers"] = {};
    state.candidates.forEach((entry, i) => {
      const a = opts.classify?.(entry, i) ?? { choice: "site_content" as Category };
      const probs =
        a.probabilities ??
        ({
          display_ad: 0,
          sponsored_native: 0,
          consent_or_popup: 0,
          first_party_promo: 0,
          site_content: 0,
          site_ui: 0,
          [a.choice]: 1,
        } as Record<string, number>);
      answers[`c${i}`] = { type: "choice", choice: a.choice, probabilities: probs, confidence: a.confidence ?? 0.95 };
    });
    const body: SystemOneResponse = { model: "jev-1.13.0", answers, usage: { input_tokens: 1000, output_tokens: 0 } };
    return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}
