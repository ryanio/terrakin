import {
  apply,
  createWorld,
  edgeKey,
  edgesOn,
  floorGround,
  hashWorld,
  prepare,
  TOWN_ACTOR,
  tileKey,
  type WorldConfig,
  worldGround,
} from "@terrakin/sim";
import { describe, expect, it } from "vitest";
import { slimPlan, townSlim } from "./slim-plan";

const CONFIG: WorldConfig = {
  width: 24,
  height: 24,
  plotSize: 8,
  maxPlotsPerResident: 1,
  reach: 3,
};

/**
 * Ada on plot (0, 0) with the starter hut of wall blocks: (1, 1) to (5, 5), glass at the sides,
 * and a door at (3, 5), or the open doorway huts had before decision 0349 with `doors` false.
 */
function hut(doors = true) {
  const state = createWorld(CONFIG);
  const ok = (actor: string, command: Parameters<typeof apply>[1]["command"]) =>
    expect(apply(state, { actor, command })).toMatchObject({ ok: true });
  ok(TOWN_ACTOR, { type: "new_day", day: 20_000 });
  if (doors) ok(TOWN_ACTOR, { type: "starter_doors" });
  ok("ada", { type: "join", name: "ada", kind: "human" });
  ok("ada", { type: "settle", px: 0, py: 0 });
  ok("ada", { type: "build_starter_home" });
  return { state, ok };
}

