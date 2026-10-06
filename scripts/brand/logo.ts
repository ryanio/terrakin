/**
 * Brand generator. The Terrakin mark is defined here as code, and every logo, favicon,
 * app icon and social card in packages/client/public is generated from it.
 *
 *   pnpm brand                      regenerate every brand asset
 *   pnpm brand --preview <dir>      also write preview.png (mark at 512, 64, 32, 16) to <dir>
 *
 * Change BRAND below and rerun. Do not hand-edit the generated files; see README.md here.
 * Other scripts import the drawing helpers (scripts/townsfolk draws each resident's home with it);
 * importing this file doesn't regenerate anything.
 *
 * The mark is a small isometric plot of earth (clay sides, a moss top with a scalloped
 * grass lip) with a hearth on it: a house with a lit window and a chimney. Terra + kin.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { inflateSync } from "node:zlib";
import { Resvg } from "@resvg/resvg-js";

// ---------------------------------------------------------------------------
// The one place to change the logo.
// ---------------------------------------------------------------------------

export const PALETTE = {
  paper: "#fffaf0",
  paperEdge: "#ecdcc0",
  ink: "#2b2620",
  clay: "#b4532f",
  clayDeep: "#8f3d20",
  moss: "#5e7f45",
  mossLight: "#8fb36a",
  sun: "#f2b84b",
  dusk: "#cdb4f6",
};

/** Colors for the house alone, so a drawing can repaint the hearth and keep the plot of earth. */
export interface HouseColors {
  wall: string;
  wallEdge: string;
  roof: string;
  roofDeep: string;
  door: string;
  window: string;
}

export type Palette = typeof PALETTE & { house?: Partial<HouseColors> };

/** A range along one tile axis, as fractions of the tile (0 to 1). */
type Span = readonly [number, number];

export interface MarkGeometry {
  /** Half the width of the tile's top diamond, in mark units. Everything scales from it. */
  tile: number;
  /** Depth of the slab of earth, in tile half-widths. */
  thickness: number;
  /** Corner rounding of the slab silhouette, in mark units. */
  corner: number;
  /** The grass lip that hangs over the clay sides. */
  lip: { depth: number; scallops: number; bulge: number };
  /** House footprint (x, y as tile fractions), wall height and roof rise (tile half-widths). */
  house: { x: Span; y: Span; wall: number; roof: number; eave: number; verge: number };
  /** Lit window on the front (left) wall: x along the wall, z up from the ground. */
  window: { x: Span; z: Span; mullion: boolean } | null;
  /** Arched door on the gable (right) wall: y along the wall, height up from the ground. */
  door: { y: Span; height: number } | null;
  chimney: { x: Span; y: Span; above: number } | null;
  smoke: boolean;
  /** Rows of roof tiles drawn as fine lines on the front roof plane. */
  roofRows: number;
  /** Little extras that only read at large sizes. */
  pebbles: boolean;
  bush: boolean;
  path: boolean;
  /** Ink outline around the whole silhouette, in mark units. 0 for none. */
  outline: number;
}

export const MARK: MarkGeometry = {
  tile: 40,
  thickness: 0.46,
  corner: 3.2,
  lip: { depth: 0.07, scallops: 4, bulge: 0.07 },
  house: { x: [0.3, 0.72], y: [0.26, 0.64], wall: 0.4, roof: 0.34, eave: 0.06, verge: 0.05 },
  window: { x: [0.28, 0.62], z: [0.1, 0.3], mullion: true },
  door: { y: [0.38, 0.52], height: 0.26 },
  chimney: { x: [0.36, 0.48], y: [0.29, 0.4], above: 0.08 },
  smoke: true,
  roofRows: 2,
  pebbles: true,
  bush: true,
  path: true,
  outline: 1.3,
};

/** The favicon variant: same plot and hearth, fewer parts, chunkier so it reads at 16px. */
const FAVICON: MarkGeometry = {
  ...MARK,
  thickness: 0.42,
  corner: 3.6,
  lip: { depth: 0.12, scallops: 1, bulge: 0 },
  house: { x: [0.24, 0.76], y: [0.24, 0.68], wall: 0.42, roof: 0.34, eave: 0.06, verge: 0.06 },
  window: { x: [0.3, 0.7], z: [0.08, 0.3], mullion: false },
  door: null,
  chimney: null,
  smoke: false,
  roofRows: 0,
  pebbles: false,
  bush: false,
  path: false,
  outline: 1.8,
};

