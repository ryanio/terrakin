/**
 * Looks (RFC 0005) for drawing: palettes, pattern motifs, cached pattern tiles, and uploaded images.
 * The catalog itself is data in the sim; this file only turns it into pixels. Pure parts (palettes,
 * motif layouts, the tile cache) are tested without a browser.
 */
import {
  alphaHex,
  BLOCK_COLORS,
  DEFAULT_HAIR_COLOR,
  type GarmentPattern,
  HAIR_COLOR_INFO,
  HAIR_LABELS,
  type HairColor,
  type HairStyle,
  mixHex,
  type Pattern,
  type ResidentColor,
  THEME_INFO,
  type Theme,
  type ThemePalette,
  WEAR_INFO,
  type WearItem,
} from "@terrakin/sim";
import { BRAND_HEX, WOOD } from "./brand";
import type { FigureLook } from "./figure";
import { isMediaUrl } from "./format";

/** Resident colors. Same values as the `--resident-*` tokens in tokens.css. */
export const RESIDENT_COLOR_HEX: Record<ResidentColor, string> = {
  sun: "#f2b84b",
  sky: "#7cb9dd",
  leaf: "#86b65f",
  rose: "#ea8a9d",
  plum: "#a98bd8",
  sand: "#e2c993",
  coal: "#4a443d",
  snow: "#fbf7ee",
};

/**
 * Halloween's colors (RFC 0022): the costumes and the decor, as the 2D figure, the item pictures,
 * the map, and the 3D views draw them. A costume with a color of its own (`wearStyle`) uses that
 * instead of its main color here.
 */
export const HALLOWEEN_HEX = {
  /** The witch hat's felt, and its band and buckle. */
  witch: "#3b2f52",
  witchBand: "#e8862f",
  buckle: "#f2c94c",
  /** Cat ears, and their pink insides. */
  catEars: "#3a3340",
  catInner: "#f2a7b8",
  /** A pumpkin, its ribs and stem, and a carved face lit from inside. */
  pumpkin: BLOCK_COLORS.jack_o_lantern,
  pumpkinRib: "#c4661c",
  pumpkinStem: "#76703a",
  lit: "#ffd36b",
  carved: "#5a2c12",
  /** The ghost sheet, and the shade in its folds. */
  sheet: "#f7f4ee",
  sheetShade: "#ddd5c8",
  /** Bats: wings, and the paler skin between their ribs. */
  bat: BLOCK_COLORS.bat_bunting,
  batInner: "#5b4a6e",
  /** The cauldron's iron, its rim, and the green brew in it. */
  iron: BLOCK_COLORS.cauldron,
  ironRim: "#56545e",
  brew: "#8fd16a",
  brewLight: "#c8f0a8",
  /** Candy wrappers. */
  candy: ["#f08a3c", "#a98bd8", "#ea8a9d", "#7fd1b0", "#f2b84b"],
} as const;

/**
 * Winter's decor and sweets (RFC 0017 and RFC 0022), as the item pictures, the map, and the 3D views
 * draw them; plot photos repeat them in `packages/cards/`. The snowman's snow is a shade bluer than
 * snowy ground, with a cool shade on its far side, so it stands out on a winter plot.
 */
export const WINTER_HEX = {
  /** The snowman: snow and its shade, coal eyes and buttons, a carrot nose, a scarf, a hat. */
  snow: BLOCK_COLORS.snowman,
  snowShade: "#c4d2e2",
  coal: "#2f2c33",
  carrot: "#ec7a2c",
  scarf: "#c8344a",
  scarfStripe: "#f6e7c8",
  hat: "#3a3946",
  /** A string of lights: its wire, and its bulbs from one end to the other. */
  wire: "#3f5a3c",
  bulbs: ["#f2564c", BLOCK_COLORS.string_lights, "#5ec0ea", "#7fd17a", "#c38df0"],
  /** The little fir: its needles, a lighter side, its clay pot and rim, and a gold star. */
  needles: BLOCK_COLORS.little_fir,
  needlesLight: "#4a8f5c",
  pot: "#c8674a",
  potRim: "#a9533a",
  star: "#f2c94c",
  /** The sled: iron runners, red slats, and its rope. */
  runner: "#4a4542",
  slat: BLOCK_COLORS.sled,
  rope: "#e3cf9c",
  /** Hot cranberry punch, and a candy cane's stripes. */
  punch: "#a3173a",
  mug: "#f3ead9",
  caneRed: "#d63a3a",
  caneGreen: "#4f9a5a",
  /** The Santa hat's red, and its white cuff and bobble (RFC 0034). */
  santa: "#c8344a",
  santaTrim: "#fbf6ec",
  /** A stocking's red felt and its white cuff. */
  stocking: BLOCK_COLORS.stocking,
  stockingCuff: "#fbf6ec",
  /** A firework's rocket, its paper and its stick, and its spark. */
  rocket: "#c8344a",
  rocketStick: WOOD,
  spark: "#f5c451",
  /** Presents waiting under a tree: their papers, biggest box first, and the ribbon on each. */
  wrapping: ["#c8344a", "#2f6e45", "#f2c94c"],
  ribbon: "#fbf6ec",
} as const;

/**
 * Thanksgiving's colors (RFC 0034), as the item pictures, the map, the 3D views, and plot photos
 * draw them.
 */
export const THANKSGIVING_HEX = {
  /** The cornucopia: its wicker, the weave's shade, and what spills from it. */
  wicker: BLOCK_COLORS.cornucopia,
  weave: "#9c6b3a",
  apple: "#d2463a",
  gourd: "#e8862f",
  grapes: "#7b4f9c",
  pear: "#c9c25a",
  /** The leaf garland: its string, and its maple leaves from one end to the other. */
  twine: "#7a5a3a",
  leaves: [BLOCK_COLORS.leaf_garland, "#e0a33a", "#a8382c", "#d47a2a", "#b85a2a"],
} as const;

