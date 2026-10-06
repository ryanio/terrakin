/**
 * A plot photo (issue #34): one resident's plot drawn from above, in the world's own palette, as
 * SVG markup the card template places in a photo frame. The server fills a `PlotCard` from the
 * world (`server/src/plot-photo.ts`): every color comes from the sim's palette and every number
 * from world state. Nothing a resident wrote reaches this markup; their name is drawn by the
 * template as text, and their home picture as an image checked by `imageDataUri`.
 *
 * The shapes follow `client/src/render.ts`, so a photo looks like the plot does in the world.
 */

/** One tile of ground: its tone, and the tuft, flower, or fallen leaf on it. */
export interface PlotGround {
  fill: string;
  /** A grass tuft, by where it stands across the tile (0 to 1). */
  tuft?: number | undefined;
  /** A flower, by where it sits in the tile (0 to 1 each way), and its color. */
  flower?: { fx: number; fy: number; fill: string } | undefined;
  /** An autumn leaf: where it lies in the tile, its turn in radians from east, and its color. */
  leaf?: { fx: number; fy: number; turn: number; fill: string } | undefined;
}

/** Decor from the town shop, drawn as itself rather than a square. Same names as the sim's. */
export const PLOT_DECOR = ["lantern", "frame", "fence", "bench", "hay_bale", "scarecrow"] as const;
export type PlotDecor = (typeof PLOT_DECOR)[number];

