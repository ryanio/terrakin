import {
  chebyshev,
  type Ground,
  nearestCounter,
  plotAtTile,
  type WorldState,
  walkTree,
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

/** Every shut home in the world, in the order residents joined. Empty before the shop opens. */
export function shutHomes(state: WorldState): ShutHome[] {
  if (!state.shop) return [];
  const ground = worldGround(state);
  const shut: ShutHome[] = [];
  for (const resident of Object.values(state.residents)) {
    const home = resident.hearth;
    if (!home) continue;
    const door = nearestCounter(state, home);
    const { out, nodes } = walkOut(state, ground, home, door);
    if (out) continue;
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
    shut.push({
      residentId: resident.id,
      hearth: { x: home.x, y: home.y },
      reached: nodes.length,
      frees,
    });
  }
  return shut;
}
