/**
 * A plot photo (issue #34): one resident's plot drawn from above, in the world's own palette, as
 * SVG markup the card template places in a photo frame. The server fills a `PlotCard` from the
 * world (`packages/server/src/plot-photo.ts`): every color comes from the sim's palette and every
 * number from world state. Nothing a resident wrote reaches this markup; their name is drawn by the
 * template as text, and their home picture as an image checked by `imageDataUri`.
 *
 * The shapes follow `packages/client/src/render.ts`, so a photo looks like the plot does in the
 * world.
 */

import { safeColor } from "./color";
import { type Drawing, drawingBox, drawingSvg } from "./drawing";

export { safeColor };

/**
 * One shape of a path or flooring, in tile units from the tile's top left, as the sim's palette gives
 * it (`GROUND_LOOK`). Colors are checked by `safeColor`; numbers are kept to the tile.
 */
export type PlotMark =
  | { shape: "rect"; x: number; y: number; w: number; h: number; r: number; fill: string }
  | { shape: "circle"; cx: number; cy: number; r: number; fill: string }
  | {
      shape: "ellipse";
      cx: number;
      cy: number;
      rx: number;
      ry: number;
      turn: number;
      fill: string;
    }
  | {
      shape: "line";
      x1: number;
      y1: number;
      x2: number;
      y2: number;
      width: number;
      stroke: string;
    };

/** A path or flooring on a tile (RFC 0016): its color, if it covers the tile, and its shapes. */
export interface PlotPaving {
  fill?: string | undefined;
  marks: readonly PlotMark[];
}

/** One tile of ground: its tone, and the tuft, flower, or fallen leaf on it. */
export interface PlotGround {
  fill: string;
  /** A grass tuft, by where it stands across the tile (0 to 1). */
  tuft?: number | undefined;
  /** A flower, by where it sits in the tile (0 to 1 each way), and its color. */
  flower?: { fx: number; fy: number; fill: string } | undefined;
  /** An autumn leaf: where it lies in the tile, its turn in radians from east, and its color. */
  leaf?: { fx: number; fy: number; turn: number; fill: string } | undefined;
  /** A path or flooring laid on the tile. Nothing grows through it. */
  paving?: PlotPaving | undefined;
}

/** Decor from the town shop, drawn as itself rather than a square. Same names as the sim's. */
export const PLOT_DECOR = [
  "lantern",
  "frame",
  "fence",
  "bench",
  "hay_bale",
  "scarecrow",
  "bat_bunting",
  "cauldron",
  "candy_bowl",
  "snowman",
  "string_lights",
  "little_fir",
  "sled",
] as const;
export type PlotDecor = (typeof PLOT_DECOR)[number];

/** Furniture from the workbench (RFC 0016), drawn as itself. Same names as the sim's. */
export const PLOT_FURNITURE = [
  "table",
  "chair",
  "bookshelf",
  "barrel",
  "signpost",
  "lamp_post",
  "well",
  "stone_wall",
  "campfire",
  "flower_box",
  "jack_o_lantern",
] as const;
export type PlotFurniture = (typeof PLOT_FURNITURE)[number];

export interface PlotBlock {
  /** Tiles from the plot's top left corner. */
  x: number;
  y: number;
  glass: boolean;
  fill: string;
  /** Set for decor from the town shop; `fill` is then its main color. */
  decor?: PlotDecor | undefined;
  /** Set for a piece of furniture; `fill` is then its main color. */
  furniture?: PlotFurniture | undefined;
  /**
   * A tile of pond (RFC 0023): flat in the ground in `ink.pond`'s colors, with a stone rim along
   * each side that doesn't run on into more pond. `fill` is then its water.
   */
  water?: boolean | undefined;
  /** A lily pad floats on this tile of pond, as on the map. */
  lily?: boolean | undefined;
}

/** Flooring laid on a floor above the ground floor (RFC 0028): its tile and its look. */
export interface PlotFlooring {
  /** Tiles from the area's top left corner. */
  x: number;
  y: number;
  paving: PlotPaving;
}

/**
 * A floor above the ground floor (RFC 0028): its flooring and the blocks on it, drawn from above
 * over the floors under it, as the map draws them.
 */
export interface PlotFloor {
  flooring: PlotFlooring[];
  blocks: PlotBlock[];
}

/** Something growing in a planter, drawn over it as the map draws it. */
export interface PlotCrop {
  /** Tiles from the plot's top left corner: the planter's tile. */
  x: number;
  y: number;
  /** The sim's name for it. */
  crop: string;
  /** How far along it is: 0 just planted, 1 ready to pick. */
  done: number;
  /** Its color once it's ready, from the sim's palette (its look in the catalog). */
  fill: string;
  /** Set when it grows on a vine along the soil, like a pumpkin; the rest grow on a stem. */
  vine?: boolean | undefined;
}

/** The colors the drawing needs beyond the ground and blocks, from the sim's palette. */
export interface PlotInk {
  roof: string;
  door: string;
  walls: string;
  tuft: string;
  /** A pond's colors beside its water (RFC 0023): the shade by its banks, its rim, and more. */
  pond?: PlotPondInk | undefined;
}

/** How a pond is drawn in a photo, from the sim's `POND_LOOK`. */
export interface PlotPondInk {
  shade: string;
  stone: string;
  pebble: string;
  lily: string;
  glint: string;
}

/** A pond's colors when a card names none: the sim's own, so a photo never shows a plain square. */
const POND_INK: PlotPondInk = {
  shade: "rgba(28, 64, 96, 0.22)",
  stone: "#c4beb2",
  pebble: "#8f887c",
  lily: "#6fae4c",
  glint: "#ffffff",
};

/**
 * A pet asleep by the hearth (RFC 0019), from the pictures the sim keeps as data: plain shapes whose
 * every attribute is a number, a color, a path of numbers, or a fixed word, all checked here.
 */
export interface PlotPet {
  /** Its box's top left corner, in tiles from the plot's, and the box's side in tiles. */
  x: number;
  y: number;
  size: number;
  /** Faces left. */
  flip?: boolean | undefined;
  shapes: { tag: string; attrs: Record<string, string | number> }[];
}

export interface PlotCard {
  kind: "plot";
  /** The owner's name, untrusted: drawn as text, or "A resident" when nothing in it can be drawn. */
  name: string;
  /**
   * The plot's own name (decision 0121), untrusted: drawn as text as the photo's title, with the
   * owner's home under it. Without it, or when nothing in it can be drawn, the owner's home is the
   * title.
   */
  title?: string | undefined;
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
  /** What's growing in the plot's planters. */
  crops?: PlotCrop[] | undefined;
  /** The hearth's tile, when it's on this plot. */
  hearth?: { x: number; y: number } | undefined;
  /** The owner's own picture of their home, standing over the hearth (a data URI and its size). */
  homeArt?: { src: string; width: number; height: number } | undefined;
  /** The owner's pet, curled up by the hearth. */
  pet?: PlotPet | undefined;
  /** Residents standing on the plot (pictures by link, decision 0160). */
  figures?: PlacedFigure[] | undefined;
  /** Floors above the ground floor, from floor 1 up (RFC 0028). */
  floors?: PlotFloor[] | undefined;
  /** The top floor drawn is a floor plan: what's under it shows through dimmed where it has no flooring. */
  floorPlan?: boolean | undefined;
  /**
   * A photo taken to post on Terrakin, where the post's card frames it and may crop its sides: no
   * card border, the brand on the photo's own frame, and room all round the frame.
   */
  posted?: boolean | undefined;
  ink: PlotInk;
}

