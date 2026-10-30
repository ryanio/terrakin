import { SIDE_STEP, SIDES, type Side } from "@terrakin/sim";

/**
 * Which face of a wall a tap means (RFC 0050): the side seen from the open tile beside the wall
 * nearest `from`, so tapping a wall from inside a room picks the room's side. Pure and tested.
 * Nearest by steps (Chebyshev), then by straight distance, then north, east, south, west.
 */
export function wallFace(
  wall: { x: number; y: number },
  from: { x: number; y: number },
  open: (x: number, y: number) => boolean,
): { x: number; y: number; side: Side } | undefined {
  let best: { x: number; y: number; side: Side; steps: number; far: number } | undefined;
  for (const side of SIDES) {
    const [dx, dy] = SIDE_STEP[side];
    const x = wall.x - dx;
    const y = wall.y - dy;
    if (!open(x, y)) continue;
    const steps = Math.max(Math.abs(x - from.x), Math.abs(y - from.y));
    const far = Math.abs(x - from.x) + Math.abs(y - from.y);
    if (!best || steps < best.steps || (steps === best.steps && far < best.far)) {
      best = { x, y, side, steps, far };
    }
  }
  return best ? { x: best.x, y: best.y, side: best.side } : undefined;
}
