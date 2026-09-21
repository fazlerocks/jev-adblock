import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/** Content scripts must never touch the API key. */
describe("content script isolation", () => {
  it("never references the apiKey storage key", () => {
    const dir = join(__dirname, "../../src/content");
    for (const f of readdirSync(dir)) {
      const src = readFileSync(join(dir, f), "utf8");
      expect(src, `${f} must not reference apiKey`).not.toMatch(/apiKey|STORAGE_KEYS\.apiKey|"apiKey"/);
      expect(src, `${f} must not call fetch`).not.toMatch(/\bfetch\(/);
    }
  });
});
