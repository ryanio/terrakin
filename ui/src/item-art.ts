/**
 * Little storybook pictures of things: every item you can hold and every piece of wear. Drawn with
 * code (decision 0035): `itemShapes` is pure data, so tests can check it, and `itemArt` builds it
 * into an SVG with `createElementNS`, never markup from a string.
 *
 * Most items are drawn from their look in the sim's catalog (RFC 0018): produce from its outline,
 * what grows on top, and its colors; a seed packet from the crop it grows; a jar from what fills it
 * and what's on its label. Decor, furniture, the pantry's staples, made goods without a template,
 * and wear have their own drawings here, under their ids. Each picture sits in a 48 by 48 box on a
 * soft ground shadow. Colors come from the catalog, the brand tokens, and the sim's palette, so a
 * lantern here is the lantern in the world.
 */
import {
  BLOCK_COLORS,
  CATALOG,
  CROP_HEX,
  type Crop,
  growth,
  ITEM_KINDS,
  type ItemKind,
  type JarLook,
  type KindLook,
  onVine,
  type ProduceLook,
  WEAR_ITEMS,
  type WearItem,
} from "@terrakin/sim";

import { BRAND_HEX, WOOD_DARK } from "./brand";
import { mediaUrlOf, RESIDENT_COLOR_HEX } from "./looks";

/** Anything `itemArt` can draw: an item kind or a piece of wear. */
export type ArtKind = ItemKind | WearItem;

/** Every kind `itemArt` draws, items first. */
export const ART_KINDS: readonly ArtKind[] = [...ITEM_KINDS, ...WEAR_ITEMS];

export function isArtKind(value: unknown): value is ArtKind {
  return typeof value === "string" && (ART_KINDS as readonly string[]).includes(value);
}

/** One shape of a picture: an SVG element by tag, its attributes, and a group's children. */
export interface ArtShape {
  tag: "path" | "circle" | "ellipse" | "rect" | "g";
  attrs: Record<string, string | number>;
  children?: ArtShape[];
}

/** The side of the box every picture is drawn in. */
export const ART_BOX = 48;

/**
 * Each crop's color when it's ready to pick (its look's `body` in the catalog), how far along a
 * crop is, and whether it grows on a vine along the soil: the sim's palette, which the map and the
 * 3D views draw crops with, and plot photos too.
 */
export { CROP_HEX, growth, onVine };

// ---------- colors ----------

const INK = BRAND_HEX.ink;
const LINE = BRAND_HEX.inkSoft;
const PAPER = BRAND_HEX.paper;
const PAPER2 = BRAND_HEX.paper2;
const CLAY = BRAND_HEX.clay;
const CLAY_DEEP = BRAND_HEX.clayDeep;
const MOSS = BRAND_HEX.moss;
const MOSS_LIGHT = BRAND_HEX.mossLight;
const SUN = BRAND_HEX.sun;
const LEAF = "#6b9a4a";
const STEM = "#5f9a43";
const KRAFT = "#e6cfa3";
const GLASS = "#dcefee";
const LID = "#c9a25a";
const WOOD = "#9a6b43";
const STRAW = "#e8c878";
const STRAW_DEEP = "#c49a4c";
const WICKER = "#c9925a";
const LEATHER = "#9c6a3e";
const DENIM = "#5f86b5";
const SLICKER = "#f4c534";
const SLICKER_DEEP = "#d9a21c";
const CANOPY = "#e0604a";
const SKY = RESIDENT_COLOR_HEX.sky;
const ROSE = RESIDENT_COLOR_HEX.rose;
const PLUM = RESIDENT_COLOR_HEX.plum;
const DUSK = BRAND_HEX.dusk;

// ---------- shape builders ----------

type Extra = Record<string, string | number>;

/** A soft brown outline, thin enough to stay crisp at 28px. */
const OUT: Extra = { stroke: LINE, "stroke-width": 1.4, "stroke-linejoin": "round" };
const out = (more: Extra = {}): Extra => ({ ...OUT, ...more });

const path = (d: string, fill: string, extra: Extra = {}): ArtShape => ({
  tag: "path",
  attrs: { d, fill, ...extra },
});
const line = (d: string, stroke: string, width = 1.4, extra: Extra = {}): ArtShape => ({
  tag: "path",
  attrs: {
    d,
    fill: "none",
    stroke,
    "stroke-width": width,
    "stroke-linecap": "round",
    "stroke-linejoin": "round",
    ...extra,
  },
});
const circle = (cx: number, cy: number, r: number, fill: string, extra: Extra = {}): ArtShape => ({
  tag: "circle",
  attrs: { cx, cy, r, fill, ...extra },
});
const ellipse = (
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  fill: string,
  extra: Extra = {},
): ArtShape => ({ tag: "ellipse", attrs: { cx, cy, rx, ry, fill, ...extra } });
const rect = (
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
  fill: string,
  extra: Extra = {},
): ArtShape => ({ tag: "rect", attrs: { x, y, width: w, height: h, rx: r, fill, ...extra } });
const group = (transform: string, children: ArtShape[], extra: Extra = {}): ArtShape => ({
  tag: "g",
  attrs: { transform, ...extra },
  children,
});

/** The soft shadow every picture stands on. */
const shadow = (rx = 14, cy = 43): ArtShape => ellipse(24, cy, rx, 2.6, INK, { opacity: 0.13 });
/** A white shine. */
const shine = (cx: number, cy: number, rx: number, ry: number, turn = -30): ArtShape =>
  ellipse(cx, cy, rx, ry, "#ffffff", { opacity: 0.55, transform: `rotate(${turn} ${cx} ${cy})` });
/** A leaf from (x, y), `len` long, turned `turn` degrees (0 points right). */
const leaf = (x: number, y: number, len: number, turn: number, fill = LEAF): ArtShape =>
  path(
    `M${x} ${y}q${len * 0.5} ${-len * 0.38} ${len} 0q${-len * 0.5} ${len * 0.38} ${-len} 0z`,
    fill,
    { transform: `rotate(${turn} ${x} ${y})`, ...out({ "stroke-width": 1.1 }) },
  );

// ---------- produce, from its look ----------

type Paint = (body: string, detail: string) => ArtShape[];

const BERRY_SEEDS: readonly [number, number][] = [
  [19, 24],
  [25, 23],
  [30, 26],
  [17, 30],
  [23, 29],
  [29, 32],
  [21, 35],
  [26, 37],
];

/** Each produce outline: its skin in `body`, and its speckles, seeds, or ribs in `detail`. */
const SHAPES: Readonly<Record<ProduceLook["shape"], Paint>> = {
  // An oval with pointed ends, like a lemon, and a few speckles.
  oval: (body, detail) => [
    path("M8 28c0-8 7-13.5 16-13.5S40 20 40 28s-7 11.5-16 11.5S8 36 8 28z", body, out()),
    path("M8.2 27.2 5.5 28l2.8 1.1M39.8 27.2l2.7.8-2.7 1.1", body, out()),
    shine(18, 22, 5, 2.2),
    circle(31, 33, 0.9, detail),
    circle(27, 35, 0.9, detail),
  ],
  // A berry, seeds and all.
  berry: (body, detail) => [
    path(
      "M24 41.5c-9-4-14-11-13-18 .7-5 5.5-7.5 13-7 7.5-.5 12.3 2 13 7 1 7-4 14-13 18z",
      body,
      out(),
    ),
    ...BERRY_SEEDS.map(([x, y]) => ellipse(x, y, 0.9, 1.3, detail)),
    shine(17.5, 22, 3.2, 1.6),
  ],
  // Round, with two faint ribs.
  round: (body, detail) => [
    path("M24 16c9.5 0 15 5.5 15 12.5S33 41 24 41 9 35.5 9 28.5 14.5 16 24 16z", body, out()),
    line("M18 18.5c-1 4 0 8 2 11M30 18.5c1 4 0 8-2 11", detail, 1, { opacity: 0.6 }),
    shine(16.5, 23.5, 3.6, 1.8),
  ],
  // Three ribbed lobes, like a pumpkin.
  lobed: (body, detail) => [
    ellipse(15.5, 31, 9, 10.5, body, out()),
    ellipse(32.5, 31, 9, 10.5, body, out()),
    ellipse(24, 31, 10, 11.5, body, out()),
    line("M19.5 22.5c-1.4 5-1.4 12 0 17M28.5 22.5c1.4 5 1.4 12 0 17", detail, 1.1, {
      opacity: 0.7,
    }),
    shine(17.5, 26, 2.6, 1.3),
  ],
};

