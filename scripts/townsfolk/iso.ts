/**
 * A small isometric drawing kit for the townsfolk homes, in the brand mark's projection and style
 * (scripts/brand/logo.ts): x runs down-right, y down-left, z up, all in tiles, where one tile is
 * the mark's plot of earth. Pieces are drawn back to front. The whole drawing gets the mark's ink
 * outline, and each piece a thinner one, so a prop in front of a wall still reads at thumbnail size.
 */
import { fmt, MARK, PALETTE, type Pt, rounded } from "../brand/logo.ts";

export type V3 = readonly [number, number, number];
export type Span = readonly [number, number];

/** Half a tile's width in drawing units: the brand mark's own scale, so the outlines match. */
export const TILE = MARK.tile;
/** Outline around the whole drawing, each side, in drawing units. The brand mark's weight. */
export const OUTLINE = MARK.outline;
/** Outline between pieces inside the drawing. */
const INNER = 0.8;

function hex(color: string): [number, number, number] {
  const n = Number.parseInt(color.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Mix two #rrggbb colors, `t` of the way from `a` to `b`. */
export function mix(a: string, b: string, t: number): string {
  const [ar, ag, ab] = hex(a);
  const [br, bg, bb] = hex(b);
  const ch = (x: number, y: number) =>
    Math.round(x + (y - x) * t)
      .toString(16)
      .padStart(2, "0");
  return `#${ch(ar, br)}${ch(ag, bg)}${ch(ab, bb)}`;
}

/** The three visible faces of a box: its top, its front (facing down-left), its side (down-right). */
export interface Faces {
  top: string;
  front: string;
  side: string;
}

/** Faces for a material, lit like the brand mark: front lighter, side darker, top lightest. */
export const faces = (front: string, side = mix(front, PALETTE.ink, 0.2)): Faces => ({
  top: mix(front, "#ffffff", 0.22),
  front,
  side,
});

export const WOOD = faces("#e8c497", "#c99a68");
export const DARK_WOOD = faces("#b47d4c", "#93623a");
export const STONE = faces("#e6e0d5", "#c2baac");
export const GLASS = faces("#cfe8ef", "#a8d2df");
export const PAPER = faces(PALETTE.paper, PALETTE.paperEdge);
export const CLAY = faces(PALETTE.clay, PALETTE.clayDeep);

type Part =
  | { kind: "fill"; d: string; fill: string; solid: boolean; opacity?: number }
  | { kind: "line"; d: string; stroke: string; width: number; solid: boolean };

interface Piece {
  parts: Part[];
  clip?: string;
  outline: boolean;
}

/** A point on a flat surface: `u` runs along it, `w` up it (or across it, for the ground). */
export type Plane = (u: number, w: number) => V3;
/** A wall facing down-left (the brand house's front), at this y. `u` is x. */
export const front =
  (y: number): Plane =>
  (u, w) => [u, y, w];
/** A wall facing down-right (the brand house's gable end), at this x. `u` is y. */
export const side =
  (x: number): Plane =>
  (u, w) => [x, u, w];
/** Level ground or a floor at height z. `u` is x, `w` is y. */
export const level =
  (z: number): Plane =>
  (u, w) => [u, w, z];

export const rect = (on: Plane, [u0, u1]: Span, [w0, w1]: Span): V3[] => [
  on(u0, w0),
  on(u1, w0),
  on(u1, w1),
  on(u0, w1),
];

/** An ellipse (or a slice of one, from angle t0 to t1) on a plane, as a polygon. */
export function circle(
  on: Plane,
  cu: number,
  cw: number,
  r: number,
  rw = r,
  t0 = 0,
  t1 = Math.PI * 2,
  n = 28,
): V3[] {
  const out: V3[] = [];
  const steps = Math.max(2, Math.round((n * Math.abs(t1 - t0)) / (Math.PI * 2)));
  for (let i = 0; i <= steps; i++) {
    const t = t0 + ((t1 - t0) * i) / steps;
    out.push(on(cu + r * Math.cos(t), cw + rw * Math.sin(t)));
  }
  return out;
}

/** A door or window with a round top: straight sides from w0 up to `spring`, then an arch. */
export function arch(on: Plane, [u0, u1]: Span, w0: number, spring: number): V3[] {
  const cu = (u0 + u1) / 2;
  const r = (u1 - u0) / 2;
  return [on(u0, w0), on(u1, w0), ...circle(on, cu, spring, r, r * 0.9, 0, Math.PI, 12)];
}

export class Drawing {
  readonly pieces: Piece[] = [];
  readonly points: Pt[] = [];

  readonly ink: string;

  constructor(ink: string = PALETTE.ink) {
    this.ink = ink;
  }

  /** Project a point in tiles to drawing units. */
  at(v: V3): Pt {
    return [(v[0] - v[1]) * TILE, ((v[0] + v[1]) * TILE) / 2 - v[2] * TILE];
  }

  track(...ps: Pt[]): void {
    this.points.push(...ps);
  }

  /** A closed polygon through 3D points, corners rounded by `r` drawing units. */
  poly(vs: readonly V3[], r = 0): string {
    const ps = vs.map((v) => this.at(v));
    this.track(...ps);
    return rounded(ps, r);
  }

  /** A closed polygon through points already in drawing units. */
  flat(ps: readonly Pt[], r = 0): string {
    this.track(...ps);
    return rounded(ps, r);
  }

  /** An open path through 3D points, for lines. */
  path(vs: readonly V3[]): string {
    const ps = vs.map((v) => this.at(v));
    this.track(...ps);
    return `M${ps.map((p) => `${fmt(p[0])} ${fmt(p[1])}`).join("L")}`;
  }

  /** A screen-space ellipse around a projected point, `r` in tiles. Bushes, lamps, wheels. */
  dot(c: V3, r: number, ry = r): string {
    const [x, y] = this.at(c);
    const rx = r * TILE;
    const yy = ry * TILE;
    this.track([x - rx, y - yy], [x + rx, y + yy]);
    return `M${fmt(x - rx)} ${fmt(y)}a${fmt(rx)} ${fmt(yy)} 0 1 0 ${fmt(2 * rx)} 0a${fmt(rx)} ${fmt(yy)} 0 1 0 ${fmt(-2 * rx)} 0Z`;
  }

  /** Start a new piece. What's added until the next call belongs to it and shares its outline. */
  piece(outline = true): this {
    this.pieces.push({ parts: [], outline });
    return this;
  }

  private get current(): Piece {
    const last = this.pieces[this.pieces.length - 1];
    if (last) return last;
    this.piece();
    return this.current;
  }

  /** A filled shape. `solid` shapes are part of the silhouette and get outlined. */
  fill(d: string, fill: string, opts: { solid?: boolean; opacity?: number } = {}): this {
    this.current.parts.push({ kind: "fill", d, fill, solid: opts.solid ?? true, ...opts });
    return this;
  }

  /** A detail painted on what's already there (a window on a wall): no outline of its own. */
  paint(d: string, fill: string, opacity?: number): this {
    return this.fill(d, fill, { solid: false, ...(opacity === undefined ? {} : { opacity }) });
  }

  /** A stroked line, `width` in tiles. Outlined unless `solid` is false. */
  line(d: string, stroke: string, width: number, solid = true): this {
    this.current.parts.push({ kind: "line", d, stroke, width: width * TILE, solid });
    return this;
  }

  /** Clip the current piece to a shape (the slab's clay sides, say). */
  clip(d: string): this {
    this.current.clip = d;
    return this;
  }

  bounds(pad = OUTLINE * 2): { x: number; y: number; w: number; h: number } {
    const xs = this.points.map((p) => p[0]);
    const ys = this.points.map((p) => p[1]);
    const x = Math.min(...xs) - pad;
    const y = Math.min(...ys) - pad;
    return { x, y, w: Math.max(...xs) + pad - x, h: Math.max(...ys) + pad - y };
  }

  /** The drawing's SVG elements, in drawing units. `id` keeps clip ids unique in a document. */
  render(id: string): string {
    const ink = this.ink;
    const outlineOf = (parts: Part[], width: number) =>
      parts
        .filter((p) => p.solid)
        .map((p) =>
          p.kind === "fill"
            ? `<path d="${p.d}"/>`
            : `<path d="${p.d}" fill="none" stroke-width="${fmt(p.width + width * 2)}" stroke-linecap="round"/>`,
        )
        .join("");
    const draw = (p: Part) =>
      p.kind === "fill"
        ? `<path d="${p.d}" fill="${p.fill}"${p.opacity === undefined ? "" : ` fill-opacity="${p.opacity}"`}/>`
        : `<path d="${p.d}" fill="none" stroke="${p.stroke}" stroke-width="${fmt(p.width)}" stroke-linecap="round" stroke-linejoin="round"/>`;
    const group = `fill="${ink}" stroke="${ink}" stroke-linejoin="round"`;
    const silhouette = `<g ${group} stroke-width="${fmt(OUTLINE * 2)}">${this.pieces.map((p) => outlineOf(p.parts, OUTLINE)).join("")}</g>`;
    const defs: string[] = [];
    const body = this.pieces
      .map((piece, i) => {
        const inner =
          piece.outline && i > 0
            ? `<g ${group} stroke-width="${fmt(INNER * 2)}">${outlineOf(piece.parts, INNER)}</g>`
            : "";
        const parts = piece.parts.map(draw).join("");
        if (!piece.clip) return inner + parts;
        const clipId = `${id}-clip-${i}`;
        defs.push(`<clipPath id="${clipId}"><path d="${piece.clip}"/></clipPath>`);
        return `${inner}<g clip-path="url(#${clipId})">${parts}</g>`;
      })
      .join("");
    return `<defs>${defs.join("")}</defs>${silhouette}${body}`;
  }
}

// ---------------------------------------------------------------------------
// Shapes. Each draws into the current piece; call d.piece() first to start a new outlined one.
// ---------------------------------------------------------------------------

/** A box: its top, front and side faces. */
export function box(d: Drawing, x: Span, y: Span, z: Span, f: Faces, r = 0): void {
  d.fill(d.poly(rect(front(y[1]), x, z), r), f.front);
  d.fill(d.poly(rect(side(x[1]), y, z), r), f.side);
  d.fill(d.poly(rect(level(z[1]), x, y), r), f.top);
}

/** A window on a wall: a frame, the glass, and optional crossing bars. */
export function pane(
  d: Drawing,
  on: Plane,
  u: Span,
  w: Span,
  glass: string,
  opts: { frame?: string; bars?: [number, number]; bar?: string } = {},
): void {
  const f = 0.022;
  if (opts.frame) d.paint(d.poly(rect(on, [u[0] - f, u[1] + f], [w[0] - f, w[1] + f])), opts.frame);
  d.paint(d.poly(rect(on, u, w), TILE * 0.012), glass);
  const [cols, rows] = opts.bars ?? [0, 0];
  const bar = opts.bar ?? opts.frame ?? PALETTE.clayDeep;
  const t = 0.011;
  for (let i = 1; i <= cols; i++) {
    const m = u[0] + ((u[1] - u[0]) * i) / (cols + 1);
    d.paint(d.poly(rect(on, [m - t, m + t], w)), bar);
  }
  for (let i = 1; i <= rows; i++) {
    const m = w[0] + ((w[1] - w[0]) * i) / (rows + 1);
    d.paint(d.poly(rect(on, u, [m - t, m + t])), bar);
  }
}

export interface Roof {
  plane: string;
  deep: string;
}

export const roofOf = (color: string): Roof => ({
  plane: color,
  deep: mix(color, PALETTE.ink, 0.32),
});

export interface GableSpec {
  x: Span;
  y: Span;
  /** Wall height and roof rise, in tiles. */
  wall: number;
  rise: number;
  /** "x": the ridge runs along x and the gable faces down-right, like the brand house. "y": it runs along y and the gable faces down-left. */
  ridge: "x" | "y";
  walls: Faces;
  roof: Roof;
  eave?: number;
  verge?: number;
  /** Rows of tiles drawn on the visible roof plane. */
  rows?: number;
  /** Drawn after the back of the roof and before the walls: a chimney. */
  behind?: () => void;
  /** Drawn on the walls before the front of the roof: windows, doors. */
  onWalls?: () => void;
  /** Base height (for a house on a platform). */
  base?: number;
}

/** A house with a pitched roof, built the way the brand mark's house is. */
export function gableHouse(d: Drawing, s: GableSpec): void {
  const [x0, x1] = s.x;
  const [y0, y1] = s.y;
  const b = s.base ?? 0;
  const h = b + s.wall;
  const peak = h + s.rise;
  const e = s.eave ?? 0.05;
  const v = s.verge ?? 0.04;
  const rr = TILE * 0.03;
  const vt = 0.06;
  if (s.ridge === "x") {
    const ym = (y0 + y1) / 2;
    const ze = h - (s.rise * e) / ((y1 - y0) / 2);
    const [xa, xb] = [x0 - v, x1 + v];
    d.fill(
      d.poly(
        [
          [xa, y0 - e, ze],
          [xb, y0 - e, ze],
          [xb, ym, peak],
          [xa, ym, peak],
        ],
        rr,
      ),
      s.roof.deep,
    );
    s.behind?.();
    d.fill(d.poly(rect(front(y1), s.x, [b, h])), s.walls.front);
    d.fill(
      d.poly([
        [x1, y0, b],
        [x1, y1, b],
        [x1, y1, h],
        [x1, ym, peak],
        [x1, y0, h],
      ]),
      s.walls.side,
    );
    s.onWalls?.();
    const slope = (t: number, x: number): V3 => [x, ym + (y1 + e - ym) * t, peak + (ze - peak) * t];
    d.fill(d.poly([slope(0, xa), slope(0, xb), slope(1, xb), slope(1, xa)], rr), s.roof.plane);
    for (let i = 1; i <= (s.rows ?? 0); i++) {
      const f = i / ((s.rows ?? 0) + 1);
      const w = 0.012;
      d.paint(
        d.poly([
          slope(f - w, xa + 0.02),
          slope(f - w, xb - 0.02),
          slope(f + w, xb - 0.02),
          slope(f + w, xa + 0.02),
        ]),
        s.roof.deep,
      );
    }
    d.fill(
      d.poly(
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
      s.roof.deep,
    );
  } else {
    const xm = (x0 + x1) / 2;
    const ze = h - (s.rise * e) / ((x1 - x0) / 2);
    const [ya, yb] = [y0 - v, y1 + v];
    d.fill(
      d.poly(
        [
          [x0 - e, ya, ze],
          [x0 - e, yb, ze],
          [xm, yb, peak],
          [xm, ya, peak],
        ],
        rr,
      ),
      s.roof.deep,
    );
    s.behind?.();
    d.fill(
      d.poly([
        [x0, y1, b],
        [x1, y1, b],
        [x1, y1, h],
        [xm, y1, peak],
        [x0, y1, h],
      ]),
      s.walls.front,
    );
    d.fill(d.poly(rect(side(x1), s.y, [b, h])), s.walls.side);
    s.onWalls?.();
    const slope = (t: number, y: number): V3 => [xm + (x1 + e - xm) * t, y, peak + (ze - peak) * t];
    d.fill(d.poly([slope(0, ya), slope(0, yb), slope(1, yb), slope(1, ya)], rr), s.roof.plane);
    for (let i = 1; i <= (s.rows ?? 0); i++) {
      const f = i / ((s.rows ?? 0) + 1);
      const w = 0.012;
      d.paint(
        d.poly([
          slope(f - w, ya + 0.02),
          slope(f - w, yb - 0.02),
          slope(f + w, yb - 0.02),
          slope(f + w, ya + 0.02),
        ]),
        s.roof.deep,
      );
    }
    d.fill(
      d.poly(
        [
          [x0 - e, yb, ze],
          [xm, yb, peak],
          [x1 + e, yb, ze],
          [x1 + e, yb, ze - vt],
          [xm, yb, peak - vt],
          [x0 - e, yb, ze - vt],
        ],
        rr,
      ),
      s.roof.deep,
    );
  }
}

/** A pyramid roof over a footprint, from height z, rising `rise` to a point. */
export function hipRoof(
  d: Drawing,
  x: Span,
  y: Span,
  z: number,
  rise: number,
  roof: Roof,
  e = 0.05,
): void {
  const [x0, x1] = [x[0] - e, x[1] + e];
  const [y0, y1] = [y[0] - e, y[1] + e];
  const apex: V3 = [(x0 + x1) / 2, (y0 + y1) / 2, z + rise];
  const zz = z - 0.03;
  const rr = TILE * 0.03;
  d.fill(d.poly([[x0, y0, zz], [x1, y0, zz], apex], rr), roof.deep);
  d.fill(d.poly([[x0, y0, zz], [x0, y1, zz], apex], rr), roof.deep);
  d.fill(d.poly([[x0, y1, zz], [x1, y1, zz], apex], rr), roof.plane);
  d.fill(d.poly([[x1, y0, zz], [x1, y1, zz], apex], rr), mix(roof.plane, roof.deep, 0.55));
}

/** An upright cylinder: a tower, a post, a pipe. The right side is shaded. */
export function cylinder(d: Drawing, cx: number, cy: number, r: number, z: Span, f: Faces): void {
  const ring = (zz: number, t0: number, t1: number) => circle(level(zz), cx, cy, r, r, t0, t1, 32);
  const q = Math.PI / 4;
  d.fill(d.poly([...ring(z[0], 3 * q, -q), ...ring(z[1], -q, 3 * q)]), f.front);
  d.paint(d.poly([...ring(z[0], 0.6, -q), ...ring(z[1], -q, 0.6)]), f.side);
  d.fill(d.poly(ring(z[1], 0, Math.PI * 2)), f.top);
}

/** A dome on a round base: an observatory, a pillar box top. */
export function dome(
  d: Drawing,
  cx: number,
  cy: number,
  r: number,
  z: number,
  fill: string,
  shade: string,
  height = r,
): void {
  const [x, y] = d.at([cx, cy, z]);
  const rx = r * TILE * Math.SQRT2;
  const up = height * TILE * 1.25;
  const pts: Pt[] = [];
  for (let i = 0; i <= 32; i++) {
    const t = Math.PI + (Math.PI * i) / 32;
    pts.push([x + rx * Math.cos(t), y + up * Math.sin(t)]);
  }
  for (let i = 0; i <= 16; i++) {
    const t = (Math.PI * i) / 16;
    pts.push([x + rx * Math.cos(t), y + (rx / 2) * Math.sin(t)]);
  }
  d.fill(d.flat(pts), fill);
  const shadePts: Pt[] = [];
  for (let i = 0; i <= 12; i++) {
    const t = -Math.PI / 2 + (Math.PI / 2) * (i / 12);
    shadePts.push([x + rx * Math.cos(t), y + up * Math.sin(t)]);
  }
  for (let i = 0; i <= 8; i++) {
    const t = (Math.PI / 2) * (i / 8);
    shadePts.push([x + rx * Math.cos(t), y + (rx / 2) * Math.sin(t)]);
  }
  shadePts.push([x + rx * 0.35, y + rx * 0.45], [x + rx * 0.3, y - up * 0.7]);
  d.paint(d.flat(shadePts), shade);
}

/** A shallow cone seen from above, in alternating stripes: a parasol. */
export function parasol(
  d: Drawing,
  cx: number,
  cy: number,
  r: number,
  z: number,
  rise: number,
  colors: [string, string],
): void {
  const apex = d.at([cx, cy, z + rise]);
  const n = 8;
  const q = Math.PI / 4;
  const rim = circle(level(z), cx, cy, r, r, 3 * q, -q, n * 4).map((v) => d.at(v));
  d.fill(d.flat([apex, ...rim]), colors[0]);
  for (let i = 0; i < n; i += 2) {
    const a = rim[i * 4];
    const slice = rim.slice(i * 4, i * 4 + 5);
    if (a) d.paint(d.flat([apex, ...slice]), colors[1]);
  }
  // A scalloped hem.
  for (let i = 0; i < n; i++) {
    const p = rim[i * 4 + 2];
    if (p) d.paint(d.flat(scallop(p, TILE * r * 0.18)), i % 2 ? colors[0] : colors[1]);
  }
}

function scallop([x, y]: Pt, r: number): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i <= 8; i++) {
    const t = (Math.PI * i) / 8;
    out.push([x + r * Math.cos(t), y + r * 0.7 * Math.sin(t)]);
  }
  return out;
}

/** A gear, flat on a plane: a sign. */
export function gear(
  d: Drawing,
  on: Plane,
  cu: number,
  cw: number,
  r: number,
  fill: string,
  hub: string,
): void {
  const pts: V3[] = [];
  const teeth = 8;
  for (let i = 0; i < teeth * 4; i++) {
    const t = (Math.PI * 2 * i) / (teeth * 4) + Math.PI / (teeth * 4);
    const out = i % 4 === 0 || i % 4 === 1;
    const rr = out ? r : r * 0.78;
    pts.push(on(cu + rr * Math.cos(t), cw + rr * Math.sin(t)));
  }
  d.fill(d.poly(pts), fill);
  d.paint(d.poly(circle(on, cu, cw, r * 0.34)), hub);
}

/** A little four-point sparkle in drawing units, for sparks, stars, glints. */
export function sparkle(d: Drawing, c: V3, r: number, fill: string): void {
  const [x, y] = d.at(c);
  const s = r * TILE;
  d.paint(
    d.flat([
      [x, y - s],
      [x + s * 0.25, y - s * 0.25],
      [x + s, y],
      [x + s * 0.25, y + s * 0.25],
      [x, y + s],
      [x - s * 0.25, y + s * 0.25],
      [x - s, y],
      [x - s * 0.25, y - s * 0.25],
    ]),
    fill,
  );
}

/** A clump of leaves: overlapping round blobs, darker below, a highlight on top. */
export function bush(
  d: Drawing,
  c: V3,
  r: number,
  dark = PALETTE.moss,
  light = PALETTE.mossLight,
): void {
  const [x, y, z] = c;
  d.fill(d.dot([x - r * 0.35, y + r * 0.35, z + r * 0.5], r * 0.85), dark);
  d.fill(d.dot([x + r * 0.35, y - r * 0.2, z + r * 0.55], r * 0.75), dark);
  d.fill(d.dot([x, y, z + r * 1.1], r * 0.85), dark);
  d.paint(d.dot([x - r * 0.1, y + r * 0.05, z + r * 1.45], r * 0.35), light);
}

/** The plot of earth from the brand mark: clay sides, pebbles, a scalloped grass lip, moss on top. */
export function slab(d: Drawing): void {
  const c = PALETTE;
  const t = MARK.thickness;
  d.piece(false);
  const outline = d.poly(
    [
      [0, 0, 0],
      [1, 0, 0],
      [1, 0, -t],
      [1, 1, -t],
      [0, 1, -t],
      [0, 1, 0],
    ],
    MARK.corner,
  );
  d.clip(outline);
  d.fill(outline, c.clay);
  d.paint(d.poly(rect(side(1), [0, 1], [-t, 0])), c.clayDeep);
  const pebbles: [V3, number, string][] = [
    [[0.28, 1, -0.3], 0.035, c.clayDeep],
    [[0.62, 1, -0.22], 0.025, c.clayDeep],
    [[0.8, 1, -0.36], 0.02, c.clayDeep],
    [[1, 0.34, -0.28], 0.03, c.clay],
    [[1, 0.7, -0.34], 0.022, c.clay],
  ];
  for (const [v, r, fill] of pebbles) d.paint(d.dot(v, r, r * 0.8), fill);
  const lip = (from: V3, to: V3): string => {
    const { depth, scallops, bulge } = MARK.lip;
    const at = (s: number, dz: number): string => {
      const p = d.at([from[0] + (to[0] - from[0]) * s, from[1] + (to[1] - from[1]) * s, -dz]);
      return `${fmt(p[0])} ${fmt(p[1])}`;
    };
    let path = `M${at(0, 0)}L${at(1, 0)}L${at(1, depth)}`;
    for (let i = scallops; i > 0; i--) {
      path += `Q${at((i - 0.5) / scallops, depth + bulge * 2)} ${at((i - 1) / scallops, depth)}`;
    }
    return `${path}Z`;
  };
  d.paint(lip([0, 1, 0], [1, 1, 0]), c.moss);
  d.paint(lip([1, 0, 0], [1, 1, 0]), c.moss);
  d.paint(d.poly(rect(level(0), [0, 1], [0, 1])), c.mossLight);
}
