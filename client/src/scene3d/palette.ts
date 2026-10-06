/**
 * The 3D palette: the brand colors from tokens.css and scripts/brand/logo.ts, and how each block,
 * resident color, and jam flavor looks in 3D. Plain numbers, no three.js, so tests can pin them
 * and the 2D and 3D worlds keep one look.
 */
import { BLOCK_COLORS, type BlockKind, type ResidentColor } from "@terrakin/sim";
import { BRAND_HEX } from "@terrakin/ui/brand";

/** `#rrggbb` to a number three.js takes as a color. */
export function hex(color: string): number {
  if (!/^#[0-9a-f]{6}$/i.test(color)) throw new Error(`Not a #rrggbb color: ${color}`);
  return Number.parseInt(color.slice(1), 16);
}

/** Brand tokens (tokens.css `:root`). */
export const BRAND = {
  paper: hex(BRAND_HEX.paper),
  paper2: hex(BRAND_HEX.paper2),
  paperEdge: hex(BRAND_HEX.paperEdge),
  ink: hex(BRAND_HEX.ink),
  clay: hex(BRAND_HEX.clay),
  clayDeep: hex(BRAND_HEX.clayDeep),
  moss: hex(BRAND_HEX.moss),
  mossLight: hex(BRAND_HEX.mossLight),
  sun: hex(BRAND_HEX.sun),
  dusk: hex(BRAND_HEX.dusk),
  /** The meadow and earth the 2D map uses around plots. */
  grass: hex("#a5c682"),
  grassDeep: hex("#8fb36a"),
  earth: hex("#a77a52"),
  earthDeep: hex("#7d5a3c"),
  sand: hex("#e6d6b6"),
  hearth: hex("#d9653a"),
  ember: hex("#ffb35c"),
} as const;

/** Sky gradient for the 3D backdrop: warm paper at the top, sand at the horizon. */
export const SKY = {
  top: "#f6ecd8",
  topHex: hex("#f6ecd8"),
  horizon: "#efe0c2",
  fog: hex("#efe0c2"),
} as const;

/**
 * The sky under cloud (decision 0073): a cool grey top and horizon, the cooler light from above,
 * and the pale haze of fog.
 */
export const OVERCAST = {
  top: hex("#d9dde0"),
  fog: hex("#d3d6d4"),
  light: hex("#e4e8ee"),
  mist: hex("#eeece6"),
} as const;

export interface BlockLook {
  color: number;
  /** Height of one block in tiles. Walls stand a little taller than wide, so homes read as homes. */
  height: number;
  /** 0 for solid; otherwise how see-through it is. */
  opacity: number;
  /**
   * "voxel" is a rounded box; "clump" is a leafy cluster that sways; "decor" is one of the town
   * shop's models in `decor.ts`, and "furniture" one of the workbench's in `furniture.ts`, where
   * `height` is how tall it stands.
   */
  form: "voxel" | "clump" | "decor" | "furniture";
  /**
   * Lit after dark (decision 0098): a pool of warm light `pool` tiles across on the ground, its
   * middle `at` from the tile's (x east, z south). With `home`, only in a home someone's in.
   */
  glow?: Glow;
}

/** How a block lights up after dark. Its model's shade or flame glows through `Stage.glow`. */
export interface Glow {
  pool: number;
  at?: readonly [number, number];
  home?: true;
}

/** Same base colors as the 2D renderer (render.ts BLOCK_COLORS). */
const BLOCK_LOOKS: Record<BlockKind, BlockLook> = {
  wood: { color: hex("#c29468"), height: 1.25, opacity: 1, form: "voxel" },
  stone: { color: hex("#a39d93"), height: 1.25, opacity: 1, form: "voxel" },
  // A window: lit from inside after dark while someone's home.
  glass: {
    color: hex("#bfe0ea"),
    height: 1.25,
    opacity: 0.42,
    form: "voxel",
    glow: { pool: 1.7, home: true },
  },
  leaf: { color: hex("#6b9a4a"), height: 0.95, opacity: 1, form: "clump" },
  planter: { color: hex("#8a5a36"), height: 0.5, opacity: 1, form: "voxel" },
  kitchen: { color: hex("#c8674a"), height: 0.95, opacity: 1, form: "voxel" },
  workbench: { color: hex("#9a6b43"), height: 0.8, opacity: 1, form: "voxel" },
  lantern: {
    color: hex(BLOCK_COLORS.lantern),
    height: 1.45,
    opacity: 1,
    form: "decor",
    glow: { pool: 1.8, at: [0.2, 0] },
  },
  frame: { color: hex(BLOCK_COLORS.frame), height: 1.25, opacity: 1, form: "decor" },
  fence: { color: hex(BLOCK_COLORS.fence), height: 0.8, opacity: 1, form: "decor" },
  bench: { color: hex(BLOCK_COLORS.bench), height: 0.78, opacity: 1, form: "decor" },
  pedestal: { color: hex(BLOCK_COLORS.pedestal), height: 0.6, opacity: 1, form: "voxel" },
  // Autumn's decor (RFC 0017), modelled in decor.ts.
  hay_bale: { color: hex(BLOCK_COLORS.hay_bale), height: 0.62, opacity: 1, form: "decor" },
  scarecrow: { color: hex(BLOCK_COLORS.scarecrow), height: 1.55, opacity: 1, form: "decor" },
  // Furniture from the workbench (RFC 0016).
  table: { color: hex(BLOCK_COLORS.table), height: 0.8, opacity: 1, form: "furniture" },
  chair: { color: hex(BLOCK_COLORS.chair), height: 1.05, opacity: 1, form: "furniture" },
  bookshelf: { color: hex(BLOCK_COLORS.bookshelf), height: 1.5, opacity: 1, form: "furniture" },
  barrel: { color: hex(BLOCK_COLORS.barrel), height: 0.9, opacity: 1, form: "furniture" },
  signpost: { color: hex(BLOCK_COLORS.signpost), height: 1.35, opacity: 1, form: "furniture" },
  lamp_post: {
    color: hex(BLOCK_COLORS.lamp_post),
    height: 1.75,
    opacity: 1,
    form: "furniture",
    glow: { pool: 2, at: [0, 0.15] },
  },
  well: { color: hex(BLOCK_COLORS.well), height: 1.6, opacity: 1, form: "furniture" },
  stone_wall: { color: hex(BLOCK_COLORS.stone_wall), height: 0.6, opacity: 1, form: "furniture" },
  campfire: {
    color: hex(BLOCK_COLORS.campfire),
    height: 0.7,
    opacity: 1,
    form: "furniture",
    glow: { pool: 2.2 },
  },
  flower_box: { color: hex(BLOCK_COLORS.flower_box), height: 0.75, opacity: 1, form: "furniture" },
  jack_o_lantern: {
    color: hex(BLOCK_COLORS.jack_o_lantern),
    height: 0.5,
    opacity: 1,
    form: "furniture",
    glow: { pool: 1.8, at: [0, 0.2] },
  },
};

export function blockLook(block: BlockKind): BlockLook {
  return BLOCK_LOOKS[block];
}

/** Same values as RESIDENT_COLOR_HEX in ui/src/looks.ts and `--resident-*` in tokens.css. */
const RESIDENT_HEX: Record<ResidentColor, number> = {
  sun: hex("#f2b84b"),
  sky: hex("#7cb9dd"),
  leaf: hex("#86b65f"),
  rose: hex("#ea8a9d"),
  plum: hex("#a98bd8"),
  sand: hex("#e2c993"),
  coal: hex("#4a443d"),
  snow: hex("#fbf7ee"),
};

export function residentHex(color: ResidentColor): number {
  return RESIDENT_HEX[color];
}

export const FLAVORS = ["lemon", "strawberry", "berry", "apricot"] as const;
export type Flavor = (typeof FLAVORS)[number];

export interface FlavorLook {
  /** The jam itself. */
  jam: number;
  /** The fruit drawn on the label. */
  fruit: string;
  /** Second fruit color (leaf, seeds, or blush). */
  accent: string;
  /** Gingham check on the lid cloth. */
  gingham: string;
  label: string;
}

const FLAVOR_LOOKS: Record<Flavor, FlavorLook> = {
  lemon: {
    jam: hex("#f2c53d"),
    fruit: "#f5cf3c",
    accent: "#6b9a4a",
    gingham: "#e2b23a",
    label: "Lemon",
  },
  strawberry: {
    jam: hex("#c8344a"),
    fruit: "#d9475b",
    accent: "#6b9a4a",
    gingham: "#d9475b",
    label: "Strawberry",
  },
  berry: {
    jam: hex("#5b2f86"),
    fruit: "#4b3f9a",
    accent: "#7cb9dd",
    gingham: "#6b5bb8",
    label: "Berry",
  },
  apricot: {
    jam: hex("#ec8c3a"),
    fruit: "#f2a04f",
    accent: "#e0603f",
    gingham: "#e58b3e",
    label: "Apricot",
  },
};

export function flavorLook(flavor: Flavor): FlavorLook {
  return FLAVOR_LOOKS[flavor];
}

export function isFlavor(value: unknown): value is Flavor {
  return typeof value === "string" && (FLAVORS as readonly string[]).includes(value);
}

/** Mix two colors: t = 0 is `a`, t = 1 is `b`. Used to fade neighbors into the haze. */
export function mix(a: number, b: number, t: number): number {
  const k = Math.min(1, Math.max(0, t));
  const ch = (c: number, s: number) => (c >> s) & 255;
  const out = (s: number) => Math.round(ch(a, s) + (ch(b, s) - ch(a, s)) * k) << s;
  return out(16) | out(8) | out(0);
}

/** Lighten (t > 0, toward white) or darken (t < 0, toward black) a color. */
export function shade(color: number, t: number): number {
  return t >= 0 ? mix(color, 0xffffff, t) : mix(color, 0x000000, -t);
}
