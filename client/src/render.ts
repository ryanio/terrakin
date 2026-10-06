import { fourWayFacing } from "@terrakin/protocol";
import {
  BLOCK_COLORS,
  type BlockKind,
  blockFill,
  type Crop,
  type DecorKind,
  type Direction,
  FLOWER_TONES,
  groundTile,
  HEARTH_COLOR,
  HEARTH_DOOR,
  isDecorKind,
  LEAF_TONES,
  mixHex,
  OUTSIDE_GROUND,
  plotKey,
  type Resident,
  type Season,
  THEME_INFO,
  THEME_TINT_ALPHA,
  type Theme,
  type ThemePalette,
  tileKey,
  tuftStroke,
} from "@terrakin/sim";
import { BRAND_HEX } from "@terrakin/ui/brand";
import {
  blinks,
  drawFeelingIcon,
  drawFigure,
  FEELING_ICON,
  type FeelingIcon,
  FIGURE_BOX,
  type FigureFace,
  signPx,
} from "@terrakin/ui/figure";
import { CROP_HEX, growth, itemArtImage } from "@terrakin/ui/item-art";
import {
  lookImage,
  lookPalette,
  PatternCache,
  paintMotif,
  patternMotifs as patternMotifsFor,
  withAlpha,
} from "@terrakin/ui/looks";
import { type Camera, tileToScreen } from "./camera";
import { type Feelings, idPhase, pose, restingPose } from "./feelings";
import type { DisplayView, Mirror } from "./mirror";
import { awayPose, type Motion, type Pose as MotionPose } from "./motion";
import { type Box, bubbleBox, drawBubble, drawDust, drawPoof, stackBubbles } from "./overhead";
import { nightAmount } from "./time";
import { drawWeather, type SkyAmounts, UMBRELLA_RAIN } from "./weather";

export { RESIDENT_COLOR_HEX } from "@terrakin/ui/looks";

// Storybook palette. Matches the tokens in ui/src/tokens.css. The world's own colors (ground,
// blocks, the hearth) are in the sim's palette, shared with the plot photos drawn at the edge.
const PAPER = BRAND_HEX.paper;
const PAPER_EDGE = BRAND_HEX.paperEdge;
const INK = BRAND_HEX.ink;
const CLAY = BRAND_HEX.clay;
const CLAY_DEEP = BRAND_HEX.clayDeep;

/** Blocks you grow or make things at (RFC 0005). */
const WORKSHOP_BLOCKS: ReadonlySet<BlockKind> = new Set(["planter", "kitchen", "workbench"]);

/** Dark wood for posts, legs, and lantern caps. */
const WOOD_DARK = "#6e4a2c";

export function blockColor(block: BlockKind): string {
  return BLOCK_COLORS[block];
}

export { HEARTH_COLOR };

// ---------- sprites: looks drawn once, then stamped every frame ----------

const patterns = new PatternCache();
const sprites = new Map<string, HTMLCanvasElement>();

/** A cached offscreen drawing, `w` by `h` device pixels. Cleared when it grows too big. */
function sprite(
  key: string,
  w: number,
  h: number,
  draw: (ctx: CanvasRenderingContext2D) => void,
): HTMLCanvasElement {
  let canvas = sprites.get(key);
  if (!canvas) {
    if (sprites.size > 400) sprites.clear();
    canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.ceil(w));
    canvas.height = Math.max(1, Math.ceil(h));
    draw(canvas.getContext("2d") as CanvasRenderingContext2D);
    sprites.set(key, canvas);
  }
  return canvas;
}

/** The pattern a resident wears: their own uploaded tile once it loads, else the named one. */
function clothesPattern(
  ctx: CanvasRenderingContext2D,
  r: Pick<Resident, "pattern" | "patternMedia" | "theme" | "color">,
  u: number,
): { pattern: CanvasPattern | null; key: string } {
  const img = lookImage(r.patternMedia);
  if (img && r.patternMedia) {
    return { pattern: patterns.image(ctx, r.patternMedia, img, u * 0.42), key: r.patternMedia };
  }
  const name = r.pattern ?? "plain";
  return { pattern: patterns.named(ctx, name, lookPalette(r.theme, r.color), u * 0.36), key: name };
}

/** The sprite key's part for a face: only what changes the drawing, so a blink on shut eyes reuses one. */
export function faceKey(face: FigureFace): string {
  const feeling = face.feeling ?? "neutral";
  const blink = face.blink && blinks(feeling) ? 1 : 0;
  return `${feeling}|${blink}|${face.wave ?? 0}|${face.furled ? 1 : 0}`;
}

/** Laid over someone asleep at home while they're away, so they read as not quite here. */
const AWAY_WASH = "rgba(255, 250, 240, 0.4)";
/** How strongly their name tag and sign show. */
const AWAY_TAG_ALPHA = 0.72;

/**
 * A resident's figure as a sprite at `scale` CSS pixels per tile. Returns the canvas and where its
 * top-left sits relative to the feet, in CSS pixels. Each look, facing, and face (`faceKey`) is
 * drawn once and then stamped. `away` fades it, for someone asleep at home (decision 0086).
 */
export function figureSprite(
  r: Pick<
    Resident,
    | "color"
    | "shape"
    | "theme"
    | "pattern"
    | "patternMedia"
    | "wear"
    | "wearStyle"
    | "hair"
    | "hairColor"
  >,
  scale: number,
  dpr: number,
  facing: Direction = "s",
  face: FigureFace = {},
  away = false,
): { canvas: HTMLCanvasElement; dx: number; dy: number; w: number; h: number } {
  const u = scale * dpr;
  const w = (FIGURE_BOX.right - FIGURE_BOX.left) * u;
  const h = (FIGURE_BOX.bottom - FIGURE_BOX.top) * u;
  const probe = lookImage(r.patternMedia) ? r.patternMedia : (r.pattern ?? "plain");
  // Styles only matter for what's worn, so a style kept for a garment in the drawer costs nothing.
  const styles = (r.wear ?? []).map((w) => {
    const s = r.wearStyle?.[w];
    return s ? `${w}:${s.pattern ?? ""}:${s.color ?? ""}` : "";
  });
  const hair = r.hair ? `${r.hair}:${r.hairColor ?? ""}` : "";
  const key = `fig|${r.color}|${r.shape}|${r.theme ?? ""}|${probe}|${(r.wear ?? []).join(",")}|${styles.join(",")}|${hair}|${fourWayFacing(facing)}|${faceKey(face)}|${away ? "away|" : ""}${u.toFixed(2)}`;
  const canvas = sprite(key, w, h, (ctx) => {
    ctx.translate(-FIGURE_BOX.left * u, -FIGURE_BOX.top * u);
    drawFigure(ctx, u, r, clothesPattern(ctx, r, u).pattern, facing, patterns, face);
    if (!away) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = "source-atop";
    ctx.fillStyle = AWAY_WASH;
    ctx.fillRect(0, 0, w, h);
  });
  return {
    canvas,
    dx: FIGURE_BOX.left * scale,
    dy: FIGURE_BOX.top * scale,
    w: w / dpr,
    h: h / dpr,
  };
}

/** How a themed plot dresses its blocks. */
interface BlockSkin {
  theme?: Theme;
  palette?: ThemePalette;
  /** The owner's uploaded pattern, used as the face of wood and stone. */
  image?: HTMLImageElement;
  imageId?: string;
}

/** The color of a block on a plot with this skin. */
function skinnedColor(block: BlockKind, skin: BlockSkin | undefined): string {
  return blockFill(block, skin?.palette);
}

/** One raised block with its ground shadow, at (left, top), `size` across. */
function paintBlock(
  ctx: CanvasRenderingContext2D,
  block: BlockKind,
  left: number,
  top: number,
  size: number,
  scale: number,
  skin?: BlockSkin,
) {
  const inset = Math.max(1, Math.round(scale * 0.05));
  const radius = Math.max(2, scale * 0.14);
  const lip = Math.max(2, Math.round(scale * 0.16));
  ctx.fillStyle = "rgba(74, 52, 28, 0.2)";
  ctx.beginPath();
  ctx.roundRect(left + 1, top + lip * 0.6, size, size, radius);
  ctx.fill();
  ctx.fillStyle = skinnedColor(block, skin);
  ctx.beginPath();
  ctx.roundRect(left, top, size, size, radius);
  ctx.fill();
  const walls = block === "wood" || block === "stone";
  if (skin?.image && walls) {
    // The owner's own pattern as the face of the wall, cropped square.
    const img = skin.image;
    const side = Math.min(img.naturalWidth, img.naturalHeight);
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(left, top, size, size, radius);
    ctx.clip();
    ctx.globalAlpha = block === "stone" ? 0.7 : 0.9;
    ctx.drawImage(
      img,
      (img.naturalWidth - side) / 2,
      (img.naturalHeight - side) / 2,
      side,
      side,
      left,
      top,
      size,
      size,
    );
    ctx.restore();
  } else if (skin?.theme && block === "wood") {
    // A tiny motif from the theme: a lemon slice on lemon wood, a star on night wood.
    const info = THEME_INFO[skin.theme];
    const m = info.motif === "stripes" || info.motif === "gingham" ? "dots" : info.motif;
    const [motif] = patternMotifsFor(m);
    if (motif) {
      ctx.save();
      ctx.globalAlpha = 0.9;
      // Scale the first motif of the pattern so it sits in the middle of the block.
      const u = size * 0.9;
      const cx = "x" in motif ? motif.x : 0.5;
      const cy = "y" in motif ? motif.y : 0.5;
      paintMotif(ctx, motif, info.palette, left + size / 2 - cx * u, top + size * 0.45 - cy * u, u);
      ctx.restore();
    }
  }
  // Bottom shade, then top highlight, both inset so the rounded corners stay clean.
  ctx.fillStyle = "rgba(70, 40, 18, 0.22)";
  ctx.beginPath();
  ctx.roundRect(left, top + size - lip, size, lip, [0, 0, radius, radius]);
  ctx.fill();
  ctx.fillStyle = block === "glass" ? "rgba(255,255,255,0.6)" : "rgba(255, 250, 235, 0.32)";
  ctx.beginPath();
  ctx.roundRect(left + radius * 0.5, top + inset, size - radius, Math.max(2, lip * 0.55), 2);
  ctx.fill();
  if (WORKSHOP_BLOCKS.has(block)) paintWorkshop(ctx, block, left, top, size, scale);
  if (block === "glass") {
    ctx.strokeStyle = "rgba(255,255,255,0.75)";
    ctx.lineWidth = Math.max(1, scale / 22);
    ctx.beginPath();
    ctx.moveTo(left + size * 0.3, top + size * 0.68);
    ctx.lineTo(left + size * 0.62, top + size * 0.36);
    ctx.stroke();
  }
}

