import { describe, expect, it } from "vitest";
import { apply, prepare } from "./apply";
import { buildSummary, planMax, plotPlan } from "./build";
import { BUILD_CONFIG, BUILD_HASH, BUILD_LOG } from "./fixtures/build-log";
import { hashWorld } from "./hash";
import { ITEMS, inventoryOf, inventorySize, type StackKind } from "./items";
import { replay } from "./replay";
import { fund, stock } from "./test-support";
import {
  type Command,
  type Rejection,
  TOWN_ACTOR,
  type WorldConfig,
  type WorldEvent,
} from "./types";
import { createWorld, isSolid } from "./world";

// 3x3 plots of 8 tiles. The Commons is plot (1, 1). Ada settles plot (0, 0): her hearth is (3, 3)
// inside a hut from (1, 1) to (5, 5) with its doorway at (3, 5), and a workbench goes in at (4, 3).
// Bob settles plot (2, 0), tiles x 16 to 23.
const CONFIG: WorldConfig = {
  width: 24,
  height: 24,
  plotSize: 8,
  maxPlotsPerResident: 1,
  reach: 3,
};
const DAY = 20_000;
type Build = Extract<Command, { type: "build" }>;

/** A world where every rejection is checked to leave the state byte-identical. */
function world({ items = true } = {}) {
  const state = createWorld(CONFIG);
  const send = (actor: string, command: Command) => {
    const before = hashWorld(state);
    const result = apply(state, { actor, command });
    if (!result.ok) expect(hashWorld(state)).toBe(before);
    for (const inv of Object.values(state.items?.inventories ?? {})) {
      expect(inventorySize(inv)).toBeLessThanOrEqual(ITEMS.inventoryMax);
      for (const n of Object.values(inv.stacks)) expect(n).toBeGreaterThan(0);
    }
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
  const settle = (name: string, px: number, py: number) => {
    ok(name, { type: "join", name, kind: "human" });
    ok(name, { type: "settle", px, py });
    ok(name, { type: "build_starter_home" });
  };
  ok(TOWN_ACTOR, { type: "new_day", day: DAY });
  if (items) ok(TOWN_ACTOR, { type: "open_items" });
  settle("ada", 0, 0);
  settle("bob", 2, 0);
  const has = (id: string, kind: StackKind) => state.items?.inventories[id]?.stacks[kind] ?? 0;
  const give = (id: string, stacks: Partial<Record<StackKind, number>>) => stock(state, id, stacks);
  /** Put a resident on a tile without walking there. Setup only: no event, no log line. */
  const standAt = (id: string, x: number, y: number) => {
    const r = state.residents[id];
    if (!r) throw new Error(`${id} isn't in the world`);
    r.x = x;
    r.y = y;
  };
  return { state, send, ok, refused, settle, has, give, standAt };
}

const ofType = <T extends WorldEvent["type"]>(events: WorldEvent[], type: T) =>
  events.filter((e): e is Extract<WorldEvent, { type: T }> => e.type === type);

describe("paths and floors", () => {
  it("go under blocks, hearths, and people, and never change where anyone can walk", () => {
    const w = world();
    // Ada stands on her hearth at (3, 3): ground goes under her, her hearth, and a hut wall.
    w.ok("ada", { type: "lay", x: 3, y: 3, ground: "leaves" });
    w.ok("ada", { type: "lay", x: 3, y: 1, ground: "dirt" });
    expect(w.state.ground).toEqual({ "3,3": "leaves", "3,1": "dirt" });
    expect(isSolid(w.state, 3, 1)).toBe(true);
    // An open tile with a path is still open: she walks out of the door onto it.
    w.ok("ada", { type: "lay", x: 3, y: 5, ground: "moss" });
    w.ok("ada", { type: "move", dir: "s" });
    w.ok("ada", { type: "move", dir: "s" });
    expect(w.state.residents.ada).toMatchObject({ x: 3, y: 5 });
    // And the wall with a path under it still stops her.
    for (let i = 0; i < 3; i++) w.ok("ada", { type: "move", dir: "n" });
    expect(w.state.residents.ada).toMatchObject({ x: 3, y: 2 });
    expect(w.refused("ada", { type: "move", dir: "n" }).code).toBe("blocked");
  });

  it("take what their kind costs and give it back to whoever lifts them", () => {
    const w = world();
    w.ok("ada", { type: "share_plot", with: "bob" });
    w.give("ada", { stone: 2 });
    const laid = w.ok("ada", { type: "lay", x: 2, y: 2, ground: "cobble" });
    expect(laid).toContainEqual({ type: "ground_laid", x: 2, y: 2, ground: "cobble", by: "ada" });
    expect(ofType(laid, "inventory")).toEqual([
      {
        type: "inventory",
        residentId: "ada",
        reason: "laid",
        changes: [{ kind: "stone", amount: -1, count: 1 }],
      },
    ]);
    // Bob shares the plot and stands beside it to lift it: the stone is his now, as decor would be.
    w.standAt("bob", 3, 4);
    const lifted = w.ok("bob", { type: "lift", x: 2, y: 2 });
    expect(lifted[0]).toEqual({ type: "ground_lifted", x: 2, y: 2, by: "bob" });
    expect(w.has("bob", "stone")).toBe(1);
    expect(w.has("ada", "stone")).toBe(1);
    expect(w.state.ground).toEqual({});
    // A free kind touches nobody's things.
    expect(ofType(w.ok("ada", { type: "lay", x: 2, y: 2, ground: "dirt" }), "inventory")).toEqual(
      [],
    );
  });

  it("are refused, with the next step, when the tile, the kind, or the materials are wrong", () => {
    const w = world();
    const lay = (x: number, y: number, ground: string) =>
      w.refused("ada", { type: "lay", x, y, ground: ground as never });
    expect(lay(2, 2, "lava").code).toBe("unknown_item");
    expect(lay(7, 7, "dirt").code).toBe("out_of_reach");
    // From her plot's east edge, the unclaimed plot next door is in reach but not hers.
    w.standAt("ada", 7, 3);
    expect(lay(8, 3, "dirt").code).toBe("not_your_plot");
    w.standAt("ada", 3, 3);
    const stone = lay(2, 2, "cobble");
    expect(stone.code).toBe("not_enough_items");
    expect(stone.message).toContain("gather");
    expect(lay(2, 2, "flower_bed").message).toContain("planter");
    w.ok("ada", { type: "lay", x: 2, y: 2, ground: "sand" });
    expect(lay(2, 2, "sand").code).toBe("tile_occupied");
    expect(lay(2, 2, "moss").message).toContain("Lift it first");
    expect(w.refused("ada", { type: "lift", x: 2, y: 3 }).code).toBe("no_ground");
    // Lifting needs room for what comes back.
    w.give("ada", { wood: 1 });
    w.ok("ada", { type: "lay", x: 4, y: 4, ground: "planks" });
    w.give("ada", { sugar: ITEMS.inventoryMax - inventorySize(w.state.items?.inventories.ada) });
    expect(w.refused("ada", { type: "lift", x: 4, y: 4 }).code).toBe("inventory_full");
  });

  it("cost nothing to lay before items open, and anything that costs waits for them", () => {
    const w = world({ items: false });
    w.ok("ada", { type: "lay", x: 2, y: 2, ground: "dirt" });
    expect(w.refused("ada", { type: "lay", x: 2, y: 3, ground: "cobble" }).code).toBe(
      "items_closed",
    );
    w.ok("ada", { type: "lift", x: 2, y: 2 });
  });

  it("keep a plot from being released until they're lifted", () => {
    const w = world();
    // Clear Ada's hut with one plan, leaving a path.
    const hut = Object.keys(w.state.blocks)
      .map((k) => k.split(",").map(Number) as [number, number])
      .filter(([x, y]) => x < 8 && y < 8)
      .map(([x, y]) => ({ x, y }));
    w.ok("ada", {
      type: "build",
      px: 0,
      py: 0,
      remove: hut,
      ground: [{ x: 6, y: 6, ground: "dirt" }],
    });
    const refusal = w.refused("ada", { type: "release" });
    expect(refusal.code).toBe("plot_has_blocks");
    expect(refusal.message).toContain("lift");
    w.ok("ada", { type: "build", px: 0, py: 0, lift: [{ x: 6, y: 6 }] });
    w.ok("ada", { type: "release" });
  });
});

describe("furniture", () => {
  it("is made at a workbench from what you gather, stacks, and counts toward a day's making", () => {
    const w = world();
    w.ok("ada", { type: "place", x: 4, y: 3, block: "workbench" });
    w.give("ada", { wood: 3 });
    const made = w.ok("ada", { type: "craft", recipe: "table", x: 4, y: 3 });
    expect(made).toEqual([
      {
        type: "inventory",
        residentId: "ada",
        reason: "craft",
        changes: [
          { kind: "wood", amount: -3, count: 0 },
          { kind: "table", amount: 1, count: 1 },
        ],
      },
    ]);
    expect(w.state.items?.inventories.ada?.goods).toEqual([]);
    expect(inventoryOf(w.state, "ada")?.craftedToday).toBe(1);
  });

  it("is refused with a label, at the wrong station, short of wood, or past a day's making", () => {
    const w = world();
    w.ok("ada", { type: "place", x: 4, y: 3, block: "workbench" });
    w.ok("ada", { type: "place", x: 4, y: 2, block: "kitchen" });
    w.give("ada", { wood: 4 });
    const craft = (recipe: string, x = 4, y = 3, label?: string) =>
      w.refused("ada", {
        type: "craft",
        recipe: recipe as never,
        x,
        y,
        ...(label === undefined ? {} : { label }),
      });
    expect(craft("table", 4, 3, "Oak").code).toBe("invalid_label");
    expect(craft("table", 4, 2).code).toBe("no_station");
    const short = craft("well");
    expect(short.code).toBe("not_enough_items");
    expect(short.message).toContain("6 stone");
    expect(short.message).toContain("gather");
    expect(craft("throne").code).toBe("unknown_item");
    (w.state.items as NonNullable<typeof w.state.items>).today.crafted.ada = ITEMS.craftPerDay;
    expect(craft("chair").code).toBe("craft_limit");
  });

  it("places and takes up like decor, blocks walking, and never builds a starter home", () => {
    const w = world();
    w.ok("ada", { type: "share_plot", with: "bob" });
    const none = w.refused("ada", { type: "place", x: 3, y: 4, block: "table" });
    expect(none.code).toBe("not_enough_items");
    expect(none.message).toContain("workbench");
    w.give("ada", { table: 1 });
    const placed = w.ok("ada", { type: "place", x: 3, y: 4, block: "table" });
    expect(ofType(placed, "inventory")[0]?.reason).toBe("placed");
    expect(w.has("ada", "table")).toBe(0);
    expect(w.refused("ada", { type: "move", dir: "s" }).code).toBe("blocked");
    // Whoever takes it up keeps it, like decor.
    w.standAt("bob", 2, 4);
    w.ok("bob", { type: "remove", x: 3, y: 4 });
    expect(w.has("bob", "table")).toBe(1);
    expect(
      w.refused("ada", { type: "build_starter_home", walls: "stone_wall" as never }).code,
    ).toBe("unknown_item");
  });

  it("can be given and listed in the market like anything that stacks", () => {
    const w = world();
    w.ok(TOWN_ACTOR, { type: "open_economy" });
    w.ok(TOWN_ACTOR, { type: "open_shop" });
    w.ok(TOWN_ACTOR, { type: "open_market" });
    fund(w.state, "ada", 10);
    w.give("ada", { chair: 2 });
    w.ok("ada", { type: "give", item: "chair", to: "bob" });
    expect(w.has("bob", "chair")).toBe(1);
    const listed = w.ok("ada", { type: "list_item", item: "chair", price: 4 });
    expect(ofType(listed, "listed")[0]?.listing).toMatchObject({ kind: "chair", count: 1 });
  });
});

describe("build", () => {
  /** A plan for Ada's plot (0, 0). */
  const plan = (rest: Omit<Build, "type" | "px" | "py">, px = 0, py = 0): Build => ({
    type: "build",
    px,
    py,
    ...rest,
  });

  it("builds a plan on your plot from anywhere, counting tiles from the plot's corner", () => {
    const w = world();
    w.give("ada", { stone: 3, lantern: 1 });
    // Ada stands at (3, 3); (7, 7) is four tiles off, past her reach.
    const events = w.ok(
      "ada",
      plan({
        blocks: [
          { x: 7, y: 7, block: "lantern" },
          { x: 6, y: 7, block: "leaf" },
        ],
        ground: [
          { x: 3, y: 6, ground: "cobble" },
          { x: 3, y: 7, ground: "cobble" },
          { x: 2, y: 7, ground: "dirt" },
        ],
      }),
    );
    expect(events).toEqual([
      { type: "block_placed", x: 7, y: 7, block: "lantern", by: "ada" },
      { type: "block_placed", x: 6, y: 7, block: "leaf", by: "ada" },
      { type: "ground_laid", x: 3, y: 6, ground: "cobble", by: "ada" },
      { type: "ground_laid", x: 3, y: 7, ground: "cobble", by: "ada" },
      { type: "ground_laid", x: 2, y: 7, ground: "dirt", by: "ada" },
      {
        type: "inventory",
        residentId: "ada",
        reason: "built",
        changes: [
          { kind: "stone", amount: -2, count: 1 },
          { kind: "lantern", amount: -1, count: 0 },
        ],
      },
    ]);
    // The same plan on Bob's plot lands on his tiles.
    w.give("bob", { stone: 2 });
    w.ok("bob", plan({ ground: [{ x: 3, y: 6, ground: "cobble" }] }, 2, 0));
    expect(w.state.ground?.["19,6"]).toBe("cobble");
  });

  it("takes away first, so a plan can swap a block and move furniture it doesn't hold", () => {
    const w = world();
    w.give("ada", { table: 1 });
    w.ok("ada", { type: "place", x: 2, y: 2, block: "table" });
    w.ok("ada", { type: "lay", x: 2, y: 3, ground: "dirt" });
    const events = w.ok(
      "ada",
      plan({
        remove: [
          { x: 2, y: 2 },
          { x: 1, y: 1 },
        ],
        lift: [{ x: 2, y: 3 }],
        blocks: [
          { x: 4, y: 4, block: "table" },
          { x: 1, y: 1, block: "glass" },
        ],
        ground: [{ x: 2, y: 3, ground: "sand" }],
      }),
    );
    // A plan's events come in the order plans always made them: removals, lifts, blocks, ground.
    expect(events).toEqual([
      { type: "block_removed", x: 2, y: 2, by: "ada" },
      { type: "block_removed", x: 1, y: 1, by: "ada" },
      { type: "ground_lifted", x: 2, y: 3, by: "ada" },
      { type: "block_placed", x: 4, y: 4, block: "table", by: "ada" },
      { type: "block_placed", x: 1, y: 1, block: "glass", by: "ada" },
      { type: "ground_laid", x: 2, y: 3, ground: "sand", by: "ada" },
    ]);
    expect(w.state.blocks["2,2"]).toBeUndefined();
    expect(w.state.blocks["4,4"]).toBe("table");
    expect(w.state.blocks["1,1"]).toBe("glass");
    expect(w.state.ground?.["2,3"]).toBe("sand");
    // The table came back and went out again: nothing to say about Ada's things.
    expect(ofType(events, "inventory")).toEqual([]);
    expect(w.has("ada", "table")).toBe(0);
  });

  it("skips what's in the way, reports why, and builds the rest", () => {
    const w = world();
    w.ok("ada", { type: "place", x: 2, y: 2, block: "planter" });
    w.give("ada", { herb_seed: 1, flower: 3 });
    w.ok("ada", { type: "plant", x: 2, y: 2, seed: "herb" });
    w.ok("ada", { type: "place", x: 4, y: 3, block: "workbench" });
    w.ok("ada", { type: "craft", recipe: "bouquet", x: 4, y: 3 });
    w.ok("ada", { type: "place", x: 4, y: 2, block: "pedestal" });
    const bouquet = w.state.items?.inventories.ada?.goods[0]?.id as string;
    w.ok("ada", { type: "display", item: bouquet, x: 4, y: 2 });
    w.ok("ada", { type: "lay", x: 2, y: 4, ground: "moss" });
    const command = plan({
      remove: [
        { x: 2, y: 2 },
        { x: 4, y: 2 },
        { x: 6, y: 6 },
      ],
      lift: [{ x: 6, y: 6 }],
      blocks: [
        { x: 3, y: 3, block: "wood" },
        { x: 1, y: 1, block: "wood" },
        { x: 1, y: 2, block: "stone" },
        { x: 6, y: 6, block: "leaf" },
      ],
      ground: [
        { x: 2, y: 4, ground: "moss" },
        { x: 3, y: 4, ground: "dirt" },
      ],
    });
    // The plan `prepare` hands back is what the server answers with, and what its commit builds.
    const prepared = prepare(w.state, { actor: "ada", command });
    if (!prepared.ok || !prepared.plan) throw new Error("the plan should go ahead");
    expect(buildSummary(prepared.plan).skipped).toEqual([
      { x: 2, y: 2, what: "remove", why: "growing" },
      { x: 4, y: 2, what: "remove", why: "on_display" },
      { x: 6, y: 6, what: "remove", why: "empty" },
      { x: 6, y: 6, what: "lift", why: "empty" },
      { x: 3, y: 3, what: "block", why: "hearth" },
      { x: 1, y: 1, what: "block", why: "same" },
      { x: 1, y: 2, what: "block", why: "occupied" },
      { x: 2, y: 4, what: "ground", why: "same" },
    ]);
    prepared.commit();
    expect(w.state.blocks["6,6"]).toBe("leaf");
    expect(w.state.ground?.["3,4"]).toBe("dirt");
    expect(w.state.blocks["2,2"]).toBe("planter");
    expect(w.state.blocks["4,2"]).toBe("pedestal");
    // Someone standing on a tile keeps it clear, the builder too.
    w.standAt("ada", 3, 4);
    const standing = w.refused("ada", plan({ blocks: [{ x: 3, y: 4, block: "leaf" }] }));
    expect(standing.code).toBe("tile_occupied");
    expect(standing.message).toContain("someone is standing there");
  });

  it("refuses the whole plan when it doesn't fit, names what it's short of, and never half-builds", () => {
    const w = world();
    const code = (command: Build, actor = "ada") => w.refused(actor, command).code;
    const tooMany = Array.from({ length: planMax(CONFIG) + 1 }, (_, i) => ({
      x: i % 8,
      y: Math.floor(i / 8) % 8,
    }));
    expect(code(plan({ ground: [{ x: 0, y: 0, ground: "dirt" }] }, 3, 0))).toBe("out_of_bounds");
    const theirs = w.refused("ada", plan({ ground: [{ x: 0, y: 0, ground: "dirt" }] }, 2, 0));
    expect(theirs.code).toBe("not_your_plot");
    expect(theirs.message).toContain("px 0, py 0");
    w.ok("cy", { type: "join", name: "Cy", kind: "human" });
    expect(code(plan({ ground: [{ x: 0, y: 0, ground: "dirt" }] }), "cy")).toBe("no_plot");
    expect(code(plan({}))).toBe("invalid_plan");
    expect(w.refused("ada", plan({ lift: tooMany }))).toEqual({
      code: "invalid_plan",
      message: `A plan lists at most ${planMax(CONFIG)} tiles in each of blocks, ground, remove, and lift.`,
    });
    expect(code(plan({ ground: [{ x: 8, y: 0, ground: "dirt" }] }))).toBe("invalid_plan");
    expect(
      code(
        plan({
          ground: [
            { x: 1, y: 7, ground: "dirt" },
            { x: 1, y: 7, ground: "sand" },
          ],
        }),
      ),
    ).toBe("invalid_plan");
    expect(code(plan({ blocks: [{ x: 0, y: 0, block: "lava" as never }] }))).toBe("unknown_item");
    expect(code(plan({ ground: [{ x: 0, y: 0, ground: "lava" as never }] }))).toBe("unknown_item");
    // Two cobble tiles and a well, with one stone: nothing goes down, and the refusal says why.
    w.give("ada", { stone: 1 });
    const short = w.refused(
      "ada",
      plan({
        blocks: [{ x: 7, y: 7, block: "well" }],
        ground: [
          { x: 3, y: 6, ground: "cobble" },
          { x: 3, y: 7, ground: "cobble" },
        ],
      }),
    );
    expect(short.code).toBe("not_enough_items");
    expect(short.message).toContain("1 stone");
    expect(short.message).toContain("1 well");
    expect(short.message).toContain("workbench");
    expect(w.state.ground).toBeUndefined();
    // A plan that would give back more than there's room for.
    w.give("ada", { lantern: 1 });
    w.ok("ada", { type: "place", x: 2, y: 2, block: "lantern" });
    w.give("ada", { sugar: ITEMS.inventoryMax - inventorySize(w.state.items?.inventories.ada) });
    expect(code(plan({ remove: [{ x: 2, y: 2 }] }))).toBe("inventory_full");
    // Nothing to do at all.
    expect(code(plan({ blocks: [{ x: 1, y: 1, block: "wood" }] }))).toBe("already_set");
    expect(code(plan({ blocks: [{ x: 3, y: 3, block: "wood" }] }))).toBe("tile_occupied");
  });

  it("waits for items to open before a plan that uses things, and builds free ones before", () => {
    const w = world({ items: false });
    w.ok("ada", plan({ ground: [{ x: 3, y: 6, ground: "dirt" }] }));
    expect(w.refused("ada", plan({ blocks: [{ x: 7, y: 7, block: "table" }] })).code).toBe(
      "items_closed",
    );
  });

  it("reads a plot back as a plan that builds the same thing on another plot", () => {
    const w = world();
    w.give("ada", { wood: 2, flower: 1 });
    w.ok(
      "ada",
      plan({
        blocks: [{ x: 0, y: 7, block: "leaf" }],
        ground: [
          { x: 3, y: 6, ground: "planks" },
          { x: 3, y: 7, ground: "planks" },
          { x: 2, y: 6, ground: "flower_bed" },
        ],
      }),
    );
    const ada = plotPlan(w.state, 0, 0);
    if (!ada) throw new Error("plot (0, 0) is in the world");
    expect(ada).toMatchObject({ px: 0, py: 0, size: 8, ownerId: "ada", hearths: [{ x: 3, y: 3 }] });
    w.give("bob", { wood: 2, flower: 1 });
    w.ok("bob", plan({ blocks: ada.blocks, ground: ada.ground }, 2, 0));
    const bob = plotPlan(w.state, 2, 0);
    expect(bob?.blocks).toEqual(ada.blocks);
    expect(bob?.ground).toEqual(ada.ground);
    expect(plotPlan(w.state, 3, 0)).toBeUndefined();
  });

  it("replays the build log to its pinned hash", () => {
    expect(hashWorld(replay(BUILD_CONFIG, BUILD_LOG))).toBe(BUILD_HASH);
  });
});
