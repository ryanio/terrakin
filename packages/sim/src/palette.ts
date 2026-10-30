/**
 * The world's palette: ground tones per biome, blocks, the hearth, paths and flooring, and crops,
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
import type { Glaze } from "./pottery";
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
  // Stairs up to the floor above (RFC 0028): plank treads a shade lighter than a wood wall.
  stairs: "#c99a66",
  // Thanksgiving decor (RFC 0034): a wicker horn, and maple leaves on a string.
  cornucopia: "#c8955a",
  leaf_garland: "#c8642e",
  // Hanukkah decor (RFC 0034): a brass menorah, and a blue dreidel.
  menorah: "#c9a24a",
  dreidel: "#3f6fb5",
  // Midwinter's stocking (RFC 0034): red felt with a white cuff.
  stocking: "#c8344a",
  bird_bath: "#b9c4cc",
  beehive: "#d9a63f",
  // Made materials (RFC 0041): walls and windows crafted at a workbench, each pitched to read
  // apart from wood and stone at a glance, which is the whole point of them.
  // Lime-washed plaster, a shade warmer and lighter than a stone wall.
  plaster: "#ece4d5",
  // Fired clay, warm and a little dusty, nothing like the grey of stone.
  brickwork: "#b4593f",
  // Dark beams over plaster: the beams carry it, since they are what the eye reads.
  timber_frame: "#6b4a35",
  // Salt-bleached wood off the shore: cooler and lighter than stone's warm grey (#a39d93), so a
  // driftwood wall never reads as a stone one at a glance, which is the whole point of it.
  driftwood_plank: "#bfc5c2",
  // A window with the sea in it, greener than glass.
  sea_glass_pane: "#8fc9b4",
  // A door (decision 0349): a painted plank door, red so the way into a home is the first thing
  // you see in its walls. Its frame is drawn in `DOOR_LOOK.frame`.
  door: "#a8483a",
  // Cozy homes (RFC 0044): the upholstery each is drawn around, set in a wooden frame. A rose
  // armchair, a moss-green sofa, and a bed's blue quilt, so the three read apart in a small room.
  armchair: "#c46a5a",
  sofa: "#6f8f5e",
  bed: "#5b7fb0",
  // Pottery (RFC 0047): a kiln of fired brick, warmer than a stone wall.
  kiln: "#b0674a",
  // A pot set down (RFC 0047) is drawn in its own glaze; this is bare clay, for a view that can't.
  pot: "#c98b64",
  // Roomier homes (RFC 0050): surfaces in three woods, so a desk, a side table and a dresser read
  // apart from the table (#b88552) and the bookshelf (#8c5a36).
  desk: "#9a6a42",
  side_table: "#c79a66",
  dresser: "#7a5236",
};

/** A kiln's glow while it fires a pot (RFC 0047), on the map and in 3D. */
export const KILN_GLOW = "#ffb347";

/** Clay (RFC 0047), lying on the ground, in your things, and in 3D. */
export const CLAY_HEX = "#b5714c";

/**
 * Each glaze's color (RFC 0047), and `bare` the warm unglazed clay: a pot's picture, the build bar,
 * and a plot's thumbnail all paint a pot in it.
 */
export const GLAZE_HEX: Readonly<Record<Glaze, string>> = {
  bare: "#c98a5e",
  cream: "#efe3c8",
  sea: "#6fb3b0",
  crystal: "#cfe6f2",
  rose: "#e58fb6",
  honey: "#e6b04a",
  berry: "#b8344a",
  moss: "#7d9a52",
};

/**
 * How a door looks (decision 0349), on the map, in both 3D views, and in plot photos: a wall-high
 * frame of plain wood around a painted door, its knob, and how much of the tile's width the opening
 * takes (in tile units), so every view draws the same door.
 */
export const DOOR_LOOK = {
  frame: BLOCK_COLORS.wood,
  panel: BLOCK_COLORS.door,
  knob: "#e2c26a",
  opening: 0.56,
} as const;

/** The water in spring's bird bath (decision 0311), on the map, in 3D, and in its picture. */
export const BATH_WATER = "#5fa9d0";

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
 * How the open water between lands and the bridges over it look ([RFC 0038](../../../docs/rfcs/0038-new-lands.md)):
 * the sea (deeper than a pond, so a channel reads as water to cross rather than a puddle), the
 * deeper water out of sight of either bank, the shallows and foam where it meets land, and the timber of a bridge
 * with its planks and its rail. The map, the 3D world, and the plot photos all read it, so
 * a crossing looks the same everywhere.
 */
