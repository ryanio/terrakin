import { describe, expect, it } from "vitest";
import { apply, prepare } from "./apply";
import { buildSummary, planMax, plotPlan } from "./build";
import { PANTRY_STAPLES } from "./catalog";
import { STOREYS_CONFIG, STOREYS_HASH, STOREYS_LOG } from "./fixtures/storeys-log";
import { hashWorld } from "./hash";
import { ITEMS, inventorySize, type StackKind } from "./items";
import { replay } from "./replay";
import { dayOfDate } from "./season";
import { STOREYS } from "./storeys";
import { expectSupplyHolds, fund, stock } from "./test-support";
import {
  type BlockKind,
  type Command,
  type Input,
  type PlanBlock,
  type PlanGround,
  type Rejection,
  TOWN_ACTOR,
  type WorldConfig,
  type WorldEvent,
} from "./types";
import { visitTile } from "./visit";
import { createWorld } from "./world";

// 3x3 plots of 8 tiles. The Commons is plot (1, 1). Ada settles plot (0, 0) and builds the
// starter hut: walls from (1, 1) to (5, 5), her hearth at (3, 3), where she stands. Bob settles
// plot (2, 0), tiles x 16 to 23, and builds nothing: he stands at (19, 3). Cy settles plot (1, 0)
// between them, x 8 to 15, and stands at (11, 3).
const CONFIG: WorldConfig = {
  width: 24,
  height: 24,
  plotSize: 8,
  maxPlotsPerResident: 1,
  reach: 3,
};

/** A world where every refusal is checked to leave the state byte-identical. */
function world({ economy = true, reach = CONFIG.reach } = {}) {
  const state = createWorld({ ...CONFIG, reach });
  const send = (actor: string, command: Command) => {
    const before = hashWorld(state);
    const result = apply(state, { actor, command });
    if (!result.ok) expect(hashWorld(state)).toBe(before);
    for (const inv of Object.values(state.items?.inventories ?? {})) {
      expect(inventorySize(inv)).toBeLessThanOrEqual(ITEMS.inventoryMax);
    }
    expectSupplyHolds(state);
    return result;
  };
  const ok = (actor: string, command: Command): WorldEvent[] => {
    const result = send(actor, command);
    expect(result, `${actor} ${JSON.stringify(command)}`).toMatchObject({ ok: true });
    return result.ok ? result.events : [];
  };
  const refused = (actor: string, command: Command): Rejection => {
    const result = send(actor, command);
    expect(result.ok, `${actor} ${JSON.stringify(command)} should be refused`).toBe(false);
    return result.ok ? { code: "internal" as never, message: "" } : result.rejection;
  };
  ok(TOWN_ACTOR, { type: "new_day", day: 20_000 });
  ok(TOWN_ACTOR, { type: "open_items" });
  if (economy) ok(TOWN_ACTOR, { type: "open_economy" });
  for (const [name, px] of [
    ["ada", 0],
    ["bob", 2],
    ["cy", 1],
  ] as const) {
    ok(name, { type: "join", name, kind: "human" });
    ok(name, { type: "settle", px, py: 0 });
  }
  ok("ada", { type: "build_starter_home" });
  /** Set a purse to exactly `n` coins, minting what it lacks or burning what's over. Setup only. */
  const purse = (id: string, n: number) => {
    const econ = state.economy;
    if (!econ) throw new Error("open the economy first");
    const have = econ.coins[id] ?? 0;
    if (n > have) fund(state, id, n - have);
    if (n < have) {
      econ.burned += have - n;
      if (n === 0) delete econ.coins[id];
      else econ.coins[id] = n;
    }
  };
  if (economy) for (const id of ["ada", "bob", "cy"]) purse(id, 200);
  const give = (id: string, stacks: Partial<Record<StackKind, number>>) => stock(state, id, stacks);
  /** Put a resident on a tile without walking there. Setup only: no event, no log line. */
  const standAt = (id: string, x: number, y: number) => {
    const r = state.residents[id];
    if (!r) throw new Error(`${id} isn't in the world`);
    r.x = x;
    r.y = y;
  };
  return { state, ok, refused, give, standAt, purse };
}

const ofType = <T extends WorldEvent["type"]>(events: WorldEvent[], type: T) =>
  events.filter((e): e is Extract<WorldEvent, { type: T }> => e.type === type);

describe("STOREYS", () => {
  it("are the numbers decision 0242 settled with the economy run", () => {
    expect(STOREYS).toEqual({ max: 1, price: 200, span: 2, stairsWood: 4 });
  });
});

describe("add_storey", () => {
  it("opens the next storey for its price, from anywhere, and every coin is still counted", () => {
    const w = world();
    // From the Commons, on her own plot.
    w.standAt("ada", 12, 12);
    const before = w.state.economy?.coins.ada ?? 0;
    const events = w.ok("ada", { type: "add_storey", px: 0, py: 0 });
    expect(events[0]).toEqual({ type: "storey_added", px: 0, py: 0, storey: 1, by: "ada" });
    expect(ofType(events, "coins")).toEqual([
      expect.objectContaining({ residentId: "ada", amount: -STOREYS.price, reason: "storey" }),
    ]);
    expect(w.state.economy?.coins.ada ?? 0).toBe(before - STOREYS.price);
    expect(w.state.plots["0,0"]?.storeys).toBe(1);
    // An empty storey: nothing is built until a floor goes down.
    expect(w.state.storeys).toEqual({ "1": { blocks: {}, ground: {} } });
  });

  it("lets a co-owner add one to a plot they share", () => {
    const w = world();
    w.ok("ada", { type: "share_plot", with: "bob" });
    w.ok("bob", { type: "add_storey", px: 0, py: 0 });
    expect(w.state.plots["0,0"]?.storeys).toBe(1);
  });

  it("refuses the Commons, a plot that isn't yours, past the top, short of coins, and before coins", () => {
    const w = world();
    expect(w.refused("ada", { type: "add_storey", px: 3, py: 0 }).code).toBe("out_of_bounds");
    expect(w.refused("ada", { type: "add_storey", px: 1, py: 1 }).code).toBe("plot_is_commons");
    expect(w.refused("ada", { type: "add_storey", px: 2, py: 0 }).code).toBe("not_your_plot");
    expect(w.refused("ada", { type: "add_storey", px: 0, py: 2 }).code).toBe("not_your_plot");
    w.purse("bob", STOREYS.price - 1);
    expect(w.refused("bob", { type: "add_storey", px: 2, py: 0 }).code).toBe("not_enough_coins");
    w.purse("bob", STOREYS.price);
    w.ok("bob", { type: "add_storey", px: 2, py: 0 });
    expect(w.state.economy?.coins.bob).toBeUndefined();
    const high = w.refused("bob", { type: "add_storey", px: 2, py: 0 });
    expect(high.code).toBe("too_high");
    expect(STOREYS.max).toBe(1);
    expect(high.message).toBe("Homes go up one storey above the ground floor.");

    const closed = world({ economy: false });
    expect(closed.refused("ada", { type: "add_storey", px: 0, py: 0 }).code).toBe("economy_closed");
  });
});

