/**
 * The town shop's decor in 3D (RFC 0008): a paper lantern on a shepherd's hook, a picture on an
 * easel, a white fence post whose rails reach the fences beside it, a garden bench, autumn's hay
 * bale and scarecrow (RFC 0017), Halloween's bat bunting, cauldron, and candy bowl (RFC 0022), and
 * winter's snowman, string of lights, little fir, and sled. Each model is a few merged, shade-baked
 * parts, so a plot full of fence posts is one instanced draw per part (decision 0030). After dark a
 * lantern's shade, a cauldron's brew, and a string's bulbs are lit from inside and a pool of light
 * lies under each (decision 0098), never a light of its own.
 */
import type { DecorKind } from "@terrakin/sim";
import { WOOD_DARK as WOOD_BRAND } from "@terrakin/ui/brand";
import { BAT_POINTS, HALLOWEEN_HEX, WINTER_HEX } from "@terrakin/ui/looks";
import {
  type BufferGeometry,
  CircleGeometry,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  Group,
  InstancedMesh,
  type Material,
  Matrix4,
  Mesh,
  MeshLambertMaterial,
  type Object3D,
  PlaneGeometry,
  Quaternion,
  Shape,
  ShapeGeometry,
  SphereGeometry,
  type Texture,
  TorusGeometry,
  Vector3,
} from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { bakeShade, lin, noShade, paper, type Stage } from "./art";
import { landscapeTexture } from "./items";
import { BRAND, blockLook, hex } from "./palette";

/** Which neighbors a fence post joins. */
export interface Joins {
  n: boolean;
  e: boolean;
  s: boolean;
  w: boolean;
}

/** Where one decor block stands: its middle on the ground, and a tint that fades neighbors. */
export interface DecorPlace {
  x: number;
  z: number;
  /** Multiplies the model's colors: white on the plot, toward the haze for a neighbor's. */
  tint: number;
  joins?: Joins;
}

/** One piece of a model, already in place: drawn once, or once per decor block. */
export interface Part {
  geometry: BufferGeometry;
  material: Material;
  /** Casts a shadow. Glows and see-through bits don't. */
  cast: boolean;
  /** A fence rail: drawn once per joined side, turned to face it, instead of once per block. */
  rail?: boolean;
  renderOrder?: number;
}

const WOOD_DARK = hex(WOOD_BRAND);
const WOOD = hex("#9a6b43");
const GOLD = hex("#d8b45a");
const STRAW = hex("#e8c878");

/** A rounded box, moved and turned into place, shade baked in. */
export function box(
  w: number,
  h: number,
  d: number,
  at: [number, number, number],
  turn: [number, number, number] = [0, 0, 0],
  radius = Math.min(w, h, d) * 0.3,
): BufferGeometry {
  const g = new RoundedBoxGeometry(w, h, d, 1, radius);
  g.rotateX(turn[0]);
  g.rotateY(turn[1]);
  g.rotateZ(turn[2]);
  g.translate(...at);
  return g;
}

/** Merge pieces into one geometry with a soft shade from bottom to top. */
export function merged(pieces: BufferGeometry[], bottom = 0.7): BufferGeometry {
  const g = bakeShade(mergeGeometries(pieces), bottom, 1);
  for (const p of pieces) p.dispose();
  return g;
}

// ---------- the models ----------

