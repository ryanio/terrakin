/**
 * The wild yard (RFC 0052): what the map and the 3D views draw on a plot slot's tiles past its
 * lot, where nobody builds and everyone walks, and the one feature each slot has. Drawing only:
 * nothing here blocks a step or is kept by the world, so it comes from a hash of the tile or the
 * slot, as pets do, and every screen draws the same meadow. Pure and tested (`wild-yard.test.ts`);
 * `Mirror.wildAt` says which tiles are wild, and the painters only paint what this returns.
 */
import { type Biome, mixHex, type Season, tileHash } from "@terrakin/sim";

/**
 * What grows on one wild tile, placed by `fx` and `fy`, fractions of the tile from its top left.
 * Grass is a clump of tufts, flowers a clump of `count` heads in one of two tones, and a bush or a
 * tree stands on its tile, `size` its canopy's radius in tiles, so it never reaches the next.
 */
export type YardGrowth =
  | { kind: "grass"; fx: number; fy: number }
  | { kind: "flowers"; fx: number; fy: number; tone: 0 | 1; count: number }
  | { kind: "bush"; fx: number; fy: number; size: number }
  | { kind: "tree"; fx: number; fy: number; size: number; tone: 0 | 1 | 2 };

/** A wild tile is a plot's yard, or the verge beside a street's road, which grows no trees. */
export type Wild = "yard" | "verge";

/**
 * How much of a biome's wild ground grows each thing, in hundredths, tallest first. What's left is
 * plain grass. A meadow is mostly grass and flowers with a tree every few tiles; a forest's yard is
 * thick with trees and bushes; stone and sand stay sparse.
 */
const GROWTH: Record<Biome, { tree: number; bush: number; flowers: number; grass: number }> = {
  meadow: { tree: 4, bush: 6, flowers: 16, grass: 34 },
  forest: { tree: 10, bush: 9, flowers: 6, grass: 30 },
  stone: { tree: 2, bush: 4, flowers: 4, grass: 20 },
  sand: { tree: 0, bush: 3, flowers: 0, grass: 18 },
};

/** Where in a tile something stands: between 0.3 and 0.7, so it stays inside its tile. */
const spot = (bits: number) => 0.3 + (bits & 7) / 17.5;

/** What grows on wild tile (x, y) of `biome` in `season`, or null for plain ground. */
export function yardGrowth(
  x: number,
  y: number,
  biome: Biome,
  season?: Season,
  wild: Wild = "yard",
): YardGrowth | null {
  // Salted, so the yard never lines up with the scenery the sim's palette puts on the same tile.
  const n = tileHash(x + 40_503, y - 9_133);
  const roll = n % 100;
  const fx = spot(n >>> 8);
  const fy = spot(n >>> 11);
  const g = GROWTH[biome];
  let at = g.tree;
  if (roll < at) {
    if (wild === "verge") return { kind: "bush", fx, fy, size: 0.26 };
    const size = 0.34 + ((n >>> 14) & 3) * 0.035;
    return { kind: "tree", fx: 0.5, fy: 0.5, size, tone: ((n >>> 17) % 3) as 0 | 1 | 2 };
  }
  at += g.bush;
  if (roll < at) return { kind: "bush", fx, fy, size: 0.2 + ((n >>> 14) & 3) * 0.025 };
  at += g.flowers;
  if (roll < at) {
    // Winter has no flowers out, as the sim's own scenery has none.
    if (season === "winter") return { kind: "grass", fx, fy };
    return {
      kind: "flowers",
      fx,
      fy,
      tone: ((n >>> 14) & 1) as 0 | 1,
      count: 3 + ((n >>> 15) % 3),
    };
  }
  at += g.grass;
  if (roll < at) return { kind: "grass", fx, fy };
  return null;
}

/** The one thing that makes a slot unlike its neighbors, drawn in its yard. */
export const FEATURE_KINDS = ["old_tree", "boulder", "flower_bank", "stone_wall"] as const;
type FeatureKind = (typeof FEATURE_KINDS)[number];

/**
 * A slot's feature: its kind and the tiles it covers, counted from the slot's north-west corner,
 * and `side`, the edge of the slot it runs along. An old tree is two tiles square, a boulder one
 * or two, and a flowering bank and an old stone wall a run of tiles along the side.
 */
export interface PlotFeature {
  kind: FeatureKind;
  side: "n" | "e" | "s" | "w";
  tiles: readonly { x: number; y: number }[];
}

const SIDES = ["n", "e", "s", "w"] as const;

/**
 * Slot (px, py)'s feature in a slot `slot` tiles across whose middle `BASE_PLOT` square starts
 * `ring` tiles in (the sim's `insetOf`): one of `FEATURE_KINDS` or none, from a hash of the slot,
 * always in the ring and never in the middle square, where the homes built before the regrid
 * stand. Null when the slot has no ring (a world before its regrid) or no feature.
 */
