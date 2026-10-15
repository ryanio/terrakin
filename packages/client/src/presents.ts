import { type BlockKind, tileKey, type WorldConfig } from "@terrakin/sim";

/**
 * Where the map and the 3D world draw presents waiting to be opened (RFC 0034): under the little
 * fir on a resident's home plot nearest their hearth, or by the hearth when the plot has none.
 * Drawing only, and pure, so a test pins it.
 */
export interface PresentPile {
  /** How many presents wait there, everyone's whose pile it is together. */
  count: number;
  /** Under a little fir; otherwise by a hearth. */
  tree: boolean;
}

/** The parts of the mirror a pile reads. */
export interface PileSource {
  config: WorldConfig;
  residents: ReadonlyMap<string, { hearth?: { x: number; y: number } | null }>;
  /** The ground floor's blocks, by tile key. */
  blocks: ReadonlyMap<string, BlockKind>;
  /** How many presents wait for each resident. */
  presents: ReadonlyMap<string, number>;
}

/**
 * Each pile by tile key: residents who share a tree, or a hearth, share a pile. A pile always sits
 * on the plot that holds its resident's hearth, so with `area` (tiles, both ends included) only
 * residents whose hearth is in it are read.
 */
export function presentPiles(
  src: PileSource,
  area?: { x0: number; y0: number; x1: number; y1: number },
): Map<string, PresentPile> {
  const piles = new Map<string, PresentPile>();
  const S = src.config.plotSize;
  for (const [id, count] of src.presents) {
    const hearth = src.residents.get(id)?.hearth;
    if (!hearth || count < 1) continue;
    if (
      area &&
      (hearth.x < area.x0 || hearth.x > area.x1 || hearth.y < area.y0 || hearth.y > area.y1)
    )
      continue;
    const px = Math.floor(hearth.x / S);
    const py = Math.floor(hearth.y / S);
    let fir: { x: number; y: number; d: number } | undefined;
    for (let y = py * S; y < (py + 1) * S; y++) {
      for (let x = px * S; x < (px + 1) * S; x++) {
        if (src.blocks.get(tileKey(x, y)) !== "little_fir") continue;
        const d = Math.abs(x - hearth.x) + Math.abs(y - hearth.y);
        // North to south, then west to east, so the first of two as near wins.
        if (!fir || d < fir.d) fir = { x, y, d };
      }
    }
    const at = fir ?? hearth;
    const key = tileKey(at.x, at.y);
    const pile = piles.get(key);
    piles.set(key, { count: (pile?.count ?? 0) + count, tree: fir !== undefined });
  }
  return piles;
}