function lanternParts(stage: Stage, grain: Texture): Part[] {
  const postX = -0.2;
  const hangX = 0.2;
  const wood = merged([
    box(0.32, 0.06, 0.32, [postX, 0.03, 0]),
    box(0.08, 1.4, 0.08, [postX, 0.73, 0]),
    box(0.5, 0.06, 0.06, [0, 1.4, 0]),
    box(0.04, 0.1, 0.04, [hangX, 1.33, 0]),
    // Caps above and below the shade.
    new CylinderGeometry(0.1, 0.13, 0.06, 8).translate(hangX, 1.25, 0).toNonIndexed(),
    new CylinderGeometry(0.13, 0.1, 0.06, 8).translate(hangX, 0.79, 0).toNonIndexed(),
  ]);
  const color = blockLook("lantern").color;
  const shadeGeo = new SphereGeometry(0.23, 10, 8);
  shadeGeo.scale(1, 1.05, 1);
  shadeGeo.translate(hangX, 1.02, 0);
  const shade = new MeshLambertMaterial({
    color,
    emissive: color,
    map: grain,
    flatShading: true,
  });
  // Paper by day, lit from inside after dark with a small flicker (decision 0098); its pool of
  // light comes from its look's `glow` mark, with every other glow on the plot.
  stage.glow({ kind: "lamp", material: shade, day: 0.2, night: 0.95, flicker: true });
  const tassel = new CylinderGeometry(0, 0.035, 0.12, 5);
  tassel.rotateX(Math.PI);
  tassel.translate(hangX, 0.7, 0);
  return [
    { geometry: wood, material: paper(WOOD_DARK, grain), cast: true },
    { geometry: noShade(shadeGeo.toNonIndexed()), material: shade, cast: true },
    { geometry: noShade(tassel.toNonIndexed()), material: paper(BRAND.clay, grain), cast: false },
  ];
}

/** Where the picture sits in a frame's easel: its size, the easel's lean, and its middle. */
export const FRAME_PICTURE = { width: 0.7, height: 0.52, tilt: -0.14, y: 0.73, z: 0.14 } as const;

/**
 * A plane where a frame's picture goes, `lift` in front of the frame's back board. What's on
 * display in a frame (`displays.ts`) is drawn on one just in front of the frame's own landscape.
 */
export function framePicturePlane(lift = 0.012): PlaneGeometry {
  const { width, height, tilt, y, z } = FRAME_PICTURE;
  const geo = new PlaneGeometry(width, height);
  geo.translate(0, 0, lift);
  geo.rotateX(tilt);
  geo.translate(0, y, z);
  return geo;
}

function frameParts(stage: Stage, grain: Texture): Part[] {
  const { tilt, width: w, height: h, y: cy } = FRAME_PICTURE;
  const easel = merged([
    box(0.06, 1.25, 0.06, [-0.3, 0.6, 0.06], [tilt, 0, -0.1]),
    box(0.06, 1.25, 0.06, [0.3, 0.6, 0.06], [tilt, 0, 0.1]),
    box(0.06, 1.15, 0.06, [0, 0.55, -0.18], [0.3, 0, 0]),
    box(0.82, 0.05, 0.12, [0, 0.42, 0.14]),
  ]);
  // The frame around the picture, leaning back with the easel.
  const t = 0.07;
  const frame = merged(
    [
      box(w + t * 2, t, 0.06, [0, h / 2 + t / 2, 0]),
      box(w + t * 2, t, 0.06, [0, -h / 2 - t / 2, 0]),
      box(t, h, 0.06, [-w / 2 - t / 2, 0, 0]),
      box(t, h, 0.06, [w / 2 + t / 2, 0, 0]),
      box(w, h, 0.02, [0, 0, -0.02]),
    ].map((g) => g.rotateX(tilt).translate(0, cy, FRAME_PICTURE.z)),
    0.85,
  );
  const picGeo = framePicturePlane();
  const picture = stage.keep(landscapeTexture("meadow"));
  return [
    { geometry: easel, material: paper(WOOD, grain), cast: true },
    { geometry: frame, material: paper(GOLD, grain), cast: true },
    {
      geometry: picGeo,
      material: new MeshLambertMaterial({
        map: picture,
        emissive: 0xffffff,
        emissiveMap: picture,
        emissiveIntensity: 0.12,
      }),
      cast: false,
    },
  ];
}

function fenceParts(grain: Texture): Part[] {
  const color = blockLook("fence").color;
  const tip = new CylinderGeometry(0, 0.12, 0.14, 4);
  tip.rotateY(Math.PI / 4);
  tip.translate(0, 0.79, 0);
  const post = merged([box(0.17, 0.72, 0.17, [0, 0.36, 0], [0, 0, 0], 0.03), tip.toNonIndexed()]);
  // One rail pair from the post out to the tile's east edge; it turns to face each joined side.
  const rail = merged(
    [box(0.52, 0.08, 0.05, [0.26, 0.26, 0]), box(0.52, 0.08, 0.05, [0.26, 0.54, 0])],
    0.85,
  );
  return [
    { geometry: post, material: paper(color, grain), cast: true },
    { geometry: rail, material: paper(color, grain), cast: true, rail: true },
  ];
}

