/**
 * Looks (RFC 0005) for drawing: palettes, pattern motifs, cached pattern tiles, and uploaded images.
 * The catalog itself is data in the sim; this file only turns it into pixels. Pure parts (palettes,
 * motif layouts, the tile cache) are tested without a browser.
 */
import {
  alphaHex,
  type GarmentPattern,
  mixHex,
  type Pattern,
  type ResidentColor,
  THEME_INFO,
  type Theme,
  type ThemePalette,
  WEAR_INFO,
  type WearItem,
} from "@terrakin/sim";
import { BRAND_HEX } from "./brand";
import { isMediaUrl } from "./format";

/** Resident colors. Same values as the `--resident-*` tokens in tokens.css. */
export const RESIDENT_COLOR_HEX: Record<ResidentColor, string> = {
  sun: "#f2b84b",
  sky: "#7cb9dd",
  leaf: "#86b65f",
  rose: "#ea8a9d",
  plum: "#a98bd8",
  sand: "#e2c993",
  coal: "#4a443d",
  snow: "#fbf7ee",
};

const PAPER = BRAND_HEX.paper;
const INK = BRAND_HEX.ink;

/** Blend two hex colors: `t` 0 is `a`, 1 is `b`. The sim's palette has the one copy. */
export const mix = mixHex;

/** A hex color as rgba() with an alpha. */
export const withAlpha = alphaHex;

/** The palette for a look: its theme's, or one made from the resident's color when it has none. */
export function lookPalette(theme: Theme | undefined, color: ResidentColor): ThemePalette {
  if (theme && Object.hasOwn(THEME_INFO, theme)) return THEME_INFO[theme].palette;
  const c = RESIDENT_COLOR_HEX[color] ?? RESIDENT_COLOR_HEX.sun;
  const deep = mix(c, INK, 0.4);
  return {
    main: mix(c, PAPER, 0.3),
    accent: color === "snow" || color === "sand" ? deep : PAPER,
    deep,
    light: mix(c, PAPER, 0.72),
    ground: c,
  };
}

// ---------- pattern motifs ----------

export type Role = keyof Omit<ThemePalette, "ground">;

/**
 * One motif in a pattern tile, in tile units (0 to 1). Every motif sits inside the tile, so tiles
 * repeat without seams; waves run edge to edge and start and end at the same height.
 */
export type Motif =
  | { kind: "circle"; x: number; y: number; r: number; fill: Role; alpha?: number }
  | { kind: "rect"; x: number; y: number; w: number; h: number; fill: Role; alpha: number }
  | { kind: "star"; x: number; y: number; r: number; fill: Role }
  | { kind: "heart"; x: number; y: number; r: number; fill: Role }
  | { kind: "leaf"; x: number; y: number; r: number; angle: number; fill: Role; vein: Role }
  | { kind: "flower"; x: number; y: number; r: number; fill: Role; center: Role }
  | { kind: "slice"; x: number; y: number; r: number }
  | { kind: "wave"; y: number; amp: number; width: number; stroke: Role };

const MOTIFS: Record<Pattern, Motif[]> = {
  plain: [],
  dots: [
    { kind: "circle", x: 0.25, y: 0.25, r: 0.11, fill: "accent" },
    { kind: "circle", x: 0.75, y: 0.75, r: 0.11, fill: "accent" },
  ],
  stripes: [{ kind: "rect", x: 0, y: 0, w: 1, h: 0.34, fill: "light", alpha: 0.85 }],
  gingham: [
    { kind: "rect", x: 0, y: 0, w: 1, h: 0.5, fill: "light", alpha: 0.5 },
    { kind: "rect", x: 0, y: 0, w: 0.5, h: 1, fill: "light", alpha: 0.5 },
  ],
  florals: [
    { kind: "flower", x: 0.3, y: 0.3, r: 0.2, fill: "light", center: "accent" },
    { kind: "flower", x: 0.77, y: 0.76, r: 0.13, fill: "accent", center: "light" },
  ],
  citrus: [
    { kind: "slice", x: 0.3, y: 0.3, r: 0.2 },
    { kind: "slice", x: 0.77, y: 0.77, r: 0.13 },
  ],
  stars: [
    { kind: "star", x: 0.3, y: 0.3, r: 0.17, fill: "accent" },
    { kind: "circle", x: 0.76, y: 0.74, r: 0.05, fill: "accent" },
  ],
  waves: [
    { kind: "wave", y: 0.3, amp: 0.08, width: 0.09, stroke: "light" },
    { kind: "wave", y: 0.8, amp: 0.08, width: 0.05, stroke: "accent" },
  ],
  hearts: [
    { kind: "heart", x: 0.3, y: 0.3, r: 0.17, fill: "accent" },
    { kind: "heart", x: 0.77, y: 0.77, r: 0.1, fill: "light" },
  ],
  leaves: [
    { kind: "leaf", x: 0.3, y: 0.32, r: 0.19, angle: -0.6, fill: "accent", vein: "deep" },
    { kind: "leaf", x: 0.76, y: 0.76, r: 0.13, angle: 0.9, fill: "light", vein: "deep" },
  ],
};

