import {
  BLOCK_KINDS,
  type BlockKind,
  type GroundKind,
  MAP_BLOCKS,
  MAP_EDGE_MARKS,
  MAP_GROUND,
  MAP_MARKS,
} from "@terrakin/sim";
import { z } from "zod";
import { DESIGN_IDS, DESIGN_TURNS, type DesignId, type DesignTurn } from "./design-ids";
import type { MapInput } from "./maps";
import { GroundKind as GroundKindSchema, PlotMapView } from "./schemas";

/**
 * Designs (RFC 0032): whole homes drawn as maps, with materials to choose and a turn. A design is
 * expanded into a `build`'s lists before anything is logged (`designToPlan`, then `mapToPlan`), so
 * the log holds the lists and editing a design here never changes how an old log replays.
 *
 * Every design is drawn for an 8-tile plot. `W` is the walls, `G` the windows, and `:` the path,
 * each swapped for the material chosen; every other character is fixed, `+` among them, the door
 * in a doorway (decision 0349). The hill house's front is open onto its deck, so it has none. Each leaves the plot's
 * middle four tiles open with the path through them, so a hearth at the plot's center, where
 * `build_starter_home` and SKILL.md put it, sits on the path out whichever way the design turns.
 * `maps.test.ts` builds every design in every material and turn on an empty plot with a hearth
 * there: nothing is skipped and the notes are empty.
 *
 * A design is drawn with its walls on tiles, and built with them on the lines between tiles (RFC
 * 0050, `roomyGrids`), so the room keeps the floor they took.
 */

/** The materials a design lets you choose, first the one it uses when you don't. */
export interface DesignOptions {
  walls: readonly BlockKind[];
  windows: readonly BlockKind[];
  path: readonly GroundKind[];
}
export type DesignChoices = {
  walls?: BlockKind | undefined;
  windows?: BlockKind | undefined;
  path?: GroundKind | undefined;
};

export interface Design {
  id: DesignId;
  name: string;
  about: string;
  options: DesignOptions;
  /** The ground floor, north row first. `h` marks the plot's center, where the hearth goes. */
  blocks: readonly string[];
  ground: readonly string[];
}

/** Tiles per side of the plot every design is drawn for. */
export const DESIGN_SIZE = 8;

const WALLS: readonly BlockKind[] = ["wood", "stone"];
const WINDOWS: readonly BlockKind[] = ["glass", "leaf"];
const PATHS: readonly GroundKind[] = ["dirt", "moss", "sand", "stepping_stones"];

