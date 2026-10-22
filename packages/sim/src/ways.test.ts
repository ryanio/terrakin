import { describe, expect, it } from "vitest";
import { apply, prepare } from "./apply";
import { WAYS_CONFIG, WAYS_HASH, WAYS_LOG, WAYS_TILES } from "./fixtures/ways-log";
import { hashWorld } from "./hash";
import { landlocked, plotOpenings } from "./openings";
import { replay } from "./replay";
import type { Command, WorldState } from "./types";
import { TOWN_ACTOR } from "./types";
import { isWay } from "./ways";
import { createWorld } from "./world";

/**
 * Public ways (RFC 0046, Option 1). The fixture lays a way down the west wall of Ada's starter hut
 * on a 3 by 3 downtown: the town clears the wall, opens the way, and rebuilds her home with a door
 * onto it.
 */

/** The fixture's world just before the way opens, with the wall it runs through cleared. */
const cleared = (): WorldState =>
  replay(
    WAYS_CONFIG,
    WAYS_LOG.slice(
      0,
      WAYS_LOG.findIndex((i) => i.command.type === "open_way"),
    ),
  );
/** The fixture's world with the way open and Ada's home rebuilt. */
const opened = (): WorldState =>
  replay(
    WAYS_CONFIG,
    WAYS_LOG.slice(0, WAYS_LOG.findIndex((i) => i.command.type === "rebuild_home") + 1),
  );

/** A command's refusal code, checking a refusal changed nothing; null when it was taken. */
function code(state: WorldState, actor: string, command: Command): string | null {
  const before = hashWorld(state);
  const result = apply(state, { actor, command });
  if (result.ok) return null;
  expect(hashWorld(state), "a refusal changed the world").toBe(before);
  return result.rejection.code;
}

describe("the fixture", () => {
  it("replays: the wall comes down, the way opens, and Ada walks out of her new door onto it", () => {
    const state = replay(WAYS_CONFIG, WAYS_LOG);
    expect(hashWorld(state)).toBe(WAYS_HASH);
    expect(state.blocks["2,3"]).toBe("door");
    expect(state.residents.ada).toMatchObject({ x: 1, y: 4 });
    expect(WAYS_TILES.filter(([x, y]) => isWay(state, x, y))).toHaveLength(7);
    expect(isWay(state, 1, 7)).toBe(false);
  });
});

describe("open_way", () => {
  it.each<[string, Command, string]>([
    ["a block on a tile", { type: "open_way", tiles: [[2, 1]] }, "tile_occupied"],
    ["a hearth", { type: "open_way", tiles: [[3, 3]] }, "tile_occupied"],
    ["the Commons", { type: "open_way", tiles: [[12, 12]] }, "server_only"],
    ["a tile past the world's edge", { type: "open_way", tiles: [[30, 1]] }, "out_of_bounds"],
    [
      "tiles out of order",
      {
        type: "open_way",
        tiles: [
          [1, 2],
          [1, 1],
        ],
      },
      "server_only",
    ],
    ["no tiles", { type: "open_way", tiles: [] }, "server_only"],
  ])("refuses %s", (_, command, refused) => {
    expect(code(cleared(), TOWN_ACTOR, command)).toBe(refused);
  });

  it("comes only from the town, and a way already open is already set", () => {
    const state = cleared();
    expect(code(state, "ada", { type: "open_way", tiles: WAYS_TILES })).toBe("server_only");
    expect(code(state, TOWN_ACTOR, { type: "open_way", tiles: WAYS_TILES })).toBe(null);
    expect(code(state, TOWN_ACTOR, { type: "open_way", tiles: [[1, 0]] })).toBe("already_set");
  });

  it("is refused while a block stands on a tile, so the town clears it first", () => {
    const state = replay(WAYS_CONFIG, WAYS_LOG.slice(0, WAYS_LOG.length - 14));
    expect(state.blocks["1,1"]).toBeDefined();
    expect(code(state, TOWN_ACTOR, { type: "open_way", tiles: WAYS_TILES })).toBe("tile_occupied");
  });
});