/** A resident's figure standing with their feet at `x`, `y`, in tiles from the area's top left. */
export interface PlacedFigure {
  x: number;
  y: number;
  drawing: Drawing;
  /** Under flooring the picture draws over them: drawn faded, as the map draws them (RFC 0028). */
  faded?: boolean | undefined;
}

/**
 * A piece of the world from above: `cols` by `rows` tiles and what stands on them, in the same
 * shapes as a plot photo. A plot photo is one plot's area; the picture of where someone is
 * (decision 0160) is a wider one.
 */
export interface PlotArea {
  cols: number;
  rows: number;
  /** `cols * rows` tiles, row by row from the top left. */
  ground: PlotGround[];
  /** Theme tints laid over parts of the area: each plot's owner's, over that plot. */
  tints?: { x: number; y: number; w: number; h: number; fill: string }[] | undefined;
  blocks: PlotBlock[];
  crops?: PlotCrop[] | undefined;
  hearths?: { x: number; y: number }[] | undefined;
  pets?: PlotPet[] | undefined;
  figures?: PlacedFigure[] | undefined;
  /**
   * Floors above the ground floor, from floor 1 up (RFC 0028), each drawn over the ones under
   * it with a shadow that falls further the higher it is, so height reads at a glance.
   */
  floors?: PlotFloor[] | undefined;
  /**
   * The top floor in `floors` is a floor plan, as the map shows the floor you stand on: what's
   * under it shows through dimmed wherever it has no flooring.
   */
  floorPlan?: boolean | undefined;
  ink: PlotInk;
}

const n = (v: number) => Number(v.toFixed(3));

/** The plot as SVG markup, `px` pixels square. Our own markup only: numbers and checked colors. */
export function plotSvg(c: PlotCard, px: number): string {
  const S = Math.max(1, Math.min(32, Math.floor(c.size)));
  const parts = areaParts({
    cols: S,
    rows: S,
    ground: c.ground,
    ...(c.tint ? { tints: [{ x: 0, y: 0, w: S, h: S, fill: c.tint }] } : {}),
    blocks: c.blocks,
    crops: c.crops,
    hearths: c.hearth ? [c.hearth] : [],
    pets: c.pet ? [c.pet] : [],
    figures: c.figures,
    floors: c.floors,
    floorPlan: c.floorPlan,
    ink: c.ink,
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}" viewBox="0 0 ${S} ${S}" shape-rendering="geometricPrecision">${parts.join("")}</svg>`;
}

/** Most tiles an area may be across or down, and most figures and pets it draws. */
const MAX_SIDE = 64;
const MAX_FIGURES = 24;
const MAX_PETS = 24;
/** Most floors above the ground an area draws, and most flooring and blocks on each. */
const MAX_FLOORS = 4;
const MAX_FLOOR_TILES = MAX_SIDE * MAX_SIDE;

/** A floor's shadow, as the map draws it: how far it falls per floor, in tiles, and its color. */
const FLOOR_SHADOW = 0.22;
const FLOOR_SHADE = "rgba(43, 30, 18, 0.24)";
/** How dim what's under a floor plan shows where it has no flooring, as on the map. */
const UNDER_DIM = "rgba(43, 38, 32, 0.38)";
/** How faded a figure under flooring is drawn, as on the map. */
const UNDER_FLOORING_OPACITY = 0.5;

/**
 * An area's markup, in tile units from its top left: the ground and what lies on it, ponds, blocks,
 * decor and furniture, crops, hearths, the floors above the ground floor, pets, and figures, back
 * to front. Our own markup only.
 */
export function areaParts(a: PlotArea): string[] {
  const cols = Math.max(1, Math.min(MAX_SIDE, Math.floor(a.cols)));
  const rows = Math.max(1, Math.min(MAX_SIDE, Math.floor(a.rows)));
  const inX = (v: number) => Number.isFinite(v) && v >= 0 && v < cols;
  const inY = (v: number) => Number.isFinite(v) && v >= 0 && v < rows;
  const parts: string[] = [];
  const tufts: string[] = [];
  const flowers: string[] = [];
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const g = a.ground[y * cols + x];
      if (!g) continue;
      // A hair wider than the tile, so neighbors share pixels and no seams show.
      parts.push(
        `<rect x="${x}" y="${y}" width="1.02" height="1.02" fill="${safeColor(g.fill)}"/>`,
      );
      if (g.paving) {
        parts.push(...pavingSvg(g.paving, x, y));
        continue;
      }
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
      `<path d="${tufts.join("")}" stroke="${safeColor(a.ink.tuft)}" stroke-width="0.045" stroke-linecap="round" fill="none"/>`,
    );
  }
  parts.push(...flowers);
  for (const t of (a.tints ?? []).slice(0, 64)) {
    if (![t.x, t.y, t.w, t.h].every(Number.isFinite) || t.w <= 0 || t.h <= 0) continue;
    parts.push(
      `<rect x="${n(t.x)}" y="${n(t.y)}" width="${n(t.w)}" height="${n(t.h)}" fill="${safeColor(t.fill)}"/>`,
    );
  }

  // Ponds (RFC 0023) lie flat in the ground, under everything standing.
  const ponds = new Set(a.blocks.filter((b) => b.water).map((b) => `${b.x},${b.y}`));
  for (const b of a.blocks) {
    if (!b.water || !inX(b.x) || !inY(b.y)) continue;
    const at = (dx: number, dy: number) => ponds.has(`${b.x + dx},${b.y + dy}`);
    parts.push(
      ...pondSvg(b, safeColor(b.fill), a.ink.pond ?? POND_INK, {
        n: !at(0, -1),
        e: !at(1, 0),
        s: !at(0, 1),
        w: !at(-1, 0),
      }),
    );
  }

  parts.push(...blocksSvg(a.blocks, inX, inY));

  // What's growing, over its planter.
  for (const crop of a.crops ?? []) {
    if (inX(crop.x) && inY(crop.y)) parts.push(...cropSvg(crop));
  }

  // Hearths: a little house with a door and a clay roof.
  for (const h of (a.hearths ?? []).slice(0, 64)) {
    if (!inX(h.x) || !inY(h.y)) continue;
    const sx = h.x + 0.5;
    const sy = h.y + 0.5;
    const half = 0.5;
    parts.push(
      `<ellipse cx="${n(sx)}" cy="${n(sy + half * 0.62)}" rx="${n(half * 0.62)}" ry="${n(half * 0.16)}" fill="rgba(74, 52, 28, 0.2)"/>`,
      `<rect x="${n(sx - half * 0.52)}" y="${n(sy - half * 0.2)}" width="${n(half * 1.04)}" height="${n(half * 0.78)}" fill="${safeColor(a.ink.walls)}"/>`,
      `<rect x="${n(sx - half * 0.14)}" y="${n(sy + half * 0.12)}" width="${n(half * 0.28)}" height="${n(half * 0.46)}" rx="0.04" fill="${safeColor(a.ink.door)}"/>`,
      `<path d="M${n(sx - half * 0.72)} ${n(sy - half * 0.12)}L${n(sx)} ${n(sy - half * 0.78)}L${n(sx + half * 0.72)} ${n(sy - half * 0.12)}z" fill="${safeColor(a.ink.roof)}"/>`,
    );
  }
  parts.push(...floorsSvg(a, cols, rows, inX, inY));
  for (const pet of (a.pets ?? []).slice(0, MAX_PETS)) parts.push(...petSvg(pet, cols, rows));
  // Figures back to front, so someone further south stands in front.
  const figures = (a.figures ?? [])
    .slice(0, MAX_FIGURES)
    .filter((f) => inX(f.x) && Number.isFinite(f.y) && f.y > 0 && f.y <= rows + 1)
    .sort((p, q) => p.y - q.y);
  figures.forEach((f, i) => {
    parts.push(...figureSvg(f, `f${i}`));
  });
  return parts;
}