const BRAND = {
  name: "terrakin",
  title: "Terrakin",
  tagline: "A small world you build with your friends and their AI assistants.",
  palette: PALETTE,
  mark: MARK,
  favicon: FAVICON,
  /** Fraunces weights (from @fontsource/fraunces) for the wordmark and the tagline. */
  type: { wordmarkWeight: 600, taglineWeight: 400, tracking: -0.01 },
  /** Background of opaque icons and the social card. */
  background: PALETTE.paper,
};

// ---------------------------------------------------------------------------
// Geometry. Points are projected 2:1 isometric: x runs down-right, y down-left, z up.
// ---------------------------------------------------------------------------

export type Pt = readonly [number, number];
type V3 = readonly [number, number, number];

export const fmt = (n: number) => String(Math.round(n * 100) / 100);
const pt = (p: Pt) => `${fmt(p[0])} ${fmt(p[1])}`;

function at<T>(list: readonly T[], i: number): T {
  const v = list[((i % list.length) + list.length) % list.length];
  if (v === undefined) throw new Error("empty list");
  return v;
}

/** Closed polygon with every corner rounded by up to `r` (quadratic corners). */
export function rounded(points: readonly Pt[], r: number): string {
  if (r <= 0) return `M${points.map(pt).join("L")}Z`;
  let d = "";
  points.forEach((p, i) => {
    const prev = at(points, i - 1);
    const next = at(points, i + 1);
    const d1 = Math.hypot(prev[0] - p[0], prev[1] - p[1]);
    const d2 = Math.hypot(next[0] - p[0], next[1] - p[1]);
    const rr = Math.min(r, d1 / 2, d2 / 2);
    const a: Pt = [p[0] + ((prev[0] - p[0]) * rr) / d1, p[1] + ((prev[1] - p[1]) * rr) / d1];
    const b: Pt = [p[0] + ((next[0] - p[0]) * rr) / d2, p[1] + ((next[1] - p[1]) * rr) / d2];
    d += `${i === 0 ? "M" : "L"}${pt(a)}Q${pt(p)} ${pt(b)}`;
  });
  return `${d}Z`;
}

interface Shape {
  d: string;
  fill: string;
  /** Part of the outer silhouette (gets the ink outline underneath). */
  solid: boolean;
}

interface Drawing {
  shapes: Shape[];
  /** Shapes clipped to the slab silhouette. */
  slab: Shape[];
  slabClip: string;
  bounds: { x: number; y: number; w: number; h: number };
}

/** Ellipse as a path (resvg turns <circle> into paths anyway, and paths take the outline). */
const ellipse = (c: Pt, rx: number, ry = rx) =>
  `M${pt([c[0] - rx, c[1]])}a${fmt(rx)} ${fmt(ry)} 0 1 0 ${fmt(2 * rx)} 0a${fmt(rx)} ${fmt(ry)} 0 1 0 ${fmt(-2 * rx)} 0Z`;

/** Axis-aligned rectangles in tile space: a wall facing down-left, down-right, or a floor. */
const wallY = (y: number, [x0, x1]: Span, [z0, z1]: Span): V3[] => [
  [x0, y, z0],
  [x1, y, z0],
  [x1, y, z1],
  [x0, y, z1],
];
const wallX = (x: number, [y0, y1]: Span, [z0, z1]: Span): V3[] => [
  [x, y0, z0],
  [x, y1, z0],
  [x, y1, z1],
  [x, y0, z1],
];
const floor = (z: number, [x0, x1]: Span, [y0, y1]: Span): V3[] => [
  [x0, y0, z],
  [x1, y0, z],
  [x1, y1, z],
  [x0, y1, z],
];

