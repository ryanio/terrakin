import { describe, expect, it } from "vitest";
import { WarmBrowsers } from "./warm-browsers";

describe("browsers kept open between scene photos", () => {
  it("offers the newest open browser, never one twice, never one about to close, and keeps two", () => {
    let now = 0;
    const closed: string[] = [];
    const warm = new WarmBrowsers<string>({
      keepMs: 120_000,
      most: 2,
      now: () => now,
      close: (b) => closed.push(b),
    });
    expect(warm.take()).toBeUndefined();
    warm.give("a");
    now += 1_000;
    warm.give("b");
    // The newest first, and each to one photo at a time.
    expect(warm.take()).toBe("b");
    expect(warm.take()).toBe("a");
    expect(warm.take()).toBeUndefined();
    // A third left open lets the oldest go.
    warm.give("a");
    warm.give("b");
    warm.give("c");
    expect(closed).toEqual(["a"]);
    // Near its idle limit a browser is no longer offered: Browser Run may have closed it.
    now += 110_000;
    expect(warm.take()).toBeUndefined();
    expect(closed).toEqual(["a", "b", "c"]);
  });
});
