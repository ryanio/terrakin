/**
 * Pictures of pets (RFC 0019): each kind awake and asleep, as SVG shapes in a 48 by 48 box, facing
 * right, colored from its coat. Presentation only, like the world's palette: no rule reads any of
 * it. It lives here so the map (`packages/client/src/render.ts`), the adopt sheet and profiles
 * (through `packages/ui/src/pet-art.ts`), and the plot photos drawn at the edge (`packages/cards/`,
 * through `packages/server/src/plot-photo.ts`) all draw the same pet (decision 0035).
 *
 * Every attribute is a number, a hex color, a path made of numbers, or one of a few fixed words,
 * so the shapes can cross to the edge renderer as data and be checked there.
 */

import type { PetCoat, PetKind } from "./pets";
import type { Tile } from "./types";
import type { Ground } from "./walk";

/** One shape: an SVG element by tag, its attributes, and a group's children. */
export interface PetShape {
  tag: "path" | "circle" | "ellipse" | "g";
  attrs: Record<string, string | number>;
  children?: PetShape[];
}

/** Awake (sitting or standing) or curled up asleep. */
export type PetPosture = "awake" | "asleep";
/** An awake pet's face: its eyes open, or happy (arcs and a blush). */
export type PetFace = "open" | "happy";

/** The side of the box every picture is drawn in. The ground is at y 42. */
export const PET_BOX = 48;

/** A coat's colors. `mark` is markings (stripes, spots, ear backs, a shell's plates). */
export interface PetColors {
  fur: string;
  /** Muzzle, chest, belly, and inner ears. */
  belly: string;
  mark: string;
  /** A second marking color: a calico's dark patches, a mallard's chest. */
  mark2?: string;
  /** A duck's bill and feet, a tortoise's skin. */
  bill?: string;
  /** Dark fur gets light eyes, so they show. */
  eyes?: string;
}

/** Each kind's coats, as colors. Keys follow `PET_COATS`. */
export const PET_PALETTE: { readonly [K in PetKind]: Record<string, PetColors> } = {
  cat: {
    ginger: { fur: "#eb9a52", belly: "#fde7c8", mark: "#c8692c" },
    tabby: { fur: "#a9a39a", belly: "#efe9de", mark: "#6c665f" },
    black: { fur: "#3d3840", belly: "#f6f0e6", mark: "#2a252c", eyes: "#d9e27a" },
    calico: { fur: "#fbf4e8", belly: "#fffaf2", mark: "#eb9a52", mark2: "#4a4249" },
  },
  dog: {
    golden: { fur: "#e3b46b", belly: "#f8e3bb", mark: "#c58a40" },
    chocolate: { fur: "#7d4e31", belly: "#b27c55", mark: "#5a3520", eyes: "#f0dcc0" },
    spotted: { fur: "#fbf7f0", belly: "#fffcf6", mark: "#3e3842" },
    cream: { fur: "#efdfc0", belly: "#fbf2e0", mark: "#d4b98e" },
  },
  rabbit: {
    brown: { fur: "#ad8560", belly: "#ecdcc4", mark: "#8a6343" },
    white: { fur: "#f8f4ee", belly: "#fffdf9", mark: "#e4d6cc" },
    grey: { fur: "#a6a19b", belly: "#e9e4dd", mark: "#86817b" },
    patched: { fur: "#fbf6ee", belly: "#fffdf8", mark: "#5e4b3e" },
  },
  hedgehog: {
    brown: { fur: "#8d6748", belly: "#ecd3ad", mark: "#5c4231" },
    cream: { fur: "#d8be93", belly: "#f8eacf", mark: "#b59a70" },
    grey: { fur: "#8e8982", belly: "#e7e0d3", mark: "#5f5a54" },
    cinnamon: { fur: "#b9763f", belly: "#f4d6b2", mark: "#8a5328" },
  },
  duck: {
    white: { fur: "#fbf8f2", belly: "#fffdf8", mark: "#e6ddd0", bill: "#f2a33a" },
    yellow: { fur: "#f7d44c", belly: "#fbe48a", mark: "#e9bb2c", bill: "#ec8f2c" },
    mallard: {
      fur: "#bcae9a",
      belly: "#d9cfc0",
      mark: "#2f7a52",
      mark2: "#8c5a3c",
      bill: "#e9c23c",
    },
    brown: { fur: "#a47c55", belly: "#c9a47c", mark: "#7d5a3a", bill: "#e3a43f" },
  },
  frog: {
    green: { fur: "#6dab50", belly: "#d9eaa8", mark: "#4c8735" },
    gold: { fur: "#e8b93c", belly: "#f8e5a2", mark: "#c49322" },
    blue: { fur: "#4f87c7", belly: "#bfd7f0", mark: "#223f73" },
    spotted: { fur: "#8cc05b", belly: "#e4f0c6", mark: "#3e6a2b" },
  },
  fox: {
    red: { fur: "#df7a3c", belly: "#fdf3e4", mark: "#3e2c26" },
    arctic: { fur: "#f6f3ee", belly: "#ffffff", mark: "#c7c0b6" },
    silver: { fur: "#726e74", belly: "#ece9e6", mark: "#38353a", eyes: "#f1d77c" },
    sand: { fur: "#e6c38e", belly: "#faeed8", mark: "#c4955a" },
  },
  tortoise: {
    olive: { fur: "#7d8e48", belly: "#c3b48c", mark: "#a4b462", bill: "#b9a57e" },
    amber: { fur: "#c4883a", belly: "#cfba8f", mark: "#e3b363", bill: "#c6ae84" },
    slate: { fur: "#6c7176", belly: "#bdb29b", mark: "#91979b", bill: "#ab9f88" },
    star: { fur: "#3e3a33", belly: "#c8b68c", mark: "#e8c45a", bill: "#c4b08a" },
  },
};