export interface PlotBlock {
  /** Tiles from the plot's top left corner. */
  x: number;
  y: number;
  glass: boolean;
  fill: string;
  /** Set for decor from the town shop; `fill` is then its main color. */
  decor?: PlotDecor | undefined;
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
      } else if (g.leaf) {
        const leaf = leafPath(x + g.leaf.fx, y + g.leaf.fy, g.leaf.turn);
        if (leaf) flowers.push(`<path d="${leaf}" fill="${safeColor(g.leaf.fill)}"/>`);
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
  const fences = new Set(c.blocks.filter((b) => b.decor === "fence").map((b) => `${b.x},${b.y}`));
  for (const b of c.blocks) {
    if (!inPlot(b.x, S) || !inPlot(b.y, S)) continue;
    if (b.decor && (PLOT_DECOR as readonly string[]).includes(b.decor)) {
      const at = (dx: number, dy: number) => fences.has(`${b.x + dx},${b.y + dy}`);
      parts.push(
        ...decorSvg(b.decor, b.x, b.y, safeColor(b.fill), {
          n: at(0, -1),
          e: at(1, 0),
          s: at(0, 1),
          w: at(-1, 0),
        }),
      );
      continue;
    }
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
 * A fallen leaf around (cx, cy), lying `turn` radians from east: two curves from tip to tip, as
 * `client/src/render.ts` draws it. Undefined for anything that isn't a finite number.
 */
function leafPath(cx: number, cy: number, turn: number): string | undefined {
  if (![cx, cy, turn].every(Number.isFinite)) return undefined;
  const dx = Math.cos(turn);
  const dy = Math.sin(turn);
  const long = 0.14;
  const wide = 0.13;
  const tip = (k: number) => `${n(cx + dx * long * k)} ${n(cy + dy * long * k)}`;
  const side = (k: number) => `${n(cx - dy * wide * k)} ${n(cy + dx * wide * k)}`;
  return `M${tip(1)}Q${side(1)} ${tip(-1)}Q${side(-1)} ${tip(1)}`;
}

const WOOD_DARK = "#6e4a2c";
const EDGE = "rgba(70, 40, 18, 0.5)";
const STRAW = "#e8c878";
const BURLAP = "#d9bf8f";

/**
 * One decor block on tile (x, y), following `client/src/render.ts`: a paper lantern on a hook, a
 * picture on an easel, a fence post with rails to the fences beside it, a garden bench, a hay bale,
 * or a scarecrow. Only numbers and checked colors go in. No ellipses, so the tests can tell the
 * hearth's shadow apart.
 */
function decorSvg(
  kind: PlotDecor,
  x: number,
  y: number,
  fill: string,
  joins: { n: boolean; e: boolean; s: boolean; w: boolean },
): string[] {
  const X = (f: number) => n(x + f);
  const Y = (f: number) => n(y + f);
  const stroke = `stroke="${EDGE}" stroke-width="0.035" stroke-linejoin="round"`;
  const shade = `<rect x="${X(0.16)}" y="${Y(0.86)}" width="0.68" height="0.1" rx="0.05" fill="rgba(74, 52, 28, 0.2)"/>`;
  if (kind === "lantern") {
    return [
      shade,
      `<path d="M${X(0.33)} ${Y(0.92)}V${Y(0.16)}Q${X(0.34)} ${Y(0.06)} ${X(0.58)} ${Y(0.08)}Q${X(0.66)} ${Y(0.1)} ${X(0.66)} ${Y(0.2)}" fill="none" stroke="${WOOD_DARK}" stroke-width="0.065" stroke-linecap="round"/>`,
      `<circle cx="${X(0.66)}" cy="${Y(0.44)}" r="0.24" fill="rgba(242, 181, 68, 0.28)"/>`,
      `<rect x="${X(0.48)}" y="${Y(0.24)}" width="0.36" height="0.4" rx="0.17" fill="${fill}" ${stroke}/>`,
      `<rect x="${X(0.56)}" y="${Y(0.2)}" width="0.2" height="0.06" rx="0.02" fill="${WOOD_DARK}"/>`,
      `<rect x="${X(0.56)}" y="${Y(0.62)}" width="0.2" height="0.06" rx="0.02" fill="${WOOD_DARK}"/>`,
    ];
  }
  if (kind === "frame") {
    return [
      shade,
      `<path d="M${X(0.22)} ${Y(0.92)}L${X(0.42)} ${Y(0.1)}M${X(0.78)} ${Y(0.92)}L${X(0.58)} ${Y(0.1)}" stroke="${WOOD_DARK}" stroke-width="0.06" stroke-linecap="round"/>`,
      `<rect x="${X(0.15)}" y="${Y(0.14)}" width="0.7" height="0.52" rx="0.04" fill="${fill}" ${stroke}/>`,
      `<rect x="${X(0.22)}" y="${Y(0.21)}" width="0.56" height="0.38" fill="#cfe6ee"/>`,
      `<circle cx="${X(0.62)}" cy="${Y(0.32)}" r="0.06" fill="#f2b84b"/>`,
      `<path d="M${X(0.22)} ${Y(0.59)}V${Y(0.46)}Q${X(0.4)} ${Y(0.36)} ${X(0.56)} ${Y(0.48)}Q${X(0.68)} ${Y(0.42)} ${X(0.78)} ${Y(0.46)}V${Y(0.59)}z" fill="#5e7f45"/>`,
      `<rect x="${X(0.13)}" y="${Y(0.65)}" width="0.74" height="0.06" fill="${WOOD_DARK}"/>`,
    ];
  }
  if (kind === "fence") {
    const rails: string[] = [];
    for (const [on, from, to] of [
      [joins.w, 0, 0.5],
      [joins.e, 0.5, 1],
    ] as const) {
      if (!on) continue;
      for (const fy of [0.34, 0.62]) {
        rails.push(
          `<rect x="${X(from)}" y="${Y(fy)}" width="${to - from}" height="0.09" fill="${fill}" ${stroke}/>`,
        );
      }
    }
    if (joins.n) {
      rails.push(
        `<rect x="${X(0.43)}" y="${Y(0)}" width="0.14" height="0.2" fill="${fill}" ${stroke}/>`,
      );
    }
    if (joins.s) {
      rails.push(
        `<rect x="${X(0.43)}" y="${Y(0.82)}" width="0.14" height="0.18" fill="${fill}" ${stroke}/>`,
      );
    }
    return [
      ...rails,
      `<path d="M${X(0.39)} ${Y(0.92)}V${Y(0.24)}L${X(0.5)} ${Y(0.12)}L${X(0.61)} ${Y(0.24)}V${Y(0.92)}z" fill="${fill}" ${stroke}/>`,
    ];
  }
  if (kind === "hay_bale") {
    return [
      shade,
      `<rect x="${X(0.1)}" y="${Y(0.34)}" width="0.8" height="0.56" rx="0.1" fill="${fill}" ${stroke}/>`,
      `<rect x="${X(0.14)}" y="${Y(0.37)}" width="0.72" height="0.14" rx="0.06" fill="rgba(255, 250, 235, 0.4)"/>`,
      `<path d="M${X(0.33)} ${Y(0.35)}V${Y(0.89)}M${X(0.67)} ${Y(0.35)}V${Y(0.89)}" stroke="${WOOD_DARK}" stroke-width="0.035"/>`,
      `<path d="M${X(0.17)} ${Y(0.64)}h0.09M${X(0.43)} ${Y(0.74)}h0.12M${X(0.74)} ${Y(0.6)}h0.08" stroke="${EDGE}" stroke-width="0.03" stroke-linecap="round"/>`,
    ];
  }
  if (kind === "scarecrow") {
    return [
      shade,
      `<path d="M${X(0.5)} ${Y(0.92)}V${Y(0.3)}M${X(0.13)} ${Y(0.44)}H${X(0.87)}" stroke="${WOOD_DARK}" stroke-width="0.06" stroke-linecap="round"/>`,
      `<path d="M${X(0.24)} ${Y(0.38)}H${X(0.76)}L${X(0.68)} ${Y(0.72)}H${X(0.32)}z" fill="${fill}" ${stroke}/>`,
      `<path d="M${X(0.13)} ${Y(0.44)}l-0.06 0.08M${X(0.87)} ${Y(0.44)}l0.06 0.08" stroke="${STRAW}" stroke-width="0.045" stroke-linecap="round"/>`,
      `<circle cx="${X(0.5)}" cy="${Y(0.27)}" r="0.12" fill="${BURLAP}" ${stroke}/>`,
      `<rect x="${X(0.3)}" y="${Y(0.15)}" width="0.4" height="0.06" rx="0.03" fill="${STRAW}" ${stroke}/>`,
      `<rect x="${X(0.4)}" y="${Y(0.05)}" width="0.2" height="0.12" rx="0.03" fill="${STRAW}" ${stroke}/>`,
    ];
  }
  return [
    shade,
    `<path d="M${X(0.18)} ${Y(0.6)}V${Y(0.92)}M${X(0.82)} ${Y(0.6)}V${Y(0.92)}M${X(0.24)} ${Y(0.2)}V${Y(0.6)}M${X(0.76)} ${Y(0.2)}V${Y(0.6)}" stroke="${WOOD_DARK}" stroke-width="0.06" stroke-linecap="round"/>`,
    `<rect x="${X(0.11)}" y="${Y(0.16)}" width="0.78" height="0.12" rx="0.03" fill="${fill}" ${stroke}/>`,
    `<rect x="${X(0.11)}" y="${Y(0.33)}" width="0.78" height="0.12" rx="0.03" fill="${fill}" ${stroke}/>`,
    `<rect x="${X(0.06)}" y="${Y(0.52)}" width="0.88" height="0.14" rx="0.04" fill="${fill}" ${stroke}/>`,
  ];
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
