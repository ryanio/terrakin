import {
  apply,
  type BlockKind,
  createWorld,
  designNotes,
  edgeAt,
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
import { slimPlan, townLines, townSlim, wallBlocksOn } from "./slim-plan";

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

  it("is the town's to make only where the home comes out no worse (decision 0404), and never takes the owner's things", () => {
    const { state, ok } = hut();
    expect(townSlim(state, 0, 0)).toMatchObject({ walls: 20, back: 0 });
    ok(TOWN_ACTOR, { type: "open_items" });
    // Bob walls a little room of brickwork with a door and keeps 3 over: its lines need 11, and the
    // 7 blocks and the town's gift pay for 9, so the last 2 go up in wood rather than take his.
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
    const kinds = room.edges.map((e) => e.block);
    expect(kinds.filter((k) => k === "brickwork")).toHaveLength(9);
    expect(kinds.filter((k) => k === "wood")).toHaveLength(2);
    const command = { type: "town_slim" as const, px: 2, py: 0, ...room };
    const prepared = prepare(state, { actor: TOWN_ACTOR, command });
    expect(prepared.ok && prepared.plan?.changes.filter((c) => c.amount < 0)).toEqual([]);
    // Ada hangs a pennant on her hut's west wall: slimming would take it down, so the town's one
    // sweep leaves it, and the sweep that turns every wall block into lines gives it back to her.
    items.inventories.ada = { stacks: { pennant: 1 }, goods: [] };
    ok("ada", { type: "hang", x: 2, y: 2, side: "w", item: "pennant" });
    expect(townSlim(state, 0, 0)).toBeUndefined();
    const lines = townLines(state, 0, 0);
    if ("problem" in lines) throw new Error(lines.problem);
    ok(TOWN_ACTOR, lines.command);
    expect(state.items?.inventories.ada?.stacks.pennant).toBe(1);
    expect(wallBlocksOn(state, 0, 0)).toBe(0);
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

  it("asks no grade for more than the slim pays: a hut of fine corners and plain sides slims, by its owner and the town", () => {
    // A plaster hut whose four corners are fine: each corner stands for two lines, eight fine lines
    // from four fine blocks and a gift of one, so the lines past five go up plain.
    const graded = () => {
      const { state, ok } = hut();
      ok(TOWN_ACTOR, { type: "open_economy" });
      ok(TOWN_ACTOR, { type: "open_items" });
      ok(TOWN_ACTOR, { type: "open_grades" });
      const corners = new Set(["1,1", "5,1", "1,5", "5,5"]);
      const wood = Object.entries(state.blocks)
        .filter(([, b]) => b === "wood")
        .map(([key]) => key);
      const items = state.items;
      if (!items) throw new Error("items aren't open");
      items.inventories.ada = {
        stacks: { plaster: wood.length - corners.size },
        goods: [],
        graded: { plaster: { fine: corners.size } },
      };
      const at = (key: string) => {
        const [x = 0, y = 0] = key.split(",").map(Number);
        return { x, y };
      };
      ok("ada", {
        type: "build",
        px: 0,
        py: 0,
        remove: wood.map(at),
        blocks: wood.map((key) => ({
          ...at(key),
          block: "plaster",
          ...(corners.has(key) ? { grade: "fine" as const } : {}),
        })),
      });
      expect(items.inventories.ada?.stacks.plaster).toBeUndefined();
      return { state, ok };
    };
    const { state, ok } = graded();
    const plan = slimPlan(state, 0, 0);
    if ("problem" in plan) throw new Error(plan.problem);
    const fine = plan.edges.filter((e) => e.grade === "fine");
    expect(fine).toHaveLength(5);
    expect(fine.every((e) => e.block === "plaster")).toBe(true);
    ok("ada", { type: "slim_walls", px: 0, py: 0, ...plan });
    // The town's slim of the same home goes through too, and spends nothing of the owner's.
    const town = graded().state;
    const slim = townSlim(town, 0, 0);
    expect(slim).toBeDefined();
    if (slim) {
      expect(apply(town, { actor: TOWN_ACTOR, command: slim.command })).toMatchObject({ ok: true });
    }
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

  it("slims a hut with a kitchen set into its wall, the kitchen inside against the new wall", () => {
    // Cocoa's home: a jam kitchen where the north wall's middle block stood. It walls the room in
    // like a door does, so the slim finds the room, leaves the kitchen where it is, and puts a
    // wall on its outer side.
    const { state, ok } = hut();
    state.blocks[tileKey(3, 1)] = "kitchen";
    const plan = slimPlan(state, 0, 0);
    if ("problem" in plan) throw new Error(plan.problem);
    expect(plan.remove).toHaveLength(15);
    expect(plan.remove).not.toContainEqual({ x: 3, y: 1 });
    const lines = new Map(plan.edges.map((e) => [edgeKey(e.x, e.y, e.side), e.block]));
    expect(lines.size).toBe(20);
    expect(lines.get(edgeKey(3, 1, "n"))).toBe("wood");
    // No line cuts the kitchen off from the room.
    for (const side of ["e", "w"] as const) expect(lines.has(edgeKey(3, 1, side))).toBe(false);
    expect(lines.has(edgeKey(3, 2, "n"))).toBe(false);
    ok("ada", { type: "slim_walls", px: 0, py: 0, ...plan });
    expect(state.blocks).toEqual({ [tileKey(3, 1)]: "kitchen" });
  });

  it("leaves a piece in a yard fence where it stands, the fence on lines either side of it", () => {
    // A fence run with a planter in its gap and open ground on both sides walls nothing in.
    const { state } = hut();
    state.blocks = {};
    for (let x = 1; x <= 5; x++) state.blocks[tileKey(x, 3)] = x === 3 ? "planter" : "wood";
    expect(slimPlan(state, 0, 0)).toEqual({
      remove: [
        { x: 1, y: 3 },
        { x: 2, y: 3 },
        { x: 4, y: 3 },
        { x: 5, y: 3 },
      ],
      edges: [1, 2, 4, 5].map((x) => ({ x, y: 3, side: "n", block: "wood" })),
    });
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

/** A wall's kind, on a tile or a line, as the plot drawings below write it. */
const WALLS: Record<string, BlockKind> = {
  W: "wood",
  S: "stone",
  G: "glass",
  L: "leaf",
  D: "door",
  B: "brickwork",
};
/** A piece standing on a tile, as the drawings write it. */
const PIECES: Record<string, BlockKind> = {
  k: "kitchen",
  p: "planter",
  w: "workbench",
  f: "fence",
  l: "lantern",
  b: "bench",
  c: "chair",
};
const letter = (kinds: Record<string, BlockKind>, kind: BlockKind | undefined) =>
  Object.entries(kinds).find(([, k]) => k === kind)?.[0];

/**
 * Ada on plot (0, 0) with the ground floor drawn: a row of `+` with the line on the north side of
 * each tile between them, then the tiles' row with the line on each tile's west side before it,
 * and the plot's east border last. `.` is an open tile.
 */
function drawnPlot(rows: readonly string[]) {
  const { state } = hut();
  state.blocks = {};
  const edges: Record<string, BlockKind> = {};
  const S = CONFIG.plotSize;
  for (let y = 0; y < S; y++) {
    const top = rows[2 * y] ?? "";
    const tiles = rows[2 * y + 1] ?? "";
    for (let x = 0; x < S; x++) {
      const north = WALLS[top[2 * x + 1] ?? " "];
      const west = WALLS[tiles[2 * x] ?? " "];
      const tile = tiles[2 * x + 1] ?? ".";
      if (north) edges[edgeKey(x, y, "n")] = north;
      if (west) edges[edgeKey(x, y, "w")] = west;
      const block = WALLS[tile] ?? PIECES[tile];
      if (block) state.blocks[tileKey(x, y)] = block;
    }
  }
  if (Object.keys(edges).length > 0) state.edges = edges;
  else delete state.edges;
  return state;
}

/** Plot (0, 0)'s ground floor drawn as `drawnPlot` reads it. */
function drawing(state: ReturnType<typeof drawnPlot>): string[] {
  const S = CONFIG.plotSize;
  const line = (x: number, y: number, side: "n" | "w") =>
    letter(WALLS, edgeAt(state, x, y, side)) ?? " ";
  const rows: string[] = [];
  for (let y = 0; y <= S; y++) {
    rows.push(`${Array.from({ length: S }, (_, x) => `+${line(x, y, "n")}`).join("")}+`);
    if (y === S) break;
    const tiles = Array.from({ length: S }, (_, x) => {
      const block = state.blocks[tileKey(x, y)];
      const tile = block === undefined ? "." : (letter(WALLS, block) ?? letter(PIECES, block));
      return `${line(x, y, "w")}${tile ?? "?"}`;
    });
    rows.push(`${tiles.join("")}${line(S, y, "w")}`);
  }
  return rows;
}

/** The town turns the plot's wall blocks into lines; what comes back to Ada. */
function turned(state: ReturnType<typeof drawnPlot>) {
  const lines = townLines(state, 0, 0);
  if ("problem" in lines) throw new Error(lines.problem);
  expect(apply(state, { actor: TOWN_ACTOR, command: lines.command })).toMatchObject({ ok: true });
  expect(wallBlocksOn(state, 0, 0)).toBe(0);
  return lines;
}

/**
 * Plots of terrakin.org with wall blocks still standing after the town's one slim (decision 0404),
 * as `GET /v1/world` drew them, with every piece of furniture drawn as one of a few kinds, and as
 * the town leaves them. Most are huts the slim found no room in, since a walk from the plot's edge
 * got in through an open doorway it couldn't read, and wall blocks round homes already on lines.
 */
const LIVE: [string, string[], string[]][] = [
  [
    "a hut with a hedge row across its doorway, a glass row above, and a hedge inside",
    [
      "+ + + + + + + + +",
      " . G G G G G . . ",
      "+ + + + + + + + +",
      " . W W W W W L . ",
      "+ + + + + + + + +",
      " . W L . . W L . ",
      "+ + + + + + + + +",
      " . L . . . L . . ",
      "+ + + + + + + + +",
      " . W . . . W L . ",
      "+ + + + + + + + +",
      " . W W . W W L . ",
      "+ + + + + + + + +",
      " . L L . L L . . ",
      "+ + + + + + + + +",
      " . . . . . . . . ",
      "+ + + + + + + + +",
    ],
    [
      "+ + + + + + + + +",
      " . . . . . . . . ",
      "+ +W+W+W+W+W+ + +",
      " .W. . . . .W. . ",
      "+ + + + + + + + +",
      " .W. . . . .W. . ",
      "+ + + + + + + + +",
      " .L. . . . .L. . ",
      "+ + + + + + + + +",
      " .W. . . . .W. . ",
      "+ + + + + + + + +",
      " .W. . . . .W. . ",
      "+ + + + + + + + +",
      " .L. . . . .L. . ",
      "+ +L+L+D+L+L+ + +",
      " . . . . . . . . ",
      "+ + + + + + + + +",
    ],
  ],
  [
    "a hut with a doorway on two sides and posts round its corners",
    [
      "+ + + + + + + + +",
      " S . S . S . S . ",
      "+ + + + + + + + +",
      " . S S . S S . . ",
      "+ + + + + + + + +",
      " S S . . . S W . ",
      "+ + + + + + + + +",
      " . G . . . G W . ",
      "+ + + + + + + + +",
      " S S . . . S W . ",
      "+ + + + + + + + +",
      " . S S . S S . . ",
      "+ + + + + + + + +",
      " S . . . . . S . ",
      "+ + + + + + + + +",
      " . . . . . . . . ",
      "+ + + + + + + + +",
    ],
    [
      "+ + + + + + + + +",
      " . . . . . . . . ",
      "+ +S+S+D+S+S+ + +",
      " .S. . . . .S. . ",
      "+ + + + + + + + +",
      " .S. . . . .S. . ",
      "+ + + + + + + + +",
      " .G. . . . .G. . ",
      "+ + + + + + + + +",
      " .S. . . . .S. . ",
      "+ + + + + + + + +",
      " .S. . . . .S. . ",
      "+ +S+S+D+S+S+ + +",
      " . . . . . . . . ",
      "+ + + + + + + + +",
      " . . . . . . . . ",
      "+ + + + + + + + +",
    ],
  ],
  [
    "a home already on lines, with wall blocks left in its corners and posts round it",
    [
      "+ + + + + + + + +",
      " . . . . . . . . ",
      "+ + +W+W+W+ + + +",
      " . WW. . .WW W . ",
      "+ +W+ + + +W+ + +",
      " .W. . . . .W. . ",
      "+ + + + + + + + +",
      " .G. . . . .GW . ",
      "+ + + + + + + + +",
      " .W. . . . .W. . ",
      "+ + + + + + + + +",
      " .W. . . . .WW . ",
      "+ +W+W+D+W+W+ + +",
      " L G . . . G L . ",
      "+ + + + + + + + +",
      " . . . . . . . . ",
      "+ + + + + + + + +",
    ],
    [
      "+ + + + + + + + +",
      " . . . . . . . . ",
      "+ + +W+W+W+ + + +",
      " . .W. . .W. . . ",
      "+ +W+ + + +W+ + +",
      " .W. . . . .W. . ",
      "+ + + + + + + + +",
      " .G. . . . .G. . ",
      "+ + + + + + + + +",
      " .W. . . . .W. . ",
      "+ + + + + + + + +",
      " .W. . . . .W. . ",
      "+ +W+W+D+W+W+ + +",
      " . . . . . . . . ",
      "+ + + + + + + + +",
      " . . . . . . . . ",
      "+ + + + + + + + +",
    ],
  ],
  [
    "a hut whose doorway leads into a passage between its inner posts",
    [
      "+ + + + + + + + +",
      " . . . . . . . . ",
      "+ + + + + + + + +",
      " . S S S S S . . ",
      "+ + + + + + + + +",
      " . S W . W S G . ",
      "+ + + + + + + + +",
      " . W . . . W S . ",
      "+ + + + + + + + +",
      " . S W . W S S . ",
      "+ + + + + + + + +",
      " . S S . S S . . ",
      "+ + + + + + + + +",
      " . . . . . . . . ",
      "+ + + + + + + + +",
      " . . . . . . . . ",
      "+ + + + + + + + +",
    ],
    [
      "+ + + + + + + + +",
      " . . . . . . . . ",
      "+ +S+S+S+S+S+ + +",
      " .S. . . . .S. . ",
      "+ + + + + + + + +",
      " .S. . . . .S. . ",
      "+ + + + + + + + +",
      " .W. . . . .W. . ",
      "+ + + + + + + + +",
      " .S. . . . .S. . ",
      "+ + + + + + + + +",
      " .S. . . . .S. . ",
      "+ +S+S+D+S+S+ + +",
      " . . . . . . . . ",
      "+ + + + + + + + +",
      " . . . . . . . . ",
      "+ + + + + + + + +",
    ],
  ],
  [
    "a home already on lines, hedges inside it, round it, and in an L in the yard",
    [
      "+ + + + + + + + +",
      " L p L L L LWL . ",
      "+ +W+W+W+W+W+ + +",
      " pWL . . . .WL p ",
      "+ + + + + + + + +",
      " LWL p p p .WL . ",
      "+ + + + + + + + +",
      " LGL p . p pGp . ",
      "+ + + + + + + + +",
      " LWL p . k .WL . ",
      "+ + + + + + + + +",
      " LWp . . . .Ww . ",
      "+ +W+W+D+W+W+ + +",
      " L p . . L p p . ",
      "+ + + + + + + + +",
      " . . . p L L L L ",
      "+ + + + + + + + +",
    ],
    [
      "+ + + + + + + + +",
      " . p . . . .W. . ",
      "+ +W+W+W+W+W+ + +",
      " pW. . . . .W. p ",
      "+ + + + + + + + +",
      " .W. p p p .W. . ",
      "+ + + + + + + + +",
      " .G. p . p pGp . ",
      "+ + + + + + + + +",
      " .W. p . k .W. . ",
      "+ + + + + + + + +",
      " .Wp . . . .Ww . ",
      "+ +W+W+D+W+W+ + +",
      " . p . .L. p p . ",
      "+ + + + +L+L+L+L+",
      " . . . pL. . . . ",
      "+ + + + + + + + +",
    ],
  ],
  [
    "a stone hut whose doorway is an open tile, hedges either side of the way in",
    [
      "+ + + + + + + + +",
      " . . . . . . . . ",
      "+ + + + + + + + +",
      " . S S S S S . . ",
      "+ + + + + + + + +",
      " . S k . . S . . ",
      "+ + + + + + + + +",
      " . G . . . G . . ",
      "+ + + + + + + + +",
      " . S . . . S . . ",
      "+ + + + + + + + +",
      " . S S . S S . . ",
      "+ + + + + + + + +",
      " f p L . L p f . ",
      "+ + + + + + + + +",
      " f f l . . . . . ",
      "+ + + + + + + + +",
    ],
    [
      "+ + + + + + + + +",
      " . . . . . . . . ",
      "+ +S+S+S+S+S+ + +",
      " .S. . . . .S. . ",
      "+ + + + + + + + +",
      " .S. k . . .S. . ",
      "+ + + + + + + + +",
      " .G. . . . .G. . ",
      "+ + + + + + + + +",
      " .S. . . . .S. . ",
      "+ + + + + + + + +",
      " .S. . . . .S. . ",
      "+ +S+S+D+S+S+ + +",
      " f p . . . p f . ",
      "+ + + + + + + + +",
      " f f l . . . . . ",
      "+ + + + + + + + +",
    ],
  ],
  [
    "a home already on lines, with a hedge two thick down one side",
    [
      "+ + + + + + + + +",
      " W . . . . . L . ",
      "+ +W+W+W+W+W+ + +",
      " WW. . . . .WL p ",
      "+ + + + + + + + +",
      " LW. w . k .WL L ",
      "+ + + + + + + + +",
      " LG. . . . .GL L ",
      "+ + + + + + + + +",
      " LW. . . . .WL W ",
      "+ + + + + + + + +",
      " WW. . . . .Wb W ",
      "+ +W+W+D+W+W+ + +",
      " L L p . p L p L ",
      "+ + + + + + + + +",
      " W p b . L L p p ",
      "+ + + + + + + + +",
    ],
    [
      "+ + + + + + + + +",
      " . . . . . . . . ",
      "+ +W+W+W+W+W+ + +",
      " .W. . . . .W. p ",
      "+ + + + + + + + +",
      " .W. w . k .W.L. ",
      "+ + + + + + + + +",
      " .G. . . . .G.L. ",
      "+ + + + + + + + +",
      " .W. . . . .W.W. ",
      "+ + + + + + + + +",
      " .W. . . . .WbW. ",
      "+ +W+W+D+W+W+ + +",
      " . . p . p .LpL. ",
      "+ + + + +L+L+ + +",
      " . p b . . .Lp p ",
      "+ + + + + + + + +",
    ],
  ],
  [
    "a hut with two doors side by side, a block of glass beside it and a hedge two thick",
    [
      "+ + + + + + + + +",
      " . . . . p . . . ",
      "+ + + + + + + + +",
      " . W W D D W . . ",
      "+ + + + + + + + +",
      " . W p p . W G G ",
      "+ + + + + + + + +",
      " . G p . . G G G ",
      "+ + + + + + + + +",
      " . W . . . W G G ",
      "+ + + + + + + + +",
      " p W W . W W l . ",
      "+ + + + + + + + +",
      " L L L L L L L L ",
      "+ + + + + + + + +",
      " L L L L L L L L ",
      "+ + + + + + + + +",
    ],
    [
      "+ + + + + + + + +",
      " . . . . p . . . ",
      "+ +W+W+D+D+W+ + +",
      " .W. . . . .W. . ",
      "+ + + + + + + + +",
      " .W. p p . .W.G. ",
      "+ + + + + + + + +",
      " .G. p . . .G.G. ",
      "+ + + + + + + + +",
      " .W. . . . .W.G. ",
      "+ + + + + + + + +",
      " pW. . . . .Wl . ",
      "+ + + + + + +L+L+",
      " .L. . . . .L. . ",
      "+ +L+L+L+L+L+ + +",
      " . . . . . . . . ",
      "+ + + + + + + + +",
    ],
  ],
  [
    "a home already on lines and a lone door in the yard",
    [
      "+ + + + + + + + +",
      " . p p p p p . . ",
      "+ +G+G+G+G+G+ + +",
      " .G. . . . .G. . ",
      "+ + + + + + + + +",
      " pS. p . . .Sp p ",
      "+ + + + + + + + +",
      " pS. . . w .S. D ",
      "+ + + + + + + + +",
      " pS. . . . .S. p ",
      "+ + + + + + + + +",
      " .S. . . . .S. . ",
      "+ +S+S+D+S+S+ + +",
      " . . . . . . . p ",
      "+ + + + + + + + +",
      " . . . . . . . . ",
      "+ + + + + + + + +",
    ],
    [
      "+ + + + + + + + +",
      " . p p p p p . . ",
      "+ +G+G+G+G+G+ + +",
      " .G. . . . .G. . ",
      "+ + + + + + + + +",
      " pS. p . . .Sp p ",
      "+ + + + + + + + +",
      " pS. . . w .S. . ",
      "+ + + + + + + + +",
      " pS. . . . .S. p ",
      "+ + + + + + + + +",
      " .S. . . . .S. . ",
      "+ +S+S+D+S+S+ + +",
      " . . . . . . . p ",
      "+ + + + + + + + +",
      " . . . . . . . . ",
      "+ + + + + + + + +",
    ],
  ],
  [
    "a hut on the plot's rim with planters set in its walls, a doorway two wide and a door beside it",
    [
      "+ + + + + + + + +",
      " W G G G W . c . ",
      "+ + + + + + + + +",
      " W . w k W . p c ",
      "+ + + + + + + + +",
      " p . p p p D p . ",
      "+ + + + + + + + +",
      " W W . . W . . p ",
      "+ + + + + + + + +",
      " p . . . . . . p ",
      "+ + + + + + + + +",
      " p . p p p p p p ",
      "+ + + + + + + + +",
      " . . p p . . . p ",
      "+ + + + + + + + +",
      " . . . . . . p p ",
      "+ + + + + + + + +",
    ],
    [
      "+ + + + + + + + +",
      " . . . . . . c . ",
      "+ +G+G+G+W+ + + +",
      " .W. w k .W. p c ",
      "+ + + + + + + + +",
      " pW. p p pW. p . ",
      "+ + + + + + + + +",
      " .W. . . .W. . p ",
      "+ +W+D+D+W+ + + +",
      " p . . . . . . p ",
      "+ + + + + + + + +",
      " p . p p p p p p ",
      "+ + + + + + + + +",
      " . . p p . . . p ",
      "+ + + + + + + + +",
      " . . . . . . p p ",
      "+ + + + + + + + +",
    ],
  ],
  [
    "a hut whose doorway is two open tiles wide",
    [
      "+ + + + + + + + +",
      " . . . . . . . . ",
      "+ + + + + + + + +",
      " . S S S S S S . ",
      "+ + + + + + + + +",
      " . G . . . . G . ",
      "+ + + + + + + + +",
      " . S . . w . S . ",
      "+ + + + + + + + +",
      " . S S . . S S . ",
      "+ + + + + + + + +",
      " . . . . . . . . ",
      "+ + + + + + + + +",
      " . p . . . . p . ",
      "+ + + + + + + + +",
      " . . . . . . . . ",
      "+ + + + + + + + +",
    ],
    [
      "+ + + + + + + + +",
      " . . . . . . . . ",
      "+ +S+S+S+S+S+S+ +",
      " .S. . . . . .S. ",
      "+ + + + + + + + +",
      " .G. . . . . .G. ",
      "+ + + + + + + + +",
      " .S. . . w . .S. ",
      "+ + + + + + + + +",
      " .S. . . . . .S. ",
      "+ +S+S+D+D+S+S+ +",
      " . . . . . . . . ",
      "+ + + + + + + + +",
      " . p . . . . p . ",
      "+ + + + + + + + +",
      " . . . . . . . . ",
      "+ + + + + + + + +",
    ],
  ],
];

describe("turning every wall block into lines", () => {
  it.each(LIVE)("%s", (_, before, after) => {
    const state = drawnPlot(before);
    expect(drawing(state)).toEqual(before);
    turned(state);
    expect(drawing(state)).toEqual(after);
  });

  it("puts a wall on its own on its north line, or its south one on the plot's top row", () => {
    const state = drawnPlot([]);
    state.blocks = {
      [tileKey(2, 0)]: "stone",
      [tileKey(3, 0)]: "stone",
      [tileKey(5, 4)]: "leaf",
      [tileKey(0, 6)]: "door",
    };
    turned(state);
    expect(state.edges).toEqual({
      [edgeKey(2, 1, "n")]: "stone",
      [edgeKey(3, 1, "n")]: "stone",
      [edgeKey(5, 4, "n")]: "leaf",
    });
  });

  it("turns an L of wall blocks into an L of lines, meeting at the corner", () => {
    const state = drawnPlot([]);
    for (const [x, y] of [
      [2, 2],
      [3, 2],
      [4, 2],
      [2, 3],
      [2, 4],
    ] as const) {
      state.blocks[tileKey(x, y)] = "wood";
    }
    turned(state);
    expect(Object.keys(state.edges ?? {}).sort()).toEqual(
      [
        edgeKey(2, 2, "n"),
        edgeKey(3, 2, "n"),
        edgeKey(4, 2, "n"),
        edgeKey(2, 2, "w"),
        edgeKey(2, 3, "w"),
        edgeKey(2, 4, "w"),
      ].sort(),
    );
  });

  it("gives back a made material that takes no line, and one upstairs with no flooring by it", () => {
    const state = drawnPlot([]);
    for (const type of ["open_economy", "open_items"] as const) {
      expect(apply(state, { actor: TOWN_ACTOR, command: { type } })).toMatchObject({ ok: true });
    }
    const plot = state.plots["0,0"];
    if (!plot) throw new Error("no plot");
    plot.floors = 1;
    // Brickwork beside a wall on a line already, so it stands for that wall, and plaster upstairs
    // on a post of wood with no flooring by it.
    state.edges = { [edgeKey(4, 4, "w")]: "wood" };
    state.blocks[tileKey(4, 4)] = "brickwork";
    state.blocks[tileKey(2, 2)] = "wood";
    state.floors = { "1": { blocks: { [tileKey(2, 2)]: "plaster" }, ground: {} } };
    expect(turned(state)).toMatchObject({ walls: 1, back: 2 });
    expect(state.items?.inventories.ada?.stacks).toMatchObject({ brickwork: 1, plaster: 1 });
    expect(state.floors?.["1"]?.blocks).toEqual({});
    expect(state.edges).toEqual({ [edgeKey(4, 4, "w")]: "wood", [edgeKey(2, 2, "n")]: "wood" });
  });

  it("puts a door on the outer line of a seat standing in the doorway, never a wall", () => {
    // A sofa where the hut's door was: walkers go over it, so it was the way in.
    const { state } = hut();
    state.blocks[tileKey(3, 5)] = "sofa";
    turned(state);
    expect(edgeAt(state, 3, 6, "n")).toBe("door");
    expect(designNotes(state, 0, 0).map((n) => n.code)).not.toContain("hearth_walled_in");
  });

  it("leaves a home as it stands where its lines would wall the hearth in", () => {
    // The wall beside the door is gone, so the doorway is two tiles wide, and a door on its own
    // stands outside it: the planner finds no door for the room, and the town won't shut Ada in.
    const { state } = hut();
    delete state.blocks[tileKey(2, 5)];
    state.blocks[tileKey(2, 6)] = "door";
    expect(townLines(state, 0, 0)).toEqual({
      problem: "It would wall a hearth in with no way to it.",
    });
  });

  it("has nothing to do on a plot with no wall blocks", () => {
    const state = drawnPlot([]);
    state.blocks = { [tileKey(3, 3)]: "planter" };
    expect(townLines(state, 0, 0)).toEqual({
      problem: "This plot has no wall blocks left: its walls already stand between tiles.",
    });
  });
});
