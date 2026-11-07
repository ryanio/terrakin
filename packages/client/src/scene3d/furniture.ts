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
  ExtrudeGeometry,
  IcosahedronGeometry,
  LatheGeometry,
  MeshLambertMaterial,
  type Object3D,
  Quaternion,
  Shape,
  SphereGeometry,
  type Texture,
  TorusGeometry,
  Vector2,
  Vector3,
} from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { colored, paper, type Stage, unindexed } from "./art";
import { box, type DecorPlace, merged, type Part, placeParts } from "./decor";
import { BRAND, hex } from "./palette";

const WOOD_DARK = hex(WOOD_BRAND);
const BRASS = 0xe7c27a;
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

/**
 * A fire's flames at (x, z) on the ground: three tongues of the outer color leaning out a little,
 * and two shorter ones of the inner color in front of them, all `size` times a campfire's.
 */
function flames(x: number, y: number, z: number, size: number) {
  const tongue = (r: number, h: number, dx: number, dz: number, lean: number, sides: number) => {
    const g = new ConeGeometry(r * size, h * size, sides);
    g.translate(0, (h * size) / 2, 0);
    g.rotateZ(lean);
    g.translate(x + dx * size, y, z + dz * size);
    return g.toNonIndexed();
  };
  return {
    outer: [
      tongue(0.11, 0.36, 0, 0, 0, 7),
      tongue(0.08, 0.26, -0.07, 0.02, 0.3, 6),
      tongue(0.08, 0.24, 0.07, -0.01, -0.28, 6),
    ],
    inner: [tongue(0.065, 0.22, -0.02, 0.05, 0.1, 6), tongue(0.05, 0.16, 0.04, 0.06, -0.15, 5)],
  };
}

/** A round log from `from` to `to`, `r` thick, for a fire's logs. */
function log(from: Vector3, to: Vector3, r: number): BufferGeometry {
  const dir = to.clone().sub(from);
  const g = new CylinderGeometry(r * 0.9, r, dir.length(), 6);
  g.applyQuaternion(new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), dir.normalize()));
  g.translate((from.x + to.x) / 2, (from.y + to.y) / 2, (from.z + to.z) / 2);
  return g.toNonIndexed();
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

/**
 * A side table (RFC 0050): a small round-cornered top over a drawer with a brass knob, on four
 * slim legs with a shelf low between them, lower than a table.
 */
