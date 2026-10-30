/**
 * Furniture from the workbench in 3D (RFC 0016): a table, a chair, a bookshelf of colored books, a
 * hooped barrel, a signpost, a lamp post that glows, a stone well with a roof, a low stone wall that
 * runs on to the walls beside it, a campfire, a flower box, a jack-o'-lantern lit from inside, and
 * the pieces you rest on (RFC 0044): an armchair, a sofa, and a bed, the surfaces of roomier homes
 * (RFC 0050), and a wardrobe, a rocking chair, a piano, a bathtub, a fireplace that burns, an
 * aquarium, a coffee table, a coat rack, a floor lamp that glows, and a potted tree.
 * Each model is a few merged, shade-baked parts, placed with decor's `placeParts`, so a plot full of
 * chairs is one instanced draw per part (decision 0030). Lamps and fires glow after dark (decision
 * 0098) with an emissive shade and a soft pool of light on the ground, never a light of their own,
 * like the shop's lantern (decision 0060).
 */
import { BLOCK_COLORS, type FurnitureKind } from "@terrakin/sim";
import {
  IRON as IRON_BRAND,
  LINEN as LINEN_BRAND,
  STONE_HI,
  WOOD_DARK as WOOD_BRAND,
} from "@terrakin/ui/brand";
import {
  type BufferGeometry,
  ConeGeometry,
  CylinderGeometry,
  DodecahedronGeometry,
  IcosahedronGeometry,
  LatheGeometry,
  MeshLambertMaterial,
  type Object3D,
  type Texture,
  TorusGeometry,
  Vector2,
} from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { colored, paper, type Stage, unindexed } from "./art";
import { box, type DecorPlace, merged, type Part, placeParts } from "./decor";
import { BRAND, hex } from "./palette";

const WOOD_DARK = hex(WOOD_BRAND);
const IRON = hex(IRON_BRAND);
const STONE = hex(BLOCK_COLORS.stone_wall);
const STONE_CAP = hex(STONE_HI);

/** Many-colored pieces as one part, in one draw. */
function mixedPart(pieces: BufferGeometry[], grain: Texture, cast = true): Part {
  const geometry = mergeGeometries(pieces);
  for (const p of pieces) p.dispose();
  return { geometry, material: paper(0xffffff, grain), cast };
}

/**
 * A lamp or a flame: lit a little by day and warm from inside after dark, `base` the strength it
 * glows at as night falls (decision 0098), wavering while motion is allowed. Its pool of light on
 * the ground comes from the kind's `glow` mark in `palette.ts`, with every other glow on the plot.
 */
function flicker(stage: Stage, color: number, grain: Texture, base = 0.65): MeshLambertMaterial {
  const m = new MeshLambertMaterial({
    color,
    emissive: color,
    map: grain,
    flatShading: true,
  });
  stage.glow({ kind: "lamp", material: m, day: base * 0.3, night: base * 1.3, flicker: true });
  return m;
}

// ---------- the models ----------

function tableParts(grain: Texture): Part[] {
  const legs = [-0.38, 0.38].flatMap((x) =>
    [-0.27, 0.27].map((z) => box(0.08, 0.72, 0.08, [x, 0.36, z], [0, 0, 0], 0.02)),
  );
  return [
    {
      geometry: merged([box(0.94, 0.08, 0.74, [0, 0.76, 0], [0, 0, 0], 0.03), ...legs], 0.75),
      material: paper(hex(BLOCK_COLORS.table), grain),
      cast: true,
    },
  ];
}

/** A desk (RFC 0050): a long top on a leg at one end and a set of drawers at the other. */
function deskParts(grain: Texture): Part[] {
  return [
    {
      geometry: merged(
        [
          box(0.94, 0.07, 0.6, [0, 0.74, 0], [0, 0, 0], 0.03),
          ...[-0.27, 0.22].map((z) => box(0.07, 0.7, 0.07, [-0.4, 0.35, z], [0, 0, 0], 0.02)),
          box(0.36, 0.7, 0.54, [0.26, 0.35, 0], [0, 0, 0], 0.03),
        ],
        0.75,
      ),
      material: paper(hex(BLOCK_COLORS.desk), grain),
      cast: true,
    },
    {
      geometry: merged(
        [0.2, 0.46].map((y) => box(0.3, 0.16, 0.02, [0.26, y, 0.28], [0, 0, 0], 0.01)),
        0.9,
      ),
      material: paper(0x6b4a32, grain),
      cast: false,
    },
  ];
}

/** A side table (RFC 0050): a small round-cornered top on four slim legs, lower than a table. */
function sideTableParts(grain: Texture): Part[] {
  const legs = [-0.2, 0.2].flatMap((x) =>
    [-0.2, 0.2].map((z) => box(0.06, 0.5, 0.06, [x, 0.25, z], [0, 0, 0], 0.02)),
  );
  return [
    {
      geometry: merged([box(0.56, 0.06, 0.56, [0, 0.53, 0], [0, 0, 0], 0.05), ...legs], 0.75),
      material: paper(hex(BLOCK_COLORS.side_table), grain),
      cast: true,
    },
  ];
}

