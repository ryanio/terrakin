/**
 * Where the nearest thing you're after lies, in words a person can walk by: "6 tiles northeast".
 * Pure, so tests pin it. It only points; what lies where, and who may take it, is asked of the
 * mirror through the sim's own functions by the caller.
 */

export interface Spot {
  x: number;
  y: number;
}

/**
 * The nearest tile within `radius` of `from` that `wanted` says yes to: by rings outward (the
 * larger of the two distances, as reach counts them), then north to south, then west to east.
 */
export function nearestTile(
  from: Spot,
  wanted: (x: number, y: number) => boolean,
  radius = 24,
): Spot | undefined {
  for (let d = 0; d <= radius; d++) {
    for (let y = from.y - d; y <= from.y + d; y++) {
      for (let x = from.x - d; x <= from.x + d; x++) {
        if (Math.max(Math.abs(x - from.x), Math.abs(y - from.y)) !== d) continue;
        if (wanted(x, y)) return { x, y };
      }
    }
  }
  return undefined;
}

/**
 * Which way a tile is from you and how far, the way the map is drawn (north up): "6 tiles
 * northeast", "2 tiles west", or "right beside you".
 */
export function wayWords(from: Spot, to: Spot): string {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const far = Math.max(Math.abs(dx), Math.abs(dy));
  if (far <= 1) return "right beside you";
  // A heading within about 22 degrees of an axis reads as that axis alone.
  const ns = Math.abs(dy) * 2.4 >= Math.abs(dx) ? (dy < 0 ? "north" : dy > 0 ? "south" : "") : "";
  const ew = Math.abs(dx) * 2.4 >= Math.abs(dy) ? (dx > 0 ? "east" : dx < 0 ? "west" : "") : "";
  return `${far} tiles ${ns}${ew}`;
}
