import type { BuildPlan } from "./build";
import { type EdgeSide, edgeAt, edgeKey } from "./edges";
import { blocksOn, groundOn, standingFloor } from "./floors";
import type { GroundKind } from "./ground";
import { plotKey, tileKey } from "./keys";
import type { BlockKind, Tile, WorldState } from "./types";
import { plotInBounds } from "./world";

/**
 * Maps (RFC 0032): a plot drawn in characters, one row of text per row of tiles, a grid for its
 * blocks and a grid for its paths and flooring on each floor. The server writes them with
 * `plotMap`, and the protocol reads them back into a plan (`mapToPlan`), so the characters are the
 * same everywhere. A map is a drawing: it reads and writes nothing in the world.
 */

/** The fixed characters for blocks. Walls are capitals so they stand out. */
export const MAP_BLOCKS = {
  W: "wood",
  S: "stone",
  G: "glass",
  L: "leaf",
  p: "planter",
  k: "kitchen",
  b: "workbench",
  d: "pedestal",
  "~": "pond",
  "^": "stairs",
  "+": "door",
} as const satisfies Record<string, BlockKind>;

/** Each path and flooring's character: every kind has one, so a new kind won't compile without it. */
const GROUND_CHAR: Readonly<Record<GroundKind, string>> = {
  dirt: ":",
  sand: ",",
  moss: "m",
  leaves: "l",
  cobble: "c",
  stepping_stones: "o",
  brick: "r",
  planks: "=",
  flower_bed: "f",
  rug: "u",
  carpet: "a",
  checker_tiles: "#",
  parquet: "z",
  terracotta: "t",
  woven_mat: "v",
  stone_tiles: "q",
};

/** The fixed characters for paths and flooring. */
export const MAP_GROUND: Readonly<Record<string, GroundKind>> = Object.fromEntries(
  Object.entries(GROUND_CHAR).map(([kind, char]) => [char, kind as GroundKind]),
);

/**
 * What the other characters mean. `.` leaves a tile as it is and `x` clears it. The server writes
 * `h` for a hearth, `@` for someone standing on an open tile, and `*` for a kind past the legend's
 * ten; each reads back as `.`.
 */
export const MAP_MARKS = { keep: ".", clear: "x", hearth: "h", standing: "@", more: "*" } as const;

/**
 * The characters of a floor's `edges` grid (RFC 0050) that aren't a block's: `+` at every corner,
 * `D` for a door on a line (since `+` is taken), and a space for a line with nothing on it. A wall
 * or window on a line is its letter from `MAP_BLOCKS`, or a digit from the legend.
 */
export const MAP_EDGE_MARKS = { corner: "+", door: "D", none: " " } as const;

/** Decor and furniture go on digits, `0` to `9`, in a map's own legend. */
export const MAP_LEGEND_MAX = 10;

const BLOCK_CHAR = Object.fromEntries(
  Object.entries(MAP_BLOCKS).map(([char, kind]) => [kind, char]),
) as Partial<Record<BlockKind, string>>;

/**
 * A floor of a map, a row of text per row of tiles, north first. `edges` draws the lines between
 * tiles (RFC 0050), two characters per tile plus one each way: even rows are the lines along the
 * north side of a row of tiles (the last, the plot's south border), and odd rows the lines along
 * the west side of each tile (the last, the east border) with the tile's block character between
 * them. Absent on a floor with no wall on any of the plot's lines.
 */
export interface MapFloor {
  floor: number;
  blocks: string[];
  ground: string[];
  edges?: string[];
}

/** A plot as a map, with a legend for the decor and furniture on it when there is any. */
export interface PlotMap {
  floors: MapFloor[];
  legend?: Record<string, BlockKind>;
}

/**
 * One plot as it stands, or with `plan` as it would leave it, in plan coordinates (from the plot's
 * north-west corner). The map and the notes both read a plot through it, so a dry run's picture and
 * notes are about the plot the plan makes, worked out without changing the world.
 */
