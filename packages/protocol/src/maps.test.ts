import {
  apply,
  BUILDING_BLOCKS,
  type Command,
  createWorld,
  DEFAULT_CONFIG,
  designNotes,
  plotMap,
  plotPlan,
  prepare,
  TOWN_ACTOR,
  type WorldState,
} from "@terrakin/sim";
import { describe, expect, it } from "vitest";
import { Action } from "./actions";
import { DESIGN_TURNS } from "./design-ids";
import { DESIGNS, designViews } from "./designs";
import { mapEdges, mapToPlan } from "./maps";
import { buildCommand } from "./plans";

const S = DEFAULT_CONFIG.plotSize;
const EMPTY = { blocks: [], ground: [] };

/** A world where Wren has settled plot (2, 1) and holds plenty to build with. */
function world(): { state: WorldState; ok: (actor: string, command: Command) => void } {
  const state = createWorld(DEFAULT_CONFIG);
  const ok = (actor: string, command: Command) => {
    const result = apply(state, { actor, command });
    expect(result, JSON.stringify(command)).toMatchObject({ ok: true });
  };
  ok(TOWN_ACTOR, { type: "new_day", day: 20_000 });
  ok(TOWN_ACTOR, { type: "open_items" });
  ok("wren", { type: "join", name: "Wren", kind: "agent" });
  ok("wren", { type: "settle", px: 2, py: 1 });
  ok(TOWN_ACTOR, {
    type: "test_grant",
    to: "wren",
    stacks: { wood: 40, stone: 40, table: 2, chair: 2 },
  });
  // Off the plot, so nothing is skipped for her standing on a tile.
  Object.assign(state.residents.wren ?? {}, { x: 0, y: 0 });
  return { state, ok };
}

/** A `build` as the server expands it, on plot (2, 1) as it stands in `state`. */
function expand(state: WorldState, action: Record<string, unknown>) {
  const parsed = Action.parse({ type: "build", px: 2, py: 1, ...action });
  if (parsed.type !== "build") throw new Error("not a build");
  const now = plotPlan(state, 2, 1) ?? EMPTY;
  // As the server does: the plot's own map is read only for a build that carries a map.
  const drawn = "map" in action ? plotMap(state, 2, 1) : undefined;
  return buildCommand(parsed, {
    size: S,
    now,
    current: drawn ? { legend: drawn.legend, grades: drawn.grades } : undefined,
  });
}

/** An `edges` grid for a plot of 8 tiles with nothing on any line. */
const NO_LINES = Array.from({ length: 17 }, (_, r) =>
  r % 2 === 0 ? "+ + + + + + + + +" : " . . . . . . . . ",
);
/** `grid` with `char` at row `r`, column `c`. */
const withLine = (grid: readonly string[], r: number, c: number, char: string) =>
  grid.map((row, i) => (i === r ? row.slice(0, c) + char + row.slice(c + 1) : row));

