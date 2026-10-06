/**
 * A resident drawn as a small, soft figure: a round head in their color, a body in their theme's
 * clothes and pattern, and one thing to wear in each slot (hat, top, accessory, bottom, feet). Each
 * garment can have its own color and pattern (`wearStyle`), painted the same way the clothes are.
 * Drawn with plain canvas shapes, once per look into a cached sprite (see render.ts), so the world
 * stays cheap at 60fps on a phone.
 */
import { fourWayFacing } from "@terrakin/protocol";
import {
  BLOCK_COLORS,
  DEFAULT_HAIR_COLOR,
  type Direction,
  type GarmentPattern,
  HAIR_COLOR_INFO,
  HAIR_LABELS,
  type HairColor,
  type HairStyle,
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
import type { Feeling } from "./feelings";
import {
  BAT_WING,
  HALLOWEEN_HEX,
  hidesHair,
  lookImage,
  lookPalette,
  luminance,
  mix,
  PatternCache,
  RESIDENT_COLOR_HEX,
} from "./looks";

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
  /** A hair style. Without one, no hair. */
  hair?: HairStyle | undefined;
  /** The hair's color, brown until picked. */
  hairColor?: HairColor | undefined;
}

/** Everything a figure picture needs, including the pattern. */
export type FullLook = FigureLook;

const pagePatterns = new PatternCache();