export interface PlotTiles {
  px: number;
  py: number;
  size: number;
  /** The ground floor and each floor the plot added, from the ground up. */
  floors: number[];
  block(floor: number, x: number, y: number): BlockKind | undefined;
  ground(floor: number, x: number, y: number): GroundKind | undefined;
  /**
   * What stands on the line on the `n` or `w` side of (x, y) (RFC 0050). `x` and `y` run to `size`
   * for the plot's south and east borders, which are the north and west lines of the tiles past it.
   */
  edge(floor: number, x: number, y: number, side: EdgeSide): BlockKind | undefined;
  /** Hearths on the plot, north to south, then west to east. They're on the ground floor. */
  hearths: Tile[];
  /** Online residents standing on the plot, with their floor. */
  standing: (Tile & { floor: number })[];
}

/** A plot's tiles, as it stands or as `plan` leaves it. Undefined for a plot outside the world. */
export function plotTiles(
  state: WorldState,
  px: number,
  py: number,
  plan?: BuildPlan,
): PlotTiles | undefined {
  const { config } = state;
  if (!plotInBounds(config, px, py)) return undefined;
  const S = config.plotSize;
  const x0 = px * S;
  const y0 = py * S;
  const added = state.plots[plotKey(px, py)]?.floors ?? 0;
  const floors = Array.from({ length: added + 1 }, (_, i) => i);
  // The plan's changes, by floor and world tile key. Null is taken away.
  const blocks = new Map<string, BlockKind | null>();
  const ground = new Map<string, GroundKind | null>();
  const at = (floor: number, x: number, y: number) => `${floor}:${tileKey(x, y)}`;
  for (const t of plan?.removed ?? []) blocks.set(at(t.floor ?? 0, t.x, t.y), null);
  for (const t of plan?.lifted ?? []) ground.set(at(t.floor ?? 0, t.x, t.y), null);
  for (const t of plan?.placed ?? []) blocks.set(at(t.floor ?? 0, t.x, t.y), t.block);
  for (const t of plan?.laid ?? []) ground.set(at(t.floor ?? 0, t.x, t.y), t.ground);
  const edges = new Map<string, BlockKind | null>();
  const line = (floor: number, x: number, y: number, side: EdgeSide) =>
    `${floor}:${edgeKey(x, y, side)}`;
  for (const t of plan?.unwalled ?? []) edges.set(line(t.floor ?? 0, t.x, t.y, t.side), null);
  for (const t of plan?.walled ?? []) edges.set(line(t.floor ?? 0, t.x, t.y, t.side), t.block);
  const onPlot = (t: Tile) => t.x >= x0 && t.x < x0 + S && t.y >= y0 && t.y < y0 + S;
  const order = (a: Tile, b: Tile) => a.y - b.y || a.x - b.x;
  const hearths = new Map<string, Tile>();
  const standing: (Tile & { floor: number })[] = [];
  for (const r of Object.values(state.residents)) {
    const h = r.hearth;
    if (h && onPlot(h)) hearths.set(tileKey(h.x, h.y), { x: h.x - x0, y: h.y - y0 });
    if (r.online && onPlot(r)) {
      standing.push({ x: r.x - x0, y: r.y - y0, floor: standingFloor(r) });
    }
  }
  return {
    px,
    py,
    size: S,
    floors,
    block: (floor, x, y) => {
      const key = at(floor, x0 + x, y0 + y);
      if (blocks.has(key)) return blocks.get(key) ?? undefined;
      return blocksOn(state, floor)[tileKey(x0 + x, y0 + y)];
    },
    ground: (floor, x, y) => {
      const key = at(floor, x0 + x, y0 + y);
      if (ground.has(key)) return ground.get(key) ?? undefined;
      return groundOn(state, floor)[tileKey(x0 + x, y0 + y)];
    },
    edge: (floor, x, y, side) => {
      const key = line(floor, x0 + x, y0 + y, side);
      if (edges.has(key)) return edges.get(key) ?? undefined;
      return edgeAt(state, x0 + x, y0 + y, side, floor);
    },
    hearths: [...hearths.values()].sort(order),
    standing: standing.sort((a, b) => a.floor - b.floor || order(a, b)),
  };
}