/** The motifs of one pattern tile. Plain is empty. */
export function patternMotifs(pattern: Pattern): readonly Motif[] {
  return Object.hasOwn(MOTIFS, pattern) ? MOTIFS[pattern] : [];
}

/** The box a motif covers, in tile units. Waves are periodic and span the tile. */
export function motifBounds(m: Motif): { x0: number; y0: number; x1: number; y1: number } {
  switch (m.kind) {
    case "rect":
      return { x0: m.x, y0: m.y, x1: m.x + m.w, y1: m.y + m.h };
    case "wave":
      return { x0: 0, y0: m.y - m.amp - m.width / 2, x1: 1, y1: m.y + m.amp + m.width / 2 };
    default:
      return { x0: m.x - m.r, y0: m.y - m.r, x1: m.x + m.r, y1: m.y + m.r };
  }
}

/** The height of a wave at x (tile units), periodic over one tile. */
export const waveY = (m: { y: number; amp: number }, x: number) =>
  m.y + Math.sin(x * Math.PI * 2) * m.amp;

/** The subset of a 2D context the painters use, so tests can pass a recorder. */
type Ctx = Pick<
  CanvasRenderingContext2D,
  | "beginPath"
  | "arc"
  | "ellipse"
  | "fill"
  | "fillRect"
  | "moveTo"
  | "lineTo"
  | "quadraticCurveTo"
  | "bezierCurveTo"
  | "closePath"
  | "stroke"
  | "save"
  | "restore"
> & {
  fillStyle: unknown;
  strokeStyle: unknown;
  lineWidth: number;
  lineCap: CanvasLineCap;
  globalAlpha: number;
};

