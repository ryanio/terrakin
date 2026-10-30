import type { BuildPlan } from "./build";
import { sameHousehold } from "./economy";
import { edgeAt, edgeBlocks, edgeKey } from "./edges";
import { plotKey, tileKey } from "./keys";
import { isStreet, landsFromSnapshot, onLand, type SnapshotLands, seaFrom } from "./lands";
import type {
  BlockKind,
  Direction,
  Plot,
  ResidentId,
  Side,
  Tile,
  WorldConfig,
  WorldState,
} from "./types";
import { DIRECTIONS, type Ground, groundOf, stepFrom, withEdges } from "./walk";
import { isWay } from "./ways";
import {
  blocksWalkers,
  commonsPlot,
  inBounds,
  isTownSquare,
  plotOf,
  STEP,
  shopTiles,
  townHallTiles,
} from "./world";

/**
 * A plot's exit (decision 0351 calls it a way out). A claimed plot has an **opening** when a walk
 * on its own tiles, from a hearth on it, reaches a tile on its edge from which one step (the sim's
 * own `stepFrom`, eight ways, never past a corner) lands on open ground: a tile nobody has claimed,
 * like the Commons, a town square, an island street (RFC 0046), a plot slot still free, a bridge,
 * or a public way on anyone's plot that joins the Commons (RFC 0046, which amends decision 0351),
 * with nothing on it that stops a walker. A step into a neighbour's yard is no opening, however
 * open the yard is: a home that reaches the town only across someone else's plot is
 * **landlocked**, because the neighbour can close that way at any time on their own land. A step
 * into a touching plot of the same household stays home (decision 0364). Doors are open
 * (`blocksWalkers`), and a lock, if one ever comes, never counts against an opening.
 *
 * Read-only, like the design notes: no rule calls it, so it never refuses anything and never
 * changes how a log replays. Its one reader in `apply.ts` is `nearestFreePlot`, the plot a
 * refusal names, and refusals are never logged. Everything here works from `OpeningFacts`, so a
 * script holding only the world's snapshot asks the same question as the server
 * (`openingFactsFrom`, `landlockedFrom`).
 */

/** What an opening reads: the walking ground of the ground floor, and which plot slots are taken. */
export interface OpeningFacts {
  ground: Ground;
  /** Whether plot slot (`px`, `py`) is someone's. A step onto it is no exit. */
  claimed(px: number, py: number): boolean;
  /**
   * Whether a tile is a public way (RFC 0046) that joins the Commons: open ground for an exit even
   * on someone's plot, since it holds no block. Left out where there are none.
   */
  way?(x: number, y: number): boolean;
  /**
   * Whether two claimed plot slots are one household's (`plotsTogether`), so a step between them
   * stays in one place: one household's touching plots have their exits together (decision 0364).
   * Left out, every plot is a place of its own.
   */
  together?(a: Slot, b: Slot): boolean;
}

/** A plot slot. */
interface Slot {
  px: number;
  py: number;
}

/** One exit: the tile on the plot's edge, and the open tile one step past it, in world tiles. */
export interface Opening {
  from: Tile;
  to: Tile;
}

/**
 * The plot slots that make one place with plot (`px`, `py`), by plot key: it, and every claimed
 * slot one household holds that touches it, side or corner, or touches one that does (decision
 * 0364). Just the plot itself where `together` is left out or its household holds nothing beside it.
 * The way planner groups plots with it too.
 */
export function placeOf(facts: OpeningFacts, px: number, py: number): Set<string> {
  const place = new Set([plotKey(px, py)]);
  if (!facts.together) return place;
  const queue: Slot[] = [{ px, py }];
  for (let i = 0; i < queue.length; i++) {
    const at = queue[i] as Slot;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const next = { px: at.px + dx, py: at.py + dy };
        const key = plotKey(next.px, next.py);
        if (place.has(key) || !facts.claimed(next.px, next.py) || !facts.together(at, next)) {
          continue;
        }
        place.add(key);
        queue.push(next);
      }
    }
  }
  return place;
}

/** A plot key's slot. */
function slotOf(key: string): Slot {
  const [px, py] = key.split(",").map(Number) as [number, number];
  return { px, py };
}

/**
 * The tiles of a place (`placeOf`, by plot key) a walk reaches on the place's own tiles, nearest
 * first: where an exit can start (decision 0351). Each plot of the place is walked as it would be
 * alone, from its hearths that stand on open ground, or from every open tile it has when no hearth
 * is on it, so a place never has fewer exits than a plot of it alone. Steps are the sim's own
 * `stepFrom`, eight ways, so a corner step needs both corners open, whoever's they are. The way
 * planner reads the same walk.
 */
