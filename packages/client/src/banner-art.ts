/**
 * The banner a profile shows until its resident adds their own picture: a pattern drawn from
 * their id, so it's the same on every visit and every device, in their color and two companions.
 * `bannerShapes` is pure (and tested); `bannerArt` turns its list into an SVG.
 */
import type { ProfileDesign } from "@terrakin/protocol";
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

/**
 * The header art of a partner's profile design (RFC 0007, decision 0058): the same picture for
 * every character with that design, so it reads as the partner's at a glance. Drawn from resident
 * colors like every banner, never from partner text or art.
 */
export function designShapes(design: ProfileDesign): BannerShape[] {
  const fill = (color: ResidentColor, opacity: number): Pick<BannerShape, "color" | "opacity"> => ({
    color,
    opacity,
  });
  const backdrop = (color: ResidentColor, opacity: number): BannerShape => ({
    tag: "rect",
    attrs: { x: 0, y: 0, width: BANNER_W, height: BANNER_H },
    ...fill(color, opacity),
  });
  const shapes: BannerShape[] = [];
  if (design === "velvet") {
    // Quilted plush: a plum ground, a rose sheen, diamond tufting, and a button at each crossing.
    shapes.push(backdrop("plum", 0.62), {
      tag: "path",
      attrs: { d: `M0 ${BANNER_H} L${BANNER_W} 0 L${BANNER_W} ${BANNER_H} Z` },
      ...fill("rose", 0.22),
    });
    const cell = 50;
    for (let x = -BANNER_H; x <= BANNER_W; x += cell) {
      shapes.push(
        {
          tag: "path",
          attrs: { d: `M${x} 0 L${x + BANNER_H} ${BANNER_H}` },
          ...fill("snow", 0.28),
          stroke: 2,
        },
        {
          tag: "path",
          attrs: { d: `M${x + BANNER_H} 0 L${x} ${BANNER_H}` },
          ...fill("snow", 0.28),
          stroke: 2,
        },
      );
    }
    for (let y = 0; y <= BANNER_H; y += cell / 2) {
      const shift = (y / (cell / 2)) % 2 === 0 ? 0 : cell / 2;
      for (let x = shift; x <= BANNER_W; x += cell) {
        shapes.push({ tag: "circle", attrs: { cx: x, cy: y, r: 3.5 }, ...fill("snow", 0.7) });
      }
    }
  } else if (design === "lantern") {
    // A warm night: coal sky with a plum glow, a string of lanterns, and a few stars.
    shapes.push(backdrop("coal", 0.88), {
      tag: "circle",
      attrs: { cx: BANNER_W * 0.7, cy: BANNER_H * 1.4, r: BANNER_H },
      ...fill("plum", 0.4),
    });
    for (const [cx, cy] of [
      [40, 30],
      [150, 22],
      [270, 40],
      [520, 26],
      [580, 60],
      [95, 70],
    ] as const) {
      shapes.push({ tag: "circle", attrs: { cx, cy, r: 1.8 }, ...fill("snow", 0.8) });
    }
    // Where the string hangs at x: the same curve as the path below.
    const sag = (x: number) => 82 + 120 * (x / BANNER_W) * (1 - x / BANNER_W);
    shapes.push({
      tag: "path",
      attrs: { d: `M0 82 Q${BANNER_W / 2} 142 ${BANNER_W} 82` },
      ...fill("sand", 0.55),
      stroke: 2,
    });
    for (let x = 50; x < BANNER_W; x += 100) {
      const top = round(sag(x));
      shapes.push(
        { tag: "circle", attrs: { cx: x, cy: top + 22, r: 26 }, ...fill("sun", 0.18) },
        {
          tag: "rect",
          attrs: { x: x - 9, y: top + 8, width: 18, height: 28, rx: 7 },
          ...fill("sun", 0.95),
        },
        {
          tag: "rect",
          attrs: { x: x - 6, y: top + 4, width: 12, height: 5, rx: 2 },
          ...fill("sand", 0.9),
        },
      );
    }
  } else {
    // A grove: soft leaf hills under a sun, and sprigs of leaves.
    shapes.push(
      backdrop("leaf", 0.3),
      { tag: "circle", attrs: { cx: 470, cy: 58, r: 30 }, ...fill("sun", 0.75) },
      {
        tag: "path",
        attrs: {
          d: `M0 128 Q150 88 300 122 T${BANNER_W} 112 L${BANNER_W} ${BANNER_H} L0 ${BANNER_H} Z`,
        },
        ...fill("leaf", 0.55),
      },
      {
        tag: "path",
        attrs: {
          d: `M0 160 Q200 128 380 158 T${BANNER_W} 150 L${BANNER_W} ${BANNER_H} L0 ${BANNER_H} Z`,
        },
        ...fill("leaf", 0.85),
      },
    );
    for (const [x, y, turn] of [
      [70, 60, -30],
      [190, 40, 20],
      [330, 64, -10],
      [560, 92, 30],
    ] as const) {
      shapes.push(
        {
          tag: "path",
          attrs: {
            d: `M${x} ${y} q12 -16 24 0 q-12 16 -24 0 Z`,
            transform: `rotate(${turn} ${x} ${y})`,
          },
          ...fill("leaf", 0.9),
        },
        {
          tag: "path",
          attrs: {
            d: `M${x} ${y} q-12 -16 -24 0 q12 16 24 0 Z`,
            transform: `rotate(${turn} ${x} ${y})`,
          },
          ...fill("sun", 0.55),
        },
      );
    }
  }
  return shapes;
}

const SVG_NS = "http://www.w3.org/2000/svg";

/** The banner as an SVG that covers its box. Decorative, so hidden from screen readers. */
export function bannerArt(id: string, color: ResidentColor): SVGSVGElement {
  const { motif, shapes } = bannerShapes(id, color);
  return drawBanner(shapes, motif);
}

/** A partner profile design's header art, drawn like any banner. */
export function designArt(design: ProfileDesign): SVGSVGElement {
  return drawBanner(designShapes(design), design);
}

function drawBanner(shapes: readonly BannerShape[], motif: string): SVGSVGElement {
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
