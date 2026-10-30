import { describe, expect, it } from "vitest";
import { apply } from "./apply";
import { ROOF_CONFIG, ROOF_HASH, ROOF_LOG } from "./fixtures/roof-log";
import { hashWorld } from "./hash";
import { ITEMS } from "./items";
import { REPLAY_VERSION, replay } from "./replay";
import { plotRoof, ROOFS, roofBoxes, roofNeeds, roofShape } from "./roofs";
import { expectMaterialsHold, stock } from "./test-support";
import {
  type Command,
  type RejectionCode,
  ROOF_STYLES,
  TOWN_ACTOR,
  type WorldConfig,
  type WorldEvent,
  type WorldState,
} from "./types";
import { createWorld } from "./world";

/**
 * Roofs (RFC 0041): a look on a home's top floor, chosen rather than built, so the 200 coins an
 * upstairs costs buys something the town can see. What these protect is the part that is easy to
 * break: that a roof covers the home and not the garden, that it costs what it says and gives it
 * back, that a refusal leaves the world byte-identical, and that no log from before roofs replays
 * any differently.
 */

const CONFIG: WorldConfig = {
  width: 24,
  height: 24,
  plotSize: 8,
  maxPlotsPerResident: 1,
  reach: 3,
};

function ok(state: WorldState, actor: string, command: Command): WorldEvent[] {
  const result = expectMaterialsHold(state, () => apply(state, { actor, command }));
  if (!result.ok) {
    throw new Error(`${actor} ${JSON.stringify(command)}: ${result.rejection.message}`);
  }
  return result.events;
}

/** A refusal with this code that leaves the world exactly as it was. */
function refused(state: WorldState, actor: string, command: Command, code: RejectionCode) {
  const before = hashWorld(state);
  const result = apply(state, { actor, command });
  expect(result.ok ? "accepted" : result.rejection.code, JSON.stringify(command)).toBe(code);
  expect(hashWorld(state)).toBe(before);
}

/** Ada in her starter hut on plot (0, 0), with items open and coins to spend. */
function town(): WorldState {
  const state = createWorld(CONFIG);
  for (const command of [
    { type: "new_day", day: 1 },
    { type: "open_economy" },
    { type: "open_items" },
  ] as Command[]) {
    ok(state, TOWN_ACTOR, command);
  }
  ok(state, "ada", { type: "join", name: "ada", kind: "human" });
  ok(state, "ada", { type: "settle", px: 0, py: 0 });
  ok(state, "ada", { type: "build_starter_home" });
  const economy = state.economy;
  if (!economy) throw new Error("no economy");
  economy.coins.ada = (economy.coins.ada ?? 0) + 500;
  economy.minted += 500;
  return state;
}

const roof = (style: string, material?: string) =>
  ({ type: "set_roof", px: 0, py: 0, style, ...(material ? { material } : {}) }) as Command;

/** The tiles a plot's roof covers, as "x,y", sorted. */
const covered = (state: WorldState) =>
  (plotRoof(state, 0, 0)?.tiles ?? []).map((t) => `${t.x},${t.y}`);