/**
 * Every line of a plot on one floor with something on it (RFC 0050), north to south, then west to
 * east, each as a tile and `n` or `w`: the plot's own north and west lines, and its south and east
 * borders, which are the lines of the tiles past it (a `y` or `x` of `size`).
 */
export function plotLines(
  tiles: PlotTiles,
  floor: number,
): { x: number; y: number; side: EdgeSide; block: BlockKind }[] {
  const S = tiles.size;
  const out: { x: number; y: number; side: EdgeSide; block: BlockKind }[] = [];
  for (let y = 0; y <= S; y++) {
    for (let x = 0; x <= S; x++) {
      const n = x < S ? tiles.edge(floor, x, y, "n") : undefined;
      if (n !== undefined) out.push({ x, y, side: "n", block: n });
      const w = y < S ? tiles.edge(floor, x, y, "w") : undefined;
      if (w !== undefined) out.push({ x, y, side: "w", block: w });
    }
  }
  return out;
}

/**
 * Plot (`px`, `py`) as a map, every floor it has, as it stands or as `plan` leaves it. Decor and
 * furniture take digits in the order they first appear, ground floor first, north to south, then
 * west to east, each floor's blocks before its lines. Undefined for a plot outside the world.
 */
export function plotMap(
  state: WorldState,
  px: number,
  py: number,
  plan?: BuildPlan,
): PlotMap | undefined {
  const tiles = plotTiles(state, px, py, plan);
  if (!tiles) return undefined;
  const S = tiles.size;
  const legend: Record<string, BlockKind> = {};
  const digits = new Map<BlockKind, string>();
  const blockChar = (kind: BlockKind): string => {
    const fixed = BLOCK_CHAR[kind];
    if (fixed) return fixed;
    const known = digits.get(kind);
    if (known) return known;
    if (digits.size >= MAP_LEGEND_MAX) return MAP_MARKS.more;
    const digit = String(digits.size);
    digits.set(kind, digit);
    legend[digit] = kind;
    return digit;
  };
  const hearths = new Set(tiles.hearths.map((h) => tileKey(h.x, h.y)));
  const standing = new Set(tiles.standing.map((s) => `${s.floor}:${tileKey(s.x, s.y)}`));
  const floors = tiles.floors.map((floor): MapFloor => {
    const blocks: string[] = [];
    const ground: string[] = [];
    for (let y = 0; y < S; y++) {
      let blockRow = "";
      let groundRow = "";
      for (let x = 0; x < S; x++) {
        const block = tiles.block(floor, x, y);
        const key = tileKey(x, y);
        if (block !== undefined) blockRow += blockChar(block);
        else if (floor === 0 && hearths.has(key)) blockRow += MAP_MARKS.hearth;
        else if (standing.has(`${floor}:${key}`)) blockRow += MAP_MARKS.standing;
        else blockRow += MAP_MARKS.keep;
        const g = tiles.ground(floor, x, y);
        groundRow += g === undefined ? MAP_MARKS.keep : GROUND_CHAR[g];
      }
      blocks.push(blockRow);
      ground.push(groundRow);
    }
    if (plotLines(tiles, floor).length === 0) return { floor, blocks, ground };
    const { corner, door, none } = MAP_EDGE_MARKS;
    const lineChar = (kind: BlockKind | undefined) =>
      kind === undefined ? none : kind === "door" ? door : blockChar(kind);
    const edges: string[] = [];
    for (let y = 0; y <= S; y++) {
      let lines = corner;
      for (let x = 0; x < S; x++) lines += lineChar(tiles.edge(floor, x, y, "n")) + corner;
      edges.push(lines);
      if (y === S) break;
      let row = "";
      for (let x = 0; x <= S; x++) {
        row += lineChar(tiles.edge(floor, x, y, "w"));
        if (x < S) row += blocks[y]?.[x] ?? MAP_MARKS.keep;
      }
      edges.push(row);
    }
    return { floor, blocks, ground, edges };
  });
  return digits.size === 0 ? { floors } : { floors, legend };
}