/** A coat's colors. An unknown coat (never from the sim) gets its kind's first. */
export function petColors(kind: PetKind, coat: PetCoat | string): PetColors {
  const coats = PET_PALETTE[kind];
  return coats[coat] ?? (Object.values(coats)[0] as PetColors);
}

// ---------- ink, as the brand tokens have it (packages/ui/src/brand.ts) ----------

const INK = "#2b2620";
const LINE = "#5a5146";
const PINK = "#e48a8f";
const BLUSH = "#f28a8a";

// ---------- shape builders ----------

type Attrs = Record<string, string | number>;

const OUT: Attrs = { stroke: LINE, "stroke-width": 1.3, "stroke-linejoin": "round" };
const out = (more: Attrs = {}): Attrs => ({ ...OUT, ...more });

const path = (d: string, fill: string, extra: Attrs = {}): PetShape => ({
  tag: "path",
  attrs: { d, fill, ...extra },
});
const stroke = (d: string, color: string, width: number, extra: Attrs = {}): PetShape => ({
  tag: "path",
  attrs: {
    d,
    fill: "none",
    stroke: color,
    "stroke-width": width,
    "stroke-linecap": "round",
    "stroke-linejoin": "round",
    ...extra,
  },
});
const circle = (cx: number, cy: number, r: number, fill: string, extra: Attrs = {}): PetShape => ({
  tag: "circle",
  attrs: { cx, cy, r, fill, ...extra },
});
const ellipse = (
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  fill: string,
  extra: Attrs = {},
): PetShape => ({ tag: "ellipse", attrs: { cx, cy, rx, ry, fill, ...extra } });

/** A thick stroke with an outline: a tail, drawn twice, ink under fur. */
const tail = (d: string, color: string, width: number): PetShape[] => [
  stroke(d, LINE, width + 2.4),
  stroke(d, color, width),
];

const shadow = (rx: number, cx = 24): PetShape => ellipse(cx, 43, rx, 2.5, INK, { opacity: 0.14 });

/** One eye: open with a glint, a happy arc, or shut. */
function eye(cx: number, cy: number, look: PetFace | "shut", c: PetColors, r = 1.45): PetShape[] {
  if (look === "happy") {
    return [stroke(`M${cx - 1.5} ${cy + 0.5}q1.5 -2.1 3 0`, INK, 1.15)];
  }
  if (look === "shut") {
    return [stroke(`M${cx - 1.5} ${cy}q1.5 1.5 3 0`, INK, 1.05)];
  }
  return [
    ...(c.eyes ? [ellipse(cx, cy, r * 1.25, r * 1.4, c.eyes)] : []),
    ellipse(cx, cy, r * 0.85, r, INK),
    circle(cx + r * 0.3, cy - r * 0.4, r * 0.32, "#ffffff"),
  ];
}

const blush = (cx: number, cy: number, face: PetFace | "shut"): PetShape[] =>
  face === "happy" ? [ellipse(cx, cy, 1.7, 1, BLUSH, { opacity: 0.55 })] : [];

/** Short curved strokes, for tabby stripes, spines, and a shell's star. */
const marks = (d: string, color: string, width = 1.1): PetShape => stroke(d, color, width);

/** Spots: ellipses as `[cx, cy, rx, ry]`. */
const spots = (list: readonly (readonly [number, number, number, number])[], fill: string) =>
  list.map(([cx, cy, rx, ry]) => ellipse(cx, cy, rx, ry, fill));

// ---------- cat ----------