/**
 * Blocks standing on one floor: a ground shadow, the block, a bottom shade, and a top highlight,
 * as in the world, with decor and furniture as themselves. Fences and low walls join their
 * neighbors on the same floor. Ponds are drawn flat with the ground, so they're left out here.
 */
function blocksSvg(
  blocks: readonly PlotBlock[],
  inX: (v: number) => boolean,
  inY: (v: number) => boolean,
): string[] {
  const parts: string[] = [];
  const fences = new Set(blocks.filter((b) => b.decor === "fence").map((b) => `${b.x},${b.y}`));
  const walls = new Set(
    blocks.filter((b) => b.furniture === "stone_wall").map((b) => `${b.x},${b.y}`),
  );
  for (const b of blocks) {
    if (b.water || !inX(b.x) || !inY(b.y)) continue;
    if (b.furniture && (PLOT_FURNITURE as readonly string[]).includes(b.furniture)) {
      const at = (dx: number, dy: number) => walls.has(`${b.x + dx},${b.y + dy}`);
      parts.push(
        ...furnitureSvg(b.furniture, b.x, b.y, safeColor(b.fill), {
          n: at(0, -1),
          e: at(1, 0),
          s: at(0, 1),
          w: at(-1, 0),
        }),
      );
      continue;
    }
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
  return parts;
}

/**
 * The floors above the ground floor (RFC 0028), as the map draws them: each over the ones under
 * it, from the ground up, its flooring and blocks casting a shadow that falls further the higher it
 * is. A floor plan first dims every tile where its top floor has no flooring, so what's below shows
 * through.
 */
function floorsSvg(
  a: PlotArea,
  cols: number,
  rows: number,
  inX: (v: number) => boolean,
  inY: (v: number) => boolean,
): string[] {
  const floors = (a.floors ?? []).slice(0, MAX_FLOORS).map((s) => ({
    flooring: (s.flooring ?? []).slice(0, MAX_FLOOR_TILES).filter((f) => inX(f.x) && inY(f.y)),
    blocks: (s.blocks ?? []).slice(0, MAX_FLOOR_TILES),
  }));
  const parts: string[] = [];
  const top = floors.at(-1);
  if (a.floorPlan && top) {
    const floored = new Set(top.flooring.map((f) => `${f.x},${f.y}`));
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        if (floored.has(`${x},${y}`)) continue;
        parts.push(`<rect x="${x}" y="${y}" width="1.02" height="1.02" fill="${UNDER_DIM}"/>`);
      }
    }
  }
  floors.forEach((s, i) => {
    const drop = FLOOR_SHADOW * (i + 1);
    const tiles = new Set<string>();
    for (const t of [...s.flooring, ...s.blocks.filter((b) => !b.water)]) {
      if (inX(t.x) && inY(t.y)) tiles.add(`${t.x},${t.y}`);
    }
    for (const key of tiles) {
      const [x, y] = key.split(",").map(Number) as [number, number];
      parts.push(
        `<rect x="${n(x + drop)}" y="${n(y + drop)}" width="1" height="1" fill="${FLOOR_SHADE}"/>`,
      );
    }
    for (const f of s.flooring) parts.push(...pavingSvg(f.paving, f.x, f.y));
    parts.push(...blocksSvg(s.blocks, inX, inY));
  });
  return parts;
}

/**
 * A resident's figure with its feet at (x, y): a soft shadow on the ground, then the figure at a
 * tile's height, as the map stands it (100 of the drawing's units to a tile).
 */
function figureSvg(f: PlacedFigure, id: string): string[] {
  if (!drawingBox(f.drawing)) return [];
  const body = drawingSvg(f.drawing, id);
  if (!body) return [];
  // Never hidden: someone under flooring is drawn faded (RFC 0028).
  const faded = f.faded ? ` opacity="${UNDER_FLOORING_OPACITY}"` : "";
  return [
    `<ellipse cx="${n(f.x)}" cy="${n(f.y)}" rx="0.27" ry="0.085" fill="rgba(60, 40, 20, 0.22)"/>`,
    `<g transform="translate(${n(f.x)} ${n(f.y)}) scale(0.01)"${faded}>${body}</g>`,
  ];
}

/**
 * A tile of pond as `packages/client/src/render.ts` draws it, held still for a photo: the water, a
 * shade along each bank, the stone rim there with three pebbles a side, a lily pad when it has one,
 * and two glints.
 */
