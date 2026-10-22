import { type BlockKind, type Posture, postureOn } from "@terrakin/sim";

/**
 * Resting (RFC 0044), for drawing only: someone on a seat's tile sits, or lies on a bed. The sim
 * keeps no field for it, so a view asks the block under a figure with the sim's `postureOn`. A
 * figure drawn between two tiles is walking past, so only one standing on a tile rests.
 */
export function postureAt(
  blockAt: (x: number, y: number) => BlockKind | undefined,
  x: number,
  y: number,
): Posture | undefined {
  if (!Number.isInteger(x) || !Number.isInteger(y)) return undefined;
  return postureOn(blockAt(x, y));
}

/**
 * How the map draws a resting figure, in tile units and radians: sitting, a little higher and
 * shorter, with the legs folded into the seat; lying, turned on its side along the bed with the
 * head at the pillow to the north. Standing is no change.
 */
export function restingDraw(posture: Posture | undefined): {
  rise: number;
  squash: number;
  turn: number;
} {
  if (posture === "sit") return { rise: 0.1, squash: 0.84, turn: 0 };
  if (posture === "lie") return { rise: 0.22, squash: 1, turn: -Math.PI / 2 };
  return { rise: 0, squash: 1, turn: 0 };
}
