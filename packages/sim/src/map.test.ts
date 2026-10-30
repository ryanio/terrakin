import { describe, expect, it } from "vitest";
import { apply, prepare } from "./apply";
import { designNotes } from "./design";
import { GROUND_KINDS } from "./ground";
import { hashWorld } from "./hash";
import { MAP_BLOCKS, MAP_GROUND, MAP_LEGEND_MAX, MAP_MARKS, plotMap } from "./map";
import { fund, stock } from "./test-support";
import { BLOCK_KINDS, type Command, TOWN_ACTOR, type WorldConfig } from "./types";
import { createWorld } from "./world";

// 3x3 plots of 8 tiles. Ada settles plot (0, 0) and builds the starter home: walls round (1, 1)
// to (5, 5), the doorway at (3, 5), and her hearth at (3, 3), where she stands.
const CONFIG: WorldConfig = {
  width: 24,
  height: 24,
  plotSize: 8,
  maxPlotsPerResident: 1,
  reach: 3,
};
type Build = Extract<Command, { type: "build" }>;

function world() {
  const state = createWorld(CONFIG);
  const ok = (actor: string, command: Command) => {
    const result = apply(state, { actor, command });
    expect(result, JSON.stringify(command)).toMatchObject({ ok: true });
  };
  ok(TOWN_ACTOR, { type: "new_day", day: 20_000 });
  ok(TOWN_ACTOR, { type: "open_economy" });
  ok(TOWN_ACTOR, { type: "open_items" });
  ok("ada", { type: "join", name: "Ada", kind: "agent" });
  ok("ada", { type: "settle", px: 0, py: 0 });
  ok("ada", { type: "build_starter_home" });
  return { state, ok };
}

const HUT = [
  "........",
  ".WWWWW..",
  ".W...W..",
  ".G.h.G..",
  ".W...W..",
  ".WW.WW..",
  "........",
  "........",
];
const BARE = Array.from({ length: 8 }, () => "........");

describe("plotMap (RFC 0032)", () => {
  it("writes every path and flooring as a character of its own that no block, mark, or digit uses", () => {
    // A shared character would drop a kind from MAP_GROUND, or read back as something else.
    expect(Object.keys(MAP_GROUND)).toHaveLength(GROUND_KINDS.length);
    const taken = new Set<string>([...Object.keys(MAP_BLOCKS), ...Object.values(MAP_MARKS)]);
    const clashes = Object.keys(MAP_GROUND).filter(
      (c) => taken.has(c) || /^[0-9]$/.test(c) || [...c].length !== 1,
    );
    expect(clashes).toEqual([]);
  });

  it("draws a plot's blocks and ground a row of text per row of tiles, with the hearth", () => {
    const { state } = world();
    expect(plotMap(state, 0, 0)).toEqual({ floors: [{ floor: 0, blocks: HUT, ground: BARE }] });
    // An empty plot, and someone standing on one, and no plot at all.
    expect(plotMap(state, 2, 2)).toEqual({ floors: [{ floor: 0, blocks: BARE, ground: BARE }] });
    Object.assign(state.residents.ada ?? {}, { x: 17, y: 18 });
    expect(plotMap(state, 2, 2)?.floors[0]?.blocks[2]).toBe(".@......");
    expect(plotMap(state, 3, 0)).toBeUndefined();
  });

  it("gives decor and furniture digits in the order they first appear, and * past ten", () => {
    const { state, ok } = world();
    const kinds = BLOCK_KINDS.filter((k) => !["wood", "stone", "glass", "leaf"].includes(k))
      .filter((k) => !["planter", "kitchen", "workbench", "pedestal", "pond", "stairs"].includes(k))
      .slice(0, MAP_LEGEND_MAX + 1);
    stock(state, "ada", Object.fromEntries(kinds.map((k) => [k, 1])));
    // In reading order: row 6 west to east, then row 7.
    const blocks = kinds.map((block, i) => ({ x: i % 8, y: i < 8 ? 6 : 7, block }));
    ok("ada", { type: "build", px: 0, py: 0, blocks });
    const map = plotMap(state, 0, 0);
    expect(map?.floors[0]?.blocks.slice(6)).toEqual(["01234567", "89*....."]);
    expect(map?.legend).toEqual(
      Object.fromEntries(kinds.slice(0, 10).map((k, i) => [String(i), k])),
    );
  });

  it("draws a dry run's plan as the plot it would leave, every floor, without changing the world", () => {
    const { state, ok } = world();
    fund(state, "ada", 500);
    stock(state, "ada", { wood: 20, table: 1 });
    ok("ada", { type: "add_floor", px: 0, py: 0 });
    // Take a wall and a window away, lay planks inside, a loft with stairs, and a table.
    const plan: Build = {
      type: "build",
      px: 0,
      py: 0,
      remove: [{ x: 1, y: 3 }],
      blocks: [
        { x: 1, y: 3, block: "stone" },
        { x: 3, y: 2, block: "stairs" },
        { x: 2, y: 4, block: "table" },
        { x: 2, y: 1, floor: 1, block: "glass" },
      ],
      ground: [
        { x: 2, y: 2, ground: "planks" },
        { x: 1, y: 1, floor: 1, ground: "planks" },
        { x: 2, y: 1, floor: 1, ground: "planks" },
        { x: 3, y: 1, floor: 1, ground: "planks" },
      ],
    };
    Object.assign(state.residents.ada ?? {}, { x: 7, y: 7 });
    const before = hashWorld(state);
    const prepared = prepare(state, { actor: "ada", command: plan });
    if (!prepared.ok || !prepared.plan) throw new Error("the plan was refused");
    const dry = plotMap(state, 0, 0, prepared.plan);
    const dryNotes = designNotes(state, 0, 0, prepared.plan);
    expect(hashWorld(state)).toBe(before);
    expect(dry?.floors.map((f) => f.blocks)).toEqual([
      [
        "........",
        ".WWWWW..",
        ".W.^.W..",
        ".S.h.G..",
        ".W0..W..",
        ".WW.WW..",
        "........",
        ".......@",
      ],
      ["........", "..G.....", ...BARE.slice(2)],
    ]);
    expect(dry?.legend).toEqual({ "0": "table" });
    prepared.commit();
    expect(plotMap(state, 0, 0)).toEqual(dry);
    expect(designNotes(state, 0, 0)).toEqual(dryNotes);
  });
});
