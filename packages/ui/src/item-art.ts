/**
 * Little storybook pictures of things: every item you can hold and every piece of wear. Drawn with
 * code (decision 0035): `itemShapes` is pure data, so tests can check it, and `itemArt` builds it
 * into an SVG with `createElementNS`, never markup from a string.
 *
 * Most items are drawn from their look in the sim's catalog (RFC 0018): produce from its outline,
 * what grows on top, and its colors; a seed packet from the crop it grows; a jar from what fills it
 * and what's on its label; a fish from its outline, its colors, and its markings (RFC 0023). Decor, furniture, the pantry's staples, made goods without a template,
 * finds, and wear have their own drawings here, under their ids. Each picture sits in a 48 by 48
 * box on a soft ground shadow. Colors come from the catalog, the brand tokens, and the sim's
 * palette, so a lantern here is the lantern in the world.
 */

import {
  BATH_WATER,
  BLOCK_COLORS,
  CATALOG,
  CLAY_HEX,
  CROP_HEX,
  type Crop,
  type Finish,
  type FishLook,
  GLAZE_HEX,
  type Glaze,
  growth,
  ITEM_KINDS,
  type ItemKind,
  type JarLook,
  type KindLook,
  onVine,
  type ProduceLook,
  RECIPE_PAGE,
  WEAR_ITEMS,
  type WearItem,
} from "@terrakin/sim";
import {
  BRAND_HEX,
  CANOPY,
  IRON,
  LEATHER,
  LINEN,
  SLICKER,
  SLICKER_DEEP,
  STONE_HI,
  STONE_LO,
  STRAW,
  STRAW_DEEP,
  WICKER,
  WOOD,
  WOOD_DARK,
} from "./brand";
import { SVG_NS } from "./dom";
import {
  batPath,
  EARNED_HEX,
  HALLOWEEN_HEX,
  HANUKKAH_HEX,
  leafPath,
  mediaUrlOf,
  RESIDENT_COLOR_HEX,
  THANKSGIVING_HEX,
  WINTER_HEX,
} from "./looks";

/**
 * Anything `itemArt` can draw: an item kind, a piece of wear, or a recipe page lying on the ground
 * (RFC 0024), which isn't a thing you hold.
 */
export type ArtKind = ItemKind | WearItem | typeof RECIPE_PAGE;

/** Every kind `itemArt` draws, items first, then wear, then the recipe page. */
export const ART_KINDS: readonly ArtKind[] = [...ITEM_KINDS, ...WEAR_ITEMS, RECIPE_PAGE];

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
const ART_BOX = 48;

/**
 * Each crop's color when it's ready to pick (its look's `body` in the catalog), how far along a
 * crop is, and whether it grows on a vine along the soil: the sim's palette, which the map and the
 * 3D views draw crops with, and plot photos too.
 */
export { CROP_HEX, GLAZE_HEX, growth, onVine };

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
const DENIM = "#5f86b5";
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

/** Where the little fruit of a bunch sit, widest at the top, like grapes. */
const CLUSTER_SPOTS: readonly [number, number][] = [
  [16, 22],
  [22, 20.5],
  [28, 21],
  [34, 23],
  [19, 27.5],
  [25, 26.5],
  [31, 28],
  [22, 33],
  [28, 33.5],
  [25, 38.5],
];

/** The kernels on a cob, five rows of three, every other row nudged over. */
const KERNEL_ROWS: readonly number[] = [18.5, 22.5, 26.5, 30.5, 34.5];

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
  // A pair hanging from one stem, like cherries.
  cherries: (body, detail) => [
    line("M24.5 14.5c-3.4 4.6-5.8 9-7 14.5M24.5 14.5c2.6 4.6 5 8.6 6.4 13", "#76703a", 1.5),
    circle(17.5, 31.5, 7.4, body, out()),
    circle(31, 34, 6.4, body, out()),
    line("M12.5 34c1.6 3 4.6 4.8 8 4.8", detail, 1.2, { opacity: 0.45 }),
    line("M27.2 38.6c2.4 1.2 5.4.4 7.2-1.8", detail, 1.2, { opacity: 0.45 }),
    shine(14.5, 27.5, 2.8, 1.4),
    shine(28.6, 30.6, 2.2, 1.1),
  ],
  // A bunch of little fruit, widest at the top, like grapes or a blackberry.
  cluster: (body, detail) => [
    ...CLUSTER_SPOTS.map(([x, y], i) =>
      circle(x, y, 3.7, i % 3 === 2 ? detail : body, out({ "stroke-width": 1 })),
    ),
    shine(17.5, 20.5, 2.2, 1.1),
  ],
  // A tapering root, with ridges across it, like a carrot.
  root: (body, detail) => [
    path("M16.5 17.5h15l-5.4 20.6c-.5 2-1.4 3.2-2.1 3.2s-1.6-1.2-2.1-3.2z", body, out()),
    line("M18.4 23h11M19.4 28h9M20.4 33h7", detail, 1.1, { opacity: 0.6 }),
    shine(20.5, 22, 1.6, 3.2, 10),
  ],
  // A cob of kernels in the husk it grew in, like corn.
  cob: (body, detail) => [
    leaf(21.5, 40, 25, -112, LEAF),
    leaf(26.5, 40, 25, -68, MOSS_LIGHT),
    path("M24 11.5c4.3 0 7 5.6 7 14.4S28.3 41 24 41s-7-6.3-7-15.1 2.7-14.4 7-14.4z", body, out()),
    ...KERNEL_ROWS.flatMap((y, r) =>
      [-3.2, 0, 3.2].map((dx) =>
        circle(24 + dx + (r % 2 ? 1.6 : 0), y, 1.4, detail, { opacity: 0.55 }),
      ),
    ),
    shine(21, 20, 1.6, 3.4, 0),
  ],
  // Round with stripes arching over it, like a melon.
  striped: (body, detail) => [
    path("M24 16c9.5 0 15 5.5 15 12.5S33 41 24 41 9 35.5 9 28.5 14.5 16 24 16z", body, out()),
    line("M24 16.2v24.6M16.4 17.9c-2 6.8-2 14.2 0 21M31.6 17.9c2 6.8 2 14.2 0 21", detail, 1.6, {
      opacity: 0.75,
    }),
    shine(16.5, 23.5, 3.4, 1.7),
  ],
  // A long one lying at an angle, like a cucumber.
  long: (body, detail) => [
    group("rotate(-32 24 29)", [
      ellipse(24, 29, 13, 5.6, body, out()),
      line("M14.5 27c6-1.6 13-1.6 19 .4", "#ffffff", 1.4, { opacity: 0.35 }),
      ellipse(17.5, 31, 1, 1.4, detail, { opacity: 0.7 }),
      ellipse(23.5, 32, 1, 1.4, detail, { opacity: 0.7 }),
      ellipse(29, 31.2, 1, 1.4, detail, { opacity: 0.7 }),
    ]),
  ],
  // A pod with its peas showing through, lying at a slight angle.
  pod: (body, detail) => [
    group("rotate(-18 24 29)", [
      path("M11 29c0-5 5.8-8.4 13-8.4S37 24 37 29s-5.8 8.4-13 8.4S11 34 11 29z", body, out()),
      circle(17.4, 29, 3.1, detail, out({ "stroke-width": 0.9 })),
      circle(24, 29, 3.3, detail, out({ "stroke-width": 0.9 })),
      circle(30.6, 29, 3.1, detail, out({ "stroke-width": 0.9 })),
      line("M13 25.6c6-2.4 16-2.4 22 0", "#ffffff", 1.2, { opacity: 0.3 }),
    ]),
  ],
  // A leafy head with two leaves falling away from it, like a cabbage.
  leafy: (body, detail) => [
    leaf(14.5, 33, 12, -165, MOSS_LIGHT),
    leaf(33.5, 33, 12, -15, MOSS_LIGHT),
    ellipse(24, 29.5, 11.5, 11, body, out()),
    line(
      "M24 18.8c-4 4-5.2 8-4.2 11.2M24 18.8c4 4 5.2 8 4.2 11.2M15 33.4c3-2.6 15-2.6 18 0",
      detail,
      1.2,
      { opacity: 0.6 },
    ),
    shine(18.5, 24, 3.2, 1.6),
  ],
};

/**
 * What grows on top of produce, drawn behind its outline (`back`) or in front (`front`), in the
 * produce's own colors where it has them.
 */
