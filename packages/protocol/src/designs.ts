import {
  BLOCK_KINDS,
  type BlockKind,
  type GroundKind,
  MAP_BLOCKS,
  MAP_GROUND,
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
 * `design.test.ts` builds every design in every material and turn on an empty plot with a hearth
 * there: nothing is skipped and the notes are empty.
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

/** Swap every `from` for `to` in a grid. */
const swapped = (rows: readonly string[], from: string, to: string) =>
  rows.map((r) => r.split(from).join(to));

/** A kind's character in a map, from the fixed table. */
const charOf = (table: Record<string, string>, kind: string) =>
  Object.entries(table).find(([, k]) => k === kind)?.[0];

/** A design with its materials chosen and its turn, as a map of the ground floor, or why not. */
export function designToPlan(
  design: Design,
  choices: DesignChoices & { turn?: DesignTurn | undefined },
): { map: MapInput } | { problem: string } {
  let blocks = [...design.blocks];
  let ground = [...design.ground];
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
  blocks = swapped(swapped(swapped(blocks, "G", "\0"), "W", walls), "\0", windows);
  ground = swapped(ground, ":", path);
  const turns = DESIGN_TURNS.indexOf(choices.turn ?? 0);
  return {
    map: { floors: [{ floor: 0, blocks: turned(blocks, turns), ground: turned(ground, turns) }] },
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
    "The design on an 8-tile plot, its north-west corner at (0, 0). `h` marks the plot's center, where the hearth goes.",
  ),
});
export type DesignView = z.infer<typeof DesignView>;
export const DesignsResponse = z.object({ designs: z.array(DesignView) });
export type DesignsResponse = z.infer<typeof DesignsResponse>;

/** Every design as the API lists it. */
export function designViews(): DesignsResponse {
  return {
    designs: DESIGNS.map((d) => {
      const drawn = designToPlan(d, {});
      if ("problem" in drawn) throw new Error(`${d.id}: ${drawn.problem}`);
      const [floor] = drawn.map.floors;
      return {
        id: d.id,
        name: d.name,
        about: d.about,
        options: {
          walls: [...d.options.walls],
          windows: [...d.options.windows],
          path: [...d.options.path],
        },
        floors: 0,
        map: { floors: [{ floor: 0, blocks: floor?.blocks ?? [], ground: floor?.ground ?? [] }] },
      };
    }),
  };
}
