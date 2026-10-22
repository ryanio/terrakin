import type { BuildPlan } from "./build";
import { plotKey, tileKey } from "./keys";
import { onLand, seaFrom } from "./lands";
import type { Direction, ResidentId, Tile, WorldState } from "./types";
import { DIRECTIONS, type Ground, groundOf, stepFrom } from "./walk";
import {
  blocksWalkers,
  inBounds,
  isTownSquare,
  plotOf,
  STEP,
  shopTiles,
  townHallTiles,
} from "./world";

/**
 * A plot's way out (decision 0351). A claimed plot has an **opening** when a walk on its own tiles,
 * from a hearth on it, reaches a tile on its edge from which one step (the sim's own `stepFrom`,
 * eight ways, never past a corner) lands on open ground: a tile nobody has claimed, like the
 * Commons, a town square, a plot slot still free, or a bridge, with nothing on it that stops a
 * walker. A step into a neighbour's yard is no opening, however open the yard is: a home that
 * reaches the town only across someone else's plot is **landlocked**, because the neighbour can
 * close that way at any time on their own land. Doors are open (`blocksWalkers`), and a lock, if
 * one ever comes, never counts against an opening.
 *
 * Read-only, like the design notes: no rule calls it, so it never refuses anything and never
 * changes how a log replays. Its one reader in `apply.ts` is `nearestFreePlot`, the plot a
 * refusal names, and refusals are never logged. Everything here works from `OpeningFacts`, so a script holding only
 * the world's snapshot asks the same question as the server (`landlockedFrom`).
 */

/** What an opening reads: the walking ground of the ground floor, and which plot slots are taken. */
export interface OpeningFacts {
  ground: Ground;
  /** Whether plot slot (`px`, `py`) is someone's. A step onto it is no way out. */
  claimed(px: number, py: number): boolean;
}

/** One way out: the tile on the plot's edge, and the open tile one step past it, in world tiles. */
export interface Opening {
  from: Tile;
  to: Tile;
}

/**
 * Every opening of plot (`px`, `py`), in the order a walk from its hearths finds them: the tiles it
 * reaches nearest first, then the eight directions in `DIRECTIONS` order. A plot with no hearth on
 * it is walked from every open tile it has. Empty when it is landlocked.
 */
export function openingsOf(
  facts: OpeningFacts,
  px: number,
  py: number,
  hearths: readonly Tile[],
): Opening[] {
  const { ground } = facts;
  const S = ground.config.plotSize;
  const x0 = px * S;
  const y0 = py * S;
  const onPlot = (t: Tile) => t.x >= x0 && t.x < x0 + S && t.y >= y0 && t.y < y0 + S;
  const open = (t: Tile) => inBounds(ground.config, t.x, t.y) && !ground.obstacle(t.x, t.y);
  let starts = hearths.filter((h) => onPlot(h) && open(h));
  if (hearths.every((h) => !onPlot(h))) {
    starts = [];
    for (let y = y0; y < y0 + S; y++) {
      for (let x = x0; x < x0 + S; x++) if (open({ x, y })) starts.push({ x, y });
    }
  }
  const seen = new Set<string>();
  const queue: Tile[] = [];
  for (const t of starts) {
    if (seen.has(tileKey(t.x, t.y))) continue;
    seen.add(tileKey(t.x, t.y));
    queue.push(t);
  }
  const out: Opening[] = [];
  for (let i = 0; i < queue.length; i++) {
    const at = queue[i] as Tile;
    for (const dir of DIRECTIONS) {
      const step = stepFrom(ground, at, dir);
      if (!step.ok) continue;
      const to = step.to;
      if (onPlot(to)) {
        if (seen.has(tileKey(to.x, to.y))) continue;
        seen.add(tileKey(to.x, to.y));
        queue.push(to);
        continue;
      }
      const slot = plotOf(ground.config, to.x, to.y);
      if (!facts.claimed(slot.px, slot.py)) out.push({ from: at, to });
    }
  }
  return out;
}

/** A claimed plot. */
export interface ClaimedPlot {
  px: number;
  py: number;
  ownerId: ResidentId;
}

/**
 * A claimed plot with no opening, and why: `surrounded` when every tile around it is someone's
 * plot, water, or past the world's edge, so nothing its owner builds gives it a way out, and
 * `walled` when open ground does touch it but something keeps every walk from the hearth off it:
 * blocks of its own, or at a corner a neighbour's block or the water.
 */
export interface Landlocked extends ClaimedPlot {
  why: "surrounded" | "walled";
}

/**
 * Every claimed plot in `plots` with no opening, north to south, then west to east. `hearths` is
 * every resident's hearth in the world; each plot is walked from the ones on it.
 */
export function landlockedFrom(
  facts: OpeningFacts,
  plots: readonly ClaimedPlot[],
  hearths: readonly Tile[],
): Landlocked[] {
  return [...plots]
    .sort((a, b) => a.py - b.py || a.px - b.px)
    .filter((p) => openingsOf(facts, p.px, p.py, hearths).length === 0)
    .map(({ px, py, ownerId }) => ({
      px,
      py,
      ownerId,
      why: touchesOpenGround(facts, px, py) ? "walled" : "surrounded",
    }));
}

