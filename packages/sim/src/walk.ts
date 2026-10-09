import { refuse } from "./check";
import { tileKey } from "./keys";
import type {
  Direction,
  Rejection,
  Resident,
  ResidentId,
  Tile,
  WorldConfig,
  WorldEvent,
  WorldState,
} from "./types";
import { chebyshev, inBounds, isSolid, STEP, shopTiles, townHallTiles } from "./world";

/**
 * How residents walk: one tile a step in any of eight directions, never into a block, never onto
 * the Town Hall or the shop once they're solid (`solid_buildings`), and never diagonally past a
 * corner, so no step slips between two blocks that touch at their corners or clips a building.
 *
 * `stepFrom` is the rule. The sim checks every `move` and putter step with it, and the client
 * checks your own steps with it before it sends them (decision 0052). `walkTree` and `route` find
 * walks over the same rule, for the server's putter planner and the client's tap-to-walk.
 */

/** The eight directions: along the grid first, then the diagonals. */
export const DIRECTIONS = [
  "n",
  "e",
  "s",
  "w",
  "ne",
  "se",
  "sw",
  "nw",
] as const satisfies readonly Direction[];

/** Whether a value is one of the eight directions. Logged steps are checked with it. */
export const isDirection = (d: unknown): d is Direction =>
  typeof d === "string" && (DIRECTIONS as readonly string[]).includes(d);

/** The direction of a one-tile step by (dx, dy), or undefined when it isn't one. */
export function directionOf(dx: number, dy: number): Direction | undefined {
  if (Math.max(Math.abs(dx), Math.abs(dy)) !== 1) return undefined;
  const ns = dy < 0 ? "n" : dy > 0 ? "s" : "";
  const ew = dx > 0 ? "e" : dx < 0 ? "w" : "";
  return `${ns}${ew}` as Direction;
}

/** What stops a walker on a tile. `no_floor` is a tile upstairs with nothing to stand on (RFC 0028). */
export type Obstacle = "block" | "town_hall" | "shop" | "no_floor";

/** What a walk needs to know: the world's size, and what stands where. */
export interface Ground {
  readonly config: WorldConfig;
  /** What stops a walker on a tile, or undefined if they can stand there. */
  obstacle(x: number, y: number): Obstacle | undefined;
}

/**
 * The ground from plain facts, so the client builds the same one from its mirror as the sim builds
 * from the world (`worldGround`).
 */
export function groundOf(facts: {
  config: WorldConfig;
  hasBlock: (x: number, y: number) => boolean;
  /** The Town Hall and the shop stop walkers (`solid_buildings`). */
  solidBuildings: boolean;
  /** The town shop has opened. Its tiles are a building only then. */
  shopOpen: boolean;
}): Ground {
  const { config, hasBlock } = facts;
  const buildings = new Map<string, Obstacle>();
  if (facts.solidBuildings) {
    for (const t of townHallTiles(config)) buildings.set(tileKey(t.x, t.y), "town_hall");
    if (facts.shopOpen) for (const t of shopTiles(config)) buildings.set(tileKey(t.x, t.y), "shop");
  }
  return {
    config,
    obstacle: (x, y) => {
      if (hasBlock(x, y)) return "block";
      return buildings.size > 0 ? buildings.get(tileKey(x, y)) : undefined;
    },
  };
}

/** The world's ground as the rules see it now. */
export function worldGround(state: WorldState): Ground {
  return groundOf({
    config: state.config,
    hasBlock: (x, y) => isSolid(state, x, y),
    solidBuildings: state.solidBuildings === true,
    shopOpen: state.shop !== undefined,
  });
}

const IN_THE_WAY: Record<Obstacle, string> = {
  block: "A block is in the way.",
  town_hall: "The Town Hall is in the way.",
  shop: "The shop is in the way.",
  no_floor: "There's no floor there.",
};