describe("mapToPlan (RFC 0032)", () => {
  it("reads the RFC's hut with planks and a path as the lists a plan has always sent", () => {
    const read = mapToPlan(
      {
        floors: [
          {
            blocks: [
              "........",
              ".WWWWW..",
              ".W...W..",
              ".G.h.G..",
              ".W...W..",
              ".WW.WW..",
              "........",
              "........",
            ],
            ground: [
              "........",
              "........",
              "..===...",
              "..===...",
              "..===...",
              "...:....",
              "..m:m...",
              "...:....",
            ],
          },
        ],
      },
      { size: S, now: EMPTY },
    );
    if ("problem" in read) throw new Error(read.problem);
    expect(read.plan.blocks).toHaveLength(15);
    expect(read.plan.blocks).toContainEqual({ x: 1, y: 3, block: "glass" });
    expect(read.plan.ground).toHaveLength(14);
    expect(read.plan.ground).toContainEqual({ x: 2, y: 6, ground: "moss" });
    expect(read.plan.remove).toBeUndefined();
  });

  it("leaves a pot's tile as it stands, so a plot's own map with a pot set down can be sent back", () => {
    const blocks = [".1......", ".WW.....", ...Array.from({ length: S - 2 }, () => "........")];
    const read = mapToPlan(
      { legend: { "1": "pot" }, floors: [{ blocks }] },
      { size: S, now: EMPTY, replace: true },
    );
    if ("problem" in read) throw new Error(read.problem);
    expect(read.plan.blocks).toEqual([
      { x: 1, y: 1, block: "wood" },
      { x: 2, y: 1, block: "wood" },
    ]);
    expect(read.plan.remove).toBeUndefined();
  });

  it("reads digits by the plot's own legend when a sent-back map leaves its legend out (issue #135)", () => {
    const rows = ["01......", ...Array.from({ length: S - 1 }, () => "........")];
    const map = { floors: [{ blocks: rows }] };
    const current = { legend: { "0": "table" as const, "1": "pot" as const } };
    const read = mapToPlan(map, { size: S, now: EMPTY, current });
    if ("problem" in read) throw new Error(read.problem);
    // The table digit resolves through the plot's own legend; the pot digit still leaves its
    // tile as it stands, as a pot in a carried legend does.
    expect(read.plan.blocks).toEqual([{ x: 0, y: 0, block: "table" }]);
    // A legend the map carries wins over the plot's own, digit by digit.
    const carried = mapToPlan(
      { ...map, legend: { "0": "chair" as const } },
      { size: S, now: EMPTY, current },
    );
    if ("problem" in carried) throw new Error(carried.problem);
    expect(carried.plan.blocks).toEqual([{ x: 0, y: 0, block: "chair" }]);
    // With no legend anywhere the same map refuses, in words that say a legend is the fix.
    const bare = mapToPlan(map, { size: S, now: EMPTY });
    expect("problem" in bare && bare.problem).toMatch(/a digit with no legend to say what it is/);
  });

  it("refuses a map whose shape is wrong, naming where, and echoes no more than one character", () => {
    const rows = (n: number, row = "........") => Array.from({ length: n }, () => row);
    const problem = (map: Parameters<typeof mapToPlan>[0]) => {
      const read = mapToPlan(map, { size: S, now: EMPTY });
      return "problem" in read ? read.problem : "";
    };
    expect(problem({ floors: [{ blocks: rows(7) }] })).toBe(
      "Floor 0's blocks have 7 rows. A plot is 8 rows of 8 tiles.",
    );
    expect(problem({ floors: [{ ground: [...rows(3), ".........", ...rows(4)] }] })).toBe(
      "Row 3 of floor 0's ground is 9 characters long. A plot is 8 tiles wide.",
    );
    expect(problem({ floors: [{ blocks: [...rows(2), "..Q.....", ...rows(5)] }] })).toMatch(
      /^Floor 0's blocks have "Q" at \(2, 2\), which isn't a block\. Blocks: W wood, S stone,/,
    );
    const sneaky = problem({ floors: [{ ground: [...rows(5), "..‮.....", ...rows(2)] }] });
    expect(sneaky).toMatch(/has a character it can't read at \(2, 5\)/);
    expect(sneaky).not.toContain("‮");
    // A digit is a block only through a legend, and the refusal says so (issue #135).
    expect(problem({ floors: [{ blocks: [...rows(7), "1......."] }] })).toMatch(
      /a digit with no legend to say what it is/,
    );
    expect(
      problem({ floors: [{ ground: [...rows(7), "1......."] }], legend: { "1": "table" } }),
    ).toMatch(/isn't a path or flooring/);
    expect(problem({ floors: [{ floor: 1 }, { floor: 1 }] })).toBe("Floor 1 is in the map twice.");
  });

  it("swaps only what differs with replace, clears with x only what's there, and reads h, @, and * as .", () => {
    const { state, ok } = world();
    ok("wren", {
      type: "build",
      px: 2,
      py: 1,
      blocks: [
        { x: 0, y: 0, block: "wood" },
        { x: 1, y: 0, block: "stone" },
      ],
      ground: [{ x: 0, y: 1, ground: "dirt" }],
    });
    const rest = Array.from({ length: 6 }, () => "........");
    const map = {
      floors: [
        { blocks: ["WWx1h@*.", "........", ...rest], ground: ["x.......", "m.......", ...rest] },
      ],
      legend: { "1": "table" as const },
    };
    const skips = expand(state, { map });
    const swaps = expand(state, { map, replace: true });
    if ("problem" in skips || "problem" in swaps) throw new Error("refused");
    // (0, 0) is already wood; (1, 0) is stone, which only replace takes away; (2, 0) is empty.
    expect(skips.command.remove).toBeUndefined();
    expect(skips.command.lift).toBeUndefined();
    expect(swaps.command.remove).toEqual([{ x: 1, y: 0 }]);
    expect(swaps.command.lift).toEqual([{ x: 0, y: 1 }]);
    expect(swaps.command.blocks).toEqual([
      { x: 0, y: 0, block: "wood" },
      { x: 1, y: 0, block: "wood" },
      { x: 3, y: 0, block: "table" },
    ]);
    const built = prepare(state, { actor: "wren", command: swaps.command });
    if (!built.ok || !built.plan) throw new Error("the swap was refused");
    expect(built.plan.skipped).toEqual([{ x: 0, y: 0, what: "block", why: "same" }]);
  });

  it("builds the plot a map was drawn from, decor, furniture, and all, on an empty plot", () => {
    const { state, ok } = world();
    ok("wren", { type: "build_starter_home" });
    ok("wren", {
      type: "build",
      px: 2,
      py: 1,
      blocks: [
        { x: 2, y: 2, block: "table" },
        { x: 4, y: 2, block: "chair" },
        { x: 6, y: 6, block: "planter" },
      ],
      ground: [
        { x: 3, y: 4, ground: "planks" },
        { x: 3, y: 6, ground: "cobble" },
      ],
    });
    const drawn = plotMap(state, 2, 1);
    if (!drawn) throw new Error("no map");
    // Onto an empty plot of a second resident, through the API's own reading.
    ok("ivy", { type: "join", name: "Ivy", kind: "agent" });
    ok("ivy", { type: "settle", px: 3, py: 1 });
    ok(TOWN_ACTOR, {
      type: "test_grant",
      to: "ivy",
      stacks: { wood: 10, stone: 10, table: 1, chair: 1 },
    });
    Object.assign(state.residents.ivy ?? {}, { x: 0, y: 0 });
    const parsed = Action.parse({ type: "build", px: 3, py: 1, map: drawn });
    if (parsed.type !== "build") throw new Error("not a build");
    const expanded = buildCommand(parsed, { size: S, now: EMPTY });
    if ("problem" in expanded) throw new Error(expanded.problem);
    ok("ivy", expanded.command);
    // All but the hearth, which a build never sets.
    const unhearthed = drawn.floors.map((f) => ({
      ...f,
      blocks: f.blocks.map((r) => r.replace("h", ".")),
    }));
    expect(plotMap(state, 3, 1)).toEqual({ ...drawn, floors: unhearthed });
  });

  it("gives a graded digit's grade to its plan entry, and replace swaps a wall of another grade (RFC 0051)", () => {
    const { state, ok } = world();
    ok(TOWN_ACTOR, { type: "open_grades" });
    ok(TOWN_ACTOR, { type: "test_grant", to: "wren", stacks: { plaster: 1 } });
    const wren = state.items?.inventories.wren;
    if (!wren) throw new Error("Wren holds nothing");
    wren.graded = { plaster: { fine: 3 } };
    ok("wren", {
      type: "build",
      px: 2,
      py: 1,
      blocks: [
        { x: 0, y: 0, block: "plaster" },
        { x: 1, y: 0, block: "plaster", grade: "fine" },
      ],
    });
    // Drawn by the server, plain and fine plaster are two digits, and the map reads back as the
    // plot stands: nothing to take away.
    const drawn = plotMap(state, 2, 1);
    expect(drawn?.legend).toEqual({ "0": "plaster", "1": "plaster" });
    expect(drawn?.grades).toEqual({ "1": "fine" });
    const same = expand(state, { map: drawn, replace: true });
    if ("problem" in same) throw new Error(same.problem);
    expect(same.command.remove).toBeUndefined();
    // Fine drawn over the plain wall: replace takes the plain one away first.
    const rest = Array.from({ length: 7 }, () => "........");
    const map = {
      floors: [{ blocks: ["11......", ...rest] }],
      legend: { "1": "plaster" },
      grades: { "1": "fine" },
    };
    const swaps = expand(state, { map, replace: true });
    if ("problem" in swaps) throw new Error(swaps.problem);
    expect(swaps.command.remove).toEqual([{ x: 0, y: 0 }]);
    expect(swaps.command.blocks).toEqual([
      { x: 0, y: 0, block: "plaster", grade: "fine" },
      { x: 1, y: 0, block: "plaster", grade: "fine" },
    ]);
  });
});

describe("mapToPlan's edges grid (RFC 0050)", () => {
  it("reads the RFC's room of lines into edges, borders as s and e, and never reads corners or tiles", () => {
    // A 3 by 3 room in the plot's south-east corner: windows on each side, a door to the south
    // on the plot's border, and a table drawn at a tile position, which is never read.
    const rows = [
      ...NO_LINES.slice(0, 10),
      "+ + + + + +S+S+S+",
      " . . . . .S. . .S",
      "+ + + + + + + + +",
      " . . . . .G. h .G",
      "+ + + + + + + + +",
      " . . . . .S. 1 .S",
      "+ + + + + +S+D+S+",
    ];
    const read = mapToPlan(
      { floors: [{ edges: rows }], legend: { "1": "table" } },
      { size: S, now: EMPTY },
    );
    if ("problem" in read) throw new Error(read.problem);
    expect(read.plan.blocks).toBeUndefined();
    expect(read.plan.edges).toHaveLength(12);
    expect(read.plan.edges).toContainEqual({ x: 5, y: 5, side: "n", block: "stone" });
    expect(read.plan.edges).toContainEqual({ x: 5, y: 6, side: "w", block: "glass" });
    expect(read.plan.edges).toContainEqual({ x: 7, y: 6, side: "e", block: "glass" });
    expect(read.plan.edges).toContainEqual({ x: 6, y: 7, side: "s", block: "door" });
  });

  it("refuses a grid whose shape or lines are wrong, in plain words", () => {
    const problem = (edges: string[], legend: Record<string, "table" | "plaster"> = {}) => {
      const read = mapToPlan({ floors: [{ edges }], legend }, { size: S, now: EMPTY });
      return "problem" in read ? read.problem : "";
    };
    expect(problem(NO_LINES.slice(1))).toBe(
      "Floor 0's edges have 16 rows. A plot of 8 tiles has 17 rows of 17 characters there: two per tile and one more.",
    );
    expect(problem(withLine(NO_LINES, 4, 16, "++"))).toBe(
      "Row 4 of floor 0's edges is 18 characters long. A plot of 8 tiles is 17 wide there.",
    );
    // A planter, a door's block letter, and furniture from the legend can't stand on a line.
    for (const char of ["p", "+", "1"]) {
      const said = problem(withLine(NO_LINES, 2, 3, char), { "1": "table" });
      expect(said).toContain(
        `Floor 0's edges have "${char}" on a line at row 2, column 3, which can't stand between tiles. Lines: W wood, S stone, G glass, L leaf, D door, digits from the map's legend for plaster,`,
      );
      expect(said).toContain("; a space or . leaves a line as it is, x takes its wall down.");
    }
    // A made material is a wall through the legend.
    expect(problem(withLine(NO_LINES, 2, 3, "1"), { "1": "plaster" })).toBe("");
  });

  it("reads an edges digit by the plot's own legend, and a digit with no legend anywhere says so (issue #135)", () => {
    const edges = withLine(NO_LINES, 2, 3, "1");
    const read = mapToPlan(
      { floors: [{ edges }] },
      { size: S, now: EMPTY, current: { legend: { "1": "plaster" } } },
    );
    if ("problem" in read) throw new Error(read.problem);
    expect(read.plan.edges).toEqual([{ x: 1, y: 1, side: "n", block: "plaster" }]);
    const bare = mapToPlan({ floors: [{ edges }] }, { size: S, now: EMPTY });
    expect("problem" in bare && bare.problem).toMatch(
      /a digit with no legend to say what wall it is/,
    );
    expect("problem" in bare && bare.problem).not.toMatch(/can't stand between tiles/);
  });

  it("takes a line down with x only where a wall stands, and swaps only what differs with replace", () => {
    const { state, ok } = world();
    ok("wren", {
      type: "build",
      px: 2,
      py: 1,
      edges: [
        { x: 0, y: 1, side: "n", block: "wood" },
        { x: 1, y: 1, side: "n", block: "stone" },
      ],
    });
    // Row 2 holds the north lines of row 1's tiles: wood on wood, wood on stone, x on nothing.
    const map = { floors: [{ edges: withLine(withLine(NO_LINES, 2, 1, "W"), 2, 3, "W") }] };
    const cleared = { floors: [{ edges: withLine(withLine(NO_LINES, 2, 1, "x"), 2, 5, "x") }] };
    const skips = expand(state, { map });
    const swaps = expand(state, { map, replace: true });
    const clears = expand(state, { map: cleared });
    if ("problem" in skips || "problem" in swaps || "problem" in clears) throw new Error("refused");
    expect(skips.command.removeEdges).toBeUndefined();
    expect(swaps.command.removeEdges).toEqual([{ x: 1, y: 1, side: "n" }]);
    expect(swaps.command.edges).toEqual([
      { x: 0, y: 1, side: "n", block: "wood" },
      { x: 1, y: 1, side: "n", block: "wood" },
    ]);
    expect(clears.command).toEqual({
      type: "build",
      px: 2,
      py: 1,
      removeEdges: [{ x: 0, y: 1, side: "n" }],
    });
    const built = prepare(state, { actor: "wren", command: swaps.command });
    if (!built.ok || !built.plan) throw new Error("the swap was refused");
    expect(built.plan.skipped).toEqual([{ x: 0, y: 1, what: "wall", side: "n", why: "same" }]);
  });

  it("builds the plot of lines a map was drawn from onto an empty plot, line for line", () => {
    const { state, ok } = world();
    ok(TOWN_ACTOR, { type: "starter_edges" });
    ok("wren", { type: "build_starter_home" });
    const drawn = plotMap(state, 2, 1);
    if (!drawn) throw new Error("no map");
    expect(drawn.floors[0]?.edges).toHaveLength(17);
    ok("ivy", { type: "join", name: "Ivy", kind: "agent" });
    ok("ivy", { type: "settle", px: 3, py: 1 });
    Object.assign(state.residents.ivy ?? {}, { x: 0, y: 0 });
    const parsed = Action.parse({ type: "build", px: 3, py: 1, map: drawn });
    if (parsed.type !== "build") throw new Error("not a build");
    const expanded = buildCommand(parsed, { size: S, now: EMPTY });
    if ("problem" in expanded) throw new Error(expanded.problem);
    ok("ivy", expanded.command);
    const unhearthed = drawn.floors.map((f) => ({
      ...f,
      blocks: f.blocks.map((r) => r.replace("h", ".")),
      edges: f.edges?.map((r) => r.replace("h", ".")),
    }));
    expect(plotMap(state, 3, 1)).toEqual({ ...drawn, floors: unhearthed });
  });
});

describe("buildCommand (RFC 0032)", () => {
  it("takes lists, a map, or a design, one at a time, with options only for a design", () => {
    const { state } = world();
    const problem = (action: Record<string, unknown>) => {
      const out = expand(state, action);
      return "problem" in out ? out.problem : "";
    };
    const map = { floors: [{ ground: Array(8).fill("::::::::") }] };
    expect(problem({ map, design: "hut" })).toBe(
      "A plan is lists, a map, or a design. Send one of them.",
    );
    expect(problem({ map, ground: [] })).toBe(
      "A plan is lists, a map, or a design. Send one of them.",
    );
    expect(problem({ map, turn: 90 })).toBe("turn goes with a design.");
    expect(problem({ map, walls: "stone", turn: 90 })).toBe("walls, turn go with a design.");
    expect(problem({ ground: [{ x: 0, y: 0, ground: "dirt" }], replace: true })).toMatch(
      /^replace goes with a map or a design/,
    );
    expect(problem({ design: "hut", walls: "glass" })).toBe("The hut takes walls: wood, stone.");
    expect(() => Action.parse({ type: "build", px: 2, py: 1, design: "castle" })).toThrow();
    expect(() => Action.parse({ type: "build", px: 2, py: 1, design: "hut", turn: 45 })).toThrow();
    const lists = expand(state, { ground: [{ x: 0, y: 0, ground: "dirt" }] });
    expect(lists).toEqual({
      command: { type: "build", px: 2, py: 1, ground: [{ x: 0, y: 0, ground: "dirt" }] },
    });
  });

  it("expands a plot's own map sent back floors-only, legend and all read from the plot (issue #135)", () => {
    const { state, ok } = world();
    ok("wren", {
      type: "build",
      px: 2,
      py: 1,
      blocks: [
        { x: 0, y: 0, block: "table" },
        { x: 1, y: 0, block: "chair" },
      ],
    });
    const drawn = plotMap(state, 2, 1);
    if (!drawn?.legend) throw new Error("the plot's map has no legend");
    expect(Object.values(drawn.legend)).toEqual(expect.arrayContaining(["table", "chair"]));
    const expanded = expand(state, { map: { floors: drawn.floors } });
    if ("problem" in expanded) throw new Error(expanded.problem);
    expect(expanded.command.blocks).toEqual(
      expect.arrayContaining([
        { x: 0, y: 0, block: "table" },
        { x: 1, y: 0, block: "chair" },
      ]),
    );
  });

  it("refuses a design on a world whose plots aren't the size designs are drawn for", () => {
    const parsed = Action.parse({ type: "build", px: 0, py: 0, design: "hut" });
    if (parsed.type !== "build") throw new Error("not a build");
    const out = buildCommand(parsed, { size: 10, now: EMPTY });
    expect(out).toEqual({
      problem:
        "Designs are drawn for plots of 8 tiles, and this world's are 10. Send a map or lists instead.",
    });
  });
});

describe("designs (RFC 0032)", () => {
  it("build whole in every material and turn, free by default, with a hearth at the center and no notes", () => {
    const failures: string[] = [];
    const turnsOf = (d: (typeof DESIGNS)[number]) =>
      d.options.walls.flatMap((walls) =>
        d.options.windows.flatMap((windows) =>
          d.options.path.flatMap((path) =>
            DESIGN_TURNS.map((turn) => ({ walls, windows, path, turn })),
          ),
        ),
      );
    for (const design of DESIGNS) {
      const all = [{}, ...turnsOf(design)];
      for (const choices of all) {
        const { state, ok } = world();
        // The hearth where build_starter_home and SKILL.md put it: the plot's center.
        const center = { x: 2 * S + 3, y: 1 * S + 3 };
        Object.assign(state.residents.wren ?? {}, center);
        ok("wren", { type: "set_hearth", ...center });
        Object.assign(state.residents.wren ?? {}, { x: 0, y: 0 });
        const out = expand(state, { design: design.id, ...choices });
        const label = `${design.id} ${JSON.stringify(choices)}`;
        if ("problem" in out) {
          failures.push(`${label}: ${out.problem}`);
          continue;
        }
        const prepared = prepare(state, { actor: "wren", command: out.command });
        if (!prepared.ok || !prepared.plan) {
          failures.push(`${label}: refused ${prepared.ok ? "" : prepared.rejection.code}`);
          continue;
        }
        if (prepared.plan.skipped.length > 0) failures.push(`${label}: skipped some`);
        if (Object.keys(choices).length === 0 && prepared.plan.changes.length > 0) {
          failures.push(`${label}: costs something by default`);
        }
        const notes = designNotes(state, 2, 1, prepared.plan).map((n) => n.code);
        if (notes.length > 0) failures.push(`${label}: ${notes.join(", ")}`);
      }
    }
    expect(failures).toEqual([]);
  });

  it("are listed with their maps in the materials they use by default, and walls only of building blocks", () => {
    const { designs } = designViews();
    for (const d of designs) {
      for (const wall of [...d.options.walls, ...d.options.windows]) {
        expect(BUILDING_BLOCKS).toContain(wall);
      }
      expect(d.map.floors[0]?.blocks[3]?.[3]).toBe("h");
    }
    expect(designs.find((d) => d.id === "hill_house")?.map.floors[0]?.ground[5]).toBe(".,,,,,,.");
  });

  it("stand on the lines between tiles, and the hut is the starter hut of lines (RFC 0050)", () => {
    const { designs } = designViews();
    for (const d of designs) {
      expect(d.map.floors[0]?.edges, d.id).toHaveLength(17);
      expect(d.map.floors[0]?.blocks.join(""), d.id).not.toMatch(/[WG+]/);
    }
    // The cafe stands in the plot's corner, so its room moves one tile in off the border.
    expect(designs.find((d) => d.id === "cafe")?.map.floors[0]?.edges?.slice(0, 3)).toEqual([
      "+ + + + + + + + +",
      " . . . . . . . . ",
      "+ +W+W+W+W+W+ + +",
    ]);
    // Built, the hut is the starter hut of lines, line for line.
    const { state, ok } = world();
    ok(TOWN_ACTOR, { type: "starter_edges" });
    const out = expand(state, { design: "hut" });
    if ("problem" in out) throw new Error(out.problem);
    expect(out.command.blocks).toBeUndefined();
    ok("wren", out.command);
    ok("ivy", { type: "join", name: "Ivy", kind: "agent" });
    ok("ivy", { type: "settle", px: 3, py: 1 });
    ok("ivy", { type: "build_starter_home" });
    expect(plotPlan(state, 2, 1)?.edges).toHaveLength(20);
    expect(plotPlan(state, 2, 1)?.edges).toEqual(plotPlan(state, 3, 1)?.edges);
    // A picture of the hut's map reads the same lines out of its grid.
    const hut = designs.find((d) => d.id === "hut")?.map;
    if (!hut) throw new Error("no hut");
    const key = (e: { x: number; y: number; side: string; block: string }) =>
      `${e.x},${e.y},${e.side},${e.block}`;
    expect(mapEdges(hut, 8).map(key).sort()).toEqual(
      (plotPlan(state, 3, 1)?.edges ?? []).map(key).sort(),
    );
  });
});
