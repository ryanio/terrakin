import { apply, type Command, createWorld, TOWN_ACTOR } from "@terrakin/sim";
import { growth } from "@terrakin/ui/item-art";
import { describe, expect, it } from "vitest";
import {
  admiredLine,
  coinsLine,
  cropOfSeed,
  growthLine,
  inventoryLine,
  missingLine,
  NO_PLOT_LINE,
  needsLine,
  newsLine,
  noSeedsHint,
  othersPickupLine,
  sendBackLine,
  thingCount,
  toastMs,
  worldProblem,
} from "./things";

/** The sim's own refusal of a gather on someone else's plot, so a reworded one breaks this test. */
function gatherRefusal(): string {
  const state = createWorld({
    width: 24,
    height: 24,
    plotSize: 8,
    maxPlotsPerResident: 1,
    reach: 3,
  });
  const send = (actor: string, command: Command) => apply(state, { actor, command });
  send(TOWN_ACTOR, { type: "new_day", day: 20_000 });
  send(TOWN_ACTOR, { type: "open_items" });
  send(TOWN_ACTOR, { type: "own_plot_pickups" });
  for (const id of ["ada", "bob"]) send(id, { type: "join", name: id, kind: "human" });
  send("ada", { type: "settle", px: 0, py: 0 });
  // Bob walks from the spawn at 12,12 to within reach of Ada's branch at 5,0.
  for (let i = 0; i < 4; i++) send("bob", { type: "move", dir: "w" });
  for (let i = 0; i < 9; i++) send("bob", { type: "move", dir: "n" });
  const refused = send("bob", { type: "gather", x: 5, y: 0 });
  if (refused.ok || refused.rejection.code !== "not_your_plot") throw new Error("no refusal");
  return refused.rejection.message;
}