/** A dresser (RFC 0050): a chest of three drawers, waist high, with brass knobs. */
function dresserParts(grain: Texture): Part[] {
  return [
    {
      geometry: merged([box(0.86, 0.86, 0.5, [0, 0.45, -0.05], [0, 0, 0], 0.03)], 0.7),
      material: paper(hex(BLOCK_COLORS.dresser), grain),
      cast: true,
    },
    {
      geometry: merged(
        [0.2, 0.46, 0.72].map((y) => box(0.74, 0.2, 0.02, [0, y, 0.21], [0, 0, 0], 0.01)),
        0.9,
      ),
      material: paper(0x5a3c27, grain),
      cast: false,
    },
    {
      geometry: merged(
        [0.2, 0.46, 0.72].map((y) => box(0.06, 0.05, 0.04, [0, y, 0.23], [0, 0, 0], 0.01)),
        1,
      ),
      material: paper(0xe7c27a, grain),
      cast: false,
    },
  ];
}

function chairParts(grain: Texture): Part[] {
  const legs = [-0.2, 0.2].flatMap((x) =>
    [-0.17, 0.22].map((z) => box(0.06, 0.46, 0.06, [x, 0.23, z], [0, 0, 0], 0.02)),
  );
  return [
    {
      geometry: merged(
        [
          box(0.5, 0.07, 0.5, [0, 0.47, 0.03], [0, 0, 0], 0.02),
          box(0.06, 0.62, 0.06, [-0.22, 0.78, -0.19], [0, 0, 0], 0.02),
          box(0.06, 0.62, 0.06, [0.22, 0.78, -0.19], [0, 0, 0], 0.02),
          box(0.5, 0.12, 0.05, [0, 1.0, -0.19], [0, 0, 0], 0.02),
          box(0.5, 0.07, 0.05, [0, 0.78, -0.19], [0, 0, 0], 0.02),
          ...legs,
        ],
        0.75,
      ),
      material: paper(hex(BLOCK_COLORS.chair), grain),
      cast: true,
    },
  ];
}

const BOOKS = [BRAND.clay, hex("#7cb9dd"), BRAND.sun, BRAND.moss, hex("#a98bd8"), BRAND.paper];

function bookshelfParts(grain: Texture): Part[] {
  const frame = merged(
    [
      box(0.92, 1.5, 0.05, [0, 0.75, -0.17], [0, 0, 0], 0.02),
      box(0.06, 1.5, 0.4, [-0.43, 0.75, 0], [0, 0, 0], 0.02),
      box(0.06, 1.5, 0.4, [0.43, 0.75, 0], [0, 0, 0], 0.02),
      ...[0.03, 0.52, 1.0, 1.48].map((y) => box(0.92, 0.05, 0.4, [0, y, 0], [0, 0, 0], 0.015)),
    ],
    0.7,
  );
  const books: BufferGeometry[] = [];
  [0.06, 0.55, 1.03].forEach((shelf, row) => {
    let x = -0.37;
    let i = row * 2;
    while (x < 0.33) {
      const w = 0.07 + ((i * 7) % 4) * 0.015;
      const tall = 0.3 + ((i * 5) % 3) * 0.05;
      books.push(
        colored(
          box(w, tall, 0.26, [x + w / 2, shelf + tall / 2, 0.02], [0, 0, 0], 0.01),
          BOOKS[i % BOOKS.length] as number,
        ),
      );
      x += w + 0.012;
      i++;
    }
  });
  return [
    { geometry: frame, material: paper(hex(BLOCK_COLORS.bookshelf), grain), cast: true },
    mixedPart(books, grain),
  ];
}

function barrelParts(grain: Texture): Part[] {
  const profile = [
    [0.001, 0],
    [0.27, 0],
    [0.32, 0.2],
    [0.34, 0.41],
    [0.32, 0.62],
    [0.27, 0.82],
    [0.001, 0.82],
  ].map(([x, y]) => new Vector2(x, y));
  const body = new LatheGeometry(profile, 12);
  const hoops = [0.2, 0.62].map((y) => {
    const t = new TorusGeometry(0.33, 0.022, 4, 16);
    t.rotateX(Math.PI / 2);
    t.translate(0, y, 0);
    return t.toNonIndexed();
  });
  return [
    {
      geometry: merged([body.toNonIndexed()], 0.7),
      material: paper(hex(BLOCK_COLORS.barrel), grain),
      cast: true,
    },
    { geometry: merged(hoops, 0.9), material: paper(IRON, grain), cast: true },
  ];
}

function signpostParts(grain: Texture): Part[] {
  const board = (y: number, turn: number, flip: number) => {
    const plank = box(0.56, 0.15, 0.05, [0.2 * flip, 0, 0], [0, 0, 0], 0.02);
    const tip = new CylinderGeometry(0.105, 0.105, 0.05, 3);
    tip.rotateX(Math.PI / 2);
    tip.rotateZ(flip > 0 ? -Math.PI / 2 : Math.PI / 2);
    tip.translate(0.5 * flip, 0, 0);
    const g = mergeGeometries([unindexed(plank), tip.toNonIndexed()]);
    plank.dispose();
    tip.dispose();
    g.rotateY(turn);
    g.translate(0, y, 0.06);
    return g;
  };
  return [
    {
      geometry: merged([box(0.09, 1.32, 0.09, [0, 0.66, 0], [0, 0, 0], 0.02)], 0.7),
      material: paper(WOOD_DARK, grain),
      cast: true,
    },
    {
      geometry: merged([board(1.14, 0.25, 1), board(0.86, -0.35, -1)], 0.85),
      material: paper(hex(BLOCK_COLORS.signpost), grain),
      cast: true,
    },
  ];
}