/** What grows on top of produce: drawn behind its outline (`back`) or in front (`front`). */
const TOPS: Readonly<
  Record<ProduceLook["top"], { back?: () => ArtShape[]; front?: () => ArtShape[] }>
> = {
  leaf: { back: () => [leaf(25, 15, 11, -40)] },
  cap: {
    front: () => [
      path("M24 17.5 19 13l4.2 1.4L24 10l.8 4.4L29 13z", LEAF, out({ "stroke-width": 1.1 })),
      path(
        "M14.5 19.5c3-1.5 5.5-2 9.5-2s6.5.5 9.5 2l-3.4 1-2.8-.9-3.3 1.3-3.3-1.3-2.8.9z",
        LEAF,
        out({ "stroke-width": 1.1 }),
      ),
    ],
  },
  star: {
    front: () => [
      path(
        "M24 19.5 18 17.5l4-1.2-2.6-3.3 4.6 1.6 4.6-1.6-2.6 3.3 4 1.2z",
        LEAF,
        out({ "stroke-width": 1.1 }),
      ),
      line("M24 14.5V10.5", STEM, 1.8),
    ],
  },
  vine: {
    front: () => [
      path("M22.6 20.5c-.4-3 .3-5.8 2.2-7.6l2.2 1.1c-1.6 1.7-2.1 3.9-1.8 6.5z", "#76703a", out()),
      line("M27 14.5c2.5-3 6.5-2.6 6.8 0 .3 2.3-3.4 2.9-3.6.6", STEM, 1.1),
      leaf(25, 14, 9, -160),
    ],
  },
};

/** A sprig of leaves, like a bunch of herbs. */
function sprig(): ArtShape[] {
  return [
    line("M24 41C24 33 23 24 25 12", STEM, 1.8),
    leaf(24.5, 35, 11, -150),
    leaf(24, 34, 11, -30),
    leaf(24.5, 27, 10, -145),
    leaf(24.2, 26, 10, -35),
    leaf(25, 19, 8.5, -140),
    leaf(25, 18.5, 8.5, -40),
    leaf(25, 12.5, 6, -90, MOSS_LIGHT),
  ];
}

/** A flower on its stem, its petals in `body`. */
function bloom(body: string): ArtShape[] {
  const petals = [0, 72, 144, 216, 288].map((a) =>
    ellipse(24, 12, 4.2, 6, body, {
      transform: `rotate(${a} 24 19)`,
      ...out({ "stroke-width": 1.1 }),
    }),
  );
  return [
    line("M24 24c0 6-1 11 0 18", STEM, 1.8),
    leaf(23.5, 34, 9, -150),
    leaf(24.3, 31, 9, -25),
    ...petals,
    circle(24, 19, 3.6, SUN, out({ "stroke-width": 1.1 })),
  ];
}

/** A crop drawn from its look, without the shadow: on its own, on a packet, or on a jar's label. */
function cropArt(kind: ItemKind): ArtShape[] {
  const look = CATALOG[kind].look;
  if (look.template === "produce") {
    const top = TOPS[look.top];
    return [
      ...(top.back?.() ?? []),
      ...SHAPES[look.shape](look.body, look.detail),
      ...(top.front?.() ?? []),
    ];
  }
  if (look.template === "sprig") return sprig();
  if (look.template === "bloom") return bloom(look.body);
  throw new Error(`${kind} isn't drawn as produce.`);
}

// ---------- seeds, sugar, and jars ----------

/** A paper seed packet with the crop it grows on the front, its band in that crop's color. */
const seedPacket = (crop: Crop): ArtShape[] => [
  shadow(12, 44),
  rect(11, 6, 26, 37, 3, KRAFT, out()),
  path("M11 12.5h26V9a3 3 0 0 0-3-3H14a3 3 0 0 0-3 3z", CROP_HEX[crop], out()),
  line("M14 9.3h20", PAPER, 1, { "stroke-dasharray": "1.6 1.6", opacity: 0.8 }),
  rect(14, 15.5, 20, 20, 2.5, PAPER, { opacity: 0.85 }),
  group("translate(24 25.5) scale(0.5) translate(-24 -26)", cropArt(crop)),
  ellipse(19, 39.3, 1, 1.5, WOOD, { transform: "rotate(30 19 39.3)" }),
  ellipse(24, 39.6, 1, 1.5, WOOD),
  ellipse(29, 39.3, 1, 1.5, WOOD, { transform: "rotate(-30 29 39.3)" }),
];

function sugar(): ArtShape[] {
  return [
    shadow(13),
    path(
      "M15 19c-1.5 6-3.5 13-2 19 .6 2.5 3 3.8 11 3.8s10.4-1.3 11-3.8c1.5-6-.5-13-2-19z",
      PAPER2,
      out(),
    ),
    path("M16.5 19.5 14 9.5l5 3 2.5-4.5 2.5 4 2.5-4 2.5 4.5 5-3-2.5 10z", PAPER2, out()),
    line("M15.5 19.5c5 1.4 12 1.4 17 0", CLAY, 2.2),
    rect(17, 26, 14, 9.5, 2, PAPER, out({ "stroke-width": 1 })),
    rect(19.5, 29.5, 3.6, 3.6, 0.6, "#ffffff", out({ "stroke-width": 0.8 })),
    rect(24.9, 29.5, 3.6, 3.6, 0.6, "#ffffff", out({ "stroke-width": 0.8 })),
    rect(22.2, 26.6, 3.6, 3.2, 0.6, "#ffffff", out({ "stroke-width": 0.8 })),
  ];
}

/** A glass jar. `fill` is what's inside (none for empty), `top` the lid or cloth. */
function jarBody(fill: string | undefined, level = 0.75): ArtShape[] {
  const shapes: ArtShape[] = [rect(13, 14, 22, 28, 6, GLASS, out())];
  if (fill) {
    const h = 26 * level;
    shapes.push(
      path(`M14.4 ${41 - h}h19.2V36a4.6 4.6 0 0 1-4.6 4.6H19A4.6 4.6 0 0 1 14.4 36z`, fill),
    );
  }
  shapes.push(line("M17 19v15", "#ffffff", 2, { opacity: 0.7 }));
  return shapes;
}

/** A gingham cloth tied over a jar's lid. */
function cloth(color: string): ArtShape[] {
  return [
    path("M10.5 15.5 13 8.5h22l2.5 7-3 1.5H13.5z", color, out()),
    line("M17 9v7.5M24 9v7.5M31 9v7.5", "#ffffff", 1.6, { opacity: 0.55 }),
    line("M12 12.5h24", "#ffffff", 1.6, { opacity: 0.55 }),
    line("M13.5 16.5c7 1.4 14 1.4 21 0", CLAY_DEEP, 1.4),
  ];
}

/** A paper label on a jar with a little picture of what's in it. */
function label(kind: ItemKind): ArtShape[] {
  return [
    rect(16.5, 24, 15, 12, 2, PAPER, out({ "stroke-width": 1 })),
    group("translate(24 30) scale(0.3) translate(-24 -27)", cropArt(kind)),
  ];
}

/**
 * A jar from its look: filled with `fill`, with what's in it on the label, and either a cloth
 * tied over the top (a jam) or a lid and a sprig of leaves (a sauce or a soup).
 */
function jarArt(look: JarLook): ArtShape[] {
  const inside = [shadow(12), ...jarBody(look.fill, 0.85)];
  const what = look.label as ItemKind;
  if ("cloth" in look) return [...inside, ...cloth(look.cloth), ...label(what)];
  return [
    ...inside,
    rect(12.5, 9, 23, 6, 2.2, look.lid, out()),
    line("M15 12h18", "#ffffff", 1, { opacity: 0.4 }),
    ...label(what),
    leaf(31, 21, 6, -30),
  ];
}

function jar(): ArtShape[] {
  return [shadow(12), ...jarBody(undefined), rect(12.5, 9, 23, 6, 2.2, LID, out())];
}

