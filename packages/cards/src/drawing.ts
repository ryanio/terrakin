/**
 * A drawing recorded from our own drawing code (a resident's figure, from
 * `packages/ui/src/figure-svg.ts`), as plain shapes: path data, colors, a few fixed words, and
 * numbers. Every part is checked here before it becomes markup, the way pets' shapes are, so a
 * drawing that arrives wrong draws less, never something else.
 */
import { safeColor } from "./color";

export interface DrawShape {
  d: string;
  fill?: string | undefined;
  /** Fill with one of the drawing's tiles instead of a color. */
  tile?: number | undefined;
  stroke?: string | undefined;
  width?: number | undefined;
  cap?: "round" | "butt" | "square" | undefined;
  join?: "round" | "miter" | "bevel" | undefined;
  alpha?: number | undefined;
  /** Clip paths it's drawn inside, by index, outermost first. */
  clip?: number[] | undefined;
}

export interface DrawTile {
  size: number;
  shapes: DrawShape[];
  /** Where the tile sits, as an SVG matrix, when it isn't at the drawing's origin. */
  at?: number[] | undefined;
}

export interface Drawing {
  /** x, y, width, height of the box it fits in, in its own units. */
  box: [number, number, number, number];
  shapes: DrawShape[];
  clips: string[];
  tiles: DrawTile[];
}

/** Caps on what one drawing may hold, well past what a figure needs. */
const MAX_SHAPES = 800;
const MAX_CLIPS = 60;
const MAX_TILES = 16;
const MAX_TILE_SHAPES = 80;
/** A path made only of commands and numbers: nothing that could close the attribute. */
const PATH_DATA = /^[MmLlHhVvCcSsQqTtAaZz0-9.,\s-]{1,12000}$/;
const CAPS = new Set(["round", "butt", "square"]);
const JOINS = new Set(["round", "miter", "bevel"]);

const num = (v: unknown, max = 100_000): v is number =>
  typeof v === "number" && Number.isFinite(v) && Math.abs(v) <= max;
const fmt = (v: number) => String(Number(v.toFixed(3)));

/** One shape as a `<path>`, or "" when its path data doesn't check out. */
function shapeSvg(s: DrawShape, id: string, tiles: number): string {
  if (!s || typeof s.d !== "string" || !PATH_DATA.test(s.d)) return "";
  let attrs = ` d="${s.d}"`;
  if (num(s.tile) && Number.isInteger(s.tile) && s.tile >= 0 && s.tile < tiles) {
    attrs += ` fill="url(#${id}t${s.tile})"`;
  } else if (typeof s.fill === "string") {
    attrs += ` fill="${safeColor(s.fill)}"`;
  } else {
    attrs += ' fill="none"';
  }
  if (typeof s.stroke === "string") {
    attrs += ` stroke="${safeColor(s.stroke)}"`;
    if (num(s.width, 1000) && s.width >= 0) attrs += ` stroke-width="${fmt(s.width)}"`;
    if (s.cap && CAPS.has(s.cap)) attrs += ` stroke-linecap="${s.cap}"`;
    if (s.join && JOINS.has(s.join)) attrs += ` stroke-linejoin="${s.join}"`;
  }
  if (num(s.alpha, 1) && s.alpha >= 0 && s.alpha < 1) attrs += ` opacity="${fmt(s.alpha)}"`;
  return `<path${attrs}/>`;
}

/** The clips a shape is drawn inside, kept to ones the drawing has, outermost first. */
function clipList(s: DrawShape, clips: number): number[] {
  if (!Array.isArray(s.clip)) return [];
  return s.clip.filter((c) => Number.isInteger(c) && c >= 0 && c < clips).slice(0, 8);
}

/**
 * A drawing as SVG markup for inside another SVG, its ids prefixed with `id` so several can share
 * a document: its clip paths and pattern tiles in `<defs>`, then its shapes, each run of shapes
 * under the same clips in one group per clip.
 */
export function drawingSvg(dr: Drawing, id: string): string {
  if (!dr || !Array.isArray(dr.shapes)) return "";
  if (!/^[a-z][a-z0-9]{0,15}$/.test(id)) return "";
  const clips = Array.isArray(dr.clips) ? dr.clips.slice(0, MAX_CLIPS) : [];
  const tiles = Array.isArray(dr.tiles) ? dr.tiles.slice(0, MAX_TILES) : [];
  const defs: string[] = [];
  clips.forEach((d, i) => {
    const ok = typeof d === "string" && PATH_DATA.test(d);
    defs.push(`<clipPath id="${id}c${i}"><path d="${ok ? d : "M0 0Z"}"/></clipPath>`);
  });
  tiles.forEach((t, i) => {
    const size = num(t?.size, 1000) && t.size > 0 ? t.size : 1;
    const at =
      Array.isArray(t?.at) && t.at.length === 6 && t.at.every((v) => num(v))
        ? ` patternTransform="matrix(${t.at.map(fmt).join(" ")})"`
        : "";
    const body = Array.isArray(t?.shapes)
      ? t.shapes
          .slice(0, MAX_TILE_SHAPES)
          .map((s) => shapeSvg({ ...s, tile: undefined }, id, 0))
          .join("")
      : "";
    defs.push(
      `<pattern id="${id}t${i}" patternUnits="userSpaceOnUse" width="${fmt(size)}" height="${fmt(size)}"${at}>${body}</pattern>`,
    );
  });
  const out: string[] = [];
  let open: number[] = [];
  for (const s of dr.shapes.slice(0, MAX_SHAPES)) {
    const path = shapeSvg(s, id, tiles.length);
    if (!path) continue;
    const want = clipList(s, clips.length);
    // Close the groups this shape isn't inside, then open the ones it is.
    let keep = 0;
    while (keep < open.length && keep < want.length && open[keep] === want[keep]) keep++;
    for (let i = open.length; i > keep; i--) out.push("</g>");
    for (const c of want.slice(keep)) out.push(`<g clip-path="url(#${id}c${c})">`);
    open = want;
    out.push(path);
  }
  for (let i = 0; i < open.length; i++) out.push("</g>");
  return `${defs.length ? `<defs>${defs.join("")}</defs>` : ""}${out.join("")}`;
}

/** Whether a drawing's box is four finite numbers with a positive size. */
export function drawingBox(dr: Drawing): [number, number, number, number] | undefined {
  const b = dr?.box;
  if (!Array.isArray(b) || b.length !== 4 || !b.every((v) => num(v))) return undefined;
  const [x, y, w, h] = b;
  return w > 0 && h > 0 ? [x, y, w, h] : undefined;
}
