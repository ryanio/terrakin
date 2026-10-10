import { BLOCK_COLORS, type DecorKind } from "@terrakin/sim";
import { BRAND_HEX, STRAW } from "@terrakin/ui/brand";
import { type ArtKind, itemArtImage, type ThingLook } from "@terrakin/ui/item-art";
import { lookImage } from "@terrakin/ui/looks";
import { paintBatBunting, paintCandyBowl, paintCauldron } from "./decor-halloween";
import { paintLittleFir, paintSled, paintSnowman, paintStringLights } from "./decor-winter";
import { CLAY, PAPER, WOOD_DARK } from "./palette";

// ---------- decor from the town shop (RFC 0008) ----------

/** Which neighbors a fence post joins: the four sides that hold a fence too. */
export interface Joins {
  n: boolean;
  e: boolean;
  s: boolean;
  w: boolean;
}

/**
 * A decor block on its tile, drawn as itself rather than a square: a paper lantern on a hook, a
 * picture on an easel, a fence post with rails out to the fences beside it, a garden bench,
 * autumn's hay bale and scarecrow, Halloween's bat bunting, cauldron, and candy bowl, or winter's
 * snowman, string of lights, little fir, and sled.
 * `left`, `top`, and `size` are the block's box; `edge` is the gap to the tile's edge, so fence
 * rails reach their neighbors' rails.
 */
export function paintDecor(
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
  else if (kind === "bat_bunting") paintBatBunting(ctx, left, top, size);
  else if (kind === "cauldron") paintCauldron(ctx, left, top, size);
  else if (kind === "candy_bowl") paintCandyBowl(ctx, left, top, size);
  else if (kind === "snowman") paintSnowman(ctx, left, top, size, outline);
  else if (kind === "string_lights") paintStringLights(ctx, left, top, size);
  else if (kind === "little_fir") paintLittleFir(ctx, left, top, size);
  else if (kind === "sled") paintSled(ctx, left, top, size);
  else paintBench(ctx, left, top, size);
  ctx.restore();
}

/** Built by the town: a little sun-gold rosette in a block's corner, whatever the block. */
export function paintTownMark(
  ctx: CanvasRenderingContext2D,
  left: number,
  top: number,
  size: number,
  scale: number,
) {
  const r = Math.max(2.5, scale * 0.11);
  ctx.fillStyle = BRAND_HEX.sun;
  ctx.strokeStyle = PAPER;
  ctx.lineWidth = Math.max(1, scale / 28);
  ctx.beginPath();
  ctx.arc(left + size - r * 1.3, top + r * 1.3, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
}

/** A pale stone plinth for something on display. */
export function paintPedestal(
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
export function paintShown(
  ctx: CanvasRenderingContext2D,
  good: ThingLook,
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
 * A find lying on a tile (RFC 0021): a pale glint on the ground so it reads as something special
 * among the grass and leaves, its own picture, and a small four-pointed sparkle by it.
 */
export function paintFind(
  ctx: CanvasRenderingContext2D,
  kind: ArtKind,
  cx: number,
  cy: number,
  size: number,
) {
  ctx.save();
  ctx.globalAlpha = 0.6;
  ctx.fillStyle = PAPER;
  ctx.beginPath();
  ctx.ellipse(cx, cy + size * 0.2, size * 0.34, size * 0.15, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;
  const art = itemArtImage(kind);
  const side = size * 0.76;
  if (art) ctx.drawImage(art, cx - side / 2, cy - side * 0.55, side, side);
  // The sparkle, up and to the right of the picture.
  const sx = cx + side * 0.36;
  const sy = cy - side * 0.42;
  const r = Math.max(2, size * 0.09);
  ctx.fillStyle = PAPER;
  ctx.beginPath();
  ctx.moveTo(sx, sy - r);
  ctx.quadraticCurveTo(sx, sy, sx + r, sy);
  ctx.quadraticCurveTo(sx, sy, sx, sy + r);
  ctx.quadraticCurveTo(sx, sy, sx - r, sy);
  ctx.quadraticCurveTo(sx, sy, sx, sy - r);
  ctx.fill();
  ctx.restore();
}

/**
 * A fallen leaf around (cx, cy) on a tile `size` across, lying `turn` radians from east: two curves
 * from tip to tip, the shape the plot photos draw (`packages/cards/src/plot.ts`).
 */
export function leafPath(path: Path2D, cx: number, cy: number, turn: number, size: number) {
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
export function paintLantern(
  ctx: CanvasRenderingContext2D,
  left: number,
  top: number,
  size: number,
) {
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
  ctx.fillStyle = STRAW;
  ctx.beginPath();
  ctx.roundRect(cx - size * 0.21, top + size * 0.15, size * 0.42, size * 0.06, size * 0.03);
  ctx.roundRect(cx - size * 0.1, top + size * 0.05, size * 0.2, size * 0.12, size * 0.03);
  ctx.fill();
  ctx.stroke();
}
