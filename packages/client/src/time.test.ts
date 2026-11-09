import { describe, expect, it } from "vitest";
import { serverTime } from "./time";

describe("serverTime", () => {
  it("reads the server's clock forward by as long as this device has counted since it came", () => {
    const anchor = { nowMs: 1_000_000, at: 50 };
    expect(serverTime(anchor, 50)).toBe(1_000_000);
    expect(serverTime(anchor, 2_050)).toBe(1_002_000);
  });
});