/** Draw one motif at (ox, oy), with `u` pixels per tile unit. */
export function paintMotif(ctx: Ctx, m: Motif, p: ThemePalette, ox: number, oy: number, u: number) {
  const X = (x: number) => ox + x * u;
  const Y = (y: number) => oy + y * u;
  switch (m.kind) {
    case "circle":
      ctx.globalAlpha = m.alpha ?? 1;
      ctx.fillStyle = p[m.fill];
      ctx.beginPath();
      ctx.arc(X(m.x), Y(m.y), m.r * u, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
      return;
    case "rect":
      ctx.globalAlpha = m.alpha;
      ctx.fillStyle = p[m.fill];
      ctx.fillRect(X(m.x), Y(m.y), m.w * u, m.h * u);
      ctx.globalAlpha = 1;
      return;
    case "star": {
      ctx.fillStyle = p[m.fill];
      ctx.beginPath();
      for (let i = 0; i < 10; i++) {
        const a = -Math.PI / 2 + (i * Math.PI) / 5;
        const r = (i % 2 === 0 ? m.r : m.r * 0.45) * u;
        const x = X(m.x) + Math.cos(a) * r;
        const y = Y(m.y) + Math.sin(a) * r;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.fill();
      return;
    }
    case "heart": {
      const x = X(m.x);
      const y = Y(m.y);
      const r = m.r * u;
      ctx.fillStyle = p[m.fill];
      ctx.beginPath();
      ctx.moveTo(x, y + r * 0.9);
      ctx.bezierCurveTo(x - r * 1.25, y + r * 0.1, x - r * 0.75, y - r * 0.95, x, y - r * 0.35);
      ctx.bezierCurveTo(x + r * 0.75, y - r * 0.95, x + r * 1.25, y + r * 0.1, x, y + r * 0.9);
      ctx.fill();
      return;
    }
    case "leaf": {
      const x = X(m.x);
      const y = Y(m.y);
      const r = m.r * u;
      const cos = Math.cos(m.angle);
      const sin = Math.sin(m.angle);
      const pt = (a: number, b: number): [number, number] => [
        x + a * cos - b * sin,
        y + a * sin + b * cos,
      ];
      ctx.fillStyle = p[m.fill];
      ctx.beginPath();
      ctx.moveTo(...pt(-r, 0));
      ctx.quadraticCurveTo(...pt(0, -r * 0.75), ...pt(r, 0));
      ctx.quadraticCurveTo(...pt(0, r * 0.75), ...pt(-r, 0));
      ctx.fill();
      ctx.strokeStyle = p[m.vein];
      ctx.lineWidth = Math.max(0.6, r * 0.12);
      ctx.beginPath();
      ctx.moveTo(...pt(-r * 0.75, 0));
      ctx.lineTo(...pt(r * 0.7, 0));
      ctx.stroke();
      return;
    }
    case "flower": {
      const x = X(m.x);
      const y = Y(m.y);
      const r = m.r * u;
      ctx.fillStyle = p[m.fill];
      ctx.beginPath();
      for (let i = 0; i < 5; i++) {
        const a = (i * Math.PI * 2) / 5 - Math.PI / 2;
        const px = x + Math.cos(a) * r * 0.55;
        const py = y + Math.sin(a) * r * 0.55;
        ctx.moveTo(px + r * 0.42, py);
        ctx.arc(px, py, r * 0.42, 0, Math.PI * 2);
      }
      ctx.fill();
      ctx.fillStyle = p[m.center];
      ctx.beginPath();
      ctx.arc(x, y, r * 0.3, 0, Math.PI * 2);
      ctx.fill();
      return;
    }
    case "slice": {
      // A citrus slice: rind, pith, flesh in segments.
      const x = X(m.x);
      const y = Y(m.y);
      const r = m.r * u;
      ctx.fillStyle = p.deep;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = p.light;
      ctx.beginPath();
      ctx.arc(x, y, r * 0.84, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = mix(p.main, p.deep, 0.15);
      ctx.beginPath();
      for (let i = 0; i < 6; i++) {
        const a0 = (i * Math.PI) / 3 + 0.12;
        const a1 = ((i + 1) * Math.PI) / 3 - 0.12;
        ctx.moveTo(x + Math.cos(a0) * r * 0.12, y + Math.sin(a0) * r * 0.12);
        ctx.arc(x, y, r * 0.7, a0, a1);
        ctx.closePath();
      }
      ctx.fill();
      return;
    }
    case "wave": {
      ctx.strokeStyle = p[m.stroke];
      ctx.lineWidth = m.width * u;
      ctx.lineCap = "butt";
      ctx.beginPath();
      const steps = 16;
      for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        const x = X(t);
        const y = Y(waveY(m, t));
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
      return;
    }
  }
}

// ---------- pattern tiles, generated once and cached ----------

export interface TileCanvas {
  canvas: CanvasImageSource;
  ctx: Ctx;
}

/** A canvas maker: a real one in the browser, a recorder in tests. */
export type MakeCanvas = (w: number, h: number) => TileCanvas;

export const browserCanvas: MakeCanvas = (w, h) => {
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  return { canvas, ctx: canvas.getContext("2d") as CanvasRenderingContext2D };
};

/**
 * Pattern tiles keyed by pattern, palette, and size. Each tile is drawn once into a small canvas
 * and turned into a CanvasPattern, so filling clothes every frame costs a single fill.
 */
export class PatternCache {
  private readonly tiles = new Map<string, CanvasPattern | null>();
  constructor(
    private readonly make: MakeCanvas = browserCanvas,
    private readonly limit = 200,
  ) {}

  get size() {
    return this.tiles.size;
  }

  /** A repeating pattern, or null for plain. `px` is the tile size in device pixels. */
  named(
    target: Pick<CanvasRenderingContext2D, "createPattern">,
    pattern: Pattern,
    palette: ThemePalette,
    px: number,
  ): CanvasPattern | null {
    const motifs = patternMotifs(pattern);
    if (motifs.length === 0) return null;
    const size = Math.max(4, Math.round(px));
    const key = `${pattern}|${palette.main}|${palette.accent}|${palette.deep}|${palette.light}|${size}`;
    const hit = this.tiles.get(key);
    if (hit !== undefined) return hit;
    const { canvas, ctx } = this.make(size, size);
    for (const m of motifs) paintMotif(ctx, m, palette, 0, 0, size);
    return this.remember(key, target.createPattern(canvas, "repeat"));
  }

  /** A repeating pattern from an uploaded image, cropped square to `px`. Null until it loads. */
  image(
    target: Pick<CanvasRenderingContext2D, "createPattern">,
    mediaId: string,
    img: HTMLImageElement,
    px: number,
  ): CanvasPattern | null {
    const size = Math.max(4, Math.round(px));
    const key = `img|${mediaId}|${size}`;
    const hit = this.tiles.get(key);
    if (hit !== undefined) return hit;
    const { canvas, ctx } = this.make(size, size);
    const side = Math.min(img.naturalWidth, img.naturalHeight);
    (ctx as unknown as CanvasRenderingContext2D).drawImage(
      img,
      (img.naturalWidth - side) / 2,
      (img.naturalHeight - side) / 2,
      side,
      side,
      0,
      0,
      size,
      size,
    );
    return this.remember(key, target.createPattern(canvas, "repeat"));
  }

  private remember(key: string, pattern: CanvasPattern | null) {
    if (this.tiles.size >= this.limit) this.tiles.clear();
    this.tiles.set(key, pattern);
    return pattern;
  }
}

// ---------- uploaded images (custom patterns, home pictures) ----------

const images = new Map<string, { img: HTMLImageElement; ready: boolean; failed: boolean }>();
const waiting = new Set<() => void>();

/** Hear when any uploaded look image finishes loading, so drawings that used a fallback redraw. */
export function onLookImage(fn: () => void): () => void {
  waiting.add(fn);
  return () => waiting.delete(fn);
}

/** The media URL for an upload id, only when it is exactly one of ours. */
export function mediaUrlOf(id: string | undefined): string | undefined {
  if (!id) return undefined;
  const url = `/media/${id}`;
  return isMediaUrl(url) ? url : undefined;
}

/**
 * An uploaded image by media id, loaded once. Returns it when ready, else undefined (and starts
 * loading). Only our own `/media/m_...` URLs are ever fetched.
 */
export function lookImage(id: string | undefined): HTMLImageElement | undefined {
  const url = mediaUrlOf(id);
  if (!url || !id) return undefined;
  let entry = images.get(id);
  if (!entry) {
    const img = new Image();
    img.decoding = "async";
    const fresh = { img, ready: false, failed: false };
    entry = fresh;
    images.set(id, fresh);
    img.addEventListener("load", () => {
      fresh.ready = img.naturalWidth > 0;
      for (const fn of waiting) fn();
    });
    img.addEventListener("error", () => {
      fresh.failed = true;
    });
    img.src = url;
  }
  return entry.ready ? entry.img : undefined;
}

// ---------- garments in words ----------

/** Resident colors in plain words, for "Citrus dress in sun yellow". */
export const COLOR_WORDS: Record<ResidentColor, string> = {
  sun: "sun yellow",
  sky: "sky blue",
  leaf: "leaf green",
  rose: "rose pink",
  plum: "plum purple",
  sand: "sand",
  coal: "coal black",
  snow: "snow white",
};

/** A pattern as a word before a garment: a citrus dress, striped socks. */
const PATTERN_WORDS: Record<GarmentPattern, string> = {
  plain: "plain",
  dots: "dotted",
  stripes: "striped",
  gingham: "gingham",
  florals: "floral",
  citrus: "citrus",
  stars: "starry",
  waves: "wavy",
  hearts: "heart print",
  leaves: "leafy",
  own: "own pattern",
};

/**
 * A garment in plain words, from our catalogs only: "Citrus dress in sun yellow", "Striped
 * socks", "Beret in plum purple", or just "Dress" with no style.
 */
export function garmentName(
  item: WearItem,
  style?: { pattern?: GarmentPattern | undefined; color?: ResidentColor | undefined },
): string {
  const noun = WEAR_INFO[item]?.label ?? item;
  const pattern =
    style?.pattern && style.pattern !== "plain" ? PATTERN_WORDS[style.pattern] : undefined;
  const color = style?.color ? COLOR_WORDS[style.color] : undefined;
  const name = pattern ? `${pattern} ${noun.toLowerCase()}` : noun;
  const out = color ? `${name} in ${color}` : name;
  return out.charAt(0).toUpperCase() + out.slice(1);
}