function wood(): ArtShape[] {
  return [
    shadow(13),
    line("M10 30 34 22", WOOD_DARK, 5),
    line("M12 32 32 24", WOOD, 3),
    line("M14 24 36 32", WOOD_DARK, 5),
    line("M16 26 34 33", WOOD, 3),
    circle(11, 29.5, 2.6, "#c9a06b", out({ "stroke-width": 1 })),
    circle(35, 32.5, 2.6, "#c9a06b", out({ "stroke-width": 1 })),
  ];
}

function stone(): ArtShape[] {
  return [
    shadow(13),
    ellipse(18, 32, 7, 5.5, "#a39d93", out()),
    ellipse(16, 30, 4, 3, "#b7b0a3"),
    ellipse(30, 34, 5.5, 4.5, "#8f887c", out()),
    ellipse(28.5, 32.5, 3, 2.4, "#a39d93"),
  ];
}

function lemonade(): ArtShape[] {
  return [
    shadow(11),
    line("M28 4.5 25 22", CLAY, 2.2),
    rect(14, 13, 20, 29, 5, GLASS, out()),
    path("M15.4 18h17.2v18.5a4 4 0 0 1-4 4h-9.2a4 4 0 0 1-4-4z", "#f7e27a"),
    circle(20, 25, 1.3, "#ffffff", { opacity: 0.8 }),
    circle(27, 31, 1, "#ffffff", { opacity: 0.8 }),
    circle(22, 34, 0.9, "#ffffff", { opacity: 0.8 }),
    line("M17.5 20v13", "#ffffff", 1.8, { opacity: 0.6 }),
    circle(33.5, 13.5, 5.5, CROP_HEX.lemon, out()),
    circle(33.5, 13.5, 3.6, "#fff1a8"),
    line("M33.5 10v7M30 13.5h7M31 11l5 5M36 11l-5 5", CROP_HEX.lemon, 0.8),
  ];
}

function herbTea(): ArtShape[] {
  return [
    shadow(16, 42),
    ellipse(24, 39.5, 16, 3.5, PAPER2, out()),
    path("M11 22h26c0 9-5 16-13 16s-13-7-13-16z", PAPER, out()),
    ellipse(24, 22, 13, 3, "#a8b860", out({ "stroke-width": 1.1 })),
    path("M36.5 25c4 0 5 2.5 4 4.5s-3.5 3-5.8 2.6", "none", out({ "stroke-width": 2.2 })),
    line("M17 29h14", MOSS_LIGHT, 2.2, { opacity: 0.8 }),
    line("M19 16c-2-2 2-3.5 0-6M25 16c-2-2 2-3.5 0-6", LINE, 1.2, { opacity: 0.5 }),
    line("M29 21 32 12", LINE, 0.8),
    rect(30.5, 8, 4.5, 5, 1, CLAY, out({ "stroke-width": 0.9 })),
  ];
}

function bouquet(): ArtShape[] {
  const bloom = (x: number, y: number, fill: string) => [
    ...[0, 72, 144, 216, 288].map((a) =>
      circle(x, y - 3.2, 2.6, fill, { transform: `rotate(${a} ${x} ${y})` }),
    ),
    circle(x, y, 1.8, SUN),
  ];
  return [
    shadow(10, 44),
    line("M24 32 17 14M24 32V11M24 32l8-17", STEM, 1.6),
    leaf(22, 22, 7, -150),
    leaf(26, 21, 7, -30),
    ...bloom(16, 13, CROP_HEX.flower),
    ...bloom(32, 14, PLUM),
    ...bloom(24, 10, ROSE),
    path("M14 24h20l-7 19h-6z", PAPER2, out()),
    line("M19.5 24 23 43M28.5 24 25 43", "#d9c7a4", 1, { opacity: 0.8 }),
    path(
      "M20 30.5c2.5 1.2 5.5 1.2 8 0l2 3.5-2.5-.5-3.5 3.5-3.5-3.5-2.5.5z",
      CLAY,
      out({ "stroke-width": 1 }),
    ),
  ];
}

function herbSachet(): ArtShape[] {
  return [
    shadow(12),
    leaf(24, 16, 9, -120),
    leaf(24, 16, 9, -60),
    line("M24 18V9", STEM, 1.4),
    path(
      "M18.5 19c-4 4-6.5 10-5.5 16 .6 4 4 6.5 11 6.5s10.4-2.5 11-6.5c1-6-1.5-12-5.5-16z",
      "#c8d8b2",
      out(),
    ),
    path("M18 16.5c2 2.5 10 2.5 12 0l.5 3c-2.5 2-10.5 2-13 0z", "#c8d8b2", out()),
    line("M17.5 20.5c4 1.5 9 1.5 13 0", PLUM, 2),
    path(
      "M24 21.5c-3-3-6-1.5-4.5.5M24 21.5c3-3 6-1.5 4.5.5",
      "none",
      out({ stroke: PLUM, "stroke-width": 1.6 }),
    ),
    circle(19.5, 31, 1.2, "#ffffff", { opacity: 0.7 }),
    circle(27, 34, 1.2, "#ffffff", { opacity: 0.7 }),
    circle(24, 28, 1.2, "#ffffff", { opacity: 0.7 }),
  ];
}

function flowerWreath(): ArtShape[] {
  const flowers: ArtShape[] = [];
  const tones = [CROP_HEX.flower, SUN, ROSE, PAPER, PLUM, CROP_HEX.flower];
  tones.forEach((fill, i) => {
    const a = (i / tones.length) * Math.PI * 2 - Math.PI / 2;
    const x = 24 + Math.cos(a) * 12;
    const y = 25 + Math.sin(a) * 12;
    flowers.push(circle(x, y, 3.3, fill, out({ "stroke-width": 1 })), circle(x, y, 1.2, SUN));
  });
  const leaves: ArtShape[] = [];
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * 360 + 15;
    leaves.push(
      group(`rotate(${a} 24 25)`, [leaf(24, 13, 7, i % 2 ? -20 : 200, i % 3 ? LEAF : MOSS)]),
    );
  }
  return [
    shadow(15, 42),
    circle(24, 25, 12, "none", { stroke: MOSS, "stroke-width": 6.5 }),
    circle(24, 25, 12, "none", { stroke: LEAF, "stroke-width": 4 }),
    ...leaves,
    ...flowers,
    path("M21 37.5h6l2 5-3-1.5-2 2-2-2-3 1.5z", CLAY, out({ "stroke-width": 1 })),
  ];
}

// ---------- decor from the town shop ----------

function lantern(): ArtShape[] {
  const glow = BLOCK_COLORS.lantern;
  return [
    shadow(9, 44),
    circle(24, 25, 17, glow, { opacity: 0.18 }),
    line("M24 3.5v5", WOOD_DARK, 1.6),
    rect(19, 8, 10, 4, 1.5, WOOD_DARK, out({ "stroke-width": 1 })),
    ellipse(24, 24.5, 12, 13, glow, out()),
    path(
      "M24 11.5c-6 3-6 23 0 26M24 11.5c6 3 6 23 0 26",
      "none",
      out({ "stroke-width": 1, opacity: 0.6 }),
    ),
    line("M12.5 20.5h23M12.5 28.5h23", "#ffffff", 1, { opacity: 0.45 }),
    shine(18, 18, 3, 1.5, -60),
    rect(19, 36.5, 10, 3.5, 1.4, WOOD_DARK, out({ "stroke-width": 1 })),
    line("M24 40v3.5", CLAY, 1.6),
    circle(24, 44, 1.4, CLAY),
  ];
}

function frame(): ArtShape[] {
  return [
    shadow(15),
    rect(7.5, 8, 33, 33, 2.5, BLOCK_COLORS.frame, out()),
    rect(12, 12.5, 24, 24, 1, "#f6e7c4", out({ "stroke-width": 1 })),
    rect(13, 13.5, 22, 22, 0.5, "#cfe6ee"),
    circle(29, 19.5, 3, SUN),
    path("M13 30c4-5 8-6 12-3s7 1 10-1v9.5H13z", MOSS_LIGHT),
    path("M13 33c5-3 11-3.5 22-1.5v3.5H13z", MOSS),
    path("M17 29v-3l2-2 2 2v3z", PAPER, { stroke: CLAY_DEEP, "stroke-width": 0.6 }),
    path("M16.5 26.3 19 23.7l2.5 2.6z", CLAY),
    line("M9.5 10.5h29", "#ffffff", 1, { opacity: 0.5 }),
  ];
}