function pondSvg(
  b: PlotBlock,
  water: string,
  ink: PlotPondInk,
  open: { n: boolean; e: boolean; s: boolean; w: boolean },
): string[] {
  const { x, y } = b;
  const band = 0.28;
  const rim = 0.13;
  const out = [`<rect x="${x}" y="${y}" width="1.02" height="1.02" fill="${water}"/>`];
  const sides = [
    [open.n, x, y, 1, band, x, y, 1, rim],
    [open.s, x, y + 1 - band, 1, band, x, y + 1 - rim, 1, rim],
    [open.w, x, y, band, 1, x, y, rim, 1],
    [open.e, x + 1 - band, y, band, 1, x + 1 - rim, y, rim, 1],
  ] as const;
  for (const [on, sx, sy, w, h] of sides) {
    if (on) {
      out.push(
        `<rect x="${n(sx)}" y="${n(sy)}" width="${w}" height="${h}" fill="${safeColor(ink.shade)}"/>`,
      );
    }
  }
  for (const [on, , , , , sx, sy, w, h] of sides) {
    if (!on) continue;
    out.push(
      `<rect x="${n(sx)}" y="${n(sy)}" width="${w}" height="${h}" fill="${safeColor(ink.stone)}"/>`,
    );
    for (const t of [0.22, 0.58, 0.86]) {
      const px = w > h ? sx + w * t : sx + w / 2;
      const py = w > h ? sy + h / 2 : sy + h * t;
      out.push(`<circle cx="${n(px)}" cy="${n(py)}" r="0.04" fill="${safeColor(ink.pebble)}"/>`);
    }
  }
  if (b.lily) {
    out.push(
      `<path d="M${n(x + 0.42)} ${n(y + 0.56)}l0.12 -0.05a0.13 0.13 0 1 0 0 0.1z" fill="${safeColor(ink.lily)}"/>`,
    );
  }
  out.push(
    `<path d="M${n(x + 0.26)} ${n(y + 0.4)}H${n(x + 0.44)}M${n(x + 0.54)} ${n(y + 0.7)}H${n(x + 0.66)}" stroke="${safeColor(ink.glint)}" stroke-opacity="0.6" stroke-width="0.045" stroke-linecap="round"/>`,
  );
  return out;
}

/**
 * A fallen leaf around (cx, cy), lying `turn` radians from east: two curves from tip to tip, as
 * `packages/client/src/render.ts` draws it. Undefined for anything that isn't a finite number.
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

/** The side of a pet picture's box, in its own units, as the sim draws it. */
const PET_BOX = 48;
const PET_TAGS = new Set(["path", "circle", "ellipse"]);
const NUMERIC = new Set(["cx", "cy", "r", "rx", "ry", "stroke-width", "opacity"]);
const WORDS: Record<string, ReadonlySet<string>> = {
  "stroke-linejoin": new Set(["round", "miter", "bevel"]),
  "stroke-linecap": new Set(["round", "butt", "square"]),
};
/** A path made only of commands and numbers: nothing that could close the attribute. */
const PATH_DATA = /^[MmLlHhVvCcSsQqTtAaZz0-9.,\s-]{1,1500}$/;

/** One attribute of a pet's shape as markup, or "" when it isn't one we draw or doesn't check out. */
function petAttr(name: string, value: string | number): string {
  if (NUMERIC.has(name)) {
    const v = Number(value);
    return typeof value === "number" && Number.isFinite(v) && Math.abs(v) < 1000
      ? ` ${name}="${n(v)}"`
      : "";
  }
  if (name === "fill" || name === "stroke") {
    return value === "none" ? ` ${name}="none"` : ` ${name}="${safeColor(String(value))}"`;
  }
  if (name === "d") return PATH_DATA.test(String(value)) ? ` d="${String(value)}"` : "";
  const words = WORDS[name];
  return words?.has(String(value)) ? ` ${name}="${String(value)}"` : "";
}

/** A pet on the plot, its picture scaled into its box and flipped to face left when it does. */
export function petSvg(p: PlotPet, cols: number, rows = cols): string[] {
  const { x, y, size } = p;
  const ok = [x, y, size].every(Number.isFinite) && size > 0 && size <= 4;
  if (!ok || x < -size || y < -size || x > cols || y > rows || !Array.isArray(p.shapes)) {
    return [];
  }
  const k = size / PET_BOX;
  const place = p.flip
    ? `translate(${n(x + size)} ${n(y)}) scale(${n(-k)} ${n(k)})`
    : `translate(${n(x)} ${n(y)}) scale(${n(k)})`;
  const shapes = p.shapes.slice(0, 80).flatMap((s) => {
    if (!PET_TAGS.has(s.tag) || !s.attrs || typeof s.attrs !== "object") return [];
    const attrs = Object.entries(s.attrs)
      .map(([name, value]) => petAttr(name, value))
      .join("");
    return [`<${s.tag}${attrs}/>`];
  });
  return [`<g transform="${place}">${shapes.join("")}</g>`];
}

const WOOD_DARK = "#6e4a2c";
const EDGE = "rgba(70, 40, 18, 0.5)";
const STRAW = "#e8c878";
const BURLAP = "#d9bf8f";
/**
 * Halloween's colors (RFC 0022), as `packages/ui/src/looks.ts` has them. Bunting's bats are its
 * `fill`.
 */
const PENNANT = "#e8862f";
const IRON_RIM = "#56545e";
const BREW = "#8fd16a";
const BREW_LIGHT = "#c8f0a8";
const STAND = "#c4661c";
const CANDY = ["#f08a3c", "#a98bd8", "#ea8a9d", "#7fd1b0", "#f2b84b"] as const;
/**
 * Winter's colors (RFC 0017), as `WINTER_HEX` in `packages/ui/src/looks.ts` has them. Each decor's
 * main color is its `fill`: the snowman's snow, the string's warm bulb, the fir's needles, the
 * sled's slats.
 */
const SNOW_SHADE = "#c4d2e2";
const SNOW_EDGE = "rgba(84, 104, 128, 0.7)";
const COAL = "#2f2c33";
const CARROT = "#ec7a2c";
const SCARF = "#c8344a";
const SNOW_HAT = "#3a3946";
const SNOW = "#f4f7fb";
const WIRE = "#3f5a3c";
const BULBS = ["#f2564c", "#5ec0ea", "#7fd17a", "#c38df0"] as const;
const NEEDLES_LIGHT = "#4a8f5c";
const POT = "#c8674a";
const POT_RIM = "#a9533a";
const STAR = "#f2c94c";
const RUNNER = "#4a4542";
const SLAT_SIDE = "#9e3428";
const ROPE = "#e3cf9c";
/**
 * A bat with its wings spread, as `BAT_POINTS` in `packages/ui/src/looks.ts`: half its span is 1.
 */
const BAT_POINTS: readonly (readonly [number, number])[] = [
  [0, -0.2],
  [-0.12, -0.42],
  [-0.2, -0.18],
  [-0.55, -0.36],
  [-1, -0.08],
  [-0.78, 0.06],
  [-0.66, 0],
  [-0.52, 0.2],
  [-0.36, 0.1],
  [-0.2, 0.32],
  [0, 0.18],
  [0.2, 0.32],
  [0.36, 0.1],
  [0.52, 0.2],
  [0.66, 0],
  [0.78, 0.06],
  [1, -0.08],
  [0.55, -0.36],
  [0.2, -0.18],
  [0.12, -0.42],
];

