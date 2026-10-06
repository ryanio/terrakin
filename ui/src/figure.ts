/**
 * A resident drawn as a small, soft figure: a round head in their color, a body in their theme's
 * clothes and pattern, and one thing to wear in each slot (hat, top, accessory, bottom, feet). Each
 * garment can have its own color and pattern (`wearStyle`), painted the same way the clothes are.
 * Drawn with plain canvas shapes, once per look into a cached sprite (see render.ts), so the world
 * stays cheap at 60fps on a phone.
 */
import {
  BLOCK_COLORS,
  type Direction,
  type GarmentPattern,
  PATTERNS,
  type Pattern,
  type ResidentColor,
  type ResidentShape,
  THEME_INFO,
  type Theme,
  type ThemePalette,
  WEAR_INFO,
  type WearItem,
  type WearSlot,
} from "@terrakin/sim";
import { BRAND_HEX, WOOD_DARK } from "./brand";
import { lookImage, lookPalette, mix, PatternCache, RESIDENT_COLOR_HEX } from "./looks";

/** A color and pattern per garment, as the sim keeps them or as the wire carries them. */
export type GarmentStyles = Partial<
  Record<
    WearItem,
    { pattern?: GarmentPattern | undefined; color?: ResidentColor | undefined } | undefined
  >
>;

export interface FigureLook {
  color: ResidentColor;
  shape: ResidentShape;
  theme?: Theme | undefined;
  wear?: readonly WearItem[] | undefined;
  /** The outfit's pattern. A garment in your own pattern shows it until your tile loads. */
  pattern?: Pattern | undefined;
  /** Your own pattern tile (a media id), for garments styled `own`. */
  patternMedia?: string | undefined;
  /** A color and pattern per garment. A garment without one looks as it always has. */
  wearStyle?: GarmentStyles | undefined;
}

/** Everything a figure picture needs, including the pattern. */
export type FullLook = FigureLook;

const pagePatterns = new PatternCache();

/** True when a look has anything to draw beyond the plain color token. */
export function hasLook(look: Partial<FullLook> | undefined): boolean {
  return Boolean(look?.theme || look?.pattern || look?.wear?.length || look?.patternMedia);
}

/**
 * Paint a figure into a canvas element for the page (avatars, the profile, the look editor).
 * `crop: "bust"` frames the head and shoulders for a round avatar; `"full"` shows the whole figure
 * standing on a little patch of ground.
 */