describe("building upstairs", () => {
  it("lays floors and places blocks on a layer of their own, held up by the walls below", () => {
    const w = world();
    w.ok("ada", { type: "add_storey", px: 0, py: 0 });
    expect(w.ok("ada", { type: "lay", x: 2, y: 2, storey: 1, ground: "moss" })).toEqual([
      { type: "ground_laid", x: 2, y: 2, storey: 1, ground: "moss", by: "ada" },
    ]);
    expect(w.ok("ada", { type: "place", x: 2, y: 2, storey: 1, block: "wood" })).toEqual([
      { type: "block_placed", x: 2, y: 2, storey: 1, block: "wood", by: "ada" },
    ]);
    // A window on a wall needs no floor of its own.
    w.ok("ada", { type: "place", x: 1, y: 1, storey: 1, block: "glass" });
    expect(w.state.storeys?.["1"]).toEqual({
      blocks: { "2,2": "wood", "1,1": "glass" },
      ground: { "2,2": "moss" },
    });
    // The ground floor is as it was: no floor inside the hut, the wall under the window.
    expect(w.state.ground).toBeUndefined();
    expect(w.state.blocks["2,2"]).toBeUndefined();
    expect(w.state.blocks["1,1"]).toBe("wood");
    // A floor with a cost takes it upstairs too, and gives it back when it's lifted.
    w.give("ada", { wood: 1 });
    const laid = w.ok("ada", { type: "lay", x: 4, y: 4, storey: 1, ground: "planks" });
    expect(ofType(laid, "inventory")[0]?.changes).toEqual([{ kind: "wood", amount: -1, count: 0 }]);
    const lifted = w.ok("ada", { type: "lift", x: 4, y: 4, storey: 1 });
    expect(lifted[0]).toEqual({ type: "ground_lifted", x: 4, y: 4, storey: 1, by: "ada" });
    expect(ofType(lifted, "inventory")[0]?.changes).toEqual([
      { kind: "wood", amount: 1, count: 1 },
    ]);
    expect(w.ok("ada", { type: "remove", x: 2, y: 2, storey: 1 })[0]).toEqual({
      type: "block_removed",
      x: 2,
      y: 2,
      storey: 1,
      by: "ada",
    });
  });

  it("refuses a storey the plot hasn't added, one past the top, and one that isn't a storey", () => {
    const w = world();
    const lay = (storey: unknown) =>
      w.refused("ada", { type: "lay", x: 2, y: 2, storey, ground: "moss" } as Command).code;
    expect(lay(1)).toBe("no_storey");
    w.ok("ada", { type: "add_storey", px: 0, py: 0 });
    expect(lay(2)).toBe("too_high");
    for (const odd of [-1, 0.5, "1", "__proto__", null]) expect(lay(odd)).toBe("out_of_bounds");
    // Only a plot's own storeys: Bob's plot hasn't added one.
    expect(w.refused("bob", { type: "place", x: 19, y: 4, storey: 1, block: "wood" }).code).toBe(
      "no_storey",
    );
  });

  it("needs a wall on the plot within 2 tiles below a floor", () => {
    const w = world();
    w.ok("bob", { type: "add_storey", px: 2, py: 0 });
    const lay = (x: number) =>
      w.refused("bob", { type: "lay", x, y: 3, storey: 1, ground: "dirt" });
    expect(lay(19).code).toBe("nothing_under");
    w.ok("bob", { type: "place", x: 17, y: 3, block: "stone" });
    w.ok("bob", { type: "lay", x: 19, y: 3, storey: 1, ground: "dirt" });
    expect(lay(20).code).toBe("nothing_under");
    // A hedge holds nothing up.
    w.ok("bob", { type: "place", x: 21, y: 3, block: "leaf" });
    expect(lay(20).code).toBe("nothing_under");

    // A wall on the plot next door holds up nothing here: Ada's wall at (7, 3) is one tile from
    // Cy's (8, 3).
    w.standAt("ada", 5, 3);
    w.ok("ada", { type: "place", x: 7, y: 3, block: "wood" });
    w.ok("cy", { type: "add_storey", px: 1, py: 0 });
    w.standAt("cy", 9, 3);
    expect(w.refused("cy", { type: "lay", x: 8, y: 3, storey: 1, ground: "dirt" }).code).toBe(
      "nothing_under",
    );
  });

  it("needs a floor, or a wall right under it, for a block upstairs", () => {
    const w = world();
    w.ok("ada", { type: "add_storey", px: 0, py: 0 });
    // Over Ada's hearth there's no floor and no wall.
    expect(w.refused("ada", { type: "place", x: 3, y: 3, storey: 1, block: "wood" }).code).toBe(
      "nothing_under",
    );
    w.ok("ada", { type: "lay", x: 3, y: 3, storey: 1, ground: "sand" });
    // Over a hearth, and over Ada standing there, since both are on the ground floor.
    w.ok("ada", { type: "place", x: 3, y: 3, storey: 1, block: "wood" });
    expect(w.refused("ada", { type: "place", x: 3, y: 3, storey: 1, block: "stone" }).code).toBe(
      "tile_occupied",
    );
  });

  it("keeps planters, stations, displays, ponds, and candy bowls on the ground floor", () => {
    const w = world();
    w.ok("ada", { type: "add_storey", px: 0, py: 0 });
    w.ok("ada", { type: "lay", x: 2, y: 2, storey: 1, ground: "moss" });
    const kept: BlockKind[] = [
      "planter",
      "kitchen",
      "workbench",
      "pedestal",
      "frame",
      "pond",
      "candy_bowl",
    ];
    for (const block of kept) {
      const no = w.refused("ada", { type: "place", x: 2, y: 2, storey: 1, block });
      expect(no.code, block).toBe("ground_floor_only");
    }
    // Furniture and decor go up.
    w.give("ada", { chair: 1 });
    w.ok("ada", { type: "place", x: 2, y: 2, storey: 1, block: "chair" });
  });

  it("never takes away a wall or a floor that holds something up", () => {
    const w = world();
    w.ok("bob", { type: "add_storey", px: 2, py: 0 });
    w.ok("bob", { type: "place", x: 17, y: 3, block: "stone" });
    w.ok("bob", { type: "lay", x: 19, y: 3, storey: 1, ground: "dirt" });
    // The only wall within 2 tiles of the floor.
    expect(w.refused("bob", { type: "remove", x: 17, y: 3 }).code).toBe("holds_up");
    // Another wall within 2 tiles of it lets the first one go.
    w.ok("bob", { type: "place", x: 21, y: 4, block: "glass" });
    w.ok("bob", { type: "remove", x: 17, y: 3 });

    w.ok("ada", { type: "add_storey", px: 0, py: 0 });
    // A window standing on a wall, with no floor of its own.
    w.ok("ada", { type: "place", x: 1, y: 1, storey: 1, block: "glass" });
    expect(w.refused("ada", { type: "remove", x: 1, y: 1 }).code).toBe("holds_up");
    // A floor under a block with no wall under it holds the block up; with a wall it doesn't.
    w.ok("ada", { type: "lay", x: 2, y: 2, storey: 1, ground: "moss" });
    w.ok("ada", { type: "place", x: 2, y: 2, storey: 1, block: "wood" });
    expect(w.refused("ada", { type: "lift", x: 2, y: 2, storey: 1 }).code).toBe("holds_up");
    w.ok("ada", { type: "lay", x: 1, y: 2, storey: 1, ground: "moss" });
    w.ok("ada", { type: "place", x: 1, y: 2, storey: 1, block: "wood" });
    w.ok("ada", { type: "lift", x: 1, y: 2, storey: 1 });
    // Taking a block away upstairs, then its floor, is fine.
    w.ok("ada", { type: "remove", x: 2, y: 2, storey: 1 });
    w.ok("ada", { type: "lift", x: 2, y: 2, storey: 1 });
  });

  it("merges a record into another only with nothing left on any storey of its plot", () => {
    const w = world();
    w.ok("bob", { type: "add_storey", px: 2, py: 0 });
    w.ok("bob", { type: "leave" });
    // A floor upstairs and nothing on the ground floor, put there directly as above.
    const upstairs = w.state.storeys?.["1"];
    if (!upstairs) throw new Error("no storey 1");
    upstairs.ground["18,3"] = "moss";
    const merge: Command = { type: "merge_resident", from: "bob", into: "cy" };
    expect(w.refused(TOWN_ACTOR, merge).code).toBe("plot_has_blocks");
    delete upstairs.ground["18,3"];
    w.ok(TOWN_ACTOR, merge);
  });

  it("lets a plot go only with nothing left on any storey", () => {
    const w = world();
    w.ok("bob", { type: "add_storey", px: 2, py: 0 });
    // Nothing on the ground floor, a block upstairs. No input can leave a block upstairs with
    // nothing under it, so it's put there directly.
    const upstairs = w.state.storeys?.["1"];
    if (!upstairs) throw new Error("no storey 1");
    upstairs.blocks["18,3"] = "wood";
    expect(w.refused("bob", { type: "release" }).code).toBe("plot_has_blocks");
    delete upstairs.blocks["18,3"];
    upstairs.ground["18,3"] = "moss";
    expect(w.refused("bob", { type: "release" }).code).toBe("plot_has_blocks");
    delete upstairs.ground["18,3"];
    w.ok("bob", { type: "release" });
    // The storey goes with the plot's record.
    expect(w.state.plots["2,0"]).toBeUndefined();
  });
});

