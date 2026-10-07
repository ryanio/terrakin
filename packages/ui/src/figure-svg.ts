/**
 * A figure as plain shapes, for pictures drawn away from a browser (the server's pictures by link,
 * decision 0160). `drawFigure` paints into `SvgPen`, a stand-in for a 2D canvas that keeps each
 * fill and stroke as SVG path data instead of pixels, so the edge draws the same figure the map and
 * the avatars do. Nothing here touches the DOM, and no uploaded pattern tile is ever read: a look
 * here has no `patternMedia`, so a garment styled `own` wears the outfit's pattern.
 */
import type { Direction } from "@terrakin/sim";
import { drawFigure, type FigureLook } from "./figure";
import type {
  figureDrawing as Declared,
  EdgeLook,
  FigureDrawing,
  FigureShape,
  FigureTile,
} from "./figure-drawing";
import { lookPalette, PatternCache, type TileCanvas } from "./looks";

export { hairName } from "./looks";

/** Units to a tile. Two decimals of a unit is far finer than any picture draws a figure. */
const U = 100;

type Matrix = [number, number, number, number, number, number];
const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

const n = (v: number) => {
  const r = Math.round(v * 100) / 100;
  return Object.is(r, -0) ? "0" : String(r);
};

/** A canvas color as `#rrggbb` or `rgba(r, g, b, a)`, or undefined when it's neither. */
export function plainColor(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const v = value.trim().toLowerCase();
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/.exec(v);
  if (short) return `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}`;
  if (/^#[0-9a-f]{6}$/.test(v)) return v;
  const fn = /^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*(?:,\s*([\d.]+)\s*)?\)$/.exec(
    v,
  );
  if (!fn) return undefined;
  const [r, g, b] = [fn[1], fn[2], fn[3]].map((c) => Math.min(255, Number(c)));
  const a = fn[4] === undefined ? 1 : Math.max(0, Math.min(1, Number(fn[4])));
  return `rgba(${r}, ${g}, ${b}, ${a === 0 || a === 1 ? a : Number(a.toFixed(3))})`;
}

interface PenPattern {
  pen: SvgPen;
}

interface PenState {
  fillStyle: unknown;
  strokeStyle: unknown;
  lineWidth: number;
  lineCap: string;
  lineJoin: string;
  globalAlpha: number;
  m: Matrix;
  clips: number[];
}

/**
 * The subset of a 2D canvas the figure paints with, kept as SVG path data. Transforms are applied
 * to the points as they come, so arcs stay arcs under the translations and even scales the figure
 * uses. Anything it sets that a picture can't show (shadows) is ignored.
 */
export class SvgPen {
  fillStyle: unknown = "#000000";
  strokeStyle: unknown = "#000000";
  lineWidth = 1;
  lineCap = "butt";
  lineJoin = "miter";
  globalAlpha = 1;
  shadowColor = "";
  shadowBlur = 0;
  shadowOffsetX = 0;
  shadowOffsetY = 0;
  readonly shapes: FigureShape[] = [];
  readonly clipPaths: string[] = [];
  readonly tiles: FigureTile[] = [];
  private readonly tileOf = new Map<string, number>();
  private patternPens: SvgPen[] = [];
  private m: Matrix = [...IDENTITY];
  private clips: number[] = [];
  private stack: PenState[] = [];
  private d: string[] = [];
  private open = false;
  private start = { x: 0, y: 0 };

  constructor(readonly size = 0) {}

  // ---- state ----
  save() {
    this.stack.push({
      fillStyle: this.fillStyle,
      strokeStyle: this.strokeStyle,
      lineWidth: this.lineWidth,
      lineCap: this.lineCap,
      lineJoin: this.lineJoin,
      globalAlpha: this.globalAlpha,
      m: [...this.m],
      clips: [...this.clips],
    });
  }
  restore() {
    const s = this.stack.pop();
    if (!s) return;
    Object.assign(this, {
      fillStyle: s.fillStyle,
      strokeStyle: s.strokeStyle,
      lineWidth: s.lineWidth,
      lineCap: s.lineCap,
      lineJoin: s.lineJoin,
      globalAlpha: s.globalAlpha,
    });
    this.m = s.m;
    this.clips = s.clips;
  }
  setTransform(a = 1, b = 0, c = 0, d = 1, e = 0, f = 0) {
    this.m = [a, b, c, d, e, f];
  }
  transform(a: number, b: number, c: number, d: number, e: number, f: number) {
    const [A, B, C, D, E, F] = this.m;
    this.m = [
      A * a + C * b,
      B * a + D * b,
      A * c + C * d,
      B * c + D * d,
      A * e + C * f + E,
      B * e + D * f + F,
    ];
  }
  translate(x: number, y: number) {
    this.transform(1, 0, 0, 1, x, y);
  }
  scale(x: number, y: number) {
    this.transform(x, 0, 0, y, 0, 0);
  }
  rotate(t: number) {
    this.transform(Math.cos(t), Math.sin(t), -Math.sin(t), Math.cos(t), 0, 0);
  }