/** A piece of art: a small canvas on an easel, with brush strokes of color. */
function piece(): ArtShape[] {
  return [
    shadow(14),
    line("M16 41 22 12M32 41 26 12M24 30v12", WOOD, 2.2),
    rect(10, 8, 28, 22, 1.5, PAPER, out()),
    path("M13 26c3-4 6-6 9-4s6 2 8-1 4-2 5 0v5H13z", MOSS_LIGHT),
    circle(30, 14.5, 3, SUN),
    line("M14 14c2-1.5 4-1.5 6 0", ROSE, 1.8),
    line("M15.5 18.5c2-1 3.5-1 5 0", SKY, 1.6),
    rect(8.5, 29, 31, 3, 1, WOOD_DARK, out({ "stroke-width": 1 })),
  ];
}

function fence(): ArtShape[] {
  const post = (x: number) => path(`M${x - 4} 42V14l4-5 4 5v28z`, BLOCK_COLORS.fence, out());
  return [
    shadow(18, 43),
    rect(3, 18, 42, 5, 1.5, BLOCK_COLORS.fence, out()),
    rect(3, 30, 42, 5, 1.5, BLOCK_COLORS.fence, out()),
    post(14),
    post(34),
    line("M12 16v24M32 16v24", "#ffffff", 1.2, { opacity: 0.6 }),
    circle(14, 20.5, 0.8, LINE),
    circle(34, 20.5, 0.8, LINE),
    circle(14, 32.5, 0.8, LINE),
    circle(34, 32.5, 0.8, LINE),
  ];
}

function bench(): ArtShape[] {
  const green = BLOCK_COLORS.bench;
  return [
    shadow(19, 43),
    rect(10, 30, 3.5, 12, 1, WOOD_DARK, out({ "stroke-width": 1 })),
    rect(34.5, 30, 3.5, 12, 1, WOOD_DARK, out({ "stroke-width": 1 })),
    rect(8, 10, 32, 5, 1.6, green, out()),
    rect(8, 17, 32, 5, 1.6, green, out()),
    rect(12, 22, 2.5, 6, 0.8, WOOD_DARK),
    rect(33.5, 22, 2.5, 6, 0.8, WOOD_DARK),
    rect(5, 27, 38, 5.5, 1.8, green, out()),
    line("M7 28.7h34M10 11.6h28M10 18.6h28", "#ffffff", 1, { opacity: 0.4 }),
    path("M5 27c-1-4 1-7 4-7h1v7z", green, out({ "stroke-width": 1.1 })),
    path("M43 27c1-4-1-7-4-7h-1v7z", green, out({ "stroke-width": 1.1 })),
  ];
}

// ---------- autumn (RFC 0017) ----------

function pumpkinPie(): ArtShape[] {
  const crust = "#dba660";
  const crimps: ArtShape[] = [];
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * Math.PI * 2;
    const x = Math.round((24 + Math.cos(a) * 16.3) * 10) / 10;
    const y = Math.round((29 + Math.sin(a) * 6.4) * 10) / 10;
    crimps.push(circle(x, y, 1.9, crust, out({ "stroke-width": 0.8 })));
  }
  return [
    shadow(18, 42),
    path("M6 29v4.5c0 4.3 8 8 18 8s18-3.7 18-8V29z", "#b9803f", out()),
    ellipse(24, 29, 18, 7.6, crust, out()),
    ellipse(24, 29, 14.6, 5.4, "#d5752a", out({ "stroke-width": 1 })),
    ...crimps,
    ellipse(26, 27.6, 4.2, 2, PAPER, out({ "stroke-width": 1 })),
    shine(17, 27.5, 3, 1.1, 0),
  ];
}

/** A bale of straw in three-quarter view, tied twice with twine. */
function hayBale(): ArtShape[] {
  const twine = WOOD;
  const straw = "#c4963c";
  return [
    shadow(19, 43),
    path("M5 22.5 11 16h31l-6 6.5z", "#f0d68e", out()),
    path("M36 22.5 42 16v18.5L36 41z", "#d3aa4c", out()),
    rect(5, 22.5, 31, 18.5, 2, BLOCK_COLORS.hay_bale, out()),
    line("M14 22.5V41M27 22.5V41M20 16l-6 6.5M33 16l-6 6.5", twine, 1.6),
    line("M8 28h4M17 33h5M22 27h3M30 36h3.5M9 37h3M30 29h3", straw, 1, { opacity: 0.85 }),
    line("M38.5 23v8M40.5 21v8", straw, 1, { opacity: 0.6 }),
  ];
}

/** A scarecrow on its post: a straw hat, a stitched burlap face, and a patched red shirt. */
function scarecrow(): ArtShape[] {
  const burlap = "#d9bf8f";
  return [
    shadow(9, 44),
    line("M24 30v14", WOOD, 2.6),
    line("M6.5 21.5h35", WOOD, 2.4),
    line("M7 21.5l-3 3M7 21.5l-3.2-.8M41 21.5l3 3M41 21.5l3.2-.8", STRAW_DEEP, 1.4),
    path("M10 18.5h28v6.5h-6.5L31 37H17l-.5-12H10z", BLOCK_COLORS.scarecrow, out()),
    line("M17 19v18M31 19v18", "#ffffff", 1, { opacity: 0.35 }),
    line("M10 22h28M16.5 30h15", "#8e3524", 1, { opacity: 0.45 }),
    rect(25, 26.5, 4.5, 4.5, 0.8, SKY, out({ "stroke-width": 0.8 })),
    circle(24, 13, 6.2, burlap, out()),
    line("M21 12.3h1.6M26.4 12.3H28", INK, 1.4),
    line("M21.5 15.4c1.5 1 3.5 1 5 0", INK, 0.9),
    ellipse(24, 8.2, 9.5, 2.4, STRAW, out({ stroke: STRAW_DEEP })),
    path("M19 8.2c0-3 2-5 5-5s5 2 5 5", STRAW, out({ stroke: STRAW_DEEP })),
    line("M19.3 7c3 .8 6.4.8 9.4 0", CLAY, 1.4),
  ];
}

// ---------- furniture from the workbench (RFC 0016) ----------

const STONE_HI = "#c4beb2";
const STONE_LO = "#8f887c";
const IRON = "#5d5a55";

function table(): ArtShape[] {
  const top = BLOCK_COLORS.table;
  return [
    shadow(18, 43),
    rect(11, 25, 4, 17, 1, WOOD_DARK, out({ "stroke-width": 1 })),
    rect(33, 25, 4, 17, 1, WOOD_DARK, out({ "stroke-width": 1 })),
    rect(9, 23, 30, 5, 1.2, WOOD, out({ "stroke-width": 1 })),
    rect(5, 16, 38, 8, 2, top, out()),
    line("M8 18.5h32", "#ffffff", 1, { opacity: 0.35 }),
    line("M18 16.5v7M31 16.5v7", WOOD_DARK, 0.8, { opacity: 0.45 }),
  ];
}

function chair(): ArtShape[] {
  const wood = BLOCK_COLORS.chair;
  return [
    shadow(12, 43),
    rect(14, 6, 4, 25, 1.2, wood, out({ "stroke-width": 1 })),
    rect(30, 6, 4, 25, 1.2, wood, out({ "stroke-width": 1 })),
    rect(14, 8, 20, 4, 1.2, wood, out({ "stroke-width": 1 })),
    rect(14, 15.5, 20, 3, 1, wood, out({ "stroke-width": 1 })),
    rect(14, 32, 3.5, 11, 1, WOOD_DARK, out({ "stroke-width": 1 })),
    rect(30.5, 32, 3.5, 11, 1, WOOD_DARK, out({ "stroke-width": 1 })),
    rect(11, 27, 26, 6, 1.8, wood, out()),
    line("M13 28.8h22", "#ffffff", 1, { opacity: 0.35 }),
  ];
}