/**
 * Ada's hut with a storey: stairs at (2, 4) inside it, coming up at (2, 4) upstairs, and a floor
 * upstairs at (2, 3), (3, 3), and (4, 3), over her hearth. She stands on her hearth.
 */
function loft(options: { reach?: number } = {}) {
  const w = world(options);
  w.ok("ada", { type: "add_storey", px: 0, py: 0 });
  w.give("ada", { wood: STOREYS.stairsWood });
  w.ok("ada", { type: "place", x: 2, y: 4, block: "stairs" });
  for (const x of [2, 3, 4]) w.ok("ada", { type: "lay", x, y: 3, storey: 1, ground: "moss" });
  return w;
}

/** Ada's walk from her hearth up the stairs. */
const UP: Command[] = [
  { type: "move", dir: "sw" },
  { type: "move", dir: "up" },
];

describe("stairs", () => {
  it("go up for wood, under a storey the plot has, with open air above them", () => {
    const w = world();
    const stairs: Command = { type: "place", x: 2, y: 4, block: "stairs" };
    expect(w.refused("ada", stairs).code).toBe("no_storey");
    w.ok("ada", { type: "add_storey", px: 0, py: 0 });
    const short = w.refused("ada", stairs);
    expect(short.code).toBe("not_enough_items");
    expect(short.message).toMatch(/^Stairs take 4 wood, and you need 4 wood more\./);
    w.give("ada", { wood: STOREYS.stairsWood });
    const placed = w.ok("ada", stairs);
    expect(ofType(placed, "inventory")[0]?.changes).toEqual([
      { kind: "wood", amount: -STOREYS.stairsWood, count: 0 },
    ]);
    // Not over a floor upstairs: that's where they come up.
    w.give("ada", { wood: STOREYS.stairsWood });
    w.ok("ada", { type: "lay", x: 2, y: 2, storey: 1, ground: "moss" });
    expect(w.refused("ada", { type: "place", x: 2, y: 2, block: "stairs" }).code).toBe(
      "tile_occupied",
    );
    // Not on the top storey, with nowhere above to go.
    const top = w.refused("ada", { type: "place", x: 2, y: 2, storey: 1, block: "stairs" });
    expect(top.code).toBe("too_high");
    // Taken up, they give their wood back.
    const removed = w.ok("ada", { type: "remove", x: 2, y: 4 });
    expect(ofType(removed, "inventory")[0]?.changes).toEqual([
      { kind: "wood", amount: STOREYS.stairsWood, count: 2 * STOREYS.stairsWood },
    ]);
  });

  it("keep the tile they come up through clear", () => {
    const w = loft();
    const lay = w.refused("ada", { type: "lay", x: 2, y: 4, storey: 1, ground: "moss" });
    expect(lay).toEqual({ code: "tile_occupied", message: "Stairs come up here. Keep it clear." });
    // Nor a block.
    expect(w.refused("ada", { type: "place", x: 2, y: 4, storey: 1, block: "glass" }).code).toBe(
      "tile_occupied",
    );
  });

  it("are the one block you walk onto, and move up and down takes you between storeys", () => {
    const w = loft();
    expect(w.refused("ada", { type: "move", dir: "up" }).code).toBe("no_stairs");
    expect(w.refused("ada", { type: "move", dir: "down" }).code).toBe("no_stairs");
    expect(w.ok("ada", UP[0] as Command)).toEqual([
      { type: "moved", residentId: "ada", x: 2, y: 4 },
    ]);
    expect(w.ok("ada", UP[1] as Command)).toEqual([
      { type: "moved", residentId: "ada", x: 2, y: 4, storey: 1 },
    ]);
    expect(w.state.residents.ada?.storey).toBe(1);
    // At the top there's nothing more to climb.
    expect(w.refused("ada", { type: "move", dir: "up" }).code).toBe("no_stairs");
    expect(w.ok("ada", { type: "move", dir: "down" })).toEqual([
      { type: "moved", residentId: "ada", x: 2, y: 4 },
    ]);
    expect(w.state.residents.ada?.storey).toBeUndefined();
    expect(w.refused("ada", { type: "move", dir: "down" }).code).toBe("no_stairs");
  });

  it("can't be taken from under someone, at the foot or at the top", () => {
    const w = loft();
    w.ok("ada", UP[0] as Command);
    expect(w.refused("ada", { type: "remove", x: 2, y: 4 }).code).toBe("holds_up");
    w.ok("ada", UP[1] as Command);
    expect(w.refused("ada", { type: "remove", x: 2, y: 4 }).code).toBe("holds_up");
    w.ok("ada", { type: "move", dir: "n" });
    w.ok("ada", { type: "remove", x: 2, y: 4 });
  });
});