export function plotFeature(
  px: number,
  py: number,
  slot: number,
  ring: number,
): PlotFeature | null {
  if (ring < 3) return null;
  const n = tileHash(px * 7 + 104_729, py * 13 - 7_919);
  const pick = n % 10;
  // Two slots in ten have none, and the rest share the four kinds evenly.
  if (pick < 2) return null;
  const kind = FEATURE_KINDS[(pick - 2) >> 1] as FeatureKind;
  const side = SIDES[(n >>> 4) & 3] as PlotFeature["side"];
  // Along the side, how far in from its start: a run of `length` keeps a tile clear at each end.
  const along = (length: number) => 1 + ((n >>> 7) % Math.max(1, slot - length - 1));
  /** A tile `depth` in from the side, `step` along it, in the slot's own coordinates. */
  const at = (step: number, depth: number) => {
    switch (side) {
      case "n":
        return { x: step, y: depth };
      case "s":
        return { x: step, y: slot - 1 - depth };
      case "w":
        return { x: depth, y: step };
      case "e":
        return { x: slot - 1 - depth, y: step };
    }
  };
  const tiles: { x: number; y: number }[] = [];
  if (kind === "old_tree") {
    const s = along(2);
    for (const d of [1, 2]) for (const a of [s, s + 1]) tiles.push(at(a, d));
  } else if (kind === "boulder") {
    const s = along(2);
    tiles.push(at(s, 1));
    if ((n >>> 12) & 1) tiles.push(at(s + 1, 1));
  } else if (kind === "flower_bank") {
    // A low curve of flowers: deeper in the middle of its run.
    const length = 6;
    const s = along(length);
    for (let i = 0; i < length; i++) {
      tiles.push(at(s + i, 1));
      if (i > 0 && i < length - 1) tiles.push(at(s + i, 2));
    }
  } else {
    // An old stone wall, half tumbled: a run with one stone gone.
    const length = 7;
    const s = along(length);
    const gap = 2 + ((n >>> 12) % 3);
    for (let i = 0; i < length; i++) if (i !== gap) tiles.push(at(s + i, ring - 2));
  }
  return { kind, side, tiles };
}

/**
 * Slot (px, py)'s feature in world tiles, or null when it has none or when any tile it covers
 * isn't plain wild ground (`open`): a way carried across the yard, a bridge, the sea, or a lot
 * grown over it. A feature draws whole or not at all.
 */
export function featureOn(
  px: number,
  py: number,
  slot: number,
  ring: number,
  open: (x: number, y: number) => boolean,
): (PlotFeature & { world: { x: number; y: number }[] }) | null {
  const f = plotFeature(px, py, slot, ring);
  if (!f) return null;
  const world = f.tiles.map((t) => ({ x: px * slot + t.x, y: py * slot + t.y }));
  return world.every((t) => open(t.x, t.y)) ? { ...f, world } : null;
}

/** Which ways a street's road runs out of its slot: toward each neighbor that is street or square. */
export interface RoadArms {
  n: boolean;
  e: boolean;
  s: boolean;
  w: boolean;
}

/** How wide a street's road is, in tiles. */
const ROAD_WIDTH = 4;

/**
 * Whether tile (lx, ly) of a street slot `slot` tiles across is its road (RFC 0052): a band
 * `ROAD_WIDTH` tiles wide down the middle, running out toward each of `arms`, with the verge
 * either side. A street with no arm runs east and west, as bridges do.
 */
export function onRoad(lx: number, ly: number, slot: number, arms: RoadArms): boolean {
  const lo = Math.floor((slot - ROAD_WIDTH) / 2);
  const hi = lo + ROAD_WIDTH - 1;
  const inX = lx >= lo && lx <= hi;
  const inY = ly >= lo && ly <= hi;
  if (inX && inY) return true;
  const none = !arms.n && !arms.e && !arms.s && !arms.w;
  const e = arms.e || none;
  const w = arms.w || none;
  if (inY && ((e && lx > hi) || (w && lx < lo))) return true;
  if (inX && ((arms.s && ly > hi) || (arms.n && ly < lo))) return true;
  return false;
}

/**
 * The yard's colors, which the map and the 3D views share: three canopy greens a tree takes by its
 * `tone`, a bush's leaves, bark, and an old stone's grey and moss.
 */
export const YARD_LOOK = {
  canopy: ["#5d8a3c", "#6e9a45", "#4d7a3a"],
  bush: "#5a8742",
  bark: "#7a5a3a",
  stone: "#a8a398",
  moss: "#7f9b57",
} as const;

/** Each canopy tone in autumn: one stays green, one turns rust, one gold, so a wood reads mixed. */
const AUTUMN_CANOPY = ["#7d8a3c", "#c8703a", "#d9a53e"] as const;
/** How far toward snow a canopy, a bush, or a stone goes in winter: less than open ground. */
const WINTER_SNOW = 0.38;
const SNOW = "#f4f1ea";

/** A tree's canopy in a season, by its tone. */
export function canopyTone(tone: 0 | 1 | 2, season?: Season): string {
  if (season === "autumn") return AUTUMN_CANOPY[tone];
  const green = YARD_LOOK.canopy[tone];
  return season === "winter" ? mixHex(green, SNOW, WINTER_SNOW) : green;
}

/** A bush's leaves, or an old stone's grey, in a season. */
export function yardTone(hex: string, season?: Season): string {
  if (season === "autumn") return mixHex(hex, "#b08a3e", 0.3);
  return season === "winter" ? mixHex(hex, SNOW, WINTER_SNOW) : hex;
}