function cat(c: PetColors, coat: string, pose: PetPosture, face: PetFace): PetShape[] {
  const striped = coat === "ginger" || coat === "tabby";
  const socks = coat === "black" ? c.belly : c.fur;
  if (pose === "asleep") {
    return [
      shadow(15),
      path("M9 41.5C8 33.5 14.6 29 24 29s16 4.5 15 12.5z", c.fur, out()),
      ...(striped
        ? [marks("M15.5 33.2q1.6 2 1.2 4.4M20 31q1.6 2.2 1.2 4.6M24.6 30.4q1.4 2.4.8 4.8", c.mark)]
        : []),
      ...(coat === "calico"
        ? [
            path("M12.4 37.4c.6-3.6 4-6 7.6-5.4-.4 3.6-3.6 6.2-7.6 5.4z", c.mark2 ?? c.mark),
            path("M20.6 31.2c2.6-1.4 6-1.2 7.4.6-2.4 1.4-5.4 1.4-7.4-.6z", c.mark),
          ]
        : []),
      ...tail("M11.4 40.6C16 44.6 29.4 44.6 35.6 40.2", c.fur, 3.2),
      path("M27 31.4l1-5.6 3.6 3.8zM33.2 29.2l3.8-3.6 1 5.6z", c.fur, out()),
      path("M28.2 29.8l.5-2.6 1.6 1.7zM34.6 28.6l1.7-1.6.4 2.6z", PINK),
      ellipse(32.4, 34.4, 7.2, 6.2, c.fur, out()),
      ...(striped ? [marks("M30.4 28.8q.6 1.4 0 2.6M33 28.6q.5 1.4-.1 2.6", c.mark)] : []),
      ...(coat === "calico"
        ? [path("M26.2 33.6c.4-2.4 2.2-4 4.6-4.2-.2 2.2-2 3.8-4.6 4.2z", c.mark)]
        : []),
      ellipse(33.6, 37.4, 2.6, 1.8, c.belly),
      path("M32.8 36.4h1.6l-.8 1z", PINK),
      ...eye(30, 34.2, "shut", c),
      ...eye(35.6, 34.2, "shut", c),
    ];
  }
  return [
    shadow(12),
    ...tail("M15.4 40C8.6 40.4 6.4 33.4 9.8 28.6", c.fur, 3.4),
    ...(striped ? [marks("M8.6 31.2l2.2.8M9 34.8l2.2-.2", c.mark, 1)] : []),
    path("M14.6 41.6C13.6 34 16 27.6 22.6 27s9 6 8.4 14.6z", c.fur, out()),
    ...(striped ? [marks("M16.6 31.4q2 .6 3.2 2.4M15.8 35.2q2 .4 3.2 2.2", c.mark, 1.2)] : []),
    ...(coat === "calico"
      ? [
          path("M15.2 34.4c1.4-3 4.4-4.4 6.8-3.2-.6 3-3.6 4.8-6.8 3.2z", c.mark2 ?? c.mark),
          path("M17 39.6c.4-2 2.4-3.4 4.4-3-.2 2-2.2 3.4-4.4 3z", c.mark),
        ]
      : []),
    ellipse(26.6, 34.4, 3.6, 5.2, c.belly),
    ellipse(24.6, 41.2, 2.4, 1.6, socks, out({ "stroke-width": 1 })),
    ellipse(29, 41.2, 2.4, 1.6, socks, out({ "stroke-width": 1 })),
    path("M21.6 17.4l1-8 5 4.8zM30.6 13.4l5.2-4.2 1.2 8z", c.fur, out()),
    path("M22.9 15.6l.5-4 2.6 2.5zM32 13.8l3-2.2.6 4z", PINK),
    ellipse(29, 21, 9.2, 8.2, c.fur, out()),
    ...(striped
      ? [marks("M27.4 13.4q.6 1.6 0 3M30 13.1q.4 1.6-.2 3.2M24.2 15q1.2 1 1.2 2.6", c.mark)]
      : []),
    ...(coat === "calico"
      ? [
          path("M20.6 19.8c.6-3.6 3.4-6.2 7-6.4-.4 3.4-3.2 6-7 6.4z", c.mark),
          path("M32.8 14.2c2.4.4 4.4 2.4 4.8 4.8-2.4-.2-4.4-2.2-4.8-4.8z", c.mark2 ?? c.mark),
        ]
      : []),
    ellipse(31.4, 24.6, 3.4, 2.4, c.belly),
    path("M30.6 22.9h2l-1 1.2z", PINK),
    stroke("M31.6 24.1v.8M31.6 24.9q-.9.8-1.7.1M31.6 24.9q.9.8 1.7.1", INK, 0.7),
    stroke("M34.8 24.2l3.6-.9M34.8 25.2l3.6.5M27.8 24.4l-3.4-.6", LINE, 0.5, { opacity: 0.6 }),
    ...eye(27.2, 20.4, face, c),
    ...eye(33.4, 20.4, face, c),
    ...blush(25.6, 24, face),
    ...blush(35.4, 23.6, face),
  ];
}

