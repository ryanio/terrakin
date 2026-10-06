import type { Direction } from "@terrakin/sim";

/**
 * The way someone faces after moving by (dx, dy). Only a one-tile step turns them: a jump (going
 * home) keeps the way they faced, so it doesn't point at wherever they came from. Drawing only;
 * nobody faces anywhere in the sim.
 */
export function facingFrom(dx: number, dy: number): Direction | undefined {
  if (Math.abs(dx) + Math.abs(dy) !== 1) return undefined;
  if (dx) return dx > 0 ? "e" : "w";
  return dy > 0 ? "s" : "n";
}

/** The way to face to look at something (dx, dy) away: the bigger axis wins. Undefined for here. */
export function facingToward(dx: number, dy: number): Direction | undefined {
  if (dx === 0 && dy === 0) return undefined;
  if (Math.abs(dx) >= Math.abs(dy)) return dx > 0 ? "e" : "w";
  return dy > 0 ? "s" : "n";
}