/**
 * One decor block on tile (x, y), following `packages/client/src/render.ts`: a paper lantern on a
 * hook, a picture on an easel, a fence post with rails to the fences beside it, a garden bench, a
 * hay bale, a scarecrow, bat bunting, a cauldron, a candy bowl, a snowman, a string of lights, a
 * little fir, or a sled. Only numbers and checked colors go in. No ellipses, so the tests can tell
 * the hearth's shadow apart.
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
  if (kind === "bat_bunting") {
    const at = (t: number) => ({ x: 0.12 + 0.76 * t, y: 0.26 + 0.52 * t * (1 - t) });
    const bat = (t: number) => {
      const p = at(t);
      const k = 0.135;
      const d = BAT_POINTS.map(
        ([bx, by], i) => `${i ? "L" : "M"}${X(p.x + bx * k)} ${Y(p.y + 0.07 + by * k)}`,
      );
      return `<path d="${d.join("")}z" fill="${fill}"/>`;
    };
    const pennant = (t: number) => {
      const p = at(t);
      return `<path d="M${X(p.x - 0.06)} ${Y(p.y)}H${X(p.x + 0.06)}L${X(p.x)} ${Y(p.y + 0.14)}z" fill="${PENNANT}"/>`;
    };
    return [
      shade,
      `<path d="M${X(0.12)} ${Y(0.92)}V${Y(0.22)}M${X(0.88)} ${Y(0.92)}V${Y(0.22)}" stroke="${WOOD_DARK}" stroke-width="0.06" stroke-linecap="round"/>`,
      `<path d="M${X(0.12)} ${Y(0.26)}Q${X(0.5)} ${Y(0.52)} ${X(0.88)} ${Y(0.26)}" fill="none" stroke="#5a4f60" stroke-width="0.02"/>`,
      pennant(0.35),
      pennant(0.65),
      bat(0.18),
      bat(0.5),
      bat(0.82),
    ];
  }
  if (kind === "cauldron") {
    return [
      shade,
      `<rect x="${X(0.26)}" y="${Y(0.78)}" width="0.08" height="0.14" fill="${fill}"/>`,
      `<rect x="${X(0.66)}" y="${Y(0.78)}" width="0.08" height="0.14" fill="${fill}"/>`,
      `<path d="M${X(0.16)} ${Y(0.42)}C${X(0.16)} ${Y(0.86)} ${X(0.84)} ${Y(0.86)} ${X(0.84)} ${Y(0.42)}z" fill="${fill}" ${stroke}/>`,
      `<path d="M${X(0.14)} ${Y(0.42)}a0.36 0.09 0 1 0 0.72 0a0.36 0.09 0 1 0 -0.72 0z" fill="${IRON_RIM}" ${stroke}/>`,
      `<path d="M${X(0.22)} ${Y(0.42)}a0.28 0.055 0 1 0 0.56 0a0.28 0.055 0 1 0 -0.56 0z" fill="${BREW}"/>`,
      `<circle cx="${X(0.42)}" cy="${Y(0.32)}" r="0.045" fill="${BREW_LIGHT}"/>`,
      `<circle cx="${X(0.57)}" cy="${Y(0.24)}" r="0.032" fill="${BREW_LIGHT}"/>`,
    ];
  }
  if (kind === "candy_bowl") {
    const sweets = (
      [
        [0.32, 0.44, 0],
        [0.67, 0.44, 1],
        [0.5, 0.37, 4],
        [0.42, 0.47, 3],
        [0.58, 0.47, 2],
      ] as const
    ).map(
      ([cx, cy, c]) =>
        `<circle cx="${X(cx)}" cy="${Y(cy)}" r="0.085" fill="${CANDY[c]}" ${stroke}/>`,
    );
    return [
      shade,
      `<path d="M${X(0.38)} ${Y(0.9)}H${X(0.62)}L${X(0.57)} ${Y(0.74)}H${X(0.43)}z" fill="${STAND}"/>`,
      ...sweets,
      `<path d="M${X(0.12)} ${Y(0.5)}H${X(0.88)}C${X(0.88)} ${Y(0.82)} ${X(0.12)} ${Y(0.82)} ${X(0.12)} ${Y(0.5)}z" fill="${fill}" ${stroke}/>`,
      `<rect x="${X(0.16)}" y="${Y(0.58)}" width="0.68" height="0.05" fill="${CANDY[1]}"/>`,
    ];
  }
  if (kind === "snowman") {
    const snow = `stroke="${SNOW_EDGE}" stroke-width="0.035"`;
    const ball = (cy: number, r: number) => [
      `<circle cx="${X(0.5)}" cy="${Y(cy)}" r="${r}" fill="${SNOW_SHADE}"/>`,
      `<circle cx="${X(0.5 - r * 0.2)}" cy="${Y(cy - r * 0.2)}" r="${n(r * 0.94)}" fill="${fill}"/>`,
      `<circle cx="${X(0.5)}" cy="${Y(cy)}" r="${r}" fill="none" ${snow}/>`,
    ];
    return [
      shade,
      `<path d="M${X(0.4)} ${Y(0.46)}L${X(0.14)} ${Y(0.3)}M${X(0.6)} ${Y(0.46)}L${X(0.86)} ${Y(0.3)}" stroke="${WOOD_DARK}" stroke-width="0.035" stroke-linecap="round"/>`,
      ...ball(0.74, 0.2),
      ...ball(0.47, 0.145),
      ...ball(0.25, 0.105),
      `<circle cx="${X(0.46)}" cy="${Y(0.235)}" r="0.018" fill="${COAL}"/>`,
      `<circle cx="${X(0.54)}" cy="${Y(0.235)}" r="0.018" fill="${COAL}"/>`,
      `<circle cx="${X(0.5)}" cy="${Y(0.44)}" r="0.02" fill="${COAL}"/>`,
      `<circle cx="${X(0.5)}" cy="${Y(0.51)}" r="0.02" fill="${COAL}"/>`,
      `<path d="M${X(0.5)} ${Y(0.255)}L${X(0.61)} ${Y(0.272)}L${X(0.5)} ${Y(0.29)}z" fill="${CARROT}"/>`,
      `<rect x="${X(0.37)}" y="${Y(0.335)}" width="0.26" height="0.06" rx="0.03" fill="${SCARF}" ${stroke}/>`,
      `<rect x="${X(0.54)}" y="${Y(0.36)}" width="0.06" height="0.13" rx="0.02" fill="${SCARF}" ${stroke}/>`,
      `<rect x="${X(0.37)}" y="${Y(0.14)}" width="0.26" height="0.035" rx="0.015" fill="${SNOW_HAT}"/>`,
      `<rect x="${X(0.425)}" y="${Y(0.03)}" width="0.15" height="0.12" rx="0.02" fill="${SNOW_HAT}"/>`,
    ];
  }
  if (kind === "string_lights") {
    const at = (t: number) => ({ x: 0.1 + 0.8 * t, y: 0.32 + 0.48 * t * (1 - t) + 0.07 });
    const bulbs = [0.12, 0.31, 0.5, 0.69, 0.88].map((t, i) => {
      const p = at(t);
      const color = i === 1 ? fill : (BULBS[i % BULBS.length] as string);
      return `<rect x="${X(p.x - 0.036)}" y="${Y(p.y - 0.052)}" width="0.072" height="0.104" rx="0.036" fill="${color}" ${stroke}/>`;
    });
    return [
      shade,
      `<path d="M${X(0.1)} ${Y(0.92)}V${Y(0.28)}M${X(0.9)} ${Y(0.92)}V${Y(0.28)}" stroke="${WOOD_DARK}" stroke-width="0.06" stroke-linecap="round"/>`,
      `<path d="M${X(0.1)} ${Y(0.32)}Q${X(0.5)} ${Y(0.56)} ${X(0.9)} ${Y(0.32)}" fill="none" stroke="${WIRE}" stroke-width="0.025"/>`,
      ...bulbs,
    ];
  }
  if (kind === "little_fir") {
    const tiers = (
      [
        [0.36, 0.7, 0.3],
        [0.2, 0.53, 0.23],
        [0.06, 0.35, 0.16],
      ] as const
    ).flatMap(([apex, base, half]) => [
      `<path d="M${X(0.5)} ${Y(apex)}L${X(0.5 + half)} ${Y(base)}Q${X(0.5)} ${Y(base + 0.05)} ${X(0.5 - half)} ${Y(base)}z" fill="${fill}" ${stroke}/>`,
      `<path d="M${X(0.5)} ${Y(apex)}L${X(0.5 - half * 0.75)} ${Y(base - 0.02)}L${X(0.5 - half * 0.45)} ${Y(base - 0.01)}z" fill="${NEEDLES_LIGHT}"/>`,
      `<rect x="${X(0.5 - half * 0.7 - 0.06)}" y="${Y(base - 0.022)}" width="0.12" height="0.044" rx="0.022" fill="${SNOW}"/>`,
      `<rect x="${X(0.5 + half * 0.65 - 0.07)}" y="${Y(base - 0.024)}" width="0.14" height="0.048" rx="0.024" fill="${SNOW}"/>`,
    ]);
    const star: string[] = [];
    for (let i = 0; i < 10; i++) {
      const a = -Math.PI / 2 + (i * Math.PI) / 5;
      const r = i % 2 === 0 ? 0.07 : 0.03;
      star.push(`${i ? "L" : "M"}${X(0.5 + Math.cos(a) * r)} ${Y(0.07 + Math.sin(a) * r)}`);
    }
    return [
      shade,
      `<rect x="${X(0.465)}" y="${Y(0.64)}" width="0.07" height="0.1" fill="${WOOD_DARK}"/>`,
      ...tiers,
      `<path d="M${X(0.33)} ${Y(0.75)}H${X(0.67)}L${X(0.63)} ${Y(0.93)}H${X(0.37)}z" fill="${POT}" ${stroke}/>`,
      `<rect x="${X(0.3)}" y="${Y(0.7)}" width="0.4" height="0.07" rx="0.02" fill="${POT_RIM}" ${stroke}/>`,
      `<path d="${star.join("")}z" fill="${STAR}" ${stroke}/>`,
    ];
  }
  if (kind === "sled") {
    const runner = (dx: number, dy: number, color: string) =>
      `<path d="M${X(0.08 + dx)} ${Y(0.86 + dy)}H${X(0.74 + dx)}Q${X(0.92 + dx)} ${Y(0.86 + dy)} ${X(0.9 + dx)} ${Y(0.68 + dy)}M${X(0.18 + dx)} ${Y(0.86 + dy)}V${Y(0.72 + dy)}M${X(0.44 + dx)} ${Y(0.86 + dy)}V${Y(0.72 + dy)}M${X(0.68 + dx)} ${Y(0.86 + dy)}V${Y(0.72 + dy)}" fill="none" stroke="${color}" stroke-width="0.045" stroke-linecap="round"/>`;
    return [
      shade,
      runner(0.05, -0.07, "#6e6a66"),
      runner(0, 0, RUNNER),
      `<path d="M${X(0.1)} ${Y(0.66)}H${X(0.78)}V${Y(0.74)}H${X(0.1)}z" fill="${SLAT_SIDE}" ${stroke}/>`,
      `<path d="M${X(0.1)} ${Y(0.66)}L${X(0.17)} ${Y(0.58)}H${X(0.85)}L${X(0.78)} ${Y(0.66)}z" fill="${fill}" ${stroke}/>`,
      `<path d="M${X(0.88)} ${Y(0.62)}Q${X(1)} ${Y(0.6)} ${X(0.96)} ${Y(0.78)}" fill="none" stroke="${ROPE}" stroke-width="0.03" stroke-linecap="round"/>`,
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

const STEM = "#5f9a43";
const LEAF = "#6fae4c";
/** A pumpkin before it ripens, swelling toward its color. */
const BUD = "#8cbf5a";
const PUMPKIN_STEM = "#76703a";
/** The thin dark edge around each fruit. */
const FRUIT_EDGE = ' stroke="rgba(43, 38, 32, 0.35)" stroke-width="0.02"';

