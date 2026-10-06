import { isWhole, refuse } from "./check";
import { plotKey, tileKey } from "./keys";
import { residentById } from "./own";
import type {
  Command,
  Plot,
  Rejection,
  Resident,
  ResidentId,
  Tile,
  WorldEvent,
  WorldState,
} from "./types";
import { type Ground, walkTree, worldGround } from "./walk";
import { canBuildOn, isCommons, plotCenter, plotInBounds, plotOf, plotsOwnedBy } from "./world";

/**
 * `visit` (RFC 0020): a jump to the edge of someone else's plot, at its door, from anywhere.
 *
 * `visitTile` picks the tile. The server calls it and logs its answer with the command, the way a
 * putter is logged as its steps (decision 0049), and `checkVisit` checks the logged tile against
 * the world. Replay never runs the planner, so improving it changes where later visits land and
 * never how a logged one replays.
 */

type Mutation = () => WorldEvent[];

/**
 * Where a plot's life is, for a visitor heading in: its owner's hearth if it's on the plot, else
 * the first co-owner's hearth there, else the plot's center.
 */
export function plotHeart(state: WorldState, plot: Plot): Tile {
  const { config } = state;
  for (const id of [plot.ownerId, ...(plot.coOwners ?? [])]) {
    const hearth = residentById(state, id)?.hearth;
    if (!hearth) continue;
    const p = plotOf(config, hearth.x, hearth.y);
    if (p.px === plot.px && p.py === plot.py) return { x: hearth.x, y: hearth.y };
  }
  return plotCenter(config, plot.px, plot.py);
}

/** Whether `a` sorts before `b`, comparing one number at a time. */
function before(a: readonly number[], b: readonly number[]): boolean {
  for (let i = 0; i < a.length; i++) {
    const x = a[i] as number;
    const y = b[i] as number;
    if (x !== y) return x < y;
  }
  return false;
}

/**
 * Where `visit` puts `actor` on plot (px, py), or undefined when nobody lives there or no tile on
 * it is free. Free is no block, nobody's hearth, and no other online resident standing there. Of
 * the free tiles: the outermost ring first, so a visitor arrives at the plot's edge; then the
 * shortest walk to the plot's heart (`plotHeart`), walking as `move` does and staying on the plot,
 * which puts a visitor in front of a hut's doorway; then the nearest to the heart in a straight
 * line; then north to south, and west to east.
 */
export function visitTile(
  state: WorldState,
  actor: ResidentId,
  px: number,
  py: number,
): Tile | undefined {
  const { config } = state;
  if (!plotInBounds(config, px, py)) return undefined;
  const plot = state.plots[plotKey(px, py)];
  if (!plot) return undefined;
  const size = config.plotSize;
  const x0 = px * size;
  const y0 = py * size;
  const onPlot = (x: number, y: number) => x >= x0 && x < x0 + size && y >= y0 && y < y0 + size;
  const ground = worldGround(state);
  // Walks that stay on the plot: every tile off it is in the way.
  const plotGround: Ground = {
    config,
    obstacle: (x, y) => (onPlot(x, y) ? ground.obstacle(x, y) : "block"),
  };
  const heart = plotHeart(state, plot);
  const steps = new Map<string, number>();
  for (const n of walkTree(plotGround, heart, size)) steps.set(tileKey(n.x, n.y), n.steps);
  const taken = new Set<string>();
  for (const r of Object.values(state.residents)) {
    if (r.hearth) taken.add(tileKey(r.hearth.x, r.hearth.y));
    if (r.online && r.id !== actor) taken.add(tileKey(r.x, r.y));
  }
  let best: { tile: Tile; rank: number[] } | undefined;
  // North to south, then west to east, so the first of equal tiles wins.
  for (let y = y0; y < y0 + size; y++) {
    for (let x = x0; x < x0 + size; x++) {
      const key = tileKey(x, y);
      if (ground.obstacle(x, y) || taken.has(key)) continue;
      const ring = Math.min(x - x0, x0 + size - 1 - x, y - y0, y0 + size - 1 - y);
      const walk = steps.get(key) ?? Number.POSITIVE_INFINITY;
      const line = (x - heart.x) ** 2 + (y - heart.y) ** 2;
      const rank = [ring, walk, line];
      if (!best || before(rank, best.rank)) best = { tile: { x, y }, rank };
    }
  }
  return best?.tile;
}