function drawMark(g: MarkGeometry, c: Palette = PALETTE): Drawing {
  const a = g.tile;
  const hc: HouseColors = {
    wall: c.paper,
    wallEdge: c.paperEdge,
    roof: c.clay,
    roofDeep: c.clayDeep,
    door: c.clayDeep,
    window: c.sun,
    ...c.house,
  };
  const iso = (v: V3): Pt => [(v[0] - v[1]) * a, ((v[0] + v[1]) * a) / 2 - v[2] * a];
  const all: Pt[] = [];
  /** Project a polygon, remembering its corners for the bounding box. */
  const poly = (vs: V3[], r = 0) => {
    const ps = vs.map(iso);
    all.push(...ps);
    return rounded(ps, r);
  };
  const slab: Shape[] = [];
  const shapes: Shape[] = [];
  const add = (list: Shape[], d: string, fill: string, solid = false) =>
    list.push({ d, fill, solid });

  // The slab of earth: two clay sides, a scalloped grass lip over each, the moss top.
  const t = g.thickness;
  const slabClip = poly(
    [
      [0, 0, 0],
      [1, 0, 0],
      [1, 0, -t],
      [1, 1, -t],
      [0, 1, -t],
      [0, 1, 0],
    ],
    g.corner,
  );
  add(slab, poly(wallY(1, [0, 1], [-t, 0])), c.clay);
  add(slab, poly(wallX(1, [0, 1], [-t, 0])), c.clayDeep);
  if (g.pebbles) {
    const pebbles: [V3, number, string][] = [
      [[0.28, 1, -0.3], 0.035, c.clayDeep],
      [[0.62, 1, -0.22], 0.025, c.clayDeep],
      [[0.8, 1, -0.36], 0.02, c.clayDeep],
      [[1, 0.34, -0.28], 0.03, c.clay],
      [[1, 0.7, -0.34], 0.022, c.clay],
    ];
    for (const [v, r, fill] of pebbles) add(slab, ellipse(iso(v), a * r, a * r * 0.8), fill);
  }
  const lip = (from: V3, to: V3): string => {
    const { depth, scallops, bulge } = g.lip;
    const at = (s: number, dz: number): string =>
      pt(iso([from[0] + (to[0] - from[0]) * s, from[1] + (to[1] - from[1]) * s, -dz]));
    let d = `M${at(0, 0)}L${at(1, 0)}L${at(1, depth)}`;
    for (let i = scallops; i > 0; i--) {
      d += `Q${at((i - 0.5) / scallops, depth + bulge * 2)} ${at((i - 1) / scallops, depth)}`;
    }
    return `${d}Z`;
  };
  add(slab, lip([0, 1, 0], [1, 1, 0]), c.moss);
  add(slab, lip([1, 0, 0], [1, 1, 0]), c.moss);
  add(slab, poly(floor(0, [0, 1], [0, 1])), c.mossLight);

  // The hearth. Ridge runs along x, so the gable end faces down-right.
  const { house } = g;
  const [x0, x1] = house.x;
  const [y0, y1] = house.y;
  const ym = (y0 + y1) / 2;
  const h = house.wall;
  const peak = h + house.roof;
  const e = house.eave;
  const ze = h - (house.roof * e) / ((y1 - y0) / 2);
  const xa = x0 - house.verge;
  const xb = x1 + house.verge;
  const rr = a * 0.03;

  if (g.path) {
    for (const [x, y, r] of [
      [0.8, 0.47, 0.035],
      [0.9, 0.52, 0.03],
    ] as const) {
      add(shapes, ellipse(iso([x, y, 0]), a * r * 2, a * r), c.paperEdge);
    }
  }
  // Back roof plane: only a sliver shows past the ridge.
  add(
    shapes,
    poly(
      [
        [xa, y0 - e, ze],
        [xb, y0 - e, ze],
        [xb, ym, peak],
        [xa, ym, peak],
      ],
      rr,
    ),
    hc.roofDeep,
    true,
  );
  if (g.chimney) {
    const { x, y } = g.chimney;
    const top = peak + g.chimney.above;
    add(shapes, poly(wallY(y[1], x, [h, top])), c.clay, true);
    add(shapes, poly(wallX(x[1], y, [h, top])), c.clayDeep, true);
    add(shapes, poly(floor(top, x, y)), c.ink, true);
    if (g.smoke) {
      const p = iso([(x[0] + x[1]) / 2, (y[0] + y[1]) / 2, top]);
      for (const [dx, dy, r] of [
        [0.07, -0.13, 0.055],
        [0.17, -0.25, 0.04],
      ] as const) {
        const q: Pt = [p[0] + a * dx, p[1] + a * dy];
        all.push([q[0] - a * r, q[1] - a * r], [q[0] + a * r, q[1] + a * r]);
        add(shapes, ellipse(q, a * r), c.dusk);
      }
    }
  }
  add(shapes, poly(wallY(y1, [x0, x1], [0, h])), hc.wall, true);
  add(
    shapes,
    poly([
      [x1, y0, 0],
      [x1, y1, 0],
      [x1, y1, h],
      [x1, ym, peak],
      [x1, y0, h],
    ]),
    hc.wallEdge,
    true,
  );
  if (g.window) {
    const wx: Span = [x0 + (x1 - x0) * g.window.x[0], x0 + (x1 - x0) * g.window.x[1]];
    const wz = g.window.z;
    add(shapes, poly(wallY(y1, wx, wz), a * 0.012), hc.window);
    if (g.window.mullion) {
      const bar = 0.012;
      const wm = (wx[0] + wx[1]) / 2;
      const zm = (wz[0] + wz[1]) / 2;
      add(shapes, poly(wallY(y1, [wm - bar, wm + bar], wz)), c.clayDeep);
      add(shapes, poly(wallY(y1, wx, [zm - bar, zm + bar])), c.clayDeep);
    }
  }
  if (g.door) {
    const [dy0, dy1] = g.door.y;
    const dh = g.door.height;
    const arch = dh + (dy1 - dy0) * 0.45;
    const p = (y: number, z: number) => pt(iso([x1, y, z]));
    add(
      shapes,
      `M${p(dy0, 0)}L${p(dy0, dh)}Q${p(dy0, arch)} ${p((dy0 + dy1) / 2, arch)}Q${p(dy1, arch)} ${p(dy1, dh)}L${p(dy1, 0)}Z`,
      hc.door,
    );
  }
  // Front roof plane with rows of tiles, then the verge (the roof's edge on the gable end).
  const slope = (s: number, x: number): V3 => [x, ym + (y1 + e - ym) * s, peak + (ze - peak) * s];
  add(shapes, poly([slope(0, xa), slope(0, xb), slope(1, xb), slope(1, xa)], rr), hc.roof, true);
  for (let i = 1; i <= g.roofRows; i++) {
    const f = i / (g.roofRows + 1);
    const w = 0.012;
    const [l, r] = [xa + 0.02, xb - 0.02];
    add(
      shapes,
      poly([slope(f - w, l), slope(f - w, r), slope(f + w, r), slope(f + w, l)]),
      hc.roofDeep,
    );
  }
  const vt = 0.07;
  add(
    shapes,
    poly(
      [
        [xb, y0 - e, ze],
        [xb, ym, peak],
        [xb, y1 + e, ze],
        [xb, y1 + e, ze - vt],
        [xb, ym, peak - vt],
        [xb, y0 - e, ze - vt],
      ],
      rr,
    ),
    hc.roofDeep,
    true,
  );
  if (g.bush) {
    const base = iso([0.16, 0.84, 0]);
    const blobs: [number, number, number, string][] = [
      [-0.08, -0.06, 0.08, c.moss],
      [0.07, -0.05, 0.07, c.moss],
      [-0.01, -0.12, 0.08, c.moss],
      [-0.03, -0.15, 0.035, c.mossLight],
    ];
    for (const [dx, dy, r, fill] of blobs) {
      add(shapes, ellipse([base[0] + a * dx, base[1] + a * dy], a * r), fill, fill === c.moss);
    }
  }

  const pad = g.outline;
  const xs = all.map((p) => p[0]);
  const ys = all.map((p) => p[1]);
  const x = Math.min(...xs) - pad;
  const y = Math.min(...ys) - pad;
  return {
    shapes,
    slab,
    slabClip,
    bounds: { x, y, w: Math.max(...xs) + pad - x, h: Math.max(...ys) + pad - y },
  };
}