/** True when a look has anything to draw beyond the plain color token. */
export function hasLook(look: Partial<FullLook> | undefined): boolean {
  return Boolean(
    look?.theme || look?.pattern || look?.wear?.length || look?.patternMedia || hairOf(look ?? {}),
  );
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
 * figure paints with it and the 3D figures (`packages/client/src/scene3d/wear.ts`) read it, so a
 * garment is the same color in both.
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
  witch_hat: () => HALLOWEEN_HEX.witch,
  cat_ears: () => HALLOWEEN_HEX.catEars,
  pumpkin_head: () => HALLOWEEN_HEX.pumpkin,
  ghost_sheet: () => HALLOWEEN_HEX.sheet,
  bat_wings: () => HALLOWEEN_HEX.bat,
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
 * How the figure looks this moment: a feeling, eyes shut for a blink, a hand up to wave, and, out
 * in the world when it isn't raining, an umbrella rolled up.
 */
export interface FigureFace {
  feeling?: Feeling | undefined;
  blink?: boolean | undefined;
  /** A raised hand, at one end of the wave (1) or the other (2). 0 or absent: arms down. */
  wave?: 0 | 1 | 2 | undefined;
  /** The umbrella rolled up and carried like a walking stick. Absent: held up open, as on a page. */
  furled?: boolean | undefined;
}

const NO_FACE: FigureFace = {};

/** Feelings drawn with open eyes, which close for a blink. The rest have shut or curved eyes. */
export const blinks = (feeling: Feeling | undefined): boolean =>
  feeling !== "happy" && feeling !== "laugh" && feeling !== "love" && feeling !== "sleepy";

/**
 * The small sign that floats over a figure showing some feelings, or, for `moon`, someone away and
 * out on a routine (RFC 0009).
 */
export type FeelingIcon = "heart" | "z" | "dots" | "spark" | "moon";

export const FEELING_ICON: Partial<Record<Feeling, FeelingIcon>> = {
  love: "heart",
  laugh: "spark",
  surprised: "spark",
  sleepy: "z",
  thinking: "dots",
};

/** How far the raised arm leans out from straight up, in radians, at each end of the wave. */
const WAVE_LEAN = { front: [0, 0.35, 0.75], side: [0, 0.85, 1.2] } as const;

/** The raised arm's shoulder, the middle of the arm, and the hand, for `s` (-1 or 1) and the wave. */
function raisedArm(side: number, s: number, wave: 1 | 2) {
  const lean = (side ? WAVE_LEAN.side : WAVE_LEAN.front)[wave];
  // In profile the arm reaches forward, clear of the nose.
  const sx = (side ? 0.15 : 0.22) * s;
  const reach = side ? 0.22 : 0.2;
  const dx = Math.sin(lean) * s;
  const dy = -Math.cos(lean);
  return {
    x: sx + dx * reach * 0.5,
    y: -0.4 + dy * reach * 0.5,
    tilt: lean * s,
    hand: { x: sx + dx * reach, y: -0.4 + dy * reach },
  };
}

function raisedArmPath(
  ctx: CanvasRenderingContext2D,
  u: number,
  arm: ReturnType<typeof raisedArm>,
) {
  ctx.beginPath();
  ctx.ellipse(arm.x * u, arm.y * u, 0.055 * u, 0.11 * u, arm.tilt, 0, Math.PI * 2);
  ctx.moveTo((arm.hand.x + 0.05) * u, arm.hand.y * u);
  ctx.arc(arm.hand.x * u, arm.hand.y * u, 0.05 * u, 0, Math.PI * 2);
}

/**
 * Draw a figure with its feet at (0, 0) of the current transform. `u` is one tile in pixels.
 * `pattern` fills the clothes over the main color (null for plain). `facing` is the way they look:
 * south (the default) shows the face, north their back, east and west a profile with one eye and
 * a nose pointing that way, and a diagonal the profile it's heading toward (`fourWayFacing`).
 * `patterns` makes the tiles for garments with a pattern of their own. `face` is the feeling on
 * the face, a blink, and a wave; without one the face is neutral with open eyes.
 */
export function drawFigure(
  ctx: CanvasRenderingContext2D,
  u: number,
  look: FigureLook,
  pattern: CanvasPattern | null,
  facing: Direction = "s",
  patterns: PatternCache = pagePatterns,
  face: FigureFace = NO_FACE,
) {
  const p = lookPalette(look.theme, look.color);
  const head = RESIDENT_COLOR_HEX[look.color] ?? RESIDENT_COLOR_HEX.sun;
  const wear = new Set(look.wear ?? []);
  const garb = (item: WearItem) => garbFor(ctx, u, look, item, patterns);
  const rim = Math.max(1.5, u * 0.06);
  const turned = fourWayFacing(facing);
  const back = turned === "n";
  // Turned sideways, front details slide toward the way they face.
  const side = turned === "e" ? 1 : turned === "w" ? -1 : 0;
  // Which side things carried in the right hand show on.
  const hand = side || (back ? -1 : 1);
  const feet = feetAt(side);
  const flared = wear.has("dress") || wear.has("skirt");
  const shoes = wear.has("socks") || wear.has("boots") || wear.has("sneakers");
  // A wave raises the arm on the carrying side up beside the head.
  const waving = face.wave ? raisedArm(side, hand, face.wave) : undefined;
  // Halloween's costumes (RFC 0022): a ghost sheet is the whole figure but its face, a pumpkin is
  // the whole head, and under either there's no hair to see.
  const ghost = wear.has("ghost_sheet");
  const pumpkin = wear.has("pumpkin_head");
  const wings = wear.has("bat_wings");
  const hair = hidesHair(look.wear) ? undefined : hairOf(look);
  const hairView: HairView = { side, back, hat: coveringHat(wear) };

  // White rim behind everything, so the figure reads on any ground.
  ctx.lineJoin = "round";
  ctx.strokeStyle = RIM;
  ctx.lineWidth = rim * 2;
  if (wings) {
    batWingsPath(ctx, u, side, back);
    ctx.stroke();
  }
  if (ghost) ghostPath(ctx, u, side);
  else bodyPath(ctx, look.shape, u);
  ctx.stroke();
  if (pumpkin) {
    pumpkinPath(ctx, u, side);
    ctx.stroke();
  } else if (!ghost) {
    headPath(ctx, u, back ? 0 : side);
    ctx.stroke();
  }
  if (waving) {
    raisedArmPath(ctx, u, waving);
    ctx.stroke();
  }
  if (flared) {
    flarePath(ctx, u);
    ctx.stroke();
  }
  if (hair) rimHair(ctx, u, hair.style, hairView);

  // Hair that hangs behind the head and body: a bob's back, a ponytail, an afro's puff.
  if (hair) drawHair(ctx, u, hair, "behind", hairView, p);

  // Bat wings spread behind the shoulders, or over the back when it's turned to us.
  if (wings && !back) drawBatWings(ctx, u, side, back, garb("bat_wings"));

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

  // Clothes: main color, then the pattern, clipped to the body. Under a ghost sheet, the sheet.
  if (ghost) drawGhostSheet(ctx, u, side, back, garb("ghost_sheet"));
  else {
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
  }

  // Legs and feet in front of the hem: socks go under trousers, boots and sneakers over them.
  if (wear.has("socks")) drawSocks(ctx, u, feet, side, p, garb("socks"));
  if (wear.has("trousers")) drawTrouserLegs(ctx, u, feet, p, garb("trousers"));
  else if (wear.has("shorts")) drawShortsCuffs(ctx, u, p, garb("shorts"));
  if (wear.has("boots")) drawBoots(ctx, u, feet, side, garb("boots"));
  else if (wear.has("sneakers")) drawSneakers(ctx, u, feet, side, p, garb("sneakers"));

  // Little arms. Sideways, the near arm hangs over the body and the far one is hidden. A raised
  // arm takes the place of the one on its side. Under a ghost sheet they're the sheet's.
  const arm = ghost
    ? mix(garb("ghost_sheet").color(HALLOWEEN_HEX.sheet), HALLOWEEN_HEX.sheetShade, 0.5)
    : mix(p.main, p.deep, 0.18);
  ctx.fillStyle = arm;
  ctx.beginPath();
  if (side) {
    if (!waving)
      ctx.ellipse(-0.03 * side * u, -0.29 * u, 0.065 * u, 0.11 * u, 0.25 * side, 0, Math.PI * 2);
  } else {
    if (!waving || hand > 0)
      ctx.ellipse(-0.27 * u, -0.3 * u, 0.06 * u, 0.1 * u, 0.35, 0, Math.PI * 2);
    if (!waving || hand < 0) {
      ctx.moveTo(0.33 * u, -0.3 * u);
      ctx.ellipse(0.27 * u, -0.3 * u, 0.06 * u, 0.1 * u, -0.35, 0, Math.PI * 2);
    }
  }
  ctx.fill();
  if (waving) {
    raisedArmPath(ctx, u, waving);
    ctx.fill();
  }

  if (wear.has("satchel")) drawSatchel(ctx, u, hand, garb("satchel"));
  if (wings && back) drawBatWings(ctx, u, side, back, garb("bat_wings"));

  // Head and face: a ghost's head is the sheet's, so only its face goes on, and a pumpkin head has
  // the face carved into it.
  if (pumpkin) drawPumpkinHead(ctx, u, side, back, garb("pumpkin_head"));
  else {
    if (!ghost) {
      ctx.fillStyle = head;
      headPath(ctx, u, back ? 0 : side);
      ctx.fill();
    }
    ctx.fillStyle = "rgba(255, 255, 255, 0.35)";
    ctx.beginPath();
    ctx.ellipse(-0.08 * u, -0.74 * u, 0.06 * u, 0.035 * u, -0.6, 0, Math.PI * 2);
    ctx.fill();
    if (!back) {
      const eye = look.color === "coal" && !ghost ? BRAND_HEX.paper : INK;
      drawFace(ctx, u, eye, side, face.feeling ?? "neutral", Boolean(face.blink));
    }
  }
  // Hair on the head, over the face's edges, and under glasses and any hat.
  if (hair) drawHair(ctx, u, hair, "over", hairView, p);
  if (!back && !pumpkin && wear.has("glasses")) drawGlasses(ctx, u, side, garb("glasses"));

  drawHat(ctx, u, wear, p, garb, side, back);

  if (wear.has("bow")) drawBow(ctx, u, side, back, p, garb("bow"));
  if (wear.has("basket")) drawBasket(ctx, u, hand, p, garb("basket"));
  if (wear.has("umbrella")) {
    if (face.furled) drawFurledUmbrella(ctx, u, p, hand, garb("umbrella"));
    else drawUmbrella(ctx, u, p, hand, garb("umbrella"));
  }
  if (wear.has("muse_lantern")) drawMuseLantern(ctx, u, hand, p, garb("muse_lantern"));
}

const EYE_Y = -0.64;
const EYE_R = 0.026;
const MOUTH_Y = -0.56;
const CHEEK = "rgba(234, 110, 120, 0.4)";
const BLUSH = "rgba(232, 92, 110, 0.62)";
const HEART = "#e8576b";

/** How the eyes look for a feeling, with `blink` closing open ones. */
type EyeShape = "dot" | "shut" | "arc" | "heart" | "round" | "down" | "up" | "sad";

function eyeShape(feeling: Feeling, blink: boolean): EyeShape {
  if (blink && blinks(feeling)) return "shut";
  switch (feeling) {
    case "happy":
    case "laugh":
      return "arc";
    case "love":
      return "heart";
    case "sleepy":
      return "shut";
    case "surprised":
      return "round";
    case "shy":
      return "down";
    case "thinking":
      return "up";
    case "sad":
      return "sad";
    default:
      return "dot";
  }
}

/** A heart `s` wide around (x, y). */
function heartPath(ctx: CanvasRenderingContext2D, x: number, y: number, s: number) {
  ctx.moveTo(x, y + s * 0.42);
  ctx.bezierCurveTo(x - s * 0.62, y + s * 0.02, x - s * 0.42, y - s * 0.52, x, y - s * 0.18);
  ctx.bezierCurveTo(x + s * 0.42, y - s * 0.52, x + s * 0.62, y + s * 0.02, x, y + s * 0.42);
  ctx.closePath();
}

/**
 * The face: two eyes and two cheeks from the front, one of each in profile (`side` 1 east, -1
 * west), and a mouth for every feeling but neutral. Eyes and mouth are drawn in `ink`.
 */
function drawFace(
  ctx: CanvasRenderingContext2D,
  u: number,
  ink: string,
  side: number,
  feeling: Feeling,
  blink: boolean,
) {
  const eyes = side ? [PROFILE_EYE * side] : [-0.075, 0.075];
  const cheeks = side ? [0.03 * side] : [-0.13, 0.13];
  const shape = eyeShape(feeling, blink);
  // Toward the middle of the face: the nose in profile, the other eye from the front.
  const inward = (x: number) => side || (x < 0 ? 1 : -1);
  ctx.lineCap = "round";
  ctx.lineWidth = Math.max(1, 0.022 * u);
  ctx.strokeStyle = ink;
  ctx.fillStyle = shape === "heart" ? HEART : ink;
  ctx.beginPath();
  for (const x of eyes) {
    const ex = x * u;
    const ey = EYE_Y * u;
    switch (shape) {
      case "shut":
        ctx.moveTo((x + 0.03 * Math.cos(0.15 * Math.PI)) * u, (EYE_Y - 0.012) * u);
        ctx.arc(ex, (EYE_Y - 0.012) * u, 0.03 * u, 0.15 * Math.PI, 0.85 * Math.PI);
        break;
      case "arc":
        ctx.moveTo((x - 0.03 * Math.cos(0.15 * Math.PI)) * u, (EYE_Y + 0.008) * u);
        ctx.arc(ex, (EYE_Y + 0.022) * u, 0.03 * u, 1.15 * Math.PI, 1.85 * Math.PI);
        break;
      case "heart":
        heartPath(ctx, ex, ey, 0.075 * u);
        break;
      case "round":
        ctx.moveTo((x + 0.034) * u, ey);
        ctx.ellipse(ex, ey, 0.034 * u, 0.038 * u, 0, 0, Math.PI * 2);
        break;
      case "sad":
        ctx.moveTo((x + EYE_R) * u, (EYE_Y + 0.006) * u);
        ctx.ellipse(ex, (EYE_Y + 0.006) * u, EYE_R * u, EYE_R * u, 0, 0, Math.PI * 2);
        break;
      default: {
        const dx = shape === "up" ? 0.016 * (side || 1) : 0;
        const dy = shape === "up" ? -0.018 : shape === "down" ? 0.016 : 0;
        const r = shape === "down" ? 0.022 : EYE_R;
        ctx.moveTo((x + dx + r) * u, (EYE_Y + dy) * u);
        ctx.ellipse(
          (x + dx) * u,
          (EYE_Y + dy) * u,
          r * u,
          (side ? r * 1.25 : r) * u,
          0,
          0,
          Math.PI * 2,
        );
      }
    }
  }
  if (shape === "shut" || shape === "arc") ctx.stroke();
  else ctx.fill();
  if (shape === "sad") {
    // Brows lifted toward the middle of the face.
    ctx.lineWidth = Math.max(1, 0.016 * u);
    ctx.beginPath();
    for (const x of eyes) {
      ctx.moveTo((x - 0.035 * inward(x)) * u, (EYE_Y - 0.045) * u);
      ctx.lineTo((x + 0.025 * inward(x)) * u, (EYE_Y - 0.065) * u);
    }
    ctx.stroke();
  }
  if (shape === "round") {
    // A catch of light in wide eyes.
    ctx.fillStyle = "rgba(255, 255, 255, 0.85)";
    ctx.beginPath();
    for (const x of eyes) {
      ctx.moveTo((x + 0.022) * u, (EYE_Y - 0.012) * u);
      ctx.arc((x + 0.01) * u, (EYE_Y - 0.012) * u, 0.012 * u, 0, Math.PI * 2);
    }
    ctx.fill();
  }

  // Cheeks, rosier for love and shy.
  const blush = feeling === "love" || feeling === "shy";
  const [cw, ch] = blush ? [0.055, 0.032] : [0.04, 0.025];
  ctx.fillStyle = blush ? BLUSH : CHEEK;
  ctx.beginPath();
  for (const x of cheeks) {
    ctx.moveTo((x + cw) * u, -0.585 * u);
    ctx.ellipse(x * u, -0.585 * u, cw * u, ch * u, 0, 0, Math.PI * 2);
  }
  ctx.fill();

  drawMouth(ctx, u, ink, side, feeling);
}

/** The mouth for a feeling, under the eyes from the front and toward the nose in profile. */
function drawMouth(
  ctx: CanvasRenderingContext2D,
  u: number,
  ink: string,
  side: number,
  feeling: Feeling,
) {
  const x = (side ? 0.125 * side : 0) * u;
  const y = MOUTH_Y * u;
  // In profile you see about half of it.
  const w = (side ? 0.65 : 1) * u;
  ctx.strokeStyle = ink;
  ctx.fillStyle = ink;
  ctx.beginPath();
  switch (feeling) {
    case "happy":
    case "love":
    case "shy": {
      const r = (feeling === "shy" ? 0.022 : 0.034) * w;
      ctx.moveTo(x + r * Math.cos(0.2 * Math.PI), y - 0.02 * u + r * Math.sin(0.2 * Math.PI));
      ctx.arc(x, y - 0.02 * u, r, 0.2 * Math.PI, 0.8 * Math.PI);
      ctx.stroke();
      return;
    }
    case "laugh":
      ctx.ellipse(x, y - 0.012 * u, 0.045 * w, 0.042 * u, 0, 0, Math.PI);
      ctx.closePath();
      ctx.fill();
      return;
    case "surprised":
      ctx.ellipse(x, y, 0.018 * w, 0.022 * u, 0, 0, Math.PI * 2);
      ctx.stroke();
      return;
    case "sad": {
      const r = 0.03 * w;
      ctx.moveTo(x + r * Math.cos(1.2 * Math.PI), y + 0.022 * u + r * Math.sin(1.2 * Math.PI));
      ctx.arc(x, y + 0.022 * u, r, 1.2 * Math.PI, 1.8 * Math.PI);
      ctx.stroke();
      return;
    }
    case "sleepy":
      ctx.ellipse(x, y, 0.012 * w, 0.014 * u, 0, 0, Math.PI * 2);
      ctx.fill();
      return;
    case "thinking":
      ctx.moveTo(x - 0.008 * w, y);
      ctx.lineTo(x + 0.032 * w, y - 0.006 * u);
      ctx.stroke();
      return;
    default:
  }
}

/** How big a feeling's sign is on the map, in CSS pixels, for tiles `scale` pixels across. */
export function signPx(scale: number): number {
  return Math.round(Math.min(34, Math.max(24, scale * 0.8)));
}

/**
 * The sign that floats over a figure, centered on (0, 0) of the current transform and filling a
 * square `size` pixels across: a heart, a "z", three thinking dots, a sparkle, or a crescent moon
 * on a soft paper disc, so it reads on grass, sand, stone, or at night. Drawn the same on the map
 * and, as a texture, over the 3D figure.
 */
export function drawFeelingIcon(ctx: CanvasRenderingContext2D, icon: FeelingIcon, size: number) {
  // The backing: a paper disc on a soft shadow, kept inside the square.
  ctx.save();
  ctx.shadowColor = "rgba(74, 52, 28, 0.32)";
  ctx.shadowBlur = size * 0.07;
  ctx.shadowOffsetY = size * 0.025;
  ctx.fillStyle = PAPER;
  ctx.beginPath();
  ctx.arc(0, 0, size * 0.41, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  ctx.strokeStyle = BRAND_HEX.paperEdge;
  ctx.lineWidth = size * 0.03;
  ctx.stroke();

  const s = size * 0.56;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.beginPath();
  switch (icon) {
    case "heart":
      heartPath(ctx, 0, s * 0.06, s * 0.95);
      ctx.fillStyle = HEART;
      ctx.fill();
      return;
    case "spark":
      sparklePath(ctx, 0, 0, s * 0.5);
      ctx.strokeStyle = BRAND_HEX.clay;
      ctx.lineWidth = s * 0.06;
      ctx.stroke();
      ctx.fillStyle = GOLD;
      ctx.fill();
      return;
    case "z": {
      // A big z and a little one, climbing to the right.
      const zig = (x: number, y: number, k: number) => {
        ctx.moveTo(x - k, y - k);
        ctx.lineTo(x + k, y - k);
        ctx.lineTo(x - k, y + k);
        ctx.lineTo(x + k, y + k);
      };
      zig(-s * 0.14, s * 0.14, s * 0.24);
      zig(s * 0.3, -s * 0.28, s * 0.13);
      ctx.strokeStyle = BRAND_HEX.inkSoft;
      ctx.lineWidth = s * 0.12;
      ctx.stroke();
      return;
    }
    case "dots":
      ctx.fillStyle = INK;
      for (const x of [-0.3, 0, 0.3]) {
        ctx.moveTo((x + 0.09) * s, 0);
        ctx.arc(x * s, 0, 0.09 * s, 0, Math.PI * 2);
      }
      ctx.fill();
      return;
    case "moon": {
      // A crescent: a gold disc with a clay rim, and a paper one laid over its upper right.
      const r = s * 0.42;
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.fillStyle = GOLD;
      ctx.fill();
      ctx.strokeStyle = BRAND_HEX.clay;
      ctx.lineWidth = s * 0.06;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(r * 0.48, -r * 0.34, r * 0.84, 0, Math.PI * 2);
      ctx.fillStyle = PAPER;
      ctx.fill();
      return;
    }
  }
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
  side: number,
  back: boolean,
) {
  if (wear.has("straw_hat")) drawStrawHat(ctx, u, p, garb("straw_hat"));
  else if (wear.has("beret")) drawBeret(ctx, u, p, garb("beret"));
  else if (wear.has("beanie")) drawBeanie(ctx, u, p, garb("beanie"));
  else if (wear.has("top_hat")) drawTopHat(ctx, u, p, garb("top_hat"));
  else if (wear.has("flower_crown")) drawFlowerCrown(ctx, u, p, garb("flower_crown"));
  else if (wear.has("muse_halo")) drawMuseHalo(ctx, u, p, garb("muse_halo"));
  else if (wear.has("witch_hat")) drawWitchHat(ctx, u, side, back, garb("witch_hat"));
  else if (wear.has("cat_ears")) drawCatEars(ctx, u, side, back, garb("cat_ears"));
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

// ---------- Halloween's costumes (RFC 0022) ----------

const H = HALLOWEEN_HEX;

/**
 * A witch hat: a tall felt cone whose tip bends over, on a wide brim. `lean` is which way the tip
 * bends: away from the way they face, so in profile it trails behind.
 */
function witchHatPath(ctx: CanvasRenderingContext2D, u: number, lean: number) {
  const x = (f: number) => f * lean * u;
  const y = (f: number) => f * u;
  ctx.beginPath();
  ctx.ellipse(0, y(HAT_TOP + 0.1), 0.34 * u, 0.075 * u, 0, 0, Math.PI * 2);
  ctx.moveTo(x(-0.16), y(-0.775));
  ctx.bezierCurveTo(x(-0.12), y(-0.88), x(-0.06), y(-0.96), x(0), y(-1.0));
  ctx.quadraticCurveTo(x(0.07), y(-1.05), x(0.18), y(-1.03));
  ctx.quadraticCurveTo(x(0.08), y(-0.99), x(0.06), y(-0.94));
  ctx.bezierCurveTo(x(0.08), y(-0.87), x(0.12), y(-0.82), x(0.16), y(-0.775));
  ctx.closePath();
}

function drawWitchHat(
  ctx: CanvasRenderingContext2D,
  u: number,
  side: number,
  back: boolean,
  g: Garb,
) {
  const lean = side ? -side : back ? -1 : 1;
  const felt = g.color(H.witch);
  paintCloth(ctx, u, () => witchHatPath(ctx, u, lean), felt, g.fill());
  ctx.strokeStyle = g.trim(mix(H.witch, INK, 0.4));
  ctx.lineWidth = Math.max(0.8, 0.015 * u);
  witchHatPath(ctx, u, lean);
  ctx.stroke();
  // A band round the base of the cone, and a buckle at the front.
  ctx.fillStyle = H.witchBand;
  ctx.beginPath();
  ctx.moveTo(-0.158 * u, -0.79 * u);
  ctx.lineTo(0.158 * u, -0.79 * u);
  ctx.lineTo(0.146 * u, -0.84 * u);
  ctx.lineTo(-0.146 * u, -0.84 * u);
  ctx.closePath();
  ctx.fill();
  if (!back) {
    ctx.strokeStyle = H.buckle;
    ctx.lineWidth = Math.max(0.8, 0.014 * u);
    ctx.strokeRect((side * 0.06 - 0.03) * u, -0.836 * u, 0.06 * u, 0.042 * u);
  }
  ctx.fillStyle = "rgba(255, 255, 255, 0.14)";
  ctx.beginPath();
  ctx.moveTo(-0.1 * lean * u, -0.84 * u);
  ctx.quadraticCurveTo(-0.07 * lean * u, -0.92 * u, -0.02 * lean * u, -0.97 * u);
  ctx.lineTo(-0.05 * lean * u, -0.86 * u);
  ctx.closePath();
  ctx.fill();
}

/** A point on a circle around the head's middle: `a` radians from straight up, clockwise. */
const onHead = (a: number, r: number): [number, number] => [
  r * Math.sin(a),
  HEAD_Y - r * Math.cos(a),
];

/** One cat ear standing at angle `a` on the head: two corners on the head and a soft tip. */
function earPath(ctx: CanvasRenderingContext2D, u: number, a: number, size: number) {
  const [ax, ay] = onHead(a - 0.36 * size, HEAD_R * 0.98);
  const [bx, by] = onHead(a + 0.36 * size, HEAD_R * 0.98);
  const [tx, ty] = onHead(a * 1.12, HEAD_R + 0.13 * size);
  ctx.beginPath();
  ctx.moveTo(ax * u, ay * u);
  ctx.quadraticCurveTo(((ax + tx) / 2) * u, ((ay + ty) / 2 - 0.02) * u, tx * u, ty * u);
  ctx.quadraticCurveTo(((bx + tx) / 2) * u, ((by + ty) / 2 - 0.02) * u, bx * u, by * u);
  ctx.closePath();
}

/**
 * Cat ears on a headband: two pointed ears with pink insides, which hide no hair. In profile both
 * ears show toward the back of the head, the far one darker; from the back, no pink.
 */
function drawCatEars(
  ctx: CanvasRenderingContext2D,
  u: number,
  side: number,
  back: boolean,
  g: Garb,
) {
  const fur = g.color(H.catEars);
  ctx.strokeStyle = fur;
  ctx.lineWidth = Math.max(1, 0.035 * u);
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.arc(0, HEAD_Y * u, HEAD_R * 1.02 * u, Math.PI + 0.55, Math.PI * 2 - 0.55);
  ctx.stroke();
  // Far ear first. Sideways the ears sit toward the back of the head.
  const ears = side
    ? [
        { a: -side * 0.62, far: true },
        { a: -side * 0.12, far: false },
      ]
    : [
        { a: -0.55, far: false },
        { a: 0.55, far: false },
      ];
  for (const { a, far } of ears) {
    paintCloth(ctx, u, () => earPath(ctx, u, a, 1), far ? mix(fur, INK, 0.25) : fur, g.fill());
    if (back || far) continue;
    ctx.fillStyle = H.catInner;
    earPath(ctx, u, a, 0.55);
    ctx.fill();
  }
}

/** A pumpkin's three lobes, centered where the head would be and a little bigger than it. */
const PUMPKIN = { y: HEAD_Y + 0.005, rx: 0.155, ry: 0.225, lobe: 0.105 };

/** The pumpkin's outline: its three lobes as one path, for the rim. */
function pumpkinPath(ctx: CanvasRenderingContext2D, u: number, side: number) {
  const { y, rx, ry, lobe } = PUMPKIN;
  const turn = side * 0.02;
  ctx.beginPath();
  for (const dx of [-lobe, lobe, 0]) {
    const x = (dx + turn) * u;
    ctx.moveTo(x + rx * u, y * u);
    ctx.ellipse(x, y * u, rx * u, (dx === 0 ? ry : ry * 0.94) * u, 0, 0, Math.PI * 2);
  }
}

/**
 * A pumpkin worn as a head: three lobes with ribs between them, a curled stem, and a carved face
 * lit from inside. Sideways the face slides toward the way they face; from the back there's none.
 */
function drawPumpkinHead(
  ctx: CanvasRenderingContext2D,
  u: number,
  side: number,
  back: boolean,
  g: Garb,
) {
  const { y, rx, ry, lobe } = PUMPKIN;
  const skin = g.color(H.pumpkin);
  const rib = g.trim(H.pumpkinRib);
  const turn = side * 0.02;
  // The stem first, so the lobes cover its foot.
  ctx.fillStyle = H.pumpkinStem;
  ctx.beginPath();
  ctx.roundRect((turn - 0.025) * u, (y - ry - 0.06) * u, 0.05 * u, 0.09 * u, 0.02 * u);
  ctx.fill();
  ctx.strokeStyle = rib;
  ctx.lineWidth = Math.max(0.8, 0.016 * u);
  for (const dx of [-lobe, lobe, 0]) {
    const lobePath = () => {
      ctx.beginPath();
      ctx.ellipse(
        (dx + turn) * u,
        y * u,
        rx * u,
        (dx === 0 ? ry : ry * 0.94) * u,
        0,
        0,
        Math.PI * 2,
      );
    };
    paintCloth(ctx, u, lobePath, skin, g.fill());
    lobePath();
    ctx.stroke();
  }
  // A highlight on the front lobe.
  ctx.fillStyle = "rgba(255, 255, 255, 0.28)";
  ctx.beginPath();
  ctx.ellipse((turn - 0.06) * u, (y - 0.12) * u, 0.05 * u, 0.025 * u, -0.5, 0, Math.PI * 2);
  ctx.fill();
  if (back) return;
  // The carved face, lit from inside.
  const fx = (f: number) => (turn + side * 0.07 + f) * u;
  const fy = (f: number) => (y + f) * u;
  ctx.fillStyle = H.lit;
  ctx.strokeStyle = H.carved;
  ctx.lineWidth = Math.max(0.6, 0.01 * u);
  ctx.beginPath();
  const eyes = side ? [side * 0.035] : [-0.075, 0.075];
  for (const ex of eyes) {
    ctx.moveTo(fx(ex - 0.042), fy(-0.025));
    ctx.lineTo(fx(ex), fy(-0.095));
    ctx.lineTo(fx(ex + 0.042), fy(-0.025));
    ctx.closePath();
  }
  // The grin, with two teeth.
  const half = side ? 0.07 : 0.115;
  const mid = side ? side * 0.03 : 0;
  ctx.moveTo(fx(mid - half), fy(0.04));
  ctx.quadraticCurveTo(fx(mid), fy(0.15), fx(mid + half), fy(0.04));
  ctx.lineTo(fx(mid + half * 0.45), fy(0.065));
  ctx.lineTo(fx(mid + half * 0.3), fy(0.04 + 0.04));
  ctx.lineTo(fx(mid - half * 0.3), fy(0.065));
  ctx.lineTo(fx(mid - half * 0.45), fy(0.04 + 0.04));
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
}

/**
 * A ghost sheet over the head and body: a dome where the head is, falling to a wavy hem just above
 * the feet. Its face is drawn on it, so a ghost still smiles and blinks.
 */
function ghostPath(ctx: CanvasRenderingContext2D, u: number, side: number) {
  const r = HEAD_R + 0.025;
  const sway = side * 0.025;
  ctx.beginPath();
  ctx.arc(0, HEAD_Y * u, r * u, Math.PI, 0);
  ctx.bezierCurveTo(
    0.26 * u,
    -0.48 * u,
    (0.34 + sway) * u,
    -0.32 * u,
    (0.35 - sway) * u,
    -0.05 * u,
  );
  // A wavy hem, four scallops wide.
  const hem = 4;
  const from = 0.35 - sway;
  const to = -0.35 - sway;
  for (let i = 0; i < hem; i++) {
    const a = from + ((to - from) * i) / hem;
    const b = from + ((to - from) * (i + 1)) / hem;
    ctx.quadraticCurveTo(((a + b) / 2) * u, 0.035 * u, b * u, -0.05 * u);
  }
  ctx.bezierCurveTo((-0.34 + sway) * u, -0.32 * u, -0.26 * u, -0.48 * u, -r * u, HEAD_Y * u);
  ctx.closePath();
}

function drawGhostSheet(
  ctx: CanvasRenderingContext2D,
  u: number,
  side: number,
  back: boolean,
  g: Garb,
) {
  const white = g.color(H.sheet);
  paintCloth(ctx, u, () => ghostPath(ctx, u, side), white, g.fill());
  ctx.save();
  ghostPath(ctx, u, side);
  ctx.clip();
  // Folds falling from the shoulders, and a shade along the hem so it hangs.
  ctx.strokeStyle = g.trim(H.sheetShade);
  ctx.lineWidth = Math.max(1, 0.03 * u);
  ctx.lineCap = "round";
  ctx.beginPath();
  for (const x of side || back ? [-0.08 * (side || 1), 0.16 * (side || 1)] : [-0.15, 0.15]) {
    ctx.moveTo(x * u, -0.42 * u);
    ctx.quadraticCurveTo((x * 1.18 + 0.01) * u, -0.24 * u, x * 1.05 * u, -0.07 * u);
  }
  ctx.stroke();
  ctx.fillStyle = "rgba(70, 40, 18, 0.1)";
  ctx.fillRect(-0.5 * u, -0.1 * u, u, 0.14 * u);
  ctx.restore();
  ctx.strokeStyle = g.trim(mix(H.sheetShade, INK, 0.25));
  ctx.lineWidth = Math.max(0.8, 0.012 * u);
  ghostPath(ctx, u, side);
  ctx.stroke();
}

/** Where each of a wing's ribs ends, from the shoulder out to a scallop's point. */
const WING_RIBS = [3, 5, 7, 9] as const;

/**
 * Which wings show and how: both spread from the shoulders from the front and the back, and in
 * profile one, trailing behind, a little narrower. `out` is which side each spreads to.
 */
function wingSet(side: number): { out: number; squeeze: number; dx: number }[] {
  if (side) return [{ out: -side, squeeze: 0.8, dx: -side * 0.06 }];
  return [
    { out: -1, squeeze: 1, dx: 0 },
    { out: 1, squeeze: 1, dx: 0 },
  ];
}

function wingPoint(
  [x, y]: readonly [number, number],
  w: { out: number; squeeze: number; dx: number },
  u: number,
): [number, number] {
  return [(-x * w.out * w.squeeze + w.dx) * u, y * u];
}

function batWingsPath(ctx: CanvasRenderingContext2D, u: number, side: number, _back: boolean) {
  ctx.beginPath();
  for (const w of wingSet(side)) {
    for (const [i, point] of BAT_WING.entries()) {
      const [x, y] = wingPoint(point, w, u);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
  }
}

/** Bat wings: scalloped and ribbed, spread from the shoulders. */
function drawBatWings(
  ctx: CanvasRenderingContext2D,
  u: number,
  side: number,
  back: boolean,
  g: Garb,
) {
  const skin = g.color(H.bat);
  paintCloth(ctx, u, () => batWingsPath(ctx, u, side, back), skin, g.fill());
  ctx.strokeStyle = g.trim(H.batInner);
  ctx.lineWidth = Math.max(0.8, 0.014 * u);
  ctx.lineCap = "round";
  ctx.beginPath();
  for (const w of wingSet(side)) {
    const [sx, sy] = wingPoint(BAT_WING[0] as readonly [number, number], w, u);
    for (const rib of WING_RIBS) {
      const [x, y] = wingPoint(BAT_WING[rib] as readonly [number, number], w, u);
      ctx.moveTo(sx, sy);
      ctx.lineTo(x, y);
    }
  }
  ctx.stroke();
  ctx.strokeStyle = mix(skin, INK, 0.35);
  ctx.lineWidth = Math.max(0.8, 0.012 * u);
  batWingsPath(ctx, u, side, back);
  ctx.stroke();
}

// ---------- hair ----------
// Hair is drawn in two layers: what hangs behind the head and body (a bob's back, a ponytail, an
// afro's puff) before the body, and what sits on the head (the crown, the fringe, braids) after the
// face. A hat drawn after both hides the hair above its band, so longer styles show below it.

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

/** The color of the bands that tie a ponytail, pigtails, or braids: the outfit's accent. */
export const hairTieColor = (p: ThemePalette): string => (paleAccent(p) ? p.deep : p.accent);

/**
 * Hats that cover the crown: the height of their band (`line`) and how far out from the middle
 * they reach (`half`), both in tiles. Hair above the band and inside that reach is under the hat.
 * A flower crown and a halo cover nothing.
 */
const HAT_COVER: Partial<Record<WearItem, { line: number; half: number }>> = {
  straw_hat: { line: -0.77, half: 0.33 },
  beret: { line: -0.79, half: 0.22 },
  beanie: { line: -0.7, half: 0.235 },
  top_hat: { line: -0.82, half: 0.27 },
  witch_hat: { line: -0.78, half: 0.34 },
};

/** The hat worn that covers the crown, if any. */
const coveringHat = (wear: ReadonlySet<WearItem>) =>
  [...wear].find((w) => Object.hasOwn(HAT_COVER, w));

/** Which way the figure faces, and the hat over the hair. */
interface HairView {
  side: number;
  back: boolean;
  hat: WearItem | undefined;
}

/** Draws in tiles from the feet, mirrored for a figure facing west. */
interface Pen {
  move(x: number, y: number): void;
  line(x: number, y: number): void;
  quad(cx: number, cy: number, x: number, y: number): void;
  arc(x: number, y: number, r: number, from: number, to: number, ccw?: boolean): void;
  /** An oval as a path of its own. */
  oval(x: number, y: number, rx: number, ry: number): void;
}

function pen(ctx: CanvasRenderingContext2D, u: number, m: number): Pen {
  return {
    move: (x, y) => ctx.moveTo(x * m * u, y * u),
    line: (x, y) => ctx.lineTo(x * m * u, y * u),
    quad: (cx, cy, x, y) => ctx.quadraticCurveTo(cx * m * u, cy * u, x * m * u, y * u),
    // Mirroring turns an angle a into pi - a, and runs the arc the other way.
    arc: (x, y, r, from, to, ccw = false) =>
      m > 0
        ? ctx.arc(x * u, y * u, r * u, from, to, ccw)
        : ctx.arc(-x * u, y * u, r * u, Math.PI - from, Math.PI - to, !ccw),
    oval: (x, y, rx, ry) => {
      ctx.moveTo((x * m + rx) * u, y * u);
      ctx.ellipse(x * m * u, y * u, rx * u, ry * u, 0, 0, Math.PI * 2);
    },
  };
}

/** One closed piece of hair, drawn with a pen. */
type Lock = (k: Pen) => void;

interface HairParts {
  /** Behind the head and body. */
  behind: Lock[];
  /** On the head, and from behind, down the back. */
  over: Lock[];
  /**
   * The only edge of `over` to line, when the rest of it sits inside the hair behind (an afro's
   * hairline). Otherwise every outer edge is lined.
   */
  hairline?: Lock;
  /** Lines drawn on the hair: a part, the plaits of a braid. */
  marks?: Lock;
  /** Where a tail or braid is tied, in tiles. */
  ties?: readonly (readonly [number, number])[];
  /** Pieces on top of the rest, each with an outline of its own: a bun seen from behind. */
  knots?: Lock[];
}

/** The crown's dome: a little wider than the head (radius 0.21 at y -0.66), and a little higher. */
const DOME = { y: -0.665, r: 0.232 };

/** Curls: overlapping circles around an arc of the head, over a crown that fills the middle. */
function curls(k: Pen, from: number, to: number, count: number, r: number) {
  for (let i = 0; i < count; i++) {
    const a = from + ((to - from) * i) / (count - 1);
    const end = i === 0 || i === count - 1;
    const cr = end ? r * 0.8 : r;
    k.oval(Math.cos(a) * 0.205, -0.67 + Math.sin(a) * 0.205, cr, cr);
  }
}

/** Spikes standing up from the crown, `lean` turning them toward the back of the head. */
function spikes(k: Pen, angles: readonly number[], lean = 0) {
  for (const a of angles) {
    const at = (angle: number, r: number) =>
      [Math.cos(angle) * r, DOME.y + Math.sin(angle) * r] as const;
    k.move(...at(a - 0.2, 0.2));
    k.line(...at(a + lean, 0.335));
    k.line(...at(a + 0.2, 0.2));
  }
}

/** An afro's puff, centered at `x`: a round of curls with a full middle. */
function puff(k: Pen, x: number) {
  k.oval(x, -0.7, 0.26, 0.26);
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    k.oval(x + Math.cos(a) * 0.235, -0.7 + Math.sin(a) * 0.235, 0.068, 0.068);
  }
}

/** A braid hanging from (x, y): plaits down to `end`, then a tuft under the tie. */
function braid(k: Pen, x: number, y: number, end: number) {
  const n = 4;
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    k.oval(x - 0.008 * t, y + (end - y) * t, 0.042, 0.046);
  }
  k.oval(x - 0.01, end + 0.075, 0.03, 0.04);
}

/** The lines between a braid's plaits. */
function plaits(k: Pen, x: number, y: number, end: number) {
  const n = 4;
  for (let i = 0; i < n - 1; i++) {
    const t = (i + 0.5) / (n - 1);
    const cx = x - 0.008 * t;
    const cy = y + (end - y) * t;
    k.move(cx - 0.035, cy - 0.012);
    k.quad(cx, cy + 0.02, cx + 0.035, cy - 0.012);
  }
}

// Crowns from the front. Each runs over the head from its left side to its right, then back along
// the hairline across the face.

/** Short: a side-swept fringe and short sideburns. */
const frontShort: Lock = (k) => {
  k.arc(0, DOME.y, DOME.r, Math.PI - 0.22, 0.22);
  k.line(0.19, -0.6);
  k.quad(0.205, -0.72, 0.12, -0.78);
  k.quad(0, -0.775, -0.13, -0.712);
  k.quad(-0.185, -0.69, -0.19, -0.6);
};

/** A center part: the hair falls away from it to each side of the face, down to `low`. */
const frontParted =
  (low: number): Lock =>
  (k) => {
    const a = Math.asin(Math.min(1, (low - DOME.y) / DOME.r));
    k.arc(0, DOME.y, DOME.r, Math.PI - a, a);
    k.line(0.185, low + 0.01);
    k.quad(0.19, -0.74, 0.025, -0.79);
    k.line(0, -0.77);
    k.line(-0.025, -0.79);
    k.quad(-0.19, -0.74, -0.185, low + 0.01);
  };

/** Pulled back from the face, for a bun or a ponytail. */
const frontPulled: Lock = (k) => {
  k.arc(0, DOME.y, DOME.r, Math.PI - 0.12, 0.12);
  k.line(0.2, -0.63);
  k.quad(0.19, -0.785, 0, -0.795);
  k.quad(-0.19, -0.785, -0.2, -0.63);
};

/** A bob: a blunt fringe, and sides down to the jaw. */
const frontBob: Lock = (k) => {
  k.move(-0.21, -0.462);
  k.quad(-0.252, -0.462, -0.252, -0.5);
  k.line(-0.255, -0.64);
  k.quad(-0.26, -0.905, 0, -0.905);
  k.quad(0.26, -0.905, 0.255, -0.64);
  k.line(0.252, -0.5);
  k.quad(0.252, -0.462, 0.21, -0.462);
  k.line(0.17, -0.47);
  k.quad(0.185, -0.62, 0.165, -0.725);
  k.line(-0.165, -0.725);
  k.quad(-0.185, -0.62, -0.17, -0.47);
};

/** Long hair: parted, falling past the face to curl at the shoulders. */
const frontLong: Lock = (k) => {
  k.move(0.17, -0.47);
  k.quad(0.2, -0.62, 0.16, -0.72);
  k.quad(0.1, -0.78, 0.025, -0.79);
  k.line(0, -0.77);
  k.line(-0.025, -0.79);
  k.quad(-0.1, -0.78, -0.16, -0.72);
  k.quad(-0.2, -0.62, -0.17, -0.47);
  k.quad(-0.22, -0.43, -0.27, -0.455);
  k.quad(-0.255, -0.56, -0.25, -0.665);
  k.arc(0, -0.665, 0.25, Math.PI, 0);
  k.quad(0.255, -0.56, 0.27, -0.455);
  k.quad(0.22, -0.43, 0.17, -0.47);
};

/** An afro's soft round hairline, from the right temple to the left. */
function afroFringe(k: Pen) {
  k.quad(0.19, -0.775, 0, -0.78);
  k.quad(-0.19, -0.775, -0.205, -0.64);
}

/** The afro's crown over the forehead. It sits inside the puff, so only its hairline is lined. */
const frontAfro: Lock = (k) => {
  k.arc(0, DOME.y, DOME.r, Math.PI - 0.1, 0.1);
  k.line(0.205, -0.64);
  afroFringe(k);
};

const frontAfroHairline: Lock = (k) => {
  k.move(0.205, -0.64);
  afroFringe(k);
};

/** Spiky: a zigzag fringe under the spikes. */
const frontSpikyCrown: Lock = (k) => {
  k.arc(0, DOME.y, DOME.r, Math.PI - 0.2, 0.2);
  k.line(0.195, -0.62);
  k.line(0.19, -0.7);
  k.line(0.15, -0.71);
  k.line(0.12, -0.775);
  k.line(0.06, -0.715);
  k.line(0.02, -0.775);
  k.line(-0.03, -0.72);
  k.line(-0.07, -0.775);
  k.line(-0.12, -0.715);
  k.line(-0.16, -0.765);
  k.line(-0.19, -0.7);
  k.line(-0.195, -0.62);
};

/** A pigtail standing out from the side of the head, toward `s` (-1 left, 1 right). */
const pigtail =
  (s: number): Lock =>
  (k) => {
    k.move(0.14 * s, -0.83);
    k.quad(0.37 * s, -0.88, 0.385 * s, -0.69);
    k.quad(0.39 * s, -0.56, 0.33 * s, -0.49);
    k.quad(0.33 * s, -0.63, 0.19 * s, -0.72);
  };

// Crowns in profile, facing east (the pen mirrors them for west). Each runs from the fringe at
// the front over the top and down the back of the head, then back along the hairline.

/** The front of the crown, from the fringe's tip up and over to the top. */
function profileTop(k: Pen, tip: readonly [number, number], back: number) {
  k.move(...tip);
  k.quad(tip[0] - 0.015, -0.86, 0.05, -0.895);
  k.arc(0, DOME.y, DOME.r, -1.35, back, true);
}

/** Short in profile: down the back to the nape, the ear clear, the fringe forward. */
const sideShort: Lock = (k) => {
  profileTop(k, [0.215, -0.755], Math.PI - 0.6);
  k.quad(-0.12, -0.52, -0.075, -0.56);
  k.quad(-0.02, -0.62, -0.03, -0.69);
  k.quad(0.02, -0.745, 0.13, -0.735);
  k.quad(0.19, -0.73, 0.215, -0.755);
};

/** Hair pulled back in profile: from behind the ear up past the temple to the forehead. */
function pulledHairline(k: Pen) {
  k.quad(-0.02, -0.62, -0.03, -0.69);
  k.quad(0.06, -0.775, 0.17, -0.8);
}

/** Pulled back in profile, for a bun, a ponytail, braids, pigtails, or under an afro's puff. */
const sidePulled: Lock = (k) => {
  profileTop(k, [0.17, -0.8], Math.PI - 0.6);
  k.quad(-0.12, -0.52, -0.075, -0.56);
  pulledHairline(k);
};

/** A bob in profile: down to the jaw, with its front edge just behind the cheek. */
const sideBob: Lock = (k) => {
  profileTop(k, [0.215, -0.75], Math.PI - 0.12);
  k.line(-0.255, -0.5);
  k.quad(-0.255, -0.46, -0.205, -0.46);
  k.line(-0.06, -0.47);
  k.quad(-0.025, -0.475, -0.03, -0.52);
  k.quad(-0.055, -0.62, -0.015, -0.7);
  k.quad(0.06, -0.745, 0.15, -0.735);
  k.quad(0.2, -0.73, 0.215, -0.75);
};

/** Long hair in profile: down the back, past the shoulders. */
const sideLong: Lock = (k) => {
  profileTop(k, [0.215, -0.75], Math.PI - 0.12);
  k.quad(-0.29, -0.5, -0.275, -0.37);
  k.quad(-0.25, -0.33, -0.2, -0.345);
  k.quad(-0.15, -0.42, -0.12, -0.52);
  k.quad(-0.06, -0.56, -0.035, -0.6);
  k.quad(-0.045, -0.66, -0.015, -0.7);
  k.quad(0.06, -0.745, 0.15, -0.735);
  k.quad(0.2, -0.73, 0.215, -0.75);
};

const sideAfroHairline: Lock = (k) => {
  k.move(-0.075, -0.56);
  pulledHairline(k);
};

const sideSpikyCrown: Lock = (k) => {
  profileTop(k, [0.2, -0.76], Math.PI - 0.6);
  k.quad(-0.12, -0.52, -0.075, -0.56);
  k.quad(-0.02, -0.62, -0.03, -0.69);
  k.line(0.03, -0.73);
  k.line(0.08, -0.715);
  k.line(0.12, -0.75);
  k.line(0.2, -0.76);
};

// From behind, the hair covers the head down to the nape.

/** The back of the head down to `nape`, dipping a little at the middle. */
const backCap =
  (nape: number): Lock =>
  (k) => {
    const a = Math.asin(Math.min(1, (nape - DOME.y) / DOME.r));
    k.arc(0, DOME.y, DOME.r, Math.PI - a, a);
    k.quad(0, nape + 0.035, -Math.cos(a) * DOME.r, nape);
  };

const backBob: Lock = (k) => {
  k.move(-0.25, -0.47);
  k.line(-0.255, -0.64);
  k.quad(-0.26, -0.905, 0, -0.905);
  k.quad(0.26, -0.905, 0.255, -0.64);
  k.line(0.25, -0.47);
  k.quad(0, -0.445, -0.25, -0.47);
};

const backLong: Lock = (k) => {
  k.move(-0.235, -0.35);
  k.quad(-0.27, -0.5, -0.255, -0.64);
  k.quad(-0.26, -0.905, 0, -0.905);
  k.quad(0.26, -0.905, 0.255, -0.64);
  k.quad(0.27, -0.5, 0.235, -0.35);
  k.quad(0.12, -0.3, 0, -0.33);
  k.quad(-0.12, -0.3, -0.235, -0.35);
};

/** A ponytail hanging down the back of the head from its tie. */
const backTail: Lock = (k) => {
  k.move(0, -0.8);
  k.quad(0.15, -0.72, 0.1, -0.5);
  k.quad(0.075, -0.4, 0.02, -0.38);
  k.quad(-0.03, -0.37, -0.06, -0.42);
  k.quad(-0.12, -0.52, -0.1, -0.62);
  k.quad(-0.08, -0.74, 0, -0.8);
};

/** The part from the forehead up over the crown. */
const partFront: Lock = (k) => {
  k.move(0, -0.775);
  k.line(0, -0.86);
};

/**
 * The parts each style is drawn with, facing `side` (0 front or back, 1 east, -1 west). Under a
 * hat that covers the crown (`hatted`), a bun's knot is tucked away.
 */
function hairParts(style: HairStyle, side: number, back: boolean, hatted: boolean): HairParts {
  if (back) {
    switch (style) {
      case "short":
        return { behind: [], over: [backCap(-0.535)] };
      case "bob":
        return { behind: [], over: [backBob] };
      case "long":
        return { behind: [], over: [backLong] };
      case "curly":
        return {
          behind: [],
          over: [(k) => curls(k, Math.PI - 0.45, Math.PI * 2 + 0.45, 11, 0.07), backCap(-0.55)],
        };
      case "bun":
        return {
          behind: [],
          over: [backCap(-0.55)],
          knots: hatted ? [] : [(k) => k.oval(0, -0.8, 0.1, 0.095)],
        };
      case "ponytail":
        return { behind: [], over: [backCap(-0.55), backTail], ties: [[0, -0.79]] };
      case "braids":
        return {
          behind: [],
          over: [
            backCap(-0.55),
            (k) => braid(k, 0.1, -0.56, -0.33),
            (k) => braid(k, -0.1, -0.56, -0.33),
          ],
          marks: (k) => {
            k.move(0, -0.88);
            k.line(0, -0.56);
            plaits(k, 0.1, -0.56, -0.33);
            plaits(k, -0.1, -0.56, -0.33);
          },
          ties: [
            [0.092, -0.29],
            [-0.108, -0.29],
          ],
        };
      case "spiky":
        return {
          behind: [],
          over: [backCap(-0.535), (k) => spikes(k, [-2.47, -2.03, -1.57, -1.11, -0.67])],
        };
      case "afro":
        return { behind: [], over: [(k) => puff(k, 0)] };
      case "pigtails":
        return {
          behind: [],
          over: [backCap(-0.55), pigtail(-1), pigtail(1)],
          marks: (k) => {
            k.move(0, -0.88);
            k.line(0, -0.56);
          },
          ties: [
            [-0.215, -0.775],
            [0.215, -0.775],
          ],
        };
    }
  }
  if (side) {
    switch (style) {
      case "short":
        return { behind: [], over: [sideShort] };
      case "bob":
        return { behind: [], over: [sideBob] };
      case "long":
        return { behind: [], over: [sideLong] };
      case "curly":
        return {
          behind: [],
          over: [
            (k) => curls(k, Math.PI * 2 - 1.15, Math.PI - 0.5, 9, 0.07),
            sideShort,
            (k) => {
              k.oval(0.13, -0.765, 0.05, 0.05);
              k.oval(0.06, -0.79, 0.05, 0.05);
            },
          ],
        };
      case "bun":
        if (hatted) return { behind: [], over: [sidePulled] };
        return {
          behind: [],
          over: [(k) => k.oval(-0.15, -0.85, 0.09, 0.09), sidePulled],
          marks: (k) => {
            k.move(-0.2, -0.79);
            k.quad(-0.13, -0.77, -0.09, -0.82);
          },
        };
      case "ponytail":
        return {
          behind: [
            (k) => {
              k.move(-0.15, -0.83);
              k.quad(-0.38, -0.86, -0.37, -0.66);
              k.quad(-0.36, -0.52, -0.3, -0.44);
              k.quad(-0.3, -0.58, -0.2, -0.7);
            },
          ],
          over: [sidePulled],
          ties: [[-0.215, -0.785]],
        };
      case "braids":
        return {
          behind: [],
          over: [sidePulled, (k) => braid(k, -0.06, -0.54, -0.31)],
          marks: (k) => plaits(k, -0.06, -0.54, -0.31),
          ties: [[-0.068, -0.27]],
        };
      case "spiky":
        return {
          behind: [],
          over: [sideSpikyCrown, (k) => spikes(k, [-1.35, -1.8, -2.25, -2.65], -0.15)],
        };
      case "afro":
        return {
          behind: [(k) => puff(k, -0.045)],
          over: [sidePulled],
          hairline: sideAfroHairline,
        };
      case "pigtails":
        return {
          behind: [
            (k) => {
              k.move(-0.12, -0.84);
              k.quad(-0.33, -0.88, -0.34, -0.7);
              k.quad(-0.34, -0.6, -0.3, -0.55);
              k.quad(-0.28, -0.66, -0.17, -0.74);
            },
          ],
          over: [
            sidePulled,
            (k) => {
              k.move(-0.06, -0.8);
              k.quad(-0.17, -0.74, -0.15, -0.6);
              k.quad(-0.14, -0.52, -0.1, -0.47);
              k.quad(-0.09, -0.6, -0.02, -0.71);
            },
          ],
          ties: [[-0.07, -0.775]],
        };
    }
  }
  switch (style) {
    case "short":
      return { behind: [], over: [frontShort] };
    case "bob":
      return {
        behind: [
          (k) => {
            k.move(-0.25, -0.47);
            k.line(-0.255, -0.64);
            k.quad(-0.26, -0.9, 0, -0.9);
            k.quad(0.26, -0.9, 0.255, -0.64);
            k.line(0.25, -0.47);
            k.quad(0, -0.455, -0.25, -0.47);
          },
        ],
        over: [frontBob],
      };
    case "long":
      return {
        behind: [
          (k) => {
            k.move(-0.27, -0.34);
            k.quad(-0.31, -0.5, -0.255, -0.665);
            k.arc(0, -0.665, 0.255, Math.PI, 0);
            k.quad(0.31, -0.5, 0.27, -0.34);
            k.quad(0, -0.3, -0.27, -0.34);
          },
        ],
        over: [frontLong],
      };
    case "curly":
      return {
        behind: [],
        over: [
          (k) => curls(k, Math.PI - 0.3, Math.PI * 2 + 0.3, 11, 0.068),
          frontParted(-0.6),
          (k) => {
            for (const x of [-0.12, -0.04, 0.04, 0.12]) k.oval(x, -0.755, 0.052, 0.05);
          },
        ],
      };
    case "bun":
      return {
        behind: hatted ? [] : [(k) => k.oval(0, -0.915, 0.088, 0.085)],
        over: [frontPulled],
      };
    case "ponytail":
      return {
        behind: [
          (k) => {
            k.move(-0.12, -0.85);
            k.quad(-0.34, -0.88, -0.345, -0.68);
            k.quad(-0.35, -0.54, -0.29, -0.45);
            k.quad(-0.3, -0.6, -0.19, -0.72);
          },
        ],
        over: [frontPulled],
        ties: [[-0.225, -0.795]],
      };
    case "braids":
      return {
        behind: [],
        over: [
          frontParted(-0.6),
          (k) => braid(k, 0.205, -0.56, -0.33),
          (k) => braid(k, -0.205, -0.56, -0.33),
        ],
        marks: (k) => {
          partFront(k);
          plaits(k, 0.205, -0.56, -0.33);
          plaits(k, -0.205, -0.56, -0.33);
        },
        ties: [
          [0.197, -0.29],
          [-0.213, -0.29],
        ],
      };
    case "spiky":
      return {
        behind: [],
        over: [frontSpikyCrown, (k) => spikes(k, [-2.47, -2.03, -1.57, -1.11, -0.67])],
      };
    case "afro":
      return { behind: [(k) => puff(k, 0)], over: [frontAfro], hairline: frontAfroHairline };
    case "pigtails":
      return {
        behind: [pigtail(-1), pigtail(1)],
        over: [frontParted(-0.6)],
        marks: partFront,
        ties: [
          [-0.215, -0.775],
          [0.215, -0.775],
        ],
      };
  }
}

/** Keep what follows to where a covering hat doesn't reach: below its band, or out past it. */
function underHat(ctx: CanvasRenderingContext2D, u: number, hat: WearItem | undefined) {
  const cover = hat ? HAT_COVER[hat] : undefined;
  if (!cover) return;
  ctx.beginPath();
  ctx.rect(-u, cover.line * u, 2 * u, 2 * u);
  ctx.rect(-u, -2 * u, (1 - cover.half) * u, 3 * u);
  ctx.rect(cover.half * u, -2 * u, (1 - cover.half) * u, 3 * u);
  ctx.clip();
}

/** Trace each lock as its own path and `then` it. */
function eachLock(
  ctx: CanvasRenderingContext2D,
  u: number,
  m: number,
  locks: readonly Lock[],
  then: () => void,
) {
  const k = pen(ctx, u, m);
  for (const lock of locks) {
    ctx.beginPath();
    lock(k);
    ctx.closePath();
    then();
  }
}

/** The hair's part of the white rim, in the stroke the caller set, so it reads on any ground. */
function rimHair(ctx: CanvasRenderingContext2D, u: number, style: HairStyle, view: HairView) {
  const parts = hairParts(style, view.side, view.back, view.hat !== undefined);
  ctx.save();
  underHat(ctx, u, view.hat);
  const locks = [...parts.behind, ...parts.over, ...(parts.knots ?? [])];
  eachLock(ctx, u, view.side || 1, locks, () => ctx.stroke());
  ctx.restore();
}

/**
 * One layer of hair: lined in a darker shade, then filled, so the pieces of a style read as one
 * shape with one outline. On top of the crown go a sheen, the part or plaits, and the ties.
 */
function drawHair(
  ctx: CanvasRenderingContext2D,
  u: number,
  hair: { style: HairStyle; hex: string },
  layer: "behind" | "over",
  view: HairView,
  p: ThemePalette,
) {
  const parts = hairParts(hair.style, view.side, view.back, view.hat !== undefined);
  const locks = parts[layer];
  if (locks.length === 0) return;
  const m = view.side || 1;
  const edge = mix(hair.hex, INK, 0.45);
  // Lines on the hair itself (a part, plaits, a bun's edge) show lighter on very dark hair.
  const mark = luminance(hair.hex) < 0.05 ? mix(hair.hex, PAPER, 0.3) : edge;
  ctx.save();
  underHat(ctx, u, view.hat);
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.strokeStyle = edge;
  ctx.lineWidth = Math.max(1, 0.035 * u);
  if (layer === "over" && parts.hairline) {
    ctx.beginPath();
    parts.hairline(pen(ctx, u, m));
    ctx.stroke();
  } else {
    eachLock(ctx, u, m, locks, () => ctx.stroke());
  }
  ctx.fillStyle = hair.hex;
  eachLock(ctx, u, m, locks, () => ctx.fill());
  if (layer === "over") {
    // A soft shine across the crown, toward the light.
    ctx.strokeStyle = "rgba(255, 255, 255, 0.32)";
    ctx.lineWidth = Math.max(1, 0.028 * u);
    ctx.beginPath();
    if (view.side) pen(ctx, u, m).arc(0, -0.67, 0.165, Math.PI + 0.55, Math.PI + 1.05);
    else ctx.arc(-0.01 * u, -0.67 * u, 0.165 * u, Math.PI + 0.75, Math.PI + 1.25);
    ctx.stroke();
    if (parts.marks) {
      ctx.strokeStyle = mark;
      ctx.lineWidth = Math.max(0.8, 0.016 * u);
      ctx.beginPath();
      parts.marks(pen(ctx, u, m));
      ctx.stroke();
    }
    ctx.fillStyle = hair.hex;
    ctx.strokeStyle = mark;
    ctx.lineWidth = Math.max(1, 0.025 * u);
    eachLock(ctx, u, m, parts.knots ?? [], () => {
      ctx.fill();
      ctx.stroke();
    });
    if (parts.ties?.length) {
      const band = hairTieColor(p);
      ctx.fillStyle = band;
      ctx.strokeStyle = mix(band, INK, 0.35);
      ctx.lineWidth = Math.max(0.6, 0.01 * u);
      for (const [x, y] of parts.ties) {
        ctx.beginPath();
        ctx.ellipse(x * m * u, y * u, 0.034 * u, 0.024 * u, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
    }
  }
  ctx.restore();
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

/** A rolled-up umbrella's cloth around its shaft, from the hand (`top`) down toward the tip. */
function furledPath(ctx: CanvasRenderingContext2D, u: number, x: number, top: number, tip: number) {
  const w = 0.05 * u;
  ctx.beginPath();
  ctx.moveTo(x - w * 0.5, top);
  ctx.quadraticCurveTo(x - w * 1.3, top + (tip - top) * 0.3, x - w * 0.2, tip);
  ctx.lineTo(x + w * 0.2, tip);
  ctx.quadraticCurveTo(x + w * 1.3, top + (tip - top) * 0.3, x + w * 0.5, top);
  ctx.closePath();
}

/**
 * The umbrella rolled up and carried like a walking stick in the carrying hand, its hooked handle
 * over the hand and its tip on the ground, in the same color (and pattern) as when it's open.
 */
function drawFurledUmbrella(
  ctx: CanvasRenderingContext2D,
  u: number,
  p: ThemePalette,
  hand: number,
  g: Garb,
) {
  const color = g.color(GARMENT_COLOR.umbrella(p));
  const x = 0.33 * hand * u;
  const top = -0.27 * u;
  const tip = -0.05 * u;
  ctx.strokeStyle = INK;
  ctx.lineCap = "round";
  ctx.lineWidth = Math.max(1, 0.026 * u);
  ctx.beginPath();
  // The ferrule down to the ground, and the hooked handle up over the hand.
  ctx.moveTo(x, tip);
  ctx.lineTo(x + 0.01 * hand * u, 0);
  ctx.moveTo(x, top);
  ctx.lineTo(x, -0.33 * u);
  ctx.quadraticCurveTo(x, -0.38 * u, x - 0.04 * hand * u, -0.37 * u);
  ctx.quadraticCurveTo(x - 0.07 * hand * u, -0.36 * u, x - 0.065 * hand * u, -0.32 * u);
  ctx.stroke();
  paintCloth(ctx, u, () => furledPath(ctx, u, x, top, tip), color, g.fill());
  ctx.strokeStyle = mix(color, INK, 0.35);
  ctx.lineWidth = Math.max(0.8, 0.016 * u);
  furledPath(ctx, u, x, top, tip);
  ctx.stroke();
  // The strap that keeps it rolled.
  ctx.fillStyle = mix(color, INK, 0.3);
  ctx.fillRect(x - 0.04 * u, -0.2 * u, 0.08 * u, 0.022 * u);
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