function bookshelf(): ArtShape[] {
  const frame = BLOCK_COLORS.bookshelf;
  const book = (x: number, y: number, w: number, h: number, fill: string): ArtShape =>
    rect(x, y, w, h, 0.6, fill, out({ "stroke-width": 0.8 }));
  return [
    shadow(16, 44),
    rect(9, 4, 30, 39, 2, frame, out()),
    rect(12, 7, 24, 33, 1, WOOD_DARK),
    book(13, 9, 3, 8, ROSE),
    book(16.5, 10, 3, 7, SKY),
    book(20, 9, 2.5, 8, SUN),
    book(23, 11, 3, 6, MOSS_LIGHT),
    path("M27 17l2.5-7 2.6 1-2.5 7z", PLUM, out({ "stroke-width": 0.8 })),
    rect(12, 17, 24, 2.5, 0.5, frame),
    book(13, 21, 3, 8, CLAY),
    book(16.5, 22, 2.5, 7, PAPER),
    book(19.5, 21, 3, 8, MOSS),
    book(28, 21.5, 3, 7.5, SKY),
    book(31.5, 22.5, 3, 6.5, SUN),
    rect(12, 29, 24, 2.5, 0.5, frame),
    book(13, 33, 2.5, 7, SUN),
    book(16, 32.5, 3, 7.5, PLUM),
    book(19.5, 33.5, 3, 6.5, ROSE),
    ellipse(30, 37.5, 4, 2.5, LEAF, out({ "stroke-width": 0.8 })),
    line("M10.5 6v35", "#ffffff", 1, { opacity: 0.3 }),
  ];
}

function barrel(): ArtShape[] {
  const wood = BLOCK_COLORS.barrel;
  return [
    shadow(13, 43),
    path("M14 9c-3.5 6-3.5 26 0 32h20c3.5-6 3.5-26 0-32z", wood, out()),
    line("M19 9.5c-1.5 8-1.5 23 0 31M24 9.5v31M29 9.5c1.5 8 1.5 23 0 31", WOOD_DARK, 0.9, {
      opacity: 0.45,
    }),
    line("M12.6 16.5h22.8M12.6 33.5h22.8", IRON, 2.2),
    ellipse(24, 9.5, 10, 2.6, "#b98a5a", out({ "stroke-width": 1.1 })),
    shine(17, 24, 1.6, 6, 0),
  ];
}

function signpost(): ArtShape[] {
  const board = BLOCK_COLORS.signpost;
  return [
    shadow(9, 44),
    rect(22, 8, 4, 35, 1, WOOD_DARK, out({ "stroke-width": 1 })),
    path("M9 11h24l5 5-5 5H9z", board, out()),
    path("M39 23H15l-5 5 5 5h24z", board, out()),
    line("M12 16h18M16 28h19", WOOD_DARK, 0.9, { opacity: 0.35 }),
    circle(24, 16, 1, WOOD_DARK),
    circle(24, 28, 1, WOOD_DARK),
  ];
}

function lampPost(): ArtShape[] {
  const iron = BLOCK_COLORS.lamp_post;
  const glow = BLOCK_COLORS.lantern;
  return [
    shadow(9, 44),
    circle(24, 13, 11, glow, { opacity: 0.2 }),
    rect(22.5, 18, 3, 23, 1, iron, out({ "stroke-width": 1 })),
    rect(18.5, 39, 11, 4, 1.4, iron, out({ "stroke-width": 1 })),
    path("M18.5 9h11l-2 9h-7z", "#f9d27a", out()),
    path("M17 9.5 24 4l7 5.5z", iron, out({ "stroke-width": 1 })),
    rect(19.5, 17.5, 9, 2.5, 1, iron),
    shine(21.5, 12, 1, 2.5, 10),
  ];
}

function well(): ArtShape[] {
  const stone = BLOCK_COLORS.well;
  return [
    shadow(18, 44),
    rect(11.5, 10, 3, 21, 1, WOOD_DARK, out({ "stroke-width": 1 })),
    rect(33.5, 10, 3, 21, 1, WOOD_DARK, out({ "stroke-width": 1 })),
    line("M13 14h22", WOOD_DARK, 1.6),
    line("M24 14v8", LINE, 1),
    rect(21.5, 21, 5, 4, 1, WOOD, out({ "stroke-width": 0.9 })),
    path("M7 13 24 3l17 10z", CLAY, out()),
    path("M10 29h28v11c0 2.4-6.3 4-14 4s-14-1.6-14-4z", stone, out()),
    line("M10 35c4 1.5 9 2 14 2s10-.5 14-2M17 29.5v6M31 29.5v6M24 37v6.5", STONE_LO, 1),
    ellipse(24, 29, 14, 4, STONE_HI, out()),
    ellipse(24, 29, 10, 2.4, "#3f5f6f"),
  ];
}

function stoneWall(): ArtShape[] {
  const stone = BLOCK_COLORS.stone_wall;
  return [
    shadow(20, 43),
    rect(4, 23, 40, 18, 3, stone, out()),
    path(
      "M4.5 32h39M15 23.5V32M30 23.5V32M9 32v8.5M23 32v8.5M37 32v8.5",
      "none",
      out({ stroke: STONE_LO, "stroke-width": 1 }),
    ),
    rect(3, 19, 42, 6, 3, STONE_HI, out()),
    line("M7 20.8h34", "#ffffff", 1, { opacity: 0.4 }),
  ];
}

function campfire(): ArtShape[] {
  const flame = BLOCK_COLORS.campfire;
  const stone = (cx: number, cy: number) => ellipse(cx, cy, 4, 2.8, BLOCK_COLORS.stone, out());
  return [
    shadow(17, 43),
    circle(24, 30, 15, BLOCK_COLORS.lantern, { opacity: 0.16 }),
    line("M12 38 34 31", WOOD, 4),
    line("M14 31 36 38", WOOD_DARK, 4),
    path(
      "M24 9c5 6 9 10 9 16 0 5-4 9-9 9s-9-4-9-9c0-4 3-6 4-9 1 3 3 4 3 4 0-5 0-8 2-11z",
      flame,
      out(),
    ),
    path(
      "M24 19c3 3.5 5 6 5 9.5 0 3-2.2 5-5 5s-5-2-5-5c0-2.5 2-3.5 2.5-5.5 1.2 1.8 2 2 2 2 0-2 .2-4 .5-6z",
      SUN,
    ),
    stone(10, 39),
    stone(17, 41.5),
    stone(24, 42.5),
    stone(31, 41.5),
    stone(38, 39),
  ];
}

function flowerBox(): ArtShape[] {
  const box = BLOCK_COLORS.flower_box;
  const bloom = (x: number, y: number, fill: string): ArtShape[] => [
    circle(x, y, 3.4, fill, out({ "stroke-width": 1 })),
    circle(x, y, 1.2, SUN),
  ];
  return [
    shadow(18, 43),
    line("M13 26v-8M21 26v-11M28 26v-9M35 26v-7", STEM, 1.4),
    leaf(21, 21, 7, -150),
    leaf(28, 22, 7, -30),
    leaf(13, 23, 6, -150),
    leaf(35, 23, 6, -30),
    ...bloom(13, 16, CROP_HEX.flower),
    ...bloom(21, 13, PAPER),
    ...bloom(28, 15, PLUM),
    ...bloom(35, 17, SUN),
    rect(8, 24.5, 32, 4, 1, "#6a4a33"),
    rect(6, 27, 36, 14, 2, box, out()),
    line("M9 33.5h30", WOOD_DARK, 0.9, { opacity: 0.45 }),
    line("M9 29h30", "#ffffff", 1, { opacity: 0.35 }),
  ];
}

// ---------- wear ----------

function strawHat(): ArtShape[] {
  return [
    shadow(17, 42),
    ellipse(24, 32, 20, 6.5, STRAW, out({ stroke: STRAW_DEEP })),
    path("M14 31.5c0-9 4-15 10-15s10 6 10 15c-6 2-14 2-20 0z", STRAW, out({ stroke: STRAW_DEEP })),
    path("M14.3 27c6 1.8 13.4 1.8 19.4 0l.3 4.3c-6 2-14 2-20 0z", CLAY, out({ "stroke-width": 1 })),
    line("M17 22.5c4 1 10 1 14 0", STRAW_DEEP, 0.9, { opacity: 0.7 }),
  ];
}

function beret(): ArtShape[] {
  return [
    shadow(15, 41),
    path("M6 29c0-8 9-14 19-14s17 5 17 11c0 4-6 7-17 8S6 35 6 29z", CLAY, out()),
    path("M12 32c4 3 18 3 23 0l-.5 3.5c-5 3-17 3-22 0z", CLAY_DEEP, out({ "stroke-width": 1.1 })),
    line("M26 15v-4", CLAY_DEEP, 2.2),
    shine(17, 21, 5, 1.8),
  ];
}

