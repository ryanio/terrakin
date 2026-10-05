/**
 * A resident drawn as a small, soft figure: a round head in their color, a body in their theme's
 * clothes and pattern, and up to three things to wear. Drawn with plain canvas shapes, once per look
 * into a cached sprite (see render.ts), so the world stays cheap at 60fps on a phone.
 */
import type {
  Direction,
  Pattern,
  ResidentColor,
  ResidentShape,
  Theme,
  ThemePalette,
  WearItem,
} from "@terrakin/sim";
import { BRAND_HEX } from "./brand";
import { lookImage, lookPalette, mix, PatternCache, RESIDENT_COLOR_HEX } from "./looks";

export interface FigureLook {
  color: ResidentColor;
  shape: ResidentShape;
  theme?: Theme | undefined;
  wear?: readonly WearItem[] | undefined;
}

/** Everything a figure picture needs, including the pattern. */
export interface FullLook extends FigureLook {
  pattern?: Pattern | undefined;
  patternMedia?: string | undefined;
}

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
const RIM = "#ffffff";
const STRAW = "#e8c878";
const STRAW_DEEP = "#c49a4c";
const WICKER = "#c9925a";
const LEATHER = "#9c6a3e";

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

/**
 * Draw a figure with its feet at (0, 0) of the current transform. `u` is one tile in pixels.
 * `pattern` fills the clothes over the main color (null for plain). `facing` is the way they look:
 * south (the default) shows the face, north their back, east and west a three-quarter turn.
 */
export function drawFigure(
  ctx: CanvasRenderingContext2D,
  u: number,
  look: FigureLook,
  pattern: CanvasPattern | null,
  facing: Direction = "s",
) {
  const p = lookPalette(look.theme, look.color);
  const head = RESIDENT_COLOR_HEX[look.color] ?? RESIDENT_COLOR_HEX.sun;
  const wear = new Set(look.wear ?? []);
  const rim = Math.max(1.5, u * 0.06);
  const back = facing === "n";
  // Turned sideways, front details slide toward the way they face.
  const side = facing === "e" ? 1 : facing === "w" ? -1 : 0;
  // Which side things carried in the right hand show on.
  const hand = side || (back ? -1 : 1);

  // White rim behind everything, so the figure reads on any ground.
  ctx.lineJoin = "round";
  ctx.strokeStyle = RIM;
  ctx.lineWidth = rim * 2;
  bodyPath(ctx, look.shape, u);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(0, HEAD_Y * u, HEAD_R * u, 0, Math.PI * 2);
  ctx.stroke();

  // Feet.
  ctx.fillStyle = p.deep;
  ctx.beginPath();
  const [footA, footB] = side ? [-0.03 * side, 0.1 * side] : [-0.1, 0.1];
  ctx.ellipse(footA * u, -0.02 * u, 0.075 * u, 0.045 * u, 0, 0, Math.PI * 2);
  ctx.ellipse(footB * u, -0.02 * u, 0.075 * u, 0.045 * u, 0, 0, Math.PI * 2);
  ctx.fill();

  // Clothes: main color, then the pattern, clipped to the body.
  bodyPath(ctx, look.shape, u);
  ctx.fillStyle = p.main;
  ctx.fill();
  ctx.save();
  bodyPath(ctx, look.shape, u);
  ctx.clip();
  if (pattern) {
    ctx.fillStyle = pattern;
    ctx.fillRect(-0.5 * u, -0.6 * u, u, 0.6 * u);
  }
  drawTop(ctx, u, wear, p, back, side);
  // Soft shade at the hem so the body feels round.
  ctx.fillStyle = "rgba(70, 40, 18, 0.14)";
  ctx.fillRect(-0.5 * u, -0.12 * u, u, 0.12 * u);
  ctx.restore();

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

  if (wear.has("satchel")) {
    ctx.strokeStyle = LEATHER;
    ctx.lineWidth = 0.04 * u;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(-0.16 * hand * u, -0.48 * u);
    ctx.lineTo(0.18 * hand * u, -0.16 * u);
    ctx.stroke();
    const bag = hand > 0 ? 0.13 : -0.3;
    ctx.fillStyle = LEATHER;
    ctx.beginPath();
    ctx.roundRect(bag * u, -0.22 * u, 0.17 * u, 0.13 * u, 0.03 * u);
    ctx.fill();
    ctx.fillStyle = mix(LEATHER, "#000000", 0.25);
    ctx.fillRect(bag * u, -0.22 * u, 0.17 * u, 0.04 * u);
  }

  // Head and face.
  ctx.fillStyle = head;
  ctx.beginPath();
  ctx.arc(0, HEAD_Y * u, HEAD_R * u, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "rgba(255, 255, 255, 0.35)";
  ctx.beginPath();
  ctx.ellipse(-0.08 * u, -0.74 * u, 0.06 * u, 0.035 * u, -0.6, 0, Math.PI * 2);
  ctx.fill();
  if (!back) drawFace(ctx, u, look.color === "coal" ? BRAND_HEX.paper : INK, wear, side * 0.07);

  drawHat(ctx, u, wear, p);

  if (wear.has("bow")) {
    // Sideways it sits toward the back of the head.
    const x = 0.15 * (side ? -side : back ? -1 : 1) * u;
    const y = -0.82 * u;
    ctx.fillStyle = p.accent === "#ffffff" ? p.deep : p.accent;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x - 0.1 * u, y - 0.06 * u);
    ctx.lineTo(x - 0.1 * u, y + 0.06 * u);
    ctx.closePath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + 0.1 * u, y - 0.06 * u);
    ctx.lineTo(x + 0.1 * u, y + 0.06 * u);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.arc(x, y, 0.03 * u, 0, Math.PI * 2);
    ctx.fill();
  }

  if (wear.has("basket")) {
    const x = 0.3 * hand * u;
    const y = -0.2 * u;
    // Handle, fruit, then the basket in front.
    ctx.strokeStyle = WICKER;
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
    ctx.fillStyle = WICKER;
    ctx.beginPath();
    ctx.roundRect(x - 0.11 * u, y, 0.22 * u, 0.12 * u, [0, 0, 0.04 * u, 0.04 * u]);
    ctx.fill();
    ctx.strokeStyle = mix(WICKER, "#000000", 0.25);
    ctx.lineWidth = Math.max(0.6, 0.015 * u);
    ctx.beginPath();
    ctx.moveTo(x - 0.11 * u, y + 0.045 * u);
    ctx.lineTo(x + 0.11 * u, y + 0.045 * u);
    ctx.moveTo(x - 0.1 * u, y + 0.085 * u);
    ctx.lineTo(x + 0.1 * u, y + 0.085 * u);
    ctx.stroke();
  }
}