export const DESIGNS: readonly Design[] = [
  {
    id: "hut",
    name: "Hut",
    about: "The starter home: a square hut with windows east and west, a door, and a path from it.",
    options: { walls: WALLS, windows: WINDOWS, path: PATHS },
    blocks: [
      "........",
      ".WWWWW..",
      ".W...W..",
      ".G.h.G..",
      ".W...W..",
      ".WW+WW..",
      "........",
      "........",
    ],
    ground: [
      "........",
      "........",
      "........",
      "...::...",
      "...::...",
      "...:....",
      "...:....",
      "...:....",
    ],
  },
  {
    id: "greenhouse",
    name: "Greenhouse",
    about:
      "A cottage with a glass north wall and planters along the east side, on a strip of moss.",
    options: { walls: WALLS, windows: WINDOWS, path: PATHS },
    blocks: [
      "........",
      ".GGGGG..",
      ".W...W.p",
      ".W.h.W..",
      ".W...W.p",
      ".WW+WW..",
      ".......p",
      "........",
    ],
    ground: [
      "........",
      "........",
      "......m.",
      "...::.m.",
      "...::.m.",
      "...:..m.",
      "...:..m.",
      "...:....",
    ],
  },
  {
    id: "workshop",
    name: "Workshop",
    about: "A wide workshop with a workbench by the wall, and a yard between two hedges.",
    options: { walls: WALLS, windows: WINDOWS, path: PATHS },
    blocks: [
      "........",
      ".WWWWWW.",
      ".W....W.",
      ".G.h..G.",
      ".Wb...W.",
      ".WWW+WW.",
      ".L....L.",
      ".L....L.",
    ],
    ground: [
      "........",
      "........",
      "........",
      "...::...",
      "...::...",
      "....:...",
      "....:...",
      "....:...",
    ],
  },
  {
    id: "cafe",
    name: "Corner cafe",
    about:
      "A cafe in the plot's north-west corner with a kitchen, and a moss terrace with planters.",
    options: { walls: WALLS, windows: WINDOWS, path: PATHS },
    blocks: [
      "WWWWWW..",
      "W....W.p",
      "G.k..G..",
      "W..h.W.p",
      "G....G..",
      "WWWW+W..",
      "........",
      "........",
    ],
    ground: [
      "......m.",
      "......m.",
      "......m.",
      "...::.m.",
      "...::.m.",
      "....:.m.",
      "....:...",
      "....:...",
    ],
  },
  {
    id: "post_stop",
    name: "Post stop",
    about: "A narrow post stop on a path that crosses the plot, with a stand for parcels.",
    options: { walls: WALLS, windows: WINDOWS, path: PATHS },
    blocks: [
      "........",
      "..WWWW..",
      "..G..G..",
      "..Wh.W..",
      "..W..W..",
      "..WW+Wd.",
      "........",
      "........",
    ],
    ground: [
      "........",
      "........",
      "........",
      "...::...",
      "...::...",
      "....:...",
      "::::::::",
      "........",
    ],
  },
  {
    id: "library",
    name: "Library",
    about:
      "A long reading hall with windows down both sides, two reading stands, and leaves to sit on.",
    options: { walls: WALLS, windows: WINDOWS, path: PATHS },
    blocks: [
      "........",
      ".WGWWGW.",
      ".Wd..dW.",
      ".G.h..G.",
      ".W....W.",
      ".WGW+GW.",
      "........",
      "........",
    ],
    ground: [
      "........",
      "........",
      "........",
      "...::...",
      "...::...",
      "....:...",
      ".ll.:...",
      ".ll.:...",
    ],
  },
  {
    id: "lookout",
    name: "Lookout",
    about: "A small tower of windows for watching the world, with a row of hedges to the west.",
    options: { walls: WALLS, windows: WINDOWS, path: PATHS },
    blocks: [
      "........",
      "L.WGGW..",
      "..G..G..",
      "L.Gh.G..",
      "..G..G..",
      "L.WW+W..",
      "........",
      "........",
    ],
    ground: [
      "........",
      "........",
      "........",
      "...::...",
      "...::...",
      "....:...",
      "....:...",
      "....:...",
    ],
  },
  {
    id: "hill_house",
    name: "Hill house",
    about:
      "A house on the north side, open to a wide deck to the south with a planter at each end.",
    options: { walls: WALLS, windows: WINDOWS, path: ["sand", "moss", "planks"] },
    blocks: [
      "........",
      ".WWWWWW.",
      ".G....G.",
      ".W.h..W.",
      ".WW..WW.",
      "........",
      ".p....p.",
      "........",
    ],
    ground: [
      "........",
      "........",
      "........",
      "...::...",
      "...::...",
      ".::::::.",
      ".::::::.",
      "...::...",
    ],
  },
  {
    id: "atelier",
    name: "Atelier",
    about:
      "A painter's studio with a wall of windows to the north for the light, and two display stands.",
    options: { walls: WALLS, windows: WINDOWS, path: PATHS },
    blocks: [
      "........",
      ".GGGGGG.",
      ".Gd..dW.",
      ".G.h..W.",
      ".W....W.",
      ".WW+WWW.",
      "........",
      "........",
    ],
    ground: [
      "........",
      "........",
      "........",
      "...::...",
      "...::...",
      "...:....",
      "...:....",
      "...:....",
    ],
  },
];

/** Turn a grid clockwise by a quarter, `turns` times. */
function turned(rows: readonly string[], turns: number): string[] {
  let grid = rows.map((r) => [...r]);
  for (let i = 0; i < turns; i++) {
    const n = grid.length;
    grid = grid.map((_, y) => grid.map((__, x) => grid[n - 1 - x]?.[y] ?? "."));
  }
  return grid.map((r) => r.join(""));
}