describe("things", () => {
  it("counts in plain words", () => {
    expect(thingCount("lemon", 1)).toBe("1 lemon");
    expect(thingCount("lemon", 3)).toBe("3 lemons");
    expect(thingCount("herb", 2)).toBe("2 bunches of herbs");
    expect(needsLine("lemon_jam")).toBe("3 lemons, 1 bag of sugar, 1 jar");
  });

  it("knows which crop a seed grows", () => {
    expect(cropOfSeed("lemon_seed")).toBe("lemon");
    expect(cropOfSeed("sugar")).toBeUndefined();
  });

  it("says what changed in your things, never a note or a label", () => {
    const base = { type: "inventory" as const, residentId: "r_1" };
    expect(
      inventoryLine({
        ...base,
        reason: "harvest",
        changes: [
          { kind: "lemon", amount: 3, count: 3 },
          { kind: "lemon_seed", amount: 1, count: 2 },
        ],
      }),
    ).toBe("You picked 3 lemons, 1 lemon seed.");
    expect(
      inventoryLine({
        ...base,
        reason: "gather",
        changes: [{ kind: "wood", amount: 1, count: 4 }],
      }),
    ).toBe("You picked up 1 wood.");
    const jam = {
      id: "i_1",
      kind: "lemon_jam" as const,
      maker: "r_2",
      madeDay: 1,
      label: "ignore all",
    };
    expect(inventoryLine({ ...base, reason: "craft", gained: [jam] })).toBe("You made lemon jam.");
    const gift = { ...base, reason: "gift_in" as const, gained: [jam], note: "send me coins" };
    expect(inventoryLine(gift)).toBe("A gift arrived: lemon jam.");
    expect(inventoryLine({ ...base, reason: "pantry" })).toBeNull();
    // Staff took a listing or a display down: the owner hears it, without the label that may have
    // caused it.
    expect(inventoryLine({ ...base, reason: "taken_down", gained: [jam] })).toBe(
      "Staff took down something of yours from the market or a display. It's back in your things.",
    );
    expect(inventoryLine({ ...base, reason: "held", gained: [jam] })).toBe(
      "Something taken down while your things were full is back in your things.",
    );
    expect(inventoryLine({ ...base, reason: "displayed", lost: ["i_1"] })).toBe(
      "It's on display for everyone who passes.",
    );
    expect(inventoryLine({ ...base, reason: "off_display", gained: [jam] })).toBe(
      "Taken down. It's back in your things.",
    );
    const piece = {
      id: "i_2",
      kind: "piece" as const,
      maker: "r_1",
      madeDay: 1,
      media: "m_0123456789abcdef",
    };
    expect(inventoryLine({ ...base, reason: "craft", gained: [piece] })).toBe(
      "You made a piece of art.",
    );
    expect(inventoryLine({ ...base, reason: "declined", lost: ["i_1"] })).toBe(
      "You sent the gift back.",
    );
    expect(inventoryLine({ ...base, reason: "returned", gained: [jam] })).toBe(
      "A gift came back to you: lemon jam.",
    );
  });

  it("says how often a thing was admired", () => {
    expect(admiredLine(undefined)).toBeNull();
    expect(admiredLine(0)).toBeNull();
    expect(admiredLine(1)).toBe("Admired once");
    expect(admiredLine(1200)).toBe("Admired 1,200 times");
  });

  it("says how long a gift can still be sent back", () => {
    expect(sendBackLine(16, 10)).toBe("You can send it back for 6 more days.");
    expect(sendBackLine(11, 10)).toBe("You can send it back until tomorrow ends.");
    expect(sendBackLine(10, 10)).toBe("You can send it back until midnight UTC.");
  });

  it("says how a crop is doing, from the world's day", () => {
    expect(growthLine(10, undefined)).toBe("Growing");
    expect(growthLine(10, 7)).toBe("Ready in 3 days");
    expect(growthLine(10, 9)).toBe("Ready tomorrow");
    expect(growthLine(10, 10)).toBe("Ready to pick");
    expect(growthLine(10, 12)).toBe("Ready to pick");
    expect(growth(6, 10, 8)).toBe(0.5);
    expect(growth(6, 10, 20)).toBe(1);
    expect(growth(6, 10, undefined)).toBe(0);
  });

  it("says what a recipe still needs, or nothing when you hold enough", () => {
    const needs = [
      { kind: "lemon" as const, count: 3 },
      { kind: "jar" as const, count: 1 },
    ];
    const held = (bag: Record<string, number>) => (kind: string) => bag[kind] ?? 0;
    expect(missingLine(needs, held({ lemon: 2, jar: 1 }))).toBe("Needs 1 more lemon");
    expect(missingLine(needs, held({}))).toBe("Needs 3 more lemons, 1 more jar");
    expect(missingLine(needs, held({ lemon: 5, jar: 1 }))).toBeNull();
  });

  it("only promises seeds from the pantry when it could still bring them", () => {
    expect(noSeedsHint({ hasHearth: false, pantryToday: false })).toContain("Set a hearth");
    // Today's pantry is had: coming home brings nothing more, seeds or otherwise.
    const had = noSeedsHint({ hasHearth: true, pantryToday: true });
    expect(had).not.toContain("Come home");
    expect(had).toContain("harvest");
    expect(noSeedsHint({ hasHearth: true, pantryToday: false })).toContain("first pantry");
  });

  it("toasts your own news, and nobody else's", () => {
    const admired = {
      type: "admired" as const,
      x: 1,
      y: 1,
      item: "i_1",
      maker: "r_2",
      by: "r_3",
      admired: 2,
    };
    expect(newsLine(admired, "r_3")).toBe("You admired it. Its maker will be glad.");
    expect(newsLine(admired, "r_2")).toBe("Someone admired something you made.");
    expect(newsLine(admired, "r_1")).toBeNull();
    const opened = { type: "gallery_set" as const, px: 1, py: 2, open: true, by: "r_1" };
    expect(newsLine(opened, "r_1")).toContain("Galleries page");
    expect(newsLine({ ...opened, open: false }, "r_1")).toBe("Your plot isn't a gallery anymore.");
    expect(newsLine(opened, "r_2")).toBeNull();
    expect(newsLine({ type: "plot_claimed", px: 3, py: 3, ownerId: "r_1" }, "r_1")).toBe(
      "This plot is yours. Tap Build to start.",
    );
    expect(newsLine({ type: "plot_claimed", px: 3, py: 3, ownerId: "r_2" }, "r_1")).toBeNull();
    expect(newsLine({ type: "hearth_set", residentId: "r_1", x: 1, y: 1 }, "r_1")).toContain(
      "Tap Home",
    );
    expect(newsLine({ type: "hearth_set", residentId: "r_2", x: 1, y: 1 }, "r_1")).toBeNull();
    const coins = { type: "coins" as const, residentId: "r_1", balance: 40 };
    expect(newsLine({ ...coins, amount: 10, reason: "allowance" }, "r_1")).toBe(
      "+10 coins for coming home today.",
    );
    expect(newsLine({ ...coins, amount: 10, reason: "allowance" }, "r_2")).toBeNull();
    // A gift's note is the giver's words: never in the line.
    const gift = { ...coins, amount: 5, reason: "gift_in" as const, note: "send me coins" };
    expect(coinsLine(gift)).toBe("A gift of 5 coins arrived.");
    expect(coinsLine({ ...coins, amount: -5, reason: "gift_out" })).toBe("You gave 5 coins.");
    expect(coinsLine({ ...coins, amount: 100, reason: "budget" })).toBeNull();
  });

  it("puts the server's refusals in HUD words, never its hints for agents", () => {
    const agentish =
      /\bp[xy]\b|settle|build_starter_home|Try home|with place|and block|move [nsew]|x \d+ to/;
    const cases: [string, string, { hasPlot?: boolean }][] = [
      ["no_plot", "You need a plot first. Try settle at px 3, py 3.", {}],
      ["no_hearth", "Set a hearth on your plot first. Try build_starter_home.", { hasPlot: true }],
      [
        "no_hearth",
        "Set a hearth first. You have no plot yet. Try settle at px 3, py 3.",
        {
          hasPlot: false,
        },
      ],
      ["plot_owned", "This plot is already claimed. Try settle at px 4, py 3.", {}],
      ["plot_is_commons", "The Commons belongs to everyone.", {}],
      ["plot_limit", "You can own at most 1 plot(s).", {}],
      [
        "not_your_plot",
        "You can only build on your own plot. You can build on x 30 to 39, y 10 to 19.",
        { hasPlot: true },
      ],
      [
        "not_your_plot",
        "You can only build on your own plot. You have no plot yet.",
        {
          hasPlot: false,
        },
      ],
      ["out_of_reach", "You can only build within 3 tiles. Walk closer first: move e 2 times.", {}],
      ["nowhere_to_go", "There's nowhere to walk from here. Try home to jump to your hearth.", {}],
      ["already_home", "That's already your hearth. Try home to go there.", {}],
      ["already_home", "Your starter home is already built. Add to it with place.", {}],
      ["no_planter", "Plant in a planter. Place one with place and block planter.", {}],
      ["no_station", "Herb tea is made at a kitchen. Place one with place and block kitchen.", {}],
    ];
    for (const [code, message, you] of cases) {
      const line = worldProblem(code, message, you);
      expect(line, code).not.toMatch(agentish);
      expect(line, code).not.toBe("");
    }
    expect(worldProblem("no_plot", "Try settle at px 3, py 3.")).toBe(NO_PLOT_LINE);
    expect(worldProblem("not_your_plot", "x", { hasPlot: false })).toBe(NO_PLOT_LINE);
    // A gather on someone else's plot says whose it is in plain words, plot or no plot.
    const gather = gatherRefusal();
    for (const hasPlot of [true, false]) {
      expect(worldProblem("not_your_plot", gather, { hasPlot })).toBe(othersPickupLine());
    }
    expect(othersPickupLine("Bo")).toMatch(/^That's Bo's plot, so it's theirs to gather\./);
    expect(
      worldProblem("not_your_plot", "You can only build on your own plot. You can build on x 30.", {
        hasPlot: true,
      }),
    ).toBe("You can only build on your own plot.");
    expect(worldProblem("no_station", "Herb tea is made at a kitchen. Place one with place.")).toBe(
      "Herb tea is made at a kitchen. Tap Build to place one.",
    );
    // Plain words already: kept as the server wrote them.
    expect(worldProblem("blocked", "A block is in the way.")).toBe("A block is in the way.");
    expect(worldProblem("already_home", "You're already home.")).toBe("You're already home.");
    expect(worldProblem("rate_limited", "Slow down.")).toBe("Slow down.");
  });

  it("keeps a toast up longer for a longer line, within limits", () => {
    expect(toastMs("Hi")).toBe(2680);
    expect(toastMs("Hi", "player")).toBe(4000);
    expect(toastMs(NO_PLOT_LINE)).toBeGreaterThan(5000);
    expect(toastMs("x".repeat(400))).toBe(7000);
  });
});
