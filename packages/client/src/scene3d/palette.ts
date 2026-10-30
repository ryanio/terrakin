/**
 * The 3D palette: the brand colors from tokens.css and scripts/brand/logo.ts, and how each block,
 * resident color, and jam flavor looks in 3D. Plain numbers, no three.js, so tests can pin them
 * and the 2D and 3D worlds keep one look.
 */
import {
  BLOCK_COLORS,
  type BlockKind,
  DOOR_LOOK,
  OUTSIDE_GROUND,
  type ResidentColor,
} from "@terrakin/sim";
import { BRAND_HEX } from "@terrakin/ui/brand";
import { RESIDENT_COLOR_HEX } from "@terrakin/ui/looks";

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
  /** Beyond the edge of the world, as the 2D map draws it. */
  sand: hex(OUTSIDE_GROUND),
  /** Dark earth, and the glow of a fire's embers. */
  earthDeep: hex("#7d5a3c"),
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
   * `height` is how tall it stands; "water" is a pond tile (RFC 0023), flat in the ground with a
   * stone rim along its banks (`pondMeshes` in `blocks.ts`), where `height` is the rim's;
   * "stairs" is a flight of treads a floor tall (RFC 0028, `stairsGeometry` in `blocks.ts`);
   * "door" is a wall-high frame with a door standing open in it (decision 0349, `doorMeshes` in
   * `blocks.ts`), which a figure walks through.
   */
  form: "voxel" | "clump" | "decor" | "furniture" | "water" | "stairs" | "door";
  /**
   * Lit after dark (decision 0098): a pool of warm light `pool` tiles across on the ground, its
   * middle `at` from the tile's (x east, z south). With `home`, only while the tile is `lit`: a
   * window in a home someone's in, or a kiln firing a pot (RFC 0047).
   */
  glow?: Glow;
}

/** How a block lights up after dark. Its model's shade or flame glows through `Stage.glow`. */
interface Glow {
  pool: number;
  at?: readonly [number, number];
  home?: true;
}

