import { MATERIAL_KINDS } from "./catalog";
import { refuse } from "./check";
import { tileKey } from "./keys";
import { tileListedProblem } from "./plot-market";
import {
  type BlockKind,
  BUILDING_BLOCKS,
  type FloorLayer,
  type Rejection,
  type ResidentId,
  type Side,
  type WorldState,
} from "./types";
import { isWay } from "./ways";
import { canBuildOn, inBounds, plotAtTile } from "./world";

/**
 * Walls between tiles (RFC 0050): a wall, a window, a hedge or a door standing on the line between
 * two tiles that share a side, taking no floor from either. Each tile owns the line on its north
 * side and the line on its west side, so every line has one key: `edgeKey(x, y, "n" | "w")`. An
 * action may name any side of a tile; `edgeOf` turns `s` and `e` into the neighbour's `n` and `w`
 * before anything is checked, and events carry only that form.
 *
 * Edges live in `state.edges` on the ground floor and in a floor's own `edges` above it, absent
 * until the first one, so a world without them walks, builds and hashes exactly as it did.
 * Readers go through `edgeAt` and `edgesOn`; nothing else reaches into those records.
 */

/** The two sides a line is keyed by. */
export type EdgeSide = "n" | "w";

/** What can stand on a line between tiles: every wall and window kind, a hedge, and a door. */
export const EDGE_KINDS: readonly BlockKind[] = [...BUILDING_BLOCKS, ...MATERIAL_KINDS, "door"];

export const isEdgeKind = (block: unknown): block is BlockKind =>
  typeof block === "string" && (EDGE_KINDS as readonly string[]).includes(block);

/** The line on `side` of (x, y), as its owning tile and `n` or `w`. */
export function edgeOf(x: number, y: number, side: Side): { x: number; y: number; side: EdgeSide } {
  if (side === "s") return { x, y: y + 1, side: "n" };
  if (side === "e") return { x: x + 1, y, side: "w" };
  return { x, y, side };
}

/** The key of the line on `side` of (x, y). */
export const edgeKey = (x: number, y: number, side: Side): string => {
  const e = edgeOf(x, y, side);
  return `${tileKey(e.x, e.y)},${e.side}`;
};

/** The tile, side and key a stored edge key names. */
export function parseEdgeKey(key: string): { x: number; y: number; side: EdgeSide } {
  const [x, y, side] = key.split(",");
  return { x: Number(x), y: Number(y), side: side as EdgeSide };
}

/** The two tiles a line runs between: north then south, or west then east. */
export function edgeTiles(
  x: number,
  y: number,
  side: EdgeSide,
): [{ x: number; y: number }, { x: number; y: number }] {
  return side === "n"
    ? [
        { x, y: y - 1 },
        { x, y },
      ]
    : [
        { x: x - 1, y },
        { x, y },
      ];
}

const NO_EDGES: Readonly<Record<string, BlockKind>> = Object.freeze({});

/** The edges on one floor, keyed by `edgeKey`: the ground floor's for 0. */
export function edgesOn(state: WorldState, floor: number): Readonly<Record<string, BlockKind>> {
  if (floor === 0) return state.edges ?? NO_EDGES;
  return (state.floors?.[String(floor)] as FloorLayer | undefined)?.edges ?? NO_EDGES;
}

/** What stands on the line on `side` of (x, y) on `floor`, if anything. */
export const edgeAt = (
  state: WorldState,
  x: number,
  y: number,
  side: Side,
  floor = 0,
): BlockKind | undefined => edgesOn(state, floor)[edgeKey(x, y, side)];

/** Whether an edge stops a walker crossing it: everything but a door. */
export const edgeBlocks = (block: BlockKind | undefined): boolean =>
  block !== undefined && block !== "door";

/** Whether a world has any edge at all, on any floor. Walking reads edges only when it does. */
export function hasEdges(state: WorldState): boolean {
  if (state.edges) return true;
  return Object.values(state.floors ?? {}).some((layer) => layer.edges !== undefined);
}

/** The edges on one floor, ready to write: the record, made if it was absent. */
export function edgesFor(state: WorldState, floor: number): Record<string, BlockKind> {
  if (floor === 0) {
    state.edges ??= {};
    return state.edges;
  }
  const layer = state.floors?.[String(floor)];
  if (!layer) throw new Error(`floor ${floor} has no layer`);
  layer.edges ??= {};
  return layer.edges;
}

/** Drop a floor's edge record once it's empty, so a world with none hashes as it did. */
export function tidyEdges(state: WorldState, floor: number) {
  if (floor === 0) {
    if (state.edges && Object.keys(state.edges).length === 0) delete state.edges;
    return;
  }
  const layer = state.floors?.[String(floor)];
  if (layer?.edges && Object.keys(layer.edges).length === 0) delete layer.edges;
}

/**
 * Why an edge can't stand on the line on `side` of (x, y) on `floor` for `actor`, or null. Both
 * tiles are in the world, on plots `actor` can build on (one plot, or two of one household), not
 * listed, and not both public ways. Upstairs, at least one of its tiles has flooring. A door stays
 * on the ground floor. What it costs is `place`'s own check.
 */
export function edgePlaceProblem(
  state: WorldState,
  actor: ResidentId,
  x: number,
  y: number,
  side: Side,
  floor: number,
  block: BlockKind,
  ground: (x: number, y: number) => boolean,
): Rejection | null {
  if (!isEdgeKind(block)) {
    return refuse(
      "unknown_item",
      "Only walls, windows, hedges and doors stand between tiles: wood, stone, glass, leaf, a material you made, or a door.",
    );
  }
  if (block === "door" && floor !== 0) {
    return refuse("ground_floor_only", "Doors stay on the ground floor.");
  }
  const e = edgeOf(x, y, side);
  const [a, b] = edgeTiles(e.x, e.y, e.side);
  if (!inBounds(state.config, a.x, a.y) || !inBounds(state.config, b.x, b.y)) {
    return refuse("out_of_bounds", "That line is the edge of the world.");
  }
  if (
    !canBuildOn(plotAtTile(state, a.x, a.y), actor) ||
    !canBuildOn(plotAtTile(state, b.x, b.y), actor)
  ) {
    return refuse(
      "plot_border",
      "That line is your plot's border, with ground that isn't yours on the other side. Put the wall one tile in.",
    );
  }
  const listed = tileListedProblem(state, a.x, a.y) ?? tileListedProblem(state, b.x, b.y);
  if (listed) return listed;
  if (floor === 0 && isWay(state, a.x, a.y) && isWay(state, b.x, b.y)) {
    return refuse(
      "public_ground",
      "That line runs across a public way, which everyone walks to town. Leave it open.",
    );
  }
  if (floor > 0 && !ground(a.x, a.y) && !ground(b.x, b.y)) {
    return refuse(
      "nothing_under",
      "A wall upstairs stands on flooring. Lay flooring on one side of that line first.",
    );
  }
  if (edgesOn(state, floor)[edgeKey(x, y, side)] !== undefined) {
    return refuse("tile_occupied", "A wall already stands on that line.");
  }
  return null;
}
