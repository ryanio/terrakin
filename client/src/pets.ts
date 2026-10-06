/**
 * Pets in the world (RFC 0019): where each pet is and what it's doing, for drawing only. The map
 * (`render.ts`) and both 3D views read it, like `motion.ts`. Nothing here reaches the server or the
 * sim (decision 0089): a pet never stands in anyone's way, and two screens may show it a tile apart.
 *
 * A pet trots a tile behind its owner while they're online on the plot their hearth is on. When
 * they're out, it potters around the hearth in the daytime, walking the sim's own routes and
 * napping in the sun, and it sleeps beside the hearth at night and most of the time while they're
 * away. What it does next is picked from the server's clock and a hash of its owner's id, so every
 * screen tells roughly the same story. It looks happy for a few seconds after a pat, and all day
 * after a treat.
 *
 * Times are milliseconds from the page's own clock, except `clock`, the server's. With `still`
 * (prefers-reduced-motion) a pet stands where it's going, without walking or hopping there.
 */
import {
  CROPS,
  type Crop,
  type Direction,
  type Ground,
  ITEM_INFO,
  type ItemKind,
  type Pet,
  type PetCoat,
  type PetKind,
  plotOf,
  route,
  STEP,
  type Tile,
  tileKey,
  treatedToday,
  type WorldConfig,
  walkTree,
} from "@terrakin/sim";

// ---------- words ----------

/** A kind in plain words: "Cat", "Hedgehog". */
export const PET_WORDS: Record<PetKind, string> = {
  cat: "Cat",
  dog: "Dog",
  rabbit: "Rabbit",
  hedgehog: "Hedgehog",
  duck: "Duck",
  frog: "Frog",
  fox: "Fox",
  tortoise: "Tortoise",
};

/** A coat in plain words: "Ginger", "Star". */
export const coatWord = (coat: PetCoat): string => coat.charAt(0).toUpperCase() + coat.slice(1);

/** "a ginger cat". */
export const petLine = (pet: Pick<Pet, "kind" | "coat">): string =>
  `a ${pet.coat} ${PET_WORDS[pet.kind].toLowerCase()}`;

/**
 * What to call a pet in a sentence: its name, or "your cat" ("their cat") while its owner's words
 * are held back and its name is empty. The name is its owner's words: text only.
 */
export function petCalled(
  pet: Pick<Pet, "kind" | "name"> | undefined,
  whose: "your" | "their" = "your",
): string {
  if (!pet) return `${whose} pet`;
  return pet.name || `${whose} ${PET_WORDS[pet.kind].toLowerCase()}`;
}

/** "a strawberry", "a bunch of herbs". */
export function aThing(kind: ItemKind): string {
  const name = ITEM_INFO[kind].name.toLowerCase();
  return `${/^[aeiou]/.test(name) ? "an" : "a"} ${name}`;
}

/** The produce a treat can be, in the order the garden lists it. */
export const TREATS: readonly Crop[] = CROPS;

// ---------- where it is ----------

/** How fast a pet walks, in tiles a second: keeping up with its owner, or pottering about. */
export const PET_TROT = 5.6;
export const PET_POTTER = 2;
/** How long a pet looks happy after a pat. */
export const HAPPY_MS = 4_500;
/** How often a pet at home picks something new to do, from the server's clock. */
export const SLOT_MS = 11_000;
/** How far from its hearth a pet potters, in tiles. */
export const WANDER = 3;
/** Further from where it's going than this, a pet skips there instead of walking. */
const MAX_WALK = 8;
/** How far toward the hearth a pet curled up beside it leans, in tiles. */
const SNUGGLE = 0.32;
const HOP = 0.1;

/** What a pet is doing. */
export type PetDoing = "follow" | "potter" | "nap" | "sleep";

export interface PetPose {
  /** Where its feet are, in tiles. */
  x: number;
  y: number;
  /** 1 faces right, -1 left. */
  facing: 1 | -1;
  /** Curled up with its eyes shut. */
  asleep: boolean;
  /** Tiles off the ground, while it hops along. */
  lift: number;
  /** Happy eyes: a pat a moment ago, or a treat today. */
  happy: boolean;
  /** 0 to 1 through the heart that floats up after a pat, or undefined. */
  heart: number | undefined;
  doing: PetDoing;
}

/** What a pet needs to know about the world this frame. */
export interface PetScene {
  /** The page's clock, ms. */
  now: number;
  /** The server's clock, ms: the same on every screen. */
  clock: number;
  night: boolean;
  still: boolean;
  ground: Ground;
  config: WorldConfig;
  /** The world's day, for today's treat. */
  day: number | undefined;
  /** Where its owner is drawn now and which way they face, when they're online. */
  drawn?: { x: number; y: number; facing: Direction | undefined } | undefined;
}