function benchParts(grain: Texture): Part[] {
  const slats: BufferGeometry[] = [];
  for (const z of [-0.12, 0, 0.12]) slats.push(box(0.94, 0.05, 0.1, [0, 0.42, z]));
  for (const y of [0.6, 0.76]) slats.push(box(0.94, 0.1, 0.04, [0, y, -0.2], [-0.12, 0, 0]));
  const iron: BufferGeometry[] = [];
  for (const x of [-0.4, 0.4]) {
    iron.push(
      box(0.05, 0.42, 0.05, [x, 0.2, 0.14]),
      box(0.05, 0.84, 0.05, [x, 0.41, -0.2], [-0.12, 0, 0]),
      box(0.05, 0.05, 0.42, [x, 0.58, -0.02]),
      box(0.05, 0.18, 0.05, [x, 0.5, 0.17]),
    );
  }
  return [
    { geometry: merged(slats, 0.8), material: paper(blockLook("bench").color, grain), cast: true },
    { geometry: merged(iron, 0.75), material: paper(BRAND.ink, grain), cast: true },
  ];
}

/** A bale of straw, tied twice with twine. */
function hayBaleParts(grain: Texture): Part[] {
  const { color, height: h } = blockLook("hay_bale");
  const bale = merged([box(0.86, h, 0.62, [0, h / 2, 0], [0, 0, 0], 0.09)], 0.72);
  // Two bands of twine around the bale, just proud of its sides and top.
  const twine = merged(
    [-0.2, 0.2].flatMap((x) => [
      box(0.035, 0.02, 0.64, [x, h + 0.003, 0]),
      box(0.035, h, 0.02, [x, h / 2, 0.315]),
      box(0.035, h, 0.02, [x, h / 2, -0.315]),
    ]),
    0.8,
  );
  return [
    { geometry: bale, material: paper(color, grain), cast: true },
    { geometry: twine, material: paper(WOOD, grain), cast: false },
  ];
}

/** A scarecrow on its post: a straw hat, a burlap head, a red shirt, and straw at the hands. */
function scarecrowParts(grain: Texture): Part[] {
  const post = merged([box(0.08, 1.2, 0.08, [0, 0.6, 0]), box(0.98, 0.07, 0.07, [0, 0.98, 0])]);
  const shirt = merged(
    [
      box(0.5, 0.48, 0.2, [0, 0.82, 0], [0, 0, 0], 0.05),
      box(0.74, 0.16, 0.16, [0, 0.98, 0], [0, 0, 0], 0.05),
    ],
    0.75,
  );
  const head = new SphereGeometry(0.16, 10, 8);
  head.translate(0, 1.22, 0);
  const hat = merged(
    [
      new CylinderGeometry(0.27, 0.27, 0.03, 12).translate(0, 1.34, 0).toNonIndexed(),
      new CylinderGeometry(0.12, 0.15, 0.14, 10).translate(0, 1.42, 0).toNonIndexed(),
    ],
    0.85,
  );
  const straw = merged(
    [-1, 1].map((side) => {
      const tuft = new ConeGeometry(0.06, 0.16, 6);
      tuft.rotateZ((side * Math.PI) / 2);
      return tuft.translate(side * 0.55, 0.98, 0).toNonIndexed();
    }),
    0.85,
  );
  return [
    { geometry: post, material: paper(WOOD, grain), cast: true },
    { geometry: shirt, material: paper(blockLook("scarecrow").color, grain), cast: true },
    { geometry: noShade(head.toNonIndexed()), material: paper(hex("#d9bf8f"), grain), cast: true },
    { geometry: hat, material: paper(STRAW, grain), cast: true },
    { geometry: straw, material: paper(STRAW, grain), cast: false },
  ];
}

// ---------- Halloween's decor (RFC 0022) ----------

