import type { BuildSpot } from "../build-taps";
import { type Camera, tileToScreen } from "../camera";
import { tilesBox } from "./buildings";
import { CLAY, PAPER } from "./palette";

/**
 * A soft ring around what a click would act on, under a mouse pointer: someone, a station, a
 * building, a pickup, or in build mode the tile a block goes on. Drawn under the figures, so
 * whoever stands there stays on top.
 */
export function paintHover(
  ctx: CanvasRenderingContext2D,
  cam: Camera,
  tiles: readonly { x: number; y: number }[],
) {
  const box = tilesBox(tiles, cam);
  if (!box) return;
  const pad = cam.scale * 0.06;
  const radius = cam.scale * 0.24;
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(box.left - pad, box.top - pad, box.w + pad * 2, box.h + pad * 2, radius);
  ctx.fillStyle = "rgba(255, 250, 235, 0.34)";
  ctx.fill();
  // Clay over a paper halo: clear on grass, paths, and the pale Commons alike.
  ctx.strokeStyle = PAPER;
  ctx.lineWidth = 5;
  ctx.stroke();
  ctx.strokeStyle = CLAY;
  ctx.lineWidth = 2.5;
  ctx.stroke();
  ctx.restore();
}

/**
 * What a build tap acts on (decision 0429): the line between tiles as a bar along it, a little
 * thicker than a wall, or the tile ringed as a hover is. `fade` runs from 1 down to 0 as a touch's
 * flash goes.
 */
export function paintBuildMark(
  ctx: CanvasRenderingContext2D,
  cam: Camera,
  spot: BuildSpot,
  fade: number,
) {
  if (fade <= 0) return;
  ctx.save();
  ctx.globalAlpha = fade;
  if (spot.kind === "tile") {
    paintHover(ctx, cam, [spot]);
    ctx.restore();
    return;
  }
  // The line's middle: the north or west side of its tile.
  const mid =
    spot.side === "n"
      ? tileToScreen(cam, spot.x, spot.y - 0.5)
      : tileToScreen(cam, spot.x - 0.5, spot.y);
  const long = cam.scale * 1.08;
  const thick = Math.max(8, cam.scale * 0.34);
  const w = spot.side === "n" ? long : thick;
  const h = spot.side === "n" ? thick : long;
  ctx.beginPath();
  ctx.roundRect(mid.sx - w / 2, mid.sy - h / 2, w, h, thick / 2);
  ctx.fillStyle = "rgba(255, 250, 235, 0.45)";
  ctx.fill();
  ctx.strokeStyle = PAPER;
  ctx.lineWidth = 5;
  ctx.stroke();
  ctx.strokeStyle = CLAY;
  ctx.lineWidth = 2.5;
  ctx.stroke();
  ctx.restore();
}
