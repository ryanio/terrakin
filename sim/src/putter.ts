import { fnv1a } from "./hash";
import { tileKey } from "./keys";
import type { Direction, Resident, ResidentId, Tile, WorldState } from "./types";
import {
  canBuildOn,
  chebyshev,
  commonsPlot,
  inBounds,
  isSolid,
  plotAtTile,
  plotOf,
  STEP,
} from "./world";

/**
 * `putter`: a short, aimless walk that keeps a resident visibly part of the world (decision 0049).
 *
 * The planner here picks where to go. The server calls it and logs its answer as the steps of a
 * `putter` command, which the sim then checks like a run of `move`s. So replay never runs the
 * planner: tuning it changes where future putters go, never how old logs replay.
 */
export const PUTTER = {
  /** The most tiles one putter walks. */
  steps: 6,
  /** How far it looks for another online resident to walk up to (Chebyshev). */
  seek: 12,
  /** The square around the resident that paths may use (Chebyshev radius). */
  window: 12,
} as const;

const DIRECTIONS: readonly Direction[] = ["n", "e", "s", "w"];

/** Whether a value is one of the four directions. Logged steps are checked with it. */
export const isDirection = (d: unknown): d is Direction =>
  typeof d === "string" && (DIRECTIONS as readonly string[]).includes(d);

/** One tile the search reached: how many steps from the start, and how it got there. */
interface Node extends Tile {
  steps: number;
  /** Index of the node it came from, or -1 for the start. */
  prev: number;
  dir: Direction | null;
}

/** A rectangle of tiles, inclusive. */
interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** Chebyshev distance from a tile to the nearest tile of a rectangle (0 inside it). */
function toRect(t: Tile, r: Rect): number {
  const dx = Math.max(r.x0 - t.x, 0, t.x - r.x1);
  const dy = Math.max(r.y0 - t.y, 0, t.y - r.y1);
  return Math.max(dx, dy);
}

function plotRect(state: WorldState, px: number, py: number): Rect {
  const size = state.config.plotSize;
  return { x0: px * size, y0: py * size, x1: px * size + size - 1, y1: py * size + size - 1 };
}

/**
 * Where a resident would putter to now, as up to `PUTTER.steps` moves. Empty when there's nowhere
 * to go (or the resident isn't in the world), which the sim turns down with `nowhere_to_go`.
 *
 * In order of preference: next to the nearest other online resident within `PUTTER.seek` tiles;
 * else onto a neighbor's plot or along the edge of the plot you're building on; else toward the
 * Commons; else any open tile a few steps away. Paths go around blocks and stay in the world and in
 * a small window around you. Where there's a choice (residents equally near, which plot, which
 * tile), a hash of your id, the world's `seq`, and the day picks, so the same world and resident
 * always give the same walk, and the next putter usually gives another.
 */
export function planPutter(state: WorldState, actor: ResidentId): Direction[] {
  const me = state.residents[actor];
  if (!me?.online) return [];
  const seed = fnv1a(`putter:${actor}:${state.seq}:${state.day ?? 0}`);
  /** A number in [0, n) for one named choice. */
  const pick = (n: number, salt: string) => Number.parseInt(fnv1a(`${seed}:${salt}`), 16) % n;

  const others = Object.values(state.residents).filter((r) => r.online && r.id !== actor);
  const occupied = new Set(others.map((r) => tileKey(r.x, r.y)));
  const nodes = reachable(state, me);
  const free = (n: Node) => !occupied.has(tileKey(n.x, n.y));

  /** The walk to `nodes[i]`, cut to `PUTTER.steps` and back off anyone's tile. */
  const walkTo = (i: number): Direction[] => {
    const path: number[] = [];
    for (let at = i; at > 0; at = nodes[at]?.prev ?? 0) path.push(at);
    path.reverse();
    let end = Math.min(path.length, PUTTER.steps);
    while (end > 0 && !free(nodes[path[end - 1] ?? 0] as Node)) end--;
    return path.slice(0, end).map((at) => nodes[at]?.dir as Direction);
  };

  /** The walk toward the tiles `score` rates lowest, or empty if none beats where you stand. */
  const toward = (score: (t: Tile) => number, salt: string): Direction[] => {
    const here = score(me);
    let best = here;
    let fewest = Number.POSITIVE_INFINITY;
    let ties: number[] = [];
    for (let i = 1; i < nodes.length; i++) {
      const n = nodes[i] as Node;
      if (!free(n)) continue;
      const s = score(n);
      if (s >= here) continue;
      if (s < best || (s === best && n.steps < fewest)) {
        best = s;
        fewest = n.steps;
        ties = [i];
      } else if (s === best && n.steps === fewest) {
        ties.push(i);
      }
    }
    if (ties.length === 0) return [];
    return walkTo(ties[pick(ties.length, salt)] as number);
  };

  // 1. Someone to walk up to: stop next to them, never on them.
  const near = others
    .map((r) => ({ r, d: chebyshev(me, r) }))
    .filter(({ d }) => d <= PUTTER.seek && d !== 1)
    .sort((a, b) => a.d - b.d || (a.r.id < b.r.id ? -1 : 1));
  const nearest = near.filter(({ d }) => d === near[0]?.d).length;
  const first = nearest > 0 ? pick(nearest, "resident") : 0;
  const people = [...near.slice(first, nearest), ...near.slice(0, first), ...near.slice(nearest)];
  for (const { r } of people) {
    const steps = toward((t) => adjacency(t, r), `resident:${r.id}`);
    if (steps.length > 0) return steps;
  }

  // 2. A neighbor's plot, or the edge of the plot you're building on.
  const plots = plotGoals(state, me, pick);
  const start = plots.length > 0 ? pick(plots.length, "plot") : 0;
  for (let k = 0; k < plots.length; k++) {
    const goal = plots[(start + k) % plots.length] as PlotGoal;
    const steps = toward(goal.score, goal.salt);
    if (steps.length > 0) return steps;
  }

  // 3. The Commons, where newcomers arrive.
  const c = commonsPlot(state.config);
  const commons = plotRect(state, c.px, c.py);
  const steps = toward((t) => toRect(t, commons), "commons");
  if (steps.length > 0) return steps;

  // 4. Anywhere open a few steps away, two or more if there's room.
  const open = nodes.flatMap((n, i) => (i > 0 && n.steps <= PUTTER.steps && free(n) ? [i] : []));
  const roomy = open.filter((i) => (nodes[i] as Node).steps >= 2);
  const choices = roomy.length > 0 ? roomy : open;
  if (choices.length === 0) return [];
  return walkTo(choices[pick(choices.length, "wander")] as number);
}

