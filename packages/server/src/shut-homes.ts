import {
  chebyshev,
  clearCost,
  type Ground,
  nearestCounter,
  plotAtTile,
  plotOf,
  plotsOwnedBy,
  type WorldState,
  walkTree,
  walkWords,
  worldGround,
} from "@terrakin/sim";

type Tile = { x: number; y: number };

/**
 * Homes the town can't be walked to from (decision 0343): every resident whose hearth has no walk
 * to within reach of the shop counter they are sent to, with the blocks that would each open one
 * on their own. The check-in's line for a home like this reads the same walk, so the two never
 * disagree about who is shut in.
 */
export interface ShutHome {
  residentId: string;
  hearth: Tile;
  /** How many tiles the walk from the hearth reaches. */
  reached: number;
  /** Blocks on claimed plots whose clearing alone opens a walk, north to south, west to east. */
  frees: { x: number; y: number; block: string; ownerId: string }[];
}

/** Whether a walk from `from` on `ground` gets within reach of `to`, and the tiles it reaches. */
function walkOut(state: WorldState, ground: Ground, from: Tile, to: Tile) {
  const world = Math.max(state.config.width, state.config.height);
  const nodes = walkTree(ground, from, world);
  const out = nodes.some((n) => chebyshev(n, to) <= state.config.reach);
  return { out, nodes };
}

/** The ground with the block at (x, y) taken away, and everything else as the rules see it. */
function without(ground: Ground, x: number, y: number): Ground {
  return {
    config: ground.config,
    obstacle: (tx, ty) => (tx === x && ty === y ? undefined : ground.obstacle(tx, ty)),
    ...(ground.edge ? { edge: ground.edge } : {}),
  };
}

/**
 * Whether the hearth at `from` has a walk to its counter once the block at `cleared` is gone.
 * The staff route reads it to say whether a clear did what it was for.
 */
export function walksOutWithout(state: WorldState, from: Tile, cleared?: Tile): boolean {
  const ground = worldGround(state);
  const g = cleared ? without(ground, cleared.x, cleared.y) : ground;
  return walkOut(state, g, from, nearestCounter(state, from)).out;
}

/**
 * One resident's home, if the town can't be walked to from it; null when it can, or they have no
 * hearth. A walk that arrives is found by `walkWords`, which looks near first, so an open home
 * costs a short search; only a shut one walks every tile it can reach to find what would free it.
 */
export function shutHomeOf(state: WorldState, residentId: string): ShutHome | null {
  if (!state.shop) return null;
  const home = state.residents[residentId]?.hearth;
  if (!home) return null;
  const door = nearestCounter(state, home);
  const { reach } = state.config;
  if (chebyshev(home, door) <= reach || walkWords(state, home, door, reach) !== "") return null;
  const ground = worldGround(state);
  const { out, nodes } = walkOut(state, ground, home, door);
  if (out) return null;
  // A block that opens a way must touch a tile the walk already reaches, so only those are tried.
  const reached = new Set(nodes.map((n) => `${n.x},${n.y}`));
  const tried = new Set<string>();
  const frees: ShutHome["frees"] = [];
  for (const n of nodes) {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const x = n.x + dx;
        const y = n.y + dy;
        const key = `${x},${y}`;
        if (reached.has(key) || tried.has(key)) continue;
        tried.add(key);
        const block = state.blocks[key];
        const plot = plotAtTile(state, x, y);
        if (block === undefined || !plot) continue;
        if (walkOut(state, without(ground, x, y), home, door).out) {
          frees.push({ x, y, block, ownerId: plot.ownerId });
        }
      }
    }
  }
  frees.sort((a, b) => a.y - b.y || a.x - b.x);
  return { residentId, hearth: { x: home.x, y: home.y }, reached: nodes.length, frees };
}

/** Every shut home in the world, in the order residents joined. Empty before the shop opens. */
export function shutHomes(state: WorldState): ShutHome[] {
  return Object.keys(state.residents).flatMap((id) => shutHomeOf(state, id) ?? []);
}

/** The block among `frees` that costs its owner least (`clearCost`), north to south on a tie. */
export function cheapestFree(frees: readonly ShutHome["frees"][number][]) {
  return frees.reduce<ShutHome["frees"][number] | undefined>(
    (best, f) => (!best || clearCost(f.block) < clearCost(best.block) ? f : best),
    undefined,
  );
}

/**
 * Whether `ownerId` hears about a home whose hearth is at `hearth` in their check-in: when it's on
 * one of their plots or a plot beside one, the reach `homesShutBy` walks.
 */
export function toldNear(state: WorldState, ownerId: string, hearth: Tile): boolean {
  const at = plotOf(state.config, hearth.x, hearth.y);
  return plotsOwnedBy(state, ownerId).some(
    (m) => Math.abs(m.px - at.px) <= 1 && Math.abs(m.py - at.py) <= 1,
  );
}

/**
 * Other residents' homes that a block on `ownerId`'s plots shuts in, and that they can't free
 * themselves (no block on their own plot opens a way), each with the cheapest of `ownerId`'s
 * blocks that would. A block on a plot can only shut in a home its walk reaches, so only hearths
 * on the owner's plots and the plots around them are walked.
 */
export function homesShutBy(
  state: WorldState,
  ownerId: string,
): { home: ShutHome; block: ShutHome["frees"][number] }[] {
  if (!state.shop || plotsOwnedBy(state, ownerId).length === 0) return [];
  const out: { home: ShutHome; block: ShutHome["frees"][number] }[] = [];
  for (const resident of Object.values(state.residents)) {
    if (resident.id === ownerId || !resident.hearth) continue;
    if (!toldNear(state, ownerId, resident.hearth)) continue;
    const home = shutHomeOf(state, resident.id);
    if (!home || home.frees.some((f) => f.ownerId === resident.id)) continue;
    const block = cheapestFree(home.frees.filter((f) => f.ownerId === ownerId));
    if (block) out.push({ home, block });
  }
  return out;
}