interface Track {
  x: number;
  y: number;
  facing: 1 | -1;
  /** Tiles still to walk, nearest first. */
  path: Tile[];
  /** Where the path leads, as a tile key. */
  goal: string;
  at: number;
  /** When it last took a step, for the hop. */
  stepAt: number;
}

/** A small stable hash for picking what a pet does. Not state: only for drawing. */
export function petHash(id: string, n: number): number {
  let h = 2166136261 ^ n;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  h = Math.imul(h ^ (h >>> 15), 2246822507);
  return (h ^ (h >>> 13)) >>> 0;
}

const open = (ground: Ground, t: Tile) =>
  t.x >= 0 &&
  t.y >= 0 &&
  t.x < ground.config.width &&
  t.y < ground.config.height &&
  !ground.obstacle(t.x, t.y);

/**
 * Where a pet curls up: the first open tile east, west, south, or north of the hearth, or the
 * hearth itself when it's walled in.
 */
export function sleepSpot(ground: Ground, hearth: Tile): Tile {
  for (const [dx, dy] of [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ] as const) {
    const t = { x: hearth.x + dx, y: hearth.y + dy };
    if (open(ground, t)) return t;
  }
  return hearth;
}

/** The open tiles a pet can walk to within `WANDER` of its hearth, the hearth itself left out. */
export function potterSpots(ground: Ground, hearth: Tile): Tile[] {
  return walkTree(ground, hearth, WANDER)
    .slice(1)
    .map(({ x, y }) => ({ x, y }));
}

/**
 * The tile a following pet heads for: behind its owner (the opposite of the way they face), else
 * the open tile beside them nearest the pet. Where it already sits beside them, it stays.
 */
export function followSpot(
  ground: Ground,
  owner: Tile,
  facing: Direction | undefined,
  pet: Tile,
): Tile {
  const beside = Math.max(Math.abs(pet.x - owner.x), Math.abs(pet.y - owner.y)) === 1;
  if (beside && open(ground, pet)) return pet;
  const [fx, fy] = STEP[facing ?? "s"];
  const behind = { x: owner.x - fx, y: owner.y - fy };
  if (open(ground, behind)) return behind;
  let best: Tile | undefined;
  let bestD = Number.POSITIVE_INFINITY;
  for (const [dx, dy] of Object.values(STEP)) {
    const t = { x: owner.x + dx, y: owner.y + dy };
    if (!open(ground, t)) continue;
    const d = Math.hypot(t.x - pet.x, t.y - pet.y);
    if (d < bestD) {
      bestD = d;
      best = t;
    }
  }
  return best ?? owner;
}

/** What a pet at home does in one slot, and where. Pure: the same on every screen. */
export function homePlan(
  id: string,
  away: boolean,
  night: boolean,
  clock: number,
  ground: Ground,
  hearth: Tile,
): { doing: PetDoing; to: Tile } {
  const bed = sleepSpot(ground, hearth);
  if (night) return { doing: "sleep", to: bed };
  // Each pet's slots start at their own moment, so a street of pets doesn't move in step.
  const slot = Math.floor((clock + (petHash(id, 0) % SLOT_MS)) / SLOT_MS);
  const h = petHash(id, slot + 1);
  const roll = h % 100;
  // While its owner is away it mostly sleeps by the hearth; while they're out and about, it plays.
  const sleeps = away ? 60 : 25;
  const naps = away ? 15 : 30;
  if (roll < sleeps) return { doing: "sleep", to: bed };
  const spots = potterSpots(ground, hearth);
  if (spots.length === 0) return { doing: "sleep", to: bed };
  const to = spots[(h >>> 8) % spots.length] as Tile;
  return { doing: roll < sleeps + naps ? "nap" : "potter", to };
}

const sameTile = (a: Tile, b: Tile) => a.x === b.x && a.y === b.y;

/** The tiles a walk from `from` to `to` passes, by the sim's walking rule, `to` last. */
function walkTiles(ground: Ground, from: Tile, to: Tile): Tile[] {
  const tiles: Tile[] = [];
  let at = from;
  for (const dir of route(ground, from, to, 0, MAX_WALK + 2)) {
    const [dx, dy] = STEP[dir];
    at = { x: at.x + dx, y: at.y + dy };
    tiles.push(at);
  }
  return tiles;
}

/** Where every pet is drawn. One per page, like `Motion`. */
export class PetMotion {
  private readonly tracks = new Map<string, Track>();
  private readonly patted = new Map<string, number>();

  /** Someone patted this owner's pet: it looks happy, with a heart, for a moment. */
  pat(owner: string, now: number) {
    this.patted.set(owner, now);
  }