/**
 * The mark's SVG elements (no <svg> wrapper), drawn so its bounding box lands at
 * (x, y) with the given width. `id` keeps clip ids unique when marks share a document.
 */
export function markElements(
  g: MarkGeometry,
  opts: { x: number; y: number; width: number; id: string; palette?: Palette },
): string {
  const palette = opts.palette ?? PALETTE;
  const m = drawMark(g, palette);
  const s = opts.width / m.bounds.w;
  const tf = `translate(${fmt(opts.x)} ${fmt(opts.y)}) scale(${Math.round(s * 10000) / 10000}) translate(${fmt(-m.bounds.x)} ${fmt(-m.bounds.y)})`;
  const paths = (list: Shape[]) => list.map((p) => `<path d="${p.d}" fill="${p.fill}"/>`).join("");
  let outline = "";
  if (g.outline > 0) {
    const solids = [m.slabClip, ...m.shapes.filter((p) => p.solid).map((p) => p.d)];
    outline = `<g class="outline" fill="${palette.ink}" stroke="${palette.ink}" stroke-width="${fmt(g.outline * 2)}" stroke-linejoin="round">${solids.map((d) => `<path d="${d}"/>`).join("")}</g>`;
  }
  const clipId = `${opts.id}-slab`;
  return (
    `<g transform="${tf}">` +
    `<defs><clipPath id="${clipId}"><path d="${m.slabClip}"/></clipPath></defs>` +
    outline +
    `<g clip-path="url(#${clipId})">${paths(m.slab)}</g>` +
    paths(m.shapes) +
    "</g>"
  );
}