/** The face of a planter (dark soil), a kitchen (two burners), or a workbench (planks). */
function paintWorkshop(
  ctx: CanvasRenderingContext2D,
  block: BlockKind,
  left: number,
  top: number,
  size: number,
  scale: number,
) {
  ctx.save();
  if (block === "planter") {
    const pad = size * 0.16;
    ctx.fillStyle = "#4a3222";
    ctx.beginPath();
    ctx.roundRect(
      left + pad,
      top + pad,
      size - pad * 2,
      size - pad * 2.4,
      Math.max(2, scale * 0.08),
    );
    ctx.fill();
  } else if (block === "kitchen") {
    ctx.fillStyle = "#3d2a22";
    for (const cx of [0.32, 0.68]) {
      ctx.beginPath();
      ctx.arc(left + size * cx, top + size * 0.42, size * 0.13, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.strokeStyle = "rgba(255, 196, 120, 0.85)";
    ctx.lineWidth = Math.max(1, scale / 30);
    for (const cx of [0.32, 0.68]) {
      ctx.beginPath();
      ctx.arc(left + size * cx, top + size * 0.42, size * 0.07, 0, Math.PI * 2);
      ctx.stroke();
    }
  } else {
    ctx.strokeStyle = "rgba(70, 40, 18, 0.45)";
    ctx.lineWidth = Math.max(1, scale / 28);
    for (const fy of [0.32, 0.54]) {
      ctx.beginPath();
      ctx.moveTo(left + size * 0.12, top + size * fy);
      ctx.lineTo(left + size * 0.88, top + size * fy);
      ctx.stroke();
    }
  }
  ctx.restore();
}

/**
 * A crop in a planter, drawn from how far along it is (0 to 1): a sprout that grows, then the
 * crop's color in small fruit or petals once it's ready.
 */
function paintCrop(
  ctx: CanvasRenderingContext2D,
  crop: Crop,
  done: number,
  left: number,
  top: number,
  size: number,
) {
  if (crop === "pumpkin") {
    paintPumpkin(ctx, done, left, top, size);
    return;
  }
  const cx = left + size / 2;
  const base = top + size * 0.66;
  const tall = size * (0.18 + 0.32 * done);
  ctx.save();
  ctx.strokeStyle = "#5f9a43";
  ctx.lineCap = "round";
  ctx.lineWidth = Math.max(1.5, size / 14);
  ctx.beginPath();
  ctx.moveTo(cx, base);
  ctx.lineTo(cx, base - tall);
  ctx.stroke();
  ctx.fillStyle = "#6fae4c";
  const leaf = size * (0.08 + 0.08 * done);
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.ellipse(cx + side * leaf, base - tall * 0.55, leaf, leaf * 0.5, side * 0.5, 0, Math.PI * 2);
    ctx.fill();
  }
  if (done >= 1) {
    ctx.fillStyle = CROP_HEX[crop];
    ctx.strokeStyle = "rgba(43, 38, 32, 0.35)";
    ctx.lineWidth = 1;
    const r = size * 0.09;
    for (const [dx, dy] of [
      [-0.16, -0.05],
      [0.16, -0.1],
      [0, -0.2],
    ] as const) {
      ctx.beginPath();
      ctx.arc(cx + dx * size, base - tall + dy * size + tall * 0.4, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
  }
  ctx.restore();
}

/**
 * A pumpkin in a planter (RFC 0017): a vine that spreads along the soil, and a pumpkin that swells
 * from a green bud, ripening to orange with a stem once it's ready.
 */
function paintPumpkin(
  ctx: CanvasRenderingContext2D,
  done: number,
  left: number,
  top: number,
  size: number,
) {
  const cx = left + size / 2;
  const base = top + size * 0.7;
  const spread = size * (0.14 + 0.2 * done);
  ctx.save();
  ctx.strokeStyle = "#5f9a43";
  ctx.lineCap = "round";
  ctx.lineWidth = Math.max(1.5, size / 16);
  ctx.beginPath();
  ctx.moveTo(cx - spread, base);
  ctx.quadraticCurveTo(cx, base - size * 0.14, cx + spread, base);
  ctx.stroke();
  ctx.fillStyle = "#6fae4c";
  const leaf = size * (0.07 + 0.07 * done);
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.ellipse(
      cx + side * spread * 0.85,
      base - leaf * 0.3,
      leaf,
      leaf * 0.6,
      side * 0.4,
      0,
      Math.PI * 2,
    );
    ctx.fill();
  }
  if (done > 0.2) {
    const ripe = done >= 1;
    const swell = (done - 0.2) / 0.8;
    const r = size * (0.08 + 0.15 * swell);
    const y = base - r * 0.55;
    ctx.fillStyle = ripe ? CROP_HEX.pumpkin : mixHex("#8cbf5a", CROP_HEX.pumpkin, swell * 0.5);
    ctx.strokeStyle = "rgba(43, 38, 32, 0.35)";
    ctx.lineWidth = 1;
    for (const dx of [-0.5, 0.5, 0]) {
      ctx.beginPath();
      ctx.ellipse(cx + dx * r, y, r * 0.72, r * 0.82, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
    if (ripe) {
      ctx.strokeStyle = "#76703a";
      ctx.lineWidth = Math.max(1.5, size / 18);
      ctx.beginPath();
      ctx.moveTo(cx, y - r * 0.7);
      ctx.lineTo(cx + r * 0.15, y - r * 1.05);
      ctx.stroke();
    }
  }
  ctx.restore();
}

// ---------- decor from the town shop (RFC 0008) ----------

/** Which neighbors a fence post joins: the four sides that hold a fence too. */
interface Joins {
  n: boolean;
  e: boolean;
  s: boolean;
  w: boolean;
}

/**
 * A decor block on its tile, drawn as itself rather than a square: a paper lantern on a hook, a
 * picture on an easel, a fence post with rails out to the fences beside it, a garden bench, or
 * autumn's hay bale and scarecrow.
 * `left`, `top`, and `size` are the block's box; `edge` is the gap to the tile's edge, so fence
 * rails reach their neighbors' rails.
 */
function paintDecor(
  ctx: CanvasRenderingContext2D,
  kind: DecorKind,
  left: number,
  top: number,
  size: number,
  scale: number,
  edge: number,
  joins: Joins,
) {
  ctx.save();
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  const cx = left + size / 2;
  const base = top + size * 0.9;
  if (kind !== "fence") {
    ctx.fillStyle = "rgba(74, 52, 28, 0.2)";
    ctx.beginPath();
    ctx.ellipse(cx, base, size * 0.36, size * 0.09, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  const outline = Math.max(1, scale / 30);
  ctx.strokeStyle = "rgba(70, 40, 18, 0.55)";
  ctx.lineWidth = outline;
  if (kind === "lantern") paintLantern(ctx, left, top, size);
  else if (kind === "frame") paintEasel(ctx, left, top, size, outline);
  else if (kind === "fence") paintFence(ctx, left, top, size, edge, joins);
  else if (kind === "hay_bale") paintHayBale(ctx, left, top, size);
  else if (kind === "scarecrow") paintScarecrow(ctx, left, top, size, outline);
  else paintBench(ctx, left, top, size);
  ctx.restore();
}

/** A pale stone plinth for something on display. */
function paintPedestal(
  ctx: CanvasRenderingContext2D,
  left: number,
  top: number,
  size: number,
  scale: number,
) {
  const cx = left + size / 2;
  const base = top + size * 0.92;
  ctx.save();
  ctx.fillStyle = "rgba(74, 52, 28, 0.2)";
  ctx.beginPath();
  ctx.ellipse(cx, base, size * 0.34, size * 0.08, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = BLOCK_COLORS.pedestal;
  ctx.strokeStyle = "rgba(70, 40, 18, 0.45)";
  ctx.lineWidth = Math.max(1, scale / 30);
  ctx.beginPath();
  ctx.roundRect(cx - size * 0.3, base - size * 0.12, size * 0.6, size * 0.12, size * 0.03);
  ctx.roundRect(cx - size * 0.2, top + size * 0.62, size * 0.4, size * 0.2, size * 0.02);
  ctx.roundRect(cx - size * 0.3, top + size * 0.54, size * 0.6, size * 0.1, size * 0.03);
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

/**
 * What's on display on a pedestal or in a frame: a piece's own picture when it has loaded, and the
 * thing's drawn picture otherwise (a model, a jar of jam). Pictures load once and draw from then on.
 */
function paintShown(
  ctx: CanvasRenderingContext2D,
  good: DisplayView["good"],
  left: number,
  top: number,
  size: number,
  on: "pedestal" | "frame",
) {
  const picture = good.kind === "piece" && !good.model ? lookImage(good.media) : undefined;
  const cx = left + size / 2;
  if (on === "frame") {
    // The easel's picture area, inside the frame's border (see paintEasel).
    const border = Math.max(2, size * 0.08);
    const x = cx - size * 0.35 + border;
    const y = top + size * 0.12 + border;
    const w = size * 0.7 - border * 2;
    const h = size * 0.52 - border * 2;
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, w, h);
    ctx.clip();
    ctx.fillStyle = PAPER;
    ctx.fillRect(x, y, w, h);
    if (picture) drawCover(ctx, picture, x, y, w, h);
    else {
      const art = itemArtImage(good.kind);
      const side = Math.min(w, h) * 1.1;
      if (art) ctx.drawImage(art, cx - side / 2, y + (h - side) / 2, side, side);
    }
    ctx.restore();
    return;
  }
  const side = size * 0.66;
  const y = top + size * 0.58 - side;
  if (picture) {
    // A little canvas on the plinth, in a frame.
    const w = side * 0.8;
    const h = side * 0.66;
    const x = cx - w / 2;
    const py = top + size * 0.56 - h;
    ctx.save();
    ctx.fillStyle = BLOCK_COLORS.frame;
    ctx.fillRect(x - 2, py - 2, w + 4, h + 4);
    ctx.beginPath();
    ctx.rect(x, py, w, h);
    ctx.clip();
    drawCover(ctx, picture, x, py, w, h);
    ctx.restore();
    return;
  }
  const art = itemArtImage(good.kind);
  if (art) ctx.drawImage(art, cx - side / 2, y, side, side);
}

/**
 * A fallen leaf around (cx, cy) on a tile `size` across, lying `turn` radians from east: two curves
 * from tip to tip, the shape the plot photos draw (`cards/src/plot.ts`).
 */
function leafPath(path: Path2D, cx: number, cy: number, turn: number, size: number) {
  const dx = Math.cos(turn) * size * 0.14;
  const dy = Math.sin(turn) * size * 0.14;
  const wx = -Math.sin(turn) * size * 0.13;
  const wy = Math.cos(turn) * size * 0.13;
  path.moveTo(cx + dx, cy + dy);
  path.quadraticCurveTo(cx + wx, cy + wy, cx - dx, cy - dy);
  path.quadraticCurveTo(cx - wx, cy - wy, cx + dx, cy + dy);
}

/** Draw an image to fill a box, cropped to keep its shape. */
function drawCover(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  x: number,
  y: number,
  w: number,
  h: number,
) {
  const k = Math.max(w / img.naturalWidth, h / img.naturalHeight);
  const dw = img.naturalWidth * k;
  const dh = img.naturalHeight * k;
  ctx.drawImage(img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
}

/** A paper lantern hanging from a shepherd's hook. */
function paintLantern(ctx: CanvasRenderingContext2D, left: number, top: number, size: number) {
  const postX = left + size * 0.3;
  const base = top + size * 0.9;
  const hangX = left + size * 0.64;
  ctx.strokeStyle = WOOD_DARK;
  ctx.lineWidth = Math.max(1.5, size * 0.07);
  ctx.beginPath();
  ctx.moveTo(postX, base);
  ctx.lineTo(postX, top + size * 0.14);
  ctx.quadraticCurveTo(
    postX + size * 0.02,
    top + size * 0.04,
    hangX - size * 0.06,
    top + size * 0.06,
  );
  ctx.quadraticCurveTo(hangX, top + size * 0.08, hangX, top + size * 0.16);
  ctx.stroke();
  // The paper shade: round, ribbed, with dark caps.
  const ly = top + size * 0.42;
  const rx = size * 0.19;
  const ry = size * 0.21;
  ctx.fillStyle = BLOCK_COLORS.lantern;
  ctx.strokeStyle = "rgba(70, 40, 18, 0.55)";
  ctx.lineWidth = Math.max(1, size / 30);
  ctx.beginPath();
  ctx.ellipse(hangX, ly, rx, ry, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.strokeStyle = "rgba(255, 250, 235, 0.55)";
  ctx.beginPath();
  for (const f of [-0.45, 0.45]) {
    ctx.moveTo(hangX + rx * f, ly - ry * 0.85);
    ctx.quadraticCurveTo(hangX + rx * f * 1.6, ly, hangX + rx * f, ly + ry * 0.85);
  }
  ctx.stroke();
  ctx.fillStyle = WOOD_DARK;
  ctx.beginPath();
  ctx.roundRect(hangX - rx * 0.55, ly - ry - size * 0.03, rx * 1.1, size * 0.07, size * 0.02);
  ctx.roundRect(hangX - rx * 0.55, ly + ry - size * 0.04, rx * 1.1, size * 0.07, size * 0.02);
  ctx.fill();
  ctx.fillStyle = CLAY;
  ctx.beginPath();
  ctx.arc(hangX, ly + ry + size * 0.08, size * 0.03, 0, Math.PI * 2);
  ctx.fill();
}

/** A picture in a gold frame, standing on a little easel. */
function paintEasel(
  ctx: CanvasRenderingContext2D,
  left: number,
  top: number,
  size: number,
  outline: number,
) {
  const cx = left + size / 2;
  const base = top + size * 0.9;
  ctx.strokeStyle = WOOD_DARK;
  ctx.lineWidth = Math.max(1.5, size * 0.06);
  ctx.beginPath();
  ctx.moveTo(cx - size * 0.28, base);
  ctx.lineTo(cx - size * 0.08, top + size * 0.08);
  ctx.moveTo(cx + size * 0.28, base);
  ctx.lineTo(cx + size * 0.08, top + size * 0.08);
  ctx.moveTo(cx, base - size * 0.06);
  ctx.lineTo(cx, top + size * 0.62);
  ctx.stroke();
  const w = size * 0.7;
  const h = size * 0.52;
  const x = cx - w / 2;
  const y = top + size * 0.12;
  const border = Math.max(2, size * 0.08);
  ctx.fillStyle = BLOCK_COLORS.frame;
  ctx.strokeStyle = "rgba(70, 40, 18, 0.55)";
  ctx.lineWidth = outline;
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, size * 0.04);
  ctx.fill();
  ctx.stroke();
  // The picture: sky, a sun, and two hills.
  const ix = x + border;
  const iy = y + border;
  const iw = w - border * 2;
  const ih = h - border * 2;
  ctx.save();
  ctx.beginPath();
  ctx.rect(ix, iy, iw, ih);
  ctx.clip();
  ctx.fillStyle = "#cfe6ee";
  ctx.fillRect(ix, iy, iw, ih);
  ctx.fillStyle = BRAND_HEX.sun;
  ctx.beginPath();
  ctx.arc(ix + iw * 0.72, iy + ih * 0.3, ih * 0.18, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = BRAND_HEX.mossLight;
  ctx.beginPath();
  ctx.ellipse(ix + iw * 0.25, iy + ih * 1.05, iw * 0.55, ih * 0.5, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = BRAND_HEX.moss;
  ctx.beginPath();
  ctx.ellipse(ix + iw * 0.85, iy + ih * 1.1, iw * 0.5, ih * 0.4, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  // The easel's ledge.
  ctx.fillStyle = WOOD_DARK;
  ctx.fillRect(x - size * 0.02, y + h - size * 0.01, w + size * 0.04, Math.max(2, size * 0.06));
}

/** A white fence post, with rails out to each side that holds a fence too. */
function paintFence(
  ctx: CanvasRenderingContext2D,
  left: number,
  top: number,
  size: number,
  edge: number,
  joins: Joins,
) {
  const cx = left + size / 2;
  const postW = size * 0.22;
  const postTop = top + size * 0.12;
  const base = top + size * 0.92;
  const railH = Math.max(2, size * 0.1);
  const color = BLOCK_COLORS.fence;
  const line = "rgba(70, 40, 18, 0.5)";
  ctx.fillStyle = "rgba(74, 52, 28, 0.18)";
  ctx.beginPath();
  ctx.ellipse(cx, base, size * 0.18, size * 0.06, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = color;
  ctx.strokeStyle = line;
  // Rails east and west: two boards from the post to the tile's edge, where the next one meets.
  for (const [on, from, to] of [
    [joins.w, left - edge, cx],
    [joins.e, cx, left + size + edge],
  ] as const) {
    if (!on) continue;
    for (const fy of [0.32, 0.62]) {
      ctx.beginPath();
      ctx.rect(from, top + size * fy, to - from, railH);
      ctx.fill();
      ctx.stroke();
    }
  }
  // North and south, the rails run away from us: one board up or down the middle.
  const boardW = size * 0.14;
  if (joins.n) {
    ctx.beginPath();
    ctx.rect(cx - boardW / 2, top - edge, boardW, postTop - top + edge);
    ctx.fill();
    ctx.stroke();
  }
  if (joins.s) {
    ctx.beginPath();
    ctx.rect(cx - boardW / 2, base - size * 0.1, boardW, top + size + edge - base + size * 0.1);
    ctx.fill();
    ctx.stroke();
  }
  // The post, pointed on top, with a little shade down one side.
  ctx.beginPath();
  ctx.moveTo(cx - postW / 2, base);
  ctx.lineTo(cx - postW / 2, postTop + postW * 0.5);
  ctx.lineTo(cx, postTop);
  ctx.lineTo(cx + postW / 2, postTop + postW * 0.5);
  ctx.lineTo(cx + postW / 2, base);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = "rgba(70, 40, 18, 0.14)";
  ctx.fillRect(
    cx + postW * 0.12,
    postTop + postW * 0.5,
    postW * 0.38,
    base - postTop - postW * 0.5,
  );
}

/** A garden bench from the front: two backrest slats, a seat, legs, and arms. */
function paintBench(ctx: CanvasRenderingContext2D, left: number, top: number, size: number) {
  const green = BLOCK_COLORS.bench;
  const x = left + size * 0.06;
  const w = size * 0.88;
  const base = top + size * 0.9;
  ctx.fillStyle = WOOD_DARK;
  for (const fx of [0.14, 0.82])
    ctx.fillRect(x + w * fx, top + size * 0.55, size * 0.07, base - top - size * 0.55);
  for (const fx of [0.18, 0.78])
    ctx.fillRect(x + w * fx, top + size * 0.2, size * 0.05, size * 0.4);
  ctx.fillStyle = green;
  for (const fy of [0.16, 0.33]) {
    ctx.beginPath();
    ctx.roundRect(x + w * 0.06, top + size * fy, w * 0.88, size * 0.12, size * 0.03);
    ctx.fill();
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.roundRect(x, top + size * 0.52, w, size * 0.14, size * 0.04);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = "rgba(255, 250, 235, 0.35)";
  for (const fy of [0.17, 0.34, 0.53])
    ctx.fillRect(x + w * 0.1, top + size * fy, w * 0.8, Math.max(1, size * 0.03));
}

/** A bale of straw from the front, tied twice with twine (RFC 0017). */
function paintHayBale(ctx: CanvasRenderingContext2D, left: number, top: number, size: number) {
  const x = left + size * 0.08;
  const w = size * 0.84;
  const y = top + size * 0.44;
  const h = size * 0.46;
  const lid = size * 0.16;
  ctx.fillStyle = "#f0d68e";
  ctx.beginPath();
  ctx.roundRect(x, y - lid, w, lid + size * 0.04, size * 0.05);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = BLOCK_COLORS.hay_bale;
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, size * 0.06);
  ctx.fill();
  ctx.stroke();
  ctx.strokeStyle = WOOD_DARK;
  ctx.lineWidth = Math.max(1, size * 0.04);
  ctx.beginPath();
  for (const fx of [0.3, 0.7]) {
    ctx.moveTo(x + w * fx, y - lid);
    ctx.lineTo(x + w * fx, y + h);
  }
  ctx.stroke();
  ctx.strokeStyle = "rgba(150, 105, 40, 0.55)";
  ctx.lineWidth = Math.max(1, size * 0.025);
  ctx.beginPath();
  for (const [fx, fy, len] of [
    [0.12, 0.62, 0.1],
    [0.42, 0.74, 0.12],
    [0.78, 0.58, 0.1],
    [0.18, 0.82, 0.08],
  ] as const) {
    ctx.moveTo(left + size * fx, top + size * fy);
    ctx.lineTo(left + size * (fx + len), top + size * fy);
  }
  ctx.stroke();
}

/** A scarecrow on its post: a patched red shirt, a burlap head, and a straw hat (RFC 0017). */
function paintScarecrow(
  ctx: CanvasRenderingContext2D,
  left: number,
  top: number,
  size: number,
  outline: number,
) {
  const cx = left + size / 2;
  const base = top + size * 0.92;
  const edge = "rgba(70, 40, 18, 0.55)";
  ctx.strokeStyle = WOOD_DARK;
  ctx.lineWidth = Math.max(1.5, size * 0.07);
  ctx.beginPath();
  ctx.moveTo(cx, base);
  ctx.lineTo(cx, top + size * 0.3);
  ctx.moveTo(cx - size * 0.38, top + size * 0.44);
  ctx.lineTo(cx + size * 0.38, top + size * 0.44);
  ctx.stroke();
  ctx.strokeStyle = edge;
  ctx.lineWidth = outline;
  ctx.fillStyle = BLOCK_COLORS.scarecrow;
  ctx.beginPath();
  ctx.moveTo(cx - size * 0.28, top + size * 0.38);
  ctx.lineTo(cx + size * 0.28, top + size * 0.38);
  ctx.lineTo(cx + size * 0.19, top + size * 0.74);
  ctx.lineTo(cx - size * 0.19, top + size * 0.74);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = BRAND_HEX.sun;
  ctx.fillRect(cx + size * 0.04, top + size * 0.52, size * 0.1, size * 0.1);
  ctx.fillStyle = "#d9bf8f";
  ctx.beginPath();
  ctx.arc(cx, top + size * 0.27, size * 0.12, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = "#e8c878";
  ctx.beginPath();
  ctx.roundRect(cx - size * 0.21, top + size * 0.15, size * 0.42, size * 0.06, size * 0.03);
  ctx.roundRect(cx - size * 0.1, top + size * 0.05, size * 0.2, size * 0.12, size * 0.03);
  ctx.fill();
  ctx.stroke();
}

// Stable hue per owner so neighbors' plots are easy to tell apart.
function ownerHue(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) % 360;
  return h;
}

const labelWidths = new Map<string, number>();
function labelWidth(ctx: CanvasRenderingContext2D, font: string, text: string): number {
  const key = `${font}|${text}`;
  let w = labelWidths.get(key);
  if (w === undefined) {
    if (labelWidths.size > 400) labelWidths.clear();
    w = ctx.measureText(text).width;
    labelWidths.set(key, w);
  }
  return w;
}

export interface RenderState {
  mirror: Mirror;
  me: string | undefined;
  cam: Camera;
  buildMode: boolean;
  /** Phase of the day, 0 to 1. Absent when the server gave no time anchor. */
  dayPhase?: number;
  /** What each figure feels, at `now` (milliseconds). Without it every face is neutral. */
  feelings?: Feelings;
  /** How residents move between tiles, and what they say. */
  motion: Motion;
  /** The frame's time, in ms. */
  now: number;
  /** Reduced motion: faces, signs, and bubbles stay; slides, bounces, blinks, and drifting go. */
  still: boolean;
  /** The world's season, for the ground. Absent: today's look. */
  season?: Season | undefined;
  /** How much cloud, rain, snow, and fog to draw (`weather.ts`). Absent: a clear sky. */
  sky?: SkyAmounts | undefined;
}

/** Reused every frame, so drawing figures allocates nothing. */
const posed = restingPose();
const face: FigureFace = {};

/** A feeling's floating sign on its paper disc, `px` device pixels square, drawn once. */
function iconSprite(icon: FeelingIcon, px: number): HTMLCanvasElement {
  return sprite(`icon|${icon}|${px}`, px, px, (ctx) => {
    ctx.translate(px / 2, px / 2);
    drawFeelingIcon(ctx, icon, px);
  });
}

export function render(
  ctx: CanvasRenderingContext2D,
  { mirror, me, cam, buildMode, dayPhase, feelings, motion, now, still, season, sky }: RenderState,
) {
  const { width, height, scale } = cam;
  const { config, commons } = mirror;
  const S = config.plotSize;
  ctx.fillStyle = OUTSIDE_GROUND;
  ctx.fillRect(0, 0, width, height);

  // Visible tile range.
  const x0 = Math.max(0, Math.floor(cam.cx - width / scale / 2) - 1);
  const x1 = Math.min(config.width - 1, Math.ceil(cam.cx + width / scale / 2) + 1);
  const y0 = Math.max(0, Math.floor(cam.cy - height / scale / 2) - 1);
  const y1 = Math.min(config.height - 1, Math.ceil(cam.cy + height / scale / 2) + 1);
  const half = scale / 2;

  // ---- ground: one fillRect per tile, edges rounded so neighbors share pixels (no seams) ----
  const tufts = new Path2D();
  const flowers: [Path2D, Path2D] = [new Path2D(), new Path2D()];
  const leaves: [Path2D, Path2D, Path2D] = [new Path2D(), new Path2D(), new Path2D()];
  // Phase 1 gathering: fallen branches and loose stones, from the sim's own spawn function.
  const sticks = new Path2D();
  const pebbles = new Path2D();
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const { sx, sy } = tileToScreen(cam, x, y);
      const left = Math.round(sx - half);
      const top = Math.round(sy - half);
      const w = Math.round(sx + half) - left;
      const h = Math.round(sy + half) - top;
      const inCommons = Math.floor(x / S) === commons.px && Math.floor(y / S) === commons.py;
      // Tone and scenery come from the sim's palette, shared with the plot photos.
      const ground = groundTile(config, x, y, inCommons, season);
      ctx.fillStyle = ground.fill;
      ctx.fillRect(left, top, w, h);
      const deco = ground.scenery;
      if (deco?.kind === "tuft") {
        // A little tuft of grass.
        const bx = left + w * deco.fx;
        const by = top + h * 0.72;
        tufts.moveTo(bx - w * 0.08, by);
        tufts.lineTo(bx - w * 0.12, by - h * 0.14);
        tufts.moveTo(bx, by);
        tufts.lineTo(bx, by - h * 0.2);
        tufts.moveTo(bx + w * 0.08, by);
        tufts.lineTo(bx + w * 0.13, by - h * 0.13);
      } else if (deco?.kind === "flower") {
        const fx = left + w * deco.fx;
        const fy = top + h * deco.fy;
        const path = flowers[deco.tone] as Path2D;
        path.moveTo(fx + scale * 0.06, fy);
        path.arc(fx, fy, scale * 0.06, 0, Math.PI * 2);
      } else if (deco?.kind === "leaf") {
        // A fallen leaf: two curves from tip to tip, as the plot photos draw it.
        leafPath(leaves[deco.tone] as Path2D, left + w * deco.fx, top + h * deco.fy, deco.turn, w);
      }
      const pickup = mirror.pickupAt(x, y);
      if (pickup) {
        const px = left + w * 0.5;
        const py = top + h * 0.55;
        if (pickup === "wood") {
          // A fallen branch: two crossed sticks.
          sticks.moveTo(px - w * 0.13, py + h * 0.07);
          sticks.lineTo(px + w * 0.13, py - h * 0.07);
          sticks.moveTo(px - w * 0.1, py - h * 0.09);
          sticks.lineTo(px + w * 0.11, py + h * 0.1);
        } else {
          // A loose stone: one low pebble.
          pebbles.moveTo(px + scale * 0.12, py);
          pebbles.ellipse(px, py, scale * 0.12, scale * 0.085, 0, 0, Math.PI * 2);
        }
      }
    }
  }
  ctx.lineCap = "round";
  ctx.lineWidth = Math.max(1, scale / 24);
  ctx.strokeStyle = tuftStroke(season);
  ctx.stroke(tufts);
  ctx.fillStyle = FLOWER_TONES[0];
  ctx.fill(flowers[0]);
  ctx.fillStyle = FLOWER_TONES[1];
  ctx.fill(flowers[1]);
  for (const [i, path] of leaves.entries()) {
    ctx.fillStyle = LEAF_TONES[i] as string;
    ctx.fill(path);
  }
  // Pickups sit on ground of their own color (forest, stone), so each gets a soft ink edge.
  ctx.globalAlpha = 0.45;
  ctx.strokeStyle = INK;
  ctx.lineWidth = Math.max(3, scale / 8);
  ctx.stroke(sticks);
  ctx.lineWidth = Math.max(1, scale / 24);
  ctx.stroke(pebbles);
  ctx.globalAlpha = 1;
  ctx.lineWidth = Math.max(1.5, scale / 14);
  ctx.strokeStyle = blockFill("wood");
  ctx.stroke(sticks);
  ctx.fillStyle = blockFill("stone");
  ctx.fill(pebbles);

  // ---- plots: owner tint plus a dashed clay border; faint lines between unclaimed plots ----
  const px0 = Math.floor(x0 / S);
  const px1 = Math.floor(x1 / S);
  const py0 = Math.floor(y0 / S);
  const py1 = Math.floor(y1 / S);
  const plotPx = S * scale;
  for (let py = py0; py <= py1; py++) {
    for (let px = px0; px <= px1; px++) {
      const { sx, sy } = tileToScreen(cam, px * S, py * S);
      const left = Math.round(sx - half);
      const top = Math.round(sy - half);
      const owner = mirror.plots.get(plotKey(px, py));
      const isCommons = px === commons.px && py === commons.py;
      ctx.setLineDash([]);
      if (owner) {
        const mine = owner === me;
        const theme = mirror.residents.get(owner)?.theme;
        // A theme tints the whole plot; otherwise a stable hue per owner tells neighbors apart.
        ctx.fillStyle = theme
          ? withAlpha(THEME_INFO[theme].palette.ground, THEME_TINT_ALPHA)
          : mine
            ? "rgba(255, 238, 196, 0.32)"
            : `hsla(${ownerHue(owner)}, 65%, 72%, 0.2)`;
        ctx.fillRect(left, top, plotPx, plotPx);
        ctx.setLineDash([scale * 0.28, scale * 0.2]);
        ctx.lineWidth = mine ? 2.5 : 1.75;
        ctx.strokeStyle = mine ? CLAY_DEEP : "rgba(180, 83, 47, 0.75)";
        ctx.strokeRect(left + 2, top + 2, plotPx - 4, plotPx - 4);
      } else if (isCommons) {
        ctx.setLineDash([scale * 0.12, scale * 0.18]);
        ctx.lineWidth = 2;
        ctx.strokeStyle = "rgba(201, 150, 62, 0.75)";
        ctx.strokeRect(left + 2, top + 2, plotPx - 4, plotPx - 4);
      } else {
        ctx.lineWidth = 1;
        ctx.strokeStyle = "rgba(70, 96, 48, 0.14)";
        ctx.strokeRect(left + 0.5, top + 0.5, plotPx, plotPx);
      }
    }
  }
  ctx.setLineDash([]);

  // ---- blocks: raised tiles with a ground shadow, top highlight and bottom shade ----
  // Blocks on a themed plot (or one with its owner's own pattern) are drawn once into a sprite.
  const dpr = ctx.getTransform().a || 1;
  const inset = Math.max(1, Math.round(scale * 0.05));
  const lip = Math.max(2, Math.round(scale * 0.16));
  const skins = new Map<string, BlockSkin | null>();
  const skinOf = (owner: string | undefined): BlockSkin | null => {
    if (!owner) return null;
    let skin = skins.get(owner);
    if (skin === undefined) {
      const r = mirror.residents.get(owner);
      const image = lookImage(r?.patternMedia);
      skin =
        r?.theme || image
          ? {
              ...(r?.theme ? { theme: r.theme, palette: THEME_INFO[r.theme].palette } : {}),
              ...(image && r?.patternMedia ? { image, imageId: r.patternMedia } : {}),
            }
          : null;
      skins.set(owner, skin);
    }
    return skin;
  };
  /** Lanterns on screen, which glow after dark. */
  const lanterns: { sx: number; sy: number }[] = [];
  const isFence = (x: number, y: number) => mirror.blocks.get(tileKey(x, y)) === "fence";
  for (const [key, block] of mirror.blocks) {
    const [x, y] = key.split(",").map(Number) as [number, number];
    if (x < x0 || x > x1 || y < y0 || y > y1) continue;
    const { sx, sy } = tileToScreen(cam, x, y);
    const left = Math.round(sx - half) + inset;
    const top = Math.round(sy - half) + inset;
    const size = Math.round(scale) - inset * 2;
    // A pedestal is a little plinth; whatever's on display stands on it (RFC 0005 step 3).
    if (block === "pedestal") {
      paintPedestal(ctx, left, top, size, scale);
      const shown = mirror.displays.get(key);
      if (shown) paintShown(ctx, shown.good, left, top, size, "pedestal");
      continue;
    }
    if (isDecorKind(block)) {
      const joins = {
        n: isFence(x, y - 1),
        e: isFence(x + 1, y),
        s: isFence(x, y + 1),
        w: isFence(x - 1, y),
      };
      paintDecor(ctx, block, left, top, size, scale, inset, joins);
      // A frame shows what hangs in it in place of its own little landscape.
      const shown = block === "frame" ? mirror.displays.get(key) : undefined;
      if (shown) paintShown(ctx, shown.good, left, top, size, "frame");
      if (block === "lantern") lanterns.push({ sx: left + size * 0.64, sy: top + size * 0.42 });
      continue;
    }
    const skin = block === "glass" ? null : skinOf(mirror.ownerAt(x, y));
    if (!skin) paintBlock(ctx, block, left, top, size, scale);
    else {
      const w = size + 2;
      const h = size + lip + 2;
      const art = sprite(
        `blk|${block}|${skin.theme ?? ""}|${skin.imageId ?? ""}|${size}|${scale.toFixed(2)}|${dpr}`,
        w * dpr,
        h * dpr,
        (c) => {
          c.scale(dpr, dpr);
          paintBlock(c, block, 0, 0, size, scale, skin);
        },
      );
      ctx.drawImage(art, left, top, w, h);
    }
    // Something growing in a planter: drawn from the world's day, so it grows at midnight UTC.
    const planting = block === "planter" ? mirror.crops.get(key) : undefined;
    if (planting) {
      paintCrop(
        ctx,
        planting.crop,
        growth(planting.plantedDay, planting.readyDay, mirror.day),
        left,
        top,
        size,
      );
    }
    // Built by the town: a little sun-gold rosette in the corner.
    if (mirror.townBuilt.has(key)) {
      const r = Math.max(2.5, scale * 0.11);
      ctx.fillStyle = BRAND_HEX.sun;
      ctx.strokeStyle = PAPER;
      ctx.lineWidth = Math.max(1, scale / 28);
      ctx.beginPath();
      ctx.arc(left + size - r * 1.3, top + r * 1.3, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
  }

  drawTownHall(ctx, mirror, cam);
  drawShop(ctx, mirror, cam);

  // ---- hearths: a little house, drawn under residents ----
  for (const r of mirror.residents.values()) {
    if (!r.hearth) continue;
    const { sx, sy } = tileToScreen(cam, r.hearth.x, r.hearth.y);
    if (sx < -scale || sy < -scale || sx > width + scale || sy > height + scale) continue;
    ctx.fillStyle = "rgba(74, 52, 28, 0.2)";
    ctx.beginPath();
    ctx.ellipse(sx, sy + half * 0.62, half * 0.62, half * 0.16, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = PAPER;
    ctx.fillRect(sx - half * 0.52, sy - half * 0.2, half * 1.04, half * 0.78);
    ctx.fillStyle = HEARTH_DOOR;
    ctx.beginPath();
    ctx.roundRect(sx - half * 0.14, sy + half * 0.12, half * 0.28, half * 0.46, half * 0.08);
    ctx.fill();
    ctx.fillStyle = HEARTH_COLOR;
    ctx.beginPath();
    ctx.moveTo(sx - half * 0.72, sy - half * 0.12);
    ctx.lineTo(sx, sy - half * 0.78);
    ctx.lineTo(sx + half * 0.72, sy - half * 0.12);
    ctx.closePath();
    ctx.fill();
  }

  // ---- home pictures: a resident's own art of their home, standing over their hearth ----
  for (const [key, owner] of mirror.plots) {
    const r = mirror.residents.get(owner);
    const img = lookImage(r?.homeArt);
    if (!r?.homeArt || !img) continue;
    const [px, py] = key.split(",").map(Number) as [number, number];
    const onPlot =
      r.hearth && Math.floor(r.hearth.x / S) === px && Math.floor(r.hearth.y / S) === py;
    const middle = Math.floor((S - 1) / 2);
    const anchor = onPlot && r.hearth ? r.hearth : { x: px * S + middle, y: py * S + middle };
    const { sx, sy } = tileToScreen(cam, anchor.x, anchor.y);
    const max = scale * Math.min(3.6, S - 1);
    const fit = Math.min(max / img.naturalWidth, max / img.naturalHeight);
    const w = img.naturalWidth * fit;
    const h = img.naturalHeight * fit;
    const bottom = sy + half * 0.95;
    if (sx + w / 2 < 0 || sx - w / 2 > width || bottom < 0 || bottom - h > height) continue;
    ctx.fillStyle = "rgba(74, 52, 28, 0.22)";
    ctx.beginPath();
    ctx.ellipse(sx, bottom, w * 0.42, Math.max(3, scale * 0.16), 0, 0, Math.PI * 2);
    ctx.fill();
    const art = sprite(`home|${r.homeArt}|${Math.round(w)}|${dpr}`, w * dpr, h * dpr, (c) =>
      c.drawImage(img, 0, 0, w * dpr, h * dpr),
    );
    ctx.drawImage(art, sx - w / 2, bottom - h, w, h);
  }

  const self = me ? mirror.residents.get(me) : undefined;
  if (buildMode && self) {
    const r = config.reach;
    const { sx, sy } = tileToScreen(cam, self.x - r, self.y - r);
    ctx.setLineDash([scale * 0.22, scale * 0.16]);
    ctx.strokeStyle = "rgba(255, 250, 240, 0.95)";
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.roundRect(sx - half, sy - half, scale * (2 * r + 1), scale * (2 * r + 1), scale * 0.25);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // ---- residents: little figures in their looks, each a cached sprite, north to south ----
  const labels: {
    text: string;
    x: number;
    y: number;
    mine: boolean;
    top?: number;
    /** A resident's tag: what they say goes over it. */
    who?: string;
    /** The feeling's sign over the tag, how faded it is, and how far it has drifted up. */
    icon?: FeelingIcon | undefined;
    fade?: number;
    rise?: number;
    /** Asleep at home while away: the tag and sign are drawn fainter. */
    away?: boolean;
  }[] = [];
  const hall = tilesBox(mirror.townHall, cam);
  if (hall)
    labels.push({ text: "Town Hall", x: hall.left + hall.w / 2, y: hall.top - 2, mine: false });
  const shop = tilesBox(mirror.shop, cam);
  if (shop) labels.push({ text: "Shop", x: shop.left + shop.w / 2, y: shop.top - 2, mine: false });
  // `m` is how they move between tiles (`motion.ts`); `p` below is their face (`feelings.ts`).
  const shown: { r: Resident; m: MotionPose; away: boolean }[] = [];
  const online = new Set<string>();
  const onScreen = (m: MotionPose) => {
    const { sx, sy } = tileToScreen(cam, m.x, m.y);
    return sx >= -scale && sy >= -scale && sx <= width + scale && sy <= height + scale * 1.5;
  };
  for (const r of mirror.residents.values()) {
    if (!r.online) continue;
    online.add(r.id);
    const m = motion.pose(r, now, still);
    if (onScreen(m)) shown.push({ r, m, away: false });
  }
  motion.keep(online);
  // Residents who are away sleep at their hearths, faded (decision 0086). Drawn, never counted.
  for (const d of mirror.asleep(me)) {
    const m = awayPose(d.r.id, d.x, d.y, now, still);
    if (onScreen(m)) shown.push({ r: d.r, m, away: true });
  }
  shown.sort((a, b) => a.m.y - b.m.y || a.m.x - b.m.x);
  // Umbrellas go up in the rain and are carried rolled up otherwise.
  const raining = (sky?.rain ?? 0) >= UMBRELLA_RAIN;
  for (const { r, m, away } of shown) {
    const { sx, sy } = tileToScreen(cam, m.x, m.y);
    const feet = sy + scale * 0.38;
    const mine = r.id === me;
    if (mine) {
      ctx.fillStyle = "rgba(242, 184, 75, 0.45)";
      ctx.beginPath();
      ctx.ellipse(sx, feet - scale * 0.02, scale * 0.42, scale * 0.17, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    // The shadow stays on the ground and shrinks as they hop.
    const shade = Math.max(0.5, 1 - m.lift * 2.5) * (away ? 0.6 : 1);
    ctx.fillStyle = `rgba(60, 40, 20, ${(0.24 * shade).toFixed(3)})`;
    ctx.beginPath();
    ctx.ellipse(sx, feet, scale * 0.27 * shade, scale * 0.085 * shade, 0, 0, Math.PI * 2);
    ctx.fill();
    if (m.poof !== undefined) drawPoof(ctx, sx, feet, scale, m.poof);
    if (m.dust) {
      const at = tileToScreen(cam, m.dust.x, m.dust.y);
      drawDust(ctx, at.sx, at.sy + scale * 0.38, scale, m.dust.t);
    }
    // The face of the moment: a feeling, a blink, a wave, a bounce (RFC 0013). Dozing is `sleepy`.
    const p = pose(feelings?.get(r.id, now) ?? m.doze, now, idPhase(r.id), still, posed);
    face.feeling = p.feeling;
    face.blink = p.blink;
    face.wave = p.wave;
    // Out in the rain an umbrella goes up; asleep at home it stays rolled up beside them.
    face.furled = (away || !raining) && (r.wear?.includes("umbrella") ?? false);
    // The way they're walking, or the server's word for someone who hasn't moved since. Asleep
    // at home, they face out of the door (`awayPose`).
    const facing = m.facing ?? mirror.facing.get(r.id) ?? "s";
    const turned = fourWayFacing(facing);
    const side = turned === "e" ? 1 : turned === "w" ? -1 : 0;
    const fig = figureSprite(r, scale, dpr, facing, face, away);
    const ground = feet - (p.lift + m.lift) * scale;
    // Leaning, swaying, and squashing from the feet.
    ctx.save();
    ctx.translate(sx, ground);
    ctx.rotate(p.tilt * 0.5 + m.sway + m.lean * side);
    ctx.scale(m.squash, 1 / m.squash);
    ctx.drawImage(fig.canvas, fig.dx, fig.dy, fig.w, fig.h);
    ctx.restore();
    labels.push({
      text: r.kind === "agent" ? `${r.name} ⚙` : r.name,
      x: sx,
      y: feet + fig.dy - 1,
      mine,
      who: r.id,
      icon: FEELING_ICON[p.feeling],
      fade: p.fade,
      rise: p.rise,
      away,
    });
  }

  // ---- the weather: cloud, mist, rain, and snow, under the night and the name tags ----
  if (sky) {
    const blocks = mirror.blocks;
    drawWeather(ctx, {
      cam,
      sky,
      now,
      still,
      open: (x, y) => !blocks.has(tileKey(x, y)),
    });
  }

  // ---- light: warm glow at dawn and dusk, dusky violet at night, hearths glow after dark ----
  if (dayPhase !== undefined) {
    const night = nightAmount(dayPhase);
    const golden = Math.sin(Math.PI * night);
    if (golden > 0.02) {
      ctx.fillStyle = `rgba(242, 146, 82, ${(0.13 * golden).toFixed(3)})`;
      ctx.fillRect(0, 0, width, height);
    }
    if (night > 0.02) {
      // Multiply keeps hues (a clay roof stays warm) while pulling everything toward dusky
      // violet-blue, then a thin violet glaze. Capped so the world stays readable at midnight.
      const k = night * 0.78;
      const r = Math.round(255 - k * 143);
      const g = Math.round(255 - k * 151);
      const b = Math.round(255 - k * 59);
      ctx.globalCompositeOperation = "multiply";
      ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;
      ctx.fillRect(0, 0, width, height);
      ctx.globalCompositeOperation = "source-over";
      ctx.fillStyle = `rgba(84, 62, 168, ${(0.14 * night).toFixed(3)})`;
      ctx.fillRect(0, 0, width, height);
    }
    if (night > 0.25) {
      ctx.globalCompositeOperation = "lighter";
      const strength = (night - 0.25) / 0.75;
      for (const r of mirror.residents.values()) {
        if (!r.hearth) continue;
        const { sx, sy } = tileToScreen(cam, r.hearth.x, r.hearth.y);
        if (sx < -scale * 3 || sy < -scale * 3 || sx > width + scale * 3 || sy > height + scale * 3)
          continue;
        const g = ctx.createRadialGradient(sx, sy, 0, sx, sy, scale * 2.4);
        g.addColorStop(0, `rgba(242, 170, 80, ${(0.42 * strength).toFixed(3)})`);
        g.addColorStop(1, "rgba(242, 170, 80, 0)");
        ctx.fillStyle = g;
        ctx.fillRect(sx - scale * 2.4, sy - scale * 2.4, scale * 4.8, scale * 4.8);
      }
      ctx.globalCompositeOperation = "source-over";
    }
    // Paper lanterns and the shop's windows light up a little before the hearths do.
    if (night > 0.15) {
      ctx.globalCompositeOperation = "lighter";
      const strength = Math.min(1, (night - 0.15) / 0.6);
      const glow = (sx: number, sy: number, reach: number, alpha: number) => {
        const g = ctx.createRadialGradient(sx, sy, 0, sx, sy, reach);
        g.addColorStop(0, `rgba(255, 196, 92, ${(alpha * strength).toFixed(3)})`);
        g.addColorStop(0.25, `rgba(242, 181, 68, ${(alpha * 0.55 * strength).toFixed(3)})`);
        g.addColorStop(1, "rgba(242, 170, 80, 0)");
        ctx.fillStyle = g;
        ctx.fillRect(sx - reach, sy - reach, reach * 2, reach * 2);
      };
      for (const l of lanterns) glow(l.sx, l.sy, scale * 2, 0.62);
      const box = tilesBox(mirror.shop, cam);
      if (box) {
        for (const f of [0.255, 0.745])
          glow(box.left + box.w * f, box.top + box.h * 0.7, scale * 1.1, 0.4);
      }
      ctx.globalCompositeOperation = "source-over";
    }
  }

  // ---- name labels on little paper tags, above the night so they stay readable ----
  // Canvas text can't execute anything, so names are safe to draw as-is.
  const fontSize = Math.max(11, Math.round(scale / 3.4));
  const font = `600 ${fontSize}px "Figtree Variable", system-ui, sans-serif`;
  ctx.font = font;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const padX = fontSize * 0.55;
  const tagH = fontSize + 8;
  // Nudge a tag up when it, or the sign over it, would sit on a neighbor's tag or sign, so names
  // next to each other stay legible. Someone asleep at home wears their sign beside the name
  // (`besideTag`), so neighbors asleep at one hearth keep their tags close.
  const sign = signPx(scale);
  const small = Math.round(sign * 0.8);
  const besideTag = (l: (typeof labels)[number], w: number, top: number): Box => ({
    left: l.x + w / 2 + 2,
    right: l.x + w / 2 + 2 + small,
    top: top + (tagH - small) / 2,
    bottom: top + (tagH + small) / 2,
  });
  labels.sort((a, b) => b.y - a.y || a.x - b.x);
  const placed: Box[] = [];
  const taken: Box[] = [];
  const widths: number[] = [];
  const clear = (box: Box) =>
    !taken.some(
      (t) =>
        box.left < t.right + 2 &&
        box.right > t.left - 2 &&
        box.top < t.bottom + 2 &&
        box.bottom > t.top - 2,
    );
  for (const l of labels) {
    const w = labelWidth(ctx, font, l.text) + padX * 2;
    const tagAt = (top: number): Box => ({
      left: l.x - w / 2,
      right: l.x + w / 2,
      top,
      bottom: top + tagH,
    });
    const signAt = (top: number): Box | undefined =>
      !l.icon
        ? undefined
        : l.away
          ? besideTag(l, w, top)
          : { left: l.x - sign / 2, right: l.x + sign / 2, top: top - sign - 1, bottom: top };
    let top = l.y - tagH;
    for (let tries = 0; tries < 4; tries++) {
      const over = signAt(top);
      if (clear(tagAt(top)) && (!over || clear(over))) break;
      top -= tagH + 3;
    }
    const tag = tagAt(top);
    const over = signAt(top);
    placed.push(tag);
    taken.push(tag, ...(over ? [over] : []));
    widths.push(w);
    l.top = top;
  }

  // ---- what people are saying, as text, in bubbles over their tags and signs ----
  // Bubbles stack clear of every tag and sign and of each other, the nearest speaker lowest. They
  // go down first, so a tag or sign sits on top of a raised bubble's tail.
  const avoid: Box[] = [...placed];
  const bubbles: { x: number; tip: number; lines: string[]; alpha: number; box: Box }[] = [];
  for (const [i, l] of labels.entries()) {
    if (l.top === undefined) continue;
    if (l.icon && l.away) avoid.push(besideTag(l, widths[i] ?? 0, l.top));
    // A bubble goes over the sign, so both show.
    const over = l.icon && !l.away ? sign + 1 + (l.rise ?? 0) * scale : 0;
    if (over)
      avoid.push({ left: l.x - sign / 2, right: l.x + sign / 2, top: l.top - over, bottom: l.top });
    const said = l.who && motion.bubble(l.who, now);
    if (!said) continue;
    const tip = l.top - 4 - over;
    const box = bubbleBox(ctx, l.x, tip, said.lines, fontSize, font, width);
    bubbles.push({ x: l.x, tip, lines: said.lines, alpha: said.alpha, box });
  }
  const raises = stackBubbles(
    bubbles.map((b) => b.box),
    avoid,
  );
  // Highest first, so a raised bubble's tail passes behind the bubbles below it.
  for (let i = bubbles.length - 1; i >= 0; i--) {
    const b = bubbles[i];
    if (b) drawBubble(ctx, b.x, b.tip, b.lines, b.alpha, fontSize, font, width, raises[i]);
  }

  ctx.font = font;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (const [i, l] of labels.entries()) {
    const top = l.top ?? l.y - tagH;
    const w = widths[i] ?? 0;
    ctx.globalAlpha = l.away ? AWAY_TAG_ALPHA : 1;
    ctx.fillStyle = "rgba(74, 52, 28, 0.16)";
    ctx.beginPath();
    ctx.roundRect(l.x - w / 2, top + 1.5, w, tagH, tagH / 2);
    ctx.fill();
    ctx.fillStyle = PAPER;
    ctx.strokeStyle = l.mine ? CLAY : PAPER_EDGE;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(l.x - w / 2, top, w, tagH, tagH / 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = l.mine ? CLAY_DEEP : INK;
    ctx.fillText(l.text, l.x, top + tagH / 2 + 0.5);
  }
  ctx.globalAlpha = 1;

  // ---- feelings' signs over the tags ----
  // Drawn after every tag and the night, so a neighbor's tag never covers a sign.
  for (const [i, l] of labels.entries()) {
    if (!l.icon || l.top === undefined) continue;
    if (l.away) {
      // Beside the name, drifting a little, faint like the tag.
      const at = besideTag(l, widths[i] ?? 0, l.top);
      ctx.globalAlpha = (l.fade ?? 1) * AWAY_TAG_ALPHA;
      ctx.drawImage(
        iconSprite(l.icon, Math.round(small * dpr)),
        at.left,
        at.top - (l.rise ?? 0) * scale * 0.4,
        small,
        small,
      );
    } else {
      ctx.globalAlpha = l.fade ?? 1;
      ctx.drawImage(
        iconSprite(l.icon, Math.round(sign * dpr)),
        l.x - sign / 2,
        l.top - sign - 1 - (l.rise ?? 0) * scale,
        sign,
        sign,
      );
    }
    ctx.globalAlpha = 1;
  }
  ctx.textBaseline = "alphabetic";
}

/** A building's footprint on screen, or undefined when it's off screen or unknown. */
function tilesBox(tiles: readonly { x: number; y: number }[], cam: Camera) {
  if (tiles.length === 0) return undefined;
  const xs = tiles.map((t) => t.x);
  const ys = tiles.map((t) => t.y);
  const half = cam.scale / 2;
  const a = tileToScreen(cam, Math.min(...xs), Math.min(...ys));
  const b = tileToScreen(cam, Math.max(...xs), Math.max(...ys));
  const left = a.sx - half;
  const top = a.sy - half;
  const w = b.sx + half - left;
  const h = b.sy + half - top;
  if (left > cam.width || top > cam.height || left + w < 0 || top + h < 0) return undefined;
  return { left, top, w, h };
}

/**
 * The Town Hall: a small storybook civic building on its tiles in the Commons. Columns under a clay
 * pediment, a gold door, stone steps, and a flag. It's drawn under the residents, like a hearth:
 * nobody walks onto it once buildings are solid, so whoever stands beside it is in front of it.
 */
function drawTownHall(ctx: CanvasRenderingContext2D, mirror: Mirror, cam: Camera) {
  const box = tilesBox(mirror.townHall, cam);
  if (!box) return;
  const { left, top, w, h } = box;
  const s = cam.scale;
  const base = top + h - s * 0.12;
  // Ground shadow.
  ctx.fillStyle = "rgba(74, 52, 28, 0.22)";
  ctx.beginPath();
  ctx.ellipse(left + w / 2, base + s * 0.04, w * 0.46, s * 0.16, 0, 0, Math.PI * 2);
  ctx.fill();
  // Steps.
  ctx.fillStyle = "#c9c2b5";
  ctx.beginPath();
  ctx.roundRect(left + w * 0.12, base - s * 0.2, w * 0.76, s * 0.22, s * 0.05);
  ctx.fill();
  ctx.fillStyle = "#b3ab9c";
  ctx.fillRect(left + w * 0.12, base - s * 0.03, w * 0.76, s * 0.05);
  // Body.
  const bodyTop = top + h * 0.42;
  const bodyLeft = left + w * 0.16;
  const bodyW = w * 0.68;
  ctx.fillStyle = PAPER;
  ctx.fillRect(bodyLeft, bodyTop, bodyW, base - s * 0.2 - bodyTop);
  ctx.strokeStyle = PAPER_EDGE;
  ctx.lineWidth = 1;
  ctx.strokeRect(bodyLeft + 0.5, bodyTop + 0.5, bodyW - 1, base - s * 0.2 - bodyTop - 1);
  // Columns.
  ctx.fillStyle = "#e8dfcc";
  const colW = bodyW * 0.07;
  for (const f of [0.08, 0.3, 0.63, 0.85]) {
    ctx.fillRect(
      bodyLeft + bodyW * f,
      bodyTop + s * 0.06,
      colW,
      base - s * 0.26 - bodyTop - s * 0.06,
    );
  }
  // Door: a gold arch in the middle.
  const doorW = bodyW * 0.2;
  const doorH = (base - s * 0.2 - bodyTop) * 0.62;
  ctx.fillStyle = BRAND_HEX.sun;
  ctx.beginPath();
  ctx.roundRect(left + w / 2 - doorW / 2, base - s * 0.2 - doorH, doorW, doorH, [
    doorW / 2,
    doorW / 2,
    0,
    0,
  ]);
  ctx.fill();
  // Pediment roof.
  const roofBase = bodyTop + s * 0.04;
  ctx.fillStyle = HEARTH_COLOR;
  ctx.beginPath();
  ctx.moveTo(left + w * 0.08, roofBase);
  ctx.lineTo(left + w / 2, top + h * 0.06);
  ctx.lineTo(left + w * 0.92, roofBase);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = CLAY_DEEP;
  ctx.fillRect(left + w * 0.08, roofBase - s * 0.02, w * 0.84, s * 0.08);
  // A round window in the pediment.
  ctx.fillStyle = PAPER;
  ctx.beginPath();
  ctx.arc(left + w / 2, top + h * 0.28, s * 0.1, 0, Math.PI * 2);
  ctx.fill();
  // Flag.
  const poleX = left + w / 2;
  ctx.strokeStyle = INK;
  ctx.lineWidth = Math.max(1, s / 30);
  ctx.beginPath();
  ctx.moveTo(poleX, top + h * 0.07);
  ctx.lineTo(poleX, top - s * 0.32);
  ctx.stroke();
  ctx.fillStyle = BRAND_HEX.moss;
  ctx.beginPath();
  ctx.moveTo(poleX, top - s * 0.32);
  ctx.lineTo(poleX + s * 0.3, top - s * 0.24);
  ctx.lineTo(poleX, top - s * 0.15);
  ctx.closePath();
  ctx.fill();
}

/**
 * The town shop (RFC 0008): a small storybook shop on its tiles on the Commons' south edge. Cream
 * walls under a moss roof, a striped awning, two windows with jars and fruit on the sill, a door,
 * and a sign hanging from a bracket. Like the Town Hall, it's drawn under the residents.
 */
function drawShop(ctx: CanvasRenderingContext2D, mirror: Mirror, cam: Camera) {
  const box = tilesBox(mirror.shop, cam);
  if (!box) return;
  const { left, top, w, h } = box;
  const s = cam.scale;
  const base = top + h - s * 0.1;
  const line = Math.max(1, s / 30);
  ctx.save();
  ctx.lineJoin = "round";
  // Ground shadow.
  ctx.fillStyle = "rgba(74, 52, 28, 0.22)";
  ctx.beginPath();
  ctx.ellipse(left + w / 2, base + s * 0.03, w * 0.48, s * 0.16, 0, 0, Math.PI * 2);
  ctx.fill();
  // Walls, on a stone footing.
  const bodyL = left + w * 0.07;
  const bodyR = left + w * 0.93;
  const bodyTop = top + h * 0.34;
  ctx.fillStyle = PAPER;
  ctx.strokeStyle = PAPER_EDGE;
  ctx.lineWidth = line;
  ctx.fillRect(bodyL, bodyTop, bodyR - bodyL, base - bodyTop);
  ctx.strokeRect(bodyL + 0.5, bodyTop + 0.5, bodyR - bodyL - 1, base - bodyTop - 1);
  ctx.fillStyle = "#c9c2b5";
  ctx.fillRect(bodyL, base - s * 0.1, bodyR - bodyL, s * 0.1);
  // A chimney, then the roof over it.
  ctx.fillStyle = CLAY;
  ctx.fillRect(left + w * 0.74, top + h * 0.02, w * 0.07, h * 0.2);
  ctx.fillStyle = CLAY_DEEP;
  ctx.fillRect(left + w * 0.73, top + h * 0.01, w * 0.09, h * 0.04);
  ctx.fillStyle = BRAND_HEX.moss;
  ctx.beginPath();
  ctx.moveTo(left + w * 0.02, bodyTop + s * 0.04);
  ctx.lineTo(left + w * 0.15, top + h * 0.1);
  ctx.lineTo(left + w * 0.85, top + h * 0.1);
  ctx.lineTo(left + w * 0.98, bodyTop + s * 0.04);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = "rgba(43, 38, 32, 0.22)";
  ctx.lineWidth = line;
  ctx.beginPath();
  for (const f of [0.35, 0.65]) {
    const y = top + h * 0.1 + (bodyTop - top - h * 0.1) * f;
    const inset = w * 0.13 * (1 - f);
    ctx.moveTo(left + w * 0.02 + inset, y);
    ctx.lineTo(left + w * 0.98 - inset, y);
  }
  ctx.stroke();
  ctx.fillStyle = BRAND_HEX.mossLight;
  ctx.fillRect(left + w * 0.15, top + h * 0.08, w * 0.7, h * 0.035);
  // The striped awning, scalloped along its edge.
  const awnL = left + w * 0.05;
  const awnR = left + w * 0.95;
  const awnTop = bodyTop + s * 0.06;
  const awnBottom = bodyTop + s * 0.3;
  const stripes = 9;
  const sw = (awnR - awnL) / stripes;
  // Its shade on the wall first, so the pale stripes stand off the pale wall.
  ctx.fillStyle = "rgba(74, 52, 28, 0.16)";
  ctx.fillRect(bodyL, awnBottom, bodyR - bodyL, sw * 0.75);
  ctx.strokeStyle = "rgba(143, 61, 32, 0.55)";
  ctx.lineWidth = line;
  for (let i = 0; i < stripes; i++) {
    ctx.fillStyle = i % 2 === 0 ? CLAY : BRAND_HEX.paper2;
    ctx.beginPath();
    ctx.moveTo(awnL + i * sw, awnTop);
    ctx.lineTo(awnL + (i + 1) * sw, awnTop);
    ctx.lineTo(awnL + (i + 1) * sw, awnBottom);
    ctx.arc(awnL + (i + 0.5) * sw, awnBottom, sw / 2, 0, Math.PI);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }
  ctx.fillStyle = CLAY_DEEP;
  ctx.fillRect(awnL, awnTop - s * 0.03, awnR - awnL, s * 0.05);
  // Two windows with things on the sill: jars on the left, fruit on the right.
  const winTop = awnBottom + s * 0.26;
  const winH = base - s * 0.22 - winTop;
  const windowAt = (fx: number, things: "jars" | "fruit") => {
    const ww = w * 0.24;
    const wx = left + w * fx - ww / 2;
    ctx.fillStyle = PAPER_EDGE;
    ctx.fillRect(wx - s * 0.04, winTop - s * 0.04, ww + s * 0.08, winH + s * 0.08);
    ctx.fillStyle = "#cfe6ee";
    ctx.fillRect(wx, winTop, ww, winH);
    ctx.fillStyle = "rgba(255, 255, 255, 0.55)";
    ctx.beginPath();
    ctx.moveTo(wx + ww * 0.1, winTop + winH * 0.55);
    ctx.lineTo(wx + ww * 0.45, winTop + winH * 0.05);
    ctx.lineTo(wx + ww * 0.6, winTop + winH * 0.05);
    ctx.lineTo(wx + ww * 0.25, winTop + winH * 0.55);
    ctx.fill();
    const sill = winTop + winH;
    ctx.fillStyle = WOOD_DARK;
    ctx.fillRect(wx - s * 0.06, sill - s * 0.02, ww + s * 0.12, s * 0.06);
    if (things === "jars") {
      const fills = [BRAND_HEX.sun, CLAY, BRAND_HEX.moss];
      fills.forEach((fill, i) => {
        const jx = wx + ww * (0.2 + i * 0.3);
        const jw = ww * 0.2;
        const jh = winH * 0.42;
        ctx.fillStyle = fill;
        ctx.beginPath();
        ctx.roundRect(jx - jw / 2, sill - s * 0.02 - jh, jw, jh, jw * 0.25);
        ctx.fill();
        ctx.fillStyle = PAPER;
        ctx.fillRect(jx - jw * 0.32, sill - s * 0.02 - jh * 0.62, jw * 0.64, jh * 0.3);
        ctx.fillStyle = "#c9a25a";
        ctx.fillRect(jx - jw * 0.55, sill - s * 0.02 - jh - jh * 0.16, jw * 1.1, jh * 0.18);
      });
    } else {
      const fruit = [CROP_HEX.lemon, CROP_HEX.tomato, CROP_HEX.lemon, CROP_HEX.strawberry];
      fruit.forEach((fill, i) => {
        ctx.fillStyle = fill;
        ctx.beginPath();
        ctx.arc(
          wx + ww * (0.18 + i * 0.21),
          sill - s * 0.02 - winH * 0.13,
          winH * 0.13,
          0,
          Math.PI * 2,
        );
        ctx.fill();
      });
    }
    // A box of flowers under the window.
    ctx.fillStyle = "#9a6b43";
    ctx.fillRect(wx, sill + s * 0.04, ww, s * 0.09);
    ctx.fillStyle = CROP_HEX.flower;
    for (let i = 0; i < 4; i++) {
      ctx.beginPath();
      ctx.arc(wx + ww * (0.14 + i * 0.24), sill + s * 0.04, s * 0.045, 0, Math.PI * 2);
      ctx.fill();
    }
  };
  windowAt(0.255, "jars");
  windowAt(0.745, "fruit");
  // The door, with a round window and a gold knob, over a stone step.
  const doorW = w * 0.15;
  const doorTop = awnBottom + s * 0.18;
  const doorL = left + w / 2 - doorW / 2;
  ctx.fillStyle = "#c9c2b5";
  ctx.beginPath();
  ctx.roundRect(doorL - s * 0.08, base - s * 0.08, doorW + s * 0.16, s * 0.12, s * 0.03);
  ctx.fill();
  ctx.fillStyle = BRAND_HEX.moss;
  ctx.beginPath();
  ctx.roundRect(doorL, doorTop, doorW, base - s * 0.06 - doorTop, [
    doorW * 0.45,
    doorW * 0.45,
    0,
    0,
  ]);
  ctx.fill();
  ctx.fillStyle = "#cfe6ee";
  ctx.beginPath();
  ctx.arc(left + w / 2, doorTop + doorW * 0.5, doorW * 0.24, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = BRAND_HEX.sun;
  ctx.beginPath();
  ctx.arc(
    doorL + doorW * 0.78,
    doorTop + (base - doorTop) * 0.6,
    Math.max(1.2, s * 0.035),
    0,
    Math.PI * 2,
  );
  ctx.fill();
  // A sign hanging from a bracket on the corner: a jar on a paper board.
  const armY = bodyTop + s * 0.42;
  const armX = bodyR + w * 0.06;
  ctx.strokeStyle = INK;
  ctx.lineWidth = Math.max(1, s / 26);
  ctx.beginPath();
  ctx.moveTo(bodyR, armY);
  ctx.lineTo(armX, armY);
  ctx.moveTo(armX - w * 0.04, armY);
  ctx.lineTo(armX - w * 0.04, armY + s * 0.08);
  ctx.stroke();
  const signW = s * 0.42;
  const signH = s * 0.36;
  const signX = armX - w * 0.04 - signW / 2;
  const signY = armY + s * 0.08;
  ctx.fillStyle = PAPER;
  ctx.strokeStyle = CLAY;
  ctx.lineWidth = Math.max(1, s / 22);
  ctx.beginPath();
  ctx.roundRect(signX, signY, signW, signH, s * 0.06);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = BRAND_HEX.sun;
  ctx.beginPath();
  ctx.roundRect(signX + signW * 0.32, signY + signH * 0.3, signW * 0.36, signH * 0.5, signW * 0.08);
  ctx.fill();
  ctx.fillStyle = CLAY;
  ctx.fillRect(signX + signW * 0.28, signY + signH * 0.2, signW * 0.44, signH * 0.14);
  ctx.restore();
}