function lampPostParts(stage: Stage, grain: Texture): Part[] {
  const post = new CylinderGeometry(0.04, 0.055, 1.5, 6);
  post.translate(0, 0.79, 0);
  const cap = new ConeGeometry(0.17, 0.14, 4);
  cap.rotateY(Math.PI / 4);
  cap.translate(0, 1.84, 0);
  const lamp = new CylinderGeometry(0.1, 0.075, 0.24, 6);
  lamp.translate(0, 1.66, 0);
  return [
    {
      geometry: merged([
        box(0.26, 0.08, 0.26, [0, 0.04, 0], [0, 0, 0], 0.02),
        post.toNonIndexed(),
        cap.toNonIndexed(),
        box(0.24, 0.04, 0.24, [0, 1.53, 0], [0, 0, 0], 0.01),
      ]),
      material: paper(hex(BLOCK_COLORS.lamp_post), grain),
      cast: true,
    },
    {
      geometry: merged([lamp.toNonIndexed()], 1),
      material: flicker(stage, hex("#f9d27a"), grain, 0.7),
      cast: false,
    },
  ];
}

function wellParts(grain: Texture): Part[] {
  const ring = new CylinderGeometry(0.43, 0.46, 0.56, 12);
  ring.translate(0, 0.28, 0);
  const rim = new TorusGeometry(0.43, 0.05, 4, 12);
  rim.rotateX(Math.PI / 2);
  rim.translate(0, 0.56, 0);
  const water = new CylinderGeometry(0.36, 0.36, 0.02, 12);
  water.translate(0, 0.55, 0);
  const roof = new ConeGeometry(0.66, 0.4, 4);
  roof.rotateY(Math.PI / 4);
  roof.translate(0, 1.52, 0);
  const bucket = new CylinderGeometry(0.08, 0.065, 0.13, 8);
  bucket.translate(0, 0.98, 0);
  return [
    {
      geometry: merged([ring.toNonIndexed(), rim.toNonIndexed()], 0.65),
      material: paper(hex(BLOCK_COLORS.well), grain),
      cast: true,
    },
    {
      geometry: merged(
        [
          box(0.07, 1.05, 0.07, [-0.38, 0.86, 0], [0, 0, 0], 0.02),
          box(0.07, 1.05, 0.07, [0.38, 0.86, 0], [0, 0, 0], 0.02),
          box(0.84, 0.05, 0.05, [0, 1.2, 0], [0, 0, 0], 0.015),
          bucket.toNonIndexed(),
        ],
        0.75,
      ),
      material: paper(WOOD_DARK, grain),
      cast: true,
    },
    {
      geometry: merged([roof.toNonIndexed()], 0.8),
      material: paper(BRAND.clay, grain),
      cast: true,
    },
    {
      geometry: merged([water.toNonIndexed()], 1),
      material: paper(hex("#3f5f6f"), null),
      cast: false,
    },
  ];
}

function stoneWallParts(grain: Texture): Part[] {
  const wall = (w: number, x: number) => [
    box(w, 0.5, 0.36, [x, 0.25, 0], [0, 0, 0], 0.04),
    box(w + 0.02, 0.08, 0.42, [x, 0.53, 0], [0, 0, 0], 0.03),
  ];
  return [
    { geometry: merged(wall(0.5, 0), 0.7), material: paper(STONE, grain), cast: true },
    // One stretch from the middle out to the tile's east edge; it turns to face each joined side.
    {
      geometry: merged(wall(0.5, 0.25), 0.7),
      material: paper(STONE, grain),
      cast: true,
      rail: true,
    },
    {
      geometry: merged([box(0.52, 0.03, 0.44, [0, 0.58, 0], [0, 0, 0], 0.01)], 1),
      material: paper(STONE_CAP, grain),
      cast: false,
    },
  ];
}

function campfireParts(stage: Stage, grain: Texture): Part[] {
  const stones: BufferGeometry[] = [];
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2;
    const s = new DodecahedronGeometry(0.09, 0);
    s.scale(1.2, 0.75, 1);
    s.translate(Math.cos(a) * 0.3, 0.06, Math.sin(a) * 0.3);
    stones.push(s.toNonIndexed());
  }
  const logs = [0.6, -0.6].map((turn, i) => {
    const log = new CylinderGeometry(0.045, 0.05, 0.56, 6);
    log.rotateZ(Math.PI / 2);
    log.rotateY(turn);
    log.translate(0, 0.07 + i * 0.05, 0);
    return log.toNonIndexed();
  });
  const outer = new ConeGeometry(0.16, 0.44, 7);
  outer.translate(0, 0.32, 0);
  const inner = new ConeGeometry(0.09, 0.28, 6);
  inner.translate(0, 0.26, 0.03);
  return [
    { geometry: merged(stones, 0.75), material: paper(hex(BLOCK_COLORS.stone), grain), cast: true },
    { geometry: merged(logs, 0.8), material: paper(WOOD_DARK, grain), cast: true },
    {
      geometry: merged([outer.toNonIndexed()], 1),
      material: flicker(stage, hex(BLOCK_COLORS.campfire), grain, 0.75),
      cast: false,
    },
    {
      geometry: merged([inner.toNonIndexed()], 1),
      material: flicker(stage, BRAND.sun, grain, 0.9),
      cast: false,
    },
  ];
}