function flowerCrown(): ArtShape[] {
  const r = (n: number) => Math.round(n * 10) / 10;
  // A ring of stems seen from the front, with flowers all along the near side.
  const bloom = (a: number, fill: string, size: number): ArtShape[] => {
    const x = r(24 + Math.cos(a) * 17);
    const y = r(25 + Math.sin(a) * 7);
    return [
      leaf(x, y, size * 1.4, Math.sin(a) > 0 ? 160 : 20),
      ...[0, 72, 144, 216, 288].map((t) =>
        circle(x, r(y - size * 0.55), r(size * 0.5), fill, { transform: `rotate(${t} ${x} ${y})` }),
      ),
      circle(x, y, r(size * 0.38), fill === SUN ? CLAY : SUN, out({ "stroke-width": 0.8 })),
    ];
  };
  return [
    shadow(17, 40),
    ellipse(24, 25, 17, 7, "none", { stroke: MOSS, "stroke-width": 2.6 }),
    ...bloom(-Math.PI * 0.62, PAPER, 3.4),
    ...bloom(-Math.PI * 0.38, CROP_HEX.flower, 3.4),
    ...bloom(Math.PI * 1.02, ROSE, 4.4),
    ...bloom(Math.PI * 0.8, SUN, 4.6),
    ...bloom(Math.PI * 0.5, CROP_HEX.flower, 5),
    ...bloom(Math.PI * 0.2, PLUM, 4.6),
    ...bloom(-Math.PI * 0.02, ROSE, 4.4),
  ];
}

function beanie(): ArtShape[] {
  return [
    shadow(14, 42),
    path("M10 33c0-12 6-19 14-19s14 7 14 19z", SKY, out()),
    line("M17 17c-1.5 5-2 10-2 15M24 14.5V32M31 17c1.5 5 2 10 2 15", "#5a98be", 1, {
      opacity: 0.7,
    }),
    rect(8.5, 30, 31, 9, 3, "#5a98be", out()),
    line("M13 31v7M18 31v7M23 31v7M28 31v7M33 31v7", SKY, 1.2, { opacity: 0.8 }),
    circle(24, 11, 4.5, PAPER, out()),
  ];
}

function apron(): ArtShape[] {
  return [
    shadow(13, 44),
    line("M17 9c2 3 12 3 14 0", LINE, 1.6),
    line("M12 20c-3 0-5 1-6 3M36 20c3 0 5 1 6 3", LINE, 1.4),
    path(
      "M17 9h14v9c3 0 5 1 5 3l-1 18c0 2-2 3-4 3H17c-2 0-4-1-4-3l-1-18c0-2 2-3 5-3z",
      "#f6e3b4",
      out(),
    ),
    rect(18, 28, 12, 7, 1.5, ROSE, out({ "stroke-width": 1.1 })),
    line("M24 28v7", LINE, 0.9, { opacity: 0.6 }),
    line("M15 40.5h18", CLAY, 1.4, { "stroke-dasharray": "2 2" }),
  ];
}

function scarf(): ArtShape[] {
  return [
    shadow(13, 44),
    path("M10 15c4-5 24-5 28 0 1 3-1 6-4 7-6 2-14 2-20 0-3-1-5-4-4-7z", CLAY, out()),
    path("M27 20l4 18h-8l-1-17z", CLAY, out()),
    line("M24.5 26h6.5M25.5 32h6.5", SUN, 2.2),
    line(
      "M14 14.5c1 2.5 1 4.5 0 6.5M20 13c1 3 1 6 0 8.5M28 13c1 3 1 6 0 8.5M34 14.5c1 2.5 1 4.5 0 6.5",
      SUN,
      2.2,
    ),
    line("M23.5 38.5v4M26 38.5v4M28.5 38.5v4M31 38.5v4", CLAY_DEEP, 1.2),
  ];
}

function cardigan(): ArtShape[] {
  return [
    shadow(17, 44),
    path("M17 8l7 6 7-6 9 4 5 14-6 2-2-6v17H11V22l-2 6-6-2 5-14z", MOSS, out()),
    path("M17 8l7 12 7-12", "none", out({ "stroke-width": 1.2 })),
    line("M24 20v19", LINE, 1, { opacity: 0.7 }),
    circle(26, 24, 1.2, PAPER),
    circle(26, 29, 1.2, PAPER),
    circle(26, 34, 1.2, PAPER),
    rect(11, 37, 26, 3, 1, "#4c6a37"),
    rect(3, 25, 6, 2.5, 1, "#4c6a37", { transform: "rotate(18 6 26)" }),
    rect(39, 25, 6, 2.5, 1, "#4c6a37", { transform: "rotate(-18 42 26)" }),
  ];
}

function overalls(): ArtShape[] {
  return [
    shadow(14, 44),
    line("M17 7l1 13M31 7l-1 13", DENIM, 2.6),
    path("M16 18h16v6l3 1v17h-8l-3-10-3 10h-8V25l3-1z", DENIM, out()),
    rect(19, 19, 10, 6, 1.2, "#7aa0cc", out({ "stroke-width": 1 })),
    circle(18, 21, 1.3, SUN),
    circle(30, 21, 1.3, SUN),
    line("M14 31h7M27 31h7", "#7aa0cc", 1, { "stroke-dasharray": "1.5 1.5" }),
  ];
}

function basket(): ArtShape[] {
  return [
    shadow(16, 43),
    path("M12 24c0-12 24-12 24 0", "none", {
      stroke: WICKER,
      "stroke-width": 3,
      "stroke-linecap": "round",
    }),
    circle(19, 22, 5, CROP_HEX.lemon, out()),
    circle(28, 21.5, 5, CROP_HEX.strawberry, out()),
    leaf(27, 17, 5, -40),
    path("M8 24h32l-3.5 16c-.4 1.5-1.6 2.5-3.2 2.5H14.7c-1.6 0-2.8-1-3.2-2.5z", WICKER, out()),
    line("M9.5 30h29M10.8 36h26.4", "#a8743f", 1.2),
    line("M16 24.5l1.5 18M24 24.5v18M32 24.5l-1.5 18", "#a8743f", 1.2),
  ];
}

function satchel(): ArtShape[] {
  return [
    shadow(14, 44),
    path("M14 22C14 10 20 5 24 5s10 5 10 17", "none", { stroke: LEATHER, "stroke-width": 2.6 }),
    rect(9, 20, 30, 22, 4, LEATHER, out()),
    path("M9 24a4 4 0 0 1 4-4h22a4 4 0 0 1 4 4v6c0 2-2 4-4 4H13c-2 0-4-2-4-4z", "#b47d4b", out()),
    rect(21.5, 30, 5, 6, 1.2, SUN, out({ "stroke-width": 1 })),
    line("M12 23.5h24", "#ffffff", 1, { opacity: 0.3 }),
  ];
}

function glasses(): ArtShape[] {
  return [
    shadow(16, 38),
    circle(15, 25, 7.5, "#eaf4f6", out({ stroke: INK, "stroke-width": 2.2 })),
    circle(33, 25, 7.5, "#eaf4f6", out({ stroke: INK, "stroke-width": 2.2 })),
    line("M22.5 24c1-1.5 2-1.5 3 0", INK, 2),
    line("M7.5 23.5 3.5 20M40.5 23.5l4-3.5", INK, 2),
    line("M11.5 22.5l3-3M29.5 22.5l3-3", "#ffffff", 1.4),
  ];
}

function bow(): ArtShape[] {
  return [
    shadow(15, 40),
    path("M24 24 8 15c-3 2-3 16 0 18z", ROSE, out()),
    path("M24 24l16-9c3 2 3 16 0 18z", ROSE, out()),
    path(
      "M22 26l-4 12 4-2 2 3 1-13zM26 26l4 12-4-2-2 3-1-13z",
      "#d87189",
      out({ "stroke-width": 1.1 }),
    ),
    rect(20.5, 20, 7, 8, 2.5, "#d87189", out()),
    line("M12 19.5c3 1 5 3 7 4.5M36 19.5c-3 1-5 3-7 4.5", "#ffffff", 1, { opacity: 0.5 }),
  ];
}

