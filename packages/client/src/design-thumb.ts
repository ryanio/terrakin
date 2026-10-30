/**
 * A home drawn from its map (RFC 0032), as it would stand on a plot, for the home sheet's designs.
 * Only `design-picks.ts` imports it, so it loads with the designs and never with the first page;
 * the marks and their painting are `plot-thumb.ts`'s, so a design looks like a plot does.
 */
import { mapEdges, type PlotMapView } from "@terrakin/protocol";
import {
  type BlockKind,
  blockFill,
  groundTile,
  isDecorKind,
  MAP_BLOCKS,
  MAP_GROUND,
  type Season,
  type WorldConfig,
} from "@terrakin/sim";
import { h } from "@terrakin/ui/dom";
import { type PlotMark, paint } from "./plot-thumb";

/**
 * What to paint for a map of a home (RFC 0032), as if it stood on plot (`px`, `py`): that plot's
 * ground in its season, then the map's paths and flooring, its blocks, the hearth its `h` marks,
 * and its walls between tiles (RFC 0050), ground floor first. A design is drawn this way before it's built. Pure, so tests pin it.
 */
export function mapMarks(
  where: { config: WorldConfig; season?: Season | undefined },
  plot: { px: number; py: number },
  map: PlotMapView,
): { size: number; marks: PlotMark[] } {
  const size = where.config.plotSize;
  const marks: PlotMark[] = [];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const at = { x: plot.px * size + x, y: plot.py * size + y };
      const fill = groundTile(where.config, at.x, at.y, false, where.season).fill;
      marks.push({ x, y, kind: "ground", fill });
    }
  }
  const floors = [...map.floors].sort((a, b) => a.floor - b.floor);
  const lines = mapEdges(map, size);
  for (const floor of floors) {
    for (const [y, row] of floor.ground.entries()) {
      for (const [x, c] of [...row].entries()) {
        const ground = MAP_GROUND[c];
        if (ground && x < size && y < size) marks.push({ x, y, kind: "path", ground });
      }
    }
    for (const [y, row] of floor.blocks.entries()) {
      for (const [x, c] of [...row].entries()) {
        if (x >= size || y >= size) continue;
        if (c === "h" && floor.floor === 0) {
          marks.push({ x, y, kind: "hearth" });
          continue;
        }
        const block: BlockKind | undefined =
          (MAP_BLOCKS as Record<string, BlockKind>)[c] ??
          map.legend?.[c as keyof typeof map.legend];
        if (!block) continue;
        const glass = block === "glass";
        marks.push({
          x,
          y,
          kind: "block",
          fill: blockFill(block),
          glass,
          decor: isDecorKind(block),
        });
      }
    }
    for (const e of lines) {
      if (e.floor !== floor.floor) continue;
      marks.push({ x: e.x, y: e.y, kind: "edge", side: e.side, block: e.block });
    }
  }
  return { size, marks };
}

/**
 * A map of a home drawn on a canvas `px` CSS pixels square, as it would stand on a plot. Without a
 * `label` it's left to the button around it to name, and screen readers pass over it.
 */
export function mapThumb(
  where: { config: WorldConfig; season?: Season | undefined },
  plot: { px: number; py: number },
  map: PlotMapView,
  label: string | undefined,
  px = 96,
): HTMLCanvasElement {
  const canvas = h("canvas", {
    class: "plot-thumb",
    attrs: label
      ? { role: "img", "aria-label": label, width: px, height: px }
      : { "aria-hidden": "true", width: px, height: px },
  });
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.round(px * dpr);
  canvas.height = Math.round(px * dpr);
  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;
  const { size, marks } = mapMarks(where, plot, map);
  const t = canvas.width / size;
  for (const mark of marks) paint(ctx, mark, mark.x * t, mark.y * t, t);
  return canvas;
}