const FLOWERS = [hex("#e58fb6"), BRAND.sun, BRAND.paper, hex("#a98bd8")];

function flowerBoxParts(grain: Texture): Part[] {
  const plants: BufferGeometry[] = [];
  for (let i = 0; i < 6; i++) {
    const x = -0.3 + i * 0.12;
    const z = i % 2 ? 0.06 : -0.05;
    const leafy = new IcosahedronGeometry(0.07, 0);
    leafy.scale(1, 0.7, 1);
    leafy.translate(x, 0.4, z);
    plants.push(colored(leafy, BRAND.moss));
    const head = new IcosahedronGeometry(0.055, 0);
    head.translate(x + 0.02, 0.5 + (i % 3) * 0.03, z);
    plants.push(colored(head, FLOWERS[i % FLOWERS.length] as number, 0.95));
  }
  return [
    {
      geometry: merged([box(0.86, 0.3, 0.42, [0, 0.15, 0], [0, 0, 0], 0.03)], 0.7),
      material: paper(hex(BLOCK_COLORS.flower_box), grain),
      cast: true,
    },
    {
      geometry: merged([box(0.78, 0.04, 0.34, [0, 0.31, 0], [0, 0, 0], 0.01)], 1),
      material: paper(hex("#6a4a33"), null),
      cast: false,
    },
    mixedPart(plants, grain),
  ];
}

/**
 * A jack-o'-lantern: three ribbed lobes and a stubby stem, with eyes and a grin cut in the side
 * that faces you, lit warm from inside and pooling light on the ground.
 */
function jackOLanternParts(stage: Stage, grain: Texture): Part[] {
  const lobes = [-0.13, 0.13, 0].map((x, i) => {
    const g = new DodecahedronGeometry(0.2, 0);
    g.scale(0.8, 0.75, i === 2 ? 1.05 : 0.95);
    g.translate(x, 0.17, 0);
    return g.toNonIndexed();
  });
  const stem = new CylinderGeometry(0.025, 0.04, 0.12, 5);
  stem.rotateZ(0.25);
  stem.translate(0.02, 0.38, 0);
  const face = [
    box(0.07, 0.07, 0.03, [-0.08, 0.22, 0.2], [0, 0, Math.PI / 4], 0),
    box(0.07, 0.07, 0.03, [0.08, 0.22, 0.2], [0, 0, Math.PI / 4], 0),
    box(0.2, 0.05, 0.03, [0, 0.11, 0.21], [0, 0, 0], 0.01),
  ];
  return [
    {
      geometry: merged(lobes, 0.8),
      material: paper(hex(BLOCK_COLORS.jack_o_lantern), grain),
      cast: true,
    },
    { geometry: merged([stem.toNonIndexed()], 0.8), material: paper(0x6a6136, grain), cast: true },
    { geometry: merged(face, 1), material: flicker(stage, 0xffc45a, grain, 0.9), cast: false },
  ];
}

// ---------- cozy homes (RFC 0044) ----------

/** Cream for a mattress, a pillow, and the piping on cushions. */
const LINEN = hex(LINEN_BRAND);

/** The top of an armchair's or a sofa's seat, in tile units above the floor (`restPose3d` sits on it). */
const SEAT_TOP = 0.42;

/**
 * Something upholstered: a wooden plinth on short legs, a seat `w` wide at `SEAT_TOP`, a back
 * along the north side, and an arm at each end, in the kind's cloth. A sofa's seat is split into
 * cushions by a pale seam.
 */
function upholsteredParts(grain: Texture, cloth: number, w: number, cushions: number): Part[] {
  const half = w / 2;
  const legs = [-half + 0.06, half - 0.06].flatMap((x) =>
    [-0.3, 0.3].map((z) => box(0.07, 0.12, 0.07, [x, 0.06, z], [0, 0, 0], 0.02)),
  );
  const seams = Array.from({ length: cushions - 1 }, (_, i) => {
    const x = -half + 0.12 + ((w - 0.24) * (i + 1)) / cushions;
    return box(0.02, 0.02, 0.5, [x, SEAT_TOP + 0.005, 0.04], [0, 0, 0], 0);
  });
  return [
    {
      geometry: merged(legs, 0.75),
      material: paper(WOOD_DARK, grain),
      cast: true,
    },
    {
      geometry: merged(
        [
          box(w, 0.26, 0.7, [0, SEAT_TOP - 0.13, 0], [0, 0, 0], 0.06),
          box(w, 0.5, 0.18, [0, SEAT_TOP + 0.22, -0.26], [-0.12, 0, 0], 0.07),
          box(0.13, 0.26, 0.66, [-half + 0.065, SEAT_TOP + 0.1, 0.01], [0, 0, 0], 0.05),
          box(0.13, 0.26, 0.66, [half - 0.065, SEAT_TOP + 0.1, 0.01], [0, 0, 0], 0.05),
        ],
        0.72,
      ),
      material: paper(cloth, grain),
      cast: true,
    },
    ...(seams.length > 0
      ? [{ geometry: merged(seams, 1), material: paper(LINEN, null), cast: false }]
      : []),
  ];
}

