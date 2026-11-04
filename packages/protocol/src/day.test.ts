import { describe, expect, it } from "vitest";
import { dayIso, isDay } from "./day";

describe("a world day as a date", () => {
  it("is the UTC date of that day, whatever the reader's zone", () => {
    expect(dayIso(0)).toBe("1970-01-01");
    expect(dayIso(20_760)).toBe("2026-11-03");
    // A day a local-time conversion would land on the wrong side of.
    expect(dayIso(20_088)).toBe("2024-12-31");
    expect(dayIso(20_089)).toBe("2025-01-01");
    expect(isDay(dayIso(20_760))).toBe(true);
  });
});