/** A design's placeholders for its walls, its windows, and its door. */
const WALLISH: ReadonlySet<string> = new Set(["W", "G", "+"]);

/**
 * A design as it builds (RFC 0050): its blocks with the walls taken off their tiles, and an
 * `edges` grid with them on lines instead, still in placeholders (`W`, `G`, and `D` for the door).
 * The room is the box its walls stand in, and each line round the box takes the kind of the wall
 * tile it runs along: a tile with no wall leaves its line open, as the hill house's front is. A
 * side of the box on the plot's border moves one tile in, since a line on the border would face a
 * neighbor's ground, and its lines take the kinds of that outer row. Walls inside the box stay
 * blocks.
 */
function roomyGrids(design: Design): { blocks: string[]; edges: string[] } {
  const S = design.blocks.length;
  const at = (x: number, y: number) => design.blocks[y]?.[x] ?? MAP_MARKS.keep;
  let [x0, y0, x1, y1] = [S, S, -1, -1];
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      if (!WALLISH.has(at(x, y))) continue;
      [x0, y0, x1, y1] = [Math.min(x0, x), Math.min(y0, y), Math.max(x1, x), Math.max(y1, y)];
    }
  }
  const ring = (x: number, y: number) => x === x0 || x === x1 || y === y0 || y === y1;
  const blocks = design.blocks.map((row, y) =>
    [...row].map((c, x) => (WALLISH.has(c) && ring(x, y) ? MAP_MARKS.keep : c)).join(""),
  );
  // The room, inside the plot's border.
  const room = {
    x0: x0 === 0 ? 1 : x0,
    y0: y0 === 0 ? 1 : y0,
    x1: x1 === S - 1 ? S - 2 : x1,
    y1: y1 === S - 1 ? S - 2 : y1,
  };
  const span = 2 * S + 1;
  const grid = Array.from({ length: span }, (_, r) =>
    Array.from({ length: span }, (__, c) => {
      if (r % 2 === 0 && c % 2 === 0) return MAP_EDGE_MARKS.corner;
      if (r % 2 === 1 && c % 2 === 1) return blocks[(r - 1) / 2]?.[(c - 1) / 2] ?? MAP_MARKS.keep;
      return MAP_EDGE_MARKS.none;
    }),
  );
  const line = (c: string) => (c === "+" ? MAP_EDGE_MARKS.door : WALLISH.has(c) ? c : undefined);
  const put = (r: number, c: number, from: string) => {
    const kind = line(from);
    const row = grid[r];
    if (kind !== undefined && row) row[c] = kind;
  };
  for (let x = room.x0; x <= room.x1; x++) {
    put(2 * room.y0, 2 * x + 1, at(x, y0));
    put(2 * (room.y1 + 1), 2 * x + 1, at(x, y1));
  }
  for (let y = room.y0; y <= room.y1; y++) {
    put(2 * y + 1, 2 * room.x0, at(x0, y));
    put(2 * y + 1, 2 * (room.x1 + 1), at(x1, y));
  }
  return { blocks, edges: grid.map((r) => r.join("")) };
}

/** Swap every `from` for `to` in a grid. */
const swapped = (rows: readonly string[], from: string, to: string) =>
  rows.map((r) => r.split(from).join(to));

/** A kind's character in a map, from the fixed table. */
const charOf = (table: Record<string, string>, kind: string) =>
  Object.entries(table).find(([, k]) => k === kind)?.[0];

/**
 * A design with its materials chosen and its turn, as a map of the ground floor, or why not. Its
 * walls stand on the lines between tiles (`roomyGrids`), in the map's `edges` grid.
 */
export function designToPlan(
  design: Design,
  choices: DesignChoices & { turn?: DesignTurn | undefined },
): { map: MapInput } | { problem: string } {
  return drawDesign(design, choices, roomyGrids(design));
}