/** A bed: a wooden frame with a headboard to the north, a mattress, a pillow, and a quilt. */
function bedParts(grain: Texture): Part[] {
  return [
    {
      geometry: merged(
        [
          box(0.84, 0.2, 0.9, [0, 0.16, 0.02], [0, 0, 0], 0.03),
          box(0.84, 0.72, 0.07, [0, 0.36, -0.44], [0, 0, 0], 0.03),
          box(0.84, 0.36, 0.06, [0, 0.18, 0.46], [0, 0, 0], 0.02),
        ],
        0.75,
      ),
      material: paper(hex(BLOCK_COLORS.chair), grain),
      cast: true,
    },
    {
      geometry: merged(
        [
          box(0.76, 0.1, 0.82, [0, 0.31, 0.02], [0, 0, 0], 0.04),
          box(0.5, 0.08, 0.18, [0, 0.39, -0.3], [0, 0, 0], 0.04),
        ],
        0.9,
      ),
      material: paper(LINEN, grain),
      cast: false,
    },
    {
      geometry: merged([box(0.8, 0.06, 0.56, [0, 0.37, 0.15], [0, 0, 0], 0.03)], 0.85),
      material: paper(hex(BLOCK_COLORS.bed), grain),
      cast: false,
    },
  ];
}

// ---------- more for a home ----------

const BRASS = 0xe7c27a;

/** A wardrobe: a tall cabinet under a crown, two doors with brass knobs, on four short feet. */
function wardrobeParts(grain: Texture): Part[] {
  const feet = [-0.36, 0.36].flatMap((x) =>
    [-0.24, 0.14].map((z) => box(0.08, 0.08, 0.08, [x, 0.04, z], [0, 0, 0], 0.02)),
  );
  return [
    {
      geometry: merged(
        [
          box(0.86, 1.46, 0.5, [0, 0.81, -0.05], [0, 0, 0], 0.03),
          box(0.94, 0.08, 0.56, [0, 1.58, -0.05], [0, 0, 0], 0.03),
        ],
        0.7,
      ),
      material: paper(hex(BLOCK_COLORS.wardrobe), grain),
      cast: true,
    },
    { geometry: merged(feet, 0.8), material: paper(WOOD_DARK, grain), cast: true },
    {
      geometry: merged(
        [-0.205, 0.205].map((x) => box(0.36, 1.26, 0.02, [x, 0.82, 0.205], [0, 0, 0], 0.01)),
        0.9,
      ),
      material: paper(0x6a452c, grain),
      cast: false,
    },
    {
      geometry: merged(
        [-0.04, 0.04].map((x) => box(0.04, 0.06, 0.04, [x, 0.82, 0.225], [0, 0, 0], 0.01)),
        1,
      ),
      material: paper(BRASS, grain),
      cast: false,
    },
  ];
}

/** One rocker: an arc along the tile from north to south, its low point on the ground at `x`. */
function rocker(x: number): BufferGeometry {
  const radius = 1.3;
  const arc = 0.62;
  const g = new TorusGeometry(radius, 0.03, 4, 10, arc);
  g.rotateZ(-Math.PI / 2 - arc / 2);
  g.translate(0, radius + 0.03, 0);
  g.rotateY(Math.PI / 2);
  g.translate(x, 0, 0);
  return g.toNonIndexed();
}

/**
 * A rocking chair (a seat, RFC 0044): a chair's seat and a back of spindles, its legs set on two
 * rockers. Its seat is the chair's height, so `restPose3d` sits a resident in it the same way.
 */
function rockingChairParts(grain: Texture): Part[] {
  const legs = [-0.2, 0.2].flatMap((x) =>
    [-0.17, 0.22].map((z) => box(0.06, 0.42, 0.06, [x, 0.25, z], [0, 0, 0], 0.02)),
  );
  return [
    {
      geometry: merged(
        [
          box(0.5, 0.07, 0.5, [0, 0.47, 0.03], [0, 0, 0], 0.02),
          box(0.06, 0.64, 0.06, [-0.22, 0.79, -0.2], [0, 0, 0], 0.02),
          box(0.06, 0.64, 0.06, [0.22, 0.79, -0.2], [0, 0, 0], 0.02),
          box(0.52, 0.11, 0.06, [0, 1.04, -0.2], [0, 0, 0], 0.02),
          ...[-0.1, 0, 0.1].map((x) => box(0.035, 0.46, 0.035, [x, 0.76, -0.2], [0, 0, 0], 0.01)),
          ...legs,
        ],
        0.75,
      ),
      material: paper(hex(BLOCK_COLORS.rocking_chair), grain),
      cast: true,
    },
    {
      geometry: merged([rocker(-0.2), rocker(0.2)], 0.8),
      material: paper(WOOD_DARK, grain),
      cast: true,
    },
  ];
}