describe("what a roof is", () => {
  it("is a look on the plot, absent until it's set, so older worlds hash as they did", () => {
    const state = town();
    expect(state.plots["0,0"]?.roof).toBeUndefined();
    expect(plotRoof(state, 0, 0)).toBeUndefined();
    ok(state, "ada", roof("gable", "wood"));
    expect(state.plots["0,0"]?.roof).toEqual({ style: "gable", material: "wood" });
    // Flat is no roof, so the field goes away again and the plot reads as it did.
    ok(state, "ada", roof("flat"));
    expect(state.plots["0,0"]?.roof).toBeUndefined();
    expect(Object.keys(state.plots["0,0"] ?? {})).not.toContain("roof");
  });

  it("wears something on its ridge, free, and nothing until it's asked for (RFC 0041)", () => {
    const state = town();
    const top = (t?: string) =>
      ({
        type: "set_roof",
        px: 0,
        py: 0,
        style: "gable",
        material: "wood",
        ...(t ? { top: t } : {}),
      }) as Command;

    // A roof with nothing on its ridge is what every roof was: no field, no mark on the shape.
    ok(state, "ada", roof("gable", "wood"));
    expect(state.plots["0,0"]?.roof?.top).toBeUndefined();
    expect(plotRoof(state, 0, 0)?.top).toBeUndefined();

    // A vane goes up for nothing: the covering is already paid for, and no stack moves. The roof
    // it stands on hasn't changed, so the event says the ridge did rather than reading as a roof
    // going up, which anything counting new roofs would count twice (decision 0337).
    const held = { ...(state.items?.inventories.ada?.stacks ?? {}) };
    const events = ok(state, "ada", top("vane"));
    expect(state.plots["0,0"]?.roof).toEqual({ style: "gable", material: "wood", top: "vane" });
    expect(state.items?.inventories.ada?.stacks).toEqual(held);
    expect(events).toEqual([{ type: "roof_top_set", px: 0, py: 0, top: "vane", by: "ada" }]);

    // It stands on the first of the roof's highest tiles, which every view reads from the shape.
    const shape = plotRoof(state, 0, 0);
    const high = Math.max(...(shape?.tiles ?? []).map((t) => Math.max(...t.h)));
    const at = (shape?.tiles ?? []).find((t) => t.x === shape?.top?.x && t.y === shape?.top?.y);
    expect(shape?.top?.kind).toBe("vane");
    expect(Math.max(...(at?.h ?? [0]))).toBe(high);
    // And on this gable's north-west ridge tile by its coordinates, not by recomputing the rule
    // from the same array: decision 0337 promises reading order, north row first and west to
    // east, and the wire carries the ridge's kind and never its tile, so a reader has to work
    // the tile out from the walls with that rule. Pinning the tile is what holds the promise.
    const highest = (shape?.tiles ?? []).filter((t) => Math.max(...t.h) === high);
    const north = Math.min(...highest.map((t) => t.y));
    const west = Math.min(...highest.filter((t) => t.y === north).map((t) => t.x));
    expect({ x: shape?.top?.x, y: shape?.top?.y }).toEqual({ x: west, y: north });

    // The same roof again is nothing to change; another ridge is.
    refused(state, "ada", top("vane"), "already_set");
    ok(state, "ada", top("nest"));
    expect(state.plots["0,0"]?.roof?.top).toBe("nest");
    // Asking for a bare ridge takes it down, and the roof stays up.
    expect(ok(state, "ada", top())).toEqual([{ type: "roof_top_set", px: 0, py: 0, by: "ada" }]);
    expect(state.plots["0,0"]?.roof).toEqual({ style: "gable", material: "wood" });
    // A roof going up with something on its ridge is a roof going up, ridge and all.
    ok(state, "ada", roof("flat"));
    expect(ok(state, "ada", top("flag")).find((e) => e.type === "roof_set")).toMatchObject({
      style: "gable",
      top: "flag",
    });
    // Something the world doesn't know leaves the world as it was.
    refused(state, "ada", top("chimney"), "unknown_item");
    // Taking the roof down takes the ridge with it.
    ok(state, "ada", roof("flat"));
    expect(state.plots["0,0"]?.roof).toBeUndefined();
  });

  it("says a roof changed when one already up changes its style or covering", () => {
    const state = town();
    // A roof going up is a roof going up.
    expect(
      ok(state, "ada", roof("gable", "wood")).find((e) => e.type === "roof_set"),
    ).toMatchObject({ style: "gable", material: "wood" });
    // Another style in the same covering is not a second roof going up (decision 0342): the
    // event names the deed, so a reader counting new roofs counts this home once.
    expect(ok(state, "ada", roof("hip", "wood"))).toEqual([
      { type: "roof_changed", px: 0, py: 0, style: "hip", material: "wood", by: "ada" },
    ]);
    expect(state.plots["0,0"]?.roof).toEqual({ style: "hip", material: "wood" });
    // Another covering in the same style is the same deed, and it carries the ridge with it.
    expect(
      ok(state, "ada", {
        type: "set_roof",
        px: 0,
        py: 0,
        style: "hip",
        material: "leaf",
        top: "vane",
      } as Command),
    ).toEqual([
      {
        type: "roof_changed",
        px: 0,
        py: 0,
        style: "hip",
        material: "leaf",
        top: "vane",
        by: "ada",
      },
    ]);
    expect(state.plots["0,0"]?.roof).toEqual({ style: "hip", material: "leaf", top: "vane" });
    // Taking it down is still `roof_set` with `flat`, as every reader of that event expects.
    expect(ok(state, "ada", roof("flat"))).toEqual([
      { type: "roof_set", px: 0, py: 0, style: "flat", by: "ada" },
    ]);
    expect(state.plots["0,0"]?.roof).toBeUndefined();
  });

  it("pins its numbers and its choices", () => {
    expect(ROOFS.blocks).toBe(8);
    expect(ROOFS.minSpan).toBe(3);
    expect([...ROOF_STYLES]).toEqual(["flat", "gable", "hip", "pitched"]);
    // A free block roofs for free; a made material takes 8 of itself.
    expect(roofNeeds("wood")).toEqual([]);
    expect(roofNeeds("plaster")).toEqual([["plaster", 8]]);
  });

  it("is refused in a style or a material the world doesn't know", () => {
    const state = town();
    refused(state, "ada", roof("mansard", "wood"), "unknown_item");
    refused(state, "ada", roof("gable", "bookshelf"), "unknown_item");
    refused(state, "ada", roof("gable"), "unknown_item");
  });

  it("is only yours to set, and never the Commons'", () => {
    const state = town();
    ok(state, "bob", { type: "join", name: "bob", kind: "human" });
    refused(state, "bob", roof("gable", "wood"), "not_your_plot");
    refused(state, "ada", { ...roof("gable", "wood"), px: 1, py: 1 } as Command, "plot_is_commons");
    refused(state, "ada", { ...roof("gable", "wood"), px: 9, py: 9 } as Command, "out_of_bounds");
  });

  it("refuses the roof it already has, and a flat one on a home with none", () => {
    const state = town();
    refused(state, "ada", roof("flat"), "already_set");
    ok(state, "ada", roof("hip", "stone"));
    refused(state, "ada", roof("hip", "stone"), "already_set");
    // The same material in another style is a change, so it goes through.
    ok(state, "ada", roof("gable", "stone"));
  });
});