  /**
   * Where `owner`'s pet is now, and what it's doing. Undefined when they have no pet, or when it
   * has nowhere to be (they're away with no hearth).
   */
  pose(
    owner: { id: string; online: boolean; hearth: Tile | null; pet?: Pet | undefined },
    scene: PetScene,
  ): PetPose | undefined {
    const pet = owner.pet;
    if (!pet) return undefined;
    const { ground, now, still } = scene;
    const hearth = owner.hearth;
    const drawn = owner.online ? scene.drawn : undefined;
    const ownerTile = drawn ? { x: Math.round(drawn.x), y: Math.round(drawn.y) } : undefined;
    // It keeps to the plot its hearth is on.
    const home = hearth ? plotOf(scene.config, hearth.x, hearth.y) : undefined;
    const onHome =
      ownerTile &&
      (!home ||
        (plotOf(scene.config, ownerTile.x, ownerTile.y).px === home.px &&
          plotOf(scene.config, ownerTile.x, ownerTile.y).py === home.py));
    if (!onHome && !hearth) return undefined;

    let t = this.tracks.get(owner.id);
    const here = t ? { x: Math.round(t.x), y: Math.round(t.y) } : undefined;
    let doing: PetDoing;
    let to: Tile;
    if (onHome && ownerTile) {
      doing = "follow";
      to = followSpot(ground, ownerTile, drawn?.facing, here ?? ownerTile);
    } else {
      const plan = homePlan(
        owner.id,
        !owner.online,
        scene.night,
        scene.clock,
        ground,
        hearth as Tile,
      );
      doing = plan.doing;
      to = plan.to;
    }
    if (!t) {
      t = { x: to.x, y: to.y, facing: 1, path: [], goal: tileKey(to.x, to.y), at: now, stepAt: 0 };
      this.tracks.set(owner.id, t);
    }
    const goal = tileKey(to.x, to.y);
    if (goal !== t.goal) {
      t.goal = goal;
      const from = { x: Math.round(t.x), y: Math.round(t.y) };
      const far = Math.max(Math.abs(to.x - t.x), Math.abs(to.y - t.y)) > MAX_WALK;
      t.path = still || far ? [] : walkTiles(ground, from, to);
      // Too far, or no way there: it skips ahead rather than walk through a wall.
      if (still || far || !sameTile(t.path.at(-1) ?? from, to)) {
        t.path = [];
        t.x = to.x;
        t.y = to.y;
      }
    }
    // Walk along the path.
    const speed = doing === "follow" ? PET_TROT : PET_POTTER;
    let budget = (Math.min(250, Math.max(0, now - t.at)) / 1000) * speed;
    t.at = now;
    while (budget > 0 && t.path.length > 0) {
      const next = t.path[0] as Tile;
      const dx = next.x - t.x;
      const dy = next.y - t.y;
      const d = Math.hypot(dx, dy);
      if (Math.abs(dx) > 0.01) t.facing = dx > 0 ? 1 : -1;
      if (d <= budget) {
        t.x = next.x;
        t.y = next.y;
        budget -= d;
        t.path.shift();
        t.stepAt = now;
      } else {
        t.x += (dx / d) * budget;
        t.y += (dy / d) * budget;
        budget = 0;
      }
    }
    const moving = t.path.length > 0;
    const arrived = !moving && t.x === to.x && t.y === to.y;
    let x = t.x;
    let y = t.y;
    let facing = t.facing;
    if (!moving && doing === "follow" && drawn && Math.abs(drawn.x - t.x) > 0.01) {
      // Sitting beside its owner, it looks at them.
      facing = drawn.x > t.x ? 1 : -1;
    }
    const asleep = arrived && (doing === "sleep" || doing === "nap");
    if (asleep && doing === "sleep" && hearth && !sameTile(to, hearth)) {
      // Curled up against the hearth, facing it.
      x += (hearth.x - to.x) * SNUGGLE;
      y += (hearth.y - to.y) * SNUGGLE;
      if (hearth.x !== to.x) facing = hearth.x > to.x ? 1 : -1;
    }
    const lift =
      moving && !still ? Math.abs(Math.sin(((now - t.stepAt) / 1000) * speed * Math.PI)) * HOP : 0;
    const pattedAt = this.patted.get(owner.id);
    const since = pattedAt === undefined ? Number.POSITIVE_INFINITY : now - pattedAt;
    if (since >= HAPPY_MS) this.patted.delete(owner.id);
    return {
      x,
      y,
      facing,
      asleep: asleep && since >= HAPPY_MS,
      lift,
      happy: since < HAPPY_MS || treatedToday(pet, scene.day),
      heart: since < HAPPY_MS ? since / HAPPY_MS : undefined,
      doing,
    };
  }

  /** Forget pets no longer drawn, so the map stays the size of what's on screen. */
  keep(ids: ReadonlySet<string>) {
    for (const id of this.tracks.keys()) if (!ids.has(id)) this.tracks.delete(id);
  }
}