/** How far a tile is from standing next to `r`: 0 next to them, worst on their own tile. */
function adjacency(t: Tile, r: Tile): number {
  const d = chebyshev(t, r);
  return d === 0 ? 2 : d - 1;
}

interface PlotGoal {
  score: (t: Tile) => number;
  salt: string;
}

/**
 * Plots worth a visit: each claimed plot next to the one you stand in (or that one) that you can't
 * build on, north to south then west to east, and then a tile on the edge of the plot you stand
 * in, if you can build there.
 */
function plotGoals(
  state: WorldState,
  me: Resident,
  pick: (n: number, salt: string) => number,
): PlotGoal[] {
  const { config } = state;
  const here = plotOf(config, me.x, me.y);
  const goals: PlotGoal[] = [];
  const neighbors = Object.values(state.plots)
    .filter((p) => chebyshev({ x: p.px, y: p.py }, { x: here.px, y: here.py }) <= 1)
    .filter((p) => !canBuildOn(p, me.id))
    .sort((a, b) => a.py - b.py || a.px - b.px);
  for (const p of neighbors) {
    const rect = plotRect(state, p.px, p.py);
    goals.push({ score: (t) => toRect(t, rect), salt: `plot:${p.px},${p.py}` });
  }
  if (canBuildOn(plotAtTile(state, me.x, me.y), me.id)) {
    const r = plotRect(state, here.px, here.py);
    const edge: Tile[] = [];
    for (let y = r.y0; y <= r.y1; y++) {
      for (let x = r.x0; x <= r.x1; x++) {
        const onEdge = x === r.x0 || x === r.x1 || y === r.y0 || y === r.y1;
        if (onEdge && !isSolid(state, x, y) && !(x === me.x && y === me.y)) edge.push({ x, y });
      }
    }
    if (edge.length > 0) {
      const target = edge[pick(edge.length, "edge")] as Tile;
      goals.push({ score: (t) => chebyshev(t, target), salt: "edge" });
    }
  }
  return goals;
}

/**
 * Every tile a resident can walk to without leaving the world, crossing a block, or going more than
 * `PUTTER.window` tiles from where they stand, breadth first. Other residents don't block a path,
 * as they don't block `move`. The first node is where they stand.
 */
function reachable(state: WorldState, from: Tile): Node[] {
  const nodes: Node[] = [{ x: from.x, y: from.y, steps: 0, prev: -1, dir: null }];
  const seen = new Set([tileKey(from.x, from.y)]);
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i] as Node;
    for (const dir of DIRECTIONS) {
      const [dx, dy] = STEP[dir];
      const x = n.x + dx;
      const y = n.y + dy;
      if (Math.abs(x - from.x) > PUTTER.window || Math.abs(y - from.y) > PUTTER.window) continue;
      if (!inBounds(state.config, x, y) || isSolid(state, x, y)) continue;
      const key = tileKey(x, y);
      if (seen.has(key)) continue;
      seen.add(key);
      nodes.push({ x, y, steps: n.steps + 1, prev: i, dir });
    }
  }
  return nodes;
}