/** `a` moved `t` of the way toward `b`, both #rrggbb; `a` when either isn't one. */
function mixColor(a: string, b: string, t: number): string {
  const hex = /^#[0-9a-f]{6}$/i;
  if (!hex.test(a) || !hex.test(b)) return a;
  const k = Number.isFinite(t) ? Math.max(0, Math.min(1, t)) : 0;
  let out = "#";
  for (let i = 1; i < 7; i += 2) {
    const from = Number.parseInt(a.slice(i, i + 2), 16);
    const to = Number.parseInt(b.slice(i, i + 2), 16);
    out += Math.round(from + (to - from) * k)
      .toString(16)
      .padStart(2, "0");
  }
  return out;
}

/**
 * An oval as a path, turned `turn` degrees, so the hearth's shadow stays the photo's only ellipse.
 * `edge` is our own stroke attributes, or nothing.
 */
function oval(
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  turn: number,
  fill: string,
  edge = "",
): string {
  const x = n(cx);
  const y = n(cy);
  const spin = turn ? ` transform="rotate(${n(turn)} ${x} ${y})"` : "";
  return `<path d="M${n(cx - rx)} ${y}a${n(rx)} ${n(ry)} 0 1 0 ${n(rx * 2)} 0a${n(rx)} ${n(ry)} 0 1 0 -${n(rx * 2)} 0z"${spin} fill="${fill}"${edge}/>`;
}

/**
 * A crop on its planter, as `packages/client/src/render.ts` paints it: a sprout that grows taller,
 * with three fruit or flowers in its color once it's ready; or, for a crop on a vine like a
 * pumpkin, a vine along the soil, its fruit swelling from a green bud and turning its color, with a
 * stem once it's ripe. The planter is the block under it, so the same 0.05 inset and 0.9 tile size
 * apply.
 */