/** An upright piano: a tall dark case, a keyboard of white and black keys, music, and pedals. */
function pianoParts(grain: Texture): Part[] {
  const blackKeys = [-0.33, -0.25, -0.09, -0.01, 0.07, 0.23, 0.31].map((x) =>
    box(0.04, 0.03, 0.11, [x, 0.835, 0.09], [0, 0, 0], 0.005),
  );
  return [
    {
      geometry: merged(
        [
          box(0.94, 1.26, 0.36, [0, 0.66, -0.13], [0, 0, 0], 0.03),
          box(0.96, 0.05, 0.4, [0, 1.3, -0.13], [0, 0, 0], 0.02),
          box(0.94, 0.08, 0.28, [0, 0.74, 0.12], [0, 0, 0], 0.02),
          ...[-0.43, 0.43].map((x) => box(0.07, 0.7, 0.07, [x, 0.35, 0.21], [0, 0, 0], 0.02)),
        ],
        0.7,
      ),
      material: paper(hex(BLOCK_COLORS.piano), grain),
      cast: true,
    },
    {
      geometry: merged(
        [
          box(0.86, 0.04, 0.2, [0, 0.8, 0.14], [0, 0, 0], 0.01),
          box(0.28, 0.2, 0.02, [0, 1.0, 0.06], [-0.2, 0, 0], 0.005),
        ],
        0.95,
      ),
      material: paper(LINEN, grain),
      cast: false,
    },
    { geometry: merged(blackKeys, 1), material: paper(0x1f1a18, grain), cast: false },
    {
      geometry: merged(
        [-0.07, 0.07].map((x) => box(0.05, 0.02, 0.09, [x, 0.06, 0.1], [0, 0, 0], 0.005)),
        1,
      ),
      material: paper(BRASS, grain),
      cast: false,
    },
  ];
}

/** A bathtub: a deep enamel tub with a rolled rim, full of water and bubbles, on brass feet. */
function bathtubParts(grain: Texture): Part[] {
  const feet = [-0.34, 0.34].flatMap((x) =>
    [-0.18, 0.18].map((z) => {
      const g = new IcosahedronGeometry(0.055, 0);
      g.translate(x, 0.05, z);
      return g.toNonIndexed();
    }),
  );
  const tap = new CylinderGeometry(0.025, 0.025, 0.2, 6);
  tap.translate(0.42, 0.62, 0);
  const bubbles = [
    [-0.25, 0.04, 0.07],
    [-0.15, -0.08, 0.05],
    [0.05, 0.1, 0.06],
    [0.2, -0.04, 0.045],
  ].map(([x, z, r]) => {
    const g = new IcosahedronGeometry(r as number, 0);
    g.translate(x as number, 0.53, z as number);
    return g.toNonIndexed();
  });
  return [
    {
      geometry: merged(
        [
          box(0.9, 0.42, 0.54, [0, 0.29, 0], [0, 0, 0], 0.15),
          box(0.96, 0.07, 0.07, [0, 0.5, -0.27], [0, 0, 0], 0.03),
          box(0.96, 0.07, 0.07, [0, 0.5, 0.27], [0, 0, 0], 0.03),
          box(0.07, 0.07, 0.6, [-0.45, 0.5, 0], [0, 0, 0], 0.03),
          box(0.07, 0.07, 0.6, [0.45, 0.5, 0], [0, 0, 0], 0.03),
        ],
        0.75,
      ),
      material: paper(hex(BLOCK_COLORS.bathtub), grain),
      cast: true,
    },
    {
      geometry: merged([box(0.84, 0.02, 0.48, [0, 0.5, 0], [0, 0, 0], 0.005)], 1),
      material: paper(hex("#9fd3e0"), null),
      cast: false,
    },
    {
      geometry: merged([...feet, tap.toNonIndexed()], 0.85),
      material: paper(BRASS, grain),
      cast: true,
    },
    { geometry: merged(bubbles, 1), material: paper(0xffffff, grain), cast: false },
  ];
}

/**
 * A fireplace: a stone chimney breast with an opening at the front, a wooden mantel, and logs
 * burning on the hearth, lit warm after dark like a campfire.
 */
function fireplaceParts(stage: Stage, grain: Texture): Part[] {
  const logs = [0.5, -0.5].map((turn, i) => {
    const log = new CylinderGeometry(0.04, 0.045, 0.4, 6);
    log.rotateZ(Math.PI / 2);
    log.rotateY(turn);
    log.translate(0, 0.06 + i * 0.045, -0.04);
    return log.toNonIndexed();
  });
  const outer = new ConeGeometry(0.12, 0.34, 7);
  outer.translate(0, 0.27, -0.04);
  const inner = new ConeGeometry(0.07, 0.22, 6);
  inner.translate(0, 0.22, -0.01);
  return [
    {
      geometry: merged(
        [
          box(0.94, 1.2, 0.12, [0, 0.6, -0.26], [0, 0, 0], 0.03),
          box(0.24, 0.9, 0.44, [-0.35, 0.45, -0.02], [0, 0, 0], 0.04),
          box(0.24, 0.9, 0.44, [0.35, 0.45, -0.02], [0, 0, 0], 0.04),
          box(0.94, 0.3, 0.44, [0, 0.75, -0.02], [0, 0, 0], 0.04),
          box(0.56, 0.36, 0.3, [0, 1.07, -0.18], [0, 0, 0], 0.03),
        ],
        0.65,
      ),
      material: paper(hex(BLOCK_COLORS.fireplace), grain),
      cast: true,
    },
    {
      geometry: merged([box(0.48, 0.6, 0.02, [0, 0.3, -0.19], [0, 0, 0], 0.005)], 1),
      material: paper(0x3a2a22, null),
      cast: false,
    },
    {
      geometry: merged(
        [
          box(1.02, 0.07, 0.56, [0, 0.93, 0], [0, 0, 0], 0.02),
          box(0.9, 0.05, 0.22, [0, 0.025, 0.31], [0, 0, 0], 0.02),
        ],
        0.8,
      ),
      material: paper(STONE_CAP, grain),
      cast: true,
    },
    { geometry: merged(logs, 0.8), material: paper(WOOD_DARK, grain), cast: false },
    {
      geometry: merged([outer.toNonIndexed()], 1),
      material: flicker(stage, hex(BLOCK_COLORS.campfire), grain, 0.75),
      cast: false,
    },
    {
      geometry: merged([inner.toNonIndexed()], 1),
      material: flicker(stage, BRAND.sun, grain, 0.9),
      cast: false,
    },
  ];
}

