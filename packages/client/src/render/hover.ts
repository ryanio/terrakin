import type { Camera } from "../camera";
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
