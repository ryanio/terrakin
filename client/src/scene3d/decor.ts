/**
 * The town shop's decor in 3D (RFC 0008): a paper lantern on a shepherd's hook, a picture on an
 * easel, a white fence post whose rails reach the fences beside it, and a garden bench. Each model
 * is a few merged, shade-baked parts, so a plot full of fence posts is one instanced draw per part
 * (decision 0030). Lanterns glow with an emissive shade and a soft pool of light on the ground,
 * not a light each; only the gallery's single lantern gets a point light, and only on desktop.
 */
import type { DecorKind } from "@terrakin/sim";
import { WOOD_DARK as WOOD_BRAND } from "@terrakin/ui/brand";
import {
  AdditiveBlending,
  type BufferGeometry,
  CylinderGeometry,
  Group,
  InstancedMesh,
  type Material,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  type Object3D,
  PlaneGeometry,
  PointLight,
  Quaternion,
  SphereGeometry,
  type Texture,
  Vector3,
} from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { bakeShade, lin, noShade, paper, type Stage, spotTexture } from "./art";
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
interface Part {
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

/** A rounded box, moved and turned into place, shade baked in. */
function box(
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
function merged(pieces: BufferGeometry[], bottom = 0.7): BufferGeometry {
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
    emissiveIntensity: 0.6,
    map: grain,
    flatShading: true,
  });
  // A slow, small flicker. Stops with the rest of the motion when motion is reduced.
  stage.animate(({ time }) => {
    shade.emissiveIntensity = 0.6 + Math.sin(time * 2.3) * 0.05 + Math.sin(time * 5.1) * 0.03;
  });
  const tassel = new CylinderGeometry(0, 0.035, 0.12, 5);
  tassel.rotateX(Math.PI);
  tassel.translate(hangX, 0.7, 0);
  const glowGeo = new PlaneGeometry(1.8, 1.8);
  glowGeo.rotateX(-Math.PI / 2);
  glowGeo.translate(hangX, 0.02, 0);
  return [
    { geometry: wood, material: paper(WOOD_DARK, grain), cast: true },
    { geometry: noShade(shadeGeo.toNonIndexed()), material: shade, cast: true },
    { geometry: noShade(tassel.toNonIndexed()), material: paper(BRAND.clay, grain), cast: false },
    {
      geometry: glowGeo,
      material: new MeshBasicMaterial({
        map: stage.keep(spotTexture("255, 186, 92")),
        transparent: true,
        opacity: 0.5,
        depthWrite: false,
        blending: AdditiveBlending,
      }),
      cast: false,
      renderOrder: 1,
    },
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

function partsOf(stage: Stage, kind: DecorKind, grain: Texture): Part[] {
  if (kind === "lantern") return lanternParts(stage, grain);
  if (kind === "frame") return frameParts(stage, grain);
  if (kind === "fence") return fenceParts(grain);
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
  const out: Object3D[] = [];
  const m = new Matrix4();
  const q = new Quaternion();
  const one = new Vector3(1, 1, 1);
  for (const part of partsOf(stage, kind, grain)) {
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
 * One decor model standing at the origin, for the gallery. A lantern there gets a real warm
 * light on desktop, since it's the only one.
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
  if (kind === "lantern" && stage.quality === "high") {
    const light = new PointLight(0xffb85c, 1.2, 3, 1.6);
    light.position.set(0.2, 1.0, 0.25);
    group.add(light);
  }
  return group;
}