describe("walking upstairs", () => {
  it("keeps to the floor: never off its edge or past a corner of it", () => {
    const w = loft();
    for (const step of UP) w.ok("ada", step);
    expect(w.ok("ada", { type: "move", dir: "n" })).toEqual([
      { type: "moved", residentId: "ada", x: 2, y: 3, storey: 1 },
    ]);
    w.ok("ada", { type: "move", dir: "e" });
    expect(w.refused("ada", { type: "move", dir: "s" })).toEqual({
      code: "blocked",
      message: "There's no floor there.",
    });
    // From (3, 3) down to the stairwell at (2, 4) cuts past (3, 4), which has no floor.
    expect(w.refused("ada", { type: "move", dir: "sw" })).toEqual({
      code: "blocked",
      message: "The floor's corner is in the way. Step around it.",
    });
    // A putter's steps keep to it too, and say which storey they're on.
    const putter = w.ok("ada", { type: "putter", steps: ["e", "w"] });
    expect(putter.map((e) => e.type === "moved" && e.storey)).toEqual([1, 1]);
    expect(w.refused("ada", { type: "putter", steps: ["e", "n"] }).code).toBe("blocked");
    // A block upstairs is in the way, as one is below.
    w.ok("ada", { type: "place", x: 4, y: 3, storey: 1, block: "wood" });
    expect(w.refused("ada", { type: "move", dir: "e" }).message).toBe("A block is in the way.");
  });

  it("puts a block on a tile only when nobody stands there on that storey", () => {
    const w = loft();
    for (const step of UP) w.ok("ada", step);
    w.ok("ada", { type: "move", dir: "n" });
    // Ada is upstairs at (2, 3): the tile below her is free, the floor she's on isn't.
    w.ok("ada", { type: "place", x: 2, y: 3, block: "leaf" });
    expect(w.refused("ada", { type: "place", x: 2, y: 3, storey: 1, block: "lantern" }).code).toBe(
      "tile_occupied",
    );
    expect(w.refused("ada", { type: "lift", x: 2, y: 3, storey: 1 }).code).toBe("holds_up");
  });

  it("counts a storey as a tile of reach", () => {
    // With a reach of 0, Ada builds only where she stands, on her own storey.
    const w = world({ reach: 0 });
    w.ok("ada", { type: "add_storey", px: 0, py: 0 });
    const far = w.refused("ada", { type: "lay", x: 3, y: 3, storey: 1, ground: "moss" });
    expect(far.code).toBe("out_of_reach");
    expect(far.message).toMatch(/a storey counts as one\. Go up the stairs first\.$/);
  });

  it("brings someone who left upstairs back there, or home if their floor went", () => {
    const w = loft();
    for (const step of UP) w.ok("ada", step);
    w.ok("ada", { type: "move", dir: "n" });
    w.ok("ada", { type: "leave" });
    const back = w.ok("ada", { type: "join", name: "ada", kind: "human" });
    expect(back[0]).toMatchObject({ type: "joined", resident: { x: 2, y: 3, storey: 1 } });
    w.ok("ada", { type: "leave" });
    // While she's away, a co-owner lifts the floor she stood on.
    w.ok("ada", { type: "join", name: "ada", kind: "human" });
    w.ok("ada", { type: "share_plot", with: "bob" });
    w.ok("ada", { type: "leave" });
    w.standAt("bob", 2, 6);
    w.ok("bob", { type: "lift", x: 2, y: 3, storey: 1 });
    const home = w.ok("ada", { type: "join", name: "ada", kind: "human" });
    expect(home[0]).toMatchObject({ type: "joined", resident: { x: 3, y: 3 } });
    expect(w.state.residents.ada?.storey).toBeUndefined();
  });
});