/** An aquarium: a tank of water on a wooden stand, with sand, weed and two fish at the front. */
function aquariumParts(grain: Texture): Part[] {
  const front = 0.215;
  const fish = (x: number, y: number, s: number, color: number) => [
    colored(box(0.1 * s, 0.06 * s, 0.02, [x, y, front], [0, 0, 0], 0.01), color, 1),
    colored(
      box(0.04 * s, 0.06 * s, 0.02, [x - 0.07 * s, y, front], [0, 0, Math.PI / 4], 0.005),
      color,
      1,
    ),
  ];
  const sea = [
    colored(box(0.82, 0.06, 0.02, [0, 0.56, front], [0, 0, 0], 0.01), hex("#e6cfa3"), 1),
    colored(box(0.025, 0.24, 0.02, [-0.3, 0.68, front], [0, 0, 0.12], 0.005), BRAND.moss, 1),
    colored(box(0.025, 0.18, 0.02, [-0.24, 0.65, front], [0, 0, -0.15], 0.005), BRAND.moss, 1),
    ...fish(0.08, 0.8, 1, BRAND.sun),
    ...fish(0.26, 0.68, 0.7, hex("#e58fb6")),
  ];
  return [
    {
      geometry: merged([box(0.88, 0.5, 0.44, [0, 0.25, 0], [0, 0, 0], 0.03)], 0.7),
      material: paper(hex(BLOCK_COLORS.table), grain),
      cast: true,
    },
    {
      geometry: merged([box(0.84, 0.46, 0.4, [0, 0.76, 0], [0, 0, 0], 0.02)], 0.85),
      material: paper(hex(BLOCK_COLORS.aquarium), grain),
      cast: true,
    },
    {
      geometry: merged(
        [
          box(0.9, 0.05, 0.46, [0, 1.01, 0], [0, 0, 0], 0.015),
          box(0.9, 0.04, 0.46, [0, 0.52, 0], [0, 0, 0], 0.015),
        ],
        0.85,
      ),
      material: paper(WOOD_DARK, grain),
      cast: false,
    },
    mixedPart(sea, grain, false),
  ];
}

/** The top of a coffee table, in tile units above the floor: where a small thing stands on it. */
const COFFEE_TOP = 0.42;

/** A coffee table (a surface, RFC 0050): a long low top on four short legs, with a shelf under it. */
function coffeeTableParts(grain: Texture): Part[] {
  const legs = [-0.4, 0.4].flatMap((x) =>
    [-0.21, 0.21].map((z) =>
      box(0.06, COFFEE_TOP - 0.05, 0.06, [x, (COFFEE_TOP - 0.05) / 2, z], [0, 0, 0], 0.02),
    ),
  );
  return [
    {
      geometry: merged(
        [box(0.94, 0.06, 0.56, [0, COFFEE_TOP - 0.03, 0], [0, 0, 0], 0.03), ...legs],
        0.75,
      ),
      material: paper(hex(BLOCK_COLORS.coffee_table), grain),
      cast: true,
    },
    {
      geometry: merged([box(0.8, 0.03, 0.44, [0, 0.12, 0], [0, 0, 0], 0.01)], 0.85),
      material: paper(WOOD_DARK, grain),
      cast: false,
    },
  ];
}

/** A coat rack: a pole on crossed feet with hooks at the top, a coat on one and a scarf on another. */
function coatRackParts(grain: Texture): Part[] {
  const pole = new CylinderGeometry(0.03, 0.035, 1.46, 6);
  pole.translate(0, 0.78, 0);
  const knob = new IcosahedronGeometry(0.055, 0);
  knob.translate(0, 1.55, 0);
  const hooks = [0, Math.PI / 2, Math.PI, -Math.PI / 2].map((turn) => {
    const g = box(0.16, 0.03, 0.03, [0.08, 1.4, 0], [0, 0, 0.5], 0.01);
    g.rotateY(turn);
    return g;
  });
  return [
    {
      geometry: merged(
        [
          box(0.52, 0.05, 0.07, [0, 0.025, 0], [0, Math.PI / 4, 0], 0.02),
          box(0.52, 0.05, 0.07, [0, 0.025, 0], [0, -Math.PI / 4, 0], 0.02),
          pole.toNonIndexed(),
          knob.toNonIndexed(),
          ...hooks,
        ],
        0.75,
      ),
      material: paper(hex(BLOCK_COLORS.coat_rack), grain),
      cast: true,
    },
    mixedPart(
      [
        colored(box(0.24, 0.56, 0.12, [0.15, 1.12, 0.02], [0, 0, 0.12], 0.05), hex("#5f86b5")),
        colored(box(0.08, 0.42, 0.03, [-0.15, 1.2, 0], [0, 0, -0.1], 0.01), BRAND.clay),
      ],
      grain,
    ),
  ];
}

