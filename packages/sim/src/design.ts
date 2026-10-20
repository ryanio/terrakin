import type { BuildPlan } from "./build";
import { type PlotTiles, plotTiles } from "./map";
import type { BlockKind, Direction, Tile, WorldConfig, WorldState } from "./types";
import { DIRECTIONS, type Ground, groundOf, stepFrom } from "./walk";
import { blocksWalkers, chebyshev, STEP, shopTiles, townHallTiles } from "./world";

/**
 * Notes about a home (RFC 0032): what the server says about a plot after reading it, facts and
 * suggestions, never refusals. `designNotes` reads one plot's ground floor, as it stands or as a
 * plan leaves it, and changes nothing. "Can be walked to" means what `move` means: the sim's own
 * step rule (`stepFrom`) over the plot, entered from any open tile on its edge.
 *
 * A note's words are the fixed strings here with numbers and coordinates (plan coordinates, from
 * the plot's north-west corner) in them, and never a name or anything a resident wrote.
 */

/** Every number the notes read. */
export const DESIGN = {
  /** `crowded` once blocks cover more than this share of the ground floor's tiles. */
  crowded: 0.5,
  /** `many_materials` at this many wall materials, glass left out. */
  wallMaterials: 3,
} as const;

/** The notes, in the order an answer lists them. */
export const NOTE_CODES = [
  "hearth_walled_in",
  "walled_in",
  "out_of_reach",
  "no_path",
  "crowded",
  "many_materials",
] as const;
export type NoteCode = (typeof NOTE_CODES)[number];

export interface DesignNote {
  code: NoteCode;
  text: string;
  /** The tiles it's about, from the plot's north-west corner. */
  tiles: Tile[];
}

/** Blocks someone has to stand near to use, with how near: a pond is fished from beside it. */
const STATIONS: Partial<Record<BlockKind, "reach" | "beside">> = {
  planter: "reach",
  kitchen: "reach",
  workbench: "reach",
  pedestal: "reach",
  frame: "reach",
  pond: "beside",
};

/** The wall materials `many_materials` counts. Glass is for windows. */
const WALL_MATERIALS: readonly BlockKind[] = ["wood", "stone", "leaf"];

/** Steps along the grid, for the path a note suggests: straight paths read better. */
const ALONG: readonly Direction[] = ["n", "e", "s", "w"];

const words = (t: Tile) => `(${t.x}, ${t.y})`;
const key = (t: Tile) => `${t.x},${t.y}`;
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Notes about plot (`px`, `py`) as it stands, or as `plan` would leave it. Empty is a clean home. */
export function designNotes(
  state: WorldState,
  px: number,
  py: number,
  plan?: BuildPlan,
): DesignNote[] {
  const tiles = plotTiles(state, px, py, plan);
  if (!tiles) return [];
  return plotNotes(tiles, {
    config: state.config,
    solidBuildings: state.solidBuildings === true,
    townHall: townHallTiles(state),
    shop: state.shop ? shopTiles(state) : [],
  });
}

/** What the notes read besides the plot: the world's size and reach, and which buildings stop walkers. */
export interface NoteFacts {
  config: WorldConfig;
  solidBuildings: boolean;
  /** Where the halls and the shops stand, as `groundOf` takes them (RFC 0038). */
  townHall: readonly Tile[];
  shop: readonly Tile[];
}

/**
 * The notes for a plot's tiles, from plain facts, so the web's build bar asks the same question
 * of its mirror that `designNotes` asks of the world (decision 0052).
 */