/** Put `id` on the stairs in Ada's hut and send them up to her loft. */
function climb(w: ReturnType<typeof loft>, id: string) {
  w.standAt(id, 2, 4);
  w.ok(id, { type: "move", dir: "up" });
  expect(w.state.residents[id]?.storey).toBe(1);
}

/** Setup only: put `id` on `storey` without a step, and a floor under them there. */
function perch(w: ReturnType<typeof loft>, id: string, x: number, y: number) {
  const layer = w.state.storeys?.["1"];
  const r = w.state.residents[id];
  if (!layer || !r) throw new Error("no storey 1, or no such resident");
  layer.ground[`${x},${y}`] = "moss";
  r.x = x;
  r.y = y;
  r.storey = 1;
}

type Build = Extract<Command, { type: "build" }>;
type Plan = Omit<Build, "type" | "px" | "py">;
const build = (px: number, plan: Plan): Build => ({ type: "build", px, py: 0, ...plan });

/** What a plan skips, worked out without building it. */
function skipped(w: ReturnType<typeof world>, actor: string, command: Build) {
  const prepared = prepare(w.state, { actor, command });
  if (!prepared.ok || !prepared.plan) throw new Error(`${JSON.stringify(command)} should go ahead`);
  return buildSummary(prepared.plan).skipped;
}

/**
 * The starter hut's walls (tiles 1 to 5 each way, a doorway at (3, 5)), stairs inside at (2, 4),
 * a moss loft over all of it but the stairwell, and a glass railing along its south edge.
 */
function hutWithLoft(): Plan {
  const blocks: PlanBlock[] = [];
  const ground: PlanGround[] = [];
  for (let y = 1; y <= 5; y++) {
    for (let x = 1; x <= 5; x++) {
      const edge = x === 1 || x === 5 || y === 1 || y === 5;
      if (edge && !(x === 3 && y === 5)) blocks.push({ x, y, block: "wood" });
      if (!(x === 2 && y === 4)) ground.push({ x, y, storey: 1, ground: "moss" });
    }
  }
  blocks.push({ x: 2, y: 4, block: "stairs" });
  for (const x of [1, 2, 4, 5]) blocks.push({ x, y: 5, storey: 1, block: "glass" });
  return { blocks, ground };
}

/** A plan's entries in the order `plotPlan` reads them: by storey, then north to south, west to east. */
const inOrder = <T extends { x: number; y: number; storey?: number }>(list: readonly T[]) =>
  [...list].sort((a, b) => (a.storey ?? 0) - (b.storey ?? 0) || a.y - b.y || a.x - b.x);

