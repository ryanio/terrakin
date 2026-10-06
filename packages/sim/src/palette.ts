/**
 * The world's palette: ground tones per biome, blocks, the hearth, paths and floors, and crops,
 * plus the per-tile scenery (tufts, flowers, and autumn's fallen leaves) the ground grows, and how
 * each season dresses it. Presentation only, like the looks catalog: no rule reads any of it. It
 * lives here so the client's world renderer (`packages/client/src/render.ts`) and the plot photos
 * drawn at the edge (`packages/cards/`, through `packages/server/src/plot-photo.ts`) use the same
 * colors and put the same tuft on the same tile.
 */

import { type Biome, biomeAt } from "./biome";
import { CATALOG, CROPS, type Crop } from "./catalog";
import type { GroundKind } from "./ground";
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
  // Furniture from the workbench (RFC 0016): the main color each is drawn around.
  table: "#b88552",
  chair: "#a8744a",
  bookshelf: "#8c5a36",
  barrel: "#9e6a3c",
  signpost: "#a87c4f",
  lamp_post: "#4a5a48",
  well: "#a39d93",
  stone_wall: "#a8a196",
  campfire: "#e2703a",
  flower_box: "#b8834f",
  // A carved pumpkin with a candle in it.
  jack_o_lantern: "#e8862f",
  // Halloween decor (RFC 0022): paper bats on a string, an iron pot with a green brew, and a bowl
  // of candy by the door.
  bat_bunting: "#3a2f4a",
  cauldron: "#3b3a40",
  candy_bowl: "#e8862f",
  // Winter decor (RFC 0017): snow a shade bluer than the snowy ground, a warm bulb, a fir's green,
  // and a sled's red slats.
  snowman: "#f4f7fb",
  string_lights: "#f5c451",
  little_fir: "#2f6e45",
  sled: "#c4473a",
  // Water to fish in (RFC 0023): a pond's blue, under its stone rim.
  pond: "#4f9ac4",
};

/**
 * How a pond looks (RFC 0023), on the map, in both 3D views, and in plot photos: the water, a
 * shade where it deepens away from the bank, the stone rim along each side that doesn't run on into
 * more pond (`rim` wide, in tile units), the pebbles in it, a lily pad on some tiles, and the
 * glints that shimmer on the water.
 */
export const POND_LOOK = {
  water: BLOCK_COLORS.pond,
  deep: "#3a78a8",
  shade: "rgba(28, 64, 96, 0.22)",
  stone: "#c4beb2",
  pebble: "#8f887c",
  lily: "#6fae4c",
  lilyEdge: "#4f8a3a",
  glint: "#ffffff",
  rim: 0.13,
} as const;

/**
 * One shape of a path or floor's picture, in tile units: (0, 0) is the tile's top left and (1, 1)
 * its bottom right. Colors are `#rrggbb` or `rgba(r, g, b, a)`. `turn` is in degrees.
 */
export type GroundMark =
  | { shape: "rect"; x: number; y: number; w: number; h: number; r: number; fill: string }
  | { shape: "circle"; cx: number; cy: number; r: number; fill: string }
  | {
      shape: "ellipse";
      cx: number;
      cy: number;
      rx: number;
      ry: number;
      turn: number;
      fill: string;
    }
  | {
      shape: "line";
      x1: number;
      y1: number;
      x2: number;
      y2: number;
      width: number;
      stroke: string;
    };

export interface GroundLook {
  /** The whole tile's color, or none where the ground beneath shows through (stepping stones). */
  fill?: string;
  /** Shapes over it, back to front. */
  marks: readonly GroundMark[];
  /** One color for it where there's no room for the picture: a swatch's edge, a far tile. */
  tone: string;
}

const rect = (x: number, y: number, w: number, h: number, r: number, fill: string): GroundMark => ({
  shape: "rect",
  x,
  y,
  w,
  h,
  r,
  fill,
});
const dot = (cx: number, cy: number, r: number, fill: string): GroundMark => ({
  shape: "circle",
  cx,
  cy,
  r,
  fill,
});
const leafMark = (cx: number, cy: number, turn: number, fill: string): GroundMark => ({
  shape: "ellipse",
  cx,
  cy,
  rx: 0.13,
  ry: 0.06,
  turn,
  fill,
});
const seam = (
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  width: number,
  stroke: string,
): GroundMark => ({ shape: "line", x1, y1, x2, y2, width, stroke });