export function plotNotes(plot: PlotTiles, facts: NoteFacts): DesignNote[] {
  const S = plot.size;
  const x0 = plot.px * S;
  const y0 = plot.py * S;
  const all: Tile[] = [];
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) all.push({ x, y });
  const blockAt = (t: Tile) => plot.block(0, t.x, t.y);
  if (all.every((t) => blockAt(t) === undefined)) return [];

  // The sim's walking ground on this plot, with everything off it in the way.
  const open = (t: Tile, removed?: Tile) =>
    t.x >= 0 &&
    t.y >= 0 &&
    t.x < S &&
    t.y < S &&
    (!blocksWalkers(blockAt(t)) || sameTile(t, removed));
  const groundFor = (removed?: Tile): Ground =>
    groundOf({
      config: facts.config,
      hasBlock: (x, y) => !open({ x: x - x0, y: y - y0 }, removed),
      solidBuildings: facts.solidBuildings,
      townHall: facts.townHall,
      shop: facts.shop,
    });
  /** Every tile a walk reaches from `from` over `dirs`, keeping to tiles `ok` allows. */
  const walk = (
    from: Tile[],
    ground: Ground,
    dirs: readonly Direction[],
    ok: (t: Tile) => boolean = () => true,
  ): Map<string, Tile | null> => {
    const came = new Map<string, Tile | null>();
    const queue: Tile[] = [];
    for (const t of from) {
      if (came.has(key(t)) || ground.obstacle(x0 + t.x, y0 + t.y) || !ok(t)) continue;
      came.set(key(t), null);
      queue.push(t);
    }
    for (let i = 0; i < queue.length; i++) {
      const at = queue[i] as Tile;
      for (const dir of dirs) {
        const step = stepFrom(ground, { x: x0 + at.x, y: y0 + at.y }, dir);
        if (!step.ok) continue;
        const to = { x: step.to.x - x0, y: step.to.y - y0 };
        if (came.has(key(to)) || !ok(to)) continue;
        came.set(key(to), at);
        queue.push(to);
      }
    }
    return came;
  };
  const ground = groundFor();
  const edge = all.filter((t) => isEdgeKey(key(t), S));
  const reached = walk(edge, ground, DIRECTIONS);

  const notes: DesignNote[] = [];
  const shut = new Set<string>();
  // A hearth nobody can walk to, and a wall that would open the way.
  for (const hearth of plot.hearths) {
    if (reached.has(key(hearth))) continue;
    const inside = walk([hearth], ground, DIRECTIONS);
    for (const k of inside.keys()) shut.add(k);
    // A wall beside the hearth's room whose removal opens the way, one with a path beside it first.
    const walls = all.filter((t) => {
      const block = blockAt(t);
      return (
        block !== undefined &&
        (block === "glass" || WALL_MATERIALS.includes(block)) &&
        [...inside.keys()].map(tileOf).some((s) => Math.abs(s.x - t.x) + Math.abs(s.y - t.y) === 1)
      );
    });
    const pathBeside = (t: Tile) =>
      ALONG.some((dir) => {
        const [dx, dy] = STEP[dir];
        return (
          !inside.has(key({ x: t.x + dx, y: t.y + dy })) &&
          plot.ground(0, t.x + dx, t.y + dy) !== undefined
        );
      });
    const opens = (wall: Tile) => walk(edge, groundFor(wall), DIRECTIONS).has(key(hearth));
    const door = walls.find((w) => pathBeside(w) && opens(w)) ?? walls.find(opens);
    notes.push(
      door
        ? {
            code: "hearth_walled_in",
            text: `Nobody can walk to the hearth at ${words(hearth)}: the walls around it have no gap. Take one away for a doorway, like the wall at ${words(door)}.`,
            tiles: [door],
          }
        : {
            code: "hearth_walled_in",
            text: `Nobody can walk to the hearth at ${words(hearth)}. Open a way to it from the edge of the plot.`,
            tiles: [hearth],
          },
    );
  }

  // Open tiles nobody can walk to, past any hearth's.
  const lost = all.filter((t) => open(t) && !reached.has(key(t)) && !shut.has(key(t)));
  if (lost.length > 0) {
    notes.push({
      code: "walled_in",
      text: `Nobody can walk to ${plural(lost.length, "open tile", "open tiles")} here, like ${words(lost[0] as Tile)}: walls close ${lost.length === 1 ? "it" : "them"} in. Leave a gap, or fill ${lost.length === 1 ? "it" : "them"}.`,
      tiles: lost,
    });
  }

  // Planters, stations, stands, and ponds nobody can get near enough to use.
  const standable = [...reached.keys()].map(tileOf);
  const far = all.filter((t) => {
    const block = blockAt(t);
    const how = block === undefined ? undefined : STATIONS[block];
    if (!how) return false;
    const near = how === "beside" ? 1 : facts.config.reach;
    return !standable.some((s) => chebyshev(s, t) <= near);
  });
  if (far.length > 0) {
    const first = far[0] as Tile;
    const kind = blockAt(first);
    const near = kind === "pond" ? "right beside it" : `within ${facts.config.reach} tiles of it`;
    const others =
      far.length > 1 ? `, or ${plural(far.length - 1, "other", "others")} like it` : "";
    notes.push({
      code: "out_of_reach",
      text: `Nobody can get near enough to use the ${kind} at ${words(first)}${others}. Leave a tile someone can walk to ${near}.`,
      tiles: far,
    });
  }

  // A path: some ground at all, and from each hearth to the edge over path and flooring. The
  // tiles beside the hearth and a doorway (an open tile between two walls) needn't be paved.
  const wall = (x: number, y: number) =>
    x >= 0 && y >= 0 && x < S && y < S && blocksWalkers(blockAt({ x, y }));
  const doorway = (t: Tile) =>
    (wall(t.x, t.y - 1) && wall(t.x, t.y + 1)) || (wall(t.x - 1, t.y) && wall(t.x + 1, t.y));
  const anyGround = plot.floors.some((floor) =>
    all.some((t) => plot.ground(floor, t.x, t.y) !== undefined),
  );
  const FREE = "Dirt, sand, moss, and fallen leaves cost nothing.";
  if (!anyGround) {
    notes.push({
      code: "no_path",
      text: `This plot has no path or flooring. ${FREE}`,
      tiles: [],
    });
  } else {
    for (const hearth of plot.hearths) {
      if (!reached.has(key(hearth))) continue;
      const paved = (t: Tile) =>
        chebyshev(t, hearth) <= 1 || doorway(t) || plot.ground(0, t.x, t.y) !== undefined;
      if ([...walk([hearth], ground, DIRECTIONS, paved).keys()].some((k) => isEdgeKey(k, S)))
        continue;
      // The tiles a straight walk out would pave, from the hearth to the nearest edge.
      const came = walk([hearth], ground, ALONG);
      const out = [...came.keys()].find((k) => isEdgeKey(k, S));
      const route: Tile[] = [];
      for (let k = out; k !== undefined; ) {
        route.unshift(tileOf(k));
        const prev = came.get(k);
        k = prev ? key(prev) : undefined;
      }
      const lay = route.filter((t) => !paved(t));
      const from = lay[0];
      const to = lay.at(-1);
      const where =
        from && to
          ? lay.length === 1
            ? ` Lay one at ${words(from)}.`
            : ` Lay one from ${words(from)} to ${words(to)}.`
          : "";
      notes.push({
        code: "no_path",
        text: `No path leads from the hearth at ${words(hearth)} to the edge of the plot.${where} ${FREE}`,
        tiles: lay,
      });
    }
  }

  // Room to walk and grow.
  const covered = all.filter((t) => blockAt(t) !== undefined).length;
  if (covered > DESIGN.crowded * S * S) {
    notes.push({
      code: "crowded",
      text: `Blocks cover ${covered} of the plot's ${S * S} tiles. A home reads better with at least half its plot left open, to walk and to grow.`,
      tiles: [],
    });
  }

  // Walls in one or two materials, with glass for windows.
  const materials = WALL_MATERIALS.filter((m) =>
    plot.floors.some((floor) => all.some((t) => plot.block(floor, t.x, t.y) === m)),
  );
  if (materials.length >= DESIGN.wallMaterials) {
    notes.push({
      code: "many_materials",
      text: `The walls here are in ${materials.length} materials: ${materials.join(", ")}. Two at most, with glass for windows, reads as one home.`,
      tiles: [],
    });
  }
  return notes;
}

function tileOf(k: string): Tile {
  const [x, y] = k.split(",").map(Number) as [number, number];
  return { x, y };
}

function isEdgeKey(k: string, S: number): boolean {
  const { x, y } = tileOf(k);
  return x === 0 || y === 0 || x === S - 1 || y === S - 1;
}

function sameTile(a: Tile, b: Tile | undefined): boolean {
  return b !== undefined && a.x === b.x && a.y === b.y;
}