describe("build plans", () => {
  it("build a hut with a loft in one call, the same on two plots, and read it back", () => {
    const w = world();
    const loftPlan = hutWithLoft();
    for (const [id, px] of [
      ["bob", 2],
      ["cy", 1],
    ] as const) {
      w.ok(id, { type: "add_storey", px, py: 0 });
      w.give(id, { wood: STOREYS.stairsWood });
      const events = w.ok(id, build(px, loftPlan));
      // The ground floor's blocks first, then the loft's floors, then its railing.
      const order = events.map((e) => ("storey" in e ? `${e.type} ${e.storey}` : e.type));
      expect([...new Set(order)]).toEqual([
        "block_placed",
        "ground_laid 1",
        "block_placed 1",
        "inventory",
      ]);
      const read = plotPlan(w.state, px, 0);
      expect(read?.blocks).toEqual(inOrder(loftPlan.blocks ?? []));
      expect(read?.ground).toEqual(inOrder(loftPlan.ground ?? []));
    }
    // Bob walks up his new stairs.
    w.standAt("bob", 18, 4);
    w.ok("bob", { type: "move", dir: "up" });
    w.ok("bob", { type: "move", dir: "n" });
    expect(w.state.residents.bob).toMatchObject({ x: 18, y: 3, storey: 1 });
  });

  it("refuse whole a storey the plot hasn't added, one past the top, one that isn't, and kinds that can't go there", () => {
    const w = world();
    const floor = (storey: unknown) =>
      build(2, { ground: [{ x: 3, y: 3, storey, ground: "moss" } as PlanGround] });
    const noStorey = w.refused("bob", floor(1));
    expect(noStorey.code).toBe("no_storey");
    expect(noStorey.message).toContain(`add_storey adds it for ${STOREYS.price} coins`);
    expect(w.refused("bob", build(2, hutWithLoft())).code).toBe("no_storey");
    expect(w.refused("bob", build(2, { remove: [{ x: 1, y: 1, storey: 1 }] })).code).toBe(
      "no_storey",
    );
    w.ok("bob", { type: "add_storey", px: 2, py: 0 });
    expect(w.refused("bob", floor(2)).code).toBe("too_high");
    for (const odd of [-1, 0.5, "1", "__proto__", null]) {
      expect(w.refused("bob", floor(odd)).code, String(odd)).toBe("invalid_plan");
    }
    // The same tile on two storeys is two tiles; twice on one storey is a mistake.
    const twice = w.refused("bob", {
      ...floor(1),
      ground: [
        { x: 3, y: 3, storey: 1, ground: "moss" },
        { x: 3, y: 3, storey: 1, ground: "dirt" },
      ],
    });
    expect(twice).toEqual({
      code: "invalid_plan",
      message: "(3, 3) on storey 1 is in ground twice.",
    });
    const upstairs = (block: BlockKind) => build(2, { blocks: [{ x: 3, y: 3, storey: 1, block }] });
    expect(w.refused("bob", upstairs("planter")).code).toBe("ground_floor_only");
    expect(w.refused("bob", upstairs("stairs")).code).toBe("too_high");
    // Stairs up to a storey Cy's plot hasn't added.
    w.give("cy", { wood: STOREYS.stairsWood });
    const stairs = build(1, { blocks: [{ x: 3, y: 4, block: "stairs" }] });
    expect(w.refused("cy", stairs).code).toBe("no_storey");
  });

  it("hold a whole plot on every storey in one list", () => {
    const w = world();
    w.ok("bob", { type: "add_storey", px: 2, py: 0 });
    const ground: PlanGround[] = [];
    for (const storey of [0, 1]) {
      for (let y = 0; y < CONFIG.plotSize; y++) {
        for (let x = 0; x < CONFIG.plotSize; x++) ground.push({ x, y, storey, ground: "moss" });
      }
    }
    expect(ground).toHaveLength(planMax(CONFIG));
    // No walls on Bob's plot, so nothing holds the upstairs floors: the ground floor's go down.
    const skips = skipped(w, "bob", build(2, { ground }));
    expect(skips).toHaveLength(CONFIG.plotSize ** 2);
    expect(skips.every((s) => s.storey === 1 && s.why === "unsupported")).toBe(true);
  });

  it("skip a floor or a block upstairs that nothing would hold up", () => {
    const w = world();
    w.ok("bob", { type: "add_storey", px: 2, py: 0 });
    w.ok("bob", { type: "place", x: 17, y: 3, block: "stone" });
    const plan = build(2, {
      ground: [
        { x: 3, y: 3, storey: 1, ground: "moss" },
        { x: 4, y: 3, storey: 1, ground: "moss" },
      ],
      blocks: [
        // On the floor the plan lays, on the wall below, and on nothing.
        { x: 3, y: 3, storey: 1, block: "glass" },
        { x: 1, y: 3, storey: 1, block: "wood" },
        { x: 5, y: 3, storey: 1, block: "glass" },
      ],
    });
    expect(skipped(w, "bob", plan)).toEqual([
      { x: 4, y: 3, storey: 1, what: "ground", why: "unsupported" },
      { x: 5, y: 3, storey: 1, what: "block", why: "unsupported" },
    ]);
    w.ok("bob", plan);
    expect(w.state.storeys?.["1"]).toEqual({
      blocks: { "19,3": "glass", "17,3": "wood" },
      ground: { "19,3": "moss" },
    });
  });

  it("keep a wall that holds up a floor the plan keeps, and take it once the plan lifts that floor first", () => {
    const w = world();
    w.ok("bob", { type: "add_storey", px: 2, py: 0 });
    w.ok("bob", { type: "place", x: 17, y: 3, block: "stone" });
    w.ok("bob", { type: "lay", x: 18, y: 3, storey: 1, ground: "dirt" });
    w.ok("bob", { type: "lay", x: 19, y: 3, storey: 1, ground: "dirt" });
    const keeps = build(2, { remove: [{ x: 1, y: 3 }], lift: [{ x: 2, y: 3, storey: 1 }] });
    expect(skipped(w, "bob", keeps)).toEqual([{ x: 1, y: 3, what: "remove", why: "holds_up" }]);
    w.ok("bob", keeps);
    expect(w.state.blocks["17,3"]).toBe("stone");
    // Lifting the last floor goes first, from the top storey down, so the wall can go after it.
    const both = build(2, { remove: [{ x: 1, y: 3 }], lift: [{ x: 3, y: 3, storey: 1 }] });
    expect(w.ok("bob", both)).toEqual([
      { type: "ground_lifted", x: 19, y: 3, storey: 1, by: "bob" },
      { type: "block_removed", x: 17, y: 3, by: "bob" },
    ]);
  });

  it("keep a wall that holds up a floor or a block upstairs the plan doesn't name", () => {
    const w = world();
    w.ok("bob", { type: "add_storey", px: 2, py: 0 });
    w.ok("bob", { type: "place", x: 17, y: 3, block: "stone" });
    w.ok("bob", { type: "place", x: 21, y: 3, block: "stone" });
    w.ok("bob", { type: "lay", x: 19, y: 3, storey: 1, ground: "dirt" });
    w.ok("bob", { type: "place", x: 21, y: 3, storey: 1, block: "glass" });
    const walls = build(2, {
      remove: [
        { x: 1, y: 3 },
        { x: 5, y: 3 },
      ],
    });
    // The floor at (3, 3) upstairs has another wall within reach, so one of the two could go; the
    // window at (5, 3) upstairs stands on its wall, so that one can't.
    expect(skipped(w, "bob", walls)).toEqual([{ x: 5, y: 3, what: "remove", why: "holds_up" }]);
    w.ok("bob", walls);
    const last = w.refused("bob", build(2, { remove: [{ x: 5, y: 3 }] }));
    expect(last).toEqual({
      code: "tile_occupied",
      message: "Nothing in the plan can be built right now. (5, 3): it holds something up.",
    });
    w.ok("bob", { type: "remove", x: 21, y: 3, storey: 1 });
    // Now it's the last wall under the floor, which the plan doesn't name.
    expect(
      skipped(
        w,
        "bob",
        build(2, { remove: [{ x: 5, y: 3 }], ground: [{ x: 0, y: 7, ground: "dirt" }] }),
      ),
    ).toEqual([{ x: 5, y: 3, what: "remove", why: "holds_up" }]);
    expect(w.state.blocks["21,3"]).toBe("stone");
  });

  it("keep stairs someone stands on, at the foot or at the top, and a floor someone stands on", () => {
    const w = loft();
    const stairs = build(0, { remove: [{ x: 2, y: 4 }], ground: [{ x: 0, y: 7, ground: "dirt" }] });
    const held = [{ x: 2, y: 4, what: "remove", why: "holds_up" }];
    w.ok("ada", UP[0] as Command);
    expect(skipped(w, "ada", stairs)).toEqual(held);
    w.ok("ada", UP[1] as Command);
    expect(skipped(w, "ada", stairs)).toEqual(held);
    w.ok("ada", { type: "move", dir: "n" });
    const floor = build(0, {
      lift: [{ x: 2, y: 3, storey: 1 }],
      ground: [{ x: 0, y: 7, ground: "dirt" }],
    });
    expect(skipped(w, "ada", floor)).toEqual([
      { x: 2, y: 3, storey: 1, what: "lift", why: "holds_up" },
    ]);
    // Off the stairs, they come up and give their wood back.
    const removed = w.ok("ada", stairs);
    expect(removed[0]).toEqual({ type: "block_removed", x: 2, y: 4, by: "ada" });
    expect(ofType(removed, "inventory")[0]?.changes).toEqual([
      { kind: "wood", amount: STOREYS.stairsWood, count: STOREYS.stairsWood },
    ]);
  });

  it("put stairs up under open air and keep their stairwell clear", () => {
    const w = loft();
    w.give("ada", { wood: STOREYS.stairsWood });
    // A floor is over (4, 3), so stairs can't come up there until the plan lifts it.
    const under = build(0, {
      blocks: [{ x: 4, y: 3, block: "stairs" }],
      ground: [{ x: 0, y: 7, ground: "dirt" }],
    });
    expect(skipped(w, "ada", under)).toEqual([{ x: 4, y: 3, what: "block", why: "occupied" }]);
    const plan = build(0, {
      lift: [{ x: 4, y: 3, storey: 1 }],
      blocks: [
        { x: 4, y: 3, block: "stairs" },
        { x: 2, y: 4, storey: 1, block: "glass" },
      ],
      ground: [
        { x: 4, y: 3, storey: 1, ground: "moss" },
        { x: 2, y: 4, storey: 1, ground: "moss" },
      ],
    });
    expect(skipped(w, "ada", plan)).toEqual([
      { x: 4, y: 3, storey: 1, what: "ground", why: "occupied" },
      { x: 2, y: 4, storey: 1, what: "ground", why: "occupied" },
      { x: 2, y: 4, storey: 1, what: "block", why: "occupied" },
    ]);
    w.ok("ada", plan);
    expect(w.state.blocks["4,3"]).toBe("stairs");
  });

  it("put a block on a tile only when nobody stands there on that storey", () => {
    const w = loft();
    // Hearths, crops, and displays are the ground floor's: upstairs over them, blocks come and go.
    w.give("ada", { herb_seed: 1, flower: 3 });
    w.ok("ada", { type: "place", x: 4, y: 4, block: "planter" });
    w.ok("ada", { type: "plant", x: 4, y: 4, seed: "herb" });
    w.ok("ada", { type: "place", x: 2, y: 2, block: "workbench" });
    w.ok("ada", { type: "craft", recipe: "bouquet", x: 2, y: 2 });
    w.ok("ada", { type: "place", x: 4, y: 2, block: "pedestal" });
    const bouquet = w.state.items?.inventories.ada?.goods[0]?.id as string;
    w.ok("ada", { type: "display", item: bouquet, x: 4, y: 2 });
    const over = [
      { x: 3, y: 3, storey: 1 },
      { x: 4, y: 4, storey: 1 },
      { x: 4, y: 2, storey: 1 },
    ];
    const up = build(0, {
      ground: [
        { x: 4, y: 4, storey: 1, ground: "moss" },
        { x: 4, y: 2, storey: 1, ground: "moss" },
      ],
      blocks: over.map((t) => ({ ...t, block: "glass" as const })),
    });
    expect(skipped(w, "ada", up)).toEqual([]);
    w.ok("ada", up);
    const down = build(0, { remove: over });
    expect(skipped(w, "ada", down)).toEqual([]);
    w.ok("ada", down);
    expect(w.state.storeys?.["1"]?.blocks).toEqual({});
    for (const step of UP) w.ok("ada", step);
    w.ok("ada", { type: "move", dir: "n" });
    // Ada is upstairs at (2, 3): the tile below her is free, the floor she's on isn't.
    const plan = build(0, {
      blocks: [
        { x: 2, y: 3, block: "leaf" },
        { x: 2, y: 3, storey: 1, block: "glass" },
      ],
    });
    expect(skipped(w, "ada", plan)).toEqual([
      { x: 2, y: 3, storey: 1, what: "block", why: "standing" },
    ]);
  });
});

