import { oneTimeSwitch, refuse } from "./check";
import { isEdgeKind } from "./edges";
import type { Rejection, Tile, WorldEvent, WorldState } from "./types";
import { plotOf } from "./world";

/**
 * Two switches that make building on your own plot simpler: reach that covers the whole plot, and
 * walls only on the lines between tiles. Both are logged by the server, so inputs logged before
 * either replay as they were made.
 */

/**
 * `plot_reach`, which only TOWN_ACTOR sends: from now on a building action (`place`, `remove`,
 * `lay`, `lift`, `turn`, `set_hearth`, and what goes on surfaces and walls) reaches every tile of
 * the plot it's on from anywhere on that plot or within `config.reach` tiles of it. Comes once.
 */
export function checkPlotReach(state: WorldState): (() => WorldEvent[]) | Rejection {
  return oneTimeSwitch({
    on: state.plotReach,
    already: "Building already reaches the whole plot.",
    turnOn: () => {
      state.plotReach = true;
    },
    event: { type: "plot_reach_set" },
  });
}

/**
 * Whether `me` reaches `at` for building once `plot_reach` is logged: standing on the plot slot
 * `at` is on, or within `config.reach` tiles of its nearest tile. Distance is counted the way reach
 * always is, the larger of the two steps. False before the switch, so the tile rule decides.
 */
export function plotReachOk(
  state: Pick<WorldState, "plotReach" | "config">,
  me: Tile,
  at: Tile,
): boolean {
  if (!state.plotReach) return false;
  const { plotSize, reach } = state.config;
  const { px, py } = plotOf(state.config, at.x, at.y);
  const x0 = px * plotSize;
  const y0 = py * plotSize;
  const dx = Math.max(x0 - me.x, 0, me.x - (x0 + plotSize - 1));
  const dy = Math.max(y0 - me.y, 0, me.y - (y0 + plotSize - 1));
  return Math.max(dx, dy) <= reach;
}

/**
 * `walls_on_lines`, which only TOWN_ACTOR sends: from now on a wall, window, hedge or door goes
 * only on a line between tiles. Wall blocks already standing stay until they're taken down or
 * the town turns them into lines. Comes once.
 */
export function checkWallsOnLines(state: WorldState): (() => WorldEvent[]) | Rejection {
  return oneTimeSwitch({
    on: state.wallsOnLines,
    already: "Walls already go only on the lines between tiles.",
    turnOn: () => {
      state.wallsOnLines = true;
    },
    event: { type: "walls_on_lines_set" },
  });
}

/** The words for a wall sent onto a tile once `walls_on_lines` is logged. */
export const WALL_ON_TILE_WORDS =
  "Walls, windows, hedges and doors go on the lines between tiles. Send a side (n, e, s or w) for the line on that side of the tile.";

/**
 * `needs_side` for putting `block` on a tile once `walls_on_lines` is logged, or null: before the
 * switch, or for anything that isn't a wall, window, hedge or door.
 */
export function wallOnTileProblem(state: WorldState, block: unknown): Rejection | null {
  if (!state.wallsOnLines || !isEdgeKind(block)) return null;
  return refuse("needs_side", WALL_ON_TILE_WORDS);
}
