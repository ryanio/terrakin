/**
 * The world's palette: ground tones per biome, blocks, and the hearth, plus the per-tile scenery
 * (tufts, flowers, and autumn's fallen leaves) the ground grows, and how each season dresses it.
 * Presentation only, like the looks catalog: no rule reads any of it. It lives here so the
 * client's world renderer (`client/src/render.ts`) and the plot photos drawn at the edge (`cards/`,
 * through `server/src/plot-photo.ts`) use the same colors and put the same tuft on the same tile.
 */

import { type Biome, biomeAt } from "./biome";
import type { ThemePalette } from "./looks";
import type { Season } from "./season";
import { type BlockKind, BUILDING_BLOCKS, type WorldConfig } from "./types";

/** Ground tones per biome, picked per tile by `tileHash`, so the ground has texture. */
export const GROUND: Readonly<Record<Biome, readonly string[]>> = {
  meadow: ["#a5c682", "#a1c27d", "#a9c986", "#9dbe79"],
  forest: ["#8fb26a", "#8aab64", "#93b56e", "#86a660"],
  stone: ["#b3ab9b", "#afa798", "#b7afa0", "#aba394"],
  // A little deeper and greener than the Commons plaza and the area outside the world, so a sand
  // patch never blends into either.
  sand: ["#d6c08a", "#d2bb84", "#dac590", "#cdb67f"],
};
/** The Commons plaza's sandy tones. */
export const COMMONS_GROUND: readonly string[] = ["#efdcab", "#ebd7a4", "#f2e1b3", "#e8d39f"];
/** Beyond the edge of the world. */
export const OUTSIDE_GROUND = "#e6d6b6";

export const BLOCK_COLORS: Readonly<Record<BlockKind, string>> = {
  wood: "#b8834f",
  stone: "#a39d93",
  glass: "#bfe0ea",
  leaf: "#6b9a4a",
  planter: "#8a5a36",
  kitchen: "#c8674a",
  workbench: "#9a6b43",
  // Town shop decor (RFC 0008): the main color each is drawn around.
  lantern: "#f2b544",
  frame: "#c9a25a",
  fence: "#e8dcc4",
  bench: "#7a8f5a",
  // A pale stone plinth for a made thing on display (RFC 0005 step 3).
  pedestal: "#e9e1d0",
  // Autumn decor (RFC 0017): golden straw, and the scarecrow's red shirt.
  hay_bale: "#e2bf62",
  scarecrow: "#c4573c",
};

/** The hearth's roof (and the Town Hall's). */
export const HEARTH_COLOR = "#d9653a";
/** The hearth's door. */
export const HEARTH_DOOR = "#f2b84b";
/** Storybook paper: the hearth's walls, name tags. */
export const PAPER = "#fffaf0";
/** Grass tufts, drawn as strokes. */
export const TUFT_STROKE = "rgba(78, 112, 54, 0.45)";
/** The two flower colors. */
export const FLOWER_TONES: readonly [string, string] = ["#fff4d6", "#f2b84b"];
/** Fallen leaves in autumn: rust, amber, and gold. */
export const LEAF_TONES: readonly [string, string, string] = ["#c8643a", "#e0913a", "#e8b84a"];
/** How much a theme tints its owner's plot. */
export const THEME_TINT_ALPHA = 0.34;

/** Autumn warms the grass toward this gold; winter lays this snow over everything. */
const AUTUMN_GOLD = "#d4a94f";
const SNOW = "#f3f5f7";

/** The ground's tones in one season: per biome, and the Commons plaza. */
export interface SeasonGround {
  ground: Readonly<Record<Biome, readonly string[]>>;
  commons: readonly string[];
}

const toward = (tones: readonly string[], to: string, t: number) =>
  tones.map((tone) => mixHex(tone, to, t));

/**
 * How each season dresses the ground. Spring and summer keep the tones above; autumn warms the
 * grass, and winter lies snowy on every biome and frosts the Commons.
 */
export const SEASON_GROUND: Readonly<Record<Season, SeasonGround>> = {
  spring: { ground: GROUND, commons: COMMONS_GROUND },
  summer: { ground: GROUND, commons: COMMONS_GROUND },
  autumn: {
    ground: {
      meadow: toward(GROUND.meadow, AUTUMN_GOLD, 0.32),
      forest: toward(GROUND.forest, AUTUMN_GOLD, 0.28),
      stone: toward(GROUND.stone, AUTUMN_GOLD, 0.08),
      sand: GROUND.sand,
    },
    commons: COMMONS_GROUND,
  },
  winter: {
    ground: {
      meadow: toward(GROUND.meadow, SNOW, 0.74),
      forest: toward(GROUND.forest, SNOW, 0.7),
      stone: toward(GROUND.stone, SNOW, 0.7),
      sand: toward(GROUND.sand, SNOW, 0.64),
    },
    commons: toward(COMMONS_GROUND, SNOW, 0.5),
  },
};

/**
 * A ground color as a season wears it, for ground drawn outside the biome palette (a plot's tint,
 * the 3D plot view's meadow): the same mix the season gives meadow grass.
 */