/**
 * A design's ground floor as it is drawn, its walls on tiles, in its own materials and turned:
 * where its door stands and which way it opens, which are the same once its walls move onto lines.
 */
export function designOnTiles(design: Design, turn: DesignTurn = 0): string[] {
  const drawn = drawDesign(design, { turn }, { blocks: [...design.blocks] });
  return "problem" in drawn ? [] : (drawn.map.floors[0]?.blocks ?? []);
}

function drawDesign(
  design: Design,
  choices: DesignChoices & { turn?: DesignTurn | undefined },
  grids: { blocks: string[]; edges?: string[] },
): { map: MapInput } | { problem: string } {
  for (const part of ["walls", "windows", "path"] as const) {
    const choice = choices[part];
    if (choice === undefined) continue;
    const allowed = design.options[part] as readonly string[];
    if (!allowed.includes(choice)) {
      return {
        problem: `The ${design.name.toLowerCase()} takes ${part}: ${allowed.join(", ")}.`,
      };
    }
  }
  const walls = charOf(MAP_BLOCKS, choices.walls ?? (design.options.walls[0] as BlockKind));
  const windows = charOf(MAP_BLOCKS, choices.windows ?? (design.options.windows[0] as BlockKind));
  const path = charOf(MAP_GROUND, choices.path ?? (design.options.path[0] as GroundKind));
  if (walls === undefined || windows === undefined || path === undefined) {
    return { problem: "A design's walls and windows are building blocks." };
  }
  // The windows aside first, so walls of glass don't become windows.
  const dressed = (rows: string[]) =>
    swapped(swapped(swapped(rows, "G", "\0"), "W", walls), "\0", windows);
  const turns = DESIGN_TURNS.indexOf(choices.turn ?? 0);
  const floor = {
    floor: 0,
    blocks: turned(dressed(grids.blocks), turns),
    ground: turned(swapped([...design.ground], ":", path), turns),
  };
  const { edges } = grids;
  return {
    map: { floors: [edges ? { ...floor, edges: turned(dressed(edges), turns) } : floor] },
  };
}

/** A design as `GET /v1/designs` lists it: its map in the materials it uses when you choose none. */
export const DesignView = z.object({
  id: z.enum(DESIGN_IDS).describe("Its name for `build`'s `design`."),
  name: z.string(),
  about: z.string(),
  options: z
    .object({
      walls: z.array(z.enum(BLOCK_KINDS)),
      windows: z.array(z.enum(BLOCK_KINDS)),
      path: z.array(GroundKindSchema),
    })
    .describe(
      "What `build` takes as `walls`, `windows`, and `path` for it, each first by default.",
    ),
  floors: z
    .number()
    .int()
    .describe("How many floors above the ground floor it needs: 0 for every design so far."),
  map: PlotMapView.describe(
    "The design on an 8-tile plot, its north-west corner at (0, 0). `h` marks the plot's center, where the hearth goes. Its walls stand on the lines between tiles, drawn in the floor's `edges` grid, so the room keeps every tile.",
  ),
});
export type DesignView = z.infer<typeof DesignView>;
export const DesignsResponse = z.object({ designs: z.array(DesignView) });
export type DesignsResponse = z.infer<typeof DesignsResponse>;

/** A design's map as the API draws it, in the materials it uses by default. */
function viewMap(d: Design): PlotMapView {
  const drawn = designToPlan(d, {});
  if ("problem" in drawn) throw new Error(`${d.id}: ${drawn.problem}`);
  const [floor] = drawn.map.floors;
  return {
    floors: [
      {
        floor: 0,
        blocks: floor?.blocks ?? [],
        ground: floor?.ground ?? [],
        ...(floor?.edges ? { edges: floor.edges } : {}),
      },
    ],
  };
}

/** Every design as the API lists it. */
export function designViews(): DesignsResponse {
  return {
    designs: DESIGNS.map((d) => ({
      id: d.id,
      name: d.name,
      about: d.about,
      options: {
        walls: [...d.options.walls],
        windows: [...d.options.windows],
        path: [...d.options.path],
      },
      floors: 0,
      map: viewMap(d),
    })),
  };
}