/** A flat shape from points, both sides drawn, in the x-y plane facing +z. */
function flat(points: readonly (readonly [number, number])[]): BufferGeometry {
  const shape = new Shape();
  points.forEach(([x, y], i) => {
    if (i === 0) shape.moveTo(x, y);
    else shape.lineTo(x, y);
  });
  return new ShapeGeometry(shape).toNonIndexed();
}

/** Where the bunting's string hangs at `t` along it, 0 at the west post and 1 at the east. */
const string = (t: number): [number, number] => [-0.42 + 0.84 * t, 0.95 - 0.68 * t * (1 - t)];

/** Two little posts with a string of paper bats and orange pennants between them. */
function batBuntingParts(grain: Texture): Part[] {
  const posts = merged([
    box(0.06, 1.0, 0.06, [-0.42, 0.5, 0], [0, 0, 0], 0.02),
    box(0.06, 1.0, 0.06, [0.42, 0.5, 0], [0, 0, 0], 0.02),
    box(0.12, 0.04, 0.12, [-0.42, 0.02, 0]),
    box(0.12, 0.04, 0.12, [0.42, 0.02, 0]),
  ]);
  // The string sags in the middle: two lengths meeting there.
  const [mx, my] = string(0.5);
  const half = Math.hypot(mx + 0.42, 0.95 - my);
  const sag = Math.atan2(0.95 - my, mx + 0.42);
  const line = merged(
    [
      box(half, 0.015, 0.015, [(-0.42 + mx) / 2, (0.95 + my) / 2, 0], [0, 0, -sag], 0.005),
      box(half, 0.015, 0.015, [(0.42 + mx) / 2, (0.95 + my) / 2, 0], [0, 0, sag], 0.005),
    ],
    0.9,
  );
  const bat = (t: number) => {
    const [x, y] = string(t);
    const span = 0.27;
    return flat(
      BAT_POINTS.map(([bx, by]): [number, number] => [
        x + bx * span * 0.5,
        y - 0.08 - by * span * 0.5,
      ]),
    );
  };
  const pennant = (t: number) => {
    const [x, y] = string(t);
    return flat([
      [x - 0.06, y],
      [x + 0.06, y],
      [x, y - 0.14],
    ]);
  };
  const sided = (color: number) => paper(color, grain, { side: DoubleSide });
  return [
    { geometry: posts, material: paper(WOOD_DARK, grain), cast: true },
    { geometry: line, material: paper(hex("#5a4f60"), grain), cast: false },
    {
      geometry: noShade(mergeGeometries([bat(0.2), bat(0.5), bat(0.8)])),
      material: sided(hex(HALLOWEEN_HEX.bat)),
      cast: true,
    },
    {
      geometry: noShade(mergeGeometries([pennant(0.35), pennant(0.65)])),
      material: sided(hex(HALLOWEEN_HEX.witchBand)),
      cast: false,
    },
  ];
}

/**
 * An iron cauldron on three feet with a green brew in it and bubbles rising. The brew is lit a
 * little by day and glows after dark, with a pool of light under it from its look's `glow` mark.
 */