const TOPS: Readonly<Record<ProduceLook["top"], { back?: Paint; front?: Paint }>> = {
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
  // A short neck that opens into a little crown of points, like a pomegranate's.
  crown: {
    front: (body, detail) => [
      path("M20.6 18.4 19.4 12.6l2.2 1.9 2.4-3.6 2.4 3.6 2.2-1.9-1.2 5.8z", body, out()),
      line("M21.3 17.5c1.8.6 3.6.6 5.4 0", detail, 1, { opacity: 0.7 }),
    ],
  },
  // A fan of narrow greens, like a carrot's.
  greens: {
    front: () => [
      line("M24 20.5V15.5", STEM, 1.6),
      leaf(23.5, 16.5, 9, -125),
      leaf(24, 16, 10, -90, MOSS_LIGHT),
      leaf(24.5, 16.5, 9, -55),
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
      ...(top.back?.(look.body, look.detail) ?? []),
      ...SHAPES[look.shape](look.body, look.detail),
      ...(top.front?.(look.body, look.detail) ?? []),
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
    ellipse(30, 34, 5.5, 4.5, STONE_LO, out()),
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

/** A jack-o'-lantern: a carved pumpkin with a candle in it, its face lit from inside. */
function jackOLantern(): ArtShape[] {
  const skin = BLOCK_COLORS.jack_o_lantern;
  const lit = "#ffd36b";
  const cut = out({ stroke: CLAY_DEEP, "stroke-width": 0.9 });
  return [
    shadow(15),
    circle(24, 30, 18, lit, { opacity: 0.2 }),
    ellipse(15.5, 31, 9, 10.5, skin, out()),
    ellipse(32.5, 31, 9, 10.5, skin, out()),
    ellipse(24, 31, 10, 11.5, skin, out()),
    line("M19.5 22.5c-1.4 5-1.4 12 0 17M28.5 22.5c1.4 5 1.4 12 0 17", "#c4661c", 1.1, {
      opacity: 0.5,
    }),
    path("M22.6 20.5c-.4-3 .3-5.8 2.2-7.6l2.2 1.1c-1.6 1.7-2.1 3.9-1.8 6.5z", "#76703a", out()),
    path("M16.5 29.5 19.5 24.5l3 5z", lit, cut),
    path("M25.5 29.5 28.5 24.5l3 5z", lit, cut),
    path(
      "M15.5 33.5c3 4.5 14 4.5 17 0l-2.3.8-1.6 1.9-1.9-1.5-2.7 1.8-2.7-1.8-1.9 1.5-1.6-1.9z",
      lit,
      cut,
    ),
  ];
}

// ---------- finds (RFC 0021) ----------

/** An acorn: a tan nut under a cap of little scales, on a short stem. */
function acorn(): ArtShape[] {
  return [
    shadow(10),
    path(
      "M16.5 24c0-1.6 3.4-2.6 7.5-2.6s7.5 1 7.5 2.6c0 9.2-3.4 14.8-7.5 16.8-4.1-2-7.5-7.6-7.5-16.8z",
      "#c08a48",
      out(),
    ),
    shine(20.5, 29.5, 1.6, 3.6, -8),
    path(
      "M14 24.5c0-6.3 4.4-10 10-10s10 3.7 10 10c-3 1.6-6.4 2.2-10 2.2s-7-.6-10-2.2z",
      "#7a5230",
      out(),
    ),
    line("M17.5 20.5l2.5 2.5M21.5 17.8l3.5 3.6M26.5 17.6l3 3M30.5 20.3l1.4 1.4", "#563820", 1, {
      opacity: 0.7,
    }),
    line("M24 14.5c.2-2 1.4-3.6 3.2-4.4", WOOD_DARK, 1.8),
  ];
}

/** A pinecone: a long brown cone of scales. */
function pinecone(): ArtShape[] {
  return [
    shadow(10),
    path(
      "M24 7.5c5.4 3 9.5 10.2 9.5 18.5 0 8.2-4.2 14.4-9.5 15.5-5.3-1.1-9.5-7.3-9.5-15.5 0-8.3 4.1-15.5 9.5-18.5z",
      "#9a6a3c",
      out(),
    ),
    line(
      "M18 16.5q6 3.6 12 0M16 22.5q8 4.4 16 0M15.6 28.5q8.4 4.6 16.8 0M17 34.5q7 3.8 14 0",
      WOOD_DARK,
      1.2,
    ),
    line("M24 9v31", WOOD_DARK, 1, { opacity: 0.45 }),
    shine(19.5, 14, 1.2, 2.6, 25),
  ];
}

/** A mushroom: a red cap with pale spots on a cream stem. */
function mushroom(): ArtShape[] {
  const spot = "#fff3e2";
  return [
    shadow(12),
    path("M19.5 28h9c.4 5 1 9.2 1.6 12.6h-12.2c.6-3.4 1.2-7.6 1.6-12.6z", "#f1e6cf", out()),
    path(
      "M8 28.5c0-9 7.2-15.5 16-15.5s16 6.5 16 15.5c-5 1.9-10.4 2.7-16 2.7S13 30.4 8 28.5z",
      "#d1453b",
      out(),
    ),
    circle(16.5, 22, 2.3, spot),
    circle(24.5, 18, 2.7, spot),
    circle(31.8, 22.6, 2.1, spot),
    circle(20.8, 26.6, 1.4, spot),
    circle(28.8, 27, 1.5, spot),
    line("M14 29.2c6.5 1.3 13.5 1.3 20 0", "#b8a27e", 1, { opacity: 0.6 }),
  ];
}

/** A feather: a jay's blue, barred, on a pale quill. */
function feather(): ArtShape[] {
  return [
    shadow(13),
    path("M12 38C14 26 22 13.5 36.5 7.5c-1.8 13-10.3 25-24.5 30.5z", "#6f9fd3", out()),
    path("M12.4 37.6C20 28 28 18 36.5 7.5c-1.4 10.8-8.8 21.6-24.1 30.1z", "#a7c7ea"),
    line(
      "M18.4 31.2l5.2-.9M21.6 26.4l5.4-1.2M25.4 21.4l5.2-1.5M29.4 16.4l4.4-1.6",
      "#2f4f78",
      1.3,
      {
        opacity: 0.75,
      },
    ),
    line("M9.5 41.5C17 31 26 18.5 36.5 7.5", "#f6efe1", 1.4),
  ];
}

/** A chestnut: glossy and brown, with its pale base and a little tip. */
function chestnut(): ArtShape[] {
  const base = "#dcbc8c";
  return [
    shadow(12),
    path(
      "M24 13c8.2 0 14 7.2 14 15.2 0 7-6 12.3-14 12.3s-14-5.3-14-12.3C10 20.2 15.8 13 24 13z",
      "#7b3f1d",
      out(),
    ),
    path(
      "M11.6 32.4c3.8 3.6 8 5 12.4 5s8.6-1.4 12.4-5c-2 4.9-6.8 8.1-12.4 8.1s-10.4-3.2-12.4-8.1z",
      base,
      out({ "stroke-width": 1 }),
    ),
    path("M22.8 13.4 24 9.8l1.2 3.6z", base, out({ "stroke-width": 1 })),
    shine(18.5, 21.5, 3.6, 2, -32),
  ];
}

/** A sprig of holly: two spiny leaves and three red berries. */
function holly(): ArtShape[] {
  const leafy = "#2f6b34";
  const berry = "#cf2f2f";
  const spiny =
    "M24 30C19 31.5 14 29.6 10 24.6l3-.6-.8-3 3 .4.2-3.1 2.9 1.3 1.2-2.8 2.2 2.2 1.8-2.2C22.6 21 24 25.4 24 30z";
  return [
    shadow(13),
    path(spiny, leafy, out()),
    group("translate(48 0) scale(-1 1)", [path(spiny, leafy, out())]),
    line("M23.5 29.6c-3.4-2-7-4.3-10.6-7.6M24.5 29.6c3.4-2 7-4.3 10.6-7.6", "#1f4a24", 1),
    circle(21.4, 31, 3.1, berry, out()),
    circle(26.8, 32, 3.1, berry, out()),
    circle(24.2, 27.4, 3.1, berry, out()),
    shine(23.3, 26.4, 0.9, 0.7),
  ];
}

/** A scallop seashell: a ribbed fan with its two little ears. */
function seashell(): ArtShape[] {
  return [
    shadow(12),
    path(
      "M24 39C17 33.5 11 27.5 10 21.5 10 15 16 11 24 11s14 4 14 10.5C37 27.5 31 33.5 24 39z",
      "#f5c8b2",
      out(),
    ),
    line(
      "M24 38.5 13.6 17.4M24 38.5 18.6 12.8M24 38.5V11.6M24 38.5l5.4-25.7M24 38.5l10.4-21.1",
      "#dc9a80",
      1.1,
    ),
    path("M18.6 36.2h10.8l-1.6 4.4h-7.6z", "#ebb39b", out()),
    shine(17.5, 16.8, 2.4, 1.2, -25),
  ];
}

/** Driftwood: a weathered grey branch, smoothed by the sea. */
function driftwood(): ArtShape[] {
  const grain = "#8d8070";
  return [
    shadow(16),
    path(
      "M7.5 31c3.2-4.2 9.4-5.4 15.6-5 6.4.4 12.2-.6 17.6-3.6 1.8 1.6 1.8 4.4 0 6-5.2 2.8-11.4 3.4-17.6 3.4-5.8 0-11.4 1-15.6 3.4-1.8-1-1.8-2.8 0-4.2z",
      "#c3b6a3",
      out(),
    ),
    path("M30 25.6c1.4-2.6 3.6-4.4 6.2-5.2l1 1.8c-2.2.8-3.8 2.2-4.8 4z", "#c3b6a3", out()),
    line("M12 31.4c5.4-2.2 11.4-2.4 17-2.6M20.4 28c5.2 0 9.8-.6 14-2.4", grain, 1, {
      opacity: 0.8,
    }),
    ellipse(31, 28.8, 1.6, 1.1, grain),
  ];
}

/** Sea glass: a frosted green pebble of glass, worn smooth. */
function seaGlass(): ArtShape[] {
  return [
    shadow(11),
    path(
      "M13.5 27.5c0-7 5-12.2 11.2-12.2 6.4 0 10.8 4.6 10.8 10.6 0 7-5.6 12.4-12.2 12.4-5.6 0-9.8-4.2-9.8-10.8z",
      "#86cdb9",
      out(),
    ),
    ellipse(24, 27.4, 7.4, 6.2, "#f2fffa", { opacity: 0.35 }),
    line("M28 33.6c2.6-1.4 4.4-3.8 4.8-6.6", "#5aa894", 1.2, { opacity: 0.6 }),
    shine(19.5, 21.5, 3, 1.5, -35),
  ];
}

/** A starfish: five arms, sandy orange, dotted. */
function starfish(): ArtShape[] {
  const dot = "#f7c592";
  return [
    shadow(14),
    path(
      "M24 11 27.5 21.2 38.3 21.4 29.7 27.9 32.8 38.1 24 32 15.2 38.1 18.3 27.9 9.7 21.4 20.5 21.2z",
      "#e8833a",
      out({ "stroke-width": 1.6 }),
    ),
    circle(24, 26, 1.5, dot),
    circle(24, 18, 1, dot),
    circle(31.6, 23.5, 1, dot),
    circle(28.8, 32.2, 1, dot),
    circle(19.2, 32.2, 1, dot),
    circle(16.4, 23.5, 1, dot),
  ];
}

/** A crystal: three pale violet points rising out of a bit of rock. */
function crystal(): ArtShape[] {
  return [
    shadow(13),
    ellipse(24, 38, 11.5, 3.6, STONE_LO, out()),
    path("M13.4 38 12.6 26.4l3.2-5 3.4 4.2.8 12.4z", "#c9b4ef", out()),
    path("M29.2 38l1.4-10.2 3.6-4 2.6 5.2-1.4 9z", "#e7ddf8", out()),
    path("M20.6 38V18.2l4.2-7.4 4.2 7.4V38z", "#dccdf4", out()),
    line("M24.8 11v27", "#b39ae0", 1, { opacity: 0.8 }),
    shine(22.8, 22, 0.8, 4.4, 0),
  ];
}

/** A fossil: an ammonite's spiral in a disc of pale stone. */
function fossil(): ArtShape[] {
  const coil = "#8a7a5f";
  return [
    shadow(14),
    ellipse(24, 27, 14.5, 12.5, "#d2c6ae", out()),
    line(
      "M24.4 27c0-1.6 1.4-2.6 2.8-2.2 2 .6 2.6 2.9 1.8 4.7-1.2 2.6-4.5 3.3-7 2-3.3-1.7-4-6-2.3-9.1 2.1-3.9 7.4-4.9 11.1-2.6 4.6 2.8 5.5 9.1 2.7 13.4",
      coil,
      1.6,
    ),
    line("M33 21.6l1.7-1M35 27h1.9M33.6 32.4l1.5 1.2M28.4 18.2l.7-1.8", coil, 1.1),
    shine(17, 21.5, 3, 1.4, -30),
  ];
}

/** A geode: a rough grey stone cracked open on a ring of violet crystals. */
function geode(): ArtShape[] {
  const point = "#b98ee8";
  return [
    shadow(14),
    path(
      "M24 11.5c7.4 0 13.6 5.8 14 13.4.5 8.2-5.6 14.4-14 14.4S9.5 33.1 10 24.9c.4-7.6 6.6-13.4 14-13.4z",
      STONE_LO,
      out(),
    ),
    ellipse(24, 25.4, 10.6, 10.2, "#f1ebf8"),
    ellipse(24, 25.4, 8.6, 8.2, "#8a5cc7"),
    path(
      "M24 17.6l2.1 5.3h-4.2zM31.6 24.2l-5.2 1.7.9-4.2zM28 32.4l-3.8-4 4.6-.3zM16.6 27.6l5.2-1.6-1 4.2zM18.4 19.6l4.6 3.2-4.6 1z",
      point,
    ),
    circle(24, 25.4, 2.4, "#5a3a8c"),
    shine(18.5, 19.8, 1.6, 0.8, -30),
  ];
}

/** A four-leaf clover: four heart-shaped leaves on a thin stem. */
function fourLeafClover(): ArtShape[] {
  const heart =
    "M24 22.5C21 20.4 17 15 20.4 12.9c2-1.2 3.6.3 3.6 1.8 0-1.5 1.6-3 3.6-1.8C31 15 27 20.4 24 22.5z";
  return [
    shadow(11),
    line("M24 24c1 5 .4 9.6-3 15", STEM, 2),
    ...[0, 90, 180, 270].map((turn) =>
      group(`rotate(${turn} 24 22.5)`, [
        path(heart, "#5aa043", out({ "stroke-width": 1.1 })),
        line("M24 21.6v-5.8", "#8fc46a", 0.9),
      ]),
    ),
    circle(24, 22.5, 1.2, "#3f7f2f"),
  ];
}

/** A maple leaf, turned red in autumn. */
function mapleLeaf(): ArtShape[] {
  return [
    shadow(13),
    line("M24 34v7.5", "#8a4a26", 1.6),
    path(
      "M24 34 21 35l1-4-7 1 1.5-3L10 25l3-1-2-6 5 2 1-3 4 4-1-8 2.5 1.5L24 9l1.5 5.5L28 13l-1 8 4-4 1 3 5-2-2 6 3 1-6.5 4 1.5 3-7-1 1 4z",
      "#d9482b",
      out(),
    ),
    line("M24 34V13M24 27.5l-8.6-6M24 27.5l8.6-6M24 31l-7 1M24 31l7 1", "#a3321b", 1, {
      opacity: 0.8,
    }),
  ];
}

/** A cherry blossom: five pale pink petals, each notched, around a yellow heart. */
function cherryBlossom(): ArtShape[] {
  return [
    shadow(11),
    ...[0, 72, 144, 216, 288].map((turn) =>
      group(`rotate(${turn} 24 24.5)`, [
        path(
          "M24 24.5c-4.2-1.6-6.4-6.6-5-10.8 1-2.8 3-3.4 4-2l1 1.4 1-1.4c1-1.4 3-.8 4 2 1.4 4.2-.8 9.2-5 10.8z",
          "#f7c6d4",
          out({ "stroke-width": 1.1 }),
        ),
      ]),
    ),
    circle(24, 24.5, 3.2, "#f6dc7c"),
    circle(22.6, 23.4, 0.7, "#d97a3a"),
    circle(25.6, 23.6, 0.7, "#d97a3a"),
    circle(24.2, 26, 0.7, "#d97a3a"),
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

// ---------- earned wear (RFC 0029) ----------

const E = EARNED_HEX;

/** Growing's sun hat: a wide, soft brim under a round crown, with a moss ribbon and a leaf. */
function sunHat(): ArtShape[] {
  const weave = out({ stroke: E.sunHatWeave });
  return [
    shadow(18, 42),
    path(
      "M3 31c2-6 10-9 21-9s19 3 21 9c-3 6-9 5.4-14 3.8-4-1.2-10-1.2-14 0C12 36.4 6 37 3 31z",
      E.sunHat,
      weave,
    ),
    path("M13.5 28c0-9 4.5-14.5 10.5-14.5S34.5 19 34.5 28c-6 2-15 2-21 0z", E.sunHat, weave),
    path(
      "M13.6 24.2c6 1.8 14.8 1.8 20.8 0l.2 3.8c-6 2-15 2-21 0z",
      E.sunHatBand,
      out({ "stroke-width": 1 }),
    ),
    leaf(30, 24, 8, -40, E.sunHatLeaf),
    line("M17.5 18.5c4 1 9 1 13 0", E.sunHatWeave, 0.9, { opacity: 0.8 }),
  ];
}

/** Making's tool belt: a leather band with a brass buckle, a hammer in its loop, and a pouch. */
function toolBelt(): ArtShape[] {
  return [
    shadow(18, 43),
    line("M11 13v25", WOOD_DARK, 4),
    line("M11 13v25", E.hammerHandle, 2.6),
    rect(5, 8, 12, 6, 1.5, E.hammerHead, out()),
    rect(3, 16, 42, 8, 2.5, E.belt, out()),
    line("M6 20h36", "#ffffff", 0.9, { opacity: 0.3, "stroke-dasharray": "2 2" }),
    rect(20, 14.5, 8, 11, 1.6, E.buckle, out({ "stroke-width": 1 })),
    rect(22.5, 17, 3, 6, 0.8, E.belt),
    path("M30 22h12v13c0 3-2 5-6 5s-6-2-6-5z", E.beltPouch, out()),
    path("M30 22h12v6c-4 2-8 2-12 0z", E.belt, out({ "stroke-width": 1 })),
    circle(36, 28.5, 1.3, E.buckle),
  ];
}

/** Foraging's field vest: sleeveless olive canvas, open at the neck, with two patch pockets. */
function fieldVest(): ArtShape[] {
  return [
    shadow(15, 44),
    path("M15 8l5 3 4 9 4-9 5-3 6 5-2 9 .5 19h-27L11 22l-2-9z", E.vest, out()),
    path("M20 11l4 9 4-9", "none", out({ "stroke-width": 1.2 })),
    line("M24 20v21", E.vestTrim, 1.2),
    rect(12.5, 27, 8, 8.5, 1.4, E.vestPocket, out({ "stroke-width": 1 })),
    rect(27.5, 27, 8, 8.5, 1.4, E.vestPocket, out({ "stroke-width": 1 })),
    rect(12.5, 27, 8, 2.8, 1, E.vestTrim),
    rect(27.5, 27, 8, 2.8, 1, E.vestTrim),
    circle(26.2, 24, 1, E.buckle),
    line("M12 16c-1 2-1.3 4-1 6M36 16c1 2 1.3 4 1 6", E.vestTrim, 1, { opacity: 0.7 }),
  ];
}

/** Hosting's party sash: rose satin edged in gold, a gold star on it, and its tails tied below. */
function partySash(): ArtShape[] {
  return [
    shadow(16, 44),
    path("M35 34l8 8-6 .5-1.5 4-5.5-9z", E.sash, out({ "stroke-width": 1.1 })),
    path("M5 12l8-7 31 29-8 8z", E.sash, out()),
    line("M7.5 10.5l30.5 29M11 7l31 28.5", E.sashEdge, 1.5),
    sparkle(24, 23, 5),
  ];
}

/** Playing's rosette: two ribbon tails under a pleated blue round with a gold middle. */
function winnersRosette(): ArtShape[] {
  const r = (n: number) => Math.round(n * 10) / 10;
  const pleats = Array.from({ length: 10 }, (_, i) => {
    const a = (i / 10) * Math.PI * 2;
    return circle(r(24 + Math.cos(a) * 11), r(18 + Math.sin(a) * 11), 4, E.rosette, out());
  });
  return [
    shadow(12, 44),
    path("M19 24l-6 19 6-3 3 5 4-19z", E.rosetteDeep, out()),
    path("M29 24l6 19-6-3-3 5-4-19z", E.rosetteDeep, out()),
    ...pleats,
    circle(24, 18, 11, E.rosette),
    circle(24, 18, 8, "none", { stroke: E.rosetteDeep, "stroke-width": 1.2 }),
    circle(24, 18, 5.5, E.rosetteMiddle, out({ "stroke-width": 1 })),
    shine(20, 13, 3, 1.2),
  ];
}

/** The town satchel (RFC 0030): slate canvas on a leather strap, with a gold star on its flap. */
function townSatchel(): ArtShape[] {
  return [
    shadow(14, 44),
    path("M14 22C14 10 20 5 24 5s10 5 10 17", "none", { stroke: LEATHER, "stroke-width": 2.6 }),
    rect(9, 20, 30, 22, 4, E.townSatchel, out()),
    path(
      "M9 24a4 4 0 0 1 4-4h22a4 4 0 0 1 4 4v8c0 2-2 4-4 4H13c-2 0-4-2-4-4z",
      E.townSatchelFlap,
      out(),
    ),
    line("M12 23.5h24", "#ffffff", 1, { opacity: 0.3 }),
    line("M12.5 38.5h23", "#ffffff", 0.9, { opacity: 0.25, "stroke-dasharray": "2 2" }),
    sparkle(24, 31, 4.5),
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

// ---------- Halloween (RFC 0022) ----------

const H = HALLOWEEN_HEX;

/** A witch hat: a tall felt cone with a crooked tip over a wide brim, banded, with a buckle. */
function witchHat(): ArtShape[] {
  const edge = out({ stroke: "#221a30" });
  return [
    shadow(16, 42),
    ellipse(24, 36, 19.5, 5, H.witch, edge),
    path(
      "M14.5 35c1.5-9 4.5-18 7.5-24 2-4 5-6 9.5-6.5-1.5 2-2.5 4.5-2 7.5 1 8 3 16 4.5 23-6.5 2-13 2-19.5 0z",
      H.witch,
      edge,
    ),
    path("M15.4 30c5.9 1.8 12.3 1.8 17.6 0l.6 4.2c-6 1.9-12.6 1.9-18.8 0z", H.witchBand, out()),
    rect(21.6, 30.4, 5.2, 4.6, 0.8, "none", { stroke: H.buckle, "stroke-width": 1.3 }),
    line("M19.6 27c1.4-6.5 3.4-12 6-16", "#ffffff", 1.2, { opacity: 0.22 }),
  ];
}

/** Cat ears on a headband: two pointed ears with pink insides. */
function catEars(): ArtShape[] {
  return [
    shadow(13, 40),
    line("M9.5 36c0-12 6.5-20 14.5-20s14.5 8 14.5 20", H.catEars, 3.4),
    path("M12 25 12.5 7 21.5 17z", H.catEars, out()),
    path("M14.2 21.5 14.6 11.5 19.4 17z", H.catInner),
    path("M36 25 35.5 7 26.5 17z", H.catEars, out()),
    path("M33.8 21.5 33.4 11.5 28.6 17z", H.catInner),
    line("M15 30c1-5 4-9.5 8-11", "#ffffff", 1, { opacity: 0.25 }),
  ];
}

/** A pumpkin to wear over your head: a carved, candle-lit face, a stem, and room for a neck. */
function pumpkinHead(): ArtShape[] {
  const cut = out({ stroke: H.carved, "stroke-width": 0.9 });
  return [
    shadow(15),
    ellipse(15.5, 28, 9, 11, H.pumpkin, out()),
    ellipse(32.5, 28, 9, 11, H.pumpkin, out()),
    ellipse(24, 28, 10.5, 12.5, H.pumpkin, out()),
    line("M19.5 18.5c-1.4 5-1.4 14 0 19M28.5 18.5c1.4 5 1.4 14 0 19", H.pumpkinRib, 1.1, {
      opacity: 0.5,
    }),
    path("M22.6 16.5c-.4-3 .3-5.8 2.2-7.6l2.2 1.1c-1.6 1.7-2.1 3.9-1.8 6.5z", H.pumpkinStem, out()),
    path("M16.2 26.5 19.4 21l3.2 5.5z", H.lit, cut),
    path("M25.4 26.5 28.6 21l3.2 5.5z", H.lit, cut),
    path("M22.6 30.2 24 28l1.4 2.2z", H.lit, cut),
    path("M15.5 32c3 5 14 5 17 0l-2.4 1-1.6 2-2-1.6-2.5 1.9-2.5-1.9-2 1.6-1.6-2z", H.lit, cut),
    ellipse(24, 39.6, 5.5, 1.4, H.carved, { opacity: 0.55 }),
  ];
}

/** A ghost sheet: a white sheet with eye holes and a wavy hem. */
function ghostSheet(): ArtShape[] {
  return [
    shadow(15, 43),
    path("M10 40C10 24 12 7.5 24 7.5S38 24 38 40q-3.5 4-7 0t-7 0-7 0-7 0z", H.sheet, out()),
    line("M17 23c-1 6-.5 11 .8 15.5M31 23c1 6 .5 11-.8 15.5", H.sheetShade, 1.3),
    ellipse(19.5, 19, 2.5, 3.4, INK),
    ellipse(28.5, 19, 2.5, 3.4, INK),
    shine(18, 12.5, 4, 1.8),
  ];
}

/** Bat wings: two scalloped wings spread from a strap across the back. */
function batWings(): ArtShape[] {
  const wing =
    "M24 17C18 12 10 10 3.5 12c2 4 2.2 8.5.5 13 3.2-1 6 0 7.2 3 2-2 5-1.4 6.2 1.8 2-1.8 4.6-1.4 6.6 1.2z";
  const ribs = "M24 18 11 27.6M24 18 17.4 29.4M24 18 5.5 13.5";
  const mirror = "translate(48 0) scale(-1 1)";
  return [
    shadow(18, 41),
    path(wing, H.bat, out()),
    group(mirror, [path(wing, H.bat, out())]),
    line(ribs, H.batInner, 1),
    group(mirror, [line(ribs, H.batInner, 1)]),
    rect(21.5, 15.5, 5, 16, 2.5, H.batInner, out({ "stroke-width": 1 })),
  ];
}

/** Candy: a wrapped sweet with an orange swirl, and a candy corn in front of it. */
function candy(): ArtShape[] {
  const [orange, plum] = H.candy;
  return [
    shadow(15, 41),
    path("M12.5 22 4.5 16l1.6 6-1.6 6z", plum, out()),
    path("M35.5 22l8-6-1.6 6 1.6 6z", plum, out()),
    circle(24, 22, 11.5, orange, out()),
    path("M16.5 22a7.5 7.5 0 0 1 15 0 5.5 5.5 0 0 1-11 0 3.5 3.5 0 0 1 7 0", "none", {
      stroke: PAPER,
      "stroke-width": 2,
      "stroke-linecap": "round",
    }),
    shine(19, 16.5, 3.4, 1.5),
    path("M13 41.5 17.5 28l4.5 13.5c-3 .9-6 .9-9 0z", PAPER, out()),
    path("M14.2 38c2.2.7 4.4.7 6.6 0l1.2 3.5c-3 .9-6 .9-9 0z", SUN),
    path("M15.4 34.4c1.4.4 2.8.4 4.2 0l1.2 3.6c-2.2.7-4.4.7-6.6 0z", orange),
  ];
}

/** Bat bunting: paper bats and orange pennants on a string between two little posts. */
function batBunting(): ArtShape[] {
  const at = (t: number) => ({ x: 7 + 34 * t, y: 15 + 30 * t * (1 - t) });
  const pennant = (t: number) => {
    const { x, y } = at(t);
    return path(`M${x - 3} ${y - 0.4}h6l-3 7z`, H.witchBand, out({ "stroke-width": 1 }));
  };
  const bat = (t: number) => {
    const { x, y } = at(t);
    return path(batPath(x, y + 3.6, 12), H.bat, out({ "stroke-width": 0.9 }));
  };
  return [
    shadow(20, 43),
    line("M7 14v28M41 14v28", WOOD_DARK, 2.4),
    circle(7, 13.5, 1.9, WOOD_DARK),
    circle(41, 13.5, 1.9, WOOD_DARK),
    line("M7 15q17 15 34 0", LINE, 1),
    pennant(0.375),
    pennant(0.625),
    bat(0.22),
    bat(0.5),
    bat(0.78),
  ];
}

/** A cauldron on three feet, a green brew glowing in it, bubbles rising. */
function cauldron(): ArtShape[] {
  const iron = out({ stroke: "#26252b" });
  return [
    shadow(16, 43),
    circle(24, 18, 14, H.brew, { opacity: 0.18 }),
    rect(12, 35.5, 3.2, 6.5, 1.2, H.iron, iron),
    rect(32.8, 35.5, 3.2, 6.5, 1.2, H.iron, iron),
    rect(22.4, 37.5, 3.2, 5.5, 1.2, H.iron, iron),
    path("M8 22c0 12 7 18.5 16 18.5S40 34 40 22z", H.iron, iron),
    ellipse(24, 22, 17.5, 4.6, H.ironRim, iron),
    ellipse(24, 22, 14.5, 3.1, H.brew, out({ "stroke-width": 1 })),
    circle(18.5, 16.5, 2.4, H.brewLight, out({ "stroke-width": 0.8 })),
    circle(27.5, 13, 1.8, H.brewLight, out({ "stroke-width": 0.8 })),
    circle(31.5, 19, 1.4, H.brewLight, out({ "stroke-width": 0.8 })),
    line("M12 27c1 5 3.5 9 7 11", "#ffffff", 1.4, { opacity: 0.18 }),
  ];
}

/** A candy bowl: an orange bowl on a foot, heaped with wrapped candy. */
function candyBowl(): ArtShape[] {
  const [orange, plum, rose, mint, yellow] = H.candy;
  const bowl = BLOCK_COLORS.candy_bowl;
  const sweet = (cx: number, cy: number, r: number, fill: string) =>
    circle(cx, cy, r, fill, out({ "stroke-width": 1 }));
  return [
    shadow(16, 43),
    path("M18.5 41.5h11l-2-5.5h-7z", H.pumpkinRib, out()),
    sweet(16.5, 22.5, 4.2, rose),
    sweet(31.5, 22.5, 4.2, plum),
    sweet(24, 19.5, 4.6, yellow),
    sweet(20, 25.5, 3.8, mint),
    sweet(28, 25.5, 3.8, orange),
    path("M11 18.5l-2.4-1.6.4 3z", plum, out({ "stroke-width": 0.8 })),
    path("M36.5 18.5l2.4-1.6-.4 3z", rose, out({ "stroke-width": 0.8 })),
    path("M6 25.5h36c0 8-8 12.5-18 12.5S6 33.5 6 25.5z", bowl, out()),
    path("M7.5 30h33c-1 1.4-2.2 2.6-3.6 3.6h-25.8c-1.4-1-2.6-2.2-3.6-3.6z", plum, {
      opacity: 0.85,
    }),
    line("M9 26.4h30", "#ffffff", 1, { opacity: 0.4 }),
  ];
}

// ---------- Thanksgiving (RFC 0034) ----------

const T = THANKSGIVING_HEX;

/** A wicker horn of plenty on its side, its mouth to the right, spilling fruit. */
function cornucopia(): ArtShape[] {
  return [
    shadow(18, 43),
    path(
      "M41 30c0 7-5 11-11 11-8 0-16-5-21-12-3-4-5-9-3-12 1-2 3-1 3 1 0 2 2 4 4 4 3-1 6-6 13-7 8-1 15 6 15 15z",
      T.wicker,
      out(),
    ),
    line("M15 22c2 5 4 9 7 13M21 19c2 6 4 11 7 16M28 18c2 6 3 12 5 18", T.weave, 1.1),
    ellipse(35, 30, 6.5, 9, T.weave, out()),
    circle(34, 25, 4.6, T.apple, out({ "stroke-width": 1 })),
    circle(39.5, 32, 4.4, T.gourd, out({ "stroke-width": 1 })),
    circle(32, 34, 1.9, T.grapes),
    circle(35, 35.5, 1.9, T.grapes),
    circle(33.5, 37.5, 1.9, T.grapes),
    path("M42 24c3-1 5 1 4 4-2 1-5 0-4-4z", T.pear, out({ "stroke-width": 0.9 })),
    line("M34 20.5l1-2.5", WOOD_DARK, 1.2),
  ];
}

/** Two posts with a string of maple leaves sagging between them. */
function leafGarland(): ArtShape[] {
  const at = (t: number) => ({ x: 7 + 34 * t, y: 15 + 30 * t * (1 - t) });
  const leaf = (t: number, i: number) => {
    const { x, y } = at(t);
    return path(
      leafPath(x, y + 4, 9),
      T.leaves[i % T.leaves.length] as string,
      out({ "stroke-width": 0.8 }),
    );
  };
  return [
    shadow(20, 43),
    line("M7 14v28M41 14v28", WOOD_DARK, 2.4),
    circle(7, 13.5, 1.9, WOOD_DARK),
    circle(41, 13.5, 1.9, WOOD_DARK),
    line("M7 15q17 15 34 0", T.twine, 1),
    ...[0.14, 0.32, 0.5, 0.68, 0.86].map(leaf),
  ];
}

// ---------- Hanukkah (RFC 0034) ----------

const K = HANUKKAH_HEX;

/** A brass menorah with its nine candles lit, the helper candle tall in the middle. */
function menorah(): ArtShape[] {
  const xs = [6, 10.5, 15, 19.5, 24, 28.5, 33, 37.5, 42];
  const arms = [1, 2, 3, 4].map((i) => {
    const r = i * 4.5;
    return line(`M${24 - r} 21v${2 + i}a${r} ${r} 0 0 0 ${2 * r} 0v-${2 + i}`, K.brass, 1.6);
  });
  const candle = (x: number, i: number) => {
    const top = i === 4 ? 10 : 14;
    return [
      rect(x - 1.3, top, 2.6, 21 - top, 0.6, K.candle, out({ "stroke-width": 0.7 })),
      path(`M${x} ${top - 5}c-1.6 1.6-1.6 3.4 0 4.2 1.6-.8 1.6-2.6 0-4.2z`, K.flame),
      circle(x, top - 1.6, 0.8, K.flameCore),
    ];
  };
  return [
    shadow(14, 43),
    path("M17 42h14l-2-4h-10z", K.brassDark, out()),
    line("M24 38V21", K.brass, 2.2),
    ...arms,
    ...xs.flatMap(candle),
  ];
}

/** A four-sided blue spinning top, its point down, its lit face lighter. */
function dreidel(): ArtShape[] {
  return [
    shadow(9, 43),
    rect(22.5, 8, 3, 7, 1, K.dreidelLight, out()),
    path("M14 15h20v14l-10 12-10-12z", K.dreidel, out()),
    path("M24 15h10v14l-10 12z", K.dreidelLight, { opacity: 0.55 }),
  ];
}

/** A coin of chocolate in gold foil, stamped. */
function gelt(): ArtShape[] {
  return [
    shadow(13, 42),
    ellipse(24, 26, 14, 13, K.geltRim, out()),
    ellipse(24, 25, 12, 11, K.gelt),
    ellipse(24, 25, 7.5, 7, K.geltRim, { opacity: 0.45 }),
    path("M20.5 22.5h7l-3.5 6z", K.gelt, out({ "stroke-width": 0.8 })),
  ];
}

/** A round jelly doughnut dusted with sugar, jam showing at its side. */
function sufganiyah(): ArtShape[] {
  return [
    shadow(15, 42),
    ellipse(24, 28, 16, 12, K.dough, out()),
    path("M10 25c4-6 24-6 28 0-6-3-22-3-28 0z", K.sugar, { opacity: 0.9 }),
    circle(17, 24, 1, K.sugar),
    circle(30, 23.5, 1, K.sugar),
    circle(24, 21.5, 1, K.sugar),
    path("M36 29c3 0 5 2 4 4-2 1-4 0-5-2z", K.jelly, out({ "stroke-width": 0.8 })),
  ];
}

// ---------- winter (RFC 0017) and Midwinter (RFC 0022) ----------

/** A red Santa hat, its tip flopped over with a white bobble, on a white cuff (RFC 0034). */
function santaHat(): ArtShape[] {
  const W = WINTER_HEX;
  return [
    shadow(15, 42),
    path("M11 33c2-10 7-19 15-21 6-1 10 3 11 9-2-2-5-2-6 1-1 4 1 8 3 11z", W.santa, out()),
    rect(8.5, 31, 31, 8, 4, W.santaTrim, out()),
    circle(34.5, 22, 4.2, W.santaTrim, out()),
    line("M16 27c2-6 5-10 9-12", "#ffffff", 1.2, { opacity: 0.25 }),
  ];
}

/** A red felt stocking with a white cuff, hung from a little hook (RFC 0034). */
function stocking(): ArtShape[] {
  const W = WINTER_HEX;
  return [
    shadow(12, 43),
    path("M17 13h13v15c0 4 2 6 5 7 3 1 3 6-1 6h-9c-5 0-8-3-8-8z", W.stocking, out()),
    rect(15.5, 9, 16, 7, 3, W.stockingCuff, out()),
    line("M23.5 9V5", WOOD_DARK, 1.6),
  ];
}

/** A paper rocket on its stick, a spark at its fuse (RFC 0034). */
function firework(): ArtShape[] {
  const W = WINTER_HEX;
  return [
    shadow(9, 43),
    line("M24 24v18", W.rocketStick, 1.8),
    path("M20 26V13l4-6 4 6v13z", W.rocket, out()),
    line("M20 18h8", "#ffffff", 1.4, { opacity: 0.8 }),
    circle(24, 27.5, 1.6, W.spark),
    path("M24 30l-1.5 3M24 30l1.5 3M24 30v3.5", W.spark, { stroke: W.spark, "stroke-width": 1 }),
  ];
}

const W = WINTER_HEX;

/** Hot cranberry punch in a cream mug, steaming, with cranberries and a slice of lemon. */
function cranberryPunch(): ArtShape[] {
  return [
    shadow(15, 43),
    line("M17.5 14c-2-2.2 2-4 0-6.5M23.5 13c-2-2.2 2-4 0-6.5M29.5 14c-2-2.2 2-4 0-6.5", LINE, 1.2, {
      opacity: 0.5,
    }),
    path("M34 23.5h2.5a5.5 5.5 0 0 1 0 11H33", "none", out({ "stroke-width": 2.4 })),
    path("M34 23.5h2.5a5.5 5.5 0 0 1 0 11H33", "none", {
      stroke: W.mug,
      "stroke-width": 1.2,
      "stroke-linecap": "round",
    }),
    path("M9.5 18h25v18.5a5.5 5.5 0 0 1-5.5 5.5H15a5.5 5.5 0 0 1-5.5-5.5z", W.mug, out()),
    line("M10 31h24", W.punch, 2.4, { opacity: 0.85 }),
    line("M13 21.5v15", "#ffffff", 1.6, { opacity: 0.6 }),
    ellipse(22, 18, 12.5, 3, W.punch, out({ "stroke-width": 1.1 })),
    circle(17.5, 18, 1.5, CROP_HEX.cranberry, out({ "stroke-width": 0.7 })),
    circle(22, 17.4, 1.5, CROP_HEX.cranberry, out({ "stroke-width": 0.7 })),
    circle(26, 18.4, 1.5, CROP_HEX.cranberry, out({ "stroke-width": 0.7 })),
    circle(31, 16.5, 4.5, CROP_HEX.lemon, out()),
    circle(31, 16.5, 3, "#fff1a8"),
    line("M31 13.5v6M28 16.5h6", CROP_HEX.lemon, 0.8),
  ];
}

/** A snowman: three balls of snow, coal eyes and buttons, a carrot nose, a red scarf, a hat. */
function snowman(): ArtShape[] {
  const snow = out({ stroke: "#8ea3ba" });
  return [
    shadow(14, 43.5),
    line("M17.5 21.5 10 16M11 16.8 8.6 14.6M30.5 21.5 38 16M37 16.8l2.4-2.2", WOOD, 1.5),
    circle(24, 34, 9.5, W.snow, snow),
    path("M30.6 27.2a9.5 9.5 0 0 1-12.4 14.2 9.5 9.5 0 0 0 12.4-14.2z", W.snowShade, {
      opacity: 0.7,
    }),
    circle(24, 21.5, 6.8, W.snow, snow),
    path("M28.8 16.7a6.8 6.8 0 0 1-8.9 10.2 6.8 6.8 0 0 0 8.9-10.2z", W.snowShade, {
      opacity: 0.7,
    }),
    circle(24, 11.5, 5, W.snow, snow),
    circle(22.2, 10.8, 0.9, W.coal),
    circle(25.8, 10.8, 0.9, W.coal),
    path("M24 12.2l5.2 1.3-5.2 1z", W.carrot, out({ "stroke-width": 0.7 })),
    circle(24, 20.5, 0.95, W.coal),
    circle(24, 24, 0.95, W.coal),
    circle(24, 30.5, 1, W.coal),
    rect(18.2, 15.3, 11.6, 3.2, 1.6, W.scarf, out({ "stroke-width": 1 })),
    path("M26 17.6l3 6.8-2.8.6-1.8-6.4z", W.scarf, out({ "stroke-width": 1 })),
    line("M27.3 20.3l1.4-.4M28.2 22.4l1.3-.4", W.scarfStripe, 0.9),
    ellipse(24, 6.8, 6.2, 1.3, W.hat, out({ "stroke-width": 1 })),
    rect(20.6, 1.8, 6.8, 5.2, 1, W.hat, out({ "stroke-width": 1 })),
    line("M20.8 5.6h6.4", W.scarf, 1.1),
    shine(20.5, 30, 2.6, 1.3, -50),
  ];
}

/** Where a string of lights hangs at `t` along it, 0 at the west post and 1 at the east. */
const lightsAt = (t: number) => ({ x: 7 + 34 * t, y: 15 + 26 * t * (1 - t) });

/** A string of colored bulbs between two little posts, each bulb glowing. */
function stringLights(): ArtShape[] {
  const bulbs = [0.14, 0.32, 0.5, 0.68, 0.86].flatMap((t, i) => {
    const { x, y } = lightsAt(t);
    const color = W.bulbs[i % W.bulbs.length] as string;
    return [
      circle(x, y + 3.6, 4.6, color, { opacity: 0.28 }),
      rect(x - 0.9, y - 0.2, 1.8, 1.8, 0.4, W.wire),
      ellipse(x, y + 3.6, 1.9, 2.7, color, out({ "stroke-width": 0.8 })),
      circle(x - 0.5, y + 2.6, 0.6, "#ffffff", { opacity: 0.8 }),
    ];
  });
  return [
    shadow(20, 43),
    line("M7 14v28M41 14v28", WOOD_DARK, 2.4),
    circle(7, 13.5, 1.9, WOOD_DARK),
    circle(41, 13.5, 1.9, WOOD_DARK),
    line("M7 15q17 13 34 0", W.wire, 1.1),
    ...bulbs,
  ];
}

/** A little fir in a clay pot: three tiers of needles dusted with snow, and a star on top. */
function littleFir(): ArtShape[] {
  const tier = (top: number, half: number, base: number) =>
    path(
      `M24 ${top} ${24 - half} ${base}q${half} 2.6 ${half * 2} 0z`,
      W.needles,
      out({ "stroke-width": 1.2 }),
    );
  return [
    shadow(12, 43.5),
    rect(22.5, 31, 3, 4, 0.6, WOOD_DARK),
    tier(16, 12.5, 32),
    tier(10, 9.5, 24.5),
    tier(5.5, 6.5, 16.5),
    path("M24 16 17 30.5q-2 .3-3 0z", W.needlesLight, { opacity: 0.55 }),
    path("M24 10 19 23.5q-1.6.3-2.5 0z", W.needlesLight, { opacity: 0.55 }),
    ellipse(15.5, 31.6, 2.6, 1, W.snow),
    ellipse(31.5, 31.4, 3, 1.1, W.snow),
    ellipse(17.6, 24, 2.2, 0.9, W.snow),
    ellipse(30, 24.2, 2.3, 0.9, W.snow),
    ellipse(24, 16.4, 2, 0.8, W.snow),
    path("M15.5 34.5h17l-2 8.5h-13z", W.pot, out()),
    rect(14.5, 33, 19, 3.6, 1.2, W.potRim, out({ "stroke-width": 1 })),
    path(
      "M24 1.2l1.3 2.7 3 .4-2.2 2.1.5 3-2.6-1.4-2.6 1.4.5-3-2.2-2.1 3-.4z",
      W.star,
      out({ "stroke-width": 0.8 }),
    ),
  ];
}

/** A sled in three-quarter view: red slats on two iron runners that curl up in front, and a rope. */
function sled(): ArtShape[] {
  const runner = (dy: number) =>
    line(`M5 ${36 + dy}h29c5 0 8-3 8-7.5 0-2.4-1.6-3.6-3.2-3.2`, W.runner, 2);
  return [
    shadow(19, 43),
    runner(4),
    line("M10 40v-6M18 40v-6M28 40v-6", W.runner, 1.4),
    runner(0),
    line("M12 36v-6M20 36v-6M30 36v-6", W.runner, 1.4),
    path("M8 30.5 12 26h27l-4 4.5z", W.slat, out()),
    path("M8 30.5h27v3H8z", "#9e3428", out({ "stroke-width": 1 })),
    path("M35 30.5 39 26v3l-4 4.5z", "#9e3428", out({ "stroke-width": 1 })),
    line("M13.5 27.5h23M11.5 29h23", "#ffffff", 0.9, { opacity: 0.35 }),
    line("M39 27c3.5-1 6 1.5 5 4.5s-4 3.5-6.5 2.4", W.rope, 1.4),
  ];
}

/** A candy cane striped red and white, and a little one striped green leaning on it. */
function candyCane(): ArtShape[] {
  const cane = (d: string, width: number, stripe: string, dash: string) => [
    line(d, LINE, width + 1.8),
    line(d, "#ffffff", width),
    line(d, stripe, width, { "stroke-dasharray": dash, "stroke-linecap": "butt" }),
  ];
  return [
    shadow(13, 43),
    ...cane("M31 41V18.5a4.5 4.5 0 0 0-9 0V21", 3.4, W.caneGreen, "2.2 2.4"),
    ...cane("M18.5 42V14a7 7 0 0 1 14 0v3.5", 5, W.caneRed, "2.8 3.2"),
    line("M20 16.5V39", "#ffffff", 1, { opacity: 0.5 }),
  ];
}

// ---------- fishing (RFC 0023) ----------

/**
 * A fish's outline, facing right, in the 48 by 48 box: its body, the belly along its underside, its
 * tail and its fin on top, a fin at its side, its eye, its gill, its mouth (where a catfish's
 * whiskers grow), and where its markings go, so spots, bars, and bands stay inside its body.
 */
interface FishFrame {
  body: string;
  belly: string;
  tail: string;
  dorsal: string;
  fin: string;
  eye: [number, number, number];
  gill: string;
  mouth: [number, number];
  spots: readonly [number, number, number][];
  bars: string;
  band: string;
  scales: string;
  shine: [number, number, number, number];
}

const FISH_FRAMES: Readonly<Record<Exclude<FishLook["shape"], "eel" | "small">, FishFrame>> = {
  // Like a trout: long and even, with a forked tail.
  slim: {
    body: "M12 26C15 20 25 18.5 33 19.5S41 23 41.5 26 38 31.5 33 32.5 15 32 12 26z",
    belly: "M14 28c6 3.5 14 4.8 19 4.5s7.5-3 8.2-5.1c-7.2 2.2-17.2 2.6-27.2.6z",
    tail: "M13.2 26 6 18.6l2.6 7.4-2.6 7.4z",
    dorsal: "M21.5 19.6c1.8-4 6.4-4.8 9.6-.2z",
    fin: "M28.6 28.4c-1.6 2.6-4 3.6-6 3.4 1.4-1.6 3.6-3 6-3.4z",
    eye: [36, 24.4, 1.7],
    gill: "M32.6 21.4c-1.4 2.6-1.4 5.6 0 8.6",
    mouth: [41.4, 26.4],
    spots: [
      [19.5, 23, 0.9],
      [23.5, 21.8, 0.8],
      [27, 23.6, 0.9],
      [16.8, 25.4, 0.8],
      [22.6, 25.6, 0.7],
      [29.6, 21.8, 0.7],
    ],
    bars: "M18 21.4v9.2M22.4 20.4v11.4M26.8 20v11.8",
    band: "M14.5 26.4c6-.6 13.5-.4 20.5-1",
    scales:
      "M17 23.6q1.5 1.5 3 0M21 23q1.5 1.5 3 0M25 23q1.5 1.5 3 0M19 27q1.5 1.5 3 0M23 27q1.5 1.5 3 0",
    shine: [30, 21.6, 3, 1],
  },
  // Like a perch or a koi: tall and round, with a spiny fin on top and a broad tail.
  deep: {
    body: "M13 26c2-9 9-12.5 16-11.5S39.5 20 40 26s-4.5 10.5-11 11.5S15 35 13 26z",
    belly: "M15 30c4 5.5 10 8 14 7.5s9-4 10.5-8c-7.5 3-17.5 3.5-24.5.5z",
    tail: "M14.4 26 6 17.6c2.2 4.4 2.2 12.4 0 16.8z",
    dorsal: "M18.6 16.8c3-6 10.4-6.4 14.6-1.4z",
    fin: "M28 28.2c-2 3-4.6 4.4-6.6 4 1.6-2 4-3.6 6.6-4z",
    eye: [34.4, 22.4, 1.9],
    gill: "M31 17.8c-2 4.6-2 11.2 0 15.8",
    mouth: [40, 26],
    spots: [
      [20, 22, 1.2],
      [25, 19.6, 1.1],
      [23, 26, 1],
      [28, 23, 1.2],
      [18.4, 27.4, 0.9],
      [26, 30, 0.9],
    ],
    bars: "M18.6 19.8v12.6M23.4 16.8v18.6M28.2 16v19.8",
    band: "M15.4 26.2c6-.6 14-.6 20.6-1.2",
    scales:
      "M18 21q1.6 1.6 3.2 0M22.4 19.6q1.6 1.6 3.2 0M26.8 20q1.6 1.6 3.2 0M18.4 25.4q1.6 1.6 3.2 0M22.8 25q1.6 1.6 3.2 0M27.2 25q1.6 1.6 3.2 0M20.6 29.4q1.6 1.6 3.2 0M25 29.6q1.6 1.6 3.2 0",
    shine: [29, 18, 3.4, 1.2],
  },
  // Like a pike: long and narrow, its fin set far back by the tail.
  long: {
    body: "M9 26c3-4 13-5 23-4.5s11 2.5 12.5 4.7c-1.5 2-6.5 3.8-12.5 4.3S12 30 9 26z",
    belly: "M11 27.6c7 2.9 17 3.4 21 2.9s9.5-1.7 11.8-3.3c-8.8 1.3-21.8 1.8-32.8.4z",
    tail: "M10 26 3.4 20.4c1.6 3.6 1.6 7.6 0 11.2z",
    dorsal: "M14.2 22.6c1.6-4.2 5.6-4.2 7.2-.6z",
    fin: "M30 28.6c-1.4 2.4-3.4 3.4-5 3.2 1-1.6 3-2.8 5-3.2z",
    eye: [39.4, 24.6, 1.4],
    gill: "M36 22.6c-1 2-1 5 0 7",
    mouth: [44.4, 26.6],
    spots: [
      [15, 25, 0.8],
      [19, 24, 0.8],
      [23, 26, 0.8],
      [27, 24.4, 0.8],
      [31, 26.4, 0.8],
      [18, 27.4, 0.7],
      [25, 28, 0.7],
    ],
    bars: "M17 23.2v6.4M22 22.6v7.4M27 22.2v7.8",
    band: "M11.2 26.4c9-.4 19-.2 27-1",
    scales:
      "M15 24.4q1.4 1.4 2.8 0M19.4 24q1.4 1.4 2.8 0M23.8 23.8q1.4 1.4 2.8 0M28.2 23.8q1.4 1.4 2.8 0",
    shine: [33, 23.2, 3, 0.8],
  },
};

/** A catfish's whiskers, from its mouth. */
const whiskers = ([x, y]: [number, number]): ArtShape =>
  line(
    `M${x} ${y}c2.4-.2 4-1.4 4.8-3M${x} ${y + 0.4}c2.3.6 3.8 2 4.4 3.8M${x - 0.7} ${y - 0.6}c1.4-1.2 2.2-2.6 2.4-4.3`,
    LINE,
    0.9,
  );

/** A fish drawn from its frame and its look's colors, without the shadow. */
function fishBody(look: FishLook, f: FishFrame): ArtShape[] {
  const marks: ArtShape[] = [];
  if (look.scales) marks.push(line(f.scales, look.scales, 0.9, { opacity: 0.55 }));
  if (look.bars) marks.push(line(f.bars, look.bars, 2.4, { opacity: 0.55 }));
  if (look.band) marks.push(line(f.band, look.band, 2, { opacity: 0.8 }));
  if (look.spots) {
    const spots = look.spots;
    marks.push(...f.spots.map(([cx, cy, r]) => circle(cx, cy, r, spots, { opacity: 0.9 })));
  }
  const [ex, ey, er] = f.eye;
  return [
    path(f.tail, look.fin, out()),
    path(f.dorsal, look.fin, out()),
    path(f.body, look.body, out()),
    path(f.belly, look.belly),
    ...marks,
    path(f.fin, look.fin, out({ "stroke-width": 1 })),
    line(f.gill, LINE, 1, { opacity: 0.55 }),
    circle(ex, ey, er, "#ffffff", out({ "stroke-width": 0.9 })),
    circle(ex + 0.25, ey, er * 0.55, INK),
    shine(...f.shine, 0),
    ...(look.whiskers ? [whiskers(f.mouth)] : []),
  ];
}

/** An eel: one long ribbon in an S, darker along its back and pale beneath. */
function eelBody(look: FishLook): ArtShape[] {
  const spine = "M7 31c4-8 9-8.5 13-4.5s9 6.5 13 1.5 6.5-7.5 10.5-5.5";
  return [
    line(spine, LINE, 8.4),
    line(spine, look.body, 6.4),
    line("M8.2 32.4c4-7 8.8-7.4 12.4-3.8s8.8 6.2 12.6 1.4 6.6-7 9.8-5.4", look.belly, 2.2, {
      opacity: 0.85,
    }),
    line("M9.4 27.8c3.4-5 7.4-5 10.4-2.4", look.fin, 1.4),
    path("M7.6 30.6 3.4 33.8l4.8.8z", look.fin, out({ "stroke-width": 0.9 })),
    circle(40.6, 22.6, 1.2, "#ffffff", out({ "stroke-width": 0.8 })),
    circle(40.8, 22.6, 0.65, INK),
  ];
}

/** A fish from its look in the catalog: its outline, its colors, and its markings. */
function fishArt(look: FishLook): ArtShape[] {
  if (look.shape === "eel") return [shadow(17, 42), ...eelBody(look)];
  if (look.shape === "small") {
    // A minnow is a slim fish, small: each part drawn at the smaller size.
    const small = "translate(24 26) scale(0.72) translate(-24 -26)";
    return [shadow(10, 41), ...fishBody(look, FISH_FRAMES.slim).map((s) => group(small, [s]))];
  }
  return [shadow(look.shape === "long" ? 18 : 14, 42), ...fishBody(look, FISH_FRAMES[look.shape])];
}

/** A fishing rod: bamboo with a reel by its cork grip, its line hanging to a red and white float. */
function fishingRod(): ArtShape[] {
  const bamboo = "#c9a25a";
  return [
    shadow(14),
    line("M9 41 38 8", WOOD_DARK, 3.6),
    line("M9 41 38 8", bamboo, 2.2),
    line("M17.7 31.1l1.8 1.6M24 23.9l1.8 1.6M30.3 16.7l1.8 1.6", WOOD_DARK, 1),
    line("M9 41l5.4-6.2", "#b98a5a", 3.8),
    circle(16.6, 33.4, 3.1, "#9aa3a8", out()),
    circle(16.6, 33.4, 1.1, IRON),
    line("M38 8c2 6 3 13.5 2.6 21", "#e9e1d0", 0.8),
    circle(40.6, 31.4, 2.6, "#ffffff", out({ "stroke-width": 1 })),
    path("M38 31.4a2.6 2.6 0 0 1 5.2 0z", "#d1453b", out({ "stroke-width": 1 })),
  ];
}

/** Fried minnows: three golden little fish on a plate, with a sprig of herbs. */
function friedMinnows(): ArtShape[] {
  const crumb = "#d9a24a";
  const minnow = (x: number, y: number, turn: number): ArtShape =>
    group(`translate(${x} ${y}) rotate(${turn})`, [
      path("M-5 0l-2.6-2.2v4.4z", "#c48a36", out({ "stroke-width": 0.8 })),
      ellipse(0, 0, 5.4, 2.2, crumb, out({ "stroke-width": 1 })),
      line("M-2.2-.6h3", "#f2c97a", 0.8),
      circle(3.2, -0.5, 0.55, INK),
    ]);
  return [
    shadow(17, 42),
    ellipse(24, 33, 17.5, 7, "#e9e1d0", out()),
    ellipse(24, 32.6, 13, 4.8, PAPER2, out({ "stroke-width": 0.8 })),
    minnow(16.5, 31, -10),
    minnow(24.5, 29.4, 6),
    minnow(31.5, 32, -4),
    leaf(30, 27, 6, -60, LEAF),
    leaf(30.5, 27, 5, -10, MOSS_LIGHT),
  ];
}

/** Fish stew: a blue bowl of tomato broth with chunks of carp, a herb leaf, and steam. */
function fishStew(): ArtShape[] {
  return [
    shadow(15, 43),
    line(
      "M17 19c-1.5-2 1.5-3.5 0-6M24 18c-1.5-2 1.5-3.5 0-6M31 19c-1.5-2 1.5-3.5 0-6",
      "#c9c2b4",
      1.2,
      {
        opacity: 0.8,
      },
    ),
    path("M8 26h32c0 9-7 15.5-16 15.5S8 35 8 26z", "#5e7f9a", out()),
    line("M10.5 31c2.5 5 7.5 8 13.5 8", "#ffffff", 1.2, { opacity: 0.2 }),
    ellipse(24, 26, 16, 4.6, "#c8642f", out()),
    circle(18, 25.6, 1.7, "#f0d79a", out({ "stroke-width": 0.7 })),
    circle(26.5, 26.6, 1.5, "#f0d79a", out({ "stroke-width": 0.7 })),
    circle(22.4, 27.4, 1.1, "#f0d79a", out({ "stroke-width": 0.7 })),
    leaf(29, 25.4, 5.5, -25, LEAF),
  ];
}

// ---------- spring's and summer's decor ----------

/** A bird bath: a stone basin on a stem, with a little water and a bird on the rim. */
function birdBath(): ArtShape[] {
  const stone = BLOCK_COLORS.bird_bath;
  const deep = "#9aa6ae";
  return [
    shadow(14, 43),
    ellipse(24, 41, 9, 2.8, deep, out()),
    path("M20.5 40.5 22 24h4l1.5 16.5z", stone, out()),
    ellipse(24, 23, 14, 5, stone, out()),
    ellipse(24, 22.4, 10.5, 3.3, BATH_WATER, out({ "stroke-width": 0.9 })),
    ellipse(21, 21.8, 3, 1, "#ffffff", { opacity: 0.5 }),
    ellipse(33, 19.5, 3.4, 2.6, "#8a6a4a", out({ "stroke-width": 0.9 })),
    circle(35.6, 17.2, 2, "#8a6a4a", out({ "stroke-width": 0.9 })),
    path("M37.4 16.6 40 17.4l-2.6 1z", "#e2a33a"),
    circle(36.3, 16.8, 0.5, INK),
  ];
}

/** A beehive: a straw skep of three stacked bands on a board, with a bee over it. */
function beehive(): ArtShape[] {
  const straw = BLOCK_COLORS.beehive;
  const deep = "#b8882c";
  const band = (y: number, w: number, h: number) => rect(24 - w / 2, y, w, h, h / 2, straw, out());
  return [
    shadow(16, 43),
    path("M8 41h32l-2.5-4.5h-27z", "#b98a52", out()),
    band(31, 28, 6),
    band(25.5, 23, 6),
    band(20.5, 17, 5.5),
    ellipse(24, 18, 6, 3, straw, out()),
    line("M11 34h26M14 28.5h20M18 23.5h12", deep, 0.9, { opacity: 0.5 }),
    path("M21.5 41v-3.4a2.5 2.5 0 0 1 5 0V41z", WOOD_DARK, out({ "stroke-width": 0.9 })),
    ellipse(35, 14, 3, 2, "#f2c53d", out({ "stroke-width": 0.9 })),
    line("M33.6 13.2h2.8M33.9 15h2.6", INK, 0.7),
    ellipse(34.4, 11.4, 2, 1.1, "#ffffff", { opacity: 0.7, transform: "rotate(-25 34.4 11.4)" }),
  ];
}

// ---------- what the kitchen and the workbench make from the new crops ----------

/** Apple pie: a golden crust with a lattice over the filling, crimped round the edge. */
function applePie(): ArtShape[] {
  const crust = "#e0ad68";
  const crimps: ArtShape[] = [];
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * Math.PI * 2;
    const x = Math.round((24 + Math.cos(a) * 16.3) * 10) / 10;
    const y = Math.round((29 + Math.sin(a) * 6.4) * 10) / 10;
    crimps.push(circle(x, y, 1.9, crust, out({ "stroke-width": 0.8 })));
  }
  return [
    shadow(18, 42),
    path("M6 29v4.5c0 4.3 8 8 18 8s18-3.7 18-8V29z", "#bf8a46", out()),
    ellipse(24, 29, 18, 7.6, crust, out()),
    ellipse(24, 29, 14.6, 5.4, CROP_HEX.apple, out({ "stroke-width": 1 })),
    line("M11.5 27.4c7.4-2.4 17.6-2.4 25 0M13.5 31.6c6.6 2 14.4 2 21 0", crust, 2.6),
    line("M20 24.3c-1 3.4-1 6.2 0 9.4M28 24.3c1 3.4 1 6.2 0 9.4", crust, 2.6),
    ...crimps,
    shine(17, 26.8, 3, 1.1, 0),
  ];
}

/** Berry crumble: a clay dish of dark berries under golden crumbs. */
function berryCrumble(): ArtShape[] {
  const crumb = "#e2b878";
  const crumbs: readonly [number, number][] = [
    [17, 23.4],
    [21, 22.6],
    [25, 23],
    [29, 22.8],
    [32, 24],
    [19, 24.8],
    [27, 24.6],
  ];
  return [
    shadow(16, 43),
    path("M10 26h28l-2.5 13a4 4 0 0 1-4 3.4H16.5a4 4 0 0 1-4-3.4z", CLAY, out()),
    line("M13.5 31.5h21", "#ffffff", 1.2, { opacity: 0.25 }),
    ellipse(24, 26, 14.4, 4.4, CLAY_DEEP, out()),
    ellipse(24, 25.6, 11.5, 3.4, CROP_HEX.blackberry, out({ "stroke-width": 1 })),
    circle(18.5, 25, 2.2, CROP_HEX.blueberry, out({ "stroke-width": 0.8 })),
    circle(28.5, 26, 2, CROP_HEX.blackberry, out({ "stroke-width": 0.8 })),
    ...crumbs.map(([x, y]) => circle(x, y, 1.6, crumb, out({ "stroke-width": 0.7 }))),
  ];
}

/** Fruit salad: a glass bowl of cherry, peach, melon, and a berry, with a mint leaf. */
function fruitSalad(): ArtShape[] {
  return [
    shadow(15, 43),
    path("M11 25.5h26c0 9-5.5 16-13 16s-13-7-13-16z", GLASS, out()),
    line("M14.5 30.5c1.6 4.6 5 7.8 9 8.8", "#ffffff", 1.4, { opacity: 0.4 }),
    ellipse(24, 25.5, 13, 3.4, "#eaf6f5", out()),
    ellipse(24, 32, 5.4, 3, CROP_HEX.melon, out({ "stroke-width": 0.9 })),
    circle(19, 27, 3, CROP_HEX.cherry, out({ "stroke-width": 0.9 })),
    circle(28.8, 27.6, 3.4, CROP_HEX.peach, out({ "stroke-width": 0.9 })),
    circle(24, 24.6, 2.4, CROP_HEX.blueberry, out({ "stroke-width": 0.9 })),
    leaf(30.5, 23, 6, -55, MOSS_LIGHT),
  ];
}

/** Corn bread: a golden loaf with a split crust and kernels pressed into it. */
function cornBread(): ArtShape[] {
  return [
    shadow(17, 43),
    path("M8 41c-1-9 1-16 6-19.5 6-4 14-4 20 0 5 3.5 7 10.5 6 19.5z", "#e5a63c", out()),
    path("M10.5 28c4-3.4 23-3.4 27 0", "none", out({ stroke: "#f2cd6a", "stroke-width": 3 })),
    line("M12.5 36h23", "#c98a2c", 1.2, { opacity: 0.5 }),
    circle(21, 25.4, 1.5, CROP_HEX.corn, out({ "stroke-width": 0.7 })),
    circle(28, 25, 1.5, CROP_HEX.corn, out({ "stroke-width": 0.7 })),
    circle(18, 32, 1.3, "#f7e3a6", { opacity: 0.85 }),
    circle(25.5, 34, 1.2, "#f7e3a6", { opacity: 0.85 }),
    circle(31, 31, 1.2, "#f7e3a6", { opacity: 0.85 }),
  ];
}

/** Garden salad: a bowl of cabbage leaves with carrot and tomato. */
function gardenSalad(): ArtShape[] {
  return [
    shadow(15, 43),
    path("M10 26h28c0 9-6 16-14 16s-14-7-14-16z", PAPER2, out()),
    line("M13.5 31c1.6 5 5.6 8.6 10.4 9.4", "#ffffff", 1.4, { opacity: 0.35 }),
    ellipse(24, 26, 14, 4, "#e9e1d0", out()),
    leaf(15, 25.5, 11, -40, CROP_HEX.cabbage),
    leaf(27, 24.5, 12, -150, MOSS_LIGHT),
    leaf(22, 23.8, 10, -70, LEAF),
    path("M28.6 23.4 33.4 24.8 30 27.4z", CROP_HEX.carrot, out({ "stroke-width": 0.8 })),
    circle(19.5, 24.8, 2.6, CROP_HEX.tomato, out({ "stroke-width": 0.9 })),
  ];
}

/** A posy: two tulips and a sunflower tied in paper. */
function posy(): ArtShape[] {
  const tulip = (x: number, y: number, turn: number): ArtShape =>
    group(`translate(${x} ${y}) rotate(${turn})`, [
      path(
        "M-3.6-4.4c0 5 1.6 7.4 3.6 7.4s3.6-2.4 3.6-7.4l-2 2.4-1.6-3-1.6 3z",
        CROP_HEX.tulip,
        out({ "stroke-width": 1 }),
      ),
    ]);
  const petals = [0, 60, 120, 180, 240, 300].map((a) =>
    ellipse(24, 9.5, 2, 3.6, CROP_HEX.sunflower, {
      transform: `rotate(${a} 24 14)`,
      ...out({ "stroke-width": 0.9 }),
    }),
  );
  return [
    shadow(11, 44),
    line("M24 34 18 18M24 34V16M24 34l7-15", STEM, 1.6),
    leaf(22, 26, 8, -150),
    leaf(26.5, 25, 8, -30),
    tulip(18, 15, -14),
    tulip(31, 16, 14),
    ...petals,
    circle(24, 14, 3, "#8a5a2a", out({ "stroke-width": 0.9 })),
    path("M17.5 33h13l-2 9.5h-9z", KRAFT, out()),
    line("M17.2 35.6c4.4 1.6 9.8 1.6 14 0", CLAY, 2),
  ];
}

// ---------- the catalog ----------

/**
 * Items with their own drawing (`drawn` looks in the catalog): the pantry's staples, materials,
 * decor, furniture, made things that no template draws, finds (RFC 0021), and the fishing rod and
 * what the kitchen cooks from fish (RFC 0023).
 */
// ---------- made materials (RFC 0041) ----------

/**
 * Walls and windows made at a workbench. Each is drawn as a small stack of what you would place,
 * rather than as a finished wall, because that is what you hold: the picture has to read at 28px
 * in the build bar and in your things, so each leans on one shape (a course of bricks, a beam, a
 * bleached plank, a pane) and its own color rather than on detail.
 */
function plaster(): ArtShape[] {
  const face = BLOCK_COLORS.plaster;
  return [
    shadow(15, 42),
    rect(8, 14, 32, 26, 3, face, out()),
    // A trowel's sweep across the face, so it reads as plaster rather than as pale stone.
    line("M12 22q7 -3 13 0t11 -1", "#d8cdb8", 1.6),
    line("M12 30q8 3 14 0t10 1", "#d8cdb8", 1.6),
    rect(8, 14, 32, 5, 3, "#f6f1e6"),
  ];
}

function brickwork(): ArtShape[] {
  const face = BLOCK_COLORS.brickwork;
  const dark = "#8f4231";
  const brickAt = (x: number, y: number, w: number) =>
    rect(x, y, w, 7, 1.5, face, out({ "stroke-width": 1.1 }));
  return [
    shadow(15, 42),
    // Three courses, offset like real bonding: the offset is what says "brick" at a glance.
    brickAt(7, 15, 17),
    brickAt(26, 15, 15),
    brickAt(7, 24, 15),
    brickAt(24, 24, 17),
    brickAt(7, 33, 17),
    brickAt(26, 33, 15),
    line("M7 23h34M7 32h34", dark, 1),
  ];
}

function timberFrame(): ArtShape[] {
  const beam = BLOCK_COLORS.timber_frame;
  return [
    shadow(15, 42),
    // Plaster behind, dark beams over it: the beams are what the eye reads, so they go on top.
    rect(8, 14, 32, 26, 3, BLOCK_COLORS.plaster, out()),
    line("M12 14v26M36 14v26", beam, 3.4),
    line("M8 26h32", beam, 3),
    line("M12 14 36 26", beam, 2.6),
  ];
}

function driftwoodPlank(): ArtShape[] {
  const wash = BLOCK_COLORS.driftwood_plank;
  const grain = "#9a948a";
  const plank = (y: number) => rect(7, y, 34, 8, 2.5, wash, out({ "stroke-width": 1.1 }));
  return [
    shadow(15, 42),
    plank(15),
    plank(26),
    // Salt-worn grain, drawn as a long split rather than straight lines: it is wood the sea had.
    line("M11 19q9 -2 14 1t15 -1", grain, 1.2),
    line("M11 30q10 2 15 -1t14 1", grain, 1.2),
    line("M20 15v8M31 26v8", grain, 1),
  ];
}

function seaGlassPane(): ArtShape[] {
  const glass = BLOCK_COLORS.sea_glass_pane;
  return [
    shadow(14, 42),
    // A pane in a frame, with the sea in it: greener than glass, and see-through where it shines.
    rect(9, 12, 30, 28, 2.5, glass, out({ opacity: 0.92 })),
    line("M24 12v28M9 26h30", "#e8f2ee", 1.8),
    shine(16, 19, 4.5, 2.4),
    ellipse(31, 33, 3.4, 2, "#ffffff", { opacity: 0.3, transform: "rotate(-24 31 33)" }),
  ];
}

// ---------- roomier homes (RFC 0050) ----------

/** A desk: a long top, a leg at one end and two drawers at the other. */
function desk(): ArtShape[] {
  const wood = BLOCK_COLORS.desk;
  return [
    shadow(18, 43),
    rect(9, 24, 4, 18, 1, WOOD_DARK, out({ "stroke-width": 1 })),
    rect(26, 24, 13, 18, 1.5, wood, out()),
    rect(28, 27, 9, 5, 0.8, WOOD_DARK, { opacity: 0.55 }),
    rect(28, 34, 9, 5, 0.8, WOOD_DARK, { opacity: 0.55 }),
    circle(32.5, 29.5, 0.9, SUN),
    circle(32.5, 36.5, 0.9, SUN),
    rect(5, 18, 38, 7, 2, wood, out()),
    line("M8 20.5h32", "#ffffff", 1, { opacity: 0.35 }),
  ];
}

/** A side table: a small top on four slim legs, lower than a table. */
function sideTable(): ArtShape[] {
  const wood = BLOCK_COLORS.side_table;
  return [
    shadow(12, 43),
    rect(15, 27, 3, 15, 1, WOOD_DARK, out({ "stroke-width": 0.9 })),
    rect(30, 27, 3, 15, 1, WOOD_DARK, out({ "stroke-width": 0.9 })),
    rect(17, 32, 14, 2.5, 0.8, WOOD, out({ "stroke-width": 0.8 })),
    rect(11, 22, 26, 6, 3, wood, out()),
    line("M14 24h20", "#ffffff", 1, { opacity: 0.4 }),
  ];
}

/** A dresser: a chest of three drawers with brass knobs. */
function dresser(): ArtShape[] {
  const wood = BLOCK_COLORS.dresser;
  const drawer = (y: number): ArtShape[] => [
    rect(12, y, 24, 8, 1, WOOD_DARK, { opacity: 0.5 }),
    circle(24, y + 4, 1.2, SUN, out({ "stroke-width": 0.6 })),
  ];
  return [
    shadow(16, 44),
    rect(9, 12, 30, 31, 2, wood, out()),
    rect(8, 10, 32, 4, 1.5, wood, out()),
    ...drawer(16),
    ...drawer(25),
    ...drawer(34),
    line("M11 12h26", "#ffffff", 1, { opacity: 0.35 }),
  ];
}

/** A candle: a cream stick in a little brass holder, lit. */
function candle(): ArtShape[] {
  return [
    shadow(9, 42),
    ellipse(24, 39, 9, 2.5, LID, out()),
    rect(20, 18, 8, 21, 1.5, LINEN, out()),
    line("M24 18v-3", INK, 1),
    path("M24 6c3 4 3.5 6.5 0 9.5-3.5-3-3-5.5 0-9.5z", SUN, out({ "stroke-width": 0.8 })),
    path("M24 9.5c1.3 2 1.4 3.2 0 4.5-1.4-1.3-1.3-2.5 0-4.5z", "#fff6d6"),
    line("M22 21v14", "#ffffff", 1.2, { opacity: 0.5 }),
  ];
}

/** A table lamp: a cloth shade on a round base, glowing. */
function tableLamp(): ArtShape[] {
  return [
    shadow(10, 43),
    ellipse(24, 40, 9, 2.6, CLAY_DEEP, out()),
    rect(23, 22, 2.5, 18, 1, WOOD_DARK),
    path("M14 23 18 8h12l4 15z", KRAFT, out()),
    path("M17 21 20 10h8l3 11z", "#fff1c4", { opacity: 0.6 }),
    line("M15 21h18", CLAY, 1.4, { opacity: 0.7 }),
  ];
}

/** A stack of books, three spines and a ribbon. */
function bookStack(): ArtShape[] {
  return [
    shadow(15, 43),
    rect(10, 33, 28, 8, 1.2, ROSE, out()),
    rect(13, 25, 24, 8, 1.2, SKY, out()),
    rect(9, 17, 27, 8, 1.2, MOSS, out()),
    line("M12 37h24M15 29h20M11 21h23", PAPER, 1, { opacity: 0.55 }),
    path("M30 17v-6l2 2 2-2v6", SUN, out({ "stroke-width": 0.8 })),
  ];
}

/** A potted fern in a clay pot. */
function pottedFern(): ArtShape[] {
  const frond = (d: string) => path(d, LEAF, out({ "stroke-width": 0.9 }));
  return [
    shadow(11, 43),
    frond("M24 28C18 22 10 20 6 22c5-6 13-5 18 6z"),
    frond("M24 28c6-6 14-8 18-6-5-6-13-5-18 6z"),
    frond("M24 28c-3-8-2-16 1-21 3 6 3 14-1 21z"),
    line("M24 28 17 18M24 28l7-10", STEM, 1, { opacity: 0.7 }),
    path("M15 28h18l-3 14H18z", CLAY, out()),
    rect(14, 27, 20, 4, 1.2, CLAY_DEEP, out()),
  ];
}

/** A jar of seashells, with a cork. */
function jarOfShells(): ArtShape[] {
  return [
    shadow(11, 43),
    rect(14, 13, 20, 29, 4, GLASS, out({ opacity: 0.95 })),
    path("M18 38c0-4 3-6 6-6s6 2 6 6z", "#f3d6c4", out({ "stroke-width": 0.8 })),
    path("M17 31c2-3 5-3 7 0-2 3-5 3-7 0z", ROSE, out({ "stroke-width": 0.8 })),
    path("M25 26c2-3 6-3 7 0-1 3-5 3-7 0z", PAPER, out({ "stroke-width": 0.8 })),
    rect(17, 8, 14, 6, 1.5, KRAFT, out()),
    shine(19, 22, 1.6, 5),
  ];
}

/** A teacup on its saucer, with steam. */
function teacup(): ArtShape[] {
  return [
    shadow(13, 42),
    ellipse(24, 38, 14, 3.5, PAPER, out()),
    path("M13 24h20c0 8-4 13-10 13s-10-5-10-13z", PAPER, out()),
    path("M33 26c4 0 5 5 0 6", "none", { stroke: INK, "stroke-width": 1.6, fill: "none" }),
    line("M15 27h16", SKY, 1.6),
    line("M20 19c-2-3 2-4 0-7M26 19c-2-3 2-4 0-7", LINE, 1.1, { opacity: 0.5 }),
  ];
}

/** A globe on a stand. */
function globe(): ArtShape[] {
  return [
    shadow(10, 43),
    ellipse(24, 40, 8, 2.4, WOOD_DARK, out()),
    rect(23, 33, 2.5, 7, 1, WOOD_DARK),
    circle(24, 20, 12, SKY, out()),
    path("M17 13c3 1 5 4 3 7s1 6-2 8c-3-3-4-10-1-15z", MOSS_LIGHT, { opacity: 0.95 }),
    path("M27 11c3 1 6 5 5 9-3-1-5-1-6-4s-1-3 1-5z", MOSS_LIGHT, { opacity: 0.95 }),
    path("M12 21a12 12 0 0 0 20 9", "none", { stroke: LID, "stroke-width": 1.6, fill: "none" }),
    shine(19, 14, 3, 1.6),
  ];
}

/** A music box with its lid up and a little brass comb. */
function musicBox(): ArtShape[] {
  return [
    shadow(15, 43),
    path("M11 22 14 10h20l3 12z", PLUM, out()),
    rect(10, 22, 28, 18, 2, PLUM, out()),
    rect(14, 25, 20, 6, 1, LID, out({ "stroke-width": 0.8 })),
    line("M17 25v6M20 25v6M23 25v6M26 25v6M29 25v6", WOOD_DARK, 0.6, { opacity: 0.6 }),
    rect(21, 34, 6, 3, 1, SUN),
    line("M14 14h20", "#ffffff", 1, { opacity: 0.3 }),
  ];
}

/** A round wall clock with a wooden rim. */
function wallClock(): ArtShape[] {
  return [
    circle(24, 23, 17, WOOD, out()),
    circle(24, 23, 13.5, PAPER, out({ "stroke-width": 1 })),
    line("M24 12v2M24 32v2M13 23h2M33 23h2", INK, 1.2),
    line("M24 23v-7M24 23l5 3", INK, 1.6),
    circle(24, 23, 1.2, CLAY),
    shine(18, 16, 3, 1.5),
  ];
}

/** An oval mirror in a gilt frame. */
function mirror(): ArtShape[] {
  return [
    ellipse(24, 24, 13, 18, LID, out()),
    ellipse(24, 24, 10, 15, GLASS, out({ "stroke-width": 0.8 })),
    path("M19 14c-3 4-3 12 0 16", "none", {
      stroke: "#ffffff",
      "stroke-width": 2,
      fill: "none",
      opacity: 0.7,
    }),
    circle(24, 5, 1.6, LID, out({ "stroke-width": 0.6 })),
  ];
}

/** A wreath of greenery with berries and a bow. */
function wreath(): ArtShape[] {
  return [
    circle(24, 24, 16, LEAF, out()),
    circle(24, 24, 8.5, MOSS, out()),
    circle(24, 24, 6, "#fbf4e6"),
    circle(14, 18, 1.8, ROSE),
    circle(33, 17, 1.8, ROSE),
    circle(31, 32, 1.8, ROSE),
    circle(17, 33, 1.8, ROSE),
    path("M24 36l-5 6 1-7zM24 36l5 6-1-7z", CLAY, out({ "stroke-width": 0.8 })),
    circle(24, 36, 2, CLAY, out({ "stroke-width": 0.8 })),
  ];
}

/** A wall shelf on two brackets, with a little jar and a book. */
function wallShelf(): ArtShape[] {
  return [
    rect(18, 18, 6, 9, 1, CLAY, out({ "stroke-width": 0.8 })),
    rect(27, 15, 4, 12, 0.6, SKY, out({ "stroke-width": 0.8 })),
    rect(6, 27, 36, 5, 1.2, WOOD, out()),
    path("M11 32v6l5-6zM37 32v6l-5-6z", WOOD_DARK, out({ "stroke-width": 0.8 })),
    line("M9 28.5h30", "#ffffff", 1, { opacity: 0.35 }),
  ];
}

/** A wall sconce: a brass back plate and a little shaded light. */
function sconce(): ArtShape[] {
  return [
    rect(20, 18, 8, 20, 3, LID, out()),
    path("M24 28h6v-3", "none", { stroke: LID, "stroke-width": 2, fill: "none" }),
    path("M25 25 28 12h8l3 13z", KRAFT, out()),
    path("M28 23 30 14h4l2 9z", "#fff1c4", { opacity: 0.7 }),
  ];
}

/** A pennant on a little rod, in the town's clay and sun. */
function pennant(): ArtShape[] {
  return [
    line("M8 12h32", WOOD_DARK, 2.2),
    path("M11 13h26L24 40z", CLAY, out()),
    path("M15 13h18l-9 13z", SUN, { opacity: 0.85 }),
    line("M24 8v4", WOOD_DARK, 1.2),
  ];
}

/** A map of the town, pinned up: the Commons in the middle and paths out. */
function wallMap(): ArtShape[] {
  return [
    rect(7, 9, 34, 30, 1.5, KRAFT, out()),
    rect(20, 19, 8, 8, 1, MOSS_LIGHT, out({ "stroke-width": 0.8 })),
    line("M7 23h13M28 23h13M24 9v10M24 27v12", CLAY, 1.6, { "stroke-dasharray": "2 1.4" }),
    path("M10 12h7v5h-7zM31 30h7v6h-7zM31 12h7v4h-7z", SKY, { opacity: 0.6 }),
    circle(24, 23, 1.6, ROSE),
    circle(9.5, 11, 1.2, CLAY_DEEP),
    circle(38.5, 11, 1.2, CLAY_DEEP),
  ];
}

// ---------- cozy homes (RFC 0044) ----------

/** A plump square cushion with a button in the middle, the pale piping the furniture wears. */
function cushion(): ArtShape[] {
  const cloth = BLOCK_COLORS.armchair;
  return [
    shadow(14, 41),
    path("M10 15c5-3 23-3 28 0 3 5 3 16 0 21-5 3-23 3-28 0-3-5-3-16 0-21z", cloth, out()),
    path("M12.5 17c4.5-2 18.5-2 23 0 2 4.5 2 13 0 17-4.5 2-18.5 2-23 0-2-4-2-12.5 0-17z", "none", {
      stroke: LINEN,
      "stroke-width": 1.2,
      "stroke-dasharray": "2 1.6",
    }),
    circle(24, 25.5, 1.8, LINEN, out({ "stroke-width": 0.8 })),
    line("M14 19.5c4-1.4 9-1.6 12-1.2", "#ffffff", 1.2, { opacity: 0.4 }),
  ];
}

/** An armchair: a high back, two round arms, and a cushion on the seat, on short wooden feet. */
function armchair(): ArtShape[] {
  const cloth = BLOCK_COLORS.armchair;
  return [
    shadow(15, 43),
    rect(13, 38, 3.5, 5, 1, WOOD_DARK, out({ "stroke-width": 1 })),
    rect(31.5, 38, 3.5, 5, 1, WOOD_DARK, out({ "stroke-width": 1 })),
    path("M13 26V12c0-4 22-4 22 0v14z", cloth, out()),
    rect(9, 23, 8, 16, 3.5, cloth, out()),
    rect(31, 23, 8, 16, 3.5, cloth, out()),
    rect(15, 28, 18, 10, 2.5, cloth, out()),
    line("M16 29.5h16", LINEN, 1.2, { opacity: 0.9 }),
    line("M16 11.5c4-1.5 12-1.5 16 0", "#ffffff", 1.2, { opacity: 0.35 }),
  ];
}

/** A sofa: a long back, two arms, and two seat cushions, on short wooden feet. */
function sofa(): ArtShape[] {
  const cloth = BLOCK_COLORS.sofa;
  return [
    shadow(20, 41),
    rect(7, 36, 3.5, 5, 1, WOOD_DARK, out({ "stroke-width": 1 })),
    rect(37.5, 36, 3.5, 5, 1, WOOD_DARK, out({ "stroke-width": 1 })),
    path("M7 27V17c0-3.5 34-3.5 34 0v10z", cloth, out()),
    rect(3, 24, 7, 14, 3, cloth, out()),
    rect(38, 24, 7, 14, 3, cloth, out()),
    rect(9.5, 28, 14.5, 9, 2, cloth, out()),
    rect(24, 28, 14.5, 9, 2, cloth, out()),
    line("M11 29.5h11.5M25.5 29.5h11.5", LINEN, 1.2, { opacity: 0.9 }),
    line("M10 16.8c8-1.6 20-1.6 28 0", "#ffffff", 1.2, { opacity: 0.35 }),
  ];
}

/** A bed seen from the foot: a wooden headboard, a pillow, and a quilt turned down over a sheet. */
function bed(): ArtShape[] {
  const quilt = BLOCK_COLORS.bed;
  return [
    shadow(19, 43),
    path("M8 26V12c0-4.5 32-4.5 32 0v14z", WOOD, out()),
    line("M12 11.5c6-1.8 18-1.8 24 0", "#ffffff", 1.1, { opacity: 0.3 }),
    rect(13, 17, 22, 7, 3.2, PAPER, out({ "stroke-width": 1 })),
    rect(6, 23, 36, 8, 2, LINEN, out()),
    path("M6 27h36v9.5a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2z", quilt, out()),
    line("M7 28.6h34", LINEN, 1.3),
    line("M15 32v5M24 32v5M33 32v5", "#ffffff", 0.9, { opacity: 0.3 }),
    rect(6, 38.5, 4, 4.5, 1, WOOD_DARK, out({ "stroke-width": 1 })),
    rect(38, 38.5, 4, 4.5, 1, WOOD_DARK, out({ "stroke-width": 1 })),
  ];
}

// ---------- more for a home ----------

/** A wardrobe: a tall cabinet with a crown on top and two doors with brass knobs. */
function wardrobe(): ArtShape[] {
  const wood = BLOCK_COLORS.wardrobe;
  return [
    shadow(16, 44),
    rect(11, 40, 3.5, 4, 1, WOOD_DARK, out({ "stroke-width": 1 })),
    rect(33.5, 40, 3.5, 4, 1, WOOD_DARK, out({ "stroke-width": 1 })),
    rect(10, 7, 28, 34, 2, wood, out()),
    rect(12.5, 10, 10, 28, 1, WOOD_DARK, { opacity: 0.3 }),
    rect(25.5, 10, 10, 28, 1, WOOD_DARK, { opacity: 0.3 }),
    line("M24 9v31", WOOD_DARK, 1, { opacity: 0.6 }),
    circle(22, 24, 1.1, SUN, out({ "stroke-width": 0.6 })),
    circle(26, 24, 1.1, SUN, out({ "stroke-width": 0.6 })),
    rect(8, 4, 32, 4.5, 1.5, wood, out()),
    line("M10.5 5.8h27", "#ffffff", 1, { opacity: 0.35 }),
  ];
}

/** A rocking chair: a spindle back, a seat, and two curved rockers under its legs. */
function rockingChair(): ArtShape[] {
  const wood = BLOCK_COLORS.rocking_chair;
  const spindle = (x: number): ArtShape =>
    rect(x, 11, 2, 16, 0.8, wood, out({ "stroke-width": 0.8 }));
  return [
    shadow(15, 44),
    rect(14, 5, 4, 26, 1.2, wood, out({ "stroke-width": 1 })),
    rect(30, 5, 4, 26, 1.2, wood, out({ "stroke-width": 1 })),
    spindle(19.5),
    spindle(23),
    spindle(26.5),
    rect(13, 7, 22, 4.5, 1.4, wood, out({ "stroke-width": 1 })),
    rect(14.5, 31, 3, 8.5, 1, WOOD_DARK, out({ "stroke-width": 1 })),
    rect(30.5, 31, 3, 8.5, 1, WOOD_DARK, out({ "stroke-width": 1 })),
    rect(11, 26, 26, 5.5, 1.8, wood, out()),
    line("M13 27.8h22", "#ffffff", 1, { opacity: 0.35 }),
    line("M6 37.5c7 6 29 6 36 0", LINE, 4),
    line("M6 37.5c7 6 29 6 36 0", WOOD_DARK, 2.4),
  ];
}

/** An upright piano: a dark case, a page of music, white keys with black ones, and a pedal. */
function piano(): ArtShape[] {
  const body = BLOCK_COLORS.piano;
  return [
    shadow(18, 44),
    rect(10, 39, 3, 5, 1, body, out({ "stroke-width": 1 })),
    rect(35, 39, 3, 5, 1, body, out({ "stroke-width": 1 })),
    rect(9, 29, 30, 11, 1.5, body, out()),
    rect(8, 8, 32, 17, 2, body, out()),
    rect(19, 11, 10, 8, 0.6, PAPER, out({ "stroke-width": 0.8 })),
    line("M21 13.5h6M21 16h6", LINE, 0.7, { opacity: 0.7 }),
    rect(6, 5.5, 36, 4, 1.5, body, out()),
    rect(5, 24, 38, 6.5, 1, PAPER, out()),
    line(
      "M10 24.5v5.5M14.5 24.5v5.5M19 24.5v5.5M24 24.5v5.5M29 24.5v5.5M33.5 24.5v5.5M38 24.5v5.5",
      LINE,
      0.6,
      {
        opacity: 0.6,
      },
    ),
    ...[11.5, 16, 25.5, 30, 34.5].map((x) => rect(x, 24.5, 2.2, 3.4, 0.4, INK)),
    rect(22, 38, 4, 2, 0.8, SUN, out({ "stroke-width": 0.6 })),
    line("M10 7.3h28", "#ffffff", 1, { opacity: 0.25 }),
  ];
}

/** A bathtub: a deep enamel tub on four brass feet, a tap at one end, and bubbles over the rim. */
function bathtub(): ArtShape[] {
  const enamel = BLOCK_COLORS.bathtub;
  return [
    shadow(19, 43),
    circle(12, 40, 2.2, LID, out({ "stroke-width": 0.8 })),
    circle(36, 40, 2.2, LID, out({ "stroke-width": 0.8 })),
    line("M39.5 19V12a2.5 2.5 0 0 0-2.5-2.5h-3", IRON, 1.8),
    path("M5 21h38c0 9-4 17-11 18H16C9 38 5 30 5 21z", enamel, out()),
    circle(14, 17.5, 2.6, "#ffffff", out({ "stroke-width": 0.8 })),
    circle(18.5, 15, 1.8, "#ffffff", out({ "stroke-width": 0.8 })),
    circle(29, 17, 2.2, "#ffffff", out({ "stroke-width": 0.8 })),
    rect(3.5, 18.5, 41, 4, 2, enamel, out()),
    rect(7, 19.4, 34, 1.6, 0.8, "#9fd3e0"),
    line("M10 25c1 5 3 9 7 11", "#ffffff", 1.2, { opacity: 0.6 }),
  ];
}

/** A fireplace: a stone hearth under a wooden mantel, with logs burning in its arch. */
function fireplace(): ArtShape[] {
  const stone = BLOCK_COLORS.fireplace;
  return [
    shadow(19, 44),
    circle(24, 32, 15, BLOCK_COLORS.lantern, { opacity: 0.14 }),
    rect(6, 10, 36, 33, 2, stone, out()),
    path(
      "M6.5 19h7M34.5 19h7M6.5 27h7M34.5 27h7M6.5 35h7M34.5 35h7M10 12v7M38 12v7M10 27v8M38 27v8",
      "none",
      out({ stroke: STONE_LO, "stroke-width": 1 }),
    ),
    path("M14 43V28c0-6 4.5-9 10-9s10 3 10 9v15z", "#3a2a22", out()),
    path(
      "M24 25c3.5 4 6 7 6 10.5 0 3-2.7 5-6 5s-6-2-6-5c0-2.5 2-4 2.6-6 1 1.6 2 2 2 2 0-2.6.3-4.5 1.4-6.5z",
      BLOCK_COLORS.campfire,
      out({ "stroke-width": 1 }),
    ),
    path(
      "M24 31c1.8 2 3 3.6 3 5.4 0 1.7-1.3 2.8-3 2.8s-3-1.1-3-2.8c0-1.4 1-2.2 1.4-3.2.6.8 1 1 1 1 0-1.2.2-2.2.6-3.2z",
      SUN,
    ),
    line("M16 42 32 39", WOOD, 3),
    line("M17 39 31 42", WOOD_DARK, 3),
    rect(3, 7, 42, 5, 1.5, WOOD, out()),
    line("M5 8.8h38", "#ffffff", 1, { opacity: 0.35 }),
  ];
}

/** An aquarium: a glass tank of water on a wooden stand, with weed, sand, two fish and bubbles. */
function aquarium(): ArtShape[] {
  const water = BLOCK_COLORS.aquarium;
  return [
    shadow(18, 44),
    rect(9, 31, 30, 12, 1.5, WOOD, out()),
    line("M24 32.5v9", WOOD_DARK, 0.9, { opacity: 0.45 }),
    rect(6, 10, 36, 22, 2, water, out()),
    line("M7.5 14h33", "#ffffff", 1, { opacity: 0.6 }),
    rect(7, 27.5, 34, 3.5, 1, KRAFT),
    line("M13 28c-2-4 2-7 0-11M16.5 28c1-3-1-5 1-8", STEM, 1.5),
    path("M23.5 20l-3-2.5v5z", CLAY, out({ "stroke-width": 0.8 })),
    ellipse(27.5, 20, 4, 2.6, SUN, out({ "stroke-width": 0.8 })),
    circle(29.5, 19.4, 0.6, INK),
    path("M38.5 25l2-1.8v3.6z", ROSE, out({ "stroke-width": 0.7 })),
    ellipse(35.5, 25, 2.8, 1.8, ROSE, out({ "stroke-width": 0.7 })),
    circle(31.5, 15.5, 1, "#ffffff", { opacity: 0.85 }),
    circle(33, 12.5, 0.8, "#ffffff", { opacity: 0.85 }),
    rect(5, 8.5, 38, 3, 1, WOOD_DARK, out({ "stroke-width": 1 })),
    shine(11.5, 20, 1.4, 5, 0),
  ];
}

/** A coffee table: a long low top on four short legs, with a shelf under it. */
function coffeeTable(): ArtShape[] {
  const wood = BLOCK_COLORS.coffee_table;
  return [
    shadow(19, 42),
    rect(9, 30, 4, 11, 1, WOOD_DARK, out({ "stroke-width": 1 })),
    rect(35, 30, 4, 11, 1, WOOD_DARK, out({ "stroke-width": 1 })),
    rect(11, 35, 26, 3, 0.8, WOOD, out({ "stroke-width": 0.8 })),
    rect(5, 26, 38, 6, 3, wood, out()),
    line("M8 28h32", "#ffffff", 1, { opacity: 0.35 }),
  ];
}

/** A coat rack: a turned pole on three feet, with a coat on one hook and a scarf on the other. */
function coatRack(): ArtShape[] {
  const wood = BLOCK_COLORS.coat_rack;
  return [
    shadow(11, 44),
    line("M13.5 43.5 24 38.5l10.5 5M24 38.5v5", wood, 2.6),
    rect(22.5, 7, 3, 33, 1.2, wood, out({ "stroke-width": 1 })),
    circle(24, 6, 2.3, wood, out({ "stroke-width": 1 })),
    line("M23 12.5c-4 0-6.5-1-7.5-3.5M25 12.5c4 0 6.5-1 7.5-3.5", wood, 1.8),
    path("M15 9.5c-1.5 5-1 12 0 18h3.4c-.8-6-.8-12 .4-17.5z", ROSE, out({ "stroke-width": 1 })),
    line("M15.5 24.5h3M15.4 26.3h3", PAPER, 0.8, { opacity: 0.8 }),
    path("M31 10c3.5 0 6 2.5 6.5 6l1 15c-3 1.5-7.5 1.5-10.5 0l1-15c.2-3 .8-5 2-6z", DENIM, out()),
    line("M33 13v17", LINE, 0.8, { opacity: 0.5 }),
    circle(34.5, 18, 0.8, PAPER),
    circle(34.5, 23, 0.8, PAPER),
  ];
}

/** A floor lamp: a tall pole on a round stone foot, under a cloth shade lit from inside. */
function floorLamp(): ArtShape[] {
  const shade = BLOCK_COLORS.floor_lamp;
  return [
    shadow(10, 44),
    circle(24, 13, 12, BLOCK_COLORS.lantern, { opacity: 0.2 }),
    rect(22.8, 17, 2.4, 24, 1, WOOD_DARK, out({ "stroke-width": 0.9 })),
    ellipse(24, 41.5, 7, 2.5, STONE_HI, out()),
    ellipse(24, 18.5, 5.5, 1.6, "#fff3c4"),
    path("M15.5 18.5 19.5 5h9l4 13.5z", shade, out()),
    line("M16.3 16.8h15.4", CLAY, 1.2),
    line("M28.5 19v4", LINE, 0.8),
    circle(28.5, 23.6, 0.9, LID),
    shine(21.3, 11, 1, 4, 14),
  ];
}

/** A potted tree: a little oak grown from an acorn, in a hooped wooden tub. */
function pottedTree(): ArtShape[] {
  return [
    shadow(13, 44),
    rect(22.5, 19, 3, 14, 1, WOOD_DARK, out({ "stroke-width": 0.9 })),
    circle(17, 19, 6.5, LEAF, out()),
    circle(31, 19, 6.5, LEAF, out()),
    circle(24, 13, 9.5, LEAF, out()),
    circle(20.5, 10.5, 3, MOSS_LIGHT, { opacity: 0.55 }),
    circle(19, 19.5, 1, CLAY_DEEP),
    circle(29, 15.5, 1, CLAY_DEEP),
    path("M14 32h20l-2 11H16z", WOOD, out()),
    line("M14.8 37.5h18.4", IRON, 1.6),
    rect(12.5, 30, 23, 4, 1.2, WOOD, out()),
    line("M14.5 31.5h19", "#ffffff", 1, { opacity: 0.35 }),
  ];
}

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
  plaster,
  brickwork,
  timber_frame: timberFrame,
  driftwood_plank: driftwoodPlank,
  sea_glass_pane: seaGlassPane,
  cushion,
  armchair,
  sofa,
  bed,
  desk,
  side_table: sideTable,
  dresser,
  wardrobe,
  rocking_chair: rockingChair,
  piano,
  bathtub,
  fireplace,
  aquarium,
  coffee_table: coffeeTable,
  coat_rack: coatRack,
  floor_lamp: floorLamp,
  potted_tree: pottedTree,
  candle,
  table_lamp: tableLamp,
  book_stack: bookStack,
  potted_fern: pottedFern,
  jar_of_shells: jarOfShells,
  teacup,
  globe,
  music_box: musicBox,
  wall_clock: wallClock,
  mirror,
  wreath,
  wall_shelf: wallShelf,
  sconce,
  pennant,
  wall_map: wallMap,
  campfire,
  flower_box: flowerBox,
  jack_o_lantern: jackOLantern,
  lemonade,
  herb_tea: herbTea,
  bouquet,
  herb_sachet: herbSachet,
  flower_wreath: flowerWreath,
  pumpkin_pie: pumpkinPie,
  apple_pie: applePie,
  berry_crumble: berryCrumble,
  fruit_salad: fruitSalad,
  corn_bread: cornBread,
  garden_salad: gardenSalad,
  posy,
  bird_bath: birdBath,
  beehive,
  piece,
  acorn,
  pinecone,
  mushroom,
  feather,
  chestnut,
  holly,
  seashell,
  driftwood,
  sea_glass: seaGlass,
  starfish,
  crystal,
  fossil,
  geode,
  four_leaf_clover: fourLeafClover,
  maple_leaf: mapleLeaf,
  cherry_blossom: cherryBlossom,
  candy,
  bat_bunting: batBunting,
  cauldron,
  candy_bowl: candyBowl,
  cranberry_punch: cranberryPunch,
  snowman,
  string_lights: stringLights,
  little_fir: littleFir,
  sled,
  candy_cane: candyCane,
  fishing_rod: fishingRod,
  fried_minnows: friedMinnows,
  fish_stew: fishStew,
  cornucopia,
  leaf_garland: leafGarland,
  menorah,
  dreidel,
  gelt,
  sufganiyah,
  stocking,
  firework,
  clay,
  bowl: () => potShapes("bowl"),
  vase: () => potShapes("vase"),
  teapot: () => potShapes("teapot"),
  // A pot of tea (RFC 0047): a cream teapot with steam off its spout.
  // A cup of tea (RFC 0047), a guest's keepsake: a cream cup on its saucer, steaming.
  cup_of_tea: () => [
    ellipse(24, 37, 15, 3.5, GLAZE_HEX.cream, out()),
    path("M14 22h20v6c0 6-4 9-10 9s-10-3-10-9z", GLAZE_HEX.cream, out()),
    path("M34 25c5 0 5 7 0 7", "none", out({ "stroke-width": 2 })),
    ellipse(24, 22, 10, 2.2, "#b07a3a", out({ "stroke-width": 1 })),
    path(
      "M20 17c-2-3 2-5 0-8M27 17c-2-3 2-5 0-8",
      "none",
      out({ "stroke-width": 1.4, opacity: 0.5 }),
    ),
  ],
  pot_of_tea: () => [
    ...potShapes("teapot", "cream"),
    path(
      "M8 16c-2-3 2-5 0-8M12 13c-2-3 2-5 0-8",
      "none",
      out({ "stroke-width": 1.4, opacity: 0.5 }),
    ),
  ],
};

// ---------- pottery (RFC 0047) ----------

/** A lump of clay, wet and a little shiny. */
function clay(): ArtShape[] {
  return [
    shadow(12),
    path("M12 36c-2-6 2-12 8-13 3-5 11-5 14 0 5 1 7 7 4 13z", CLAY_HEX, out()),
    path("M17 30c2-3 6-4 9-2", "none", out({ "stroke-width": 1, opacity: 0.6 })),
    shine(28, 26, 3, 1.4),
  ];
}

/** A pot's outline and the parts drawn in its glaze, in a 48 by 48 box. */
const POT_BODIES: Readonly<Record<"bowl" | "vase" | "teapot", (body: string) => ArtShape[]>> = {
  bowl: (body) => [
    shadow(15),
    path("M8 24h32c0 9-7 16-16 16S8 33 8 24z", body, out()),
    ellipse(24, 24, 16, 3.6, body, out()),
    ellipse(24, 24.4, 13, 2.4, INK, { opacity: 0.18 }),
    rect(19, 39, 10, 3, 1.2, body, out({ "stroke-width": 1 })),
  ],
  vase: (body) => [
    shadow(11),
    path(
      "M19 8h10v3c0 3 2 4 4 7 3 5 3 13 0 18-2 4-5 6-9 6s-7-2-9-6c-3-5-3-13 0-18 2-3 4-4 4-7z",
      body,
      out(),
    ),
    ellipse(24, 8, 5, 1.6, body, out()),
    ellipse(24, 8, 3.2, 0.9, INK, { opacity: 0.25 }),
  ],
  teapot: (body) => [
    shadow(15),
    path("M36 26c5-1 7 3 5 7s-5 4-7 3", "none", out({ "stroke-width": 2.4 })),
    path("M13 30c-4-3-7-6-8-10l3-1c2 3 4 5 7 6z", body, out()),
    path("M11 27c0-8 6-13 13-13s13 5 13 13c0 7-5 13-13 13S11 34 11 27z", body, out()),
    ellipse(24, 15, 7.5, 2.2, body, out()),
    circle(24, 11.5, 2.2, body, out({ "stroke-width": 1.1 })),
  ],
};

/** Each finish's marks over a pot's glaze; a plain pot has none. */
function finishShapes(finish: Finish | undefined): ArtShape[] {
  switch (finish) {
    case "speckled":
      return [
        [17, 28],
        [22, 33],
        [28, 27],
        [31, 33],
        [20, 21],
        [27, 37],
        [25, 24],
        [33, 29],
      ].map(([x, y]) => circle(x as number, y as number, 0.9, INK, { opacity: 0.45 }));
    case "crackle":
      return [line("M15 26l4 3 3-2 4 4 3-2 4 3M18 34l3-2 4 2 3-3 3 2", INK, 0.7, { opacity: 0.4 })];
    case "iridescent":
      return [
        path("M14 31c5-6 14-8 20-4", "none", {
          stroke: "#b48ae0",
          "stroke-width": 2.6,
          opacity: 0.55,
        }),
        path("M15 35c5-5 13-6 18-3", "none", {
          stroke: "#6fd0c8",
          "stroke-width": 2.2,
          opacity: 0.55,
        }),
        path("M17 27c4-3 9-4 13-2", "none", {
          stroke: "#f2d36b",
          "stroke-width": 1.8,
          opacity: 0.6,
        }),
      ];
    default:
      return [];
  }
}

/**
 * A pot (RFC 0047) in its glaze, with its finish over it and a shine on top. Pure. A pot still in
 * the kiln has no finish, and a kind's own picture is the bare one.
 */
export function potShapes(
  kind: "bowl" | "vase" | "teapot",
  glaze: Glaze = "bare",
  finish?: Finish,
  flower?: string,
): ArtShape[] {
  return [
    ...POT_BODIES[kind](GLAZE_HEX[glaze]),
    ...finishShapes(finish),
    shine(18, 25, 2.6, 1.2),
    ...(kind === "vase" && flower ? flowersInVase(flower) : []),
  ];
}

/** A vase's flowers (RFC 0047): three stems out of its mouth, each a bloom in the flower's color. */
function flowersInVase(flower: string): ArtShape[] {
  const hex = (CROP_HEX as Readonly<Record<string, string>>)[flower] ?? CROP_HEX.flower;
  return [
    line("M24 9L24 3M22 9L17 4M26 9L31 4", "#5f8a3e", 1.4),
    circle(17, 4, 3.2, hex, out({ "stroke-width": 1 })),
    circle(31, 4, 3.2, hex, out({ "stroke-width": 1 })),
    circle(24, 3, 3.4, hex, out({ "stroke-width": 1 })),
    circle(24, 3, 1.1, INK, { opacity: 0.35 }),
  ];
}

/** Whether a kind is one of the pots drawn by `potShapes`. */
const isPot = (kind: string): kind is "bowl" | "vase" | "teapot" => Object.hasOwn(POT_BODIES, kind);

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
  witch_hat: witchHat,
  santa_hat: santaHat,
  cat_ears: catEars,
  pumpkin_head: pumpkinHead,
  ghost_sheet: ghostSheet,
  bat_wings: batWings,
  sun_hat: sunHat,
  tool_belt: toolBelt,
  field_vest: fieldVest,
  party_sash: partySash,
  winners_rosette: winnersRosette,
  town_satchel: townSatchel,
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
    case "fish":
      return fishArt(look);
    case "drawn": {
      const draw = DRAWN[kind];
      if (!draw) throw new Error(`${kind} is drawn by hand, and item-art.ts has no picture of it.`);
      return draw();
    }
  }
}

/**
 * A recipe page (RFC 0024): a small paper scroll, rolled at both ends, tied with a clay ribbon,
 * with a few lines of writing and a little leaf in the corner.
 */
function recipePage(): ArtShape[] {
  return [
    shadow(14, 42),
    rect(13, 12, 22, 25, 1, PAPER, out()),
    line("M17 18h14M17 22h12M17 26h14M17 30h9", LINE, 1.2, { opacity: 0.55 }),
    ellipse(31, 31, 2.4, 1.5, LEAF, out({ "stroke-width": 0.8 })),
    rect(10, 8, 28, 6, 3, PAPER2, out()),
    rect(10, 35, 28, 6, 3, PAPER2, out()),
    line("M12 11h24M12 38h24", "#ffffff", 1, { opacity: 0.45 }),
    rect(22, 34, 4, 8, 1, CLAY, out({ "stroke-width": 0.8 })),
    line("M24 41l-3 4M24 41l3 4", CLAY_DEEP, 1.4),
  ];
}

/** The shapes of one picture, back to front, in a 48 by 48 box. Pure. */
export function itemShapes(kind: ArtKind): ArtShape[] {
  if (kind === RECIPE_PAGE) return recipePage();
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
  return shapesArt(kind, itemShapes(kind), opts);
}

/** An SVG of `shapes`, named `kind` in its `data-kind`, with `itemArt`'s options. */
function shapesArt(kind: string, shapes: ArtShape[], opts: ItemArtOptions): SVGSVGElement {
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
  for (const shape of shapes) svg.append(build(shape));
  return svg;
}

interface ArtImage {
  img: HTMLImageElement;
  loaded: boolean;
  ready: Promise<boolean>;
}

const artImages = new Map<string, ArtImage>();

function artEntry(key: string, shapes: () => ArtShape[]): ArtImage {
  let entry = artImages.get(key);
  if (!entry) {
    const svg = shapesArt(key, shapes(), { size: ART_BOX });
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
    artImages.set(key, fresh);
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
  const entry = artEntry(kind, () => itemShapes(kind));
  return entry.loaded ? entry.img : undefined;
}

/** The same picture once it has loaded, for a canvas drawn once (a 3D texture). */
export async function itemArtLoaded(kind: ArtKind): Promise<HTMLImageElement | undefined> {
  const entry = artEntry(kind, () => itemShapes(kind));
  return (await entry.ready) ? entry.img : undefined;
}

/**
 * A made thing as lists and sheets show it: its kind, for a piece the upload it shows, and for a
 * pot its glaze and finish (RFC 0047).
 */
export interface ThingLook {
  kind: ArtKind;
  media?: string | undefined;
  model?: true | undefined;
  glaze?: Glaze | undefined;
  finish?: Finish | undefined;
  /** A vase's flower (RFC 0047), drawn in it. */
  flower?: string | undefined;
}

/** The shapes of a made thing's drawn picture: a pot in its glaze and finish, else its kind's. */
export function thingShapes(thing: ThingLook): ArtShape[] {
  if (isPot(thing.kind) && thing.glaze) {
    return potShapes(thing.kind, thing.glaze, thing.finish, thing.flower);
  }
  return itemShapes(thing.kind);
}

/** Escaped for an attribute's value in markup. */
const escapeAttr = (text: string) =>
  text.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const shapeMarkup = (shape: ArtShape): string =>
  `<${shape.tag}${Object.entries(shape.attrs)
    .map(([k, v]) => ` ${k}="${escapeAttr(String(v))}"`)
    .join("")}>${(shape.children ?? []).map(shapeMarkup).join("")}</${shape.tag}>`;

/**
 * A thing's drawn picture as SVG markup, decorative, for a page built ahead of time with no DOM
 * (How to play). The same shapes `thingPicture` draws, and only the drawing's own attributes.
 */
export function thingArtMarkup(thing: ThingLook, size = 28): string {
  return `<svg class="item-art" viewBox="0 0 ${ART_BOX} ${ART_BOX}" width="${size}" height="${size}" aria-hidden="true" focusable="false">${thingShapes(thing).map(shapeMarkup).join("")}</svg>`;
}

/** The key a made thing's drawn picture is kept under: its kind, and a pot's glaze and finish. */
const thingKey = (thing: ThingLook) =>
  isPot(thing.kind) && thing.glaze
    ? `${thing.kind}|${thing.glaze}|${thing.finish ?? ""}|${thing.flower ?? ""}`
    : thing.kind;

/** A made thing's drawn picture as an image for the map's canvas, as `itemArtImage` is for a kind. */
export function thingArtImage(thing: ThingLook): HTMLImageElement | undefined {
  const entry = artEntry(thingKey(thing), () => thingShapes(thing));
  return entry.loaded ? entry.img : undefined;
}

/** The same once it has loaded, for a 3D texture. */
export async function thingArtLoaded(thing: ThingLook): Promise<HTMLImageElement | undefined> {
  const entry = artEntry(thingKey(thing), () => thingShapes(thing));
  return (await entry.ready) ? entry.img : undefined;
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
  if (!url) return shapesArt(thing.kind, thingShapes(thing), opts);
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