export function placeWalk(
  facts: OpeningFacts,
  place: ReadonlySet<string>,
  hearths: readonly Tile[],
): Tile[] {
  const { ground } = facts;
  const S = ground.config.plotSize;
  const inPlace = (t: Tile) => place.has(plotKey(Math.floor(t.x / S), Math.floor(t.y / S)));
  const open = (t: Tile) => inBounds(ground.config, t.x, t.y) && !ground.obstacle(t.x, t.y);
  const starts: Tile[] = [];
  for (const key of place) {
    const slot = slotOf(key);
    const x0 = slot.px * S;
    const y0 = slot.py * S;
    const onPlot = (t: Tile) => t.x >= x0 && t.x < x0 + S && t.y >= y0 && t.y < y0 + S;
    const own = hearths.filter(onPlot);
    if (own.length > 0) {
      starts.push(...own.filter(open));
      continue;
    }
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
  for (let i = 0; i < queue.length; i++) {
    const at = queue[i] as Tile;
    for (const dir of DIRECTIONS) {
      const step = stepFrom(ground, at, dir);
      if (!step.ok || !inPlace(step.to) || seen.has(tileKey(step.to.x, step.to.y))) continue;
      seen.add(tileKey(step.to.x, step.to.y));
      queue.push(step.to);
    }
  }
  return queue;
}

/**
 * Every opening of plot (`px`, `py`), in the order a walk from its hearths finds them: the tiles it
 * reaches nearest first (`placeWalk`), then the eight directions in `DIRECTIONS` order. The walk
 * keeps to the plot's place (`placeOf`): the plot, and its household's plots touching it, which
 * share their exits (decision 0364). A plot with no hearth on it is walked from every open tile it
 * has. Empty when it is landlocked.
 */
export function openingsOf(
  facts: OpeningFacts,
  px: number,
  py: number,
  hearths: readonly Tile[],
): Opening[] {
  const { ground } = facts;
  const S = ground.config.plotSize;
  const place = placeOf(facts, px, py);
  const out: Opening[] = [];
  for (const at of placeWalk(facts, place, hearths)) {
    for (const dir of DIRECTIONS) {
      const step = stepFrom(ground, at, dir);
      if (!step.ok) continue;
      const to = step.to;
      if (place.has(plotKey(Math.floor(to.x / S), Math.floor(to.y / S)))) continue;
      const slot = plotOf(ground.config, to.x, to.y);
      if (!facts.claimed(slot.px, slot.py) || facts.way?.(to.x, to.y)) out.push({ from: at, to });
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
 * plot, water, or past the world's edge, so nothing its owner builds gives it an exit, and
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
 * Whether a tile in the ring just outside plot (`px`, `py`)'s place (`placeOf`), corners
 * included, is in the world, unclaimed, and not water: ground an exit could reach if nothing stood
 * in the way.
 */
function touchesOpenGround(facts: OpeningFacts, px: number, py: number): boolean {
  const { config } = facts.ground;
  const S = config.plotSize;
  const place = placeOf(facts, px, py);
  for (const key of place) {
    const { px: qx, py: qy } = slotOf(key);
    for (let y = qy * S - 1; y <= qy * S + S; y++) {
      for (let x = qx * S - 1; x <= qx * S + S; x++) {
        const ring = x === qx * S - 1 || x === qx * S + S || y === qy * S - 1 || y === qy * S + S;
        if (!ring || !inBounds(config, x, y) || facts.ground.obstacle(x, y) === "sea") continue;
        const slot = plotOf(config, x, y);
        if (place.has(plotKey(slot.px, slot.py))) continue;
        if (!facts.claimed(slot.px, slot.py) || facts.way?.(x, y)) return true;
      }
    }
  }
  return false;
}

/**
 * The world's facts for openings, as it stands or with `plan` laid over its ground floor, its
 * blocks and its walls between tiles: the ground every walk reads (`worldGround`'s, sea and solid buildings included) and the plots claimed.
 */
export function openingFacts(state: WorldState, plan?: BuildPlan): OpeningFacts {
  const changed = new Map<string, boolean>();
  for (const t of plan?.removed ?? [])
    if ((t.floor ?? 0) === 0) changed.set(tileKey(t.x, t.y), false);
  for (const t of plan?.placed ?? []) {
    if ((t.floor ?? 0) === 0) changed.set(tileKey(t.x, t.y), blocksWalkers(t.block));
  }
  // Walls between tiles (RFC 0050) as the plan leaves the ground floor's lines.
  const lines = new Map<string, BlockKind | undefined>();
  for (const t of plan?.unwalled ?? [])
    if ((t.floor ?? 0) === 0) lines.set(edgeKey(t.x, t.y, t.side), undefined);
  for (const t of plan?.walled ?? [])
    if ((t.floor ?? 0) === 0) lines.set(edgeKey(t.x, t.y, t.side), t.block);
  const edges =
    lines.size === 0
      ? withEdges(state, 0)
      : {
          edge: (x: number, y: number, side: Side) => {
            const key = edgeKey(x, y, side);
            return edgeBlocks(lines.has(key) ? lines.get(key) : edgeAt(state, x, y, side, 0));
          },
        };
  const sea = seaFrom(state.config, state.lands);
  const facts: OpeningFacts = {
    ground: groundOf({
      config: state.config,
      hasBlock: (x, y) => changed.get(tileKey(x, y)) ?? blocksWalkers(state.blocks[tileKey(x, y)]),
      solidBuildings: state.solidBuildings === true,
      townHall: townHallTiles(state),
      shop: state.shop ? shopTiles(state) : [],
      ...(sea ? { sea } : {}),
      // Walls between tiles (RFC 0050) close a way out as wall blocks do.
      ...edges,
    }),
    claimed: (px, py) => state.plots[plotKey(px, py)] !== undefined,
    together: (a, b) => plotsTogether(state, a, b),
  };
  if (!state.ways) return facts;
  return { ...facts, way: joinedWays(facts, (x, y) => isWay(state, x, y), commonsPlot(state)) };
}

/**
 * Whether two claimed plots are one household's (decision 0364): someone who holds one, its owner
 * or a co-owner, is in the household (`sameHousehold`: the same resident, or linked as owner
 * pairs) of someone who holds the other. False when either is unclaimed.
 */
function plotsTogether(state: WorldState, a: Slot, b: Slot): boolean {
  const p = state.plots[plotKey(a.px, a.py)];
  const q = state.plots[plotKey(b.px, b.py)];
  if (!p || !q) return false;
  const holders = (plot: Plot) => [plot.ownerId, ...(plot.coOwners ?? [])];
  return holders(p).some((x) => holders(q).some((y) => sameHousehold(state, x, y)));
}

/**
 * The parts of a world snapshot (`GET /v1/world`) the opening facts read, in the wire's own
 * shapes: the web's plot picker, the nightly landlocked check, and the ways dry run all hold one.
 */
export interface OpeningSnapshot {
  config: WorldConfig;
  commons: { px: number; py: number };
  plots: readonly {
    px: number;
    py: number;
    ownerId?: string | undefined;
    coOwners?: readonly string[] | undefined;
  }[];
  blocks: readonly { x: number; y: number; block: BlockKind; floor?: number | undefined }[];
  ways?: readonly Tile[] | undefined;
  lands?: SnapshotLands | undefined;
  solidBuildings?: boolean | undefined;
  townHall: readonly Tile[];
  shop?: readonly Tile[] | undefined;
}

/**
 * The world's facts for openings from its snapshot, as `openingFacts` reads them from the world:
 * the ground floor's walking ground, the plots claimed, and the public ways that join the Commons.
 * The snapshot carries no owner pairs, so one household's plots are the ones that share an owner
 * or a co-owner.
 */
export function openingFactsFrom(world: OpeningSnapshot): OpeningFacts {
  const solid = new Set(
    world.blocks
      .filter((b) => (b.floor ?? 0) === 0 && blocksWalkers(b.block))
      .map((b) => tileKey(b.x, b.y)),
  );
  const sea = seaFrom(world.config, world.lands && landsFromSnapshot(world.lands));
  const holders = new Map(
    world.plots.map((p) => [
      plotKey(p.px, p.py),
      [...(p.ownerId ? [p.ownerId] : []), ...(p.coOwners ?? [])],
    ]),
  );
  const facts: OpeningFacts = {
    ground: groundOf({
      config: world.config,
      hasBlock: (x, y) => solid.has(tileKey(x, y)),
      solidBuildings: world.solidBuildings === true,
      townHall: world.townHall,
      shop: world.shop ?? [],
      ...(sea ? { sea } : {}),
    }),
    claimed: (px, py) => holders.has(plotKey(px, py)),
    together: (a, b) => {
      const theirs = holders.get(plotKey(b.px, b.py)) ?? [];
      return (holders.get(plotKey(a.px, a.py)) ?? []).some((id) => theirs.includes(id));
    },
  };
  const ways = new Set((world.ways ?? []).map((t) => tileKey(t.x, t.y)));
  if (ways.size === 0) return facts;
  return { ...facts, way: joinedWays(facts, (x, y) => ways.has(tileKey(x, y)), world.commons) };
}

/**
 * Which way tiles count as open ground (RFC 0046): the ones a walk from the Commons reaches over
 * ground nobody has claimed and over ways. A way the rest of the network doesn't reach, left over
 * after a `close_way` or laid on its own, leads nowhere, so a step onto it is no exit. One walk
 * over the world, so a reader asks it once and keeps the answer. The walk starts from every open
 * Commons tile, not just the first in scan order: that tile can sit in a pocket of blocks and
 * buildings while the rest of the Commons walks out freely (issue #118), and a way counts as
 * joined when a walk from any open Commons tile reaches it.
 */
function joinedWays(
  facts: Pick<OpeningFacts, "ground" | "claimed">,
  way: (x: number, y: number) => boolean,
  commons: { px: number; py: number },
): (x: number, y: number) => boolean {
  const { ground, claimed } = facts;
  const { config } = ground;
  const S = config.plotSize;
  const open: Ground = {
    config,
    obstacle: (x, y) => {
      const there = ground.obstacle(x, y);
      if (there) return there;
      const slot = plotOf(config, x, y);
      return claimed(slot.px, slot.py) && !way(x, y) ? "block" : undefined;
    },
  };
  const starts: Tile[] = [];
  for (let y = commons.py * S; y < (commons.py + 1) * S; y++) {
    for (let x = commons.px * S; x < (commons.px + 1) * S; x++) {
      if (!open.obstacle(x, y)) starts.push({ x, y });
    }
  }
  if (starts.length === 0) return () => false;
  const reached = new Set(starts.map((t) => tileKey(t.x, t.y)));
  const queue: Tile[] = [...starts];
  for (let i = 0; i < queue.length; i++) {
    const at = queue[i] as Tile;
    for (const dir of DIRECTIONS) {
      const step = stepFrom(open, at, dir);
      if (!step.ok) continue;
      const key = tileKey(step.to.x, step.to.y);
      if (reached.has(key)) continue;
      reached.add(key);
      queue.push(step.to);
    }
  }
  return (x, y) => way(x, y) && reached.has(tileKey(x, y));
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

// ---------- a claim (decision 0354) ----------

/** What claiming a free plot would do to exits. */
export interface ClaimExits {
  /**
   * The plot's own openings once it's claimed, walked from every open tile on it (a plot nobody
   * has claimed has no hearth on it). Empty when it would be landlocked.
   */
  own: Opening[];
  /** Why it would be landlocked, as `landlockedFrom` says it, when `own` is empty. */
  why?: Landlocked["why"];
  /**
   * Each claimed plot around it that has an exit now and would have none, north to south, then
   * west to east, with the openings it would lose: all it has, every one a step onto this plot.
   */
  seals: { px: number; py: number; lost: Opening[] }[];
}

/** Whether a claim closes nobody in: it leaves every plot around it an exit, and has its own. */
export const closesNobodyIn = (exits: ClaimExits): boolean =>
  exits.seals.length === 0 && exits.own.length > 0;

/**
 * What claiming a plot slot would do to exits, asked of one world, as a function of the slot.
 * A claim changes no tile, only which slots count as open ground, and `openingsOf` reads that only
 * at the step off a plot. So a neighbour's openings after the claim are its openings now less each
 * step onto this plot, and the plot's own are its walk now. Each plot's openings are walked once
 * and kept, so a picker asking of every free slot walks each plot once.
 */
export function claimExitsFrom(
  facts: OpeningFacts,
  hearths: readonly Tile[],
): (px: number, py: number) => ClaimExits {
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
    const seals: ClaimExits["seals"] = [];
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const nx = px + dx;
        const ny = py + dy;
        if ((dx === 0 && dy === 0) || !facts.claimed(nx, ny)) continue;
        const theirs = openings(nx, ny);
        // A step onto a public way stays an exit after the claim: it holds no block (RFC 0046).
        const kept = theirs.some((o) => {
          const slot = plotOf(config, o.to.x, o.to.y);
          return slot.px !== px || slot.py !== py || facts.way?.(o.to.x, o.to.y) === true;
        });
        if (theirs.length > 0 && !kept) seals.push({ px: nx, py: ny, lost: theirs });
      }
    }
    const own = openings(px, py);
    if (own.length > 0) return { own, seals };
    return { own, why: touchesOpenGround(facts, px, py) ? "walled" : "surrounded", seals };
  };
}

/** What claiming a plot slot would do to exits in the world as it stands (`claimExitsFrom`). */
export function claimExitsIn(state: WorldState): (px: number, py: number) => ClaimExits {
  return claimExitsFrom(openingFacts(state), hearthsOf(state));
}

/**
 * The free plot nearest to plot (`px`, `py`): unclaimed, not a town square or a street, and on
 * land, so one
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
      if (isTownSquare(state, x, y) || isStreet(state, x, y) || state.plots[plotKey(x, y)])
        continue;
      if (!onLand(state, x, y)) continue;
      free.push({ px: x, py: y, d: Math.max(Math.abs(x - px), Math.abs(y - py)) });
    }
  }
  free.sort((a, b) => a.d - b.d || a.py - b.py || a.px - b.px);
  const exits = claimExitsIn(state);
  const clear = (p: { px: number; py: number }) => closesNobodyIn(exits(p.px, p.py));
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
    return !facts.claimed(slot.px, slot.py) || facts.way?.(wx, wy) === true;
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
