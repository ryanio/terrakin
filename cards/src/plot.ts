/**
 * A plot photo (issue #34): one resident's plot drawn from above, in the world's own palette, as
 * SVG markup the card template places in a photo frame. The server fills a `PlotCard` from the
 * world (`server/src/plot-photo.ts`): every color comes from the sim's palette and every number
 * from world state. Nothing a resident wrote reaches this markup; their name is drawn by the
 * template as text, and their home picture as an image checked by `imageDataUri`.
 *
 * The shapes follow `client/src/render.ts`, so a photo looks like the plot does in the world.
 */

/** One tile of ground: its tone, and the tuft or flower that grows on it. */
export interface PlotGround {
  fill: string;
  /** A grass tuft, by where it stands across the tile (0 to 1). */
  tuft?: number | undefined;
  /** A flower, by where it sits in the tile (0 to 1 each way), and its color. */
  flower?: { fx: number; fy: number; fill: string } | undefined;
}

export interface PlotBlock {
  /** Tiles from the plot's top left corner. */
  x: number;
  y: number;
  glass: boolean;
  fill: string;
}

/** The colors the drawing needs beyond the ground and blocks, from the sim's palette. */
export interface PlotInk {
  roof: string;
  door: string;
  walls: string;
  tuft: string;
}

export interface PlotCard {
  kind: "plot";
  /** The owner's name, untrusted: drawn as text, or "A resident" when nothing in it can be drawn. */
  name: string;
  /** Where it is, in our own words, like "Plot 3, 2". */
  place: string;
  /** Short lines under the photo in our own words, like "Meadow and forest" or "24 blocks". */
  facts: string[];
  /** Tiles per side. */
  size: number;
  /** `size * size` tiles, row by row from the top left. */
  ground: PlotGround[];
  /** The owner's theme laid over the plot, when they have one. */
  tint?: string | undefined;
  blocks: PlotBlock[];
  /** The hearth's tile, when it's on this plot. */
  hearth?: { x: number; y: number } | undefined;
  /** The owner's own picture of their home, standing over the hearth (a data URI and its size). */
  homeArt?: { src: string; width: number; height: number } | undefined;
  ink: PlotInk;
}