export const SEA_LOOK = {
  water: "#3f86b4",
  deep: "rgba(24, 58, 90, 0.18)",
  foam: "rgba(255, 255, 255, 0.5)",
  /** The paler water just off the shore, under the foam. */
  shallow: "rgba(190, 232, 236, 0.28)",
  deck: "#b08b5c",
  plank: "rgba(92, 62, 36, 0.45)",
  rail: "#8a6a42",
} as const;

/**
 * One shape of a path or flooring's picture, in tile units: (0, 0) is the tile's top left and (1, 1)
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

/** A rounded rect mark, for `GROUND_LOOK` and `WALL_LOOK`. */
export const markRect = (
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
  fill: string,
): GroundMark => ({
  shape: "rect",
  x,
  y,
  w,
  h,
  r,
  fill,
});
/** A round mark. */
export const markDot = (cx: number, cy: number, r: number, fill: string): GroundMark => ({
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
/** A line mark with round ends. */
export const markLine = (
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  width: number,
  stroke: string,
): GroundMark => ({ shape: "line", x1, y1, x2, y2, width, stroke });

/**
 * What each kind of path and flooring looks like (RFC 0016), as data. The map
 * (`packages/client/src/render.ts`), the build palette's swatches, the 3D views' ground, and the
 * plot photos (`packages/cards/`) all draw from it, so a cobble path is the same cobble path
 * everywhere. Every tile of a kind looks the same, so neighbors join into one path.
 */
export const GROUND_LOOK: Readonly<Record<GroundKind, GroundLook>> = {
  dirt: {
    fill: "#bf9461",
    marks: [
      markDot(0.22, 0.28, 0.045, "#a67c4c"),
      markDot(0.68, 0.22, 0.035, "#a67c4c"),
      markDot(0.5, 0.62, 0.05, "#a67c4c"),
      markDot(0.84, 0.76, 0.04, "#a67c4c"),
      markDot(0.3, 0.84, 0.03, "#cfa776"),
      markDot(0.8, 0.45, 0.03, "#cfa776"),
    ],
    tone: "#bf9461",
  },
  sand: {
    fill: "#ecd9a4",
    marks: [
      markDot(0.2, 0.25, 0.025, "#d6c088"),
      markDot(0.55, 0.18, 0.025, "#d6c088"),
      markDot(0.8, 0.42, 0.025, "#d6c088"),
      markDot(0.35, 0.6, 0.025, "#d6c088"),
      markDot(0.7, 0.78, 0.025, "#d6c088"),
      markDot(0.15, 0.82, 0.025, "#d6c088"),
      markDot(0.45, 0.4, 0.03, "#f6e8c0"),
      markDot(0.86, 0.14, 0.03, "#f6e8c0"),
    ],
    tone: "#ecd9a4",
  },
  moss: {
    fill: "#6e9a4c",
    marks: [
      markDot(0.3, 0.3, 0.17, "#82ae5d"),
      markDot(0.72, 0.64, 0.14, "#82ae5d"),
      markDot(0.78, 0.2, 0.1, "#7aa656"),
      markDot(0.2, 0.74, 0.04, "#5a8440"),
      markDot(0.5, 0.5, 0.035, "#5a8440"),
      markDot(0.88, 0.88, 0.04, "#5a8440"),
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
      markRect(0.05, 0.06, 0.42, 0.38, 0.12, "#b0a99c"),
      markRect(0.53, 0.05, 0.42, 0.4, 0.12, "#a69f92"),
      markRect(0.04, 0.5, 0.3, 0.45, 0.12, "#a69f92"),
      markRect(0.39, 0.51, 0.57, 0.43, 0.12, "#b0a99c"),
      markRect(0.1, 0.09, 0.2, 0.06, 0.03, "#c4beb2"),
      markRect(0.58, 0.08, 0.2, 0.06, 0.03, "#bdb7aa"),
      markRect(0.08, 0.54, 0.14, 0.06, 0.03, "#bdb7aa"),
      markRect(0.45, 0.55, 0.26, 0.06, 0.03, "#c4beb2"),
    ],
    tone: "#a39d91",
  },
  stepping_stones: {
    marks: [
      markDot(0.34, 0.39, 0.2, "rgba(70, 52, 30, 0.2)"),
      markDot(0.72, 0.74, 0.18, "rgba(70, 52, 30, 0.2)"),
      markDot(0.32, 0.35, 0.2, "#b7b0a3"),
      markDot(0.7, 0.7, 0.18, "#aba497"),
      markDot(0.27, 0.3, 0.08, "#ccc6ba"),
      markDot(0.65, 0.65, 0.07, "#c2bcaf"),
    ],
    tone: "#b7b0a3",
  },
  brick: {
    fill: "#d9c7ab",
    marks: [
      markRect(0.03, 0.04, 0.45, 0.27, 0.03, "#b5573a"),
      markRect(0.52, 0.04, 0.45, 0.27, 0.03, "#a84e33"),
      markRect(0, 0.365, 0.21, 0.27, 0.03, "#a84e33"),
      markRect(0.26, 0.365, 0.47, 0.27, 0.03, "#b5573a"),
      markRect(0.78, 0.365, 0.22, 0.27, 0.03, "#b5573a"),
      markRect(0.03, 0.69, 0.45, 0.27, 0.03, "#b5573a"),
      markRect(0.52, 0.69, 0.45, 0.27, 0.03, "#a84e33"),
    ],
    tone: "#b5573a",
  },
  planks: {
    fill: "#c08a55",
    marks: [
      markLine(0, 0.335, 1, 0.335, 0.03, "#93633b"),
      markLine(0, 0.665, 1, 0.665, 0.03, "#93633b"),
      markLine(0.4, 0, 0.4, 0.335, 0.025, "#93633b"),
      markLine(0.75, 0.335, 0.75, 0.665, 0.025, "#93633b"),
      markLine(0.25, 0.665, 0.25, 1, 0.025, "#93633b"),
      markLine(0.1, 0.17, 0.33, 0.17, 0.015, "#a9764a"),
      markLine(0.5, 0.5, 0.88, 0.5, 0.015, "#a9764a"),
      markLine(0.4, 0.84, 0.8, 0.84, 0.015, "#a9764a"),
      markDot(0.45, 0.06, 0.02, "#7a5232"),
      markDot(0.7, 0.39, 0.02, "#7a5232"),
      markDot(0.3, 0.72, 0.02, "#7a5232"),
    ],
    tone: "#c08a55",
  },
  flower_bed: {
    fill: "#6a4a33",
    marks: [
      leafMark(0.36, 0.42, -30, "#5f9a43"),
      leafMark(0.62, 0.5, 40, "#5f9a43"),
      leafMark(0.3, 0.9, 10, "#5f9a43"),
      markDot(0.25, 0.28, 0.1, "#e58fb6"),
      markDot(0.7, 0.24, 0.09, "#f2d04b"),
      markDot(0.46, 0.66, 0.1, "#fff4d6"),
      markDot(0.82, 0.72, 0.09, "#a98bd8"),
      markDot(0.18, 0.8, 0.08, "#e58fb6"),
      markDot(0.25, 0.28, 0.035, "#f2b84b"),
      markDot(0.46, 0.66, 0.035, "#f2b84b"),
      markDot(0.82, 0.72, 0.03, "#fff4d6"),
    ],
    tone: "#8a6a4a",
  },
  rug: {
    fill: "#c8674a",
    marks: [
      markRect(0.07, 0.07, 0.86, 0.86, 0.05, "#e9b85a"),
      markRect(0.13, 0.13, 0.74, 0.74, 0.03, "#c8674a"),
      markRect(0.13, 0.44, 0.74, 0.12, 0, "#f3e3c3"),
      markDot(0.3, 0.27, 0.05, "#f3e3c3"),
      markDot(0.7, 0.27, 0.05, "#f3e3c3"),
      markDot(0.3, 0.73, 0.05, "#f3e3c3"),
      markDot(0.7, 0.73, 0.05, "#f3e3c3"),
    ],
    tone: "#c8674a",
  },
};

/**
 * Ground the map draws that nobody laid (RFC 0046): a public way, in a look of its own, pale
 * gravel that no path a resident lays has, so a way never reads as someone's path. An island
 * street keeps the cobbles (`cobble`). A town square is a plaza of laid setts (`PLAZA_LOOK`).
 * Drawing only: no rule reads it.
 */
export type DrawnGround = GroundKind | "way" | "plaza";

/** What a public way looks like, as `GROUND_LOOK` has each path. */
export const WAY_LOOK: GroundLook = {
  fill: "#d3cbb8",
  marks: [
    markDot(0.18, 0.22, 0.035, "#b2a88f"),
    markDot(0.58, 0.14, 0.03, "#b2a88f"),
    markDot(0.82, 0.5, 0.035, "#b2a88f"),
    markDot(0.38, 0.56, 0.03, "#b2a88f"),
    markDot(0.14, 0.82, 0.03, "#b2a88f"),
    markDot(0.66, 0.84, 0.035, "#b2a88f"),
    markDot(0.42, 0.3, 0.025, "#ebe5d6"),
    markDot(0.88, 0.2, 0.025, "#ebe5d6"),
    markDot(0.26, 0.6, 0.025, "#ebe5d6"),
    markDot(0.6, 0.66, 0.025, "#ebe5d6"),
  ],
  tone: "#d3cbb8",
};

/** The plaza's warm sandstone setts, in the order `PLAZA_LOOK` lays them. */
const SETTS = ["#d8c39d", "#cdb58b", "#e0cfac", "#c8ad84", "#d3bc94"] as const;

/** The pale, worn top edge each sett catches the light on. */
const SETT_LIGHT = "#ebdfc4";

/**
 * Two rows of three setts, the second row half a sett over (a running bond), so a square of tiles
 * reads as one paved plaza. The half setts at a tile's sides meet their other halves on the next
 * tile, and each sett's tone is fixed here, so the paving repeats with no seam.
 */
function plazaMarks(): GroundMark[] {
  const marks: GroundMark[] = [];
  const wide = 1 / 3;
  const row = 0.5;
  const gap = 0.04;
  const sett = (x: number, y: number, w: number, round: number, tone: string, lit = true) => {
    marks.push(markRect(x, y, w, row - gap, round, tone));
    if (lit) marks.push(markRect(x + gap, y + gap * 0.75, w - gap * 2, 0.045, 0.02, SETT_LIGHT));
  };
  for (let c = 0; c < 3; c++) {
    sett(c * wide + gap / 2, gap / 2, wide - gap, 0.05, SETTS[c * 2] as string);
  }
  // The second row: two whole setts, and one split across the tile's sides. Its halves share a
  // tone, and only the one on the right side carries the light edge, so the two meet as one stone.
  const half = wide / 2 - gap / 2;
  const y = row + gap / 2;
  for (let c = 0; c < 2; c++) {
    sett(wide / 2 + c * wide + gap / 2, y, wide - gap, 0.05, SETTS[c * 2 + 1] as string);
  }
  sett(0, y, half, 0, SETTS[4] as string, false);
  sett(1 - half, y, half, 0, SETTS[4] as string);
  return marks;
}

/** What a town square is paved with: the Commons, and every land's own square. */
export const PLAZA_LOOK: GroundLook = {
  fill: "#b39d7a",
  marks: plazaMarks(),
  tone: "#d3bc94",
};

/** The look of anything the map draws as ground: a laid path or flooring, a way, or a plaza. */
export const drawnLook = (kind: DrawnGround): GroundLook =>
  kind === "way" ? WAY_LOOK : kind === "plaza" ? PLAZA_LOOK : GROUND_LOOK[kind];

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
export const SNOW_WHITE = "#f3f5f7";

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
      meadow: toward(GROUND.meadow, SNOW_WHITE, 0.74),
      forest: toward(GROUND.forest, SNOW_WHITE, 0.7),
      stone: toward(GROUND.stone, SNOW_WHITE, 0.7),
      sand: toward(GROUND.sand, SNOW_WHITE, 0.64),
    },
    commons: toward(COMMONS_GROUND, SNOW_WHITE, 0.5),
  },
};

