/**
 * The banner a profile shows until its resident adds their own picture: a pattern drawn from
 * their id, so it's the same on every visit and every device, in their color and two companions.
 * `bannerShapes` is pure (and tested); `bannerArt` turns its list into an SVG.
 */
import type { ResidentColor } from "@terrakin/sim";

export const BANNER_W = 600;
export const BANNER_H = 200;

export type BannerMotif = "hills" | "confetti" | "waves" | "quilt" | "rings";
export const BANNER_MOTIFS: readonly BannerMotif[] = [
  "hills",
  "confetti",
  "waves",
  "quilt",
  "rings",
];

/** Colors a banner may use beside the resident's own. Coal and snow are too heavy or too faint. */
const COMPANIONS: readonly ResidentColor[] = ["sun", "sky", "leaf", "rose", "plum", "sand"];

export interface BannerShape {
  tag: "rect" | "circle" | "path";
  attrs: Record<string, number | string>;
  color: ResidentColor;
  /** Fill opacity, or stroke opacity when `stroke` is set. */
  opacity: number;
  /** Draw as a line this wide instead of filling. */
  stroke?: number;
}

/** FNV-1a: the same string always gives the same 32-bit number. */
export function hashSeed(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** mulberry32: a small seeded generator, so a banner never depends on Math.random. */
function seeded(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const round = (n: number) => Math.round(n * 10) / 10;

/** The motif and shapes for this resident's banner. Same id and color, same banner. */
export function bannerShapes(
  id: string,
  color: ResidentColor,
): { motif: BannerMotif; shapes: BannerShape[] } {
  const rand = seeded(hashSeed(id));
  const between = (lo: number, hi: number) => lo + rand() * (hi - lo);
  const pick = <T>(list: readonly T[]): T => list[Math.floor(rand() * list.length)] as T;

  const base: ResidentColor = color === "snow" ? "sand" : color;
  const others = COMPANIONS.filter((c) => c !== base);
  const a = pick(others);
  const b = pick(others.filter((c) => c !== a));
  const palette = [base, a, b] as const;
  const motif = pick(BANNER_MOTIFS);

  const shapes: BannerShape[] = [
    {
      tag: "rect",
      attrs: { x: 0, y: 0, width: BANNER_W, height: BANNER_H },
      color: base,
      opacity: 0.22,
    },
  ];

  if (motif === "hills") {
    shapes.push({
      tag: "circle",
      attrs: { cx: round(between(80, 520)), cy: round(between(50, 80)), r: round(between(24, 38)) },
      color: a === "sky" ? "sun" : a,
      opacity: 0.85,
    });
    // Three ridges, back to front, each lower and stronger than the last.
    const layers = [
      { top: 95, color: b, opacity: 0.45 },
      { top: 125, color: base, opacity: 0.6 },
      { top: 155, color: base, opacity: 0.9 },
    ] as const;
    for (const layer of layers) {
      const steps = 4;
      let d = `M0 ${round(layer.top + between(-15, 15))}`;
      for (let i = 1; i <= steps; i++) {
        const x = (BANNER_W / steps) * i;
        const cx = x - BANNER_W / steps / 2;
        d += ` Q${round(cx)} ${round(layer.top + between(-35, 15))} ${round(x)} ${round(layer.top + between(-15, 15))}`;
      }
      d += ` L${BANNER_W} ${BANNER_H} L0 ${BANNER_H} Z`;
      shapes.push({ tag: "path", attrs: { d }, color: layer.color, opacity: layer.opacity });
    }
  } else if (motif === "confetti") {
    const cell = 50;
    for (let y = cell / 2; y < BANNER_H; y += cell) {
      for (let x = cell / 2; x < BANNER_W; x += cell) {
        if (rand() < 0.25) continue;
        const cx = round(x + between(-14, 14));
        const cy = round(y + between(-14, 14));
        const c = pick(palette);
        const opacity = round(between(0.55, 0.95) * 100) / 100;
        const kind = rand();
        if (kind < 0.45) {
          shapes.push({
            tag: "circle",
            attrs: { cx, cy, r: round(between(4, 9)) },
            color: c,
            opacity,
          });
        } else if (kind < 0.8) {
          const w = round(between(14, 22));
          shapes.push({
            tag: "rect",
            attrs: {
              x: round(cx - w / 2),
              y: round(cy - 3),
              width: w,
              height: 6,
              rx: 3,
              transform: `rotate(${Math.round(between(0, 180))} ${cx} ${cy})`,
            },
            color: c,
            opacity,
          });
        } else {
          const s = between(7, 11);
          const d = `M${cx} ${round(cy - s)} L${round(cx + s)} ${round(cy + s * 0.8)} L${round(cx - s)} ${round(cy + s * 0.8)} Z`;
          shapes.push({ tag: "path", attrs: { d }, color: c, opacity });
        }
      }
    }
  } else if (motif === "waves") {
    const gap = between(24, 32);
    const amp = between(6, 12);
    const length = between(90, 140);
    for (let i = 0, y = between(8, 20); y < BANNER_H + amp; i++, y += gap) {
      const phase = rand() * length;
      let d = `M${round(-phase)} ${round(y)}`;
      for (let x = -phase; x < BANNER_W + length; x += length) {
        d += ` q${round(length / 4)} ${round(-amp)} ${round(length / 2)} 0 t${round(length / 2)} 0`;
      }
      shapes.push({
        tag: "path",
        attrs: { d },
        color: palette[i % palette.length] as ResidentColor,
        opacity: 0.7,
        stroke: round(between(5, 9)),
      });
    }
  } else if (motif === "quilt") {
    // Truchet tiles: each square gets a quarter circle or a half triangle in one of four turns.
    const size = 50;
    for (let y = 0; y < BANNER_H; y += size) {
      for (let x = 0; x < BANNER_W; x += size) {
        const turn = Math.floor(rand() * 4) * 90;
        const c = pick(palette);
        const opacity = round(between(0.45, 0.9) * 100) / 100;
        const d =
          rand() < 0.6
            ? `M${x} ${y} L${x + size} ${y} A${size} ${size} 0 0 1 ${x} ${y + size} Z`
            : `M${x} ${y} L${x + size} ${y} L${x} ${y + size} Z`;
        shapes.push({
          tag: "path",
          attrs: { d, transform: `rotate(${turn} ${x + size / 2} ${y + size / 2})` },
          color: c,
          opacity,
        });
      }
    }
  } else {
    const centers = 3 + Math.floor(rand() * 2);
    for (let i = 0; i < centers; i++) {
      const cx = round((BANNER_W / centers) * (i + between(0.2, 0.8)));
      const cy = round(between(30, 170));
      const c = palette[i % palette.length] as ResidentColor;
      for (let r = between(12, 20); r < 110; r += between(16, 22)) {
        shapes.push({
          tag: "circle",
          attrs: { cx, cy, r: round(r) },
          color: c,
          opacity: 0.55,
          stroke: round(between(4, 7)),
        });
      }
    }
  }
  return { motif, shapes };
}

const SVG_NS = "http://www.w3.org/2000/svg";

/** The banner as an SVG that covers its box. Decorative, so hidden from screen readers. */
export function bannerArt(id: string, color: ResidentColor): SVGSVGElement {
  const { motif, shapes } = bannerShapes(id, color);
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", `0 0 ${BANNER_W} ${BANNER_H}`);
  svg.setAttribute("preserveAspectRatio", "xMidYMid slice");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  svg.setAttribute("class", "banner-art");
  svg.dataset.motif = motif;
  for (const shape of shapes) {
    const el = document.createElementNS(SVG_NS, shape.tag);
    for (const [k, v] of Object.entries(shape.attrs)) el.setAttribute(k, String(v));
    const paint = `var(--resident-${shape.color})`;
    if (shape.stroke) {
      el.style.fill = "none";
      el.style.stroke = paint;
      el.style.strokeWidth = String(shape.stroke);
      el.style.strokeOpacity = String(shape.opacity);
      el.style.strokeLinecap = "round";
    } else {
      el.style.fill = paint;
      el.style.fillOpacity = String(shape.opacity);
    }
    svg.append(el);
  }
  return svg;
}