export function markSize(g: MarkGeometry): { w: number; h: number } {
  const { w, h } = drawMark(g).bounds;
  return { w, h };
}

/** The mark alone in a square box, `inset` as a fraction of the side kept clear on each edge. */
function squareMark(g: MarkGeometry, side: number, inset: number, id: string): string {
  const { w, h } = markSize(g);
  const room = side * (1 - 2 * inset);
  const width = w >= h ? room : (room * w) / h;
  const height = (width * h) / w;
  return markElements(g, { x: (side - width) / 2, y: (side - height) / 2, width, id });
}

export const esc = (text: string) =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export const svgDoc = (w: number, h: number, body: string, title = BRAND.title) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${fmt(w)} ${fmt(h)}" width="${fmt(w)}" height="${fmt(h)}"><title>${esc(title)}</title>${body}</svg>\n`;

// ---------------------------------------------------------------------------
// Type. Fraunces ships as WOFF; resvg wants a plain sfnt, so unwrap it, then let resvg
// turn the text into outlines. The generated SVGs never depend on an installed font.
// ---------------------------------------------------------------------------

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const FONT_DIR = join(ROOT, "node_modules", "@fontsource", "fraunces", "files");

function woffToSfnt(woff: Buffer): Buffer {
  if (woff.toString("ascii", 0, 4) !== "wOFF") throw new Error("not a WOFF file");
  const flavor = woff.readUInt32BE(4);
  const count = woff.readUInt16BE(12);
  const tables = Array.from({ length: count }, (_, i) => {
    const o = 44 + i * 20;
    const offset = woff.readUInt32BE(o + 4);
    const compressed = woff.readUInt32BE(o + 8);
    const size = woff.readUInt32BE(o + 12);
    const raw = woff.subarray(offset, offset + compressed);
    return {
      tag: woff.readUInt32BE(o),
      checksum: woff.readUInt32BE(o + 16),
      data: compressed < size ? inflateSync(raw) : raw,
    };
  });
  const head = 12 + 16 * count;
  const out = Buffer.alloc(tables.reduce((n, t) => n + ((t.data.length + 3) & ~3), head));
  let pow = 1;
  let log = 0;
  while (pow * 2 <= count) {
    pow *= 2;
    log++;
  }
  out.writeUInt32BE(flavor, 0);
  out.writeUInt16BE(count, 4);
  out.writeUInt16BE(pow * 16, 6);
  out.writeUInt16BE(log, 8);
  out.writeUInt16BE(count * 16 - pow * 16, 10);
  let offset = head;
  tables.forEach((t, i) => {
    out.writeUInt32BE(t.tag, 12 + i * 16);
    out.writeUInt32BE(t.checksum, 16 + i * 16);
    out.writeUInt32BE(offset, 20 + i * 16);
    out.writeUInt32BE(t.data.length, 24 + i * 16);
    t.data.copy(out, offset);
    offset += (t.data.length + 3) & ~3;
  });
  return out;
}

