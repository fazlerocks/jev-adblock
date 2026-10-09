import { afterEach, describe, expect, it, vi } from "vitest";
import { isSensitivePage } from "../../src/content/candidates";

afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("frame access during privacy checks", () => {
  it("does not probe a known cross-origin ad frame", () => {
    document.body.innerHTML = '<iframe src="https://googleads.g.doubleclick.net/ad"></iframe>';
    const frame = document.querySelector("iframe")!;
    const getter = vi.spyOn(frame, "contentDocument", "get").mockImplementation(() => {
      throw new DOMException("Cross-origin access", "SecurityError");
    });
    expect(isSensitivePage(document)).toBe(false);
    expect(getter).not.toHaveBeenCalled();
  });

  it("still detects a password field in an accessible blank frame", () => {
    document.body.innerHTML = "<iframe></iframe>";
    const inner = document.querySelector("iframe")!.contentDocument!;
    inner.body.innerHTML = '<input type="password">';
    vi.spyOn(inner.querySelector("input")!, "getBoundingClientRect").mockReturnValue({ width: 100, height: 30 } as DOMRect);
    expect(isSensitivePage(document)).toBe(true);
  });

  it("tolerates a frame becoming inaccessible after the URL check", () => {
    document.body.innerHTML = '<iframe src="about:blank"></iframe>';
    const getter = vi.spyOn(document.querySelector("iframe")!, "contentDocument", "get").mockImplementation(() => {
      throw new DOMException("Cross-origin redirect", "SecurityError");
    });
    expect(isSensitivePage(document)).toBe(false);
    expect(getter).toHaveBeenCalled();
  });
});