/** Same base colors as the 2D renderer (render.ts BLOCK_COLORS). */
const BLOCK_LOOKS: Record<BlockKind, BlockLook> = {
  wood: { color: hex("#c29468"), height: 1.25, opacity: 1, form: "voxel" },
  stone: { color: hex(BLOCK_COLORS.stone), height: 1.25, opacity: 1, form: "voxel" },
  // A window: lit from inside after dark while someone's home.
  glass: {
    color: hex(BLOCK_COLORS.glass),
    height: 1.25,
    opacity: 0.42,
    form: "voxel",
    glow: { pool: 1.7, home: true },
  },
  leaf: { color: hex(BLOCK_COLORS.leaf), height: 0.95, opacity: 1, form: "clump" },
  planter: { color: hex(BLOCK_COLORS.planter), height: 0.5, opacity: 1, form: "voxel" },
  kitchen: { color: hex(BLOCK_COLORS.kitchen), height: 0.95, opacity: 1, form: "voxel" },
  workbench: { color: hex(BLOCK_COLORS.workbench), height: 0.8, opacity: 1, form: "voxel" },
  // A pot set down (RFC 0047) is never built as a block: it stands on its tile as its drawn
  // picture (`displayedThings`, `on: "ground"`), and the layouts leave its block out.
  pot: { color: hex(BLOCK_COLORS.pot), height: 0.06, opacity: 1, form: "voxel" },
  // A kiln (RFC 0047): fired brick, glowing after dark while it fires a pot (`lit`).
  kiln: {
    color: hex(BLOCK_COLORS.kiln),
    height: 0.95,
    opacity: 1,
    form: "voxel",
    glow: { pool: 1.6, home: true },
  },
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
  // Halloween's decor (RFC 0022), modelled in decor.ts. The cauldron's brew glows after dark.
  bat_bunting: { color: hex(BLOCK_COLORS.bat_bunting), height: 1.05, opacity: 1, form: "decor" },
  cauldron: {
    color: hex(BLOCK_COLORS.cauldron),
    height: 0.62,
    opacity: 1,
    form: "decor",
    glow: { pool: 1.6 },
  },
  candy_bowl: { color: hex(BLOCK_COLORS.candy_bowl), height: 0.6, opacity: 1, form: "decor" },
  // Winter's decor (RFC 0017), modelled in decor.ts. A string of lights glows after dark.
  snowman: { color: hex(BLOCK_COLORS.snowman), height: 1.35, opacity: 1, form: "decor" },
  string_lights: {
    color: hex(BLOCK_COLORS.string_lights),
    height: 1.02,
    opacity: 1,
    form: "decor",
    glow: { pool: 1.5, at: [0, 0.05] },
  },
  little_fir: { color: hex(BLOCK_COLORS.little_fir), height: 1.3, opacity: 1, form: "decor" },
  sled: { color: hex(BLOCK_COLORS.sled), height: 0.3, opacity: 1, form: "decor" },
  // Water to fish in (RFC 0023), in the sim's pond look.
  pond: { color: hex(BLOCK_COLORS.pond), height: 0.14, opacity: 1, form: "water" },
  // Stairs up a floor (RFC 0028): plank treads a whole floor tall, modelled in blocks.ts.
  stairs: { color: hex(BLOCK_COLORS.stairs), height: 1.25, opacity: 1, form: "stairs" },
  // Thanksgiving's decor (RFC 0034), modelled in decor.ts.
  cornucopia: { color: hex(BLOCK_COLORS.cornucopia), height: 0.55, opacity: 1, form: "decor" },
  leaf_garland: { color: hex(BLOCK_COLORS.leaf_garland), height: 1.05, opacity: 1, form: "decor" },
  // Hanukkah's decor (RFC 0034), modelled in decor.ts.
  menorah: { color: hex(BLOCK_COLORS.menorah), height: 0.8, opacity: 1, form: "decor" },
  dreidel: { color: hex(BLOCK_COLORS.dreidel), height: 0.45, opacity: 1, form: "decor" },
  // Midwinter's stocking (RFC 0034), modelled in decor.ts.
  stocking: { color: hex(BLOCK_COLORS.stocking), height: 0.6, opacity: 1, form: "decor" },
  // Spring's and summer's decor (decision 0311), modelled in decor.ts.
  bird_bath: { color: hex(BLOCK_COLORS.bird_bath), height: 0.8, opacity: 1, form: "decor" },
  beehive: { color: hex(BLOCK_COLORS.beehive), height: 0.7, opacity: 1, form: "decor" },
  // Made materials (RFC 0041): walls and windows crafted at a workbench. Each stands as tall as a
  // wood or stone wall, since that is what they are, and the two panes are windows, so they are
  // see-through and light up from inside after dark exactly as glass does.
  plaster: { color: hex(BLOCK_COLORS.plaster), height: 1.25, opacity: 1, form: "voxel" },
  brickwork: { color: hex(BLOCK_COLORS.brickwork), height: 1.25, opacity: 1, form: "voxel" },
  timber_frame: { color: hex(BLOCK_COLORS.timber_frame), height: 1.25, opacity: 1, form: "voxel" },
  driftwood_plank: {
    color: hex(BLOCK_COLORS.driftwood_plank),
    height: 1.25,
    opacity: 1,
    form: "voxel",
  },
  sea_glass_pane: {
    color: hex(BLOCK_COLORS.sea_glass_pane),
    height: 1.25,
    opacity: 0.82,
    form: "voxel",
    glow: { pool: 1.7, home: true },
  },
  // A door (decision 0349): its frame as tall as a wall, in the sim's `DOOR_LOOK`.
  door: { color: hex(DOOR_LOOK.panel), height: 1.25, opacity: 1, form: "door" },
  // Cozy homes (RFC 0044): furniture you rest on, modelled in furniture.ts.
  armchair: { color: hex(BLOCK_COLORS.armchair), height: 0.95, opacity: 1, form: "furniture" },
  sofa: { color: hex(BLOCK_COLORS.sofa), height: 0.9, opacity: 1, form: "furniture" },
  bed: { color: hex(BLOCK_COLORS.bed), height: 0.85, opacity: 1, form: "furniture" },
  // Roomier homes (RFC 0050): surfaces, at the height a small thing stands on.
  desk: { color: hex(BLOCK_COLORS.desk), height: 0.78, opacity: 1, form: "furniture" },
  side_table: { color: hex(BLOCK_COLORS.side_table), height: 0.56, opacity: 1, form: "furniture" },
  dresser: { color: hex(BLOCK_COLORS.dresser), height: 0.88, opacity: 1, form: "furniture" },
  // More for a home, modelled in furniture.ts. The coffee table is a surface, so its height is its
  // top; the fireplace and the floor lamp glow after dark.
  wardrobe: { color: hex(BLOCK_COLORS.wardrobe), height: 1.62, opacity: 1, form: "furniture" },
  rocking_chair: {
    color: hex(BLOCK_COLORS.rocking_chair),
    height: 1.1,
    opacity: 1,
    form: "furniture",
  },
  piano: { color: hex(BLOCK_COLORS.piano), height: 1.32, opacity: 1, form: "furniture" },
  bathtub: { color: hex(BLOCK_COLORS.bathtub), height: 0.58, opacity: 1, form: "furniture" },
  fireplace: {
    color: hex(BLOCK_COLORS.fireplace),
    height: 1.25,
    opacity: 1,
    form: "furniture",
    glow: { pool: 2, at: [0, 0.3] },
  },
  aquarium: { color: hex(BLOCK_COLORS.aquarium), height: 1.04, opacity: 1, form: "furniture" },
  coffee_table: {
    color: hex(BLOCK_COLORS.coffee_table),
    height: 0.42,
    opacity: 1,
    form: "furniture",
  },
  coat_rack: { color: hex(BLOCK_COLORS.coat_rack), height: 1.6, opacity: 1, form: "furniture" },
  floor_lamp: {
    color: hex(BLOCK_COLORS.floor_lamp),
    height: 1.57,
    opacity: 1,
    form: "furniture",
    glow: { pool: 1.8 },
  },
  potted_tree: { color: hex(BLOCK_COLORS.potted_tree), height: 1.4, opacity: 1, form: "furniture" },
};

export function blockLook(block: BlockKind): BlockLook {
  return BLOCK_LOOKS[block];
}

/** A window, which lights from inside after dark in a home someone's in (decision 0098). */
export function isWindow(block: BlockKind): boolean {
  return block === "glass" || block === "sea_glass_pane";
}

/** The resident colors of `RESIDENT_COLOR_HEX`, as numbers. */
const RESIDENT_HEX = Object.fromEntries(
  Object.entries(RESIDENT_COLOR_HEX).map(([name, color]) => [name, hex(color)]),
) as Record<ResidentColor, number>;

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
