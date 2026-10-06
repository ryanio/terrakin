/**
 * Where each townsfolk lives. Plots are picked from the live world, so the same cast fits any
 * world size and steps around plots real residents already hold.
 */
import type { WorldSnapshot } from "../../packages/protocol/src/index";
import type { Spot } from "./personas.ts";

export interface Plot {
  px: number;
  py: number;
}

/** The parts of a world snapshot the plan reads. */
export type WorldShape = Pick<WorldSnapshot, "config" | "commons" | "plots">;

export const plotKey = (p: Plot) => `${p.px},${p.py}`;

function grid(world: WorldShape) {
  return {
    cols: world.config.width / world.config.plotSize,
    rows: world.config.height / world.config.plotSize,
  };
}

/** The plot a spot points at, before checking whether it's free. */
export function target(spot: Spot, world: WorldShape): Plot {
  const { cols, rows } = grid(world);
  const clamp = (v: number, max: number) => Math.max(0, Math.min(max - 1, v));
  if (spot.near === "commons") {
    return {
      px: clamp(world.commons.px + spot.dx, cols),
      py: clamp(world.commons.py + spot.dy, rows),
    };
  }
  return { px: Math.round(spot.fx * (cols - 1)), py: Math.round(spot.fy * (rows - 1)) };
}

/**
 * The free plot nearest to where a persona would like to live, or null when none is left.
 * `reserved` holds plots already promised to other personas in this run.
 */
export function choosePlot(spot: Spot, world: WorldShape, reserved: Set<string>): Plot | null {
  const { cols, rows } = grid(world);
  const taken = new Set(world.plots.map(plotKey));
  const want = target(spot, world);
  let best: { plot: Plot; d: number } | null = null;
  for (let py = 0; py < rows; py++) {
    for (let px = 0; px < cols; px++) {
      const plot = { px, py };
      const key = plotKey(plot);
      if (px === world.commons.px && py === world.commons.py) continue;
      if (taken.has(key) || reserved.has(key)) continue;
      const d = (px - want.px) ** 2 + (py - want.py) ** 2;
      if (!best || d < best.d) best = { plot, d };
    }
  }
  return best?.plot ?? null;
}

/** "right next to the Commons, on the west side", "in the quiet northeast corner of the map", ... */
export function describePlace(plot: Plot, world: WorldShape): string {
  const { cols, rows } = grid(world);
  const dx = plot.px - world.commons.px;
  const dy = plot.py - world.commons.py;
  const dir = (dy < 0 ? "north" : dy > 0 ? "south" : "") + (dx < 0 ? "west" : dx > 0 ? "east" : "");
  const d = Math.max(Math.abs(dx), Math.abs(dy));
  if (d === 1) return `right next to the Commons, on the ${dir} side`;
  if (d === 2) return `a short walk ${dir} of the Commons`;
  const xEdge = plot.px === 0 || plot.px === cols - 1;
  const yEdge = plot.py === 0 || plot.py === rows - 1;
  if (xEdge && yEdge) return `in the quiet ${dir} corner of the map`;
  if (xEdge) return `out on the ${plot.px === 0 ? "west" : "east"} edge of the map`;
  if (yEdge) return `out on the ${plot.py === 0 ? "north" : "south"} edge of the map`;
  return `out ${dir} of the Commons, where it's quiet`;
}