// ---------- dog ----------

function dog(c: PetColors, coat: string, pose: PetPosture, face: PetFace): PetShape[] {
  const spotted = coat === "spotted";
  if (pose === "asleep") {
    return [
      shadow(15),
      path("M9 41.5C8 33.5 14.6 29 24 29s16 4.5 15 12.5z", c.fur, out()),
      ...(spotted
        ? spots(
            [
              [15, 35, 2.4, 2],
              [20.6, 32, 1.8, 1.5],
              [17, 39.4, 1.6, 1.3],
            ],
            c.mark,
          )
        : []),
      ...tail("M11.4 39.8C14.6 43.6 22 44.4 27 43", c.fur, 3),
      ellipse(31.4, 34.6, 7, 6, c.fur, out()),
      ellipse(36.8, 37.4, 3.8, 2.8, c.belly, out({ "stroke-width": 1 })),
      ellipse(40, 36.4, 1.3, 1, INK),
      path("M26.6 31c-2.4.8-3 5.4-1.2 7.6 2.2-1 3.4-4.4 3.2-7.2z", c.mark, out()),
      ...(spotted ? spots([[33.4, 30.6, 1.6, 1.2]], c.mark) : []),
      ...eye(31, 33.8, "shut", c),
      ...eye(35.8, 33.4, "shut", c),
    ];
  }
  return [
    shadow(12.5),
    ...tail("M16 37.4C11.4 35.6 10.4 30.8 12.4 26.8", c.fur, 3.2),
    path("M14 41.6C13 33.6 16 27.6 22.6 27s9.8 6 9.4 14.6z", c.fur, out()),
    ...(spotted
      ? spots(
          [
            [18, 33, 2.4, 2],
            [21.4, 38.2, 1.8, 1.5],
            [16.6, 38.6, 1.4, 1.2],
          ],
          c.mark,
        )
      : []),
    ellipse(27, 34.6, 3.8, 5.4, c.belly),
    ellipse(24.6, 41.2, 2.6, 1.7, c.fur, out({ "stroke-width": 1 })),
    ellipse(29.6, 41.2, 2.6, 1.7, c.fur, out({ "stroke-width": 1 })),
    ellipse(28.4, 20.6, 8.8, 8, c.fur, out()),
    ...(spotted ? spots([[25.6, 15.6, 1.9, 1.5]], c.mark) : []),
    ellipse(35, 23.4, 4.6, 3.4, c.belly, out({ "stroke-width": 1.1 })),
    ellipse(38.6, 21.8, 1.6, 1.2, INK),
    stroke("M38 23.9q-1.6 1.4-3.2.4", INK, 0.75),
    ...(face === "happy" ? [path("M35.4 24.6q.5 2.6 1.9.3z", PINK)] : []),
    path("M22.4 14.6c-4 .6-4.8 8-2 11 3-1.2 4.2-6.6 4-10z", c.mark, out()),
    path("M30.6 13.2c2.8-1 5.2 2 4.2 5-2-.8-3.8-2.6-4.2-5z", c.mark, out()),
    ...eye(27.4, 19.8, face, c),
    ...eye(32.2, 19.4, face, c),
    ...blush(25.4, 23.2, face),
  ];
}

// ---------- rabbit ----------