describe("what a roof covers", () => {
  it("covers the home, doorway and all, and never the garden", () => {
    const state = town();
    ok(state, "ada", roof("gable", "wood"));
    // The starter hut is the 5 by 5 from the plot's north-west corner, one tile in.
    const tiles: string[] = [];
    for (let y = 1; y <= 5; y++) for (let x = 1; x <= 5; x++) tiles.push(`${x},${y}`);
    expect(covered(state)).toEqual(tiles);
  });

  it("gives a garden wall no roof of its own, and refuses a plot with nothing to roof", () => {
    const state = createWorld(CONFIG);
    ok(state, TOWN_ACTOR, { type: "new_day", day: 1 });
    ok(state, "ada", { type: "join", name: "ada", kind: "human" });
    ok(state, "ada", { type: "settle", px: 0, py: 0 });
    // A bare plot has no walls, so there's nothing for a roof to sit on.
    refused(state, "ada", roof("gable", "wood"), "nothing_under");
    // Nor does a line of wall two tiles from the hearth, which is a fence, not a home.
    const me = state.residents.ada;
    if (!me) throw new Error("no ada");
    for (let dx = -1; dx <= 1; dx++) {
      ok(state, "ada", { type: "place", x: me.x + dx, y: me.y - 2, block: "wood" });
    }
    refused(state, "ada", roof("gable", "wood"), "nothing_under");
  });

  it("keeps drawing nothing when the walls come down, and the style stays chosen", () => {
    const state = town();
    ok(state, "ada", roof("hip", "wood"));
    for (let x = 1; x <= 5; x++) {
      for (let y = 1; y <= 5; y++) {
        if (state.blocks[`${x},${y}`] !== undefined) ok(state, "ada", { type: "remove", x, y });
      }
    }
    // Nothing holds a roof up, so nothing is drawn; the choice is still on the plot.
    expect(plotRoof(state, 0, 0)).toBeUndefined();
    expect(state.plots["0,0"]?.roof).toEqual({ style: "hip", material: "wood" });
  });

  it("sits on the highest floor the walls reach, so an empty upstairs takes nothing away", () => {
    const state = town();
    ok(state, "ada", { type: "add_floor", px: 0, py: 0 });
    ok(state, "ada", roof("gable", "wood"));
    // An upstairs with no walls on it: the roof still caps the ground floor's.
    expect(plotRoof(state, 0, 0)?.floor).toBe(0);
    // Wall the loft in and the roof goes up with it.
    stock(state, "ada", { wood: 40 });
    for (let x = 1; x <= 5; x++) {
      for (let y = 1; y <= 5; y++) {
        if (state.blocks[`${x},${y}`] === undefined) continue;
        ok(state, "ada", { type: "place", x, y, floor: 1, block: "wood" });
      }
    }
    expect(plotRoof(state, 0, 0)?.floor).toBe(1);
  });
});