function topHat(): ArtShape[] {
  return [
    shadow(16, 42),
    ellipse(24, 36, 18, 5, INK, out({ stroke: "#000000" })),
    path(
      "M13 35V10c0-1.5 5-3 11-3s11 1.5 11 3v25c-3 1.5-19 1.5-22 0z",
      INK,
      out({ stroke: "#000000" }),
    ),
    ellipse(24, 10, 11, 3, "#3d362e"),
    path("M13 28c3 1.5 19 1.5 22 0v4.5c-3 1.5-19 1.5-22 0z", CLAY, out({ "stroke-width": 1 })),
    line("M17 12.5v12", "#ffffff", 1.4, { opacity: 0.25 }),
  ];
}

function raincoat(): ArtShape[] {
  return [
    shadow(17, 44),
    path("M16 9c2-4 14-4 16 0l9 5 4 15-6 2-2-6v17H11V25l-2 6-6-2 4-15z", SLICKER, out()),
    path("M16 9c2 6 14 6 16 0", "none", out({ stroke: SLICKER_DEEP })),
    line("M24 13v26", SLICKER_DEEP, 1.2),
    rect(26, 18, 5, 2, 1, INK),
    rect(26, 24, 5, 2, 1, INK),
    rect(26, 30, 5, 2, 1, INK),
    line("M24 19h2M24 25h2M24 31h2", INK, 0.8),
    path("M13 30h7v5h-7z", SLICKER_DEEP, { opacity: 0.6 }),
    path("M28 33h7v4h-7z", SLICKER_DEEP, { opacity: 0.6 }),
    line("M14 14c-1 6-1 14 0 20", "#ffffff", 1.4, { opacity: 0.45 }),
  ];
}

function umbrella(): ArtShape[] {
  return [
    shadow(9, 44),
    line("M24 22v16c0 3 5 3 5 0", WOOD_DARK, 2.4),
    path(
      "M4 23C5 13 14 6 24 6s19 7 20 17c-2.2-2-5.5-2-7.7 0-2-2-6.2-2-8.2 0-2-2-6.2-2-8.2 0-2-2-6.2-2-8.2 0C9.5 21 6.2 21 4 23z",
      CANOPY,
      out(),
    ),
    path("M24 6c-4 4-5.5 10-4.1 17M24 6c4 4 5.5 10 4.1 17", "none", out({ "stroke-width": 1 })),
    path("M24 6c-4 4-5.5 10-4.1 17C17.9 21 15.7 21 15.7 21 15 14 18 9 24 6z", PAPER, {
      opacity: 0.85,
    }),
    path("M24 6c8 3 12 9 12.3 17-2 0-4 0-4 0C32 16 29 10 24 6z", PAPER, { opacity: 0.85 }),
    circle(24, 5, 1.6, WOOD_DARK),
  ];
}

// ---------- partner wear ----------

/** A four-pointed sparkle at (x, y), `r` from its middle to each point. */
const sparkle = (x: number, y: number, r: number): ArtShape =>
  path(
    `M${x} ${y - r}Q${x} ${y} ${x + r} ${y}Q${x} ${y} ${x} ${y + r}Q${x} ${y} ${x - r} ${y}Q${x} ${y} ${x} ${y - r}z`,
    SUN,
    out({ stroke: CLAY_DEEP, "stroke-width": 0.7 }),
  );

/** The Muse halo: a plush lilac ring seen from a little above, in a soft glow, with gold studs. */
function museHalo(): ArtShape[] {
  return [
    shadow(15, 41),
    ellipse(24, 25, 21, 11, DUSK, { opacity: 0.3 }),
    path(
      "M5 25c0-5.5 8.5-9.5 19-9.5s19 4 19 9.5-8.5 9.5-19 9.5S5 30.5 5 25zM12.5 25c0 2.4 5.1 4 11.5 4s11.5-1.6 11.5-4-5.1-4-11.5-4-11.5 1.6-11.5 4z",
      DUSK,
      out({ stroke: PLUM, "fill-rule": "evenodd" }),
    ),
    line("M10.5 21.5c3-2.5 8-3.6 13.5-3.6", "#ffffff", 1.6, { opacity: 0.7 }),
    sparkle(13, 30, 3.2),
    sparkle(24, 33, 4),
    sparkle(35, 30, 3.2),
    circle(39, 14, 1.2, SUN, { opacity: 0.8 }),
    circle(9, 15, 0.9, SUN, { opacity: 0.8 }),
  ];
}

/** The Muse lantern: a round paper lantern hung from a short stick, glowing warm. */
function museLantern(): ArtShape[] {
  const glow = BLOCK_COLORS.lantern;
  return [
    shadow(10, 44),
    circle(26, 28, 15, glow, { opacity: 0.2 }),
    line("M8 16 26.5 6.5", WOOD_DARK, 2.4),
    line("M26.5 6.5V14", WOOD_DARK, 1),
    rect(21.5, 13.5, 10, 3.5, 1.2, WOOD_DARK, out({ "stroke-width": 1 })),
    ellipse(26.5, 27.5, 11, 11.5, glow, out()),
    ellipse(26.5, 27.5, 4.5, 6, "#ffffff", { opacity: 0.4 }),
    path(
      "M15.6 23.5c6 1.6 15.8 1.6 21.8 0M15.6 31.5c6 1.6 15.8 1.6 21.8 0",
      "none",
      out({ stroke: CLAY, "stroke-width": 1, opacity: 0.6 }),
    ),
    rect(21.5, 38, 10, 3.5, 1.2, WOOD_DARK, out({ "stroke-width": 1 })),
    line("M26.5 41.5v3", CLAY, 1.4),
  ];
}

// ---------- bottoms, dresses, and feet ----------

function dress(): ArtShape[] {
  return [
    shadow(17, 44),
    line("M19 5.5l1 7M29 5.5l-1 7", "#d87189", 2),
    path("M18.5 12h11l1.5 9h-14z", ROSE, out()),
    path("M17 21h14l9.5 18.5c-6 3.2-26.5 3.2-33 0z", ROSE, out()),
    rect(16, 19.5, 16, 3.6, 1.6, CLAY, out({ "stroke-width": 1 })),
    circle(17, 31, 1.5, PAPER),
    circle(24, 27.5, 1.5, PAPER),
    circle(31, 31, 1.5, PAPER),
    circle(13.5, 37.5, 1.5, PAPER),
    circle(24, 36.5, 1.5, PAPER),
    circle(34.5, 37.5, 1.5, PAPER),
  ];
}

function skirt(): ArtShape[] {
  return [
    shadow(17, 43),
    path("M15 15h18l8 22c-7 3.5-27 3.5-34 0z", PLUM, out()),
    rect(14, 11, 20, 5, 2, "#8a6bc0", out()),
    line("M20 17l-3 20M24 17v21M28 17l3 20", "#8a6bc0", 1.1, { opacity: 0.8 }),
    shine(13.5, 27, 1.6, 5, 18),
  ];
}

function trousers(): ArtShape[] {
  return [
    shadow(13, 44),
    path("M14 11h20l2 31h-8l-4-21-4 21h-8z", MOSS, out()),
    rect(13.5, 9, 21, 5, 1.5, "#4c6a37", out()),
    line("M24 14v6M18 16v24M30 16v24", MOSS_LIGHT, 1, { opacity: 0.55 }),
    rect(22.5, 10, 3, 3, 0.8, SUN),
  ];
}

function shorts(): ArtShape[] {
  return [
    shadow(15, 39),
    path("M12 14h24l3 20h-12l-3-10-3 10H9z", SUN, out()),
    rect(11.5, 11, 25, 5, 1.8, CLAY, out()),
    path("M9.3 30.5h11.6l-.5 3.5H9z", "#e2a338", out({ "stroke-width": 1 })),
    path("M27.1 30.5h11.6l.3 3.5H27.6z", "#e2a338", out({ "stroke-width": 1 })),
    line("M24 16v8", LINE, 1, { opacity: 0.6 }),
  ];
}

function socks(): ArtShape[] {
  return [
    shadow(17, 43),
    path("M8 7h9v20l4 5c2 3 0 8-4 8h-6c-4 0-6-3-5-6l2-7z", PAPER, out()),
    path("M27 7h9v20l4 5c2 3 0 8-4 8h-6c-4 0-6-3-5-6l2-7z", PAPER, out()),
    rect(7.6, 7, 9.8, 4, 1, ROSE, out({ "stroke-width": 1 })),
    rect(26.6, 7, 9.8, 4, 1, ROSE, out({ "stroke-width": 1 })),
    line("M8.5 16h8M8.5 21h8M27.5 16h8M27.5 21h8", ROSE, 2),
  ];
}