function rabbit(c: PetColors, coat: string, pose: PetPosture, face: PetFace): PetShape[] {
  const patched = coat === "patched";
  if (pose === "asleep") {
    return [
      shadow(14),
      circle(10.6, 37.8, 3, c.belly, out()),
      path("M10 41.5C9.4 34 15 30 23 30s14.4 4 14 11.5z", c.fur, out()),
      ...(patched ? [path("M10.6 38c.6-4 4.4-6.6 8.6-6.4-.2 4.2-4 7.2-8.6 6.4z", c.mark)] : []),
      path("M27.6 31c-4.4-2-9.6-2.2-13.6-.8 4 2.4 9.4 2.8 13.6.8z", c.fur, out()),
      path(
        "M29.4 30.4c-4.6-3.2-10-4.4-14.4-3.4 3.6 3.4 9.6 4.8 14.4 3.4z",
        patched ? c.mark : c.fur,
        out(),
      ),
      ellipse(31.4, 35.4, 6.6, 5.8, c.fur, out()),
      ...(patched ? [path("M27 33.6c.4-2.4 2.2-4 4.6-4-.2 2.4-2 4-4.6 4z", c.mark)] : []),
      ellipse(33.4, 37.6, 2.4, 1.8, c.belly),
      ellipse(35.6, 36.6, 0.9, 0.7, PINK),
      ...eye(31.4, 34.6, "shut", c),
    ];
  }
  return [
    shadow(11.5),
    circle(15.4, 37.4, 3.1, c.belly, out()),
    path("M15.6 41.6C14 34 17.6 28.4 23 28.4s8.4 5.6 7.6 13.2z", c.fur, out()),
    ...(patched ? [path("M15.8 39c-.2-4.4 2.6-8 6.6-8.6.4 4.6-2.4 8-6.6 8.6z", c.mark)] : []),
    ellipse(19.6, 37.6, 5, 4.2, patched ? c.mark : c.fur, out({ "stroke-width": 1 })),
    ellipse(22.4, 41.4, 4.2, 1.6, c.fur, out({ "stroke-width": 1 })),
    ellipse(27, 35, 3, 4.6, c.belly),
    ellipse(28.6, 41.2, 2, 1.5, c.fur, out({ "stroke-width": 1 })),
    path("M25 17C22.6 12 22.6 5.6 25 4c2.6 1.6 3 7.6 2.6 12.6z", patched ? c.mark : c.fur, out()),
    path("M25.6 15.4c-1.2-3.8-1-7.8-.2-8.8 1.2 1.4 1.4 5.2 1.2 8.8z", PINK),
    path(
      "M29.6 16.4c-.2-5.4 1-11.4 3.8-12.6 1.8 2.2.6 8.2-1.2 12.8z",
      patched ? c.mark : c.fur,
      out(),
    ),
    path("M30.6 15.6c0-3.8.8-8 2.6-9.6.8 1.8.2 6.2-1.2 9.8z", PINK),
    ellipse(29, 22.6, 7.6, 7, c.fur, out()),
    ...(patched
      ? [path("M25.4 26.6c-2.4-1.2-3.6-4.6-2.4-7.4 2.6.6 4.2 3.6 2.4 7.4z", c.mark)]
      : []),
    ellipse(32.8, 25.2, 2.6, 1.9, c.belly),
    ellipse(34.8, 24.2, 0.95, 0.75, PINK),
    stroke("M34.6 25q-.7.9-1.4.4", INK, 0.65),
    ...eye(27.6, 21.6, face, c),
    ...eye(32.2, 21.4, face, c),
    ...blush(25.8, 25, face),
  ];
}

// ---------- hedgehog ----------

/** A spiky dome over an ellipse's top: `n` spines between two angles, in degrees from east. */
function spines(
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  from: number,
  to: number,
  n: number,
  len: number,
): string {
  const at = (deg: number, grow: number) => {
    const a = (deg * Math.PI) / 180;
    const x = cx + Math.cos(a) * (rx + grow);
    const y = cy - Math.sin(a) * (ry + grow);
    return `${Math.round(x * 100) / 100} ${Math.round(y * 100) / 100}`;
  };
  const step = (to - from) / n;
  let d = `M${at(from, 0)}`;
  for (let i = 0; i < n; i++) {
    d += `L${at(from + step * (i + 0.5), len)}L${at(from + step * (i + 1), 0)}`;
  }
  return d;
}

function hedgehog(c: PetColors, _coat: string, pose: PetPosture, face: PetFace): PetShape[] {
  if (pose === "asleep") {
    return [
      shadow(13),
      path(`${spines(23, 34, 11.6, 8.6, -20, 200, 15, 3.2)}z`, c.fur, out()),
      marks(
        "M15 33l2-3M19 30l1.8-3.2M23.4 29.4l1.4-3.4M27.6 30.2l1-3.4M16.8 37.6l2-2.4M22 35l1.6-2.8",
        c.mark,
      ),
      path(
        "M28 38.6c2.4-2.2 6.6-2.6 9.4-.8-1.6 2.6-6.4 4-9.4.8z",
        c.belly,
        out({ "stroke-width": 1.1 }),
      ),
      circle(37.4, 37.6, 0.95, INK),
      ...eye(31.6, 38.2, "shut", c),
    ];
  }
  return [
    shadow(12.5),
    ellipse(17.6, 41.8, 2.2, 1.4, c.mark),
    ellipse(26.6, 42, 2.2, 1.4, c.mark),
    ellipse(22.6, 39.6, 10.4, 2.8, c.belly, out({ "stroke-width": 1 })),
    path(`${spines(22, 38.6, 13, 9.8, 4, 186, 13, 3.6)}z`, c.fur, out()),
    marks(
      "M14.6 34.6l2-3.2M18.6 31.6l1.8-3.4M23 30.6l1.4-3.6M27.4 31.4l1-3.4M15.8 39.2l2.2-2.6M21 36.2l1.8-3",
      c.mark,
    ),
    path("M29.4 32.8c3.2-1.2 7.8 1.4 9.6 4.8-2 2.4-6.6 3.4-9.6 2.2z", c.belly, out()),
    circle(39.2, 37.6, 1.15, INK),
    circle(31.2, 33, 1.5, c.belly, out({ "stroke-width": 1 })),
    stroke("M38.2 38.8q-1.2.9-2.4.4", INK, 0.7),
    ...eye(34, 35.4, face, c, 1.3),
    ...blush(34.6, 37.8, face),
  ];
}

