import { describe, expect, it } from "vitest";
import { JevClient, JevError } from "../../src/shared/jev/client";
import { mockFetch } from "../mock/jev";

const req = { model: "jev-latest", state: { candidates: [{ i: 0 }] }, questions: { c0: { type: "choice" as const, instructions: "x", criteria: { a: "a" } } } };
const noSleep = async () => undefined;

describe("JevClient", () => {
  it("sends bearer auth and parses answers", async () => {
    const { fetchImpl, calls } = mockFetch({ classify: () => ({ choice: "display_ad" }) });
    const c = new JevClient({ apiKey: "sk-test", fetchImpl, sleep: noSleep });
    const res = await c.systemOne(req);
    expect(res.answers.c0!.type).toBe("choice");
    expect((calls[0]!.init.headers as Record<string, string>).Authorization).toBe("Bearer sk-test");
    expect(calls[0]!.url).toBe("https://api.typesafe.ai/v1/systemone");
  });
  it("retries 429 then succeeds", async () => {
    const { fetchImpl, calls } = mockFetch({ script: [{ status: 429 }, { status: 429 }], classify: () => ({ choice: "site_ui" }) });
    const c = new JevClient({ apiKey: "k", fetchImpl, sleep: noSleep });
    await c.systemOne(req);
    expect(calls.length).toBe(3);
  });
  it("gives up on 429 after bounded retries", async () => {
    const { fetchImpl, calls } = mockFetch({ script: [{ status: 429 }, { status: 429 }, { status: 429 }, { status: 429 }] });
    const c = new JevClient({ apiKey: "k", fetchImpl, sleep: noSleep });
    await expect(c.systemOne(req)).rejects.toMatchObject({ kind: "rate_limit" });
    expect(calls.length).toBe(4);
  });
  it("maps 401 to auth and does not retry", async () => {
    const { fetchImpl, calls } = mockFetch({ script: [{ status: 401 }] });
    const c = new JevClient({ apiKey: "bad", fetchImpl, sleep: noSleep });
    const err = await c.systemOne(req).catch((e) => e);
    expect(err).toBeInstanceOf(JevError);
    expect(err.kind).toBe("auth");
    expect(calls.length).toBe(1);
  });
  it("retries 529 twice", async () => {
    const { fetchImpl, calls } = mockFetch({ script: [{ status: 529 }, { status: 529 }, { status: 529 }] });
    const c = new JevClient({ apiKey: "k", fetchImpl, sleep: noSleep });
    await expect(c.systemOne(req)).rejects.toMatchObject({ kind: "overloaded" });
    expect(calls.length).toBe(3);
  });
  it("retries a network error once", async () => {
    const { fetchImpl, calls } = mockFetch({ script: ["network"], classify: () => ({ choice: "site_ui" }) });
    const c = new JevClient({ apiKey: "k", fetchImpl, sleep: noSleep });
    await c.systemOne(req);
    expect(calls.length).toBe(2);
  });
  it("lists models", async () => {
    const { fetchImpl } = mockFetch({});
    const c = new JevClient({ apiKey: "k", fetchImpl, sleep: noSleep });
    expect((await c.listModels()).map((m) => m.name)).toEqual(["jev-latest"]);
  });
});