function boots(): ArtShape[] {
  return [
    shadow(18, 43),
    path("M7 8h10v22l6 3c2 1 2 7 0 7H6c-1 0-1.5-1-1.5-2z", LEATHER, out()),
    path("M27 8h10v22l6 3c2 1 2 7 0 7H26c-1 0-1.5-1-1.5-2z", LEATHER, out()),
    line("M5 37.5h18.5M25 37.5h18.5", WOOD_DARK, 2.4),
    line("M6.5 12h11M26.5 12h11", "#b47d4b", 2.2),
    line("M10 17h4M10 21h4M30 17h4M30 21h4", WOOD_DARK, 1, { opacity: 0.7 }),
  ];
}

function sneakers(): ArtShape[] {
  return [
    shadow(19, 41),
    path("M4 34c0-6 2-12 6-13 3 3 8 4 12 6 2 1 2.5 4 2.5 7z", PAPER, out()),
    path("M24 34c0-6 2-12 6-13 3 3 8 4 12 6 2 1 2.5 4 2.5 7z", PAPER, out()),
    rect(3.5, 33, 21.5, 4, 1.8, PAPER2, out()),
    rect(23.5, 33, 21.5, 4, 1.8, PAPER2, out()),
    line("M9 28c3 1 6 0 9-2M29 28c3 1 6 0 9-2", SKY, 2.2),
    line("M11 23.5l2 2M31 23.5l2 2", LINE, 1),
  ];
}

// ---------- the catalog ----------

/**
 * Items with their own drawing (`drawn` looks in the catalog): the pantry's staples, materials,
 * decor, furniture, and made things that no template draws.
 */
const DRAWN: Readonly<Partial<Record<ItemKind, () => ArtShape[]>>> = {
  sugar,
  jar,
  wood,
  stone,
  lantern,
  frame,
  fence,
  bench,
  hay_bale: hayBale,
  scarecrow,
  table,
  chair,
  bookshelf,
  barrel,
  signpost,
  lamp_post: lampPost,
  well,
  stone_wall: stoneWall,
  campfire,
  flower_box: flowerBox,
  lemonade,
  herb_tea: herbTea,
  bouquet,
  herb_sachet: herbSachet,
  flower_wreath: flowerWreath,
  pumpkin_pie: pumpkinPie,
  piece,
};

/** Every piece of wear's drawing. */
const WEAR_ART: Readonly<Record<WearItem, () => ArtShape[]>> = {
  straw_hat: strawHat,
  beret,
  flower_crown: flowerCrown,
  beanie,
  apron,
  scarf,
  cardigan,
  overalls,
  basket,
  satchel,
  glasses,
  bow,
  top_hat: topHat,
  raincoat,
  umbrella,
  muse_halo: museHalo,
  muse_lantern: museLantern,
  dress,
  skirt,
  trousers,
  shorts,
  socks,
  boots,
  sneakers,
};

/** An item's picture from its look in the catalog, or its own drawing. */
function lookShapes(kind: ItemKind, look: KindLook): ArtShape[] {
  switch (look.template) {
    case "produce":
    case "sprig":
    case "bloom":
      return [shadow(13), ...cropArt(kind)];
    case "packet":
      return seedPacket(CATALOG[kind].grows as Crop);
    case "jar":
      return jarArt(look);
    case "drawn": {
      const draw = DRAWN[kind];
      if (!draw) throw new Error(`${kind} is drawn by hand, and item-art.ts has no picture of it.`);
      return draw();
    }
  }
}

/** The shapes of one picture, back to front, in a 48 by 48 box. Pure. */
export function itemShapes(kind: ArtKind): ArtShape[] {
  if (Object.hasOwn(CATALOG, kind))
    return lookShapes(kind as ItemKind, CATALOG[kind as ItemKind].look);
  return WEAR_ART[kind as WearItem]();
}

export interface ItemArtOptions {
  /** Read out for screen readers. Without one the picture is decorative and hidden from them. */
  title?: string;
  /** Width and height in CSS pixels. 28 by default. */
  size?: number;
  /** Extra classes beside `item-art`. */
  className?: string;
}

const SVG_NS = "http://www.w3.org/2000/svg";

function build(shape: ArtShape): SVGElement {
  const el = document.createElementNS(SVG_NS, shape.tag);
  for (const [k, v] of Object.entries(shape.attrs)) el.setAttribute(k, String(v));
  for (const child of shape.children ?? []) el.append(build(child));
  return el;
}

/**
 * A picture of a thing as an inline SVG. Decorative (`aria-hidden`) unless `title` is given, in
 * which case it's an image with that name. The title goes in as text, never as markup.
 */
export function itemArt(kind: ArtKind, opts: ItemArtOptions = {}): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, "svg");
  const size = opts.size ?? 28;
  svg.setAttribute("viewBox", `0 0 ${ART_BOX} ${ART_BOX}`);
  svg.setAttribute("width", String(size));
  svg.setAttribute("height", String(size));
  svg.setAttribute("class", opts.className ? `item-art ${opts.className}` : "item-art");
  svg.setAttribute("focusable", "false");
  svg.setAttribute("data-kind", kind);
  if (opts.title) {
    svg.setAttribute("role", "img");
    const title = document.createElementNS(SVG_NS, "title");
    title.textContent = opts.title;
    svg.append(title);
  } else {
    svg.setAttribute("aria-hidden", "true");
  }
  for (const shape of itemShapes(kind)) svg.append(build(shape));
  return svg;
}

interface ArtImage {
  img: HTMLImageElement;
  loaded: boolean;
  ready: Promise<boolean>;
}

const artImages = new Map<ArtKind, ArtImage>();

function artEntry(kind: ArtKind): ArtImage {
  let entry = artImages.get(kind);
  if (!entry) {
    const svg = itemArt(kind, { size: ART_BOX });
    svg.setAttribute("xmlns", SVG_NS);
    const img = new Image();
    const fresh: ArtImage = { img, loaded: false, ready: Promise.resolve(false) };
    fresh.ready = new Promise<boolean>((done) => {
      img.addEventListener("load", () => {
        fresh.loaded = img.naturalWidth > 0;
        done(fresh.loaded);
      });
      img.addEventListener("error", () => done(false));
    });
    entry = fresh;
    artImages.set(kind, fresh);
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(new XMLSerializer().serializeToString(svg))}`;
  }
  return entry;
}

/**
 * A thing's picture as an image, for drawing on a canvas (the world map). Built once per kind from
 * the same shapes as `itemArt`, as a `data:` URL both apps' policies allow. Undefined until it has
 * loaded; a canvas that draws every frame picks it up then.
 */
export function itemArtImage(kind: ArtKind): HTMLImageElement | undefined {
  const entry = artEntry(kind);
  return entry.loaded ? entry.img : undefined;
}

/** The same picture once it has loaded, for a canvas drawn once (a 3D texture). */
export async function itemArtLoaded(kind: ArtKind): Promise<HTMLImageElement | undefined> {
  const entry = artEntry(kind);
  return (await entry.ready) ? entry.img : undefined;
}

/** A made thing as lists and sheets show it: its kind, and for a piece, the upload it shows. */
export interface ThingLook {
  kind: ArtKind;
  media?: string | undefined;
  model?: true | undefined;
}

/** A piece's own uploaded picture, as one of our `/media/` URLs. Undefined for anything else. */
export function piecePictureUrl(thing: ThingLook): string | undefined {
  return thing.kind === "piece" && !thing.model ? mediaUrlOf(thing.media) : undefined;
}

/**
 * A made thing's picture: a piece's own uploaded picture (only ever from our `/media/`), and the
 * drawn picture for everything else, a model included. Decorative unless `title` is given.
 */
export function thingPicture(thing: ThingLook, opts: ItemArtOptions = {}): Element {
  const url = piecePictureUrl(thing);
  if (!url) return itemArt(thing.kind, opts);
  const size = opts.size ?? 28;
  const img = document.createElement("img");
  img.className = opts.className ? `thing-picture ${opts.className}` : "thing-picture";
  img.width = size;
  img.height = size;
  img.alt = opts.title ?? "";
  img.loading = "lazy";
  img.decoding = "async";
  img.src = url;
  return img;
}