// ---------- duck ----------

function duck(c: PetColors, coat: string, pose: PetPosture, face: PetFace): PetShape[] {
  const mallard = coat === "mallard";
  const bill = c.bill ?? "#f2a33a";
  const head = mallard ? c.mark : c.fur;
  if (pose === "asleep") {
    return [
      shadow(13.5),
      path("M8.6 31l-3.6-2.8 3.4 5.6z", c.fur, out({ "stroke-width": 1.1 })),
      path(
        "M8.4 33.6C8.4 28.4 13.4 26 19.6 26.4s15.4 3 15.4 8.4-6 7-13.8 7S8.4 38.6 8.4 33.6z",
        c.fur,
        out(),
      ),
      ...(mallard
        ? [path("M30.4 31.6c2.6.8 4.4 2.4 4.6 4.2-2.4.4-4.6-1.4-4.6-4.2z", c.mark2 ?? c.mark)]
        : []),
      path(
        "M13.6 33.4c3.4-3 10.4-2.6 13.4 1.4-4 3.2-10 3.2-13.4-1.4z",
        c.mark,
        out({ "stroke-width": 1 }),
      ),
      circle(27.2, 28.8, 5.6, head, out()),
      path("M22.6 30.4c-2.6.2-4.4 1-4.6 2 1.6.8 3.6.8 5.4.2z", bill, out({ "stroke-width": 1 })),
      ...(mallard ? [stroke("M24.6 33.6q2.8 1.4 5.8-.2", "#ffffff", 1.1)] : []),
      ...eye(28.4, 28, "shut", c),
    ];
  }
  return [
    shadow(11),
    path("M20 41l-1.8 1.8h4zM25.2 41l-1.8 1.8h4z", bill),
    path("M12.6 31l-4.4-3.4 4.2 6.6z", c.fur, out({ "stroke-width": 1.1 })),
    path("M12 33c0-5 5-7 10-6s9 4 11 6c0 5.6-5 8.2-12 8.2-6 0-9-3.2-9-8.2z", c.fur, out()),
    ...(mallard
      ? [path("M27.6 28.8c3 .6 5.2 2.4 5.4 4.4-3 .6-5.4-1.6-5.4-4.4z", c.mark2 ?? c.mark)]
      : []),
    path(
      "M15.8 32.2c3-2.8 9.4-2.6 11.8.8-3.4 3.2-9 3.2-11.8-.8z",
      c.mark,
      out({ "stroke-width": 1 }),
    ),
    ...(mallard
      ? [path("M19.8 33.2l4.4-.4", "none", { stroke: "#3f6fb0", "stroke-width": 1.4 })]
      : []),
    path("M26.8 25.6c.8-2 6.6-2 7.2.6l-2.4 4-4.2-1z", head),
    circle(30.4, 21.4, 6.4, head, out()),
    ...(mallard ? [stroke("M26.8 26.4q3.2 1.6 6.6.2", "#ffffff", 1.2)] : []),
    path("M35.4 20.8c4-.4 6.6.8 6.6 2s-2.6 1.8-6.6 1.4z", bill, out({ "stroke-width": 1.1 })),
    stroke("M36 22.6h4.4", LINE, 0.6, { opacity: 0.6 }),
    ...eye(32, 19.6, face, c, 1.35),
    ...blush(33, 23, face),
  ];
}

// ---------- frog ----------

