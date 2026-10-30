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
import { mapToPlan } from "./maps";
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
  return buildCommand(parsed, { size: S, now });
}

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
    // A digit is a block only through the legend, and never ground.
    expect(problem({ floors: [{ blocks: [...rows(7), "1......."] }] })).toMatch(/isn't a block/);
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
      for (const choices of [{}, ...turnsOf(design)]) {
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
});