export interface TextPath {
  d: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

function makeTypesetter(fontFiles: string[]) {
  const font = { loadSystemFonts: false, fontFiles, defaultFontFamily: "Fraunces" };
  /** Outline `text` with its baseline at y = 0, starting at x = 0. */
  return (text: string, weight: number, size: number, italic = false): TextPath => {
    const spacing = BRAND.type.tracking * size;
    const style = italic ? ' font-style="italic"' : "";
    const src = `<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><text font-family="Fraunces" font-weight="${weight}"${style} font-size="${size}" letter-spacing="${fmt(spacing)}">${esc(text)}</text></svg>`;
    const flat = new Resvg(src, { font }).toString();
    if (/transform=/.test(flat)) throw new Error("unexpected transform in outlined text");
    const d = [...flat.matchAll(/ d="([^"]+)"/g)].map((m) => m[1]).join(" ");
    if (!d) throw new Error(`could not outline "${text}" (is @fontsource/fraunces installed?)`);
    const bbox = new Resvg(
      `<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><path d="${d}"/></svg>`,
    ).getBBox();
    if (!bbox) throw new Error(`empty outline for "${text}"`);
    return { d, x: bbox.x, y: bbox.y, w: bbox.width, h: bbox.height };
  };
}

// ---------------------------------------------------------------------------
// Assets.
// ---------------------------------------------------------------------------

export type Typeset = ReturnType<typeof makeTypesetter>;

function wordmarkSvg(type: Typeset): string {
  const size = 100;
  const word = type(BRAND.name, BRAND.type.wordmarkWeight, size);
  const { w, h } = markSize(BRAND.mark);
  // The mark sits a touch below the baseline and rises past the ascenders.
  const markH = size * 1.22;
  const markW = (markH * w) / h;
  const gap = size * 0.14;
  const margin = size * 0.02;
  const drop = size * 0.08;
  const baseline = Math.max(markH - drop, -word.y) + margin;
  const markY = baseline + drop - markH;
  const textX = margin + markW + gap - word.x;
  const width = margin * 2 + markW + gap + word.w;
  const height = Math.max(markY + markH, baseline + word.y + word.h) + margin;
  const mark = markElements(BRAND.mark, { x: margin, y: markY, width: markW, id: "wm" });
  const style = `<style>.word{fill:${PALETTE.ink}}@media (prefers-color-scheme: dark){.word{fill:${PALETTE.paper}}}</style>`;
  return svgDoc(
    width,
    height,
    `${style}${mark}<path class="word" fill="${PALETTE.ink}" transform="translate(${fmt(textX)} ${fmt(baseline)})" d="${word.d}"/>`,
  );
}

/** Favicon SVG. The outline flips to paper on dark browser chrome when `dark` is set. */
function faviconSvg(dark: boolean): string {
  const side = 32;
  const body = squareMark(BRAND.favicon, side, 0, "fav");
  const style = dark
    ? `<style>@media (prefers-color-scheme: dark){.outline{fill:${PALETTE.paper};stroke:${PALETTE.paper}}}</style>`
    : "";
  return svgDoc(side, side, style + body);
}

function markSvg(): string {
  const { w, h } = markSize(BRAND.mark);
  return svgDoc(w, h, markElements(BRAND.mark, { x: 0, y: 0, width: w, id: "mark" }));
}

function opaqueIcon(side: number, inset: number, g: MarkGeometry, radius = 0): string {
  const bg = `<rect width="${side}" height="${side}" rx="${fmt(radius * side)}" fill="${BRAND.background}"/>`;
  return svgDoc(side, side, bg + squareMark(g, side, inset, "icon"));
}

/** Maskable: full bleed, and the mark's corners stay inside the 80% safe circle. */
function maskableIcon(side: number): string {
  const { w, h } = markSize(BRAND.mark);
  const safe = side * 0.8;
  const width = (safe * w) / Math.hypot(w, h);
  const height = (width * h) / w;
  const mark = markElements(BRAND.mark, {
    x: (side - width) / 2,
    y: (side - height) / 2,
    width,
    id: "mask",
  });
  return svgDoc(
    side,
    side,
    `<rect width="${side}" height="${side}" fill="${BRAND.background}"/>${mark}`,
  );
}

/**
 * Paper grain as sparse flecks: most pixels stay exactly paper, so the PNG stays small.
 * (Continuous noise looks the same at card size and costs about eight times the bytes.)
 */
export const GRAIN = `<filter id="grain" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="1" seed="4"/><feColorMatrix type="matrix" values="0 0 0 0 0.56 0 0 0 0 0.45 0 0 0 0 0.3 1 0 0 0 0"/><feComponentTransfer><feFuncA type="discrete" tableValues="0 0 0 0 0 0 0 0.18 0.3 0.3"/></feComponentTransfer></filter>`;

function ogSvg(type: Typeset): string {
  const W = 1200;
  const H = 630;
  const word = type(BRAND.name, BRAND.type.wordmarkWeight, 150);
  const lineSize = 46;
  const maxLine = 600;
  const lines: TextPath[] = [];
  let current = "";
  for (const wordPart of BRAND.tagline.split(" ")) {
    const next = current ? `${current} ${wordPart}` : wordPart;
    if (current && type(next, BRAND.type.taglineWeight, lineSize).w > maxLine) {
      lines.push(type(current, BRAND.type.taglineWeight, lineSize));
      current = wordPart;
    } else current = next;
  }
  lines.push(type(current, BRAND.type.taglineWeight, lineSize));

  const { w, h } = markSize(BRAND.mark);
  const markW = 340;
  const markH = (markW * h) / w;
  const lineGap = lineSize * 1.3;
  const textW = Math.max(word.w, ...lines.map((l) => l.w));
  const gap = 64;
  const left = (W - (markW + gap + textW)) / 2;
  const textX = left + markW + gap;
  const blockH = -word.y + 40 + lineGap * lines.length;
  const top = (H - blockH) / 2;
  const baseline = top - word.y;
  const mark = markElements(BRAND.mark, {
    x: left,
    y: (H - markH) / 2 - 6,
    width: markW,
    id: "og",
  });
  const text = [
    `<path fill="${PALETTE.ink}" transform="translate(${fmt(textX - word.x)} ${fmt(baseline)})" d="${word.d}"/>`,
    ...lines.map(
      (l, i) =>
        `<path fill="${PALETTE.ink}" fill-opacity="0.82" transform="translate(${fmt(textX - l.x)} ${fmt(baseline + 40 + lineGap * (i + 1) - 8)})" d="${l.d}"/>`,
    ),
  ].join("");
  const frame = `<rect x="24" y="24" width="${W - 48}" height="${H - 48}" rx="28" fill="none" stroke="${PALETTE.paperEdge}" stroke-width="3"/>`;
  const shadow = `<ellipse cx="${fmt(left + markW / 2)}" cy="${fmt((H + markH) / 2 + 2)}" rx="${fmt(markW * 0.36)}" ry="${fmt(markW * 0.05)}" fill="${PALETTE.paperEdge}"/>`;
  return svgDoc(
    W,
    H,
    `<defs>${GRAIN}</defs><rect width="${W}" height="${H}" fill="${BRAND.background}"/><rect width="${W}" height="${H}" filter="url(#grain)"/>${frame}${shadow}${mark}${text}`,
  );
}

export function png(svg: string, width: number): Buffer {
  return Buffer.from(
    new Resvg(svg, { fitTo: { mode: "width", value: width }, font: { loadSystemFonts: false } })
      .render()
      .asPng(),
  );
}

/** ICO with embedded PNG images (supported by every browser that still asks for .ico). */
function ico(images: { size: number; data: Buffer }[]): Buffer {
  const header = Buffer.alloc(6 + 16 * images.length);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  let offset = header.length;
  images.forEach(({ size, data }, i) => {
    const o = 6 + i * 16;
    header.writeUInt8(size >= 256 ? 0 : size, o);
    header.writeUInt8(size >= 256 ? 0 : size, o + 1);
    header.writeUInt16LE(1, o + 4);
    header.writeUInt16LE(32, o + 6);
    header.writeUInt32LE(data.length, o + 8);
    header.writeUInt32LE(offset, o + 12);
    offset += data.length;
  });
  return Buffer.concat([header, ...images.map((i) => i.data)]);
}

function manifest(): string {
  return `${JSON.stringify(
    {
      name: BRAND.title,
      short_name: BRAND.title,
      description: BRAND.tagline,
      start_url: "/",
      display: "standalone",
      background_color: BRAND.background,
      theme_color: BRAND.background,
      icons: [
        { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
        { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
        {
          src: "/icon-maskable-512.png",
          sizes: "512x512",
          type: "image/png",
          purpose: "maskable",
        },
      ],
    },
    null,
    2,
  )}\n`;
}

/**
 * The brand as a module for the link preview cards (packages/cards/src/brand.ts): the palette, the
 * mark as one SVG (with a paper-colored outline variant for dark cards), its size, and the grain
 * filter. Written in Biome's style so `pnpm lint` passes on the generated file.
 */
function cardsBrand(): string {
  const { w, h } = markSize(BRAND.mark);
  const mark = markSvg().trim();
  // Biome's quote rule: single quotes when that saves escaping double ones.
  const quote = (s: string) =>
    s.includes('"') && !/['\\\n]/.test(s) ? `'${s}'` : JSON.stringify(s);
  const palette = Object.entries(PALETTE)
    .map(([k, v]) => `  ${k}: ${JSON.stringify(v)},`)
    .join("\n");
  return [
    "// Generated by scripts/brand/logo.ts (`pnpm brand`). Do not edit; change logo.ts and rerun.",
    "",
    `export const PALETTE = {\n${palette}\n} as const;`,
    "",
    "/** The mark alone, transparent background, as a standalone SVG document. */",
    `export const MARK_SVG =\n  ${quote(mark)};`,
    "",
    `export const MARK_SIZE = { width: ${fmt(w)}, height: ${fmt(h)} } as const;`,
    "",
    "/** Paper grain as sparse flecks, the same filter as the static social card. */",
    `export const GRAIN_FILTER =\n  ${quote(GRAIN)};`,
    "",
  ].join("\n");
}

function preview(dir: string, assets: Map<string, string | Buffer>): void {
  const mark = assets.get("brand/mark.svg");
  const fav = faviconSvg(false);
  if (typeof mark !== "string") return;
  const sizes = [512, 64, 32, 16];
  const tiles = sizes.map((s) => ({ s, mark: png(mark, s), fav: png(fav, s) }));
  let x = 24;
  let body = "";
  for (const t of tiles) {
    const img = (buf: Buffer, y: number, bg: string) =>
      `<rect x="${x - 8}" y="${y - 8}" width="${t.s + 16}" height="${t.s + 16}" fill="${bg}"/><image x="${x}" y="${y}" width="${t.s}" height="${t.s}" href="data:image/png;base64,${buf.toString("base64")}"/>`;
    body += img(t.mark, 24, PALETTE.paper);
    if (t.s < 512) {
      body += img(t.fav, 560, "#ffffff");
      body += img(t.fav, 560 + t.s + 40, "#202124");
    }
    x += Math.max(t.s, 64) + 32;
  }
  // Pixel-exact zooms of the small favicons, the sizes that matter most.
  const zoom = (buf: Buffer, size: number, zx: number, zy: number, bg: string) =>
    `<rect x="${zx}" y="${zy}" width="256" height="256" fill="${bg}"/><image x="${zx}" y="${zy}" width="256" height="256" image-rendering="optimizeSpeed" href="data:image/png;base64,${buf.toString("base64")}"/><text x="${zx}" y="${zy + 276}" font-size="14">${size}px</text>`;
  const fav16 = png(fav, 16);
  const fav32 = png(fav, 32);
  body += zoom(fav16, 16, 24, 1100, "#ffffff") + zoom(fav16, 16, 304, 1100, "#202124");
  body += zoom(fav32, 32, 584, 1100, "#ffffff") + zoom(fav32, 32, 864, 1100, "#202124");
  const doc = `<svg xmlns="http://www.w3.org/2000/svg" width="1144" height="1400"><rect width="100%" height="100%" fill="#ddd"/>${body}</svg>`;
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "preview.png"), new Resvg(doc).render().asPng());
  const og = assets.get("og.png");
  if (og) writeFileSync(join(dir, "og.png"), og);
}

