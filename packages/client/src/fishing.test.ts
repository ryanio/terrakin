import { POND } from "@terrakin/sim";
import { describe, expect, it } from "vitest";
import { holdingsFromStacks } from "./build-palette";
import { canDig, noRodLine, pondLine, rodsAfter, rodsIn } from "./fishing";

/**
 * Fishing in the world (RFC 0023): which rods you hold, which decides whether Fish casts or says
 * how to make one, and the build bar's words for a pond, which decide whether a tap digs one.
 */

const inventory = (extra: {
  gained?: { id: string; kind: "fishing_rod" | "lemon_jam"; maker: string; madeDay: number }[];
  lost?: string[];
}) => ({ type: "inventory" as const, residentId: "r_1", reason: "craft" as const, ...extra });

describe("the rods you hold", () => {
  it("start from your things, and follow the rods that arrive and leave", () => {
    const rods = rodsIn([
      { id: "i_1", kind: "fishing_rod" },
      { id: "i_2", kind: "lemon_jam" },
    ]);
    expect([...rods]).toEqual(["i_1"]);
    const made = rodsAfter(
      rods,
      inventory({ gained: [{ id: "i_3", kind: "fishing_rod", maker: "r_1", madeDay: 1 }] }),
    );
    expect([...made].sort()).toEqual(["i_1", "i_3"]);
    // Given away, sold, or put up for sale: gone.
    expect([...rodsAfter(made, inventory({ lost: ["i_1", "i_2"] }))]).toEqual(["i_3"]);
    // Nothing about rods: the same set back, so nothing redraws.
    const jam = inventory({ gained: [{ id: "i_4", kind: "lemon_jam", maker: "r_1", madeDay: 1 }] });
    expect(rodsAfter(made, jam)).toBe(made);
    expect(noRodLine()).toBe("Fishing takes a fishing rod. Make one at a workbench from 3 wood.");
  });
});

describe("a pond on the build bar", () => {
  it("says what a tile takes, and what you're short of, by the sim's own count", () => {
    const short = holdingsFromStacks([{ kind: "stone", count: POND.stone - 1 }]);
    expect(canDig(short)).toBe(false);
    expect(pondLine(short)).toBe("Pond: 2 stone a tile, to fish beside. You need 1 stone more.");
    const enough = holdingsFromStacks([{ kind: "stone", count: POND.stone }]);
    expect(canDig(enough)).toBe(true);
    expect(pondLine(enough)).toBe("Pond: 2 stone a tile, to fish beside. You have enough.");
  });
});