function cauldronParts(stage: Stage, grain: Texture): Part[] {
  const r = 0.33;
  const cy = 0.38;
  // The pot: a sphere open from its rim down.
  const potGeo = new SphereGeometry(r, 18, 12, 0, Math.PI * 2, Math.PI * 0.35, Math.PI * 0.65);
  potGeo.translate(0, cy, 0);
  const rimY = cy + r * Math.cos(Math.PI * 0.35);
  const rimR = r * Math.sin(Math.PI * 0.35);
  const rim = new TorusGeometry(rimR, 0.035, 8, 24);
  rim.rotateX(Math.PI / 2);
  rim.translate(0, rimY, 0);
  const feet = [0, 1, 2].map((i) => {
    const a = (i / 3) * Math.PI * 2 + Math.PI / 2;
    return box(0.07, 0.14, 0.07, [Math.cos(a) * 0.19, 0.07, Math.sin(a) * 0.19], [0, 0, 0], 0.02);
  });
  const iron = merged([potGeo.toNonIndexed(), rim.toNonIndexed(), ...feet], 0.6);
  const brewColor = hex(HALLOWEEN_HEX.brew);
  const brew = new MeshLambertMaterial({
    color: brewColor,
    emissive: brewColor,
    flatShading: true,
  });
  stage.glow({ kind: "lamp", material: brew, day: 0.25, night: 0.95, flicker: true });
  const surface = new CircleGeometry(rimR - 0.02, 20);
  surface.rotateX(-Math.PI / 2);
  surface.translate(0, rimY - 0.03, 0);
  const bubbles = [
    [0.08, 0.06, 0.05],
    [-0.1, 0.12, -0.04],
    [0.02, 0.2, 0.03],
  ].map(([x, dy, z], i) => {
    const b = new SphereGeometry(0.04 - i * 0.008, 8, 6);
    b.translate(x as number, rimY + (dy as number), z as number);
    return b.toNonIndexed();
  });
  return [
    { geometry: iron, material: paper(hex(HALLOWEEN_HEX.iron), grain), cast: true },
    { geometry: noShade(surface.toNonIndexed()), material: brew, cast: false },
    {
      geometry: noShade(mergeGeometries(bubbles)),
      material: paper(hex(HALLOWEEN_HEX.brewLight), grain),
      cast: false,
    },
  ];
}

/** An orange bowl on a short stand, heaped with wrapped candy in four colors. */
function candyBowlParts(grain: Texture): Part[] {
  const r = 0.29;
  const cy = 0.5;
  const bowl = new SphereGeometry(r, 18, 10, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2);
  bowl.translate(0, cy, 0);
  const stand = merged([
    new CylinderGeometry(0.07, 0.12, 0.24, 12).translate(0, 0.12, 0).toNonIndexed(),
    new CylinderGeometry(0.16, 0.16, 0.03, 14).translate(0, 0.015, 0).toNonIndexed(),
  ]);
  // Candy heaped over the rim, in rings, each color its own part.
  const spots: [number, number, number][] = [
    [0, 0.6, 0],
    [0.14, 0.55, 0.06],
    [-0.12, 0.55, 0.1],
    [0.05, 0.55, -0.15],
    [-0.15, 0.53, -0.08],
    [0.18, 0.52, -0.09],
    [-0.02, 0.54, 0.18],
    [0.11, 0.6, -0.04],
  ];
  const candy = HALLOWEEN_HEX.candy;
  const sweets = candy.slice(0, 4).map((color, c) => {
    const pieces = spots
      .filter((_, i) => i % 4 === c)
      .map(([x, y, z]) => new SphereGeometry(0.065, 8, 6).translate(x, y, z).toNonIndexed());
    return {
      geometry: noShade(mergeGeometries(pieces)),
      material: paper(hex(color), grain),
      cast: false,
    };
  });
  return [
    {
      geometry: noShade(bowl.toNonIndexed()),
      material: paper(blockLook("candy_bowl").color, grain, { side: DoubleSide }),
      cast: true,
    },
    { geometry: stand, material: paper(hex(HALLOWEEN_HEX.pumpkinRib), grain), cast: true },
    ...sweets,
  ];
}

// ---------- winter's decor (RFC 0017) ----------

const W = WINTER_HEX;

/**
 * A snowman: three balls of snow, coal eyes and buttons, a carrot nose, a red scarf with a tail,
 * twig arms, and a little hat. Its face looks south, toward the camera.
 */