describe("jumps", () => {
  /** The last `moved` of `events` for `id`, which a jump lands with no `storey`. */
  const landed = (w: ReturnType<typeof loft>, events: WorldEvent[], id: string) => {
    const moved = ofType(events, "moved").filter((e) => e.residentId === id);
    expect(moved.at(-1)?.storey).toBeUndefined();
    expect(w.state.residents[id]?.storey).toBeUndefined();
  };

  it("settle and visit land on the ground floor", () => {
    const w = loft();
    w.ok("dan", { type: "join", name: "dan", kind: "human" });
    climb(w, "dan");
    landed(w, w.ok("dan", { type: "settle", px: 0, py: 1 }), "dan");
    // Upstairs right over the tile settle lands on is still a jump down, with its moved event.
    w.ok("eve", { type: "join", name: "eve", kind: "human" });
    perch(w, "eve", 19, 11);
    const down = w.ok("eve", { type: "settle", px: 2, py: 1 });
    expect(ofType(down, "moved")).toEqual([{ type: "moved", residentId: "eve", x: 19, y: 11 }]);
    landed(w, down, "eve");
    climb(w, "bob");
    const tile = visitTile(w.state, "bob", 1, 0);
    if (!tile) throw new Error("nowhere to land on Cy's plot");
    landed(w, w.ok("bob", { type: "visit", px: 1, py: 0, ...tile }), "bob");
  });

  it("join_event, open_table, and sit land on the ground floor", () => {
    const w = loft();
    w.ok(TOWN_ACTOR, {
      type: "schedule_town_event",
      key: "loft-night",
      kind: "gathering",
      title: "Loft night",
      startsAt: (20_000 * 24 + 18) * 3_600_000,
      minutes: 60,
    });
    w.ok(TOWN_ACTOR, { type: "event_start", event: "e_1" });
    climb(w, "ada");
    landed(w, w.ok("ada", { type: "join_event", event: "e_1" }), "ada");
    climb(w, "ada");
    const salt = "0123456789abcdef0123456789abcdef";
    const opened = w.ok("ada", {
      type: "open_table",
      game: "hearth_race",
      pace: "slow",
      salt,
      at: 1,
    });
    landed(w, opened, "ada");
    climb(w, "bob");
    landed(w, w.ok("bob", { type: "sit", table: "g_1", at: 2 }), "bob");
  });

  it("walk_home, a routine's, lands on the ground floor", () => {
    const w = loft();
    w.ok("ada", { type: "set_routines", routines: [{ kind: "walk_home", hour: 18 }] });
    climb(w, "ada");
    w.ok("ada", { type: "leave" });
    const step = { type: "home" } as const;
    const walked = w.ok(TOWN_ACTOR, {
      type: "routine_step",
      resident: "ada",
      routine: "walk_home",
      step,
    });
    landed(w, walked, "ada");
  });
});