/**
 * Hanukkah's colors (RFC 0034), as the item pictures, the map, the 3D views, and plot photos draw
 * them.
 */
export const HANUKKAH_HEX = {
  /** The menorah: its brass and the brass's shade, its candles, and a flame with its core. */
  brass: BLOCK_COLORS.menorah,
  brassDark: "#9c7a2e",
  candle: "#f4f1e8",
  flame: "#ffb43c",
  flameCore: "#fff3c4",
  /** The dreidel: its blue sides, a lighter face, and its handle. */
  dreidel: BLOCK_COLORS.dreidel,
  dreidelLight: "#6f97d0",
  /** Gelt: gold foil and its rim. */
  gelt: "#e8b84a",
  geltRim: "#b8892a",
  /** A jelly doughnut: its dough, its sugar, and the jam inside. */
  dough: "#d9a05b",
  sugar: "#fbf6ec",
  jelly: "#c8344a",
} as const;

/**
 * Earned wear's colors, as the 2D figure, the item pictures, and the 3D figures draw them: one
 * garment a skill (RFC 0029), and the town satchel that comes with jobs finished (RFC 0030). A
 * garment with a color of its own (`wearStyle`) uses that instead of its main color here.
 */
export const EARNED_HEX = {
  /** Growing's sun hat: pale woven straw, a moss ribbon, and a leaf tucked in it. */
  sunHat: "#f4e3b0",
  sunHatWeave: "#d9bd7a",
  sunHatBand: BRAND_HEX.moss,
  sunHatLeaf: BRAND_HEX.mossLight,
  /** Making's tool belt: tanned leather, a darker pouch, a brass buckle, and a hammer. */
  belt: "#a8733f",
  beltPouch: "#84562c",
  buckle: "#e8b84a",
  hammerHead: "#8d939a",
  hammerHandle: "#d9b47a",
  /** Foraging's field vest: waxed olive canvas with paler pockets. */
  vest: "#7d8a4f",
  vestPocket: "#9aa66a",
  vestTrim: "#586337",
  /** Hosting's party sash: rose satin edged in gold, with a gold star. */
  sash: "#e06a8c",
  sashEdge: "#f2c94c",
  /** Playing's rosette: a blue ribbon pleated round a gold middle, with two tails. */
  rosette: "#4f8fd0",
  rosetteDeep: "#3568a8",
  rosetteMiddle: "#f2c94c",
  /** The town satchel: slate canvas under a darker flap, with a gold star for its clasp. */
  townSatchel: "#4f6f8f",
  townSatchelFlap: "#3d5873",
  townSatchelClasp: "#f2c94c",
} as const;

/**
 * A bat with its wings spread, as a polygon in units of half its wingspan around its middle: x
 * from -1 to 1, y down. Bunting, bat wings, and the item pictures all draw this one bat.
 */
export const BAT_POINTS: readonly (readonly [number, number])[] = [
  [0, -0.2],
  [-0.12, -0.42],
  [-0.2, -0.18],
  [-0.55, -0.36],
  [-1, -0.08],
  [-0.78, 0.06],
  [-0.66, 0],
  [-0.52, 0.2],
  [-0.36, 0.1],
  [-0.2, 0.32],
  [0, 0.18],
  [0.2, 0.32],
  [0.36, 0.1],
  [0.52, 0.2],
  [0.66, 0],
  [0.78, 0.06],
  [1, -0.08],
  [0.55, -0.36],
  [0.2, -0.18],
  [0.12, -0.42],
];

/**
 * One bat wing worn as a costume, the left one, in tiles from the figure's feet (y up is negative):
 * from the shoulder out to the tip, then back along its scallops. The right wing is its mirror. The
 * 2D figure and the 3D peg figures both draw it.
 */
export const BAT_WING: readonly (readonly [number, number])[] = [
  [-0.07, -0.47],
  [-0.2, -0.56],
  [-0.34, -0.61],
  [-0.48, -0.58],
  [-0.45, -0.5],
  [-0.43, -0.4],
  [-0.36, -0.43],
  [-0.32, -0.33],
  [-0.25, -0.37],
  [-0.2, -0.27],
  [-0.12, -0.33],
  [-0.06, -0.3],
];

/** Costumes that cover the whole head, so no hair shows under them (RFC 0022). */
export const HIDES_HAIR: readonly WearItem[] = ["pumpkin_head", "ghost_sheet"];

/** Whether something worn hides the hair: a pumpkin head or a ghost sheet. */
export const hidesHair = (wear: readonly WearItem[] | undefined): boolean =>
  (wear ?? []).some((w) => HIDES_HAIR.includes(w));

/** A bat centered on (cx, cy), `span` wide, as SVG path data. */
export function batPath(cx: number, cy: number, span: number): string {
  const k = span / 2;
  const at = ([x, y]: readonly [number, number]) =>
    `${Math.round((cx + x * k) * 100) / 100} ${Math.round((cy + y * k) * 100) / 100}`;
  return `M${BAT_POINTS.map(at).join("L")}z`;
}

/**
 * A maple leaf, point up, its stem at the bottom (RFC 0034's leaf garland): half its width is 1.
 * The map, the 3D views, and the plot photo draw it from these points.
 */