/**
 * A ground color as a season wears it, for ground drawn outside the biome palette (a plot's tint,
 * the 3D plot view's meadow): the same mix the season gives meadow grass.
 */
export function seasonTone(hex: string, season: Season | undefined): string {
  if (season === "autumn") return mixHex(hex, AUTUMN_GOLD, 0.32);
  if (season === "winter") return mixHex(hex, SNOW_WHITE, 0.74);
  return hex;
}

/** How far a roof goes toward `SNOW_WHITE` in winter, against the ground's 0.74. */
const ROOF_SNOW = 0.56;

/**
 * How much snow lies on a roof in a season (RFC 0041): all winter, and none otherwise, since the
 * weather table only ever snows in winter. The 3D views mix it into their own numeric colors, so
 * every view wears the same winter; `roofTone` is the same mix for a hex string.
 */
export function roofSnow(season: Season | undefined): number {
  return season === "winter" ? ROOF_SNOW : 0;
}

/**
 * A roof's covering as a season wears it: snow lies on it all winter, as it lies on every biome,
 * but less than on the ground, so the covering someone chose still reads through it and a leaf
 * roof is still greener than a stone one. The walls under it keep their own color, so from above a
 * snowy roof is also what tells a home from the garden wall beside it.
 */
export function roofTone(hex: string, season: Season | undefined): string {
  return mixHex(hex, SNOW_WHITE, roofSnow(season));
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