function snowmanParts(grain: Texture): Part[] {
  const ball = (r: number, y: number) => {
    const g = new SphereGeometry(r, 16, 12);
    g.scale(1, 0.94, 1);
    return g.translate(0, y, 0).toNonIndexed();
  };
  const snow = merged([ball(0.29, 0.28), ball(0.205, 0.71), ball(0.145, 1.02)], 0.62);
  const spots: [number, number, number][] = [
    [-0.05, 1.05, 0.13],
    [0.05, 1.05, 0.13],
    [0, 0.76, 0.2],
    [0, 0.66, 0.2],
    [0, 0.36, 0.28],
  ];
  const coal = mergeGeometries(
    spots.map(([x, y, z]) => new SphereGeometry(0.024, 6, 4).translate(x, y, z).toNonIndexed()),
  );
  const nose = new ConeGeometry(0.032, 0.15, 8);
  nose.rotateX(Math.PI / 2);
  nose.translate(0, 1.0, 0.2);
  const scarf = merged(
    [
      new TorusGeometry(0.155, 0.045, 8, 18)
        .rotateX(Math.PI / 2)
        .translate(0, 0.885, 0)
        .toNonIndexed(),
      box(0.08, 0.2, 0.04, [0.08, 0.77, 0.17], [0.2, 0, 0.15], 0.015),
    ],
    0.85,
  );
  const arms = merged(
    [-1, 1].flatMap((side) => [
      box(0.38, 0.028, 0.028, [side * 0.34, 0.82, 0], [0, 0, side * 0.5], 0.01),
      box(0.12, 0.022, 0.022, [side * 0.5, 0.95, 0], [0, 0, side * 1.2], 0.008),
    ]),
  );
  const hat = merged(
    [
      new CylinderGeometry(0.17, 0.17, 0.03, 16).translate(0, 1.155, 0).toNonIndexed(),
      new CylinderGeometry(0.1, 0.11, 0.17, 14).translate(0, 1.25, 0).toNonIndexed(),
    ],
    0.8,
  );
  return [
    { geometry: snow, material: paper(hex(W.snow), grain), cast: true },
    { geometry: noShade(coal), material: paper(hex(W.coal), grain), cast: false },
    { geometry: noShade(nose.toNonIndexed()), material: paper(hex(W.carrot), grain), cast: false },
    { geometry: scarf, material: paper(hex(W.scarf), grain), cast: true },
    { geometry: arms, material: paper(WOOD_DARK, grain), cast: true },
    { geometry: hat, material: paper(hex(W.hat), grain), cast: true },
  ];
}

/** The string of lights' wire: points along its sag, from the west post's top to the east's. */
const WIRE: readonly (readonly [number, number])[] = [0, 0.25, 0.5, 0.75, 1].map((t) => [
  -0.42 + 0.84 * t,
  0.98 - 0.6 * t * (1 - t),
]);

/** Where the wire hangs at `t` along it, 0 at the west post and 1 at the east, on its segments. */
function wireAt(t: number): [number, number] {
  const k = Math.min(WIRE.length - 2, Math.floor(t * (WIRE.length - 1)));
  const [x0, y0] = WIRE[k] as readonly [number, number];
  const [x1, y1] = WIRE[k + 1] as readonly [number, number];
  const f = t * (WIRE.length - 1) - k;
  return [x0 + (x1 - x0) * f, y0 + (y1 - y0) * f];
}

/**
 * Two little posts with a string of colored bulbs hanging from a sagging wire between them. Each
 * color is one part, lit a little by day and glowing after dark, twinkling while motion is
 * allowed, with a pool of light under the string from its look's `glow` mark (decision 0098).
 */
function stringLightsParts(stage: Stage, grain: Texture): Part[] {
  const posts = merged([
    box(0.06, 1.02, 0.06, [-0.42, 0.51, 0], [0, 0, 0], 0.02),
    box(0.06, 1.02, 0.06, [0.42, 0.51, 0], [0, 0, 0], 0.02),
    box(0.12, 0.04, 0.12, [-0.42, 0.02, 0]),
    box(0.12, 0.04, 0.12, [0.42, 0.02, 0]),
  ]);
  const spots = [0.12, 0.31, 0.5, 0.69, 0.88];
  const wire = merged(
    [
      ...WIRE.slice(1).map(([x1, y1], i) => {
        const [x0, y0] = WIRE[i] as readonly [number, number];
        const length = Math.hypot(x1 - x0, y1 - y0);
        const turn = Math.atan2(y1 - y0, x1 - x0);
        return box(
          length + 0.01,
          0.014,
          0.014,
          [(x0 + x1) / 2, (y0 + y1) / 2, 0],
          [0, 0, turn],
          0.005,
        );
      }),
      // A little socket under the wire for each bulb.
      ...spots.map((t) => {
        const [x, y] = wireAt(t);
        return box(0.035, 0.04, 0.035, [x, y - 0.02, 0], [0, 0, 0], 0.01);
      }),
    ],
    0.9,
  );
  const bulbs = W.bulbs.map((color, c) => {
    const pieces = spots
      .filter((_, i) => i % W.bulbs.length === c)
      .map((t) => {
        const [x, y] = wireAt(t);
        const b = new SphereGeometry(0.045, 8, 6);
        b.scale(1, 1.35, 1);
        return b.translate(x, y - 0.085, 0).toNonIndexed();
      });
    const lit = new MeshLambertMaterial({ color: hex(color), emissive: hex(color) });
    stage.glow({ kind: "lamp", material: lit, day: 0.3, night: 1.1, flicker: true });
    return { geometry: noShade(mergeGeometries(pieces)), material: lit, cast: false };
  });
  return [
    { geometry: posts, material: paper(WOOD_DARK, grain), cast: true },
    { geometry: wire, material: paper(hex(W.wire), grain), cast: false },
    ...bulbs,
  ];
}

