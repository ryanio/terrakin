import { isPartnerArt } from "@terrakin/ui/format";
import { describe, expect, it } from "vitest";

describe("partner art", () => {
  it("draws only our own copies of partner marks", () => {
    expect(isPartnerArt("/partners/musegod/badge.svg")).toBe(true);
    for (const url of [
      "https://musegod.org/badge.svg",
      "//evil.example/partners/musegod/badge.svg",
      "/partners/../media/m_0123456789abcdef",
      "/partners/musegod/badge.png",
      "/partners/MuseGod/badge.svg",
      "javascript:alert(1)",
      undefined,
    ]) {
      expect(isPartnerArt(url), String(url)).toBe(false);
    }
  });
});