function cropSvg(c: PlotCrop): string[] {
  const done = Number.isFinite(c.done) ? Math.max(0, Math.min(1, c.done)) : 0;
  const fill = safeColor(c.fill);
  const size = 0.9;
  const cx = c.x + 0.05 + size / 2;
  const top = c.y + 0.05;
  const line = (d: string, stroke: string, width: number) =>
    `<path d="${d}" stroke="${stroke}" stroke-width="${n(width)}" stroke-linecap="round" fill="none"/>`;
  if (c.vine) {
    const base = top + size * 0.7;
    const spread = size * (0.14 + 0.2 * done);
    const leaf = size * (0.07 + 0.07 * done);
    const out = [
      line(
        `M${n(cx - spread)} ${n(base)}Q${n(cx)} ${n(base - size * 0.14)} ${n(cx + spread)} ${n(base)}`,
        STEM,
        size / 16,
      ),
      ...[-1, 1].map((side) =>
        oval(cx + side * spread * 0.85, base - leaf * 0.3, leaf, leaf * 0.6, side * 23, LEAF),
      ),
    ];
    if (done <= 0.2) return out;
    const ripe = done >= 1;
    const swell = (done - 0.2) / 0.8;
    const r = size * (0.08 + 0.15 * swell);
    const y = base - r * 0.55;
    const skin = ripe ? fill : mixColor(BUD, fill, swell * 0.5);
    for (const dx of [-0.5, 0.5, 0])
      out.push(oval(cx + dx * r, y, r * 0.72, r * 0.82, 0, skin, FRUIT_EDGE));
    if (ripe)
      out.push(
        line(
          `M${n(cx)} ${n(y - r * 0.7)}L${n(cx + r * 0.15)} ${n(y - r * 1.05)}`,
          PUMPKIN_STEM,
          size / 18,
        ),
      );
    return out;
  }
  const base = top + size * 0.66;
  const tall = size * (0.18 + 0.32 * done);
  const leaf = size * (0.08 + 0.08 * done);
  const out = [
    line(`M${n(cx)} ${n(base)}V${n(base - tall)}`, STEM, size / 14),
    ...[-1, 1].map((side) =>
      oval(cx + side * leaf, base - tall * 0.55, leaf, leaf * 0.5, side * 29, LEAF),
    ),
  ];
  if (done >= 1) {
    for (const [dx, dy] of [
      [-0.16, -0.05],
      [0.16, -0.1],
      [0, -0.2],
    ] as const) {
      out.push(
        `<circle cx="${n(cx + dx * size)}" cy="${n(base - tall + dy * size + tall * 0.4)}" r="${n(size * 0.09)}" fill="${fill}"${FRUIT_EDGE}/>`,
      );
    }
  }
  return out;
}

/** A number kept to a tile's own small range, or 0. */
const unit = (v: number, max = 1.5) =>
  Number.isFinite(v) ? n(Math.max(-0.5, Math.min(max, v))) : 0;

/** A path or flooring's shapes on tile (x, y), from the sim's look: numbers and checked colors only. */
function pavingSvg(p: PlotPaving, x: number, y: number): string[] {
  const out: string[] = [];
  if (p.fill) {
    out.push(`<rect x="${x}" y="${y}" width="1.02" height="1.02" fill="${safeColor(p.fill)}"/>`);
  }
  for (const m of p.marks) {
    if (m.shape === "rect") {
      out.push(
        `<rect x="${n(x + unit(m.x))}" y="${n(y + unit(m.y))}" width="${unit(m.w)}" height="${unit(m.h)}" rx="${unit(m.r)}" fill="${safeColor(m.fill)}"/>`,
      );
    } else if (m.shape === "circle") {
      out.push(
        `<circle cx="${n(x + unit(m.cx))}" cy="${n(y + unit(m.cy))}" r="${unit(m.r)}" fill="${safeColor(m.fill)}"/>`,
      );
    } else if (m.shape === "ellipse") {
      // A leaf: a turned oval, as a path, so the hearth's shadow stays the photo's only ellipse.
      const cx = n(x + unit(m.cx));
      const cy = n(y + unit(m.cy));
      const rx = unit(m.rx);
      const ry = unit(m.ry);
      const turn = Number.isFinite(m.turn) ? Math.round(m.turn) % 360 : 0;
      out.push(
        `<path d="M${n(cx - rx)} ${cy}a${rx} ${ry} 0 1 0 ${n(rx * 2)} 0a${rx} ${ry} 0 1 0 -${n(rx * 2)} 0z" transform="rotate(${turn} ${cx} ${cy})" fill="${safeColor(m.fill)}"/>`,
      );
    } else if (m.shape === "line") {
      out.push(
        `<path d="M${n(x + unit(m.x1))} ${n(y + unit(m.y1))}L${n(x + unit(m.x2))} ${n(y + unit(m.y2))}" stroke="${safeColor(m.stroke)}" stroke-width="${unit(m.width)}" stroke-linecap="round" fill="none"/>`,
      );
    }
  }
  return out;
}

const STONE_LO = "#8f887c";
const STONE_HI = "#c4beb2";
const FLOWERS = ["#e58fb6", "#f2b84b", "#fff4d6", "#a98bd8"];
const BOOKS = ["#b4532f", "#7cb9dd", "#f2b84b", "#5e7f45", "#a98bd8"];

/**
 * One piece of furniture on tile (x, y), following its picture in the world: a table, a chair, a
 * bookshelf, a barrel, a signpost, a lamp post, a well, a low stone wall that joins the walls
 * beside it, a campfire, or a flower box. Only numbers and checked colors go in, and no ellipses.
 */