function frog(c: PetColors, coat: string, pose: PetPosture, face: PetFace): PetShape[] {
  const spotted = coat === "spotted" || coat === "blue";
  const back: [number, number, number, number][] = [
    [17, 32.4, 1.8, 1.4],
    [22.6, 30.6, 1.5, 1.2],
    [14.6, 36.4, 1.3, 1.1],
  ];
  if (pose === "asleep") {
    return [
      shadow(14),
      path("M9.6 41.4C9 35 15.4 31 24 31s15.4 4 14.6 10.4z", c.fur, out()),
      ...(spotted
        ? spots(
            back.map(([x, y, rx, ry]) => [x, y + 2, rx, ry] as const),
            c.mark,
          )
        : []),
      ellipse(25, 39, 8, 2.8, c.belly),
      circle(21.4, 31.6, 3.4, c.fur, out()),
      circle(29.6, 31.4, 3.4, c.fur, out()),
      ...eye(21.4, 31.4, "shut", c),
      ...eye(29.6, 31.2, "shut", c),
      stroke("M22 36q4.4 2 9-.4", LINE, 0.9),
    ];
  }
  return [
    shadow(13),
    ellipse(16, 38, 5.6, 4.4, c.fur, out()),
    path("M11.6 41.8h7.6l1.6-1.4", c.fur, out({ "stroke-width": 1 })),
    path("M11 41C10 33 16 27.6 24 27.6S38 33 37 41z", c.fur, out()),
    ...(spotted ? spots(back, c.mark) : []),
    ellipse(26.6, 36.6, 7, 4.4, c.belly),
    ellipse(27.4, 41.2, 2.2, 1.3, c.fur, out({ "stroke-width": 1 })),
    ellipse(33, 41, 2.2, 1.3, c.fur, out({ "stroke-width": 1 })),
    circle(21.6, 26.6, 3.9, c.fur, out()),
    circle(29.8, 25.8, 3.9, c.fur, out()),
    ...eye(21.8, 26.4, face, c, 1.8),
    ...eye(30, 25.6, face, c, 1.8),
    stroke("M22.4 32.4q6 3.6 12.6-.6", LINE, 1),
    ...blush(21, 31.4, face),
    ...blush(34, 30.6, face),
  ];
}

// ---------- fox ----------

function fox(c: PetColors, _coat: string, pose: PetPosture, face: PetFace): PetShape[] {
  if (pose === "asleep") {
    return [
      shadow(15),
      path("M9 41.5C8 33.5 14.6 29 24 29s16 4.5 15 12.5z", c.fur, out()),
      path("M27.4 31.4l.8-6.4 4.2 4.4zM33.4 29.2l4.4-4 .8 6.4z", c.fur, out()),
      path("M28.4 29.8l.4-3 1.8 1.9zM34.8 28.4l2-1.8.4 3z", c.mark),
      ellipse(32, 34.6, 7, 6, c.fur, out()),
      ...eye(29.6, 34, "shut", c),
      ...eye(34.6, 33.6, "shut", c),
      path(
        "M10.4 39.4C14 45.4 31 45.8 39.6 40.6c1.4-.8 1.6-3.4.2-3.8-7.4 3-19.4 3.6-29.4 2.6z",
        c.fur,
        out(),
      ),
      path("M33.6 41.8c2.6-.6 4.8-1.4 6.2-2.4.8-.6.8-2.2 0-2.6-2 1.4-4.2 2.4-6.6 3z", c.belly),
    ];
  }
  return [
    shadow(12.5),
    path("M16 40.4C7 41.4 4 32.4 9 26c2 5 5 9 10 10.6z", c.fur, out()),
    path("M9 26c-2.4 3-2.2 6-.6 8 1.2-3 1.6-5.6.6-8z", c.belly),
    path("M14.6 41.6C13.6 34 16 27.6 22.6 27s9 6 8.4 14.6z", c.fur, out()),
    ellipse(27, 33.6, 4, 5.6, c.belly),
    ellipse(24.6, 41.2, 2.4, 1.6, c.mark, out({ "stroke-width": 1 })),
    ellipse(29.2, 41.2, 2.4, 1.6, c.mark, out({ "stroke-width": 1 })),
    path("M21.4 17.6L22 7.8l5.6 5.8zM30.2 13l6.2-5.4.4 9.8z", c.fur, out()),
    path("M22.6 15.6l.4-5.4 3 3.2zM31.8 12.8l3.6-3 .2 5.4z", c.mark),
    ellipse(28.4, 21.2, 8.4, 7.6, c.fur, out()),
    ellipse(27.4, 25, 3.2, 2.4, c.belly),
    path(
      "M31 22.4c3-1 7.6.2 9.4 2.2-2.4 2-6.8 2.6-9.8 1.4z",
      c.belly,
      out({ "stroke-width": 1.1 }),
    ),
    circle(40.2, 24.4, 1.1, INK),
    stroke("M39.4 25.6q-1.4 1-3 .5", INK, 0.7),
    ...eye(26.8, 19.8, face, c),
    ...eye(32, 19.4, face, c),
    ...blush(24.8, 23.4, face),
  ];
}

// ---------- tortoise ----------

