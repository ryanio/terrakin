/**
 * A plot photo (issue #34): one resident's plot drawn from above, in the world's own palette, as
 * SVG markup the card template places in a photo frame. The server fills a `PlotCard` from the
 * world (`server/src/plot-photo.ts`): every color comes from the sim's palette and every number
 * from world state. Nothing a resident wrote reaches this markup; their name is drawn by the
 * template as text, and their home picture as an image checked by `imageDataUri`.
 *
 * The shapes follow `client/src/render.ts`, so a photo looks like the plot does in the world.
 */

/**
 * One shape of a path or floor, in tile units from the tile's top left, as the sim's palette gives
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

/** A path or floor on a tile (RFC 0016): its color, if it covers the tile, and its shapes. */
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
  /** A path or floor laid on the tile. Nothing grows through it. */
  paving?: PlotPaving | undefined;
}

/** Decor from the town shop, drawn as itself rather than a square. Same names as the sim's. */
export const PLOT_DECOR = ["lantern", "frame", "fence", "bench", "hay_bale", "scarecrow"] as const;
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
}

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
      `<path d="${tufts.join("")}" stroke="${safeColor(c.ink.tuft)}" stroke-width="0.045" stroke-linecap="round" fill="none"/>`,
    );
  }
  parts.push(...flowers);
  if (c.tint) parts.push(`<rect width="${S}" height="${S}" fill="${safeColor(c.tint)}"/>`);

  // Blocks: a ground shadow, the block, a bottom shade, and a top highlight, as in the world.
  const fences = new Set(c.blocks.filter((b) => b.decor === "fence").map((b) => `${b.x},${b.y}`));
  const walls = new Set(
    c.blocks.filter((b) => b.furniture === "stone_wall").map((b) => `${b.x},${b.y}`),
  );
  for (const b of c.blocks) {
    if (!inPlot(b.x, S) || !inPlot(b.y, S)) continue;
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

  // What's growing, over its planter.
  for (const crop of c.crops ?? []) {
    if (inPlot(crop.x, S) && inPlot(crop.y, S)) parts.push(...cropSvg(crop));
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
  if (c.pet) parts.push(...petSvg(c.pet, S));
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
function petSvg(p: PlotPet, S: number): string[] {
  const { x, y, size } = p;
  const ok = [x, y, size].every(Number.isFinite) && size > 0 && size <= 4;
  if (!ok || x < -size || y < -size || x > S || y > S || !Array.isArray(p.shapes)) return [];
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
 * A crop on its planter, as `client/src/render.ts` paints it: a sprout that grows taller, with three
 * fruit or flowers in its color once it's ready; or, for a crop on a vine like a pumpkin, a vine
 * along the soil, its fruit swelling from a green bud and turning its color, with a stem once it's
 * ripe. The planter is the
 * block under it, so the same 0.05 inset and 0.9 tile size apply.
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

/** A path or floor's shapes on tile (x, y), from the sim's look: numbers and checked colors only. */
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
