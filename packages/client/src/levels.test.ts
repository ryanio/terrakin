import { describe, expect, it } from "vitest";
import { levelsLine, unlockLine } from "./levels";

describe("a level notice in plain words (RFC 0029)", () => {
  it("names a skill's level by its skill and your own as a level", () => {
    expect(levelsLine([{ skill: "making", level: 2 }, { level: 2 }])).toEqual({
      line: "You reached Making 2 and level 2.",
      next: null,
    });
    expect(
      levelsLine([{ skill: "growing", level: 3 }, { skill: "foraging", level: 2 }, { level: 4 }])
        .line,
    ).toBe("You reached Growing 3, Foraging 2, and level 4.");
  });

  it("says what a level unlocked, a garment to wear or a title to show, and nothing otherwise", () => {
    expect(unlockLine([{ skill: "growing", level: 5, unlocks: { wear: "sun_hat" } }])).toBe(
      "You can wear the sun hat now.",
    );
    expect(unlockLine([{ skill: "hosting", level: 3, unlocks: { title: "host" } }])).toBe(
      "You can show the title Host now.",
    );
    // The one-time credit can pass a title and a garment at once.
    expect(
      unlockLine([
        { skill: "playing", level: 6, unlocks: { title: "player", wear: "winners_rosette" } },
        { level: 6 },
      ]),
    ).toBe("You can wear the winner's rosette and show the title Player now.");
    expect(unlockLine([{ skill: "making", level: 2 }, { level: 2 }])).toBeNull();
  });
});