/**
 * Run `fn` with a typesetter for the given Fraunces faces (`600` or `400-italic`, say). The fonts
 * are unwrapped into a temp directory that's removed afterwards.
 */
export function withTypesetter<T>(faces: (number | string)[], fn: (type: Typeset) => T): T {
  const tmp = mkdtempSync(join(tmpdir(), "terrakin-brand-"));
  try {
    const fontFiles = [...new Set(faces.map(String))].map((face) => {
      const file = join(tmp, `fraunces-${face}.ttf`);
      const name = face.includes("-") ? face : `${face}-normal`;
      writeFileSync(file, woffToSfnt(readFileSync(join(FONT_DIR, `fraunces-latin-${name}.woff`))));
      return file;
    });
    return fn(makeTypesetter(fontFiles));
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

function main(): void {
  const args = process.argv.slice(2);
  const previewAt = args.indexOf("--preview");
  withTypesetter([BRAND.type.wordmarkWeight, BRAND.type.taglineWeight], (type) => {
    const favPng = faviconSvg(false);
    const assets = new Map<string, string | Buffer>([
      ["brand/mark.svg", markSvg()],
      ["brand/wordmark.svg", wordmarkSvg(type)],
      ["favicon.svg", faviconSvg(true)],
      ["favicon.ico", ico([16, 32, 48].map((size) => ({ size, data: png(favPng, size) })))],
      ["apple-touch-icon.png", png(opaqueIcon(180, 0.12, BRAND.mark), 180)],
      ["icon-192.png", png(opaqueIcon(192, 0.1, BRAND.mark, 0.22), 192)],
      ["icon-512.png", png(opaqueIcon(512, 0.1, BRAND.mark, 0.22), 512)],
      ["icon-maskable-512.png", png(maskableIcon(512), 512)],
      ["site.webmanifest", manifest()],
      ["og.png", png(ogSvg(type), 1200)],
    ]);
    const out = join(ROOT, "packages", "client", "public");
    for (const [name, data] of assets) {
      const file = join(out, name);
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, data);
      console.log(`wrote ${relative(ROOT, file)}`);
    }
    const cardsFile = join(ROOT, "packages", "cards", "src", "brand.ts");
    writeFileSync(cardsFile, cardsBrand());
    console.log(`wrote ${relative(ROOT, cardsFile)}`);
    const dir = args[previewAt + 1];
    if (previewAt >= 0 && dir) preview(dir, assets);
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