const CORNER: Record<Obstacle, string> = {
  block: "A block's corner is in the way. Step around it.",
  town_hall: "The Town Hall's corner is in the way. Step around it.",
  shop: "The shop's corner is in the way. Step around it.",
  no_floor: "The floor's corner is in the way. Step around it.",
};

/** Where a step lands, or why it can't be taken (and what's in the way). */
export type Step =
  | { ok: true; to: Tile }
  | { ok: false; code: "out_of_bounds" | "blocked"; message: string; obstacle?: Obstacle };

/**
 * One step from `from` in `dir`. A diagonal also needs both tiles beside it open, so it never
 * squeezes between two blocks or cuts a corner. Other residents never stop a step.
 */
export function stepFrom(ground: Ground, from: Tile, dir: Direction): Step {
  const [dx, dy] = STEP[dir];
  const to = { x: from.x + dx, y: from.y + dy };
  if (!inBounds(ground.config, to.x, to.y)) {
    return { ok: false, code: "out_of_bounds", message: "That's the edge of the world." };
  }
  const there = ground.obstacle(to.x, to.y);
  if (there) return { ok: false, code: "blocked", message: IN_THE_WAY[there], obstacle: there };
  if (dx !== 0 && dy !== 0) {
    const side = ground.obstacle(to.x, from.y) ?? ground.obstacle(from.x, to.y);
    if (side) return { ok: false, code: "blocked", message: CORNER[side], obstacle: side };
  }
  return { ok: true, to };
}

/** What a step with a direction the sim doesn't know is told. */
export const STEPS_GO = "Steps go n, s, e, w, ne, nw, se, or sw.";

/**
 * The tiles a run of logged steps walks through from `from`, each checked with `stepFrom` from
 * where the last one left off, or why one can't be taken. A putter's steps and a stroll's are
 * checked with it.
 */
export function walkSteps(
  ground: Ground,
  from: Tile,
  steps: readonly unknown[],
): { ok: true; path: Tile[] } | { ok: false; code: "out_of_bounds" | "blocked"; message: string } {
  const path: Tile[] = [];
  let at = from;
  for (const dir of steps) {
    if (!isDirection(dir)) return { ok: false, code: "out_of_bounds", message: STEPS_GO };
    const step = stepFrom(ground, at, dir);
    if (!step.ok) return { ok: false, code: step.code, message: step.message };
    path.push(step.to);
    at = step.to;
  }
  return { ok: true, path };
}

/** A tile a walk reached: how many steps from the start, and the step that got there. */
export interface WalkNode extends Tile {
  steps: number;
  /** Index of the node it came from, or -1 for the start. */
  prev: number;
  dir: Direction | null;
}

/**
 * Every tile a walk from `from` can reach without going more than `radius` tiles from it
 * (Chebyshev), breadth first over `stepFrom`, so each is reached in the fewest steps. The first
 * node is where the walk starts.
 */
export function walkTree(ground: Ground, from: Tile, radius: number): WalkNode[] {
  const nodes: WalkNode[] = [{ x: from.x, y: from.y, steps: 0, prev: -1, dir: null }];
  const seen = new Set([tileKey(from.x, from.y)]);
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i] as WalkNode;
    for (const dir of DIRECTIONS) {
      const [dx, dy] = STEP[dir];
      const x = n.x + dx;
      const y = n.y + dy;
      if (Math.abs(x - from.x) > radius || Math.abs(y - from.y) > radius) continue;
      const key = tileKey(x, y);
      if (seen.has(key) || !stepFrom(ground, n, dir).ok) continue;
      seen.add(key);
      nodes.push({ x, y, steps: n.steps + 1, prev: i, dir });
    }
  }
  return nodes;
}

/** The indexes of the nodes a walk passes through to reach `nodes[i]`, the start left out. */
export function walkPath(nodes: readonly WalkNode[], i: number): number[] {
  const path: number[] = [];
  for (let at = i; at > 0; at = nodes[at]?.prev ?? 0) path.push(at);
  return path.reverse();
}

