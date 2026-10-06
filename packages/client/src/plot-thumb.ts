/**
 * A small drawing of one plot from above, painted from the world snapshot the page already has: the
 * ground in its biome, the owner's theme tint, blocks in their colors (themed as in the world),
 * crops, things on display, and hearths. It uses the world's own palette
 * (`packages/sim/src/palette.ts`), so a plot looks the same here, on the map, and in a plot photo.
 * A drawing costs no request and no upload, which is why the plot cards use it rather than plot
 * photos (RFC 0020).
 */
import type { WorldSnapshot } from "@terrakin/protocol";
import {
  alphaHex,
  blockFill,
  CROP_HEX,
  type GroundKind,
  groundTile,
  HEARTH_COLOR,
  HEARTH_DOOR,
  isDecorKind,
  PAPER,
  THEME_INFO,
  THEME_TINT_ALPHA,
} from "@terrakin/sim";
import { h } from "@terrakin/ui/dom";
import { paintGround } from "@terrakin/ui/ground-art";

/** One tile's worth of a plot drawing, in tiles from the plot's north-west corner. */
export type PlotMark =
  | { x: number; y: number; kind: "ground"; fill: string }
  | { x: number; y: number; kind: "path"; ground: GroundKind }
  | { x: number; y: number; kind: "block"; fill: string; glass: boolean; decor: boolean }
  | { x: number; y: number; kind: "crop"; fill: string; ripe: boolean }
  | { x: number; y: number; kind: "display" }
  | { x: number; y: number; kind: "hearth" };

/** A sprout's green while a crop is still growing. */
const GROWING = "#7fae55";

/**
 * What to paint for plot (px, py), back to front: the ground in its season, then paths and floors,
 * blocks, crops, displays, and hearths. `tint` is the owner's theme over the ground, under the
 * paths. Pure, so tests pin it.
 */
export function plotMarks(
  world: WorldSnapshot,
  px: number,
  py: number,
): { size: number; tint?: string; marks: PlotMark[] } {
  const size = world.config.plotSize;
  const x0 = px * size;
  const y0 = py * size;
  const here = (t: { x: number; y: number }) =>
    t.x >= x0 && t.x < x0 + size && t.y >= y0 && t.y < y0 + size;
  const plot = world.plots.find((p) => p.px === px && p.py === py);
  const owner = plot ? world.residents.find((r) => r.id === plot.ownerId) : undefined;
  const palette = owner?.theme ? THEME_INFO[owner.theme]?.palette : undefined;
  const marks: PlotMark[] = [];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      marks.push({
        x,
        y,
        kind: "ground",
        fill: groundTile(world.config, x0 + x, y0 + y, false, world.season).fill,
      });
    }
  }
  for (const g of world.ground ?? []) {
    if (!here(g)) continue;
    marks.push({ x: g.x - x0, y: g.y - y0, kind: "path", ground: g.ground });
  }
  for (const b of world.blocks) {
    if (!here(b)) continue;
    const glass = b.block === "glass";
    marks.push({
      x: b.x - x0,
      y: b.y - y0,
      kind: "block",
      fill: blockFill(b.block, glass ? undefined : palette),
      glass,
      decor: isDecorKind(b.block),
    });
  }
  for (const c of world.crops ?? []) {
    if (!here(c)) continue;
    const ripe = world.day !== undefined && world.day >= c.readyDay;
    marks.push({
      x: c.x - x0,
      y: c.y - y0,
      kind: "crop",
      fill: ripe ? CROP_HEX[c.crop] : GROWING,
      ripe,
    });
  }
  for (const d of world.displays ?? []) {
    if (here(d)) marks.push({ x: d.x - x0, y: d.y - y0, kind: "display" });
  }
  for (const r of world.residents) {
    if (r.hearth && here(r.hearth)) {
      marks.push({ x: r.hearth.x - x0, y: r.hearth.y - y0, kind: "hearth" });
    }
  }
  return {
    size,
    ...(palette ? { tint: alphaHex(palette.ground, THEME_TINT_ALPHA) } : {}),
    marks,
  };
}

/** Paint one mark into a tile `t` pixels wide at (left, top). */
function paint(
  ctx: CanvasRenderingContext2D,
  mark: PlotMark,
  left: number,
  top: number,
  t: number,
) {
  const inset = Math.max(1, t * 0.08);
  switch (mark.kind) {
    case "ground":
      ctx.fillStyle = mark.fill;
      ctx.fillRect(left, top, t, t);
      return;
    case "path":
      paintGround(ctx, mark.ground, left, top, t, t);
      return;
    case "block":
      ctx.globalAlpha = mark.glass ? 0.75 : 1;
      ctx.fillStyle = mark.fill;
      if (mark.decor) {
        // Decor stands smaller than a wall: a rounded piece in the middle of its tile.
        ctx.beginPath();
        ctx.roundRect(left + t * 0.2, top + t * 0.2, t * 0.6, t * 0.6, t * 0.18);
        ctx.fill();
      } else {
        ctx.beginPath();
        ctx.roundRect(left + inset, top + inset, t - 2 * inset, t - 2 * inset, t * 0.16);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      return;
    case "crop":
      ctx.fillStyle = mark.fill;
      ctx.beginPath();
      ctx.arc(left + t / 2, top + t / 2, t * (mark.ripe ? 0.24 : 0.16), 0, Math.PI * 2);
      ctx.fill();
      return;
    case "display":
      ctx.fillStyle = PAPER;
      ctx.beginPath();
      ctx.arc(left + t / 2, top + t * 0.4, t * 0.16, 0, Math.PI * 2);
      ctx.fill();
      return;
    case "hearth": {
      // A tiny house: paper walls, a roof, and a lit door.
      ctx.fillStyle = PAPER;
      ctx.fillRect(left + t * 0.22, top + t * 0.45, t * 0.56, t * 0.42);
      ctx.fillStyle = HEARTH_COLOR;
      ctx.beginPath();
      ctx.moveTo(left + t * 0.12, top + t * 0.5);
      ctx.lineTo(left + t / 2, top + t * 0.12);
      ctx.lineTo(left + t * 0.88, top + t * 0.5);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = HEARTH_DOOR;
      ctx.fillRect(left + t * 0.42, top + t * 0.62, t * 0.16, t * 0.25);
      return;
    }
  }
}

/**
 * A plot drawn on a canvas `px` CSS pixels square, for a card. `label` says whose plot it is, for
 * screen readers. The owner's name in it is text the canvas never draws.
 */
export function plotThumb(
  world: WorldSnapshot,
  plot: { px: number; py: number },
  label: string,
  px = 96,
): HTMLCanvasElement {
  const canvas = h("canvas", {
    class: "plot-thumb",
    attrs: { role: "img", "aria-label": label, width: px, height: px },
  });
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.round(px * dpr);
  canvas.height = Math.round(px * dpr);
  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;
  const { size, tint, marks } = plotMarks(world, plot.px, plot.py);
  const t = canvas.width / size;
  for (const mark of marks) {
    paint(ctx, mark, mark.x * t, mark.y * t, t);
    if (mark.kind === "ground" && tint && mark.x === size - 1 && mark.y === size - 1) {
      // The theme's tint goes over the whole ground once it's down, under everything else.
      ctx.fillStyle = tint;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
  }
  return canvas;
}