/** Eyes, cheeks, and glasses, slid `turn` tiles sideways when the figure faces east or west. */
function drawFace(
  ctx: CanvasRenderingContext2D,
  u: number,
  eye: string,
  wear: Set<WearItem>,
  turn: number,
) {
  const t = turn * u;
  ctx.fillStyle = eye;
  ctx.beginPath();
  ctx.arc(t - 0.075 * u, -0.64 * u, 0.026 * u, 0, Math.PI * 2);
  ctx.arc(t + 0.075 * u, -0.64 * u, 0.026 * u, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "rgba(234, 110, 120, 0.4)";
  ctx.beginPath();
  ctx.ellipse(t * 0.5 - 0.13 * u, -0.585 * u, 0.04 * u, 0.025 * u, 0, 0, Math.PI * 2);
  ctx.ellipse(t * 0.5 + 0.13 * u, -0.585 * u, 0.04 * u, 0.025 * u, 0, 0, Math.PI * 2);
  ctx.fill();

  if (wear.has("glasses")) {
    ctx.strokeStyle = INK;
    ctx.lineWidth = Math.max(1, 0.022 * u);
    ctx.beginPath();
    ctx.arc(t - 0.075 * u, -0.64 * u, 0.055 * u, 0, Math.PI * 2);
    ctx.moveTo(t + 0.13 * u, -0.64 * u);
    ctx.arc(t + 0.075 * u, -0.64 * u, 0.055 * u, 0, Math.PI * 2);
    ctx.moveTo(t - 0.02 * u, -0.645 * u);
    ctx.lineTo(t + 0.02 * u, -0.645 * u);
    ctx.stroke();
  }
}

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
) {
  const t = side * 0.1 * u;
  if (wear.has("apron") && !back) {
    ctx.fillStyle = p.light;
    ctx.beginPath();
    ctx.roundRect(t - 0.15 * u, -0.42 * u, 0.3 * u, 0.4 * u, 0.06 * u);
    ctx.fill();
    ctx.strokeStyle = p.deep;
    ctx.lineWidth = Math.max(0.8, 0.018 * u);
    ctx.beginPath();
    ctx.roundRect(t - 0.07 * u, -0.22 * u, 0.14 * u, 0.08 * u, 0.02 * u);
    ctx.stroke();
  }
  if (wear.has("cardigan")) {
    ctx.fillStyle = p.deep;
    if (back) {
      ctx.fillRect(-0.4 * u, -0.6 * u, 0.8 * u, 0.6 * u);
    } else {
      ctx.fillRect(t - 0.4 * u, -0.6 * u, 0.27 * u, 0.6 * u);
      ctx.fillRect(t + 0.13 * u, -0.6 * u, 0.27 * u, 0.6 * u);
      ctx.fillStyle = p.light;
      for (const y of [-0.38, -0.26, -0.14]) {
        ctx.beginPath();
        ctx.arc(t + 0.1 * u, y * u, 0.022 * u, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
  if (wear.has("overalls")) {
    ctx.fillStyle = p.deep;
    ctx.fillRect(-0.4 * u, -0.22 * u, 0.8 * u, 0.22 * u);
    if (back) {
      // The straps cross between the shoulder blades.
      ctx.strokeStyle = p.deep;
      ctx.lineWidth = 0.04 * u;
      ctx.beginPath();
      ctx.moveTo(-0.16 * u, -0.52 * u);
      ctx.lineTo(0.1 * u, -0.22 * u);
      ctx.moveTo(0.16 * u, -0.52 * u);
      ctx.lineTo(-0.1 * u, -0.22 * u);
      ctx.stroke();
    } else {
      ctx.save();
      ctx.translate(t, 0);
      drawBib(ctx, u, p);
      ctx.restore();
    }
  }
  if (wear.has("scarf")) {
    const scarf = p.accent === "#ffffff" || p.accent === BRAND_HEX.paper ? p.deep : p.accent;
    ctx.fillStyle = scarf;
    ctx.beginPath();
    ctx.roundRect(-0.22 * u, -0.52 * u, 0.44 * u, 0.09 * u, 0.04 * u);
    ctx.fill();
    if (!back) {
      ctx.beginPath();
      ctx.roundRect(t + 0.05 * u, -0.48 * u, 0.08 * u, 0.2 * u, 0.03 * u);
      ctx.fill();
      ctx.fillStyle = "rgba(255,255,255,0.3)";
      ctx.fillRect(t + 0.05 * u, -0.34 * u, 0.08 * u, 0.02 * u);
    }
  }
}

/** The overalls' bib, straps, and buttons. */
function drawBib(ctx: CanvasRenderingContext2D, u: number, p: ThemePalette) {
  ctx.fillStyle = p.deep;
  ctx.beginPath();
  ctx.roundRect(-0.12 * u, -0.38 * u, 0.24 * u, 0.18 * u, 0.03 * u);
  ctx.fill();
  ctx.strokeStyle = p.deep;
  ctx.lineWidth = 0.04 * u;
  ctx.beginPath();
  ctx.moveTo(-0.1 * u, -0.37 * u);
  ctx.lineTo(-0.16 * u, -0.52 * u);
  ctx.moveTo(0.1 * u, -0.37 * u);
  ctx.lineTo(0.16 * u, -0.52 * u);
  ctx.stroke();
  ctx.fillStyle = p.light;
  ctx.beginPath();
  ctx.arc(-0.08 * u, -0.34 * u, 0.02 * u, 0, Math.PI * 2);
  ctx.arc(0.08 * u, -0.34 * u, 0.02 * u, 0, Math.PI * 2);
  ctx.fill();
}

function drawHat(ctx: CanvasRenderingContext2D, u: number, wear: Set<WearItem>, p: ThemePalette) {
  const top = (HEAD_Y - HEAD_R) * u;
  if (wear.has("straw_hat")) {
    ctx.fillStyle = STRAW;
    ctx.strokeStyle = STRAW_DEEP;
    ctx.lineWidth = Math.max(0.8, 0.015 * u);
    ctx.beginPath();
    ctx.ellipse(0, top + 0.1 * u, 0.33 * u, 0.075 * u, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.roundRect(-0.15 * u, top - 0.06 * u, 0.3 * u, 0.16 * u, [0.07 * u, 0.07 * u, 0, 0]);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = p.accent === "#ffffff" ? p.deep : p.accent;
    ctx.fillRect(-0.15 * u, top + 0.04 * u, 0.3 * u, 0.04 * u);
  } else if (wear.has("beret")) {
    ctx.fillStyle = p.deep;
    ctx.beginPath();
    ctx.ellipse(0.03 * u, top + 0.05 * u, 0.22 * u, 0.09 * u, -0.18, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(0.05 * u, top - 0.04 * u, 0.025 * u, 0, Math.PI * 2);
    ctx.fill();
  } else if (wear.has("beanie")) {
    const knit = p.accent === "#ffffff" ? p.main : p.accent;
    ctx.fillStyle = knit;
    ctx.beginPath();
    ctx.arc(0, HEAD_Y * u - 0.02 * u, HEAD_R * u * 1.04, Math.PI, 0);
    ctx.fill();
    ctx.fillStyle = mix(knit, "#000000", 0.18);
    ctx.beginPath();
    ctx.roundRect(-0.23 * u, HEAD_Y * u - 0.06 * u, 0.46 * u, 0.07 * u, 0.03 * u);
    ctx.fill();
    ctx.fillStyle = p.light;
    ctx.beginPath();
    ctx.arc(0, top - 0.04 * u, 0.055 * u, 0, Math.PI * 2);
    ctx.fill();
  } else if (wear.has("flower_crown")) {
    for (let i = 0; i < 5; i++) {
      const a = Math.PI + 0.35 + (i * (Math.PI - 0.7)) / 4;
      const x = Math.cos(a) * HEAD_R * 0.95 * u;
      const y = HEAD_Y * u + Math.sin(a) * HEAD_R * 0.95 * u;
      ctx.fillStyle = "#7fa94c";
      ctx.beginPath();
      ctx.ellipse(x + 0.035 * u, y + 0.01 * u, 0.03 * u, 0.015 * u, 0.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = i % 2 === 0 ? (p.accent === "#ffffff" ? p.light : p.accent) : p.light;
      ctx.beginPath();
      ctx.arc(x, y, 0.045 * u, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = p.deep;
      ctx.beginPath();
      ctx.arc(x, y, 0.016 * u, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}
