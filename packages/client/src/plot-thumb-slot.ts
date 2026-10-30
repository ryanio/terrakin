/**
 * A plot drawing for a page the first load shows (the home wall's plot strip): the canvas goes in
 * at its size at once, so nothing moves, and the drawing code (`plot-thumb.ts`, with the world's
 * palette, roofs, and catalog) loads after and paints it.
 */
import type { WorldSnapshot } from "@terrakin/protocol";
import { h } from "@terrakin/ui/dom";

export function lazyPlotThumb(
  world: WorldSnapshot,
  plot: { px: number; py: number },
  label: string,
  px: number,
): HTMLCanvasElement {
  const canvas = h("canvas", {
    class: "plot-thumb",
    attrs: { role: "img", "aria-label": label, width: px, height: px },
  });
  void import("./plot-thumb").then(({ paintThumb }) => paintThumb(canvas, world, plot, label, px));
  return canvas;
}