describe("a way holds no block", () => {
  it.each<[string, Command]>([
    ["place", { type: "place", x: 1, y: 6, block: "wood" }],
    ["a door", { type: "place", x: 1, y: 5, block: "door" }],
    ["build", { type: "build", px: 0, py: 0, blocks: [{ x: 1, y: 6, block: "stone" }] }],
  ])("refuses %s on it, dry run and all", (_, command) => {
    const state = opened();
    const ada = state.residents.ada;
    if (!ada) throw new Error("ada isn't here");
    ada.x = 2;
    ada.y = 6;
    const dry = prepare(state, { actor: "ada", command });
    expect(dry.ok ? null : dry.rejection.code).toBe("public_way");
    expect(code(state, "ada", command)).toBe("public_way");
  });

  it("refuses a starter home that would wall it", () => {
    const state = opened();
    // Take Ada's hut down, so a starter home would go up again over the way's column.
    for (const key of Object.keys(state.blocks)) {
      const [x, y] = key.split(",").map(Number) as [number, number];
      if (x < 8 && y < 8) delete state.blocks[key];
    }
    const command: Command = { type: "build_starter_home" };
    // The hut stands on x 1 to 5, and the way is x 1.
    expect(code(state, "ada", command)).toBe("public_way");
  });

  it("takes a path, and anything off the way", () => {
    const state = opened();
    const ada = state.residents.ada;
    if (!ada) throw new Error("ada isn't here");
    ada.x = 2;
    ada.y = 6;
    expect(code(state, "ada", { type: "lay", x: 1, y: 6, ground: "dirt" })).toBe(null);
    expect(code(state, "ada", { type: "place", x: 2, y: 7, block: "wood" })).toBe(null);
  });
});

describe("close_way", () => {
  it("takes a way back up, and refuses a tile that isn't one", () => {
    const state = opened();
    expect(code(state, TOWN_ACTOR, { type: "close_way", tiles: [[2, 6]] })).toBe("server_only");
    expect(code(state, TOWN_ACTOR, { type: "close_way", tiles: WAYS_TILES })).toBe(null);
    expect(state.ways).toBeUndefined();
  });
});

describe("rebuild_home", () => {
  it.each<[string, Command, string]>([
    [
      "a plot nobody owns",
      { type: "rebuild_home", px: 0, py: 1, blocks: [{ x: 2, y: 3, block: "door" }], remove: [] },
      "plot_unclaimed",
    ],
    [
      "a wall on the way",
      { type: "rebuild_home", px: 0, py: 0, blocks: [{ x: 1, y: 6, block: "wood" }], remove: [] },
      "public_way",
    ],
    [
      "a tile already holding something",
      { type: "rebuild_home", px: 0, py: 0, blocks: [{ x: 2, y: 2, block: "door" }], remove: [] },
      "tile_occupied",
    ],
  ])("refuses %s", (_, command, refused) => {
    const state = replay(WAYS_CONFIG, WAYS_LOG.slice(0, WAYS_LOG.length - 5));
    expect(code(state, TOWN_ACTOR, command)).toBe(refused);
    expect(code(state, "ada", command)).toBe("server_only");
  });
});

describe("a way out onto a way", () => {
  /** Downtown 4 by 4, the Commons at (2, 2); plot (0, 0) has a claimed plot on all three sides. */
  function surrounded(): WorldState {
    const state = createWorld({
      width: 32,
      height: 32,
      plotSize: 8,
      maxPlotsPerResident: 1,
      reach: 3,
    });
    for (const [px, py, ownerId] of [
      [0, 0, "a"],
      [1, 0, "b"],
      [0, 1, "c"],
      [1, 1, "d"],
    ] as const) {
      state.plots[`${px},${py}`] = { px, py, ownerId };
    }
    return state;
  }
  const column = (y0: number, y1: number) =>
    Array.from({ length: y1 - y0 + 1 }, (_, i) => [8, y0 + i] as [number, number]);

  it.each<[string, [number, number][], boolean]>([
    // Down the west edges of b's and d's plots, onto the free slot (1, 2) beside the Commons.
    ["a way that joins the Commons", column(0, 15), true],
    // Down b's plot alone: it ends at d's yard, so it leads nowhere.
    ["a way that leads nowhere", column(0, 7), false],
  ])("counts %s", (_, tiles, opens) => {
    const state = surrounded();
    expect(landlocked(state).map((p) => `${p.px},${p.py}`)).toContain("0,0");
    expect(code(state, TOWN_ACTOR, { type: "open_way", tiles })).toBe(null);
    expect(plotOpenings(state, 0, 0).length > 0).toBe(opens);
    expect(landlocked(state).some((p) => p.px === 0 && p.py === 0)).toBe(!opens);
  });
});
