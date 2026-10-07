import { BLOCK_COLORS, type FurnitureKind } from "@terrakin/sim";
import { itemArtImage } from "@terrakin/ui/item-art";
import { paintBlock } from "./blocks";
import type { Joins } from "./decor";
import { CLAY, INK, PAPER } from "./palette";

// ---------- furniture (RFC 0016) ----------

/**
 * A piece of furniture on its tile, drawn as its own picture (the one lists show), so the map and
 * your things agree. A low stone wall joins the walls beside it, like a fence. Until the picture
 * has loaded, a plain block in its color holds the tile.
 */
export function paintFurniture(
  ctx: CanvasRenderingContext2D,
  kind: FurnitureKind,
  left: number,
  top: number,
  size: number,
  scale: number,
  edge: number,
  joins: Joins,
) {
  if (kind === "stone_wall") {
    paintStoneWall(ctx, left, top, size, edge, joins);
    return;
  }
  const art = itemArtImage(kind);
  if (!art) {
    paintBlock(ctx, kind, left, top, size, scale);
    return;
  }
  // Pictures sit in a 48 box with their shadow at the bottom; a little larger than the tile reads
  // as furniture standing on it rather than an icon.
  const side = size * 1.12;
  ctx.drawImage(art, left + (size - side) / 2, top + size - side * 0.95, side, side);
}

/**
 * A game table in the Commons (RFC 0011): the workbench's table with a die on it, and a warm glow
 * under it while a game is being played.
 */
export function paintGameTable(
  ctx: CanvasRenderingContext2D,
  left: number,
  top: number,
  size: number,
  scale: number,
  edge: number,
  playing: boolean,
) {
  if (playing) {
    const cx = left + size / 2;
    const cy = top + size * 0.6;
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, scale * 0.9);
    g.addColorStop(0, "rgba(242, 184, 75, 0.5)");
    g.addColorStop(1, "rgba(242, 184, 75, 0)");
    ctx.fillStyle = g;
    ctx.fillRect(cx - scale, cy - scale, scale * 2, scale * 2);
  }
  paintFurniture(ctx, "table", left, top, size, scale, edge, {
    n: false,
    e: false,
    s: false,
    w: false,
  });
  // The die sits on the table top, a third of a tile across, showing three.
  const side = Math.max(5, size * 0.32);
  const dx = left + size * 0.5 - side / 2;
  const dy = top + size * 0.18;
  ctx.fillStyle = PAPER;
  ctx.strokeStyle = INK;
  ctx.lineWidth = Math.max(1, scale / 32);
  ctx.beginPath();
  ctx.roundRect(dx, dy, side, side, side * 0.22);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = playing ? CLAY : INK;
  const pip = Math.max(0.8, side * 0.09);
  for (const f of [0.28, 0.5, 0.72]) {
    ctx.beginPath();
    ctx.arc(dx + side * f, dy + side * f, pip, 0, Math.PI * 2);
    ctx.fill();
  }
}

/** A low stone wall, with a cap, running on to the walls beside it. */
function paintStoneWall(
  ctx: CanvasRenderingContext2D,
  left: number,
  top: number,
  size: number,
  edge: number,
  joins: Joins,
) {
  const cx = left + size / 2;
  const half = size * 0.3;
  const wallTop = top + size * 0.42;
  const wallBottom = top + size * 0.9;
  const x0 = joins.w ? left - edge : cx - half;
  const x1 = joins.e ? left + size + edge : cx + half;
  const face = BLOCK_COLORS.stone_wall;
  ctx.save();
  ctx.fillStyle = "rgba(74, 52, 28, 0.2)";
  ctx.fillRect(x0, wallBottom - size * 0.02, x1 - x0, size * 0.07);
  ctx.fillStyle = face;
  ctx.strokeStyle = "rgba(70, 40, 18, 0.45)";
  ctx.lineWidth = Math.max(1, size / 30);
  // Runs north and south: a strip of wall top toward each joined neighbor.
  if (joins.n) ctx.fillRect(cx - half, top - edge, half * 2, wallTop - top + edge);
  if (joins.s) ctx.fillRect(cx - half, wallBottom, half * 2, top + size + edge - wallBottom);
  ctx.beginPath();
  ctx.rect(x0, wallTop, x1 - x0, wallBottom - wallTop);
  ctx.fill();
  ctx.stroke();
  // Mortar: one course line and staggered joints.
  ctx.strokeStyle = "rgba(70, 40, 18, 0.3)";
  ctx.beginPath();
  const mid = (wallTop + wallBottom) / 2 + size * 0.04;
  ctx.moveTo(x0, mid);
  ctx.lineTo(x1, mid);
  for (let x = x0 + size * 0.22; x < x1 - size * 0.05; x += size * 0.34) {
    ctx.moveTo(x, wallTop + size * 0.06);
    ctx.lineTo(x, mid);
    ctx.moveTo(x + size * 0.17, mid);
    ctx.lineTo(x + size * 0.17, wallBottom);
  }
  ctx.stroke();
  // The cap: a lighter band along the top.
  ctx.fillStyle = "#c4beb2";
  ctx.beginPath();
  ctx.roundRect(
    x0 - (joins.w ? 0 : size * 0.03),
    wallTop - size * 0.08,
    x1 - x0 + (joins.w ? 0 : size * 0.03) + (joins.e ? 0 : size * 0.03),
    size * 0.12,
    size * 0.04,
  );
  ctx.fill();
  ctx.restore();
}
