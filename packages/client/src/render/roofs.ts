import {
  type BlockKind,
  blockFill,
  mixHex,
  type RoofShape,
  type RoofTop,
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

/** The ink and the paper a ridge's mark is drawn in, dark on any covering and light on any ink. */
const TOP_INK = "#3d3024";
const TOP_PAPER = "#fff7e6";

/**
 * What stands on a roof's ridge (RFC 0041), drawn from above in a tile `t` pixels wide centered on
 * (cx, cy): a weather vane as a cross with its pointer, a flag as a pole with its cloth out to the
 * east, a bird's nest as a ring of twigs. Small, dark, and the same shapes on the map, on a
 * thumbnail, and in a plot photo, so a home's mark is its own wherever you meet it.
 */
export function paintRoofTop(
  ctx: CanvasRenderingContext2D,
  kind: RoofTop,
  cx: number,
  cy: number,
  t: number,
) {
  const line = Math.max(1, t * 0.07);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  if (kind === "nest") {
    ctx.strokeStyle = TOP_INK;
    ctx.lineWidth = line * 1.6;
    ctx.beginPath();
    ctx.arc(cx, cy, t * 0.2, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = TOP_PAPER;
    ctx.beginPath();
    ctx.arc(cx, cy, t * 0.09, 0, Math.PI * 2);
    ctx.fill();
    return;
  }
  // Both the vane and the flag stand on a pole, which from above is a dot in a pale ring.
  ctx.strokeStyle = TOP_INK;
  ctx.lineWidth = line;
  if (kind === "vane") {
    ctx.beginPath();
    ctx.moveTo(cx - t * 0.22, cy);
    ctx.lineTo(cx + t * 0.22, cy);
    ctx.moveTo(cx, cy - t * 0.22);
    ctx.lineTo(cx, cy + t * 0.22);
    ctx.stroke();
    // The pointer, so it reads as a vane rather than a cross.
    ctx.fillStyle = TOP_INK;
    ctx.beginPath();
    ctx.moveTo(cx + t * 0.3, cy);
    ctx.lineTo(cx + t * 0.14, cy - t * 0.12);
    ctx.lineTo(cx + t * 0.14, cy + t * 0.12);
    ctx.closePath();
    ctx.fill();
  } else {
    ctx.beginPath();
    ctx.moveTo(cx - t * 0.12, cy - t * 0.18);
    ctx.lineTo(cx - t * 0.12, cy + t * 0.18);
    ctx.stroke();
    ctx.fillStyle = TOP_INK;
    ctx.beginPath();
    ctx.moveTo(cx - t * 0.1, cy - t * 0.16);
    ctx.lineTo(cx + t * 0.26, cy - t * 0.04);
    ctx.lineTo(cx - t * 0.1, cy + t * 0.08);
    ctx.closePath();
    ctx.fill();
  }
  ctx.fillStyle = TOP_PAPER;
  ctx.beginPath();
  ctx.arc(cx, cy, line * 0.9, 0, Math.PI * 2);
  ctx.fill();
}

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
  // What stands on the ridge, last of all, so nothing on the roof covers it.
  if (roof.top) {
    const b = box(roof.top.x, roof.top.y);
    paintRoofTop(ctx, roof.top.kind, b.left + b.w / 2, b.top + b.h / 2, scale);
  }
}
