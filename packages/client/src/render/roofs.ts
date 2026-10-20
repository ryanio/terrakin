import {
  type BlockKind,
  blockFill,
  mixHex,
  type RoofShape,
  roofTone,
  type Season,
  type ThemePalette,
} from "@terrakin/sim";
import { type Camera, tileToScreen } from "../camera";

/**
 * A home's roof from above (RFC 0041). A roof is one field on the plot, and what it covers is read
 * from the walls (the sim's `roofShape`), so here there is only the drawing: a tile per tile of the
 * footprint, lit by how high its corners stand, with a shadow under its eaves, an ink line round
 * its edge, and a pale line along its ridge. So a gable reads as two slopes with a ridge, a hip as
 * four falling to the eaves, and a pitched roof as one slope leaning away from the street.
 */

/** How far a roof's shadow falls past its eaves, in tiles. Longer than a block's, since it's higher. */
const SHADOW = 0.16;

/** How high over the walls the ridge of a roof is lit, and how deep its eaves are shaded. */
const RIDGE_LIGHT = "#fff7e6";
const EAVE_SHADE = "#3d3024";

/**
 * A roof tile's own color, pushed by how high its corners stand: the eaves into shadow and the
 * ridge into the light, so a slope reads from above. The map and the plot thumbnails share it.
 */
export const roofShade = (fill: string, high: number) =>
  mixHex(mixHex(fill, EAVE_SHADE, 0.26 * (1 - high)), RIDGE_LIGHT, 0.3 * high);

/**
 * Paint one plot's roof. `palette` is the plot's theme, so a wood roof matches the wood walls it
 * sits on, and a made material keeps its own color whatever the theme (the sim's `blockFill`).
 * `season` lays winter's snow over the covering, the way the ground wears it (`roofTone`).
 */
export function paintRoof(
  ctx: CanvasRenderingContext2D,
  cam: Camera,
  roof: RoofShape,
  palette?: ThemePalette,
  season?: Season,
) {
  const { scale } = cam;
  const half = scale / 2;
  const fill = roofTone(blockFill(roof.material as BlockKind, palette), season);
  const box = (x: number, y: number) => {
    const { sx, sy } = tileToScreen(cam, x, y);
    const left = Math.round(sx - half);
    const top = Math.round(sy - half);
    return { left, top, w: Math.round(sx + half) - left, h: Math.round(sy + half) - top };
  };
  const covered = new Set(roof.tiles.map((t) => `${t.x},${t.y}`));
  const on = (x: number, y: number) => covered.has(`${x},${y}`);
  // Its shadow on everything below, cast as one shape so the eaves read as one edge.
  const drop = Math.round(scale * SHADOW);
  ctx.fillStyle = "rgba(74, 52, 28, 0.26)";
  for (const tile of roof.tiles) {
    const b = box(tile.x, tile.y);
    ctx.fillRect(b.left + drop, b.top + drop, b.w, b.h);
  }
  // The slopes, each tile lit by the mean of its corners.
  for (const tile of roof.tiles) {
    const b = box(tile.x, tile.y);
    const high = (tile.h[0] + tile.h[1] + tile.h[2] + tile.h[3]) / 4;
    ctx.fillStyle = roofShade(fill, high);
    ctx.fillRect(b.left, b.top, b.w, b.h);
  }
  const line = Math.max(1, scale / 22);
  // The eaves: an ink line wherever the roof ends.
  const edge = new Path2D();
  for (const { x, y } of roof.tiles) {
    const b = box(x, y);
    if (!on(x, y - 1)) {
      edge.moveTo(b.left, b.top);
      edge.lineTo(b.left + b.w, b.top);
    }
    if (!on(x, y + 1)) {
      edge.moveTo(b.left, b.top + b.h);
      edge.lineTo(b.left + b.w, b.top + b.h);
    }
    if (!on(x - 1, y)) {
      edge.moveTo(b.left, b.top);
      edge.lineTo(b.left, b.top + b.h);
    }
    if (!on(x + 1, y)) {
      edge.moveTo(b.left + b.w, b.top);
      edge.lineTo(b.left + b.w, b.top + b.h);
    }
  }
  ctx.strokeStyle = "rgba(61, 48, 36, 0.5)";
  ctx.lineWidth = line;
  ctx.stroke(edge);
  // The ridge: the pale line where the roof is at its highest, which names the style at a glance.
  // An edge counts only where the roof falls away across it, so the flat top of a gable is
  // outlined rather than gridded into its tiles.
  const top = Math.max(...roof.tiles.flatMap((t) => t.h));
  if (top > 0) {
    const ridge = new Path2D();
    const heights = new Map(roof.tiles.map((t) => [`${t.x},${t.y}`, t.h] as const));
    const falls = (x: number, y: number) => {
      const h = heights.get(`${x},${y}`);
      return h === undefined || h.some((k) => k < top);
    };
    for (const tile of roof.tiles) {
      const b = box(tile.x, tile.y);
      const [nw, ne, se, sw] = tile.h;
      if (nw >= top && ne >= top && falls(tile.x, tile.y - 1)) {
        ridge.moveTo(b.left, b.top);
        ridge.lineTo(b.left + b.w, b.top);
      }
      if (sw >= top && se >= top && falls(tile.x, tile.y + 1)) {
        ridge.moveTo(b.left, b.top + b.h);
        ridge.lineTo(b.left + b.w, b.top + b.h);
      }
      if (nw >= top && sw >= top && falls(tile.x - 1, tile.y)) {
        ridge.moveTo(b.left, b.top);
        ridge.lineTo(b.left, b.top + b.h);
      }
      if (ne >= top && se >= top && falls(tile.x + 1, tile.y)) {
        ridge.moveTo(b.left + b.w, b.top);
        ridge.lineTo(b.left + b.w, b.top + b.h);
      }
    }
    ctx.strokeStyle = "rgba(255, 247, 230, 0.7)";
    ctx.lineWidth = Math.max(1, line * 1.2);
    ctx.stroke(ridge);
  }
}
