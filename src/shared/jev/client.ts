import { API_BASE, MODELS_PATH, REQUEST_TIMEOUT_MS, SYSTEMONE_PATH } from "../constants";
import type { ModelCard, SystemOneRequest, SystemOneResponse } from "./types";

export type JevErrorKind = "auth" | "validation" | "rate_limit" | "overloaded" | "server" | "network" | "timeout";

export class JevError extends Error {
  constructor(
    public kind: JevErrorKind,
    public status: number | undefined,
    message: string,
    public retryAfterMs?: number,
  ) {
    super(message);
    this.name = "JevError";
  }
}

export interface JevClientOptions {
  apiKey: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function retryAfter(res: Response): number | undefined {
  const h = res.headers.get("retry-after");
  if (!h) return undefined;
  const n = Number(h);
  if (Number.isFinite(n) && n >= 0) return n * 1000;
  const d = Date.parse(h);
  return Number.isNaN(d) ? undefined : Math.max(0, d - Date.now());
}

export class JevClient {
  private readonly base: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(private readonly opts: JevClientOptions) {
    this.base = (opts.baseUrl ?? API_BASE).replace(/\/$/, "");
    this.fetchImpl = opts.fetchImpl ?? fetch.bind(globalThis);
    this.timeoutMs = opts.timeoutMs ?? REQUEST_TIMEOUT_MS;
    this.sleep = opts.sleep ?? defaultSleep;
  }

  private async raw(path: string, init: RequestInit): Promise<Response> {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), this.timeoutMs);
    try {
      return await this.fetchImpl(this.base + path, {
        ...init,
        signal: ctrl.signal,
        headers: {
          Authorization: `Bearer ${this.opts.apiKey}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
      });
    } catch (e) {
      if ((e as Error)?.name === "AbortError") throw new JevError("timeout", undefined, "request timed out");
      throw new JevError("network", undefined, (e as Error)?.message ?? "network error");
    } finally {
      clearTimeout(t);
    }
  }

  private async toError(res: Response): Promise<JevError> {
    let body = "";
    try {
      body = (await res.text()).slice(0, 500);
    } catch {
      /* ignore */
    }
    const msg = `${res.status} ${res.statusText}${body ? `: ${body}` : ""}`;
    switch (res.status) {
      case 401:
      case 403:
        return new JevError("auth", res.status, msg);
      case 400:
      case 422:
        return new JevError("validation", res.status, msg);
      case 429:
        return new JevError("rate_limit", res.status, msg, retryAfter(res));
      case 503:
      case 529:
        return new JevError("overloaded", res.status, msg, retryAfter(res));
      default:
        return new JevError("server", res.status, msg);
    }
  }

  async listModels(): Promise<ModelCard[]> {
    const res = await this.raw(MODELS_PATH, { method: "GET" });
    if (!res.ok) throw await this.toError(res);
    const data = (await res.json()) as ModelCard[] | { models?: ModelCard[]; data?: ModelCard[] };
    if (Array.isArray(data)) return data;
    return data.models ?? data.data ?? [];
  }

  /** One systemOne call with bounded retries for 429/529 and a single retry for network errors. */
  async systemOne(req: SystemOneRequest): Promise<SystemOneResponse> {
    const body = JSON.stringify(req);
    const rateDelays = [1000, 2000, 4000];
    const overloadDelays = [2000, 4000];
    let rateIdx = 0;
    let overIdx = 0;
    let networkRetried = false;

    for (;;) {
      let res: Response;
      try {
        res = await this.raw(SYSTEMONE_PATH, { method: "POST", body });
      } catch (e) {
        if (e instanceof JevError && (e.kind === "network" || e.kind === "timeout") && !networkRetried) {
          networkRetried = true;
          await this.sleep(500);
          continue;
        }
        throw e;
      }
      if (res.ok) return (await res.json()) as SystemOneResponse;

      const err = await this.toError(res);
      if (err.kind === "rate_limit" && rateIdx < rateDelays.length) {
        const base = err.retryAfterMs ?? rateDelays[rateIdx]!;
        rateIdx++;
        await this.sleep(Math.min(base + Math.random() * 300, 15_000));
        continue;
      }
      if (err.kind === "overloaded" && overIdx < overloadDelays.length) {
        const base = err.retryAfterMs ?? overloadDelays[overIdx]!;
        overIdx++;
        await this.sleep(Math.min(base, 15_000));
        continue;
      }
      throw err;
    }
  }
}