/**
 * What each path and floor looks like (RFC 0016), as data. The map
 * (`packages/client/src/render.ts`), the build palette's swatches, the 3D views' ground, and the
 * plot photos (`packages/cards/`) all draw from it, so a cobble path is the same cobble path
 * everywhere. Every tile of a kind looks the same, so neighbors join into one path.
 */
export const GROUND_LOOK: Readonly<Record<GroundKind, GroundLook>> = {
  dirt: {
    fill: "#bf9461",
    marks: [
      dot(0.22, 0.28, 0.045, "#a67c4c"),
      dot(0.68, 0.22, 0.035, "#a67c4c"),
      dot(0.5, 0.62, 0.05, "#a67c4c"),
      dot(0.84, 0.76, 0.04, "#a67c4c"),
      dot(0.3, 0.84, 0.03, "#cfa776"),
      dot(0.8, 0.45, 0.03, "#cfa776"),
    ],
    tone: "#bf9461",
  },
  sand: {
    fill: "#ecd9a4",
    marks: [
      dot(0.2, 0.25, 0.025, "#d6c088"),
      dot(0.55, 0.18, 0.025, "#d6c088"),
      dot(0.8, 0.42, 0.025, "#d6c088"),
      dot(0.35, 0.6, 0.025, "#d6c088"),
      dot(0.7, 0.78, 0.025, "#d6c088"),
      dot(0.15, 0.82, 0.025, "#d6c088"),
      dot(0.45, 0.4, 0.03, "#f6e8c0"),
      dot(0.86, 0.14, 0.03, "#f6e8c0"),
    ],
    tone: "#ecd9a4",
  },
  moss: {
    fill: "#6e9a4c",
    marks: [
      dot(0.3, 0.3, 0.17, "#82ae5d"),
      dot(0.72, 0.64, 0.14, "#82ae5d"),
      dot(0.78, 0.2, 0.1, "#7aa656"),
      dot(0.2, 0.74, 0.04, "#5a8440"),
      dot(0.5, 0.5, 0.035, "#5a8440"),
      dot(0.88, 0.88, 0.04, "#5a8440"),
    ],
    tone: "#6e9a4c",
  },
  leaves: {
    fill: "#ad8a59",
    marks: [
      leafMark(0.24, 0.24, 30, "#e08a3c"),
      leafMark(0.7, 0.3, -40, "#c8553a"),
      leafMark(0.46, 0.58, 70, "#e8b84a"),
      leafMark(0.8, 0.76, 15, "#e08a3c"),
      leafMark(0.18, 0.74, -20, "#c8553a"),
      leafMark(0.56, 0.9, 45, "#d9773a"),
    ],
    tone: "#c98a46",
  },
  cobble: {
    fill: "#857e73",
    marks: [
      rect(0.05, 0.06, 0.42, 0.38, 0.12, "#b0a99c"),
      rect(0.53, 0.05, 0.42, 0.4, 0.12, "#a69f92"),
      rect(0.04, 0.5, 0.3, 0.45, 0.12, "#a69f92"),
      rect(0.39, 0.51, 0.57, 0.43, 0.12, "#b0a99c"),
      rect(0.1, 0.09, 0.2, 0.06, 0.03, "#c4beb2"),
      rect(0.58, 0.08, 0.2, 0.06, 0.03, "#bdb7aa"),
      rect(0.08, 0.54, 0.14, 0.06, 0.03, "#bdb7aa"),
      rect(0.45, 0.55, 0.26, 0.06, 0.03, "#c4beb2"),
    ],
    tone: "#a39d91",
  },
  stepping_stones: {
    marks: [
      dot(0.34, 0.39, 0.2, "rgba(70, 52, 30, 0.2)"),
      dot(0.72, 0.74, 0.18, "rgba(70, 52, 30, 0.2)"),
      dot(0.32, 0.35, 0.2, "#b7b0a3"),
      dot(0.7, 0.7, 0.18, "#aba497"),
      dot(0.27, 0.3, 0.08, "#ccc6ba"),
      dot(0.65, 0.65, 0.07, "#c2bcaf"),
    ],
    tone: "#b7b0a3",
  },
  brick: {
    fill: "#d9c7ab",
    marks: [
      rect(0.03, 0.04, 0.45, 0.27, 0.03, "#b5573a"),
      rect(0.52, 0.04, 0.45, 0.27, 0.03, "#a84e33"),
      rect(0, 0.365, 0.21, 0.27, 0.03, "#a84e33"),
      rect(0.26, 0.365, 0.47, 0.27, 0.03, "#b5573a"),
      rect(0.78, 0.365, 0.22, 0.27, 0.03, "#b5573a"),
      rect(0.03, 0.69, 0.45, 0.27, 0.03, "#b5573a"),
      rect(0.52, 0.69, 0.45, 0.27, 0.03, "#a84e33"),
    ],
    tone: "#b5573a",
  },
  planks: {
    fill: "#c08a55",
    marks: [
      seam(0, 0.335, 1, 0.335, 0.03, "#93633b"),
      seam(0, 0.665, 1, 0.665, 0.03, "#93633b"),
      seam(0.4, 0, 0.4, 0.335, 0.025, "#93633b"),
      seam(0.75, 0.335, 0.75, 0.665, 0.025, "#93633b"),
      seam(0.25, 0.665, 0.25, 1, 0.025, "#93633b"),
      seam(0.1, 0.17, 0.33, 0.17, 0.015, "#a9764a"),
      seam(0.5, 0.5, 0.88, 0.5, 0.015, "#a9764a"),
      seam(0.4, 0.84, 0.8, 0.84, 0.015, "#a9764a"),
      dot(0.45, 0.06, 0.02, "#7a5232"),
      dot(0.7, 0.39, 0.02, "#7a5232"),
      dot(0.3, 0.72, 0.02, "#7a5232"),
    ],
    tone: "#c08a55",
  },
  flower_bed: {
    fill: "#6a4a33",
    marks: [
      leafMark(0.36, 0.42, -30, "#5f9a43"),
      leafMark(0.62, 0.5, 40, "#5f9a43"),
      leafMark(0.3, 0.9, 10, "#5f9a43"),
      dot(0.25, 0.28, 0.1, "#e58fb6"),
      dot(0.7, 0.24, 0.09, "#f2d04b"),
      dot(0.46, 0.66, 0.1, "#fff4d6"),
      dot(0.82, 0.72, 0.09, "#a98bd8"),
      dot(0.18, 0.8, 0.08, "#e58fb6"),
      dot(0.25, 0.28, 0.035, "#f2b84b"),
      dot(0.46, 0.66, 0.035, "#f2b84b"),
      dot(0.82, 0.72, 0.03, "#fff4d6"),
    ],
    tone: "#8a6a4a",
  },
  rug: {
    fill: "#c8674a",
    marks: [
      rect(0.07, 0.07, 0.86, 0.86, 0.05, "#e9b85a"),
      rect(0.13, 0.13, 0.74, 0.74, 0.03, "#c8674a"),
      rect(0.13, 0.44, 0.74, 0.12, 0, "#f3e3c3"),
      dot(0.3, 0.27, 0.05, "#f3e3c3"),
      dot(0.7, 0.27, 0.05, "#f3e3c3"),
      dot(0.3, 0.73, 0.05, "#f3e3c3"),
      dot(0.7, 0.73, 0.05, "#f3e3c3"),
    ],
    tone: "#c8674a",
  },
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

/**
 * Each crop's color when it's ready to pick: its look's `body` in the catalog (RFC 0018). The map,
 * the 3D views, the item pictures, and plot photos all draw ripe crops in it.
 */
export const CROP_HEX = Object.fromEntries(
  CROPS.map((crop) => {
    const look = CATALOG[crop].look;
    return [crop, "body" in look ? look.body : "#6b9a4a"];
  }),
) as Readonly<Record<Crop, string>>;

/**
 * Whether a crop grows on a vine along the soil, like a pumpkin: its look in the catalog has a vine
 * on top. The map, the 3D views, and plot photos draw it as a vine with its fruit swelling on it,
 * and every other crop as a plant with its fruit or flowers on top.
 */
export function onVine(crop: Crop): boolean {
  const look = CATALOG[crop].look;
  return look.template === "produce" && look.top === "vine";
}

/** How far along a crop is, 0 to 1, by the world's day: how the map, 3D, and photos draw it. */
export function growth(plantedDay: number, readyDay: number, today: number | undefined): number {
  if (today === undefined || readyDay <= plantedDay) return 0;
  return Math.max(0, Math.min(1, (today - plantedDay) / (readyDay - plantedDay)));
}
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