/**
 * Whether a tile in the ring just outside plot (`px`, `py`), corners included, is in the world,
 * unclaimed, and not water: ground a way out could reach if nothing stood in the way.
 */
function touchesOpenGround(facts: OpeningFacts, px: number, py: number): boolean {
  const { config } = facts.ground;
  const S = config.plotSize;
  for (let y = py * S - 1; y <= py * S + S; y++) {
    for (let x = px * S - 1; x <= px * S + S; x++) {
      const ring = x === px * S - 1 || x === px * S + S || y === py * S - 1 || y === py * S + S;
      if (!ring || !inBounds(config, x, y) || facts.ground.obstacle(x, y) === "sea") continue;
      const slot = plotOf(config, x, y);
      if (!facts.claimed(slot.px, slot.py)) return true;
    }
  }
  return false;
}

/**
 * The world's facts for openings, as it stands or with `plan` laid over its ground floor: the
 * ground every walk reads (`worldGround`'s, sea and solid buildings included) and the plots claimed.
 */
export function openingFacts(state: WorldState, plan?: BuildPlan): OpeningFacts {
  const changed = new Map<string, boolean>();
  for (const t of plan?.removed ?? [])
    if ((t.floor ?? 0) === 0) changed.set(tileKey(t.x, t.y), false);
  for (const t of plan?.placed ?? []) {
    if ((t.floor ?? 0) === 0) changed.set(tileKey(t.x, t.y), blocksWalkers(t.block));
  }
  const sea = seaFrom(state.config, state.lands);
  return {
    ground: groundOf({
      config: state.config,
      hasBlock: (x, y) => changed.get(tileKey(x, y)) ?? blocksWalkers(state.blocks[tileKey(x, y)]),
      solidBuildings: state.solidBuildings === true,
      townHall: townHallTiles(state),
      shop: state.shop ? shopTiles(state) : [],
      ...(sea ? { sea } : {}),
    }),
    claimed: (px, py) => state.plots[plotKey(px, py)] !== undefined,
  };
}

/** Every resident's hearth in the world. */
function hearthsOf(state: WorldState): Tile[] {
  return Object.values(state.residents).flatMap((r) => (r.hearth ? [r.hearth] : []));
}

/** Plot (`px`, `py`)'s openings in the world as it stands, or as `plan` would leave it. */
export function plotOpenings(state: WorldState, px: number, py: number, plan?: BuildPlan) {
  return openingsOf(openingFacts(state, plan), px, py, hearthsOf(state));
}

/** Every landlocked plot in the world, north to south, then west to east. */
export function landlocked(state: WorldState): Landlocked[] {
  return landlockedFrom(openingFacts(state), Object.values(state.plots), hearthsOf(state));
}

// ---------- a claim (decision 0352) ----------

/** What claiming a free plot would do to ways out. */
export interface ClaimWays {
  /**
   * The plot's own openings once it's claimed, walked from every open tile on it (a plot nobody
   * has claimed has no hearth on it). Empty when it would be landlocked.
   */
  own: Opening[];
  /** Why it would be landlocked, as `landlockedFrom` says it, when `own` is empty. */
  why?: Landlocked["why"];
  /**
   * Each claimed plot around it that has a way out now and would have none, north to south, then
   * west to east, with the openings it would lose: all it has, every one a step onto this plot.
   */
  seals: { px: number; py: number; lost: Opening[] }[];
}

/** Whether a claim closes nobody in: it leaves every plot around it a way out, and has its own. */
export const closesNobodyIn = (ways: ClaimWays): boolean =>
  ways.seals.length === 0 && ways.own.length > 0;

/**
 * What claiming a plot slot would do to ways out, asked of one world, as a function of the slot.
 * A claim changes no tile, only which slots count as open ground, and `openingsOf` reads that only
 * at the step off a plot. So a neighbour's openings after the claim are its openings now less each
 * step onto this plot, and the plot's own are its walk now. Each plot's openings are walked once
 * and kept, so a picker asking of every free slot walks each plot once.
 */
export function claimWaysFrom(
  facts: OpeningFacts,
  hearths: readonly Tile[],
): (px: number, py: number) => ClaimWays {
  const { config } = facts.ground;
  const walked = new Map<string, Opening[]>();
  const openings = (px: number, py: number) => {
    const key = plotKey(px, py);
    let found = walked.get(key);
    if (!found) {
      found = openingsOf(facts, px, py, hearths);
      walked.set(key, found);
    }
    return found;
  };
  return (px, py) => {
    const seals: ClaimWays["seals"] = [];
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const nx = px + dx;
        const ny = py + dy;
        if ((dx === 0 && dy === 0) || !facts.claimed(nx, ny)) continue;
        const theirs = openings(nx, ny);
        const kept = theirs.some((o) => {
          const slot = plotOf(config, o.to.x, o.to.y);
          return slot.px !== px || slot.py !== py;
        });
        if (theirs.length > 0 && !kept) seals.push({ px: nx, py: ny, lost: theirs });
      }
    }
    const own = openings(px, py);
    if (own.length > 0) return { own, seals };
    return { own, why: touchesOpenGround(facts, px, py) ? "walled" : "surrounded", seals };
  };
}