/**
 * The plot nearest to plot (px, py) that someone lives on and that isn't `actor`'s own or shared
 * with them: by Chebyshev distance in plots, then north to south, then west to east.
 */
function nearestLivedIn(
  state: WorldState,
  actor: ResidentId,
  px: number,
  py: number,
): Plot | undefined {
  let best: { plot: Plot; d: number } | undefined;
  for (const plot of Object.values(state.plots)) {
    if (canBuildOn(plot, actor)) continue;
    const d = Math.max(Math.abs(plot.px - px), Math.abs(plot.py - py));
    const wins =
      !best ||
      d < best.d ||
      (d === best.d &&
        (plot.py < best.plot.py || (plot.py === best.plot.py && plot.px < best.plot.px)));
    if (wins) best = { plot, d };
  }
  return best?.plot;
}

/** `visit {px, py, x?, y?}`: the logged tile, checked against the world as it is now. */
export function checkVisit(
  state: WorldState,
  me: Resident,
  command: Extract<Command, { type: "visit" }>,
): Mutation | Rejection {
  const { config } = state;
  const { px, py } = command;
  if (!plotInBounds(config, px, py)) {
    return refuse("out_of_bounds", "That plot is outside the world.");
  }
  if (isCommons(config, px, py)) {
    return refuse(
      "plot_is_commons",
      "The Commons belongs to everyone, so it isn't a plot to visit. It's the plot in the middle: walk there.",
    );
  }
  const plot = state.plots[plotKey(px, py)];
  if (!plot) {
    const near = nearestLivedIn(state, me.id, px, py);
    const visit = near
      ? ` Try visit at px ${near.px}, py ${near.py}, the nearest plot someone lives on.`
      : "";
    const settle =
      plotsOwnedBy(state, me.id).length === 0
        ? ` Or make it yours: try settle at px ${px}, py ${py}.`
        : "";
    return refuse("plot_unclaimed", `Nobody lives on that plot yet.${visit}${settle}`);
  }
  if (canBuildOn(plot, me.id)) {
    const whose =
      plot.ownerId === me.id ? "That's your own plot." : "That plot is shared with you.";
    const way = me.hearth
      ? "Try home to jump to your hearth."
      : "Try build_starter_home, which sets a hearth, and then home.";
    return refuse("own_plot", `${whose} ${way}`);
  }
  const here = plotOf(config, me.x, me.y);
  if (here.px === px && here.py === py) {
    return refuse("already_there", "You're already on that plot.");
  }
  const { x, y } = command;
  if (x === undefined || y === undefined) {
    return refuse(
      "nowhere_to_go",
      "Every tile on that plot is taken right now. Try again in a moment, or visit another plot.",
    );
  }
  if (!isWhole(x) || !isWhole(y)) return refuse("out_of_bounds", "That tile isn't on the plot.");
  const to = plotOf(config, x, y);
  if (to.px !== px || to.py !== py) return refuse("out_of_bounds", "That tile isn't on the plot.");
  if (worldGround(state).obstacle(x, y)) return refuse("blocked", "A block is in the way.");
  for (const r of Object.values(state.residents)) {
    if (r.hearth && r.hearth.x === x && r.hearth.y === y) {
      return refuse("tile_occupied", "That's someone's hearth. Keep it clear.");
    }
    if (r.online && r.id !== me.id && r.x === x && r.y === y) {
      return refuse("tile_occupied", "Someone is standing there.");
    }
  }
  return () => {
    me.x = x;
    me.y = y;
    return [{ type: "moved", residentId: me.id, x, y }];
  };
}
