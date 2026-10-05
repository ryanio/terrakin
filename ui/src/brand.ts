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

/** Dark wood for handles, posts, and lantern caps, wherever an item or garment is drawn. */
export const WOOD_DARK = "#6e4a2c";
