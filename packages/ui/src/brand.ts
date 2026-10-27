/**
 * The brand colors from `tokens.css`, as hex strings for drawing on a canvas or in WebGL, which
 * can't read CSS variables. `scene3d.test.ts` keeps every one equal to its token.
 */
export const BRAND_HEX = {
  paper: "#fffaf0",
  paper2: "#fbf3e4",
  paperEdge: "#ecdcc0",
  ink: "#2b2620",
  inkSoft: "#5a5146",
  clay: "#b4532f",
  clayDeep: "#8f3d20",
  moss: "#5e7f45",
  mossLight: "#8fb36a",
  sun: "#f2b84b",
  dusk: "#cdb4f6",
  danger: "#a3361a",
} as const;

/** Wood, and the dark wood of handles, posts, and lantern caps, wherever an item or garment is drawn. */
export const WOOD = "#9a6b43";
export const WOOD_DARK = "#6e4a2c";

/** Straw, its shade, and wicker, for hats, baskets, and bales wherever they are drawn. */
export const STRAW = "#e8c878";
export const STRAW_DEEP = "#c49a4c";
export const WICKER = "#c9925a";

/** Leather for belts, satchels, and boots, on a figure and in the item pictures. */
export const LEATHER = "#9c6a3e";

/** The rain slicker's yellow and its shade. */
export const SLICKER = "#f4c534";
export const SLICKER_DEEP = "#d9a21c";

/** The umbrella's canopy when the theme's accent is too pale to read. */
export const CANOPY = "#e0604a";

/** Stone's light face and its shade, for a low wall's cap, a well, and a stove. */
export const STONE_HI = "#c4beb2";
export const STONE_LO = "#8f887c";

/** Iron, for a stove, a lamp, and a bed's frame. */
export const IRON = "#5d5a55";

/** Cream linen for a bed's sheet, a pillow, and the piping on cushions. */
export const LINEN = "#f1e8d6";