/** A little fir in a clay pot: three tiers of needles with snow on them, and a gold star on top. */
function littleFirParts(grain: Texture): Part[] {
  const pot = merged([
    new CylinderGeometry(0.2, 0.15, 0.26, 14).translate(0, 0.13, 0).toNonIndexed(),
    new CylinderGeometry(0.23, 0.23, 0.06, 14).translate(0, 0.27, 0).toNonIndexed(),
  ]);
  const tiers: [number, number, number][] = [
    [0.4, 0.42, 0.5],
    [0.3, 0.36, 0.75],
    [0.2, 0.3, 0.98],
  ];
  const needles = merged(
    [
      new CylinderGeometry(0.05, 0.05, 0.16, 8).translate(0, 0.36, 0).toNonIndexed(),
      ...tiers.map(([r, h, y]) => new ConeGeometry(r, h, 10).translate(0, y, 0).toNonIndexed()),
    ],
    0.55,
  );
  // A dusting of snow: a flat cap a little smaller than each tier, just under its tip.
  const snow = merged(
    tiers.map(([r, h, y]) =>
      new ConeGeometry(r * 0.55, h * 0.4, 10).translate(0, y + h * 0.18, 0).toNonIndexed(),
    ),
    0.9,
  );
  const points: [number, number][] = [];
  for (let i = 0; i < 10; i++) {
    const a = Math.PI / 2 + (i * Math.PI) / 5;
    const r = i % 2 === 0 ? 0.1 : 0.045;
    points.push([Math.cos(a) * r, 1.22 + Math.sin(a) * r]);
  }
  return [
    { geometry: pot, material: paper(hex(W.pot), grain), cast: true },
    { geometry: needles, material: paper(hex(W.needles), grain), cast: true },
    { geometry: snow, material: paper(hex(W.snow), grain), cast: false },
    {
      geometry: noShade(flat(points)),
      material: paper(hex(W.star), grain, { side: DoubleSide }),
      cast: false,
    },
  ];
}

/** A sled: red slats on two iron runners that curl up in front, east, and a loop of rope. */
function sledParts(grain: Texture): Part[] {
  const runners = merged(
    [-0.2, 0.2].flatMap((z) => {
      const curl = new TorusGeometry(0.1, 0.022, 6, 10, Math.PI);
      curl.rotateZ(-Math.PI / 2);
      curl.translate(0.32, 0.12, z);
      return [
        box(0.66, 0.035, 0.04, [-0.01, 0.02, z], [0, 0, 0], 0.012),
        curl.toNonIndexed(),
        box(0.03, 0.14, 0.03, [-0.24, 0.1, z]),
        box(0.03, 0.14, 0.03, [0.04, 0.1, z]),
      ];
    }),
  );
  const slats = merged(
    [-0.13, 0, 0.13].map((z) => box(0.62, 0.035, 0.11, [-0.02, 0.19, z], [0, 0, 0], 0.012)),
    0.85,
  );
  const rope = new TorusGeometry(0.11, 0.012, 5, 14, Math.PI * 1.3);
  rope.rotateY(Math.PI / 2);
  rope.translate(0.42, 0.2, 0);
  return [
    { geometry: runners, material: paper(hex(W.runner), grain), cast: true },
    { geometry: slats, material: paper(hex(W.slat), grain), cast: true },
    { geometry: noShade(rope.toNonIndexed()), material: paper(hex(W.rope), grain), cast: false },
  ];
}