/** Plates on a shell: a hexagon at (x, y), `r` across. */
function plate(x: number, y: number, r: number): string {
  const pts: string[] = [];
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 3) * i + Math.PI / 6;
    pts.push(
      `${Math.round((x + Math.cos(a) * r) * 100) / 100} ${Math.round((y + Math.sin(a) * r * 0.82) * 100) / 100}`,
    );
  }
  return `M${pts.join("L")}z`;
}

/** A star tortoise's rays on one plate. */
function rays(x: number, y: number, r: number): string {
  let d = "";
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 3) * i;
    d += `M${x} ${y}l${Math.round(Math.cos(a) * r * 100) / 100} ${Math.round(Math.sin(a) * r * 82) / 100}`;
  }
  return d;
}

function tortoise(c: PetColors, coat: string, pose: PetPosture, face: PetFace): PetShape[] {
  const skin = c.bill ?? c.belly;
  const star = coat === "star";
  const plates: [number, number, number][] = [
    [18, 30.6, 3.8],
    [25.4, 28.8, 3.8],
    [32, 31.2, 3.6],
    [21.6, 35.4, 3.2],
    [28.8, 35.4, 3.2],
  ];
  const shell = (dx: number): PetShape[] => [
    path(
      `M${10 + dx} 37.4C${10 + dx} 27.4 ${17 + dx} 22.4 ${24.4 + dx} 22.4S${39 + dx} 27.4 ${39 + dx} 37.4z`,
      c.fur,
      out(),
    ),
    ...plates.map(([x, y, r]) =>
      star
        ? stroke(rays(x + dx, y, r * 0.9), c.mark, 0.9)
        : path(plate(x + dx, y, r), c.mark, { stroke: LINE, "stroke-width": 0.6, opacity: 0.9 }),
    ),
    path(`M${9.4 + dx} 36.4h30.2v2q-15.1 2.4-30.2 0z`, c.mark, out({ "stroke-width": 1 })),
  ];
  if (pose === "asleep") {
    return [
      shadow(14.5, 24.4),
      ellipse(13.4, 40.6, 2.4, 1.6, skin, out({ "stroke-width": 1 })),
      ellipse(35.4, 40.6, 2.4, 1.6, skin, out({ "stroke-width": 1 })),
      ...shell(0),
      path("M38.4 37.6c1.6-.4 2.8.4 2.8 1.6s-1.2 1.8-2.8 1.4z", skin, out({ "stroke-width": 1 })),
      ...eye(39.6, 38.8, "shut", c, 1),
    ];
  }
  return [
    shadow(14.5, 25),
    path("M10 36.8l-2.6 1.4 2.6.8z", skin),
    ellipse(14.4, 40.4, 2.6, 2.4, skin, out({ "stroke-width": 1 })),
    ellipse(34, 40.4, 2.6, 2.4, skin, out({ "stroke-width": 1 })),
    path("M36.4 33.6c1.6-1.4 3.6-1.6 4.6-1.4l.6 4.6c-1.4.8-3.6 1-5.2.2z", skin, out()),
    ...shell(0),
    ellipse(20.6, 41, 2.4, 2, skin, out({ "stroke-width": 1 })),
    ellipse(28.2, 41, 2.4, 2, skin, out({ "stroke-width": 1 })),
    ellipse(41.6, 31.6, 4.2, 3.5, skin, out()),
    stroke("M44.6 33q-1.4 1-2.8.5", INK, 0.7),
    ...eye(42.4, 30.8, face, c, 1.25),
    ...blush(42, 33.4, face),
  ];
}

const DRAW: Record<
  PetKind,
  (c: PetColors, coat: string, pose: PetPosture, face: PetFace) => PetShape[]
> = { cat, dog, rabbit, hedgehog, duck, frog, fox, tortoise };

/** The shapes of one pet picture, back to front, in a 48 by 48 box, facing right. Pure. */
export function petShapes(
  kind: PetKind,
  coat: PetCoat | string,
  pose: PetPosture = "awake",
  face: PetFace = "open",
): PetShape[] {
  return DRAW[kind](petColors(kind, coat), coat, pose, face);
}

/**
 * Where a pet sleeps: the first open tile east, west, south, or north of its owner's hearth, or the
 * hearth itself when it's walled in. The map, the 3D world, and plot photos all put it there.
 */
export function petBed(ground: Ground, hearth: Tile): Tile {
  const { width, height } = ground.config;
  for (const [dx, dy] of [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ] as const) {
    const x = hearth.x + dx;
    const y = hearth.y + dy;
    if (x >= 0 && y >= 0 && x < width && y < height && !ground.obstacle(x, y)) return { x, y };
  }
  return { x: hearth.x, y: hearth.y };
}