  // ---- paths ----
  private pt(x: number, y: number): [number, number] {
    const [a, b, c, d, e, f] = this.m;
    return [a * x + c * y + e, b * x + d * y + f];
  }
  private get unit(): number {
    const [a, b, c, d] = this.m;
    return Math.sqrt(Math.abs(a * d - b * c));
  }
  beginPath() {
    this.d = [];
    this.open = false;
  }
  moveTo(x: number, y: number) {
    const [px, py] = this.pt(x, y);
    this.d.push(`M${n(px)} ${n(py)}`);
    this.open = true;
    this.start = { x, y };
  }
  lineTo(x: number, y: number) {
    if (!this.open) return this.moveTo(x, y);
    const [px, py] = this.pt(x, y);
    this.d.push(`L${n(px)} ${n(py)}`);
  }
  quadraticCurveTo(cx: number, cy: number, x: number, y: number) {
    if (!this.open) this.moveTo(cx, cy);
    const [a, b] = this.pt(cx, cy);
    const [px, py] = this.pt(x, y);
    this.d.push(`Q${n(a)} ${n(b)} ${n(px)} ${n(py)}`);
  }
  bezierCurveTo(c1x: number, c1y: number, c2x: number, c2y: number, x: number, y: number) {
    if (!this.open) this.moveTo(c1x, c1y);
    const [a, b] = this.pt(c1x, c1y);
    const [c, d] = this.pt(c2x, c2y);
    const [px, py] = this.pt(x, y);
    this.d.push(`C${n(a)} ${n(b)} ${n(c)} ${n(d)} ${n(px)} ${n(py)}`);
  }
  closePath() {
    if (!this.open) return;
    this.d.push("Z");
    // The canvas starts the next subpath where this one began.
    const [px, py] = this.pt(this.start.x, this.start.y);
    this.d.push(`M${n(px)} ${n(py)}`);
  }
  arc(x: number, y: number, r: number, a0: number, a1: number, ccw = false) {
    this.ellipse(x, y, r, r, 0, a0, a1, ccw);
  }
  ellipse(
    x: number,
    y: number,
    rx: number,
    ry: number,
    turn: number,
    a0: number,
    a1: number,
    ccw = false,
  ) {
    const TAU = Math.PI * 2;
    let sweep: number;
    if (!ccw && a1 - a0 >= TAU) sweep = TAU;
    else if (ccw && a0 - a1 >= TAU) sweep = -TAU;
    else {
      const span = (((ccw ? a0 - a1 : a1 - a0) % TAU) + TAU) % TAU;
      sweep = ccw ? -span : span;
    }
    const at = (t: number) => {
      const ex = rx * Math.cos(t);
      const ey = ry * Math.sin(t);
      return [
        x + ex * Math.cos(turn) - ey * Math.sin(turn),
        y + ex * Math.sin(turn) + ey * Math.cos(turn),
      ] as const;
    };
    const [sx, sy] = at(a0);
    if (this.open) this.lineTo(sx, sy);
    else this.moveTo(sx, sy);
    if (sweep === 0) return;
    const [a, b, , d] = this.m;
    const k = this.unit;
    const flip = a * d - b * this.m[2] < 0;
    const degrees = ((turn + Math.atan2(b, a)) * 180) / Math.PI;
    const steps = Math.max(1, Math.ceil(Math.abs(sweep) / (Math.PI / 2) - 1e-9));
    const flag = sweep > 0 !== flip ? 1 : 0;
    for (let i = 1; i <= steps; i++) {
      const [ex, ey] = at(a0 + (sweep * i) / steps);
      const [px, py] = this.pt(ex, ey);
      this.d.push(`A${n(rx * k)} ${n(ry * k)} ${n(degrees)} 0 ${flag} ${n(px)} ${n(py)}`);
    }
  }
  rect(x: number, y: number, w: number, h: number) {
    this.moveTo(x, y);
    this.lineTo(x + w, y);
    this.lineTo(x + w, y + h);
    this.lineTo(x, y + h);
    this.closePath();
  }
  roundRect(x: number, y: number, w: number, h: number, radii: number | number[] = 0) {
    const list = Array.isArray(radii) ? radii : [radii];
    const [tl = 0, tr = tl, br = tl, bl = tr] =
      list.length === 2
        ? [list[0], list[1], list[0], list[1]]
        : list.length === 3
          ? [list[0], list[1], list[2], list[1]]
          : list;
    const cap = (r: number) => Math.max(0, Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2));
    const [a, b, c, d] = [cap(tl ?? 0), cap(tr ?? 0), cap(br ?? 0), cap(bl ?? 0)];
    const Q = Math.PI / 2;
    this.moveTo(x + a, y);
    this.lineTo(x + w - b, y);
    if (b) this.ellipse(x + w - b, y + b, b, b, 0, -Q, 0);
    this.lineTo(x + w, y + h - c);
    if (c) this.ellipse(x + w - c, y + h - c, c, c, 0, 0, Q);
    this.lineTo(x + d, y + h);
    if (d) this.ellipse(x + d, y + h - d, d, d, 0, Q, Math.PI);
    this.lineTo(x, y + a);
    if (a) this.ellipse(x + a, y + a, a, a, 0, Math.PI, Math.PI + Q);
    this.start = { x, y };
    this.closePath();
  }

  // ---- painting ----
  private get path(): string | undefined {
    const d = this.d.join("");
    return /[LQCAZ]/.test(d) ? d : undefined;
  }
  private alpha(): number | undefined {
    const a = this.globalAlpha;
    return Number.isFinite(a) && a < 1 ? Math.max(0, Number(a.toFixed(3))) : undefined;
  }
  private paint(d: string, style: unknown, kind: "fill" | "stroke") {
    const shape: FigureShape = { d };
    if (kind === "fill") {
      const tile = this.tileFor(style);
      if (tile !== undefined) shape.tile = tile;
      else {
        const fill = plainColor(style);
        if (!fill) return;
        shape.fill = fill;
      }
    } else {
      const stroke = plainColor(style);
      if (!stroke) return;
      shape.stroke = stroke;
      shape.width = Number((this.lineWidth * this.unit).toFixed(2));
      if (this.lineCap !== "butt") shape.cap = this.lineCap as FigureShape["cap"];
      if (this.lineJoin !== "miter") shape.join = this.lineJoin as FigureShape["join"];
    }
    const alpha = this.alpha();
    if (alpha !== undefined) shape.alpha = alpha;
    if (this.clips.length) shape.clip = [...this.clips];
    this.shapes.push(shape);
  }
  fill() {
    const d = this.path;
    if (d) this.paint(d, this.fillStyle, "fill");
  }
  stroke() {
    const d = this.path;
    if (d) this.paint(d, this.strokeStyle, "stroke");
  }
  clip() {
    const d = this.path ?? "M0 0Z";
    this.clipPaths.push(d);
    this.clips = [...this.clips, this.clipPaths.length - 1];
  }
  private aside(draw: () => void) {
    const [d, open, start] = [this.d, this.open, this.start];
    this.beginPath();
    draw();
    this.d = d;
    this.open = open;
    this.start = start;
  }
  fillRect(x: number, y: number, w: number, h: number) {
    this.aside(() => {
      this.rect(x, y, w, h);
      this.fill();
    });
  }
  strokeRect(x: number, y: number, w: number, h: number) {
    this.aside(() => {
      this.rect(x, y, w, h);
      this.stroke();
    });
  }
  clearRect() {}

  // ---- patterns ----
  createPattern(source: unknown): PenPattern | null {
    return source instanceof SvgPen ? { pen: source } : null;
  }
  private tileFor(style: unknown): number | undefined {
    if (!style || typeof style !== "object" || !("pen" in style)) return undefined;
    const pen = (style as PenPattern).pen;
    let index = this.patternPens.indexOf(pen);
    if (index < 0) {
      this.patternPens.push(pen);
      index = this.patternPens.length - 1;
    }
    // A canvas pattern sits on the space it's filled in, so the tile carries that transform.
    const at = this.m.map((v) => Number(v.toFixed(3)));
    const key = `${index}|${at.join(",")}`;
    const known = this.tileOf.get(key);
    if (known !== undefined) return known;
    const identity = at.every((v, i) => v === IDENTITY[i]);
    this.tiles.push({ size: pen.size, shapes: pen.shapes, ...(identity ? {} : { at }) });
    this.tileOf.set(key, this.tiles.length - 1);
    return this.tiles.length - 1;
  }
}

/** Pattern tiles drawn into pens, shared by every figure this process records. */
const pens = new PatternCache((w): TileCanvas => {
  const pen = new SvgPen(w);
  return { canvas: pen as unknown as CanvasImageSource, ctx: pen as unknown as TileCanvas["ctx"] };
});

/** The figure's box around its feet: a tile across, a little more than a tile tall, with its rim. */
const BOX: FigureDrawing["box"] = [-0.62 * U, -1.2 * U, 1.24 * U, 1.38 * U];

export const figureDrawing: typeof Declared = (look: EdgeLook, facing: Direction = "s") => {
  const pen = new SvgPen();
  const ctx = pen as unknown as CanvasRenderingContext2D;
  const full: FigureLook = { ...look };
  const p = lookPalette(look.theme, look.color);
  // The clothes' pattern at the size the page's figures use (`paintFigure`).
  const pattern = pens.named(ctx, look.pattern ?? "plain", p, U * 0.36);
  drawFigure(ctx, U, full, pattern, facing, pens);
  return { box: BOX, shapes: pen.shapes, clips: pen.clipPaths, tiles: pen.tiles };
};
