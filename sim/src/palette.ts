/**
 * The world's palette: ground tones per biome, blocks, and the hearth, plus the per-tile scenery
 * (tufts and flowers) the ground grows. Presentation only, like the looks catalog: no rule reads
 * any of it. It lives here so the client's world renderer (`client/src/render.ts`) and the plot
 * photos drawn at the edge (`cards/`, through `server/src/plot-photo.ts`) use the same colors and
 * put the same tuft on the same tile.
 */

import { type Biome, biomeAt } from "./biome";
import type { ThemePalette } from "./looks";
import type { BlockKind, WorldConfig } from "./types";

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
/** How much a theme tints its owner's plot. */
export const THEME_TINT_ALPHA = 0.34;

/** Cheap integer hash for visual variety only. Not game state: the sim never sees it. */
export function tileHash(x: number, y: number): number {
  let h = Math.imul(x, 374761393) + Math.imul(y, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return (h ^ (h >>> 16)) >>> 0;
}

/** What grows on one tile, in fractions of the tile from its top left corner. */
export type Scenery =
  | { kind: "tuft"; fx: number }
  | { kind: "flower"; fx: number; fy: number; tone: 0 | 1 };

export interface GroundTile {
  biome: Biome;
  fill: string;
  scenery: Scenery | null;
}

/**
 * One tile of ground: its biome, its tone, and its tuft or flower. The Commons plaza and the bare
 * biomes (stone, sand) stay clean; only meadow and forest grow decoration.
 */
export function groundTile(
  config: WorldConfig,
  x: number,
  y: number,
  inCommons: boolean,
): GroundTile {
  const n = tileHash(x, y);
  const biome = biomeAt(config, x, y);
  const fill = (inCommons ? COMMONS_GROUND : GROUND[biome])[n & 3] as string;
  if (inCommons || biome === "stone" || biome === "sand") return { biome, fill, scenery: null };
  const deco = (n >>> 4) % 17;
  if (deco === 0 || deco === 7) {
    return { biome, fill, scenery: { kind: "tuft", fx: 0.3 + ((n >>> 9) & 7) / 20 } };
  }
  if (deco === 3) {
    return {
      biome,
      fill,
      scenery: {
        kind: "flower",
        fx: 0.25 + ((n >>> 12) & 7) / 14,
        fy: 0.25 + ((n >>> 15) & 7) / 14,
        tone: ((n >>> 20) & 1) as 0 | 1,
      },
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
  // Planters and stations (RFC 0005) keep their own look on a themed plot.
  if (!palette || block === "planter" || block === "kitchen" || block === "workbench") {
    return BLOCK_COLORS[block];
  }
  if (block === "wood") return mixHex(palette.light, palette.main, 0.45);
  if (block === "stone") return mixHex(BLOCK_COLORS.stone, palette.light, 0.35);
  if (block === "leaf") return mixHex(BLOCK_COLORS.leaf, palette.deep, 0.18);
  return BLOCK_COLORS.glass;
}
