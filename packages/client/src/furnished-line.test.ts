import { describe, expect, it } from "vitest";
import { furnishedLine } from "./furnished-line";

describe("furnishedLine", () => {
  it("says what a home holds, leaving out a count of 0, and nothing for a bare plot", () => {
    expect(furnishedLine({ furnished: { pieces: 14, onShow: 9, kinds: 11 } })).toBe(
      "14 pieces of furniture, 9 things on show",
    );
    expect(furnishedLine({ furnished: { pieces: 1, onShow: 0, kinds: 1 } })).toBe(
      "1 piece of furniture",
    );
    expect(furnishedLine({ furnished: { pieces: 0, onShow: 1, kinds: 1 } })).toBe(
      "1 thing on show",
    );
    expect(furnishedLine({ furnished: { pieces: 0, onShow: 0, kinds: 0 } })).toBeNull();
    expect(furnishedLine({})).toBeNull();
  });

  it("adds a home's graded walls (RFC 0051), with or without furniture", () => {
    expect(
      furnishedLine({
        furnished: { pieces: 2, onShow: 0, kinds: 2 },
        walls: { fine: 12, masterwork: 1 },
      }),
    ).toBe("2 pieces of furniture, 12 fine walls, 1 masterwork wall");
    expect(furnishedLine({ walls: { fine: 0, masterwork: 2 } })).toBe("2 masterwork walls");
    expect(furnishedLine({ walls: { fine: 1, masterwork: 0 } })).toBe("1 fine wall");
  });
});