export const LEAF_POINTS: readonly (readonly [number, number])[] = [
  [0, -1],
  [0.25, -0.45],
  [0.75, -0.65],
  [0.55, -0.1],
  [1, 0.1],
  [0.45, 0.35],
  [0.5, 0.8],
  [0, 0.5],
  [-0.5, 0.8],
  [-0.45, 0.35],
  [-1, 0.1],
  [-0.55, -0.1],
  [-0.75, -0.65],
  [-0.25, -0.45],
];

/** A maple leaf centered at (cx, cy), `span` wide, as SVG path data. */
export function leafPath(cx: number, cy: number, span: number): string {
  const k = span / 2;
  const at = ([x, y]: readonly [number, number]) =>
    `${Math.round((cx + x * k) * 100) / 100} ${Math.round((cy + y * k) * 100) / 100}`;
  return `M${LEAF_POINTS.map(at).join("L")}z`;
}

const PAPER = BRAND_HEX.paper;
const INK = BRAND_HEX.ink;

/** Blend two hex colors: `t` 0 is `a`, 1 is `b`. The sim's palette has the one copy. */
export const mix = mixHex;

/** A hex color as rgba() with an alpha. */
export const withAlpha = alphaHex;

/** Relative luminance of a `#rrggbb` color, 0 (black) to 1 (white). */
export function luminance(hex: string): number {
  const n = Number.parseInt(hex.slice(1, 7), 16);
  const lin = (c: number) => {
    const v = c / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
}

/**
 * What a small pattern swatch is painted on: the cloth's own color, or a shade darker when it's
 * pale, so a pale motif (stripes on a snow outfit) still shows at thumbnail size. The figure keeps
 * the real color.
 */
export function swatchBacking(base: string): string {
  return luminance(base) > 0.75 ? mix(base, INK, 0.22) : base;
}

/** The palette for a look: its theme's, or one made from the resident's color when it has none. */
export function lookPalette(theme: Theme | undefined, color: ResidentColor): ThemePalette {
  if (theme && Object.hasOwn(THEME_INFO, theme)) return THEME_INFO[theme].palette;
  const c = RESIDENT_COLOR_HEX[color] ?? RESIDENT_COLOR_HEX.sun;
  const deep = mix(c, INK, 0.4);
  return {
    main: mix(c, PAPER, 0.3),
    accent: color === "snow" || color === "sand" ? deep : PAPER,
    deep,
    light: mix(c, PAPER, 0.72),
    ground: c,
  };
}

// ---------- pattern motifs ----------

export type Role = keyof Omit<ThemePalette, "ground">;

/**
 * One motif in a pattern tile, in tile units (0 to 1). Every motif sits inside the tile, so tiles
 * repeat without seams; waves run edge to edge and start and end at the same height. A painter
 * fills and strokes only: a tile is recorded for cards by a pen of its own (`figure-svg.ts`),
 * whose clip paths don't travel with it, so nothing here may clip.
 */
export type Motif =
  | { kind: "circle"; x: number; y: number; r: number; fill: Role; alpha?: number }
  | { kind: "rect"; x: number; y: number; w: number; h: number; fill: Role; alpha: number }
  | { kind: "star"; x: number; y: number; r: number; fill: Role }
  | { kind: "heart"; x: number; y: number; r: number; fill: Role }
  | { kind: "leaf"; x: number; y: number; r: number; angle: number; fill: Role; vein: Role }
  | { kind: "flower"; x: number; y: number; r: number; fill: Role; center: Role }
  | { kind: "slice"; x: number; y: number; r: number }
  | { kind: "wave"; y: number; amp: number; width: number; stroke: Role }
  | { kind: "lemon"; x: number; y: number; r: number; angle: number; fill: Role; leaf: Role }
  | { kind: "cherry"; x: number; y: number; r: number; fill: Role; stem: Role }
  | { kind: "mushroom"; x: number; y: number; r: number; cap: Role; stalk: Role }
  | { kind: "cat"; x: number; y: number; r: number; fill: Role; face: Role }
  | { kind: "fish"; x: number; y: number; r: number; angle: number; fill: Role; fin: Role }
  | { kind: "moon"; x: number; y: number; r: number; fill: Role }
  | { kind: "cloud"; x: number; y: number; r: number; fill: Role }
  | { kind: "bee"; x: number; y: number; r: number; fill: Role; band: Role };

const MOTIFS: Record<Pattern, Motif[]> = {
  plain: [],
  dots: [
    { kind: "circle", x: 0.25, y: 0.25, r: 0.11, fill: "accent" },
    { kind: "circle", x: 0.75, y: 0.75, r: 0.11, fill: "accent" },
  ],
  stripes: [{ kind: "rect", x: 0, y: 0, w: 1, h: 0.34, fill: "light", alpha: 0.85 }],
  gingham: [
    { kind: "rect", x: 0, y: 0, w: 1, h: 0.5, fill: "light", alpha: 0.5 },
    { kind: "rect", x: 0, y: 0, w: 0.5, h: 1, fill: "light", alpha: 0.5 },
  ],
  florals: [
    { kind: "flower", x: 0.3, y: 0.3, r: 0.2, fill: "light", center: "accent" },
    { kind: "flower", x: 0.77, y: 0.76, r: 0.13, fill: "accent", center: "light" },
  ],
  citrus: [
    { kind: "slice", x: 0.3, y: 0.3, r: 0.2 },
    { kind: "slice", x: 0.77, y: 0.77, r: 0.13 },
  ],
  stars: [
    { kind: "star", x: 0.3, y: 0.3, r: 0.17, fill: "accent" },
    { kind: "circle", x: 0.76, y: 0.74, r: 0.05, fill: "accent" },
  ],
  waves: [
    { kind: "wave", y: 0.3, amp: 0.08, width: 0.09, stroke: "light" },
    { kind: "wave", y: 0.8, amp: 0.08, width: 0.05, stroke: "accent" },
  ],
  hearts: [
    { kind: "heart", x: 0.3, y: 0.3, r: 0.17, fill: "accent" },
    { kind: "heart", x: 0.77, y: 0.77, r: 0.1, fill: "light" },
  ],
  leaves: [
    { kind: "leaf", x: 0.3, y: 0.32, r: 0.19, angle: -0.6, fill: "accent", vein: "deep" },
    { kind: "leaf", x: 0.76, y: 0.76, r: 0.13, angle: 0.9, fill: "light", vein: "deep" },
  ],
  // Prints scatter one thing three times at mixed sizes and angles, so a print reads as a print
  // rather than as another two-up geometric.
  lemons: [
    { kind: "lemon", x: 0.29, y: 0.27, r: 0.22, angle: -0.5, fill: "accent", leaf: "deep" },
    { kind: "lemon", x: 0.74, y: 0.66, r: 0.17, angle: 0.75, fill: "deep", leaf: "light" },
    { kind: "lemon", x: 0.82, y: 0.17, r: 0.11, angle: 2.1, fill: "accent", leaf: "deep" },
  ],
  cherries: [
    { kind: "cherry", x: 0.31, y: 0.3, r: 0.22, fill: "accent", stem: "deep" },
    { kind: "cherry", x: 0.75, y: 0.72, r: 0.17, fill: "deep", stem: "accent" },
    { kind: "cherry", x: 0.8, y: 0.21, r: 0.11, fill: "accent", stem: "deep" },
  ],
  mushrooms: [
    { kind: "mushroom", x: 0.3, y: 0.3, r: 0.22, cap: "accent", stalk: "light" },
    { kind: "mushroom", x: 0.74, y: 0.71, r: 0.17, cap: "deep", stalk: "light" },
    { kind: "mushroom", x: 0.81, y: 0.19, r: 0.1, cap: "accent", stalk: "light" },
  ],
  cats: [
    { kind: "cat", x: 0.3, y: 0.31, r: 0.22, fill: "accent", face: "light" },
    { kind: "cat", x: 0.74, y: 0.72, r: 0.17, fill: "deep", face: "light" },
    { kind: "cat", x: 0.8, y: 0.2, r: 0.11, fill: "accent", face: "light" },
  ],
  fish: [
    { kind: "fish", x: 0.3, y: 0.28, r: 0.22, angle: -0.22, fill: "accent", fin: "deep" },
    { kind: "fish", x: 0.73, y: 0.68, r: 0.17, angle: 0.3, fill: "deep", fin: "light" },
    { kind: "fish", x: 0.8, y: 0.2, r: 0.11, angle: 2.9, fill: "accent", fin: "deep" },
  ],
  moons: [
    { kind: "moon", x: 0.3, y: 0.3, r: 0.21, fill: "accent" },
    { kind: "moon", x: 0.74, y: 0.71, r: 0.16, fill: "deep" },
    { kind: "circle", x: 0.8, y: 0.21, r: 0.05, fill: "accent" },
    { kind: "circle", x: 0.2, y: 0.74, r: 0.04, fill: "deep" },
  ],
  clouds: [
    { kind: "cloud", x: 0.32, y: 0.28, r: 0.24, fill: "light" },
    { kind: "cloud", x: 0.72, y: 0.7, r: 0.19, fill: "accent" },
    { kind: "cloud", x: 0.84, y: 0.16, r: 0.12, fill: "accent" },
  ],
  bees: [
    { kind: "bee", x: 0.3, y: 0.3, r: 0.22, fill: "deep", band: "main" },
    { kind: "bee", x: 0.74, y: 0.71, r: 0.17, fill: "accent", band: "main" },
    { kind: "bee", x: 0.81, y: 0.2, r: 0.11, fill: "deep", band: "main" },
  ],
};

/** The motifs of one pattern tile. Plain is empty. */
export function patternMotifs(pattern: Pattern): readonly Motif[] {
  return Object.hasOwn(MOTIFS, pattern) ? MOTIFS[pattern] : [];
}

/** The box a motif covers, in tile units. Waves are periodic and span the tile. */
export function motifBounds(m: Motif): { x0: number; y0: number; x1: number; y1: number } {
  switch (m.kind) {
    case "rect":
      return { x0: m.x, y0: m.y, x1: m.x + m.w, y1: m.y + m.h };
    case "wave":
      return { x0: 0, y0: m.y - m.amp - m.width / 2, x1: 1, y1: m.y + m.amp + m.width / 2 };
    default:
      return { x0: m.x - m.r, y0: m.y - m.r, x1: m.x + m.r, y1: m.y + m.r };
  }
}

/** The height of a wave at x (tile units), periodic over one tile. */
export const waveY = (m: { y: number; amp: number }, x: number) =>
  m.y + Math.sin(x * Math.PI * 2) * m.amp;

/** The subset of a 2D context the painters use, so tests can pass a recorder. */
type Ctx = Pick<
  CanvasRenderingContext2D,
  | "beginPath"
  | "arc"
  | "ellipse"
  | "fill"
  | "fillRect"
  | "moveTo"
  | "lineTo"
  | "quadraticCurveTo"
  | "bezierCurveTo"
  | "closePath"
  | "stroke"
  | "save"
  | "restore"
> & {
  fillStyle: unknown;
  strokeStyle: unknown;
  lineWidth: number;
  lineCap: CanvasLineCap;
  globalAlpha: number;
};

/** Draw one motif at (ox, oy), with `u` pixels per tile unit. */
export function paintMotif(ctx: Ctx, m: Motif, p: ThemePalette, ox: number, oy: number, u: number) {
  const X = (x: number) => ox + x * u;
  const Y = (y: number) => oy + y * u;
  switch (m.kind) {
    case "circle":
      ctx.globalAlpha = m.alpha ?? 1;
      ctx.fillStyle = p[m.fill];
      ctx.beginPath();
      ctx.arc(X(m.x), Y(m.y), m.r * u, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
      return;
    case "rect":
      ctx.globalAlpha = m.alpha;
      ctx.fillStyle = p[m.fill];
      ctx.fillRect(X(m.x), Y(m.y), m.w * u, m.h * u);
      ctx.globalAlpha = 1;
      return;
    case "star": {
      ctx.fillStyle = p[m.fill];
      ctx.beginPath();
      for (let i = 0; i < 10; i++) {
        const a = -Math.PI / 2 + (i * Math.PI) / 5;
        const r = (i % 2 === 0 ? m.r : m.r * 0.45) * u;
        const x = X(m.x) + Math.cos(a) * r;
        const y = Y(m.y) + Math.sin(a) * r;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.fill();
      return;
    }
    case "heart": {
      const x = X(m.x);
      const y = Y(m.y);
      const r = m.r * u;
      ctx.fillStyle = p[m.fill];
      ctx.beginPath();
      ctx.moveTo(x, y + r * 0.9);
      ctx.bezierCurveTo(x - r * 1.25, y + r * 0.1, x - r * 0.75, y - r * 0.95, x, y - r * 0.35);
      ctx.bezierCurveTo(x + r * 0.75, y - r * 0.95, x + r * 1.25, y + r * 0.1, x, y + r * 0.9);
      ctx.fill();
      return;
    }
    case "leaf": {
      const x = X(m.x);
      const y = Y(m.y);
      const r = m.r * u;
      const cos = Math.cos(m.angle);
      const sin = Math.sin(m.angle);
      const pt = (a: number, b: number): [number, number] => [
        x + a * cos - b * sin,
        y + a * sin + b * cos,
      ];
      ctx.fillStyle = p[m.fill];
      ctx.beginPath();
      ctx.moveTo(...pt(-r, 0));
      ctx.quadraticCurveTo(...pt(0, -r * 0.75), ...pt(r, 0));
      ctx.quadraticCurveTo(...pt(0, r * 0.75), ...pt(-r, 0));
      ctx.fill();
      ctx.strokeStyle = p[m.vein];
      ctx.lineWidth = Math.max(0.6, r * 0.12);
      ctx.beginPath();
      ctx.moveTo(...pt(-r * 0.75, 0));
      ctx.lineTo(...pt(r * 0.7, 0));
      ctx.stroke();
      return;
    }
    case "flower": {
      const x = X(m.x);
      const y = Y(m.y);
      const r = m.r * u;
      ctx.fillStyle = p[m.fill];
      ctx.beginPath();
      for (let i = 0; i < 5; i++) {
        const a = (i * Math.PI * 2) / 5 - Math.PI / 2;
        const px = x + Math.cos(a) * r * 0.55;
        const py = y + Math.sin(a) * r * 0.55;
        ctx.moveTo(px + r * 0.42, py);
        ctx.arc(px, py, r * 0.42, 0, Math.PI * 2);
      }
      ctx.fill();
      ctx.fillStyle = p[m.center];
      ctx.beginPath();
      ctx.arc(x, y, r * 0.3, 0, Math.PI * 2);
      ctx.fill();
      return;
    }
    case "slice": {
      // A citrus slice: rind, pith, flesh in segments.
      const x = X(m.x);
      const y = Y(m.y);
      const r = m.r * u;
      ctx.fillStyle = p.deep;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = p.light;
      ctx.beginPath();
      ctx.arc(x, y, r * 0.84, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = mix(p.main, p.deep, 0.15);
      ctx.beginPath();
      for (let i = 0; i < 6; i++) {
        const a0 = (i * Math.PI) / 3 + 0.12;
        const a1 = ((i + 1) * Math.PI) / 3 - 0.12;
        ctx.moveTo(x + Math.cos(a0) * r * 0.12, y + Math.sin(a0) * r * 0.12);
        ctx.arc(x, y, r * 0.7, a0, a1);
        ctx.closePath();
      }
      ctx.fill();
      return;
    }
    case "wave": {
      ctx.strokeStyle = p[m.stroke];
      ctx.lineWidth = m.width * u;
      ctx.lineCap = "butt";
      ctx.beginPath();
      const steps = 16;
      for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        const x = X(t);
        const y = Y(waveY(m, t));
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
      return;
    }
    case "lemon": {
      // A whole lemon: a lens with a point at each end, turned by `angle`, and a leaf at its side.
      const x = X(m.x);
      const y = Y(m.y);
      const r = m.r * u;
      const cos = Math.cos(m.angle);
      const sin = Math.sin(m.angle);
      const pt = (a: number, b: number): [number, number] => [
        x + a * cos - b * sin,
        y + a * sin + b * cos,
      ];
      ctx.fillStyle = p[m.fill];
      ctx.beginPath();
      ctx.ellipse(x, y, r * 0.76, r * 0.55, m.angle, 0, Math.PI * 2);
      ctx.fill();
      // A nub at each end, which is what tells a lemon from the leaf motif at this size.
      ctx.beginPath();
      ctx.moveTo(...pt(0.68 * r, -0.13 * r));
      ctx.lineTo(...pt(0.97 * r, 0));
      ctx.lineTo(...pt(0.68 * r, 0.13 * r));
      ctx.closePath();
      ctx.moveTo(...pt(-0.68 * r, -0.13 * r));
      ctx.lineTo(...pt(-0.97 * r, 0));
      ctx.lineTo(...pt(-0.68 * r, 0.13 * r));
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = p[m.leaf];
      ctx.beginPath();
      ctx.moveTo(...pt(0.08 * r, -0.44 * r));
      ctx.quadraticCurveTo(...pt(0.42 * r, -0.88 * r), ...pt(0.56 * r, -0.5 * r));
      ctx.quadraticCurveTo(...pt(0.3 * r, -0.4 * r), ...pt(0.08 * r, -0.44 * r));
      ctx.fill();
      return;
    }
    case "cherry": {
      // Two cherries on stems that meet above them.
      const x = X(m.x);
      const y = Y(m.y);
      const r = m.r * u;
      ctx.strokeStyle = p[m.stem];
      ctx.lineWidth = Math.max(0.6, r * 0.13);
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(x - 0.34 * r, y + 0.42 * r);
      ctx.quadraticCurveTo(x - 0.22 * r, y - 0.44 * r, x + 0.04 * r, y - 0.8 * r);
      ctx.moveTo(x + 0.36 * r, y + 0.54 * r);
      ctx.quadraticCurveTo(x + 0.36 * r, y - 0.26 * r, x + 0.04 * r, y - 0.8 * r);
      ctx.stroke();
      ctx.fillStyle = p[m.fill];
      ctx.beginPath();
      ctx.moveTo(x - 0.01 * r, y + 0.42 * r);
      ctx.arc(x - 0.34 * r, y + 0.42 * r, r * 0.33, 0, Math.PI * 2);
      ctx.moveTo(x + 0.64 * r, y + 0.54 * r);
      ctx.arc(x + 0.36 * r, y + 0.54 * r, r * 0.28, 0, Math.PI * 2);
      ctx.fill();
      return;
    }
    case "mushroom": {
      // Stalk first, then the cap over it, then two spots on the cap.
      const x = X(m.x);
      const y = Y(m.y);
      const r = m.r * u;
      ctx.fillStyle = p[m.stalk];
      ctx.beginPath();
      ctx.moveTo(x - 0.2 * r, y - 0.1 * r);
      ctx.lineTo(x + 0.2 * r, y - 0.1 * r);
      ctx.quadraticCurveTo(x + 0.26 * r, y + 0.7 * r, x, y + 0.74 * r);
      ctx.quadraticCurveTo(x - 0.26 * r, y + 0.7 * r, x - 0.2 * r, y - 0.1 * r);
      ctx.fill();
      ctx.fillStyle = p[m.cap];
      ctx.beginPath();
      ctx.moveTo(x - 0.8 * r, y - 0.06 * r);
      ctx.quadraticCurveTo(x - 0.74 * r, y - 0.86 * r, x, y - 0.86 * r);
      ctx.quadraticCurveTo(x + 0.74 * r, y - 0.86 * r, x + 0.8 * r, y - 0.06 * r);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = p[m.stalk];
      ctx.beginPath();
      ctx.moveTo(x - 0.16 * r, y - 0.42 * r);
      ctx.arc(x - 0.34 * r, y - 0.42 * r, r * 0.18, 0, Math.PI * 2);
      ctx.moveTo(x + 0.44 * r, y - 0.3 * r);
      ctx.arc(x + 0.3 * r, y - 0.3 * r, r * 0.14, 0, Math.PI * 2);
      ctx.fill();
      return;
    }
    case "cat": {
      // A cat's face: two ears, a round head, two eyes.
      const x = X(m.x);
      const y = Y(m.y);
      const r = m.r * u;
      ctx.fillStyle = p[m.fill];
      ctx.beginPath();
      ctx.moveTo(x - 0.56 * r, y - 0.2 * r);
      ctx.lineTo(x - 0.42 * r, y - 0.84 * r);
      ctx.lineTo(x - 0.04 * r, y - 0.42 * r);
      ctx.closePath();
      ctx.moveTo(x + 0.56 * r, y - 0.2 * r);
      ctx.lineTo(x + 0.42 * r, y - 0.84 * r);
      ctx.lineTo(x + 0.04 * r, y - 0.42 * r);
      ctx.closePath();
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(x, y + 0.12 * r, r * 0.62, r * 0.56, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = p[m.face];
      ctx.beginPath();
      ctx.moveTo(x - 0.08 * r, y + 0.02 * r);
      ctx.arc(x - 0.22 * r, y + 0.02 * r, r * 0.14, 0, Math.PI * 2);
      ctx.moveTo(x + 0.36 * r, y + 0.02 * r);
      ctx.arc(x + 0.22 * r, y + 0.02 * r, r * 0.14, 0, Math.PI * 2);
      ctx.fill();
      return;
    }
    case "fish": {
      // A little fish swimming along `angle`: a tail, a lens of a body, and an eye.
      const x = X(m.x);
      const y = Y(m.y);
      const r = m.r * u;
      const cos = Math.cos(m.angle);
      const sin = Math.sin(m.angle);
      const pt = (a: number, b: number): [number, number] => [
        x + a * cos - b * sin,
        y + a * sin + b * cos,
      ];
      ctx.fillStyle = p[m.fill];
      ctx.beginPath();
      ctx.moveTo(...pt(-0.3 * r, 0));
      ctx.lineTo(...pt(-0.9 * r, -0.3 * r));
      ctx.lineTo(...pt(-0.9 * r, 0.3 * r));
      ctx.closePath();
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(...pt(-0.36 * r, 0));
      ctx.quadraticCurveTo(...pt(0.1 * r, -0.8 * r), ...pt(0.82 * r, 0));
      ctx.quadraticCurveTo(...pt(0.1 * r, 0.8 * r), ...pt(-0.36 * r, 0));
      ctx.fill();
      ctx.fillStyle = p[m.fin];
      const [ex, ey] = pt(0.42 * r, -0.1 * r);
      ctx.beginPath();
      ctx.arc(ex, ey, r * 0.11, 0, Math.PI * 2);
      ctx.fill();
      return;
    }
    case "moon": {
      // A crescent: the long way round the outside, then one curve back for the inner edge, so
      // the shape is a single filled path with nothing cut out of it.
      const x = X(m.x);
      const y = Y(m.y);
      const R = m.r * u * 0.95;
      const a = Math.PI * 0.32;
      const hx = x + Math.cos(a) * R;
      ctx.fillStyle = p[m.fill];
      ctx.beginPath();
      ctx.moveTo(hx, y + Math.sin(a) * R);
      ctx.arc(x, y, R, a, -a, false);
      ctx.quadraticCurveTo(x - 1.2 * R, y, hx, y + Math.sin(a) * R);
      ctx.fill();
      return;
    }
    case "cloud": {
      // Three bumps along a flat bottom, drawn as one path.
      const x = X(m.x);
      const y = Y(m.y);
      const r = m.r * u;
      ctx.fillStyle = p[m.fill];
      ctx.beginPath();
      ctx.moveTo(x - 0.86 * r, y + 0.42 * r);
      ctx.quadraticCurveTo(x - 0.92 * r, y - 0.18 * r, x - 0.4 * r, y - 0.2 * r);
      ctx.quadraticCurveTo(x - 0.34 * r, y - 0.78 * r, x + 0.16 * r, y - 0.6 * r);
      ctx.quadraticCurveTo(x + 0.6 * r, y - 0.72 * r, x + 0.62 * r, y - 0.1 * r);
      ctx.quadraticCurveTo(x + 0.96 * r, y - 0.04 * r, x + 0.84 * r, y + 0.42 * r);
      ctx.closePath();
      ctx.fill();
      return;
    }
    case "bee": {
      // Wings behind, then a round body with two bands.
      const x = X(m.x);
      const y = Y(m.y);
      const r = m.r * u;
      ctx.globalAlpha = 0.6;
      ctx.fillStyle = p[m.band];
      ctx.beginPath();
      ctx.ellipse(x - 0.18 * r, y - 0.44 * r, r * 0.3, r * 0.16, -0.55, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(x + 0.2 * r, y - 0.42 * r, r * 0.26, r * 0.14, 0.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.fillStyle = p[m.fill];
      ctx.beginPath();
      ctx.ellipse(x - 0.06 * r, y + 0.14 * r, r * 0.56, r * 0.42, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = p[m.band];
      ctx.beginPath();
      ctx.ellipse(x + 0.58 * r, y + 0.06 * r, r * 0.24, r * 0.24, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(x - 0.26 * r, y + 0.14 * r, r * 0.08, r * 0.33, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(x + 0.06 * r, y + 0.14 * r, r * 0.08, r * 0.3, 0, 0, Math.PI * 2);
      ctx.fill();
      return;
    }
  }
}

// ---------- pattern tiles, generated once and cached ----------

export interface TileCanvas {
  canvas: CanvasImageSource;
  ctx: Ctx;
}

/** A canvas maker: a real one in the browser, a recorder in tests. */
export type MakeCanvas = (w: number, h: number) => TileCanvas;

export const browserCanvas: MakeCanvas = (w, h) => {
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  return { canvas, ctx: canvas.getContext("2d") as CanvasRenderingContext2D };
};

/**
 * Pattern tiles keyed by pattern, palette, and size. Each tile is drawn once into a small canvas
 * and turned into a CanvasPattern, so filling clothes every frame costs a single fill.
 */
export class PatternCache {
  private readonly tiles = new Map<string, CanvasPattern | null>();
  constructor(
    private readonly make: MakeCanvas = browserCanvas,
    private readonly limit = 200,
  ) {}

  get size() {
    return this.tiles.size;
  }

  /** A repeating pattern, or null for plain. `px` is the tile size in device pixels. */
  named(
    target: Pick<CanvasRenderingContext2D, "createPattern">,
    pattern: Pattern,
    palette: ThemePalette,
    px: number,
  ): CanvasPattern | null {
    const motifs = patternMotifs(pattern);
    if (motifs.length === 0) return null;
    const size = Math.max(4, Math.round(px));
    const key = `${pattern}|${palette.main}|${palette.accent}|${palette.deep}|${palette.light}|${size}`;
    const hit = this.tiles.get(key);
    if (hit !== undefined) return hit;
    const { canvas, ctx } = this.make(size, size);
    for (const m of motifs) paintMotif(ctx, m, palette, 0, 0, size);
    return this.remember(key, target.createPattern(canvas, "repeat"));
  }

  /** A repeating pattern from an uploaded image, cropped square to `px`. Null until it loads. */
  image(
    target: Pick<CanvasRenderingContext2D, "createPattern">,
    mediaId: string,
    img: HTMLImageElement,
    px: number,
  ): CanvasPattern | null {
    const size = Math.max(4, Math.round(px));
    const key = `img|${mediaId}|${size}`;
    const hit = this.tiles.get(key);
    if (hit !== undefined) return hit;
    const { canvas, ctx } = this.make(size, size);
    const side = Math.min(img.naturalWidth, img.naturalHeight);
    (ctx as unknown as CanvasRenderingContext2D).drawImage(
      img,
      (img.naturalWidth - side) / 2,
      (img.naturalHeight - side) / 2,
      side,
      side,
      0,
      0,
      size,
      size,
    );
    return this.remember(key, target.createPattern(canvas, "repeat"));
  }

  private remember(key: string, pattern: CanvasPattern | null) {
    if (this.tiles.size >= this.limit) this.tiles.clear();
    this.tiles.set(key, pattern);
    return pattern;
  }
}

// ---------- uploaded images (custom patterns, home pictures) ----------

const images = new Map<string, { img: HTMLImageElement; ready: boolean; failed: boolean }>();
const waiting = new Set<() => void>();

/** Hear when any uploaded look image finishes loading, so drawings that used a fallback redraw. */
export function onLookImage(fn: () => void): () => void {
  waiting.add(fn);
  return () => waiting.delete(fn);
}

/** The media URL for an upload id, only when it is exactly one of ours. */
export function mediaUrlOf(id: string | undefined): string | undefined {
  if (!id) return undefined;
  const url = `/media/${id}`;
  return isMediaUrl(url) ? url : undefined;
}

/**
 * An uploaded image by media id, loaded once. Returns it when ready, else undefined (and starts
 * loading). Only our own `/media/m_...` URLs are ever fetched.
 */
export function lookImage(id: string | undefined): HTMLImageElement | undefined {
  const url = mediaUrlOf(id);
  if (!url || !id) return undefined;
  let entry = images.get(id);
  if (!entry) {
    const img = new Image();
    img.decoding = "async";
    const fresh = { img, ready: false, failed: false };
    entry = fresh;
    images.set(id, fresh);
    img.addEventListener("load", () => {
      fresh.ready = img.naturalWidth > 0;
      for (const fn of waiting) fn();
    });
    img.addEventListener("error", () => {
      fresh.failed = true;
    });
    img.src = url;
  }
  return entry.ready ? entry.img : undefined;
}

// ---------- garments in words ----------

/** Resident colors in plain words, for "Citrus dress in sun yellow". */
export const COLOR_WORDS: Record<ResidentColor, string> = {
  sun: "sun yellow",
  sky: "sky blue",
  leaf: "leaf green",
  rose: "rose pink",
  plum: "plum purple",
  sand: "sand",
  coal: "coal black",
  snow: "snow white",
};

/** A pattern as a word before a garment: a citrus dress, striped socks. */
const PATTERN_WORDS: Record<GarmentPattern, string> = {
  plain: "plain",
  dots: "dotted",
  stripes: "striped",
  gingham: "gingham",
  florals: "floral",
  citrus: "citrus",
  stars: "starry",
  waves: "wavy",
  hearts: "heart print",
  leaves: "leafy",
  lemons: "lemon print",
  cherries: "cherry print",
  mushrooms: "mushroom print",
  cats: "cat print",
  fish: "fish print",
  moons: "moon print",
  clouds: "cloud print",
  bees: "bee print",
  own: "own pattern",
};

/**
 * A garment in plain words, from our catalogs only: "Citrus dress in sun yellow", "Striped
 * socks", "Beret in plum purple", or just "Dress" with no style.
 */
export function garmentName(
  item: WearItem,
  style?: { pattern?: GarmentPattern | undefined; color?: ResidentColor | undefined },
): string {
  const noun = WEAR_INFO[item]?.label ?? item;
  const pattern =
    style?.pattern && style.pattern !== "plain" ? PATTERN_WORDS[style.pattern] : undefined;
  const color = style?.color ? COLOR_WORDS[style.color] : undefined;
  const name = pattern ? `${pattern} ${noun.toLowerCase()}` : noun;
  const out = color ? `${name} in ${color}` : name;
  return out.charAt(0).toUpperCase() + out.slice(1);
}

/** Hair styles that read as a kind of hair rather than a thing: "short hair", "curly hair". */
const HAIR_NOUNS: Partial<Record<HairStyle, string>> = {
  short: "short hair",
  long: "long hair",
  curly: "curly hair",
  spiky: "spiky hair",
};

/**
 * Hair in plain words, from our catalogs only: "Auburn bob", "Black curly hair". Brown when no
 * color was picked, as it's drawn. Undefined for a style this client doesn't know.
 */
export function hairName(style: HairStyle, color?: HairColor): string | undefined {
  if (!Object.hasOwn(HAIR_LABELS, style)) return undefined;
  const shade = color && Object.hasOwn(HAIR_COLOR_INFO, color) ? color : DEFAULT_HAIR_COLOR;
  const noun = HAIR_NOUNS[style] ?? HAIR_LABELS[style].toLowerCase();
  return `${HAIR_COLOR_INFO[shade].label} ${noun}`;
}

/** A look's hair: its style and the color to draw it in, or undefined for none. Pure. */
export function hairOf(
  look: Pick<FigureLook, "hair" | "hairColor">,
): { style: HairStyle; hex: string } | undefined {
  const style = look.hair;
  // A style this client doesn't know draws no hair, like none.
  if (!style || !Object.hasOwn(HAIR_LABELS, style)) return undefined;
  const color =
    look.hairColor && Object.hasOwn(HAIR_COLOR_INFO, look.hairColor)
      ? look.hairColor
      : DEFAULT_HAIR_COLOR;
  return { style, hex: HAIR_COLOR_INFO[color].hex };
}

/** True when a look has anything to draw beyond the plain color token. */
export function hasLook(look: Partial<FigureLook> | undefined): boolean {
  return Boolean(
    look?.theme || look?.pattern || look?.wear?.length || look?.patternMedia || hairOf(look ?? {}),
  );
}