describe("giving the plot back", () => {
  it("refuses to release a plot with a roof, so its covering never goes with the record", () => {
    const state = town();
    stock(state, "ada", { plaster: 8 });
    ok(state, "ada", roof("gable", "plaster"));
    // Every wall can come down and the plot still holds the roof's 8 plaster.
    for (let x = 1; x <= 5; x++) {
      for (let y = 1; y <= 5; y++) {
        if (state.blocks[`${x},${y}`] !== undefined) ok(state, "ada", { type: "remove", x, y });
      }
    }
    refused(state, "ada", { type: "release" }, "plot_has_blocks");
    // Taking it down hands the plaster back, and then the plot can go.
    ok(state, "ada", roof("flat"));
    expect(state.items?.inventories.ada?.stacks.plaster).toBe(8);
    ok(state, "ada", { type: "release" });
  });
});

describe("what it costs", () => {
  it("is free in a free block, before items are even open", () => {
    const state = createWorld(CONFIG);
    ok(state, TOWN_ACTOR, { type: "new_day", day: 1 });
    ok(state, "ada", { type: "join", name: "ada", kind: "human" });
    ok(state, "ada", { type: "settle", px: 0, py: 0 });
    ok(state, "ada", { type: "build_starter_home" });
    expect(state.items).toBeUndefined();
    // Thatch is leaf, and a free block costs nobody anything.
    const events = ok(state, "ada", roof("gable", "leaf"));
    expect(events.filter((e) => e.type === "inventory")).toEqual([]);
  });

  it("takes a made material and gives it back, and a swap costs the difference", () => {
    const state = town();
    stock(state, "ada", { plaster: 10, brickwork: 8 });
    ok(state, "ada", roof("gable", "plaster"));
    expect(state.items?.inventories.ada?.stacks.plaster).toBe(2);
    // Swapping the covering gives the old one back and takes the new one in one event.
    const swap = ok(state, "ada", roof("gable", "brickwork"));
    expect(swap.find((e) => e.type === "inventory")).toMatchObject({
      residentId: "ada",
      changes: expect.arrayContaining([
        { kind: "plaster", amount: 8, count: 10 },
        { kind: "brickwork", amount: -8, count: 0 },
      ]),
    });
    // Flat takes it down and hands the brickwork back.
    ok(state, "ada", roof("flat"));
    expect(state.items?.inventories.ada?.stacks.brickwork).toBe(8);
  });

  it("refuses a made covering before items open, and a refund with no room for it", () => {
    // A material is a thing you hold, so roofing in one waits for items, as placing one does.
    const shut = createWorld(CONFIG);
    ok(shut, TOWN_ACTOR, { type: "new_day", day: 1 });
    ok(shut, "ada", { type: "join", name: "ada", kind: "human" });
    ok(shut, "ada", { type: "settle", px: 0, py: 0 });
    ok(shut, "ada", { type: "build_starter_home" });
    refused(shut, "ada", roof("gable", "plaster"), "items_closed");

    // And taking a roof down hands back 8, which needs room for them.
    const state = town();
    stock(state, "ada", { plaster: 8 });
    ok(state, "ada", roof("gable", "plaster"));
    stock(state, "ada", { wood: ITEMS.inventoryMax });
    refused(state, "ada", roof("flat"), "inventory_full");
    // A swap moves the same number each way, so it fits where a refund wouldn't.
    stock(state, "ada", { brickwork: 8 });
    ok(state, "ada", roof("gable", "brickwork"));
    expect(state.items?.inventories.ada?.stacks.plaster).toBe(8);
  });

  it("is refused with too little of the material, and the world is untouched", () => {
    const state = town();
    stock(state, "ada", { plaster: 7 });
    refused(state, "ada", roof("gable", "plaster"), "not_enough_items");
    // A style change with the same material moves nothing, so it needs nothing.
    stock(state, "ada", { plaster: 1 });
    ok(state, "ada", roof("gable", "plaster"));
    ok(state, "ada", roof("hip", "plaster"));
    expect(state.items?.inventories.ada?.stacks.plaster ?? 0).toBe(0);
  });
});

