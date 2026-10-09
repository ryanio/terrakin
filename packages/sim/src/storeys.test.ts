import { describe, expect, it } from "vitest";
import { apply } from "./apply";
import { STOREYS_CONFIG, STOREYS_HASH, STOREYS_LOG } from "./fixtures/storeys-log";
import { hashWorld } from "./hash";
import { ITEMS, inventorySize, type StackKind } from "./items";
import { replay } from "./replay";
import { STOREYS } from "./storeys";
import { expectSupplyHolds, fund, stock } from "./test-support";
import {
  type BlockKind,
  type Command,
  type Rejection,
  TOWN_ACTOR,
  type WorldConfig,
  type WorldEvent,
} from "./types";
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
function world({ economy = true } = {}) {
  const state = createWorld(CONFIG);
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
    expect(w.state.economy?.coins.ada).toBe(before - STOREYS.price);
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

describe("the storeys log", () => {
  it("replays to its pinned hash", () => {
    expect(hashWorld(replay(STOREYS_CONFIG, STOREYS_LOG))).toBe(STOREYS_HASH);
  });
});
