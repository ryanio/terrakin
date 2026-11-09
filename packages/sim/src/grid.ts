import type { WorldConfig } from "./types";

/**
 * The plot grid before and after the regrid (RFC 0052). A world starts with plot slots of
 * `BASE_PLOT` tiles; `regrid` doubles them, and everything built moves to the middle of its slot,
 * `insetOf` tiles in from each side. Imports nothing but types, so every module can read it.
 */

/** The plot size every world starts at, and that town layouts and designs were drawn for. */
export const BASE_PLOT = 8;

/**
 * How far in from a slot's edge its middle `BASE_PLOT` square starts: 0 before the regrid, 4
 * after. Town buildings, the starter hut and a plot's first lot sit in that square.
 */
export const insetOf = (config: Pick<WorldConfig, "plotSize">): number =>
  Math.max(0, Math.floor((config.plotSize - BASE_PLOT) / 2));

/** Where a coordinate on a `BASE_PLOT` grid moves to on a grid of `size`. */
export function moveCoord(v: number, size: number): number {
  const slot = Math.floor(v / BASE_PLOT);
  return slot * size + Math.floor((size - BASE_PLOT) / 2) + (v - slot * BASE_PLOT);
}

/**
 * The tile on the `BASE_PLOT` grid that (x, y) stands for, and whether it lies in a slot's ring
 * outside its middle square (the wild yard after a regrid), where it stands for the nearest tile
 * of the middle square. Before the regrid every tile is itself. Pure functions of position (biomes,
 * pickups) read it, so a regrid moves what lies on each tile along with the tile.
 */
export function baseTile(
  config: Pick<WorldConfig, "plotSize">,
  x: number,
  y: number,
): { x: number; y: number; ring: boolean } {
  const size = config.plotSize;
  // Only a slot bigger than the base has a ring: a world of smaller plots (a test world) reads
  // every tile as itself, as it always did.
  if (size <= BASE_PLOT) return { x, y, ring: false };
  const inset = Math.floor((size - BASE_PLOT) / 2);
  const back = (v: number) => {
    const slot = Math.floor(v / size);
    const local = v - slot * size - inset;
    const clamped = Math.min(BASE_PLOT - 1, Math.max(0, local));
    return { v: slot * BASE_PLOT + clamped, ring: clamped !== local };
  };
  const bx = back(x);
  const by = back(y);
  return { x: bx.v, y: by.v, ring: bx.ring || by.ring };
}