/**
 * The fewest steps from `from` to stand within `near` tiles of `to` (0 is on it), looking at most
 * `radius` tiles around `from`. When no walk gets that close, the walk to the reachable tile
 * nearest `to`. Empty when that's where you already stand.
 */
export function route(ground: Ground, from: Tile, to: Tile, near = 0, radius = 24): Direction[] {
  const nodes = walkTree(ground, from, radius);
  // Breadth first, so the first node at the best distance is the one fewest steps away.
  const score = (t: Tile) => Math.max(chebyshev(t, to), near);
  let best = 0;
  for (let i = 1; i < nodes.length; i++) {
    if (score(nodes[i] as WalkNode) < score(nodes[best] as WalkNode)) best = i;
  }
  return walkPath(nodes, best).map((i) => nodes[i]?.dir as Direction);
}

// ---------- solid buildings ----------

type Mutation = () => WorldEvent[];

/**
 * `solid_buildings`, which only TOWN_ACTOR sends: from now on nobody walks onto the Town Hall or
 * the shop. Anyone standing on one steps off. Before it residents walked across both, so logs from
 * then replay as they were made.
 */
export function checkSolidBuildings(state: WorldState): Mutation | Rejection {
  if (state.solidBuildings) return refuse("already_open", "The buildings are already solid.");
  const off = offBuildings(state, { solidBuildings: true });
  return () => {
    state.solidBuildings = true;
    return [{ type: "buildings_solid" }, ...moveOff(state, off)];
  };
}

/** Someone to move off a building, and where to. */
export interface SteppingOff extends Tile {
  id: ResidentId;
}

/**
 * Who would stand on a solid building once `change` happens (the switch turning on, or the shop
 * opening), online or not, and the nearest tile each can stand on: nearest by Chebyshev distance,
 * then straight out before diagonally, then north to south and west to east. In id order, so
 * every replay agrees. It only reads, for a check; `moveOff` moves them in the commit.
 */
export function offBuildings(
  state: WorldState,
  change: { solidBuildings?: true; shopOpen?: true },
): SteppingOff[] {
  const ground = groundOf({
    config: state.config,
    hasBlock: (x, y) => isSolid(state, x, y),
    solidBuildings: change.solidBuildings ?? state.solidBuildings === true,
    shopOpen: change.shopOpen ?? state.shop !== undefined,
  });
  const off: SteppingOff[] = [];
  for (const id of Object.keys(state.residents).sort()) {
    const r = state.residents[id] as Resident;
    const on = ground.obstacle(r.x, r.y);
    if (on !== "town_hall" && on !== "shop") continue;
    const to = nearestOpen(ground, r);
    if (to) off.push({ id, ...to });
  }
  return off;
}

/** Move everyone `offBuildings` found, with a `moved` event each. */
export function moveOff(state: WorldState, off: readonly SteppingOff[]): WorldEvent[] {
  return off.map(({ id, x, y }) => {
    const r = state.residents[id] as Resident;
    r.x = x;
    r.y = y;
    return { type: "moved", residentId: id, x, y };
  });
}

function nearestOpen(ground: Ground, from: Tile): Tile | undefined {
  const { width, height } = ground.config;
  for (let d = 1; d < Math.max(width, height); d++) {
    let best: Tile | undefined;
    let bestSq = Number.POSITIVE_INFINITY;
    for (let y = from.y - d; y <= from.y + d; y++) {
      for (let x = from.x - d; x <= from.x + d; x++) {
        if (chebyshev({ x, y }, from) !== d) continue;
        if (!inBounds(ground.config, x, y) || ground.obstacle(x, y)) continue;
        const sq = (x - from.x) ** 2 + (y - from.y) ** 2;
        if (sq < bestSq) {
          best = { x, y };
          bestSq = sq;
        }
      }
    }
    if (best) return best;
  }
  return undefined;
}