describe("the ground floor", () => {
  it("is where the hearth is: no allowance or pantry over it upstairs, and home jumps down", () => {
    const w = loft();
    for (const step of UP) w.ok("ada", step);
    w.ok(TOWN_ACTOR, { type: "new_day", day: 20_001 });
    // Today's pantry has something to bring.
    const inv = w.state.items?.inventories.ada;
    for (const kind of PANTRY_STAPLES) if (inv) delete inv.stacks[kind];
    w.ok("ada", { type: "move", dir: "n" });
    const over = w.ok("ada", { type: "move", dir: "e" });
    expect(w.state.residents.ada).toMatchObject({ x: 3, y: 3, storey: 1 });
    expect(over).toEqual([{ type: "moved", residentId: "ada", x: 3, y: 3, storey: 1 }]);
    const home = w.ok("ada", { type: "home" });
    expect(home[0]).toEqual({ type: "moved", residentId: "ada", x: 3, y: 3 });
    expect(w.state.residents.ada?.storey).toBeUndefined();
    expect(ofType(home, "coins").map((e) => e.reason)).toContain("allowance");
    expect(ofType(home, "inventory").map((e) => e.reason)).toContain("pantry");
  });

  it("is where gathering and fishing happen", () => {
    const w = loft();
    for (const step of UP) w.ok("ada", step);
    expect(w.refused("ada", { type: "gather" })).toEqual({
      code: "ground_floor_only",
      message: "Go down to the ground floor to gather.",
    });
    const cast: Command = { type: "fish", roll: 0, weather: "clear", timeOfDay: "day" };
    expect(w.refused("ada", cast).code).toBe("ground_floor_only");
  });

  it("is where doors are knocked on", () => {
    const w = loft();
    w.ok(TOWN_ACTOR, { type: "new_day", day: dayOfDate(2024, 10, 31) });
    climb(w, "ada");
    expect(w.refused("ada", { type: "trick_or_treat", px: 1, py: 0 })).toEqual({
      code: "ground_floor_only",
      message: "Go down to the ground floor to knock on a door.",
    });
  });

  it("is where blocks go around people: someone upstairs is in nobody's way below", () => {
    const w = loft();
    w.ok("dan", { type: "join", name: "dan", kind: "human" });
    w.ok("cy", { type: "add_storey", px: 1, py: 0 });
    // Cy's hut will have walls at (9, 1) and (10, 1). Cy stands over one, Dan over the other.
    perch(w, "cy", 9, 1);
    perch(w, "dan", 10, 1);
    const built = w.ok("cy", { type: "build_starter_home" });
    const walls = ofType(built, "block_placed").map((e) => `${e.x},${e.y}`);
    expect(walls).toEqual(expect.arrayContaining(["9,1", "10,1"]));
    // Cy isn't walled in, so she doesn't step aside onto her new hearth.
    expect(ofType(built, "moved")).toEqual([]);
    expect(w.state.residents.cy).toMatchObject({ x: 9, y: 1, storey: 1 });
  });
});

describe("the storeys log", () => {
  it("replays to its pinned hash", () => {
    expect(hashWorld(replay(STOREYS_CONFIG, STOREYS_LOG))).toBe(STOREYS_HASH);
  });

  it("pays Dee's allowance at her hearth on the ground floor, never over it upstairs", () => {
    // The log ends: the new day, a step over her hearth upstairs, home, then up and down again.
    const homeAt = STOREYS_LOG.findIndex((i) => i.actor === "dee" && i.command.type === "home");
    const state = replay(STOREYS_CONFIG, STOREYS_LOG.slice(0, homeAt));
    expect(state.residents.dee).toMatchObject({ x: 11, y: 3, storey: 1 });
    const today = (state.economy?.ledgers.dee ?? []).filter((l) => l.day === 20_021);
    expect(today).toEqual([]);
    const home = apply(state, STOREYS_LOG[homeAt] as Input);
    expect(home.ok && home.events.some((e) => e.type === "coins" && e.reason === "allowance")).toBe(
      true,
    );
  });
});