function furnitureSvg(
  kind: PlotFurniture,
  x: number,
  y: number,
  fill: string,
  joins: { n: boolean; e: boolean; s: boolean; w: boolean },
): string[] {
  const X = (f: number) => n(x + f);
  const Y = (f: number) => n(y + f);
  const stroke = `stroke="${EDGE}" stroke-width="0.035" stroke-linejoin="round"`;
  const shade = `<rect x="${X(0.14)}" y="${Y(0.86)}" width="0.72" height="0.1" rx="0.05" fill="rgba(74, 52, 28, 0.2)"/>`;
  const rect = (
    fx: number,
    fy: number,
    w: number,
    h: number,
    color: string,
    r = 0.03,
    edge = true,
  ) =>
    `<rect x="${X(fx)}" y="${Y(fy)}" width="${w}" height="${h}" rx="${r}" fill="${color}"${edge ? ` ${stroke}` : ""}/>`;
  const dot = (fx: number, fy: number, r: number, color: string) =>
    `<circle cx="${X(fx)}" cy="${Y(fy)}" r="${r}" fill="${color}"/>`;
  switch (kind) {
    case "table":
      return [
        shade,
        rect(0.2, 0.5, 0.08, 0.38, WOOD_DARK, 0.02, false),
        rect(0.72, 0.5, 0.08, 0.38, WOOD_DARK, 0.02, false),
        rect(0.08, 0.32, 0.84, 0.2, fill, 0.05),
      ];
    case "chair":
      return [
        shade,
        rect(0.27, 0.12, 0.08, 0.5, fill, 0.02),
        rect(0.65, 0.12, 0.08, 0.5, fill, 0.02),
        rect(0.27, 0.16, 0.46, 0.09, fill, 0.02),
        rect(0.29, 0.66, 0.07, 0.24, WOOD_DARK, 0.02, false),
        rect(0.64, 0.66, 0.07, 0.24, WOOD_DARK, 0.02, false),
        rect(0.2, 0.56, 0.6, 0.12, fill, 0.03),
      ];
    case "bookshelf":
      return [
        shade,
        rect(0.16, 0.06, 0.68, 0.84, fill, 0.04),
        rect(0.22, 0.12, 0.56, 0.72, WOOD_DARK, 0.02, false),
        ...[0.14, 0.4, 0.64].flatMap((fy, row) =>
          [0, 1, 2, 3].map((i) =>
            rect(
              0.24 + i * 0.13,
              fy,
              0.1,
              0.2,
              BOOKS[(i + row) % BOOKS.length] as string,
              0.01,
              false,
            ),
          ),
        ),
      ];
    case "barrel":
      return [
        shade,
        rect(0.22, 0.14, 0.56, 0.74, fill, 0.18),
        `<path d="M${X(0.21)} ${Y(0.32)}h0.58M${X(0.21)} ${Y(0.7)}h0.58" stroke="#5d5a55" stroke-width="0.05" fill="none"/>`,
      ];
    case "signpost":
      return [
        shade,
        rect(0.46, 0.18, 0.08, 0.72, WOOD_DARK, 0.02, false),
        `<path d="M${X(0.16)} ${Y(0.2)}h0.56l0.12 0.1-0.12 0.1h-0.56z" fill="${fill}" ${stroke}/>`,
        `<path d="M${X(0.84)} ${Y(0.48)}h-0.56l-0.12 0.1 0.12 0.1h0.56z" fill="${fill}" ${stroke}/>`,
      ];
    case "lamp_post":
      return [
        shade,
        dot(0.5, 0.24, 0.24, "rgba(242, 181, 68, 0.28)"),
        rect(0.46, 0.3, 0.08, 0.6, fill, 0.02, false),
        rect(0.38, 0.84, 0.24, 0.07, fill, 0.02, false),
        rect(0.38, 0.14, 0.24, 0.2, "#f9d27a", 0.04),
        `<path d="M${X(0.34)} ${Y(0.15)}L${X(0.5)} ${Y(0.04)}L${X(0.66)} ${Y(0.15)}z" fill="${fill}"/>`,
      ];
    case "well":
      return [
        shade,
        rect(0.2, 0.22, 0.06, 0.46, WOOD_DARK, 0.02, false),
        rect(0.74, 0.22, 0.06, 0.46, WOOD_DARK, 0.02, false),
        `<path d="M${X(0.1)} ${Y(0.26)}L${X(0.5)} ${Y(0.04)}L${X(0.9)} ${Y(0.26)}z" fill="#b4532f" ${stroke}/>`,
        rect(0.16, 0.56, 0.68, 0.34, fill, 0.08),
        rect(0.16, 0.54, 0.68, 0.1, STONE_HI, 0.05),
        rect(0.24, 0.56, 0.52, 0.06, "#3f5f6f", 0.03, false),
      ];
    case "stone_wall": {
      const x0 = joins.w ? 0 : 0.2;
      const x1 = joins.e ? 1 : 0.8;
      return [
        ...(joins.n ? [rect(0.2, 0, 0.6, 0.45, fill, 0, false)] : []),
        ...(joins.s ? [rect(0.2, 0.85, 0.6, 0.15, fill, 0, false)] : []),
        rect(x0, 0.42, n(x1 - x0), 0.48, fill, 0.04),
        `<path d="M${X(x0)} ${Y(0.66)}H${X(x1)}" stroke="${STONE_LO}" stroke-width="0.03" fill="none"/>`,
        rect(x0, 0.36, n(x1 - x0), 0.1, STONE_HI, 0.04, false),
      ];
    }
    case "campfire":
      return [
        dot(0.5, 0.58, 0.32, "rgba(242, 181, 68, 0.22)"),
        `<path d="M${X(0.22)} ${Y(0.8)}L${X(0.78)} ${Y(0.66)}M${X(0.26)} ${Y(0.66)}L${X(0.76)} ${Y(0.8)}" stroke="${WOOD_DARK}" stroke-width="0.09" stroke-linecap="round" fill="none"/>`,
        `<path d="M${X(0.5)} ${Y(0.18)}C${X(0.66)} ${Y(0.36)} ${X(0.72)} ${Y(0.5)} ${X(0.66)} ${Y(0.64)}C${X(0.6)} ${Y(0.76)} ${X(0.4)} ${Y(0.76)} ${X(0.34)} ${Y(0.64)}C${X(0.28)} ${Y(0.5)} ${X(0.4)} ${Y(0.4)} ${X(0.5)} ${Y(0.18)}z" fill="${fill}" ${stroke}/>`,
        `<path d="M${X(0.5)} ${Y(0.42)}C${X(0.58)} ${Y(0.52)} ${X(0.6)} ${Y(0.6)} ${X(0.56)} ${Y(0.66)}C${X(0.53)} ${Y(0.71)} ${X(0.47)} ${Y(0.71)} ${X(0.44)} ${Y(0.66)}C${X(0.4)} ${Y(0.6)} ${X(0.44)} ${Y(0.52)} ${X(0.5)} ${Y(0.42)}z" fill="#f2b84b"/>`,
        ...[0.16, 0.33, 0.5, 0.67, 0.84].map((fx, i) =>
          dot(fx, i === 0 || i === 4 ? 0.8 : 0.86, 0.07, "#a39d93"),
        ),
      ];
    case "jack_o_lantern":
      return [
        dot(0.5, 0.56, 0.34, "rgba(242, 181, 68, 0.22)"),
        dot(0.32, 0.62, 0.2, fill),
        dot(0.68, 0.62, 0.2, fill),
        dot(0.5, 0.6, 0.24, fill),
        `<path d="M${X(0.48)} ${Y(0.37)}L${X(0.52)} ${Y(0.24)}" stroke="#6a6136" stroke-width="0.06" stroke-linecap="round"/>`,
        `<path d="M${X(0.36)} ${Y(0.58)}L${X(0.42)} ${Y(0.48)}L${X(0.48)} ${Y(0.58)}zM${X(0.52)} ${Y(0.58)}L${X(0.58)} ${Y(0.48)}L${X(0.64)} ${Y(0.58)}zM${X(0.36)} ${Y(0.66)}Q${X(0.5)} ${Y(0.78)} ${X(0.64)} ${Y(0.66)}z" fill="#ffd36b"/>`,
      ];
    case "flower_box":
      return [
        shade,
        ...[0.24, 0.42, 0.6, 0.78].map((fx, i) =>
          dot(fx, 0.34 + (i % 2) * 0.06, 0.08, FLOWERS[i] as string),
        ),
        rect(0.1, 0.5, 0.8, 0.36, fill, 0.05),
        rect(0.14, 0.46, 0.72, 0.07, "#6a4a33", 0.02, false),
      ];
  }
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
