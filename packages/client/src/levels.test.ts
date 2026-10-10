import type { ProgressResponse } from "@terrakin/protocol";
import { PROGRESS, pointsFor } from "@terrakin/sim";
import { describe, expect, it } from "vitest";
import {
  chipTone,
  chipWords,
  earnedAt,
  earnedState,
  gainLine,
  levelsLine,
  myLevelToast,
  ownSkillRow,
  publicSkillRow,
  unlockLine,
} from "./levels";

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

describe("levels in the world (RFC 0029)", () => {
  const gain = (skill: "making" | "growing", points: number, total: number, residentId = "me") => ({
    type: "progress" as const,
    residentId,
    skill,
    points,
    total,
    today: points,
  });

  const reached = (level: number, skill?: "making" | "growing") => ({
    type: "level_reached" as const,
    residentId: "me",
    ...(skill ? { skill } : {}),
    level,
  });

  it("toasts the levels you reached in one input, from the events the socket sent", () => {
    // A second first craft: 12 more points takes Making, and you, from level 1 to level 2.
    const events = [reached(2, "making"), reached(2), gain("making", 12, 24)];
    expect(myLevelToast(events, "me")).toBe("You reached Making 2 and level 2.");
    // Someone else's level is theirs: a sparkle on their figure, and no toast for you.
    expect(myLevelToast(events, "neighbor")).toBeNull();
    expect(myLevelToast([gain("making", 2, 14)], "me")).toBeNull();
  });

  it("says what the level unlocked, worked out from the points the same input added", () => {
    // Growing 5 starts at 200 points: this harvest crossed it, and the sun hat comes at 5.
    const fifth = [reached(5, "growing"), gain("growing", 2, pointsFor(5) + 1)];
    expect(myLevelToast(fifth, "me")).toBe("You reached Growing 5. You can wear the sun hat now.");
    // Reaching 6 unlocks nothing new.
    const sixth = [reached(6, "growing"), gain("growing", 2, pointsFor(6))];
    expect(myLevelToast(sixth, "me")).toBe("You reached Growing 6.");
  });

  it("writes the points over your figure as a sign and a skill", () => {
    expect(gainLine({ skill: "growing", points: 2 })).toBe("+2 Growing");
    expect(gainLine({ skill: "foraging", points: 14 })).toBe("+14 Foraging");
  });
});

describe("the level chip on a profile (RFC 0029)", () => {
  it("says the level, then the title when one is shown", () => {
    expect(chipWords({ level: 8 })).toBe("Level 8");
    expect(chipWords({ level: 8, title: "gardener" })).toBe("Level 8 · Gardener");
    expect(chipWords({ level: 31, title: "grand_host" })).toBe("Level 31 · Grand host");
  });

  it("turns copper at level 10, silver at 25, and gold at 50", () => {
    expect([1, 9].map(chipTone)).toEqual([undefined, undefined]);
    expect([10, 24].map(chipTone)).toEqual(["copper", "copper"]);
    expect([25, 49].map(chipTone)).toEqual(["silver", "silver"]);
    expect([50, 120].map(chipTone)).toEqual(["gold", "gold"]);
  });
});

describe("the skills sheet's rows (RFC 0029)", () => {
  const mine = (over: Partial<ProgressResponse["skills"][number]> = {}) => ({
    skill: "growing" as const,
    level: 3,
    points: 74,
    nextAt: 120,
    today: 14,
    cap: PROGRESS.dailyCap,
    ...over,
  });

  it("fills your bar from this level's start to the next level's, never past either end", () => {
    // Growing 3 starts at 60 points and Growing 4 at 120: 74 points is 14 of 60.
    expect(pointsFor(3)).toBe(60);
    expect(ownSkillRow(mine(), undefined).bar).toEqual({
      count: 14,
      total: 60,
      label: "14 of 60 points to Growing 4",
    });
    expect(ownSkillRow(mine({ points: 60 }), undefined).bar.count).toBe(0);
    expect(ownSkillRow(mine({ points: 119 }), undefined).bar.count).toBe(59);
    // Points the server hasn't turned into a level yet never overfill or underfill the bar.
    expect(ownSkillRow(mine({ points: 500 }), undefined).bar.count).toBe(60);
    expect(ownSkillRow(mine({ points: 10 }), undefined).bar.count).toBe(0);
  });

  it("says the points left, today's count against the cap, and what comes next", () => {
    const next = { skill: "growing" as const, level: 5, unlocks: { wear: "sun_hat" as const } };
    expect(ownSkillRow(mine(), next)).toMatchObject({
      name: "Growing 3",
      lines: ["46 points to Growing 4", "14 of 20 today", "Growing 5 brings the sun hat."],
    });
    expect(ownSkillRow(mine({ points: 119 }), undefined).lines[0]).toBe("1 point to Growing 4");
    // At the cap the line says so, and that more counts tomorrow.
    expect(ownSkillRow(mine({ today: 20 }), undefined).lines).toEqual([
      "46 points to Growing 4",
      "20 of 20 today. That's today's most: more counts tomorrow.",
    ]);
  });

  it("shows someone else's row from their level alone, toward the next thing it unlocks", () => {
    // Nothing done yet is an empty bar, not a third of one.
    expect(publicSkillRow("growing", 1)).toEqual({
      skill: "growing",
      name: "Growing 1",
      bar: { count: 0, total: 2, label: "0 of 2 levels to Growing 3" },
      lines: ["Growing 3 brings the title Gardener."],
    });
    // The bar starts again at each thing unlocked: the title at 3, the garment at 5.
    expect(publicSkillRow("making", 4)).toMatchObject({
      bar: { count: 1, total: 2, label: "1 of 2 levels to Making 5" },
      lines: ["Making 5 brings the tool belt."],
    });
    expect(publicSkillRow("hosting", 7)).toMatchObject({
      bar: { count: 2, total: 5 },
      lines: ["Hosting 10 brings the title Grand host."],
    });
    // Past the last unlock the bar is full and stays full.
    expect(publicSkillRow("playing", 14)).toMatchObject({
      name: "Playing 14",
      bar: { count: 1, total: 1, label: "Past Playing 10" },
      lines: ["Nothing left to unlock."],
    });
  });
});

describe("earned wear in the look editor (RFC 0029)", () => {
  it("lists earned wear only once levels are open, to put on when reached and locked until then", () => {
    // Levels not open here (or no answer yet): only what's already on shows.
    expect(earnedState("sun_hat", [], undefined)).toBe("hidden");
    expect(earnedState("sun_hat", ["sun_hat"], undefined)).toBe("open");
    // Levels open: reached wear can be put on, the rest shows where it comes from.
    expect(earnedState("sun_hat", [], [])).toBe("locked");
    expect(earnedState("sun_hat", [], ["tool_belt"])).toBe("locked");
    expect(earnedState("sun_hat", [], ["sun_hat"])).toBe("open");
    // Wear that isn't earned is never held back here.
    expect(earnedState("straw_hat", [], undefined)).toBe("open");
    expect(earnedState("straw_hat", [], [])).toBe("open");
  });

  it("labels a garment not reached with its skill and level", () => {
    expect(earnedAt("sun_hat")).toBe("Growing 5");
    expect(earnedAt("tool_belt")).toBe("Making 5");
    expect(earnedAt("field_vest")).toBe("Foraging 5");
    expect(earnedAt("party_sash")).toBe("Hosting 5");
    expect(earnedAt("winners_rosette")).toBe("Playing 5");
  });
});