export function paintFigure(
  canvas: HTMLCanvasElement,
  look: FullLook,
  cssSize: number,
  crop: "bust" | "full",
) {
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  const px = Math.round(cssSize * dpr);
  if (canvas.width !== px) canvas.width = px;
  if (canvas.height !== px) canvas.height = px;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, px, px);
  const p = lookPalette(look.theme, look.color);
  const u = crop === "bust" ? px * 0.92 : px * 0.78;
  const feet = crop === "bust" ? px * 1.02 : px * 0.9;
  if (crop === "full") {
    ctx.fillStyle = mix(p.ground, BRAND_HEX.paper, 0.35);
    ctx.beginPath();
    ctx.ellipse(px / 2, feet, px * 0.36, px * 0.09, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "rgba(60, 40, 20, 0.2)";
    ctx.beginPath();
    ctx.ellipse(px / 2, feet, u * 0.27, u * 0.08, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  const img = lookImage(look.patternMedia);
  const pattern =
    img && look.patternMedia
      ? pagePatterns.image(ctx, look.patternMedia, img, u * 0.42)
      : pagePatterns.named(ctx, look.pattern ?? "plain", p, u * 0.36);
  ctx.translate(px / 2, feet);
  drawFigure(ctx, u, look, pattern);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
}

/** The figure's box around its feet, in tile units: how big a sprite must be. */
export const FIGURE_BOX = { left: -0.5, right: 0.5, top: -1.06, bottom: 0.12 };

const INK = BRAND_HEX.ink;
const PAPER = BRAND_HEX.paper;
const RIM = "#ffffff";
const STRAW = "#e8c878";
const STRAW_DEEP = "#c49a4c";
const WICKER = "#c9925a";
const LEATHER = "#9c6a3e";
const SLICKER = "#f4c534";
const SLICKER_DEEP = "#d9a21c";
/** The umbrella's color when the theme's accent is too pale to read. */
const CANOPY = "#e0604a";
/** Sneakers are white canvas. */
const CANVAS = "#fdfbf6";
/** The Muse halo: soft lilac plush, trimmed in plum, with gold studs. */
const HALO = BRAND_HEX.dusk;
const HALO_TRIM = RESIDENT_COLOR_HEX.plum;
const GOLD = BRAND_HEX.sun;
/** The Muse lantern's paper, the same warm glow as the lanterns in the world. */
const LANTERN = BLOCK_COLORS.lantern;

/** A theme accent too pale to show on paper. */
const paleAccent = (p: ThemePalette) => p.accent === "#ffffff" || p.accent === PAPER;

/**
 * Each garment's main color when it has no color of its own, from the outfit's palette. The 2D
 * figure paints with it and the 3D figures (`client/src/scene3d/wear.ts`) read it, so a garment is
 * the same color in both.
 */
export const GARMENT_COLOR: Record<WearItem, (p: ThemePalette) => string> = {
  straw_hat: () => STRAW,
  beret: (p) => p.deep,
  flower_crown: (p) => (p.accent === "#ffffff" ? p.light : p.accent),
  beanie: (p) => (p.accent === "#ffffff" ? p.main : p.accent),
  top_hat: () => INK,
  apron: (p) => p.light,
  scarf: (p) => (paleAccent(p) ? p.deep : p.accent),
  cardigan: (p) => p.deep,
  overalls: (p) => p.deep,
  raincoat: () => SLICKER,
  dress: (p) => p.main,
  skirt: (p) => p.deep,
  trousers: (p) => p.deep,
  shorts: (p) => p.deep,
  socks: (p) => (paleAccent(p) ? p.deep : p.accent),
  boots: () => LEATHER,
  sneakers: () => CANVAS,
  basket: () => WICKER,
  satchel: () => LEATHER,
  glasses: () => INK,
  bow: (p) => (p.accent === "#ffffff" ? p.deep : p.accent),
  umbrella: (p) => (paleAccent(p) ? CANOPY : p.accent),
  muse_halo: () => HALO,
  muse_lantern: () => LANTERN,
};

/** A worn garment's main color: its own, else its usual one in the outfit's palette. Pure. */
export function garmentColor(
  look: Pick<FigureLook, "color" | "theme" | "pattern" | "patternMedia" | "wearStyle">,
  item: WearItem,
): string {
  return garmentLook(look, item).color ?? GARMENT_COLOR[item](lookPalette(look.theme, look.color));
}

// ---------- garment styles ----------

const isPattern = (value: unknown): value is Pattern =>
  typeof value === "string" && (PATTERNS as readonly string[]).includes(value);

/** How one garment is painted, worked out from the look and that garment's style. */
export interface GarmentLook {
  /** Its own base color as hex, or undefined to keep the garment's usual color. */
  color: string | undefined;
  /**
   * Its motif: a named pattern (`plain` for none), or undefined to keep the garment's usual look.
   * For a garment in your own pattern, this is what shows until the tile loads.
   */
  pattern: Pattern | undefined;
  /** True to fill it with the resident's own uploaded tile (`patternMedia`). */
  own: boolean;
  /** The colors its motif is drawn in: from its own color when it has one, else the outfit's. */
  palette: ThemePalette;
}

/**
 * Resolve a garment's color and pattern. Pure. A garment with no style keeps its usual look; a
 * color the client doesn't know is ignored; `own` without an uploaded tile falls back to the
 * outfit's pattern, then the theme's motif.
 */
export function garmentLook(
  look: Pick<FigureLook, "color" | "theme" | "pattern" | "patternMedia" | "wearStyle">,
  item: WearItem,
): GarmentLook {
  const style = look.wearStyle?.[item];
  const color =
    style?.color && Object.hasOwn(RESIDENT_COLOR_HEX, style.color) ? style.color : undefined;
  const palette = color ? lookPalette(undefined, color) : lookPalette(look.theme, look.color);
  let pattern: Pattern | undefined;
  if (style?.pattern === "own") {
    const motif =
      look.theme && Object.hasOwn(THEME_INFO, look.theme)
        ? THEME_INFO[look.theme].motif
        : undefined;
    pattern = look.pattern ?? motif ?? "plain";
  } else if (isPattern(style?.pattern)) {
    pattern = style.pattern;
  }
  return {
    color: color ? RESIDENT_COLOR_HEX[color] : undefined,
    pattern,
    own: style?.pattern === "own" && Boolean(look.patternMedia),
    palette,
  };
}

/** A garment's pattern tile, as a share of a tile: smaller pieces get a finer motif. */
const GARMENT_TILE: Record<WearSlot, number> = {
  hat: 0.2,
  top: 0.3,
  accessory: 0.2,
  bottom: 0.24,
  feet: 0.1,
};

/** A garment ready to paint. Each method takes what an unstyled one uses. */
interface Garb {
  /** Its own color, else `usual`. */
  color(usual: string): string;
  /** A darker shade of its own color for trim and stitching, else `usual`. */
  trim(usual: string): string;
  /** The motif to clip into it, else `usual` (none unless given). */
  fill(usual?: CanvasPattern | null): CanvasPattern | null;
  /** Its own color, when it has one. */
  own: string | undefined;
}

/** The garb for one worn item, with its pattern tile made through `patterns`. */
function garbFor(
  ctx: CanvasRenderingContext2D,
  u: number,
  look: FigureLook,
  item: WearItem,
  patterns: PatternCache,
): Garb {
  const g = garmentLook(look, item);
  const tile = GARMENT_TILE[WEAR_INFO[item]?.slot ?? "top"] * u;
  let motif: CanvasPattern | null | undefined;
  if (g.own && look.patternMedia) {
    const img = lookImage(look.patternMedia);
    if (img) motif = patterns.image(ctx, look.patternMedia, img, tile * 1.17);
  }
  if (motif === undefined && g.pattern) motif = patterns.named(ctx, g.pattern, g.palette, tile);
  return {
    color: (usual) => g.color ?? usual,
    trim: (usual) => (g.color ? mix(g.color, INK, 0.3) : usual),
    fill: (usual = null) => (motif === undefined ? usual : motif),
    own: g.color,
  };
}

/**
 * Fill a shape in a color, then clip a motif into it. The clothes and every garment are painted
 * this way, so a pattern sits on a dress or a sock exactly as it sits on the clothes.
 */
function paintCloth(
  ctx: CanvasRenderingContext2D,
  u: number,
  shape: () => void,
  color: string,
  motif: CanvasPattern | null,
) {
  shape();
  ctx.fillStyle = color;
  ctx.fill();
  if (!motif) return;
  ctx.save();
  shape();
  ctx.clip();
  ctx.fillStyle = motif;
  ctx.fillRect(-0.6 * u, -1.1 * u, 1.2 * u, 1.25 * u);
  ctx.restore();
}

/** Body outline for each shape: a bean, a soft block, or an A-line smock. Origin at the feet. */
function bodyPath(ctx: CanvasRenderingContext2D, shape: ResidentShape, u: number) {
  ctx.beginPath();
  if (shape === "square") {
    ctx.roundRect(-0.27 * u, -0.5 * u, 0.54 * u, 0.47 * u, 0.12 * u);
  } else if (shape === "diamond") {
    ctx.moveTo(-0.13 * u, -0.5 * u);
    ctx.lineTo(0.13 * u, -0.5 * u);
    ctx.quadraticCurveTo(0.2 * u, -0.48 * u, 0.22 * u, -0.4 * u);
    ctx.lineTo(0.31 * u, -0.1 * u);
    ctx.quadraticCurveTo(0.33 * u, -0.03 * u, 0.25 * u, -0.03 * u);
    ctx.lineTo(-0.25 * u, -0.03 * u);
    ctx.quadraticCurveTo(-0.33 * u, -0.03 * u, -0.31 * u, -0.1 * u);
    ctx.lineTo(-0.22 * u, -0.4 * u);
    ctx.quadraticCurveTo(-0.2 * u, -0.48 * u, -0.13 * u, -0.5 * u);
    ctx.closePath();
  } else {
    ctx.ellipse(0, -0.27 * u, 0.28 * u, 0.25 * u, 0, 0, Math.PI * 2);
  }
}

const HEAD_Y = -0.66;
const HEAD_R = 0.21;
/** In profile, where the eye sits and the nose that pokes past the head, as a multiple of `side`. */
const PROFILE_EYE = 0.1;
const NOSE = { x: 0.2, y: -0.62, r: 0.045 };

/** The head, plus the nose in profile so the outline points the way they face. */
function headPath(ctx: CanvasRenderingContext2D, u: number, side: number) {
  ctx.beginPath();
  ctx.arc(0, HEAD_Y * u, HEAD_R * u, 0, Math.PI * 2);
  if (side) {
    ctx.moveTo((NOSE.x * side + NOSE.r) * u, NOSE.y * u);
    ctx.arc(NOSE.x * side * u, NOSE.y * u, NOSE.r * u, 0, Math.PI * 2);
  }
}

/** Where the two feet sit, in tiles from the middle, for the way the figure faces. */
const feetAt = (side: number): [number, number] =>
  side ? [-0.03 * side, 0.1 * side] : [-0.1, 0.1];

/**
 * Draw a figure with its feet at (0, 0) of the current transform. `u` is one tile in pixels.
 * `pattern` fills the clothes over the main color (null for plain). `facing` is the way they look:
 * south (the default) shows the face, north their back, east and west a profile with one eye and
 * a nose pointing that way.
 * `patterns` makes the tiles for garments with a pattern of their own.
 */
export function drawFigure(
  ctx: CanvasRenderingContext2D,
  u: number,
  look: FigureLook,
  pattern: CanvasPattern | null,
  facing: Direction = "s",
  patterns: PatternCache = pagePatterns,
) {
  const p = lookPalette(look.theme, look.color);
  const head = RESIDENT_COLOR_HEX[look.color] ?? RESIDENT_COLOR_HEX.sun;
  const wear = new Set(look.wear ?? []);
  const garb = (item: WearItem) => garbFor(ctx, u, look, item, patterns);
  const rim = Math.max(1.5, u * 0.06);
  const back = facing === "n";
  // Turned sideways, front details slide toward the way they face.
  const side = facing === "e" ? 1 : facing === "w" ? -1 : 0;
  // Which side things carried in the right hand show on.
  const hand = side || (back ? -1 : 1);
  const feet = feetAt(side);
  const flared = wear.has("dress") || wear.has("skirt");
  const shoes = wear.has("socks") || wear.has("boots") || wear.has("sneakers");

  // White rim behind everything, so the figure reads on any ground.
  ctx.lineJoin = "round";
  ctx.strokeStyle = RIM;
  ctx.lineWidth = rim * 2;
  bodyPath(ctx, look.shape, u);
  ctx.stroke();
  headPath(ctx, u, back ? 0 : side);
  ctx.stroke();
  if (flared) {
    flarePath(ctx, u);
    ctx.stroke();
  }

  // A skirt's flare sits behind the body, so a coat over it leaves only the hem showing.
  if (wear.has("dress")) drawFlare(ctx, u, garb("dress"), GARMENT_COLOR.dress(p), pattern);
  else if (wear.has("skirt")) drawFlare(ctx, u, garb("skirt"), GARMENT_COLOR.skirt(p), null);

  // Feet.
  if (!shoes) {
    ctx.fillStyle = p.deep;
    ctx.beginPath();
    const [footA, footB] = feet;
    ctx.ellipse(footA * u, -0.02 * u, 0.075 * u, 0.045 * u, 0, 0, Math.PI * 2);
    ctx.ellipse(footB * u, -0.02 * u, 0.075 * u, 0.045 * u, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  // Clothes: main color, then the pattern, clipped to the body.
  paintCloth(ctx, u, () => bodyPath(ctx, look.shape, u), p.main, pattern);
  ctx.save();
  bodyPath(ctx, look.shape, u);
  ctx.clip();
  drawBottom(ctx, u, wear, p, garb, side);
  drawTop(ctx, u, wear, p, back, side, garb, look.shape, pattern);
  // Soft shade at the hem so the body feels round.
  ctx.fillStyle = "rgba(70, 40, 18, 0.14)";
  ctx.fillRect(-0.5 * u, -0.12 * u, u, 0.12 * u);
  ctx.restore();

  // Legs and feet in front of the hem: socks go under trousers, boots and sneakers over them.
  if (wear.has("socks")) drawSocks(ctx, u, feet, side, p, garb("socks"));
  if (wear.has("trousers")) drawTrouserLegs(ctx, u, feet, p, garb("trousers"));
  else if (wear.has("shorts")) drawShortsCuffs(ctx, u, p, garb("shorts"));
  if (wear.has("boots")) drawBoots(ctx, u, feet, side, garb("boots"));
  else if (wear.has("sneakers")) drawSneakers(ctx, u, feet, side, p, garb("sneakers"));

  // Little arms. Sideways, the near arm hangs over the body and the far one is hidden.
  ctx.fillStyle = mix(p.main, p.deep, 0.18);
  ctx.beginPath();
  if (side) {
    ctx.ellipse(-0.03 * side * u, -0.29 * u, 0.065 * u, 0.11 * u, 0.25 * side, 0, Math.PI * 2);
  } else {
    ctx.ellipse(-0.27 * u, -0.3 * u, 0.06 * u, 0.1 * u, 0.35, 0, Math.PI * 2);
    ctx.ellipse(0.27 * u, -0.3 * u, 0.06 * u, 0.1 * u, -0.35, 0, Math.PI * 2);
  }
  ctx.fill();

  if (wear.has("satchel")) drawSatchel(ctx, u, hand, garb("satchel"));

  // Head and face.
  ctx.fillStyle = head;
  headPath(ctx, u, back ? 0 : side);
  ctx.fill();
  ctx.fillStyle = "rgba(255, 255, 255, 0.35)";
  ctx.beginPath();
  ctx.ellipse(-0.08 * u, -0.74 * u, 0.06 * u, 0.035 * u, -0.6, 0, Math.PI * 2);
  ctx.fill();
  if (!back) {
    const eye = look.color === "coal" ? BRAND_HEX.paper : INK;
    drawFace(ctx, u, eye, side);
    if (wear.has("glasses")) drawGlasses(ctx, u, side, garb("glasses"));
  }

  drawHat(ctx, u, wear, p, garb);

  if (wear.has("bow")) drawBow(ctx, u, side, back, p, garb("bow"));
  if (wear.has("basket")) drawBasket(ctx, u, hand, p, garb("basket"));
  if (wear.has("umbrella")) drawUmbrella(ctx, u, p, hand, garb("umbrella"));
  if (wear.has("muse_lantern")) drawMuseLantern(ctx, u, hand, p, garb("muse_lantern"));
}

/** Eyes and cheeks, slid `turn` tiles sideways when the figure faces east or west. */
/** Two eyes and two cheeks from the front; in profile (`side` 1 east, -1 west) one of each. */
function drawFace(ctx: CanvasRenderingContext2D, u: number, eye: string, side: number) {
  const eyes = side ? [PROFILE_EYE * side] : [-0.075, 0.075];
  const cheeks = side ? [0.03 * side] : [-0.13, 0.13];
  ctx.fillStyle = eye;
  ctx.beginPath();
  for (const x of eyes) {
    ctx.moveTo((x + 0.026) * u, -0.64 * u);
    ctx.ellipse(x * u, -0.64 * u, 0.026 * u, (side ? 0.032 : 0.026) * u, 0, 0, Math.PI * 2);
  }
  ctx.fill();
  ctx.fillStyle = "rgba(234, 110, 120, 0.4)";
  ctx.beginPath();
  for (const x of cheeks) {
    ctx.moveTo((x + 0.04) * u, -0.585 * u);
    ctx.ellipse(x * u, -0.585 * u, 0.04 * u, 0.025 * u, 0, 0, Math.PI * 2);
  }
  ctx.fill();
}

// ---------- hats ----------
// Each garment is a path builder plus a function that paints it, so its color and pattern go
// into its own shape through `paintCloth`.

function drawHat(
  ctx: CanvasRenderingContext2D,
  u: number,
  wear: Set<WearItem>,
  p: ThemePalette,
  garb: (item: WearItem) => Garb,
) {
  if (wear.has("straw_hat")) drawStrawHat(ctx, u, p, garb("straw_hat"));
  else if (wear.has("beret")) drawBeret(ctx, u, p, garb("beret"));
  else if (wear.has("beanie")) drawBeanie(ctx, u, p, garb("beanie"));
  else if (wear.has("top_hat")) drawTopHat(ctx, u, p, garb("top_hat"));
  else if (wear.has("flower_crown")) drawFlowerCrown(ctx, u, p, garb("flower_crown"));
  else if (wear.has("muse_halo")) drawMuseHalo(ctx, u, p, garb("muse_halo"));
}

const HAT_TOP = HEAD_Y - HEAD_R;

function strawBrimPath(ctx: CanvasRenderingContext2D, u: number) {
  ctx.beginPath();
  ctx.ellipse(0, HAT_TOP * u + 0.1 * u, 0.33 * u, 0.075 * u, 0, 0, Math.PI * 2);
}

function strawCrownPath(ctx: CanvasRenderingContext2D, u: number) {
  const top = HAT_TOP * u;
  ctx.beginPath();
  ctx.roundRect(-0.15 * u, top - 0.06 * u, 0.3 * u, 0.16 * u, [0.07 * u, 0.07 * u, 0, 0]);
}

/** A wide straw brim and crown with a band in the theme's accent. */
function drawStrawHat(ctx: CanvasRenderingContext2D, u: number, p: ThemePalette, g: Garb) {
  const top = HAT_TOP * u;
  const straw = g.color(GARMENT_COLOR.straw_hat(p));
  ctx.strokeStyle = g.trim(STRAW_DEEP);
  ctx.lineWidth = Math.max(0.8, 0.015 * u);
  for (const shape of [strawBrimPath, strawCrownPath]) {
    paintCloth(ctx, u, () => shape(ctx, u), straw, g.fill());
    shape(ctx, u);
    ctx.stroke();
  }
  ctx.fillStyle = p.accent === "#ffffff" ? p.deep : p.accent;
  ctx.fillRect(-0.15 * u, top + 0.04 * u, 0.3 * u, 0.04 * u);
}

function beretPath(ctx: CanvasRenderingContext2D, u: number) {
  const top = HAT_TOP * u;
  ctx.beginPath();
  ctx.ellipse(0.03 * u, top + 0.05 * u, 0.22 * u, 0.09 * u, -0.18, 0, Math.PI * 2);
  ctx.moveTo(0.075 * u, top - 0.04 * u);
  ctx.arc(0.05 * u, top - 0.04 * u, 0.025 * u, 0, Math.PI * 2);
}

/** A soft beret tipped to one side, in the theme's deep color. */
function drawBeret(ctx: CanvasRenderingContext2D, u: number, p: ThemePalette, g: Garb) {
  paintCloth(ctx, u, () => beretPath(ctx, u), g.color(GARMENT_COLOR.beret(p)), g.fill());
}

function beaniePath(ctx: CanvasRenderingContext2D, u: number) {
  ctx.beginPath();
  ctx.arc(0, HEAD_Y * u - 0.02 * u, HEAD_R * u * 1.04, Math.PI, 0);
}

/** A knit beanie with a turned-up cuff and a pompom. */
function drawBeanie(ctx: CanvasRenderingContext2D, u: number, p: ThemePalette, g: Garb) {
  const knit = g.color(GARMENT_COLOR.beanie(p));
  paintCloth(ctx, u, () => beaniePath(ctx, u), knit, g.fill());
  ctx.fillStyle = mix(knit, "#000000", 0.18);
  ctx.beginPath();
  ctx.roundRect(-0.23 * u, HEAD_Y * u - 0.06 * u, 0.46 * u, 0.07 * u, 0.03 * u);
  ctx.fill();
  ctx.fillStyle = p.light;
  ctx.beginPath();
  ctx.arc(0, HAT_TOP * u - 0.04 * u, 0.055 * u, 0, Math.PI * 2);
  ctx.fill();
}

/** One flower of the crown, as a path. */
function petalPath(ctx: CanvasRenderingContext2D, u: number, x: number, y: number) {
  ctx.beginPath();
  ctx.arc(x, y, 0.045 * u, 0, Math.PI * 2);
}

/** Five flowers round the head. Styled, the flowers take its color in two shades. */
function drawFlowerCrown(ctx: CanvasRenderingContext2D, u: number, p: ThemePalette, g: Garb) {
  for (let i = 0; i < 5; i++) {
    const a = Math.PI + 0.35 + (i * (Math.PI - 0.7)) / 4;
    const x = Math.cos(a) * HEAD_R * 0.95 * u;
    const y = HEAD_Y * u + Math.sin(a) * HEAD_R * 0.95 * u;
    ctx.fillStyle = "#7fa94c";
    ctx.beginPath();
    ctx.ellipse(x + 0.035 * u, y + 0.01 * u, 0.03 * u, 0.015 * u, 0.5, 0, Math.PI * 2);
    ctx.fill();
    const usual = i % 2 === 0 ? GARMENT_COLOR.flower_crown(p) : p.light;
    const petal = g.own ? (i % 2 === 0 ? g.own : mix(g.own, PAPER, 0.45)) : usual;
    paintCloth(ctx, u, () => petalPath(ctx, u, x, y), petal, g.fill());
    ctx.fillStyle = p.deep;
    ctx.beginPath();
    ctx.arc(x, y, 0.016 * u, 0, Math.PI * 2);
    ctx.fill();
  }
}

/** Where the halo's ring floats: just clear of the top of the head. */
const HALO_Y = HAT_TOP - 0.07;

/** The halo's plush ring, seen from a little above: an oval band around an oval hole. */
function haloPath(ctx: CanvasRenderingContext2D, u: number) {
  const y = HALO_Y * u;
  ctx.beginPath();
  ctx.ellipse(0, y, 0.19 * u, 0.07 * u, 0, 0, Math.PI * 2);
  ctx.moveTo(0.115 * u, y);
  ctx.ellipse(0, y, 0.115 * u, 0.024 * u, 0, 0, Math.PI * 2, true);
}

/** A four-pointed sparkle at (x, y), `r` from its middle to each point. */
function sparklePath(ctx: CanvasRenderingContext2D, x: number, y: number, r: number) {
  ctx.moveTo(x, y - r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.quadraticCurveTo(x, y, x, y + r);
  ctx.quadraticCurveTo(x, y, x - r, y);
  ctx.quadraticCurveTo(x, y, x, y - r);
  ctx.closePath();
}

/**
 * The Muse halo: a soft lilac ring floating over the head in a faint glow, with a shine along its
 * back and three gold sparkles studded along its front.
 */
function drawMuseHalo(ctx: CanvasRenderingContext2D, u: number, p: ThemePalette, g: Garb) {
  const y = HALO_Y * u;
  const color = g.color(GARMENT_COLOR.muse_halo(p));
  ctx.save();
  ctx.globalAlpha = 0.3;
  ctx.fillStyle = mix(color, PAPER, 0.5);
  ctx.beginPath();
  ctx.ellipse(0, y, 0.23 * u, 0.095 * u, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  paintCloth(ctx, u, () => haloPath(ctx, u), color, g.fill());
  ctx.strokeStyle = g.trim(HALO_TRIM);
  ctx.lineWidth = Math.max(0.8, 0.015 * u);
  haloPath(ctx, u);
  ctx.stroke();
  ctx.strokeStyle = "rgba(255, 255, 255, 0.6)";
  ctx.lineCap = "round";
  ctx.lineWidth = Math.max(0.8, 0.018 * u);
  ctx.beginPath();
  ctx.ellipse(0, y, 0.152 * u, 0.05 * u, 0, Math.PI * 1.15, Math.PI * 1.55);
  ctx.stroke();
  ctx.fillStyle = GOLD;
  ctx.strokeStyle = mix(GOLD, INK, 0.35);
  ctx.lineWidth = Math.max(0.6, 0.008 * u);
  ctx.beginPath();
  for (const a of [0.2, 0.5, 0.8]) {
    const r = (a === 0.5 ? 0.042 : 0.032) * u;
    sparklePath(ctx, Math.cos(a * Math.PI) * 0.152 * u, y + Math.sin(a * Math.PI) * 0.047 * u, r);
  }
  ctx.fill();
  ctx.stroke();
}

// ---------- tops ----------

/**
 * Tops draw inside the body clip. From behind, only what wraps around shows (cardigan panels,
 * overall legs, the scarf's band); sideways, the front pieces slide toward the way they face.
 */
function drawTop(
  ctx: CanvasRenderingContext2D,
  u: number,
  wear: Set<WearItem>,
  p: ThemePalette,
  back: boolean,
  side: number,
  garb: (item: WearItem) => Garb,
  shape: ResidentShape,
  outfit: CanvasPattern | null,
) {
  const t = side * 0.1 * u;
  if (wear.has("dress")) drawDressBodice(ctx, u, shape, p, garb("dress"), outfit);
  if (wear.has("apron") && !back) drawApron(ctx, u, t, p, garb("apron"));
  if (wear.has("cardigan")) drawCardigan(ctx, u, t, back, p, garb("cardigan"));
  if (wear.has("overalls")) drawOveralls(ctx, u, t, back, p, garb("overalls"));
  if (wear.has("scarf")) drawScarf(ctx, u, t, back, p, garb("scarf"));
  if (wear.has("raincoat")) drawRaincoat(ctx, u, shape, back, side, garb("raincoat"));
}

function apronPath(ctx: CanvasRenderingContext2D, u: number, t: number) {
  ctx.beginPath();
  ctx.roundRect(t - 0.15 * u, -0.42 * u, 0.3 * u, 0.4 * u, 0.06 * u);
}

function drawApron(ctx: CanvasRenderingContext2D, u: number, t: number, p: ThemePalette, g: Garb) {
  paintCloth(ctx, u, () => apronPath(ctx, u, t), g.color(GARMENT_COLOR.apron(p)), g.fill());
  ctx.strokeStyle = g.trim(p.deep);
  ctx.lineWidth = Math.max(0.8, 0.018 * u);
  ctx.beginPath();
  ctx.roundRect(t - 0.07 * u, -0.22 * u, 0.14 * u, 0.08 * u, 0.02 * u);
  ctx.stroke();
}

function cardiganPath(ctx: CanvasRenderingContext2D, u: number, t: number, back: boolean) {
  ctx.beginPath();
  if (back) {
    ctx.rect(-0.4 * u, -0.6 * u, 0.8 * u, 0.6 * u);
  } else {
    ctx.rect(t - 0.4 * u, -0.6 * u, 0.27 * u, 0.6 * u);
    ctx.rect(t + 0.13 * u, -0.6 * u, 0.27 * u, 0.6 * u);
  }
}

function drawCardigan(
  ctx: CanvasRenderingContext2D,
  u: number,
  t: number,
  back: boolean,
  p: ThemePalette,
  g: Garb,
) {
  paintCloth(
    ctx,
    u,
    () => cardiganPath(ctx, u, t, back),
    g.color(GARMENT_COLOR.cardigan(p)),
    g.fill(),
  );
  if (back) return;
  ctx.fillStyle = p.light;
  for (const y of [-0.38, -0.26, -0.14]) {
    ctx.beginPath();
    ctx.arc(t + 0.1 * u, y * u, 0.022 * u, 0, Math.PI * 2);
    ctx.fill();
  }
}

/** The overalls' legs, and from the front their bib. */
function overallsPath(ctx: CanvasRenderingContext2D, u: number, t: number, back: boolean) {
  ctx.beginPath();
  ctx.rect(-0.4 * u, -0.22 * u, 0.8 * u, 0.22 * u);
  if (!back) ctx.roundRect(t - 0.12 * u, -0.38 * u, 0.24 * u, 0.18 * u, 0.03 * u);
}

function drawOveralls(
  ctx: CanvasRenderingContext2D,
  u: number,
  t: number,
  back: boolean,
  p: ThemePalette,
  g: Garb,
) {
  const denim = g.color(GARMENT_COLOR.overalls(p));
  paintCloth(ctx, u, () => overallsPath(ctx, u, t, back), denim, g.fill());
  ctx.strokeStyle = denim;
  ctx.lineWidth = 0.04 * u;
  ctx.beginPath();
  if (back) {
    // The straps cross between the shoulder blades.
    ctx.moveTo(-0.16 * u, -0.52 * u);
    ctx.lineTo(0.1 * u, -0.22 * u);
    ctx.moveTo(0.16 * u, -0.52 * u);
    ctx.lineTo(-0.1 * u, -0.22 * u);
    ctx.stroke();
    return;
  }
  ctx.moveTo(t - 0.1 * u, -0.37 * u);
  ctx.lineTo(t - 0.16 * u, -0.52 * u);
  ctx.moveTo(t + 0.1 * u, -0.37 * u);
  ctx.lineTo(t + 0.16 * u, -0.52 * u);
  ctx.stroke();
  ctx.fillStyle = p.light;
  ctx.beginPath();
  ctx.arc(t - 0.08 * u, -0.34 * u, 0.02 * u, 0, Math.PI * 2);
  ctx.arc(t + 0.08 * u, -0.34 * u, 0.02 * u, 0, Math.PI * 2);
  ctx.fill();
}

/** The scarf's band round the neck, and from the front its hanging end. */
function scarfPath(ctx: CanvasRenderingContext2D, u: number, t: number, back: boolean) {
  ctx.beginPath();
  ctx.roundRect(-0.22 * u, -0.52 * u, 0.44 * u, 0.09 * u, 0.04 * u);
  if (!back) ctx.roundRect(t + 0.05 * u, -0.48 * u, 0.08 * u, 0.2 * u, 0.03 * u);
}

function drawScarf(
  ctx: CanvasRenderingContext2D,
  u: number,
  t: number,
  back: boolean,
  p: ThemePalette,
  g: Garb,
) {
  const usual = GARMENT_COLOR.scarf(p);
  paintCloth(ctx, u, () => scarfPath(ctx, u, t, back), g.color(usual), g.fill());
  if (back) return;
  ctx.fillStyle = "rgba(255,255,255,0.3)";
  ctx.fillRect(t + 0.05 * u, -0.34 * u, 0.08 * u, 0.02 * u);
}

/**
 * A dress over the body, inside its clip, with a sash at the waist. Unstyled it takes the outfit's
 * color and pattern; its skirt is the flare drawn behind the body.
 */
function drawDressBodice(
  ctx: CanvasRenderingContext2D,
  u: number,
  shape: ResidentShape,
  p: ThemePalette,
  g: Garb,
  outfit: CanvasPattern | null,
) {
  paintCloth(ctx, u, () => bodyPath(ctx, shape, u), g.color(p.main), g.fill(outfit));
  ctx.fillStyle = g.trim(p.deep);
  ctx.fillRect(-0.5 * u, -0.25 * u, u, 0.045 * u);
}

/** The top hat's crown and brim, as one path. */
function topHatPath(ctx: CanvasRenderingContext2D, u: number) {
  const brim = (HAT_TOP + 0.05) * u;
  ctx.beginPath();
  ctx.ellipse(0, brim, 0.27 * u, 0.05 * u, 0, 0, Math.PI * 2);
  ctx.moveTo(-0.15 * u, brim);
  ctx.lineTo(-0.16 * u, -1.03 * u);
  ctx.quadraticCurveTo(0, -1.06 * u, 0.16 * u, -1.03 * u);
  ctx.lineTo(0.15 * u, brim);
  ctx.closePath();
}

/** A tall dark top hat with a band in the theme's accent. */
function drawTopHat(ctx: CanvasRenderingContext2D, u: number, p: ThemePalette, g: Garb) {
  const brim = (HAT_TOP + 0.05) * u;
  paintCloth(ctx, u, () => topHatPath(ctx, u), g.color(GARMENT_COLOR.top_hat(p)), g.fill());
  ctx.fillStyle =
    p.accent === "#ffffff" || p.accent === BRAND_HEX.paper ? BRAND_HEX.clay : p.accent;
  ctx.fillRect(-0.15 * u, brim - 0.08 * u, 0.3 * u, 0.055 * u);
  ctx.fillStyle = "rgba(255, 255, 255, 0.16)";
  ctx.fillRect(-0.11 * u, -1.0 * u, 0.04 * u, 0.12 * u);
}

/** The raincoat covers the whole body, so its path is the body's own. */
function raincoatPath(ctx: CanvasRenderingContext2D, u: number, shape: ResidentShape) {
  bodyPath(ctx, shape, u);
}

/**
 * A yellow slicker over the body, drawn inside the body's clip: a collar, and from the front a
 * placket with dark toggles and two pockets. Sideways the front slides the way they face.
 */
function drawRaincoat(
  ctx: CanvasRenderingContext2D,
  u: number,
  shape: ResidentShape,
  back: boolean,
  side: number,
  g: Garb,
) {
  paintCloth(ctx, u, () => raincoatPath(ctx, u, shape), g.color(SLICKER), g.fill());
  const deep = g.trim(SLICKER_DEEP);
  const t = side * 0.1 * u;
  // Collar.
  ctx.fillStyle = deep;
  ctx.beginPath();
  ctx.roundRect(-0.24 * u, -0.53 * u, 0.48 * u, 0.08 * u, 0.04 * u);
  ctx.fill();
  // A shine down one side, so it reads as rubbery.
  ctx.fillStyle = "rgba(255, 255, 255, 0.28)";
  ctx.beginPath();
  ctx.ellipse(-0.17 * u, -0.28 * u, 0.035 * u, 0.13 * u, 0.15, 0, Math.PI * 2);
  ctx.fill();
  if (back) return;
  ctx.strokeStyle = deep;
  ctx.lineWidth = Math.max(0.8, 0.02 * u);
  ctx.beginPath();
  ctx.moveTo(t, -0.46 * u);
  ctx.lineTo(t, -0.03 * u);
  ctx.stroke();
  ctx.fillStyle = INK;
  for (const y of [-0.38, -0.27, -0.16]) {
    ctx.beginPath();
    ctx.roundRect(t + 0.012 * u, y * u, 0.07 * u, 0.025 * u, 0.012 * u);
    ctx.fill();
  }
  ctx.fillStyle = deep;
  for (const x of [-0.19, 0.07]) {
    ctx.beginPath();
    ctx.roundRect(t + x * u, -0.15 * u, 0.12 * u, 0.07 * u, 0.02 * u);
    ctx.fill();
  }
}

// ---------- bottoms ----------

/** A skirt's flare: from the waist out past the body to a curved hem just above the feet. */
function flarePath(ctx: CanvasRenderingContext2D, u: number) {
  ctx.beginPath();
  ctx.moveTo(-0.2 * u, -0.27 * u);
  ctx.lineTo(0.2 * u, -0.27 * u);
  ctx.quadraticCurveTo(0.33 * u, -0.16 * u, 0.41 * u, -0.06 * u);
  ctx.quadraticCurveTo(0, 0.02 * u, -0.41 * u, -0.06 * u);
  ctx.quadraticCurveTo(-0.33 * u, -0.16 * u, -0.2 * u, -0.27 * u);
  ctx.closePath();
}

/** The flare of a skirt or a dress, behind the body, with a line of stitching at the hem. */
function drawFlare(
  ctx: CanvasRenderingContext2D,
  u: number,
  g: Garb,
  usual: string,
  usualFill: CanvasPattern | null,
) {
  const color = g.color(usual);
  paintCloth(ctx, u, () => flarePath(ctx, u), color, g.fill(usualFill));
  ctx.strokeStyle = g.trim(mix(color, INK, 0.3));
  ctx.lineWidth = Math.max(0.8, 0.02 * u);
  ctx.beginPath();
  ctx.moveTo(0.36 * u, -0.06 * u);
  ctx.quadraticCurveTo(0, 0, -0.36 * u, -0.06 * u);
  ctx.stroke();
}

/** Where a bottom starts on the body: the skirt and trousers at the waist, shorts a little lower. */
const WAIST = -0.24;

function bottomBandPath(ctx: CanvasRenderingContext2D, u: number, top: number) {
  ctx.beginPath();
  ctx.rect(-0.5 * u, top * u, u, -top * u);
}

/**
 * The bottom's part on the body, inside the body clip, under any top: a band from the waist down
 * with a waistband, and for trousers and shorts a seam between the legs.
 */
function drawBottom(
  ctx: CanvasRenderingContext2D,
  u: number,
  wear: Set<WearItem>,
  p: ThemePalette,
  garb: (item: WearItem) => Garb,
  side: number,
) {
  const item = (["skirt", "trousers", "shorts"] as const).find((w) => wear.has(w));
  if (!item) return;
  const g = garb(item);
  const color = g.color(p.deep);
  const top = item === "shorts" ? WAIST + 0.03 : WAIST;
  paintCloth(ctx, u, () => bottomBandPath(ctx, u, top), color, g.fill());
  ctx.fillStyle = mix(color, INK, 0.25);
  ctx.fillRect(-0.5 * u, top * u, u, 0.035 * u);
  if (item === "skirt") return;
  ctx.strokeStyle = mix(color, INK, 0.35);
  ctx.lineWidth = Math.max(0.8, 0.02 * u);
  ctx.beginPath();
  ctx.moveTo(side * 0.05 * u, -0.13 * u);
  ctx.lineTo(side * 0.05 * u, 0);
  ctx.stroke();
}

/** Two trouser legs from under the body down over the tops of the feet. */
function trouserLegsPath(ctx: CanvasRenderingContext2D, u: number, feet: [number, number]) {
  ctx.beginPath();
  for (const f of feet) ctx.roundRect((f - 0.065) * u, -0.13 * u, 0.13 * u, 0.115 * u, 0.03 * u);
}

function drawTrouserLegs(
  ctx: CanvasRenderingContext2D,
  u: number,
  feet: [number, number],
  p: ThemePalette,
  g: Garb,
) {
  const color = g.color(GARMENT_COLOR.trousers(p));
  paintCloth(ctx, u, () => trouserLegsPath(ctx, u, feet), color, g.fill());
  ctx.fillStyle = mix(color, INK, 0.25);
  for (const f of feet) ctx.fillRect((f - 0.065) * u, -0.035 * u, 0.13 * u, 0.02 * u);
}

/** Shorts' turned-up cuffs, poking out past the hem on both sides. */
function shortsCuffsPath(ctx: CanvasRenderingContext2D, u: number) {
  ctx.beginPath();
  ctx.roundRect(-0.27 * u, -0.1 * u, 0.22 * u, 0.065 * u, 0.025 * u);
  ctx.roundRect(0.05 * u, -0.1 * u, 0.22 * u, 0.065 * u, 0.025 * u);
}

function drawShortsCuffs(ctx: CanvasRenderingContext2D, u: number, p: ThemePalette, g: Garb) {
  const color = g.color(GARMENT_COLOR.shorts(p));
  paintCloth(ctx, u, () => shortsCuffsPath(ctx, u), mix(color, INK, 0.12), g.fill());
}

// ---------- feet ----------

/** Socks: an ankle and a foot for each, with a band at the top. */
function socksPath(ctx: CanvasRenderingContext2D, u: number, feet: [number, number], side: number) {
  ctx.beginPath();
  for (const f of feet) {
    ctx.roundRect((f - 0.05) * u, -0.14 * u, 0.1 * u, 0.12 * u, 0.03 * u);
    ctx.ellipse((f + 0.015 * side) * u, -0.02 * u, 0.075 * u, 0.045 * u, 0, 0, Math.PI * 2);
  }
}

function drawSocks(
  ctx: CanvasRenderingContext2D,
  u: number,
  feet: [number, number],
  side: number,
  p: ThemePalette,
  g: Garb,
) {
  // Socks in the theme's accent, so a pattern's light motif shows on them, with a pale cuff.
  const color = g.color(GARMENT_COLOR.socks(p));
  ctx.strokeStyle = mix(color, INK, 0.3);
  ctx.lineWidth = Math.max(0.8, 0.015 * u);
  socksPath(ctx, u, feet, side);
  ctx.stroke();
  const motif = g.fill();
  paintCloth(ctx, u, () => socksPath(ctx, u, feet, side), color, motif);
  if (motif) return;
  ctx.fillStyle = g.own ? mix(g.own, PAPER, 0.6) : p.light;
  for (const f of feet) ctx.fillRect((f - 0.05) * u, -0.13 * u, 0.1 * u, 0.025 * u);
}

/** Boots: a shaft up the leg and a sturdy foot for each. */
function bootsPath(ctx: CanvasRenderingContext2D, u: number, feet: [number, number], side: number) {
  ctx.beginPath();
  for (const f of feet) {
    ctx.roundRect((f - 0.06) * u, -0.15 * u, 0.12 * u, 0.13 * u, 0.025 * u);
    ctx.ellipse((f + 0.02 * side) * u, -0.025 * u, 0.085 * u, 0.05 * u, 0, 0, Math.PI * 2);
  }
}

function drawBoots(
  ctx: CanvasRenderingContext2D,
  u: number,
  feet: [number, number],
  side: number,
  g: Garb,
) {
  const color = g.color(LEATHER);
  paintCloth(ctx, u, () => bootsPath(ctx, u, feet, side), color, g.fill());
  const dark = mix(color, INK, 0.4);
  ctx.fillStyle = dark;
  for (const f of feet) {
    ctx.fillRect((f - 0.06) * u, -0.15 * u, 0.12 * u, 0.025 * u);
    ctx.fillRect((f + 0.02 * side - 0.085) * u, 0.005 * u, 0.17 * u, 0.02 * u);
  }
}

/** Sneakers: a rounded shoe for each foot. */
function sneakersPath(
  ctx: CanvasRenderingContext2D,
  u: number,
  feet: [number, number],
  side: number,
) {
  ctx.beginPath();
  for (const f of feet) {
    ctx.ellipse((f + 0.015 * side) * u, -0.03 * u, 0.09 * u, 0.055 * u, 0, 0, Math.PI * 2);
  }
}

function drawSneakers(
  ctx: CanvasRenderingContext2D,
  u: number,
  feet: [number, number],
  side: number,
  p: ThemePalette,
  g: Garb,
) {
  const color = g.color(GARMENT_COLOR.sneakers(p));
  ctx.strokeStyle = mix(color, INK, 0.45);
  ctx.lineWidth = Math.max(0.8, 0.018 * u);
  sneakersPath(ctx, u, feet, side);
  ctx.stroke();
  paintCloth(ctx, u, () => sneakersPath(ctx, u, feet, side), color, g.fill());
  // A stripe on each side, and a pale sole.
  ctx.strokeStyle = g.own ? mix(g.own, INK, 0.35) : p.accent === "#ffffff" ? p.deep : p.accent;
  ctx.lineWidth = Math.max(1, 0.025 * u);
  ctx.beginPath();
  for (const f of feet) {
    const x = (f + 0.015 * side) * u;
    ctx.moveTo(x - 0.05 * u, -0.025 * u);
    ctx.quadraticCurveTo(x, -0.005 * u, x + 0.05 * u, -0.05 * u);
  }
  ctx.stroke();
  ctx.fillStyle = mix(color, INK, 0.15);
  for (const f of feet) ctx.fillRect((f + 0.015 * side - 0.08) * u, 0.0, 0.16 * u, 0.018 * u);
}

// ---------- accessories ----------

function satchelBagPath(ctx: CanvasRenderingContext2D, u: number, bag: number) {
  ctx.beginPath();
  ctx.roundRect(bag * u, -0.22 * u, 0.17 * u, 0.13 * u, 0.03 * u);
}

/** A leather satchel on a strap across the body, on the carrying side. */
function drawSatchel(ctx: CanvasRenderingContext2D, u: number, hand: number, g: Garb) {
  const leather = g.color(LEATHER);
  ctx.strokeStyle = leather;
  ctx.lineWidth = 0.04 * u;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(-0.16 * hand * u, -0.48 * u);
  ctx.lineTo(0.18 * hand * u, -0.16 * u);
  ctx.stroke();
  const bag = hand > 0 ? 0.13 : -0.3;
  paintCloth(ctx, u, () => satchelBagPath(ctx, u, bag), leather, g.fill());
  ctx.fillStyle = mix(leather, "#000000", 0.25);
  ctx.fillRect(bag * u, -0.22 * u, 0.17 * u, 0.04 * u);
}

/** Where the lenses sit: both eyes from the front, the one eye in profile. */
const lensesAt = (side: number) => (side ? [PROFILE_EYE * side] : [-0.075, 0.075]);

function lensesPath(ctx: CanvasRenderingContext2D, u: number, side: number) {
  ctx.beginPath();
  for (const x of lensesAt(side)) {
    ctx.moveTo((x + 0.055) * u, -0.64 * u);
    ctx.arc(x * u, -0.64 * u, 0.055 * u, 0, Math.PI * 2);
  }
}

/**
 * Round glasses: frames in its color, and with a pattern, tinted lenses in it. From the front a
 * bridge joins the lenses; in profile the arm runs back toward the ear.
 */
function drawGlasses(ctx: CanvasRenderingContext2D, u: number, side: number, g: Garb) {
  const motif = g.fill();
  if (motif) {
    ctx.save();
    ctx.globalAlpha = 0.75;
    paintCloth(ctx, u, () => lensesPath(ctx, u, side), "#eaf4f6", motif);
    ctx.restore();
  }
  ctx.strokeStyle = g.color(INK);
  ctx.lineWidth = Math.max(1, 0.022 * u);
  lensesPath(ctx, u, side);
  if (side) {
    ctx.moveTo((PROFILE_EYE - 0.055) * side * u, -0.645 * u);
    ctx.lineTo(-0.08 * side * u, -0.66 * u);
  } else {
    ctx.moveTo(-0.02 * u, -0.645 * u);
    ctx.lineTo(0.02 * u, -0.645 * u);
  }
  ctx.stroke();
}

/** The bow's two loops, either side of (x, y). */
function bowPath(ctx: CanvasRenderingContext2D, u: number, x: number, y: number) {
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x - 0.1 * u, y - 0.06 * u);
  ctx.lineTo(x - 0.1 * u, y + 0.06 * u);
  ctx.closePath();
  ctx.moveTo(x, y);
  ctx.lineTo(x + 0.1 * u, y - 0.06 * u);
  ctx.lineTo(x + 0.1 * u, y + 0.06 * u);
  ctx.closePath();
}

/** A bow in the hair. Sideways it sits toward the back of the head. */
function drawBow(
  ctx: CanvasRenderingContext2D,
  u: number,
  side: number,
  back: boolean,
  p: ThemePalette,
  g: Garb,
) {
  const x = 0.15 * (side ? -side : back ? -1 : 1) * u;
  const y = -0.82 * u;
  const color = g.color(GARMENT_COLOR.bow(p));
  paintCloth(ctx, u, () => bowPath(ctx, u, x, y), color, g.fill());
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x, y, 0.03 * u, 0, Math.PI * 2);
  ctx.fill();
}

function basketPath(ctx: CanvasRenderingContext2D, u: number, x: number, y: number) {
  ctx.beginPath();
  ctx.roundRect(x - 0.11 * u, y, 0.22 * u, 0.12 * u, [0, 0, 0.04 * u, 0.04 * u]);
}

/** A wicker basket of fruit on the carrying side: handle, fruit, then the basket in front. */
function drawBasket(
  ctx: CanvasRenderingContext2D,
  u: number,
  hand: number,
  p: ThemePalette,
  g: Garb,
) {
  const x = 0.3 * hand * u;
  const y = -0.2 * u;
  const wicker = g.color(GARMENT_COLOR.basket(p));
  ctx.strokeStyle = wicker;
  ctx.lineWidth = 0.03 * u;
  ctx.beginPath();
  ctx.arc(x, y, 0.09 * u, Math.PI, 0);
  ctx.stroke();
  ctx.fillStyle = p.main;
  ctx.beginPath();
  ctx.arc(x - 0.045 * u, y - 0.005 * u, 0.045 * u, 0, Math.PI * 2);
  ctx.arc(x + 0.045 * u, y - 0.015 * u, 0.042 * u, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = p.accent === "#ffffff" ? p.deep : p.accent;
  ctx.beginPath();
  ctx.ellipse(x + 0.01 * u, y - 0.055 * u, 0.03 * u, 0.015 * u, -0.5, 0, Math.PI * 2);
  ctx.fill();
  paintCloth(ctx, u, () => basketPath(ctx, u, x, y), wicker, g.fill());
  ctx.strokeStyle = mix(wicker, "#000000", 0.25);
  ctx.lineWidth = Math.max(0.6, 0.015 * u);
  ctx.beginPath();
  ctx.moveTo(x - 0.11 * u, y + 0.045 * u);
  ctx.lineTo(x + 0.11 * u, y + 0.045 * u);
  ctx.moveTo(x - 0.1 * u, y + 0.085 * u);
  ctx.lineTo(x + 0.1 * u, y + 0.085 * u);
  ctx.stroke();
}

/** An open umbrella's canopy over (cx, cy): a dome with a scalloped edge. */
function canopyPath(ctx: CanvasRenderingContext2D, u: number, cx: number, cy: number) {
  const r = 0.3 * u;
  const scallops = 4;
  ctx.beginPath();
  ctx.moveTo(cx - r, cy);
  ctx.quadraticCurveTo(cx - r, cy - r * 0.62, cx, cy - r * 0.66);
  ctx.quadraticCurveTo(cx + r, cy - r * 0.62, cx + r, cy);
  for (let i = scallops; i > 0; i--) {
    const x1 = cx - r + ((i - 1) * 2 * r) / scallops;
    const mid = (x1 + cx - r + (i * 2 * r) / scallops) / 2;
    ctx.quadraticCurveTo(mid, cy - r * 0.16, x1, cy);
  }
  ctx.closePath();
}

/**
 * An open umbrella held in the carrying hand, its canopy over the head on that side, in the
 * theme's accent (or a cheerful coral when the accent is too pale) with paper panels. A patterned
 * canopy shows its pattern instead of the panels.
 */
function drawUmbrella(
  ctx: CanvasRenderingContext2D,
  u: number,
  p: ThemePalette,
  hand: number,
  g: Garb,
) {
  const pale = paleAccent(p);
  const color = g.color(GARMENT_COLOR.umbrella(p));
  const motif = g.fill();
  // Kept inside the figure's box (FIGURE_BOX), which is all its sprite has room for.
  const cx = 0.17 * hand * u;
  const cy = -0.86 * u;
  // Shaft and the hooked handle, from the hand up into the canopy.
  ctx.strokeStyle = INK;
  ctx.lineCap = "round";
  ctx.lineWidth = Math.max(1, 0.03 * u);
  ctx.beginPath();
  ctx.moveTo(cx, cy - 0.17 * u);
  ctx.lineTo(0.3 * hand * u, -0.2 * u);
  ctx.quadraticCurveTo(0.31 * hand * u, -0.12 * u, 0.36 * hand * u, -0.15 * u);
  ctx.stroke();
  paintCloth(ctx, u, () => canopyPath(ctx, u, cx, cy), color, motif);
  if (!motif) {
    // Two paper panels between the ribs.
    ctx.save();
    canopyPath(ctx, u, cx, cy);
    ctx.clip();
    ctx.fillStyle = mix(color, BRAND_HEX.paper, 0.7);
    for (const f of [-0.5, 0.5]) {
      ctx.beginPath();
      ctx.moveTo(cx, cy - 0.2 * u);
      ctx.lineTo(cx + (f - 0.12) * 0.6 * u, cy + 0.02 * u);
      ctx.lineTo(cx + (f + 0.12) * 0.6 * u, cy + 0.02 * u);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }
  ctx.strokeStyle = mix(color, INK, 0.35);
  ctx.lineWidth = Math.max(0.8, 0.018 * u);
  canopyPath(ctx, u, cx, cy);
  ctx.stroke();
  ctx.fillStyle = INK;
  ctx.beginPath();
  ctx.arc(cx, cy - 0.18 * u, 0.02 * u, 0, Math.PI * 2);
  ctx.fill();
}

/** Where the lantern hangs: out past the carrying hand, inside the figure's box. */
const LANTERN_X = 0.37;
const LANTERN_Y = -0.22;

/** The lantern's round paper body. */
function lanternPath(ctx: CanvasRenderingContext2D, u: number, x: number) {
  ctx.beginPath();
  ctx.ellipse(x, LANTERN_Y * u, 0.07 * u, 0.08 * u, 0, 0, Math.PI * 2);
}

/**
 * The Muse lantern: a round paper lantern hung from the tip of a short stick held in the carrying
 * hand, glowing warm, with dark caps and a couple of ribs.
 */
function drawMuseLantern(
  ctx: CanvasRenderingContext2D,
  u: number,
  hand: number,
  p: ThemePalette,
  g: Garb,
) {
  const x = LANTERN_X * hand * u;
  const y = LANTERN_Y * u;
  const color = g.color(GARMENT_COLOR.muse_lantern(p));
  ctx.save();
  ctx.globalAlpha = 0.28;
  ctx.fillStyle = mix(color, PAPER, 0.3);
  ctx.beginPath();
  ctx.arc(x, y, 0.12 * u, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  // The stick, from the hand up and out, and the cord down to the lantern.
  ctx.strokeStyle = WOOD_DARK;
  ctx.lineCap = "round";
  ctx.lineWidth = Math.max(1, 0.025 * u);
  ctx.beginPath();
  ctx.moveTo(0.27 * hand * u, -0.24 * u);
  ctx.lineTo(x, -0.37 * u);
  ctx.stroke();
  ctx.lineWidth = Math.max(0.6, 0.01 * u);
  ctx.beginPath();
  ctx.moveTo(x, -0.37 * u);
  ctx.lineTo(x, y - 0.08 * u);
  ctx.stroke();
  paintCloth(ctx, u, () => lanternPath(ctx, u, x), color, g.fill());
  ctx.save();
  lanternPath(ctx, u, x);
  ctx.clip();
  ctx.fillStyle = "rgba(255, 255, 255, 0.4)";
  ctx.beginPath();
  ctx.ellipse(x, y, 0.035 * u, 0.05 * u, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = g.trim(mix(LANTERN, BRAND_HEX.clay, 0.45));
  ctx.lineWidth = Math.max(0.6, 0.012 * u);
  ctx.beginPath();
  ctx.moveTo(x - 0.07 * u, y - 0.03 * u);
  ctx.quadraticCurveTo(x, y - 0.015 * u, x + 0.07 * u, y - 0.03 * u);
  ctx.moveTo(x - 0.07 * u, y + 0.03 * u);
  ctx.quadraticCurveTo(x, y + 0.045 * u, x + 0.07 * u, y + 0.03 * u);
  ctx.stroke();
  ctx.restore();
  ctx.fillStyle = WOOD_DARK;
  ctx.beginPath();
  ctx.roundRect(x - 0.035 * u, y - 0.095 * u, 0.07 * u, 0.025 * u, 0.008 * u);
  ctx.roundRect(x - 0.035 * u, y + 0.07 * u, 0.07 * u, 0.025 * u, 0.008 * u);
  ctx.fill();
}