export function seasonTone(hex: string, season: Season | undefined): string {
  if (season === "autumn") return mixHex(hex, AUTUMN_GOLD, 0.32);
  if (season === "winter") return mixHex(hex, SNOW, 0.74);
  return hex;
}

/** The tufts' stroke in a season: olive in autumn, and pale where they poke through winter snow. */
export function tuftStroke(season: Season | undefined): string {
  if (season === "autumn") return "rgba(122, 104, 44, 0.5)";
  if (season === "winter") return "rgba(98, 122, 92, 0.42)";
  return TUFT_STROKE;
}

/** Cheap integer hash for visual variety only. Not game state: the sim never sees it. */
export function tileHash(x: number, y: number): number {
  let h = Math.imul(x, 374761393) + Math.imul(y, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return (h ^ (h >>> 16)) >>> 0;
}

/**
 * What grows on one tile, in fractions of the tile from its top left corner. A leaf lies `turn`
 * radians from pointing east.
 */
export type Scenery =
  | { kind: "tuft"; fx: number }
  | { kind: "flower"; fx: number; fy: number; tone: 0 | 1 }
  | { kind: "leaf"; fx: number; fy: number; tone: 0 | 1 | 2; turn: number };

export interface GroundTile {
  biome: Biome;
  fill: string;
  scenery: Scenery | null;
}

/** Tiles (by `deco`, below) where a leaf falls in autumn besides the flowers' own; forests drop more. */
const LEAF_DECO = new Set([5, 11, 14]);
const FOREST_LEAF_DECO = 9;

/**
 * One tile of ground in a season (today's look without one): its biome, its tone, and its tuft,
 * flower, or fallen leaf. The Commons plaza and the bare biomes (stone, sand) stay clean; only
 * meadow and forest grow decoration. In autumn flowers give way to fallen leaves and more leaves
 * lie about; in winter the flowers are gone and only tufts poke through the snow.
 */
export function groundTile(
  config: WorldConfig,
  x: number,
  y: number,
  inCommons: boolean,
  season?: Season,
): GroundTile {
  const n = tileHash(x, y);
  const biome = biomeAt(config, x, y);
  const look = SEASON_GROUND[season ?? "summer"];
  const fill = (inCommons ? look.commons : look.ground[biome])[n & 3] as string;
  if (inCommons || biome === "stone" || biome === "sand") return { biome, fill, scenery: null };
  const deco = (n >>> 4) % 17;
  if (deco === 0 || deco === 7) {
    return { biome, fill, scenery: { kind: "tuft", fx: 0.3 + ((n >>> 9) & 7) / 20 } };
  }
  const fx = 0.25 + ((n >>> 12) & 7) / 14;
  const fy = 0.25 + ((n >>> 15) & 7) / 14;
  const autumn = season === "autumn";
  if (
    autumn &&
    (deco === 3 || LEAF_DECO.has(deco) || (biome === "forest" && deco === FOREST_LEAF_DECO))
  ) {
    const tone = ((n >>> 20) % 3) as 0 | 1 | 2;
    return { biome, fill, scenery: { kind: "leaf", fx, fy, tone, turn: ((n >>> 23) & 7) * 0.39 } };
  }
  if (deco === 3 && season !== "winter") {
    return {
      biome,
      fill,
      scenery: { kind: "flower", fx, fy, tone: ((n >>> 20) & 1) as 0 | 1 },
    };
  }
  return { biome, fill, scenery: null };
}

function parseHex(hex: string): [number, number, number] {
  const n = Number.parseInt(hex.replace("#", ""), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** `a` blended toward `b` by `t` (0 to 1), as `#rrggbb`. */
export function mixHex(a: string, b: string, t: number): string {
  const [ar, ag, ab] = parseHex(a);
  const [br, bg, bb] = parseHex(b);
  const ch = (x: number, y: number) =>
    Math.round(x + (y - x) * t)
      .toString(16)
      .padStart(2, "0");
  return `#${ch(ar, br)}${ch(ag, bg)}${ch(ab, bb)}`;
}

/** A hex color as `rgba()` with an alpha. */
export function alphaHex(hex: string, alpha: number): string {
  const [r, g, b] = parseHex(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** A block's color, dressed in its plot owner's theme when they have one. */
export function blockFill(block: BlockKind, palette?: ThemePalette): string {
  // Only the four building blocks take a theme. Planters, stations (RFC 0005), and decor from the
  // town shop (RFC 0008) keep their own look on a themed plot.
  if (!palette || !(BUILDING_BLOCKS as readonly BlockKind[]).includes(block)) {
    return BLOCK_COLORS[block];
  }
  if (block === "wood") return mixHex(palette.light, palette.main, 0.45);
  if (block === "stone") return mixHex(BLOCK_COLORS.stone, palette.light, 0.35);
  if (block === "leaf") return mixHex(BLOCK_COLORS.leaf, palette.deep, 0.18);
  return BLOCK_COLORS.glass;
}