/** What claiming a plot slot would do to ways out in the world as it stands (`claimWaysFrom`). */
export function claimWaysIn(state: WorldState): (px: number, py: number) => ClaimWays {
  return claimWaysFrom(openingFacts(state), hearthsOf(state));
}

/**
 * The free plot nearest to plot (`px`, `py`): unclaimed, not a town square, and on land, so one
 * `settle` would take, by Chebyshev distance in plots, then north to south, then west to east. Of
 * the plots as near as the nearest, the first whose claim closes nobody in (`closesNobodyIn`),
 * else the first. With `clear`, only a plot that closes nobody in, however far. `except` is never
 * named. Undefined when there's none.
 */
export function nearestFreePlot(
  state: WorldState,
  px: number,
  py: number,
  how: { clear?: boolean; except?: { px: number; py: number } } = {},
): { px: number; py: number } | undefined {
  const { config } = state;
  const across = config.width / config.plotSize;
  const down = config.height / config.plotSize;
  const free: { px: number; py: number; d: number }[] = [];
  for (let y = 0; y < down; y++) {
    for (let x = 0; x < across; x++) {
      if (how.except?.px === x && how.except.py === y) continue;
      // Water is never a plot to try: `settle` refuses it, so naming one sends an agent in a
      // circle between a refusal and its hint (RFC 0038).
      if (isTownSquare(state, x, y) || state.plots[plotKey(x, y)] || !onLand(state, x, y)) continue;
      free.push({ px: x, py: y, d: Math.max(Math.abs(x - px), Math.abs(y - py)) });
    }
  }
  free.sort((a, b) => a.d - b.d || a.py - b.py || a.px - b.px);
  const ways = claimWaysIn(state);
  const clear = (p: { px: number; py: number }) => closesNobodyIn(ways(p.px, p.py));
  const first = free[0];
  const pick = how.clear
    ? free.find(clear)
    : first && (free.find((p) => p.d === first.d && clear(p)) ?? first);
  return pick && { px: pick.px, py: pick.py };
}

// ---------- a design's door ----------

const ALONG: readonly Direction[] = ["n", "e", "s", "w"];
const CLOCKWISE: Record<string, Direction> = { n: "e", e: "s", s: "w", w: "n" };

/**
 * Which way a door in a wall opens out of the home: across the wall it sits in (stopping walkers
 * on two opposite sides), away from the plot's middle, where a design and the starter hut put the
 * hearth. Undefined when the tile isn't in a wall. `door` and `wall` are in plot tiles.
 */
export function doorOutward(
  size: number,
  door: Tile,
  wall: (x: number, y: number) => boolean,
): Direction | undefined {
  const middle = (size - 1) / 2;
  if (wall(door.x - 1, door.y) && wall(door.x + 1, door.y)) return door.y > middle ? "s" : "n";
  if (wall(door.x, door.y - 1) && wall(door.x, door.y + 1)) return door.x > middle ? "e" : "w";
  return undefined;
}

/**
 * Whether a door at `door` (plot tiles) opening `out` faces open ground: the tile just past the
 * plot's edge straight out from it is in the world, unclaimed, and has nothing on it that stops a
 * walker. And when it doesn't, how many quarter turns clockwise of the whole plot's layout (a
 * design's `turn`, 90 each) would make it face some: the fewest, or undefined when no turn does.
 */
export function doorFacing(
  facts: OpeningFacts,
  px: number,
  py: number,
  door: Tile,
  out: Direction,
): { faces: boolean; quarters?: number } {
  const S = facts.ground.config.plotSize;
  const faces = (at: Tile, dir: Direction) => {
    const [dx, dy] = STEP[dir];
    let { x, y } = at;
    while (x >= 0 && y >= 0 && x < S && y < S) {
      x += dx;
      y += dy;
    }
    const wx = px * S + x;
    const wy = py * S + y;
    if (!inBounds(facts.ground.config, wx, wy) || facts.ground.obstacle(wx, wy)) return false;
    const slot = plotOf(facts.ground.config, wx, wy);
    return !facts.claimed(slot.px, slot.py);
  };
  if (!ALONG.includes(out)) return { faces: false };
  if (faces(door, out)) return { faces: true };
  let at = door;
  let dir = out;
  for (let quarters = 1; quarters < 4; quarters++) {
    at = { x: S - 1 - at.y, y: at.x };
    dir = CLOCKWISE[dir] as Direction;
    if (faces(at, dir)) return { faces: false, quarters };
  }
  return { faces: false };
}
