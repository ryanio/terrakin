import { refuse } from "./check";
import { edgeTiles, parseEdgeKey } from "./edges";
import { tileKey } from "./keys";
import { isStreet, onLand } from "./lands";
import { tileListedProblem } from "./plot-market";
import type { Command, Rejection, WorldEvent, WorldState } from "./types";
import { inBounds, isTownSquare, plotOf } from "./world";

/**
 * Public ways ([RFC 0046](../../../docs/rfcs/0046-streets.md), Option 1, laid by town rule): tiles
 * of plots, or of free slots, that hold no block on the ground floor, so nobody can wall a way to
 * town. The plot stays its owner's: paths and flooring are fine, and building upstairs over a way
 * makes a covered passage. A door and the seats you walk onto would pass walkers, but a door may
 * one day lock and stairs make a stairwell, so a way holds no block at all.
 *
 * Which tiles are ways is the server's to plan (`packages/server/src/way-plan.ts`) and arrives in
 * the logged `open_way`, so a better plan never changes how a logged way replays. What a way is
 * (no block, open ground for a plot's way out) is the rule here, in `place`, `build`,
 * `build_starter_home`, and `openings.ts`.
 *
 * A way opens only onto empty tiles: the town first clears what stands there with `clear_block`,
 * which gives each block back to the plot's owner, and rebuilds a home it cut through with
 * `rebuild_home`, which builds as that owner would. So nothing anyone owns is lost and no plot is
 * left in a state its owner couldn't have left it in.
 */

type Mutation = () => WorldEvent[];

/** Every number here. */
export const WAYS = {
  /** Tiles one `open_way` or `close_way` may carry, so one input can't be unbounded. */
  tilesMax: 1000,
} as const;

/** Whether a tile is a public way. */
export function isWay(state: Pick<WorldState, "ways">, x: number, y: number): boolean {
  return state.ways?.[tileKey(x, y)] === true;
}

/**
 * Why a block can't go on this tile because it's a public way, or null. Only the ground floor:
 * upstairs over a way is the owner's to build.
 */
export function wayProblem(
  state: Pick<WorldState, "ways">,
  x: number,
  y: number,
  floor = 0,
): Rejection | null {
  if (floor !== 0 || !isWay(state, x, y)) return null;
  return refuse(
    "public_ground",
    `${x},${y} is a public way, so it holds no block: everyone walks it to town. Paths and flooring are fine there, and so is building upstairs over it.`,
  );
}

/** Tiles as sorted, whole, distinct `[x, y]` pairs, or null. */
function tilesOf(list: unknown): [number, number][] | null {
  if (!Array.isArray(list) || list.length < 1 || list.length > WAYS.tilesMax) return null;
  const out: [number, number][] = [];
  const seen = new Set<string>();
  for (const pair of list) {
    if (!Array.isArray(pair) || pair.length !== 2) return null;
    const [x, y] = pair as [unknown, unknown];
    if (!Number.isInteger(x) || !Number.isInteger(y)) return null;
    const key = tileKey(x as number, y as number);
    if (seen.has(key)) return null;
    seen.add(key);
    out.push([x as number, y as number]);
  }
  const sorted = [...out].sort((a, b) => a[1] - b[1] || a[0] - b[0]);
  if (sorted.some((p, i) => p[0] !== out[i]?.[0] || p[1] !== out[i]?.[1])) return null;
  return out;
}

/**
 * `open_way {tiles}`, which only TOWN_ACTOR sends. Refused whole, changing nothing, unless every
 * tile is in the world, on land, on a plot slot that is neither a town square nor a land's street
 * (both are everyone's already), not a way yet, with no block on the ground floor and no hearth,
 * and on no plot for sale.
 */
export function checkOpenWay(
  state: WorldState,
  command: Extract<Command, { type: "open_way" }>,
): Mutation | Rejection {
  const tiles = tilesOf(command.tiles);
  if (!tiles) {
    return refuse(
      "server_only",
      `A way's tiles are 1 to ${WAYS.tilesMax} whole [x, y] pairs, north to south, then west to east.`,
    );
  }
  const hearths = new Set(
    Object.values(state.residents).flatMap((r) =>
      r.hearth ? [tileKey(r.hearth.x, r.hearth.y)] : [],
    ),
  );
  for (const [x, y] of tiles) {
    if (!inBounds(state.config, x, y))
      return refuse("out_of_bounds", `${x},${y} is outside the world.`);
    const { px, py } = plotOf(state.config, x, y);
    if (!onLand(state, px, py)) return refuse("server_only", `${x},${y} is open water.`);
    if (isTownSquare(state, px, py) || isStreet(state, px, py)) {
      return refuse(
        "server_only",
        `${x},${y} is a town square or a street, which is everyone's already.`,
      );
    }
    if (isWay(state, x, y)) return refuse("already_set", `${x},${y} is a way already.`);
    const key = tileKey(x, y);
    if (state.blocks[key] !== undefined) {
      return refuse("tile_occupied", `${x},${y} has a block on it. Clear it first.`);
    }
    if (hearths.has(key)) return refuse("tile_occupied", `${x},${y} is someone's hearth.`);
    const listed = tileListedProblem(state, x, y);
    if (listed) return listed;
  }
  // A way never runs across a wall between tiles (RFC 0050): no line may stand between two tiles
  // that would both be ways. A world without walls between tiles has none to check.
  if (state.edges) {
    const way = new Set([
      ...tiles.map(([x, y]) => tileKey(x, y)),
      ...Object.keys(state.ways ?? {}),
    ]);
    for (const key of Object.keys(state.edges)) {
      const { x, y, side } = parseEdgeKey(key);
      const [a, b] = edgeTiles(x, y, side);
      if (way.has(tileKey(a.x, a.y)) && way.has(tileKey(b.x, b.y))) {
        return refuse("tile_occupied", `A wall stands between ${a.x},${a.y} and ${b.x},${b.y}.`);
      }
    }
  }
  return () => {
    state.ways ??= {};
    for (const [x, y] of tiles) state.ways[tileKey(x, y)] = true;
    return [{ type: "ways_opened", tiles }];
  };
}

/** `close_way {tiles}`, which only TOWN_ACTOR sends: refused whole unless every tile is a way. */
export function checkCloseWay(
  state: WorldState,
  command: Extract<Command, { type: "close_way" }>,
): Mutation | Rejection {
  const tiles = tilesOf(command.tiles);
  if (!tiles) {
    return refuse(
      "server_only",
      `A way's tiles are 1 to ${WAYS.tilesMax} whole [x, y] pairs, north to south, then west to east.`,
    );
  }
  for (const [x, y] of tiles) {
    if (!isWay(state, x, y)) return refuse("server_only", `${x},${y} isn't a way.`);
  }
  return () => {
    const ways = state.ways ?? {};
    for (const [x, y] of tiles) delete ways[tileKey(x, y)];
    if (Object.keys(ways).length === 0) delete state.ways;
    return [{ type: "ways_closed", tiles }];
  };
}