describe("slimPlan", () => {
  it("takes up the hut's 16 blocks and walls its 25 tiles in with 20 lines, door and windows kept", () => {
    const { state } = hut();
    const plan = slimPlan(state, 0, 0);
    if ("problem" in plan) throw new Error(plan.problem);
    expect(plan.remove).toHaveLength(16);
    expect(plan.edges).toHaveLength(20);
    const kinds = plan.edges.map((e) => e.block);
    expect(kinds.filter((k) => k === "door")).toHaveLength(1);
    expect(kinds.filter((k) => k === "glass")).toHaveLength(2);
    // The door stays on the south side's middle: the line south of (3, 5).
    const door = plan.edges.find((e) => e.block === "door");
    expect(door && edgeKey(door.x, door.y, door.side)).toBe(edgeKey(3, 6, "n"));
  });

  it("slims a home with an upstairs, its flooring held throughout, and takes down what stood on the old walls", () => {
    const { state, ok } = hut();
    const plot = state.plots["0,0"];
    if (!plot) throw new Error("no plot");
    plot.floors = 1;
    state.floors = { "1": { blocks: {}, ground: {} } };
    // Moss upstairs in the middle, held by the walls round it, and a wall block upstairs standing
    // on the hut's north-west corner with no flooring under it.
    ok("ada", {
      type: "build",
      px: 0,
      py: 0,
      ground: [{ x: 3, y: 3, floor: 1, ground: "moss" }],
      blocks: [{ x: 1, y: 1, floor: 1, block: "wood" }],
    });
    const plan = slimPlan(state, 0, 0);
    if ("problem" in plan) throw new Error(plan.problem);
    expect(plan.remove).toContainEqual({ x: 1, y: 1, floor: 1 });
    expect(plan.remove).toHaveLength(17);
    ok("ada", { type: "slim_walls", px: 0, py: 0, ...plan });
    expect(state.blocks).toEqual({});
    expect(state.floors?.["1"]?.blocks).toEqual({});
    expect(state.floors?.["1"]?.ground).toEqual({ [tileKey(3, 3)]: "moss" });
    expect(Object.keys(state.edges ?? {})).toHaveLength(20);
  });

  /**
   * The hut with an upstairs: flooring on floor 1 over `floored` (plot coordinates), and a ring of
   * wood on floor 1 from (1, 1) to (5, 5) but for the open tile at (3, 1).
   */
  function twoFloors(floored: (x: number, y: number) => boolean) {
    const { state, ok } = hut();
    const plot = state.plots["0,0"];
    if (!plot) throw new Error("no plot");
    plot.floors = 1;
    state.floors = { "1": { blocks: {}, ground: {} } };
    const ground = [];
    const blocks = [];
    for (let y = 1; y <= 5; y++) {
      for (let x = 1; x <= 5; x++) {
        if (floored(x, y)) ground.push({ x, y, floor: 1, ground: "moss" as const });
        const ring = x === 1 || y === 1 || x === 5 || y === 5;
        if (ring && !(x === 3 && y === 1)) blocks.push({ x, y, floor: 1, block: "wood" as const });
      }
    }
    ok("ada", { type: "build", px: 0, py: 0, ground, blocks });
    return { state, ok };
  }

  /** The plan, checked by the sim as Ada's slim with nothing skipped, then made. */
  function slimWhole(state: ReturnType<typeof hut>["state"]) {
    const plan = slimPlan(state, 0, 0);
    if ("problem" in plan) throw new Error(plan.problem);
    const command = { type: "slim_walls" as const, px: 0, py: 0, ...plan };
    expect(prepare(state, { actor: "ada", command })).toMatchObject({
      ok: true,
      plan: { skipped: [] },
    });
    expect(apply(state, { actor: "ada", command })).toMatchObject({ ok: true });
    return plan;
  }

  it("slims the upstairs too, its doorway left open and its flooring kept", () => {
    const { state } = twoFloors(() => true);
    const plan = slimWhole(state);
    // The hut's 16 blocks and the 15 upstairs, with the hut's 20 lines and 19 upstairs: the ring
    // round 25 tiles of flooring, less the line out of the open tile at (3, 1).
    expect(plan.remove).toHaveLength(31);
    expect(plan.edges.filter((e) => e.floor === 1)).toHaveLength(19);
    expect(state.blocks).toEqual({});
    expect(state.floors?.["1"]?.blocks).toEqual({});
    expect(Object.keys(state.floors?.["1"]?.ground ?? {})).toHaveLength(25);
    expect(Object.keys(edgesOn(state, 0))).toHaveLength(20);
    expect(Object.values(edgesOn(state, 1))).toEqual(Array(19).fill("wood"));
    // Downstairs the door is still a door; upstairs the doorway is still a way out.
    expect(edgesOn(state, 0)[edgeKey(3, 6, "n")]).toBe("door");
    expect(edgesOn(state, 1)[edgeKey(3, 1, "n")]).toBeUndefined();
    expect(floorGround(state, 1).edge?.(2, 1, "n")).toBe(true);
    expect(slimPlan(state, 0, 0)).toHaveProperty("problem");
  });

  it("slims the upstairs of a home whose ground floor was slimmed before", () => {
    const { state, ok } = twoFloors(() => true);
    const plan = slimPlan(state, 0, 0);
    if ("problem" in plan) throw new Error(plan.problem);
    // The ground floor alone, as a slim did before upstairs had a plan of its own.
    const ground = {
      remove: plan.remove.filter((t) => t.floor === undefined),
      edges: plan.edges.filter((e) => e.floor === undefined),
    };
    ok("ada", { type: "slim_walls", px: 0, py: 0, ...ground });
    const upstairs = slimWhole(state);
    expect(upstairs.remove).toHaveLength(15);
    expect(upstairs.remove.every((t) => t.floor === 1)).toBe(true);
    expect(upstairs.edges).toHaveLength(19);
    expect(state.floors?.["1"]?.blocks).toEqual({});
  });

  it("puts the upstairs lines on the flooring's edge, and none where neither side has flooring", () => {
    // Flooring only inside the ring, which stands on the walls below, and none at (2, 2).
    const { state } = twoFloors(
      (x, y) => x >= 2 && x <= 4 && y >= 2 && y <= 4 && !(x === 2 && y === 2),
    );
    // Over the hut's door, which holds nothing up, the ring has a second open tile at (3, 5).
    expect(state.floors?.["1"]?.blocks[tileKey(3, 5)]).toBeUndefined();
    const plan = slimWhole(state);
    // The ring stood on the hut's walls, so it comes down with them, each block once.
    expect(plan.remove).toHaveLength(30);
    const upstairs = edgesOn(state, 1);
    // Round the 3 by 3 of tiles inside: less the two lines beside bare (2, 2), and none out of
    // the open tiles at (3, 1) and (3, 5).
    expect(Object.keys(upstairs)).toHaveLength(8);
    expect(upstairs[edgeKey(2, 2, "n")]).toBeUndefined();
    expect(upstairs[edgeKey(2, 2, "w")]).toBeUndefined();
    expect(upstairs[edgeKey(3, 2, "n")]).toBeUndefined();
    expect(upstairs[edgeKey(3, 5, "n")]).toBeUndefined();
    expect(upstairs[edgeKey(2, 3, "w")]).toBe("wood");
    expect(state.floors?.["1"]?.blocks).toEqual({});
  });

  it("is made for the owner by the town, and marked done once (decision 0404)", () => {
    const { state, ok } = hut();
    const plan = slimPlan(state, 0, 0);
    if ("problem" in plan) throw new Error(plan.problem);
    // Nobody but the town sends it.
    expect(
      apply(state, { actor: "ada", command: { type: "town_slim", px: 0, py: 0, ...plan } }),
    ).toMatchObject({
      ok: false,
      rejection: { code: "server_only" },
    });
    const done = apply(state, {
      actor: TOWN_ACTOR,
      command: { type: "town_slim", px: 0, py: 0, ...plan },
    });
    expect(done).toMatchObject({ ok: true });
    expect(done.ok && done.events).toContainEqual({
      type: "home_slimmed",
      px: 0,
      py: 0,
      by: TOWN_ACTOR,
    });
    expect(Object.keys(state.edges ?? {})).toHaveLength(20);
    ok(TOWN_ACTOR, { type: "slim_homes" });
    const marked = hashWorld(state);
    expect(apply(state, { actor: TOWN_ACTOR, command: { type: "slim_homes" } })).toMatchObject({
      ok: false,
      rejection: { code: "already_open" },
    });
    expect(hashWorld(state)).toBe(marked);
    // A plot nobody holds has no home for the town to slim.
    expect(
      apply(state, {
        actor: TOWN_ACTOR,
        command: { type: "town_slim", px: 1, py: 1, remove: [], edges: [] },
      }),
    ).toMatchObject({ ok: false, rejection: { code: "not_your_plot" } });
  });

  it("is the town's to make only where the home comes out no worse (decision 0404)", () => {
    const { state, ok } = hut();
    expect(townSlim(state, 0, 0)).toMatchObject({ walls: 20, back: 0 });
    ok(TOWN_ACTOR, { type: "open_items" });
    // Bob walls a little room of brickwork with a door and keeps 3 over: its lines need 11, the 7
    // blocks and the town's gift cover 9, so the sim would take 2 of his. The town leaves it.
    ok("bob", { type: "join", name: "bob", kind: "human" });
    ok("bob", { type: "settle", px: 2, py: 0 });
    Object.assign(state.residents.bob ?? {}, { x: 0, y: 20 });
    const items = state.items;
    if (!items) throw new Error("items aren't open");
    items.inventories.bob = { stacks: { brickwork: 10 }, goods: [] };
    const ring = [
      [1, 1],
      [2, 1],
      [3, 1],
      [1, 2],
      [3, 2],
      [1, 3],
      [3, 3],
    ].map(([x, y]) => ({ x: x as number, y: y as number, block: "brickwork" as const }));
    ok("bob", {
      type: "build",
      px: 2,
      py: 0,
      blocks: [...ring, { x: 2, y: 3, block: "door" }],
    });
    const room = slimPlan(state, 2, 0);
    if ("problem" in room) throw new Error(room.problem);
    const command = { type: "town_slim" as const, px: 2, py: 0, ...room };
    expect(prepare(state, { actor: TOWN_ACTOR, command })).toMatchObject({
      ok: true,
      plan: { changes: [{ kind: "brickwork", amount: -2 }] },
    });
    expect(townSlim(state, 2, 0)).toBeUndefined();
    // Ada hangs a pennant on her hut's west wall: slimming would take it down, so the town leaves it.
    items.inventories.ada = { stacks: { pennant: 1 }, goods: [] };
    ok("ada", { type: "hang", x: 2, y: 2, side: "w", item: "pennant" });
    expect(townSlim(state, 0, 0)).toBeUndefined();
    expect(slimPlan(state, 0, 0)).not.toHaveProperty("problem");
  });

  it("is logged as the resident's own slim, which the sim builds whole", () => {
    const { state, ok } = hut();
    const plan = slimPlan(state, 0, 0);
    if ("problem" in plan) throw new Error(plan.problem);
    ok("ada", { type: "slim_walls", px: 0, py: 0, ...plan });
    expect(state.blocks).toEqual({});
    expect(Object.keys(state.edges ?? {})).toHaveLength(20);
    // Slimmed already: nothing walled in by blocks is left.
    expect(slimPlan(state, 0, 0)).toHaveProperty("problem");
  });

  it("puts each line up at the grade of the wall it stands for, so a fine home slims fine (RFC 0051)", () => {
    const { state, ok } = hut();
    ok(TOWN_ACTOR, { type: "open_economy" });
    ok(TOWN_ACTOR, { type: "open_items" });
    ok(TOWN_ACTOR, { type: "open_grades" });
    // The hut's wood walls swapped for fine plaster; its windows and door stay as they are.
    const wood = Object.entries(state.blocks)
      .filter(([, b]) => b === "wood")
      .map(([key]) => key.split(",").map(Number) as [number, number]);
    const items = state.items;
    if (!items) throw new Error("items aren't open");
    items.inventories.ada = { stacks: {}, goods: [], graded: { plaster: { fine: wood.length } } };
    ok("ada", {
      type: "build",
      px: 0,
      py: 0,
      remove: wood.map(([x, y]) => ({ x, y })),
      blocks: wood.map(([x, y]) => ({ x, y, block: "plaster", grade: "fine" })),
    });
    const plan = slimPlan(state, 0, 0);
    if ("problem" in plan) throw new Error(plan.problem);
    const kinds = new Set(plan.edges.map((e) => `${e.block}:${e.grade ?? "plain"}`));
    expect(kinds).toEqual(new Set(["plaster:fine", "glass:plain", "door:plain"]));
    // The sim takes it whole: the fine blocks it takes up and the town's fine gift pay for it.
    ok("ada", { type: "slim_walls", px: 0, py: 0, ...plan });
    expect(state.items?.inventories.ada?.graded).toBeUndefined();
    expect(Object.keys(state.grades ?? {})).toHaveLength(
      plan.edges.filter((e) => e.grade === "fine").length,
    );
  });

  it("slims a hut built before doors, its open doorway becoming a door", () => {
    const { state, ok } = hut(false);
    expect(state.blocks["3,5"]).toBeUndefined();
    const plan = slimPlan(state, 0, 0);
    if ("problem" in plan) throw new Error(plan.problem);
    expect(plan.remove).toHaveLength(15);
    expect(plan.edges).toHaveLength(20);
    const doors = plan.edges.filter((e) => e.block === "door");
    expect(doors.map((e) => edgeKey(e.x, e.y, e.side))).toEqual([edgeKey(3, 6, "n")]);
    ok("ada", { type: "slim_walls", px: 0, py: 0, ...plan });
    expect(state.blocks).toEqual({});
  });

  it("keeps an inner wall as lines between the rooms, its door a door", () => {
    // Ada's own home of blocks: wood from (1, 1) to (6, 6), the door at (2, 6), and an inner wall
    // down x = 4 with a door at (4, 3). The west room is x 2 to 3, the east room x = 5.
    const { state, ok } = hut();
    state.blocks = {};
    for (let i = 1; i <= 6; i++) {
      for (const [x, y] of [
        [i, 1],
        [i, 6],
        [1, i],
        [6, i],
      ] as const) {
        state.blocks[tileKey(x, y)] = "wood";
      }
    }
    state.blocks[tileKey(2, 6)] = "door";
    for (let y = 2; y <= 5; y++) state.blocks[tileKey(4, y)] = y === 3 ? "door" : "wood";
    const plan = slimPlan(state, 0, 0);
    if ("problem" in plan) throw new Error(plan.problem);
    expect(plan.remove).toHaveLength(24);
    const lines = new Map(plan.edges.map((e) => [edgeKey(e.x, e.y, e.side), e.block]));
    // 24 round the outside, and the inner wall's line from top to bottom: x = 4's west side.
    expect(lines.size).toBe(30);
    for (let y = 1; y <= 6; y++) {
      expect(lines.get(edgeKey(4, y, "w"))).toBe(y === 3 ? "door" : "wood");
    }
    expect(lines.get(edgeKey(2, 7, "n"))).toBe("door");
    ok("ada", { type: "slim_walls", px: 0, py: 0, ...plan });
    // The two rooms stay apart: a step across the inner wall's line is a wall, but for its door.
    const ground = worldGround(state);
    expect(ground.edge?.(3, 2, "e")).toBe(true);
    expect(ground.edge?.(3, 3, "e")).toBe(false);
  });
});