function sideTableParts(grain: Texture): Part[] {
  const legs = [-0.2, 0.2].flatMap((x) =>
    [-0.2, 0.2].map((z) => box(0.06, 0.5, 0.06, [x, 0.25, z], [0, 0, 0], 0.02)),
  );
  return [
    {
      geometry: merged(
        [
          box(0.56, 0.06, 0.56, [0, 0.53, 0], [0, 0, 0], 0.05),
          box(0.46, 0.12, 0.46, [0, 0.44, 0], [0, 0, 0], 0.02),
          box(0.44, 0.03, 0.44, [0, 0.13, 0], [0, 0, 0], 0.01),
          ...legs,
        ],
        0.75,
      ),
      material: paper(hex(BLOCK_COLORS.side_table), grain),
      cast: true,
    },
    {
      geometry: merged([box(0.36, 0.08, 0.02, [0, 0.44, 0.23], [0, 0, 0], 0.01)], 0.9),
      material: paper(0x6b4a32, grain),
      cast: false,
    },
    {
      geometry: merged([box(0.05, 0.035, 0.035, [0, 0.44, 0.25], [0, 0, 0], 0.012)], 1),
      material: paper(BRASS, grain),
      cast: false,
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
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const s = new DodecahedronGeometry(0.085, 0);
    s.scale(1.2, 0.75, 1);
    s.translate(Math.cos(a) * 0.32, 0.06, Math.sin(a) * 0.32);
    stones.push(s.toNonIndexed());
  }
  // Four logs leaned together over the fire, their feet in a ring inside the stones.
  const top = new Vector3(0, 0.34, 0);
  const logs = [0.4, 2, 3.6, 5.2].map((a) =>
    log(new Vector3(Math.cos(a) * 0.2, 0.03, Math.sin(a) * 0.2), top, 0.035),
  );
  const fire = flames(0, 0.03, 0, 1);
  const embers = new CylinderGeometry(0.17, 0.19, 0.03, 9).translate(0, 0.02, 0).toNonIndexed();
  return [
    { geometry: merged(stones, 0.75), material: paper(hex(BLOCK_COLORS.stone), grain), cast: true },
    { geometry: merged(logs, 0.8), material: paper(WOOD_DARK, grain), cast: true },
    {
      geometry: merged([embers, ...fire.outer], 1),
      material: flicker(stage, hex(BLOCK_COLORS.campfire), grain, 0.75),
      cast: false,
    },
    {
      geometry: merged(fire.inner, 1),
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
 * A jack-o'-lantern: a squat pumpkin with eight ribs and a stubby stem, with eyes and a grin cut in
 * the side that faces you, lit warm from inside and pooling light on the ground.
 */
function jackOLanternParts(stage: Stage, grain: Texture): Part[] {
  const R = 0.22;
  const squash = 0.78;
  const middle = R * squash;
  /** How far in the grooves between the eight ribs go, as a share of the radius. */
  const groove = 0.08;
  const rib = (x: number, z: number) =>
    1 - groove + groove * Math.abs(Math.cos(4 * Math.atan2(z, x)));
  const body = new SphereGeometry(R, 24, 12);
  const pos = body.getAttribute("position");
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const k = rib(x, z);
    pos.setXYZ(i, x * k, pos.getY(i) * squash, z * k);
  }
  body.translate(0, middle, 0);
  const stem = new CylinderGeometry(0.025, 0.04, 0.12, 5);
  stem.rotateZ(0.25);
  stem.translate(0.02, middle * 2 + 0.04, 0);
  // Each cut is a thin glowing piece laid on the front of the pumpkin where it is, turned to face
  // out from the middle, so it reads as cut in rather than stuck on.
  const cut = (w: number, h: number, x: number, y: number, spin: number) => {
    const across = R * Math.sqrt(Math.max(0, 1 - ((y - middle) / middle) ** 2));
    let z = Math.sqrt(Math.max(0, across * across - x * x));
    z = Math.sqrt(Math.max(0, (across * rib(x, z)) ** 2 - x * x));
    return box(w, h, 0.012, [x, y, z - 0.002], [0, Math.atan2(x, z), spin], 0);
  };
  const face = [
    cut(0.06, 0.06, -0.075, 0.21, Math.PI / 4),
    cut(0.06, 0.06, 0.075, 0.21, Math.PI / 4),
    cut(0.035, 0.035, 0, 0.165, Math.PI / 4),
    ...[-0.07, -0.025, 0.025, 0.07].map((x) => cut(0.045, 0.04, x, 0.105 + Math.abs(x) * 0.25, 0)),
  ];
  return [
    {
      geometry: merged([body.toNonIndexed()], 0.75),
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

/** Four short turned legs under something upholstered `w` wide. */
function stubLegs(w: number): BufferGeometry[] {
  const half = w / 2;
  return [-half + 0.07, half - 0.07].flatMap((x) =>
    [-0.27, 0.27].map((z) =>
      new CylinderGeometry(0.035, 0.025, 0.11, 6).translate(x, 0.055, z).toNonIndexed(),
    ),
  );
}

/**
 * An armchair, a wingback: a deep seat cushion that tops out at `SEAT_TOP`, rolled arms, and a tall
 * back with a wing each side and a cushion against it, on short dark legs.
 */
function armchairParts(grain: Texture): Part[] {
  const cloth = hex(BLOCK_COLORS.armchair);
  const w = 0.8;
  const half = w / 2;
  return [
    { geometry: merged(stubLegs(w), 0.75), material: paper(WOOD_DARK, grain), cast: true },
    {
      geometry: merged(
        [
          box(w - 0.04, 0.24, 0.68, [0, 0.22, 0.01], [0, 0, 0], 0.05),
          box(w, 0.7, 0.16, [0, 0.62, -0.28], [-0.08, 0, 0], 0.07),
          ...[-1, 1].map((side) =>
            box(0.14, 0.3, 0.64, [side * (half - 0.07), 0.4, 0.02], [0, 0, 0], 0.065),
          ),
          ...[-1, 1].map((side) =>
            box(0.12, 0.46, 0.26, [side * (half - 0.06), 0.71, -0.17], [-0.08, 0, 0], 0.055),
          ),
        ],
        0.72,
      ),
      material: paper(cloth, grain),
      cast: true,
    },
    {
      geometry: merged(
        [
          box(w - 0.3, 0.1, 0.56, [0, SEAT_TOP - 0.05, 0.06], [0, 0, 0], 0.045),
          box(w - 0.3, 0.42, 0.09, [0, 0.66, -0.18], [-0.14, 0, 0], 0.04),
        ],
        0.85,
      ),
      material: paper(cloth, grain),
      cast: false,
    },
  ];
}

/**
 * A sofa, lower and longer than the armchair: two seat cushions that top out at `SEAT_TOP` and two
 * against a low back, between rolled arms, on short dark legs.
 */
function sofaParts(grain: Texture): Part[] {
  const cloth = hex(BLOCK_COLORS.sofa);
  const w = 0.98;
  const half = w / 2;
  const arm = 0.11;
  const seat = (w - 2 * arm) / 2 - 0.01;
  return [
    { geometry: merged(stubLegs(w), 0.75), material: paper(WOOD_DARK, grain), cast: true },
    {
      geometry: merged(
        [
          box(w - 0.02, 0.22, 0.66, [0, 0.22, 0.01], [0, 0, 0], 0.05),
          box(w, 0.44, 0.15, [0, 0.5, -0.27], [-0.06, 0, 0], 0.06),
          ...[-1, 1].map((side) =>
            box(arm, 0.26, 0.66, [side * (half - arm / 2), 0.4, 0.01], [0, 0, 0], 0.05),
          ),
        ],
        0.72,
      ),
      material: paper(cloth, grain),
      cast: true,
    },
    {
      geometry: merged(
        [-1, 1].flatMap((side) => [
          box(
            seat,
            0.1,
            0.54,
            [(side * (seat + 0.01)) / 2, SEAT_TOP - 0.05, 0.06],
            [0, 0, 0],
            0.04,
          ),
          box(seat, 0.3, 0.09, [(side * (seat + 0.01)) / 2, 0.58, -0.17], [-0.16, 0, 0], 0.04),
        ]),
        0.85,
      ),
      material: paper(cloth, grain),
      cast: false,
    },
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

/** How far a rocking chair's rockers curve: the radius of their arc, in tile units. */
const ROCKER_RADIUS = 0.85;
/** Where along the tile a rocker touches the ground, a little behind the middle. */
const ROCKER_LOW = -0.04;

/** How high the top of a rocker is at `z` along the tile. */
function rockerTop(z: number): number {
  const d = z - ROCKER_LOW;
  return ROCKER_RADIUS - Math.sqrt(ROCKER_RADIUS * ROCKER_RADIUS - d * d) + 0.06;
}

/**
 * One rocker at `x`: a flat runner 0.06 deep bent in an arc along the tile from north to south, its
 * low point on the ground and its ends well up, so it reads from any side.
 */
function rocker(x: number): BufferGeometry {
  const from = -0.47;
  const to = 0.44;
  const n = 16;
  const along = Array.from({ length: n + 1 }, (_, i) => from + ((to - from) * i) / n);
  const band = new Shape();
  along.forEach((z, i) => {
    if (i === 0) band.moveTo(z, rockerTop(z));
    else band.lineTo(z, rockerTop(z));
  });
  for (const z of [...along].reverse()) band.lineTo(z, rockerTop(z) - 0.06);
  band.closePath();
  const g = new ExtrudeGeometry(band, {
    depth: 0.05,
    bevelEnabled: true,
    bevelThickness: 0.01,
    bevelSize: 0.01,
    bevelSegments: 1,
  });
  // The band was drawn with the tile's north-south along x: turn it to run along z, centered on x.
  g.rotateY(-Math.PI / 2);
  g.translate(x + 0.025, 0, 0);
  return g.toNonIndexed();
}

/** How far a rocking chair's back leans out of upright, in radians. */
const ROCKING_LEAN = 0.2;

/** A length of wood `len` long rising from (x, y, z), leaned back like the chair's back. */
function backPiece(w: number, len: number, d: number, x: number, y: number, z: number) {
  const up = new Vector3(0, Math.cos(ROCKING_LEAN), -Math.sin(ROCKING_LEAN));
  return box(
    w,
    len,
    d,
    [x, y + (up.y * len) / 2, z + (up.z * len) / 2],
    [-ROCKING_LEAN, 0, 0],
    Math.min(w, d) * 0.4,
  );
}

/**
 * A rocking chair (a seat, RFC 0044): a seat with a cushion, arms, and a tall back of spindles leaned
 * back under a broad crest, its legs standing on two long curved rockers that rise at both ends.
 * Its seat is the chair's height, so `restPose3d` sits a resident in it the same way.
 */
function rockingChairParts(grain: Texture): Part[] {
  const seatY = 0.47;
  const backZ = -0.21;
  const legs = [-0.21, 0.21].flatMap((x) =>
    [backZ, 0.19].map((z) => {
      const foot = rockerTop(z);
      return box(0.055, seatY - foot, 0.055, [x, (seatY + foot) / 2, z], [0, 0, 0], 0.02);
    }),
  );
  const backTop = 0.66;
  const arms = [-1, 1].flatMap((side) => [
    box(0.07, 0.04, 0.46, [side * 0.25, 0.7, -0.02], [0, 0, 0], 0.02),
    box(0.04, 0.2, 0.04, [side * 0.25, 0.6, 0.17], [0, 0, 0], 0.015),
  ]);
  return [
    {
      geometry: merged(
        [
          box(0.5, 0.06, 0.48, [0, seatY, -0.01], [0, 0, 0], 0.02),
          backPiece(0.06, backTop, 0.06, -0.22, seatY, backZ),
          backPiece(0.06, backTop, 0.06, 0.22, seatY, backZ),
          ...[-0.135, -0.045, 0.045, 0.135].map((x) =>
            backPiece(0.03, backTop - 0.06, 0.03, x, seatY, backZ),
          ),
          backPiece(
            0.56,
            0.13,
            0.05,
            0,
            seatY + (backTop - 0.11) * Math.cos(ROCKING_LEAN),
            backZ - (backTop - 0.11) * Math.sin(ROCKING_LEAN),
          ),
          ...arms,
          ...legs,
        ],
        0.75,
      ),
      material: paper(hex(BLOCK_COLORS.rocking_chair), grain),
      cast: true,
    },
    {
      geometry: merged([rocker(-0.21), rocker(0.21)], 0.8),
      material: paper(WOOD_DARK, grain),
      cast: true,
    },
    {
      geometry: merged([box(0.42, 0.04, 0.4, [0, seatY + 0.045, 0.01], [0, 0, 0], 0.02)], 0.85),
      material: paper(hex(BLOCK_COLORS.armchair), grain),
      cast: false,
    },
  ];
}

/** An upright piano: a tall dark case, a keyboard of white and black keys, music, and pedals. */
function pianoParts(grain: Texture): Part[] {
  // Two octaves of white keys with the gaps between them drawn, and a black key after every white
  // one but the third and seventh of each octave.
  const keys = 14;
  const keyW = 0.84 / keys;
  const left = -0.42;
  const blackKeys = Array.from({ length: keys - 1 }, (_, i) => i)
    .filter((i) => i % 7 !== 2 && i % 7 !== 6)
    .map((i) => box(0.032, 0.025, 0.11, [left + (i + 1) * keyW, 0.83, 0.1], [0, 0, 0], 0.004));
  const gaps = Array.from({ length: keys - 1 }, (_, i) =>
    box(0.005, 0.005, 0.19, [left + (i + 1) * keyW, 0.821, 0.14], [0, 0, 0], 0),
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
    { geometry: merged([...blackKeys, ...gaps], 1), material: paper(0x1f1a18, grain), cast: false },
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
  // A tap at the foot: a post up from the rim, a spout bent back over the water, and two handles.
  const tap = [
    new CylinderGeometry(0.022, 0.026, 0.2, 8).translate(0.42, 0.62, 0).toNonIndexed(),
    new CylinderGeometry(0.02, 0.02, 0.12, 8)
      .rotateZ(Math.PI / 2)
      .translate(0.37, 0.71, 0)
      .toNonIndexed(),
    new CylinderGeometry(0.018, 0.012, 0.04, 8).translate(0.31, 0.69, 0).toNonIndexed(),
    ...[-0.06, 0.06].map((z) =>
      new CylinderGeometry(0.025, 0.025, 0.02, 8).translate(0.43, 0.6, z).toNonIndexed(),
    ),
  ];
  // Clouds of foam: little round bubbles heaped together on the water.
  const bubbles = [
    [-0.24, 0.05, 0.06],
    [-0.17, 0.0, 0.05],
    [-0.2, -0.06, 0.045],
    [-0.1, 0.07, 0.04],
    [0.06, -0.1, 0.05],
    [0.12, -0.05, 0.04],
    [0.02, 0.1, 0.035],
  ].map(([x, z, r]) => {
    const g = new SphereGeometry(r as number, 8, 6);
    g.scale(1, 0.75, 1);
    g.translate(x as number, 0.515, z as number);
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
      geometry: merged([...feet, ...tap], 0.85),
      material: paper(BRASS, grain),
      cast: true,
    },
    { geometry: merged(bubbles, 1), material: paper(0xffffff, grain), cast: false },
  ];
}

/**
 * A fireplace: a stone chimney breast as wide as the fire's surround that runs on up to the top of
 * the wall over a wooden mantel, an opening at the front, and logs burning on the hearth, lit warm
 * after dark like a campfire.
 */
function fireplaceParts(stage: Stage, grain: Texture): Part[] {
  const logs = [
    log(new Vector3(-0.17, 0.05, 0.0), new Vector3(0.15, 0.06, -0.08), 0.04),
    log(new Vector3(0.17, 0.05, 0.02), new Vector3(-0.13, 0.1, -0.07), 0.04),
  ];
  const fire = flames(0, 0.06, -0.03, 0.75);
  return [
    {
      geometry: merged(
        [
          box(0.94, 0.94, 0.12, [0, 0.47, -0.26], [0, 0, 0], 0.03),
          box(0.24, 0.9, 0.44, [-0.35, 0.45, -0.02], [0, 0, 0], 0.04),
          box(0.24, 0.9, 0.44, [0.35, 0.45, -0.02], [0, 0, 0], 0.04),
          box(0.94, 0.3, 0.44, [0, 0.75, -0.02], [0, 0, 0], 0.04),
          box(0.84, 0.3, 0.44, [0, 1.1, -0.02], [0, 0, 0], 0.03),
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
          box(0.9, 0.05, 0.22, [0, 0.025, 0.31], [0, 0, 0], 0.02),
          box(0.88, 0.04, 0.47, [0, 1.23, -0.02], [0, 0, 0], 0.015),
        ],
        0.8,
      ),
      material: paper(STONE_CAP, grain),
      cast: true,
    },
    {
      geometry: merged([box(1.02, 0.08, 0.56, [0, 0.94, 0], [0, 0, 0], 0.02)], 0.8),
      material: paper(hex(BLOCK_COLORS.table), grain),
      cast: true,
    },
    { geometry: merged(logs, 0.8), material: paper(WOOD_DARK, grain), cast: false },
    {
      geometry: merged(fire.outer, 1),
      material: flicker(stage, hex(BLOCK_COLORS.campfire), grain, 0.75),
      cast: false,
    },
    {
      geometry: merged(fire.inner, 1),
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
      return armchairParts(grain);
    case "sofa":
      return sofaParts(grain);
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