const COLOR = /^(#[0-9a-f]{6}|rgba\(\d{1,3}, \d{1,3}, \d{1,3}, (0|1|0?\.\d{1,4})\))$/i;

/** A color from the palette, or a plain grey if anything else ever arrives. */
export function safeColor(value: string): string {
  return COLOR.test(value) ? value : "#b3ab9b";
}

const n = (v: number) => Number(v.toFixed(3));
const inPlot = (v: number, size: number) => Number.isFinite(v) && v >= 0 && v < size;

/** The plot as SVG markup, `px` pixels square. Our own markup only: numbers and checked colors. */
export function plotSvg(c: PlotCard, px: number): string {
  const S = Math.max(1, Math.min(32, Math.floor(c.size)));
  const parts: string[] = [];
  const tufts: string[] = [];
  const flowers: string[] = [];
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const g = c.ground[y * S + x];
      if (!g) continue;
      // A hair wider than the tile, so neighbors share pixels and no seams show.
      parts.push(
        `<rect x="${x}" y="${y}" width="1.02" height="1.02" fill="${safeColor(g.fill)}"/>`,
      );
      if (g.tuft !== undefined && Number.isFinite(g.tuft)) {
        const bx = x + g.tuft;
        const by = y + 0.72;
        tufts.push(
          `M${n(bx - 0.08)} ${n(by)}L${n(bx - 0.12)} ${n(by - 0.14)}M${n(bx)} ${n(by)}L${n(bx)} ${n(by - 0.2)}M${n(bx + 0.08)} ${n(by)}L${n(bx + 0.13)} ${n(by - 0.13)}`,
        );
      } else if (g.flower && Number.isFinite(g.flower.fx) && Number.isFinite(g.flower.fy)) {
        flowers.push(
          `<circle cx="${n(x + g.flower.fx)}" cy="${n(y + g.flower.fy)}" r="0.07" fill="${safeColor(g.flower.fill)}"/>`,
        );
      }
    }
  }
  if (tufts.length) {
    parts.push(
      `<path d="${tufts.join("")}" stroke="${safeColor(c.ink.tuft)}" stroke-width="0.045" stroke-linecap="round" fill="none"/>`,
    );
  }
  parts.push(...flowers);
  if (c.tint) parts.push(`<rect width="${S}" height="${S}" fill="${safeColor(c.tint)}"/>`);

  // Blocks: a ground shadow, the block, a bottom shade, and a top highlight, as in the world.
  for (const b of c.blocks) {
    if (!inPlot(b.x, S) || !inPlot(b.y, S)) continue;
    const left = b.x + 0.05;
    const top = b.y + 0.05;
    const size = 0.9;
    const r = 0.14;
    const lip = 0.16;
    parts.push(
      `<rect x="${n(left + 0.03)}" y="${n(top + lip * 0.6)}" width="${size}" height="${size}" rx="${r}" fill="rgba(74, 52, 28, 0.2)"/>`,
      `<rect x="${n(left)}" y="${n(top)}" width="${size}" height="${size}" rx="${r}" fill="${safeColor(b.fill)}"/>`,
      `<path d="M${n(left)} ${n(top + size - lip)}h${size}v${n(lip - r)}a${r} ${r} 0 0 1 -${r} ${r}h-${n(size - 2 * r)}a${r} ${r} 0 0 1 -${r} -${r}z" fill="rgba(70, 40, 18, 0.22)"/>`,
      `<rect x="${n(left + r * 0.5)}" y="${n(top + 0.05)}" width="${n(size - r)}" height="0.09" rx="0.04" fill="${b.glass ? "rgba(255, 255, 255, 0.6)" : "rgba(255, 250, 235, 0.32)"}"/>`,
    );
    if (b.glass) {
      parts.push(
        `<path d="M${n(left + size * 0.3)} ${n(top + size * 0.68)}L${n(left + size * 0.62)} ${n(top + size * 0.36)}" stroke="rgba(255, 255, 255, 0.75)" stroke-width="0.045" stroke-linecap="round"/>`,
      );
    }
  }

  // The hearth: a little house with a door and a clay roof.
  const h = c.hearth;
  if (h && inPlot(h.x, S) && inPlot(h.y, S)) {
    const sx = h.x + 0.5;
    const sy = h.y + 0.5;
    const half = 0.5;
    parts.push(
      `<ellipse cx="${n(sx)}" cy="${n(sy + half * 0.62)}" rx="${n(half * 0.62)}" ry="${n(half * 0.16)}" fill="rgba(74, 52, 28, 0.2)"/>`,
      `<rect x="${n(sx - half * 0.52)}" y="${n(sy - half * 0.2)}" width="${n(half * 1.04)}" height="${n(half * 0.78)}" fill="${safeColor(c.ink.walls)}"/>`,
      `<rect x="${n(sx - half * 0.14)}" y="${n(sy + half * 0.12)}" width="${n(half * 0.28)}" height="${n(half * 0.46)}" rx="0.04" fill="${safeColor(c.ink.door)}"/>`,
      `<path d="M${n(sx - half * 0.72)} ${n(sy - half * 0.12)}L${n(sx)} ${n(sy - half * 0.78)}L${n(sx + half * 0.72)} ${n(sy - half * 0.12)}z" fill="${safeColor(c.ink.roof)}"/>`,
    );
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}" viewBox="0 0 ${S} ${S}" shape-rendering="geometricPrecision">${parts.join("")}</svg>`;
}

/**
 * Where the home picture stands, in pixels inside a `px` square photo: over the hearth (or the
 * middle of the plot), at most 3.6 tiles across or tall, its bottom on the hearth's tile.
 */
export function homeArtBox(
  c: Pick<PlotCard, "size" | "hearth" | "homeArt">,
  px: number,
): { left: number; top: number; width: number; height: number } | undefined {
  const art = c.homeArt;
  if (!art || art.width <= 0 || art.height <= 0) return undefined;
  const S = Math.max(1, Math.floor(c.size));
  const tile = px / S;
  const middle = Math.floor((S - 1) / 2);
  const anchor = c.hearth ?? { x: middle, y: middle };
  const max = tile * Math.min(3.6, S - 1);
  const fit = Math.min(max / art.width, max / art.height);
  const width = Math.round(art.width * fit);
  const height = Math.round(art.height * fit);
  const cx = (anchor.x + 0.5) * tile;
  const bottom = (anchor.y + 0.5) * tile + tile * 0.475;
  return {
    left: Math.round(Math.max(0, Math.min(px - width, cx - width / 2))),
    top: Math.round(Math.max(0, bottom - height)),
    width,
    height,
  };
}