function partsOf(stage: Stage, kind: DecorKind, grain: Texture): Part[] {
  if (kind === "lantern") return lanternParts(stage, grain);
  if (kind === "frame") return frameParts(stage, grain);
  if (kind === "fence") return fenceParts(grain);
  if (kind === "hay_bale") return hayBaleParts(grain);
  if (kind === "scarecrow") return scarecrowParts(grain);
  if (kind === "bat_bunting") return batBuntingParts(grain);
  if (kind === "cauldron") return cauldronParts(stage, grain);
  if (kind === "candy_bowl") return candyBowlParts(grain);
  if (kind === "snowman") return snowmanParts(grain);
  if (kind === "string_lights") return stringLightsParts(stage, grain);
  if (kind === "little_fir") return littleFirParts(grain);
  if (kind === "sled") return sledParts(grain);
  return benchParts(grain);
}

// ---------- placing them ----------

const UP = new Vector3(0, 1, 0);
/** How far to turn a rail (built facing east) toward each side. North is -z. */
const RAIL_TURN: Record<keyof Joins, number> = {
  e: 0,
  n: Math.PI / 2,
  w: Math.PI,
  s: -Math.PI / 2,
};

/**
 * Every block of one decor kind as instanced meshes: one draw per part, however many there are.
 * Fence rails go out once per joined side.
 */
export function decorInstances(
  stage: Stage,
  kind: DecorKind,
  grain: Texture,
  places: readonly DecorPlace[],
): Object3D[] {
  if (places.length === 0) return [];
  return placeParts(partsOf(stage, kind, grain), places);
}

/**
 * Parts of one model at every place, as instanced meshes: one draw per part. A `rail` part goes
 * out once per joined side, turned to face it. Shared by decor and furniture (`furniture.ts`).
 */
export function placeParts(parts: readonly Part[], places: readonly DecorPlace[]): Object3D[] {
  const out: Object3D[] = [];
  const m = new Matrix4();
  const q = new Quaternion();
  const one = new Vector3(1, 1, 1);
  for (const part of parts) {
    const spots: { x: number; z: number; turn: number; tint: number }[] = [];
    for (const p of places) {
      if (!part.rail) spots.push({ x: p.x, z: p.z, turn: 0, tint: p.tint });
      else
        for (const side of ["n", "e", "s", "w"] as const)
          if (p.joins?.[side]) spots.push({ x: p.x, z: p.z, turn: RAIL_TURN[side], tint: p.tint });
    }
    if (spots.length === 0) {
      part.geometry.dispose();
      part.material.dispose();
      continue;
    }
    const mesh = new InstancedMesh(part.geometry, part.material, spots.length);
    spots.forEach((s, i) => {
      q.setFromAxisAngle(UP, s.turn);
      m.compose(new Vector3(s.x, 0, s.z), q, one);
      mesh.setMatrixAt(i, m);
      mesh.setColorAt(i, lin(s.tint));
    });
    mesh.castShadow = part.cast;
    mesh.receiveShadow = part.cast;
    if (part.renderOrder) mesh.renderOrder = part.renderOrder;
    out.push(mesh);
  }
  return out;
}

/**
 * One decor model standing at the origin, for the gallery. The gallery is always in daylight, so a
 * lantern there is paper, unlit.
 */
export function decorModel(stage: Stage, kind: DecorKind, grain: Texture): Group {
  const group = new Group();
  group.name = kind;
  for (const part of partsOf(stage, kind, grain)) {
    if (part.rail) {
      // A post on its own has no rails; the gallery shows a short run with decorInstances.
      part.geometry.dispose();
      part.material.dispose();
      continue;
    }
    const mesh = new Mesh(part.geometry, part.material);
    mesh.castShadow = part.cast;
    mesh.receiveShadow = part.cast;
    if (part.renderOrder) mesh.renderOrder = part.renderOrder;
    group.add(mesh);
  }
  return group;
}