/** A floor lamp: a cloth shade on a tall pole and a round stone foot, glowing warm after dark. */
function floorLampParts(stage: Stage, grain: Texture): Part[] {
  const foot = new CylinderGeometry(0.17, 0.19, 0.05, 10);
  foot.translate(0, 0.025, 0);
  const pole = new CylinderGeometry(0.022, 0.022, 1.26, 6);
  pole.translate(0, 0.68, 0);
  const shade = new CylinderGeometry(0.13, 0.23, 0.3, 8);
  shade.translate(0, 1.42, 0);
  return [
    { geometry: merged([foot.toNonIndexed()], 0.8), material: paper(STONE_CAP, grain), cast: true },
    { geometry: merged([pole.toNonIndexed()], 0.8), material: paper(WOOD_DARK, grain), cast: true },
    {
      geometry: merged([shade.toNonIndexed()], 1),
      material: flicker(stage, hex(BLOCK_COLORS.floor_lamp), grain, 0.6),
      cast: false,
    },
  ];
}

/** A potted tree: a little oak in a wooden tub with iron hoops. */
function pottedTreeParts(grain: Texture): Part[] {
  const tub = new CylinderGeometry(0.25, 0.2, 0.34, 10);
  tub.translate(0, 0.17, 0);
  const hoops = [0.08, 0.27].map((y) => {
    const t = new TorusGeometry(0.235 - y * 0.08, 0.018, 4, 14);
    t.rotateX(Math.PI / 2);
    t.translate(0, y, 0);
    return t.toNonIndexed();
  });
  const trunk = new CylinderGeometry(0.035, 0.05, 0.6, 6);
  trunk.translate(0, 0.6, 0);
  const canopy = [
    [0, 1.05, 0, 0.3],
    [-0.17, 0.92, 0.05, 0.2],
    [0.17, 0.95, -0.04, 0.21],
    [0.02, 1.25, 0.02, 0.18],
  ].map(([x, y, z, r]) => {
    const g = new IcosahedronGeometry(r as number, 0);
    g.translate(x as number, y as number, z as number);
    return g.toNonIndexed();
  });
  return [
    {
      geometry: merged([tub.toNonIndexed()], 0.75),
      material: paper(hex(BLOCK_COLORS.table), grain),
      cast: true,
    },
    { geometry: merged(hoops, 0.9), material: paper(IRON, grain), cast: true },
    {
      geometry: merged([trunk.toNonIndexed()], 0.8),
      material: paper(WOOD_DARK, grain),
      cast: true,
    },
    {
      geometry: merged(canopy, 0.7),
      material: paper(hex(BLOCK_COLORS.potted_tree), grain),
      cast: true,
    },
  ];
}

function partsOf(stage: Stage, kind: FurnitureKind, grain: Texture): Part[] {
  switch (kind) {
    case "table":
      return tableParts(grain);
    case "chair":
      return chairParts(grain);
    case "bookshelf":
      return bookshelfParts(grain);
    case "barrel":
      return barrelParts(grain);
    case "signpost":
      return signpostParts(grain);
    case "lamp_post":
      return lampPostParts(stage, grain);
    case "well":
      return wellParts(grain);
    case "stone_wall":
      return stoneWallParts(grain);
    case "campfire":
      return campfireParts(stage, grain);
    case "flower_box":
      return flowerBoxParts(grain);
    case "jack_o_lantern":
      return jackOLanternParts(stage, grain);
    case "armchair":
      return upholsteredParts(grain, hex(BLOCK_COLORS.armchair), 0.78, 1);
    case "sofa":
      return upholsteredParts(grain, hex(BLOCK_COLORS.sofa), 0.96, 2);
    case "bed":
      return bedParts(grain);
    case "desk":
      return deskParts(grain);
    case "side_table":
      return sideTableParts(grain);
    case "dresser":
      return dresserParts(grain);
    case "wardrobe":
      return wardrobeParts(grain);
    case "rocking_chair":
      return rockingChairParts(grain);
    case "piano":
      return pianoParts(grain);
    case "bathtub":
      return bathtubParts(grain);
    case "fireplace":
      return fireplaceParts(stage, grain);
    case "aquarium":
      return aquariumParts(grain);
    case "coffee_table":
      return coffeeTableParts(grain);
    case "coat_rack":
      return coatRackParts(grain);
    case "floor_lamp":
      return floorLampParts(stage, grain);
    case "potted_tree":
      return pottedTreeParts(grain);
  }
}

/**
 * Every piece of one kind of furniture as instanced meshes: one draw per part. A low stone wall's
 * stretches go out once per side that joins another wall.
 */
export function furnitureInstances(
  stage: Stage,
  kind: FurnitureKind,
  grain: Texture,
  places: readonly DecorPlace[],
): Object3D[] {
  if (places.length === 0) return [];
  return placeParts(partsOf(stage, kind, grain), places);
}
