import { type Direction, directionOf } from "@terrakin/sim";

/**
 * The way someone faces after moving by (dx, dy): any of the eight, for a one-tile step. A jump
 * (going home) keeps the way they faced, so it doesn't point at wherever they came from. Drawing
 * only; nobody faces anywhere in the sim.
 */
export function facingFrom(dx: number, dy: number): Direction | undefined {
  return directionOf(dx, dy);
}

/**
 * The nearest of the four ways a flat figure can face: a diagonal shows the side it's heading
 * toward, so a walk up and to the right reads as walking right. The snapshot's `facing` is always
 * one of these.
 */
export function fourWayFacing(dir: Direction): "n" | "s" | "e" | "w" {
  return (dir.length === 2 ? dir[1] : dir) as "n" | "s" | "e" | "w";
}

const AROUND: readonly Direction[] = ["e", "se", "s", "sw", "w", "nw", "n", "ne"];

/**
 * The way to face to look at something (dx, dy) away: the nearest of the eight directions to its
 * bearing. Undefined for here.
 */
export function facingToward(dx: number, dy: number): Direction | undefined {
  if (dx === 0 && dy === 0) return undefined;
  // Screen angles: east is 0 and south a quarter turn, since y grows to the south.
  const eighth = Math.round(Math.atan2(dy, dx) / (Math.PI / 4));
  return AROUND[(eighth + 8) % 8];
}