describe("nothing is made or lost", () => {
  it("holds a material and its roof to the same total, whatever the order of changes", () => {
    const state = town();
    stock(state, "ada", { plaster: 12, brickwork: 9 });
    const inv = () => state.items?.inventories.ada?.stacks ?? {};
    const held = (kind: "plaster" | "brickwork") => inv()[kind] ?? 0;
    const onRoof = (kind: "plaster" | "brickwork") =>
      state.plots["0,0"]?.roof?.material === kind ? ROOFS.blocks : 0;
    const total = (kind: "plaster" | "brickwork") => held(kind) + onRoof(kind);
    expect([total("plaster"), total("brickwork")]).toEqual([12, 9]);
    // Up, swapped to another made material, swapped back, restyled, down, and up again. A free
    // block in the middle gives the made one back without taking anything.
    for (const command of [
      roof("gable", "plaster"),
      roof("hip", "brickwork"),
      roof("hip", "plaster"),
      roof("pitched", "plaster"),
      roof("pitched", "wood"),
      roof("flat"),
      roof("gable", "brickwork"),
    ]) {
      ok(state, "ada", command);
      expect([total("plaster"), total("brickwork")], JSON.stringify(command)).toEqual([12, 9]);
    }
    // And a refusal leaves the count where it was, as it leaves the world.
    refused(state, "ada", roof("gable", "brickwork"), "already_set");
    expect([total("plaster"), total("brickwork")]).toEqual([12, 9]);
  });

  it("gives the covering back before taking the new one, so a swap needs no spare", () => {
    const state = town();
    // Exactly enough for one roof and not a block more: swapping styles and materials still works.
    stock(state, "ada", { plaster: 8 });
    ok(state, "ada", roof("gable", "plaster"));
    expect(state.items?.inventories.ada?.stacks.plaster ?? 0).toBe(0);
    // Wood is free, so the plaster comes back; then it can go up again.
    ok(state, "ada", roof("gable", "wood"));
    expect(state.items?.inventories.ada?.stacks.plaster).toBe(8);
    ok(state, "ada", roof("hip", "plaster"));
    expect(state.items?.inventories.ada?.stacks.plaster ?? 0).toBe(0);
  });
});

describe("how it's drawn", () => {
  const shape = (style: "gable" | "hip" | "pitched", wide = 5, deep = 5) =>
    roofShape({
      plotSize: 8,
      px: 0,
      py: 0,
      roof: { style, material: "wood" },
      floors: 0,
      wall: (x, y) => x >= 1 && x <= wide && y >= 1 && y <= deep,
    });

  const at = (style: "gable" | "hip" | "pitched", x: number, y: number) =>
    shape(style)?.tiles.find((t) => t.x === x && t.y === y)?.h;

  it("runs a gable's ridge down the middle and slopes it to two sides", () => {
    // The hut is 5 by 5, so the ridge runs east to west through row 3.
    expect(at("gable", 3, 1)?.[0]).toBe(0);
    expect(at("gable", 3, 3)).toEqual([0.8, 0.8, 0.8, 0.8]);
    expect(at("gable", 3, 5)?.[2]).toBe(0);
    // Every tile of a row is the same height, which is what makes it a ridge.
    expect(at("gable", 1, 3)).toEqual(at("gable", 5, 3));
  });

  it("slopes a hip to all four sides, so its corners come down", () => {
    expect(at("hip", 3, 3)).toEqual([0.8, 0.8, 0.8, 0.8]);
    // The corner of the home is the lowest point of a hip, unlike a gable's gable end.
    expect(at("hip", 1, 1)?.[0]).toBe(0);
    expect(at("hip", 1, 3)?.[0]).toBe(0);
    expect(at("gable", 1, 3)?.[0]).toBeGreaterThan(0);
  });

  it("gives a pitched roof one slope, highest to the north", () => {
    const north = at("pitched", 3, 1);
    const south = at("pitched", 3, 5);
    if (!north || !south) throw new Error("no roof");
    expect(north[0]).toBe(1);
    expect(south[3]).toBe(0);
    // It falls the same way across every tile, so there's no ridge.
    expect(north[0]).toBeGreaterThan(north[3] as number);
  });

  it("boxes each group of walls on its own, so two sheds get two roofs", () => {
    const boxes = roofBoxes(
      (x, y) => (x <= 2 && y <= 2) || (x >= 5 && x <= 7 && y >= 5 && y <= 7),
      0,
      0,
      8,
    );
    expect(boxes).toEqual([
      { x0: 0, y0: 0, x1: 2, y1: 2 },
      { x0: 5, y0: 5, x1: 7, y1: 7 },
    ]);
  });
});

describe("replay", () => {
  it("replays a log with roofs in it to the pinned hash, with no version bump", () => {
    expect(hashWorld(replay(ROOF_CONFIG, ROOF_LOG))).toBe(ROOF_HASH);
    // A roof is state no older input ever set, so nothing before it replays differently and the
    // version doesn't move. `replay.test.ts` holds every older fixture's pinned hash as the proof.
    expect(REPLAY_VERSION).toBe(2);
  });
});
