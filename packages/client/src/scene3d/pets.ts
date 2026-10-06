/**
 * Pets in 3D (RFC 0019): each kind as a handful of primitives (spheres, cones, cylinders) merged
 * into one geometry with its coat baked into the vertex colors, so a pet is one draw call, about
 * 300 to 700 triangles, under one shared material. Awake it sits or stands; asleep it curls up.
 * The colors are the 2D coats' (`petColors` in the sim), so a ginger cat is the same ginger on the
 * map, in a profile, and here. Shared by the world and the plot view.
 */
import { type PetCoat, type PetKind, type PetPosture, petColors } from "@terrakin/sim";
import {
  BufferAttribute,
  type BufferGeometry,
  ConeGeometry,
  CylinderGeometry,
  Matrix4,
  MeshLambertMaterial,
  Quaternion,
  SphereGeometry,
  Vector3,
} from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { lin, unindexed } from "./art";
import { hex } from "./palette";

const INK = 0x2b2620;
const PINK = 0xe48a8f;

type V3 = [number, number, number];

/** One part: a geometry, moved and turned into place, in one flat color. */
function part(g: BufferGeometry, color: number, at: V3, turn: V3 = [0, 0, 0], scale?: V3) {
  const geo = unindexed(g);
  const m = new Matrix4().compose(
    new Vector3(...at),
    new Quaternion()
      .setFromAxisAngle(new Vector3(1, 0, 0), turn[0])
      .multiply(
        new Quaternion()
          .setFromAxisAngle(new Vector3(0, 1, 0), turn[1])
          .multiply(new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), turn[2])),
      ),
    new Vector3(...(scale ?? [1, 1, 1])),
  );
  geo.applyMatrix4(m);
  const c = lin(color);
  const n = geo.getAttribute("position").count;
  const colors = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) colors.set([c.r, c.g, c.b], i * 3);
  geo.setAttribute("color", new BufferAttribute(colors, 3));
  return geo;
}

/** An ellipsoid with radii (x, y, z). */
const ball = (r: V3, color: number, at: V3, turn: V3 = [0, 0, 0], detail = 10) =>
  part(new SphereGeometry(1, detail, Math.max(6, detail - 2)), color, at, turn, r);
/** A cone `h` tall with base radius `r`, pointing up before it's turned. */
const cone = (r: number, h: number, color: number, at: V3, turn: V3 = [0, 0, 0]) =>
  part(new ConeGeometry(r, h, 7), color, at, turn);
/** A cylinder `h` tall, tapering from `top` to `bottom` radius. */
const rod = (top: number, bottom: number, h: number, color: number, at: V3, turn: V3 = [0, 0, 0]) =>
  part(new CylinderGeometry(top, bottom, h, 7), color, at, turn);

/** Two eyes on a head at (0, y, z), `gap` apart: dots open, flat slits shut. */
function eyes(y: number, z: number, gap: number, r: number, shut: boolean): BufferGeometry[] {
  return [-gap, gap].map((x) =>
    shut
      ? ball([r * 1.3, r * 0.3, r * 0.5], INK, [x, y, z])
      : ball([r, r * 1.15, r * 0.7], INK, [x, y, z], [0, 0, 0], 6),
  );
}

interface Colors {
  fur: number;
  belly: number;
  mark: number;
  mark2: number;
  bill: number;
}

function colorsOf(kind: PetKind, coat: PetCoat): Colors {
  const c = petColors(kind, coat);
  return {
    fur: hex(c.fur),
    belly: hex(c.belly),
    mark: hex(c.mark),
    mark2: hex(c.mark2 ?? c.mark),
    bill: hex(c.bill ?? "#f2a33a"),
  };
}

// ---------- the kinds, facing +z, feet on y = 0 ----------

function cat(c: Colors, coat: string, asleep: boolean): BufferGeometry[] {
  const patch = coat === "calico";
  if (asleep) {
    return [
      ball([0.2, 0.11, 0.17], c.fur, [0, 0.1, -0.02]),
      ...(patch ? [ball([0.09, 0.05, 0.08], c.mark2, [-0.08, 0.17, -0.05])] : []),
      rod(0.03, 0.03, 0.34, c.fur, [0.05, 0.04, 0.15], [0, 0, Math.PI / 2]),
      ball([0.11, 0.09, 0.1], c.fur, [0.06, 0.13, 0.13]),
      cone(0.04, 0.07, c.fur, [0.0, 0.22, 0.12], [0, 0, 0.3]),
      cone(0.04, 0.07, c.fur, [0.12, 0.22, 0.12], [0, 0, -0.3]),
      ball([0.045, 0.03, 0.03], c.belly, [0.06, 0.1, 0.22]),
      ...eyes(0.15, 0.215, 0.04, 0.016, true).map((g) => g.translate(0.06, 0, 0)),
    ];
  }
  return [
    ball([0.14, 0.16, 0.16], c.fur, [0, 0.16, -0.03]),
    ...(patch ? [ball([0.08, 0.07, 0.07], c.mark2, [-0.09, 0.2, -0.06])] : []),
    ball([0.08, 0.1, 0.05], c.belly, [0, 0.18, 0.1]),
    ball([0.045, 0.03, 0.06], coat === "black" ? c.belly : c.fur, [-0.06, 0.03, 0.1]),
    ball([0.045, 0.03, 0.06], coat === "black" ? c.belly : c.fur, [0.06, 0.03, 0.1]),
    rod(0.024, 0.03, 0.32, c.fur, [0, 0.2, -0.2], [-0.5, 0, 0]),
    ball([0.135, 0.12, 0.12], c.fur, [0, 0.38, 0.05]),
    ...(patch ? [ball([0.07, 0.05, 0.06], c.mark, [0.06, 0.45, 0.03])] : []),
    cone(0.05, 0.1, c.fur, [-0.075, 0.5, 0.04], [0, 0, 0.25]),
    cone(0.05, 0.1, c.fur, [0.075, 0.5, 0.04], [0, 0, -0.25]),
    ball([0.06, 0.04, 0.04], c.belly, [0, 0.34, 0.15]),
    ball([0.016, 0.012, 0.012], PINK, [0, 0.365, 0.19]),
    ...eyes(0.4, 0.155, 0.05, 0.02, false),
  ];
}

function dog(c: Colors, coat: string, asleep: boolean): BufferGeometry[] {
  const spots = coat === "spotted";
  if (asleep) {
    return [
      ball([0.21, 0.12, 0.18], c.fur, [0, 0.11, -0.02]),
      ...(spots ? [ball([0.05, 0.04, 0.05], c.mark, [-0.1, 0.19, 0])] : []),
      ball([0.11, 0.09, 0.11], c.fur, [0.05, 0.13, 0.14]),
      ball([0.06, 0.045, 0.06], c.belly, [0.06, 0.1, 0.24]),
      ball([0.02, 0.015, 0.015], INK, [0.06, 0.12, 0.3]),
      ball([0.03, 0.07, 0.05], c.mark, [-0.05, 0.13, 0.12], [0, 0, 0.4]),
      ...eyes(0.16, 0.22, 0.04, 0.016, true).map((g) => g.translate(0.05, 0, 0)),
    ];
  }
  return [
    ball([0.15, 0.16, 0.17], c.fur, [0, 0.16, -0.03]),
    ...(spots
      ? [
          ball([0.05, 0.04, 0.04], c.mark, [-0.12, 0.2, -0.04]),
          ball([0.04, 0.035, 0.035], c.mark, [0.11, 0.14, -0.08]),
        ]
      : []),
    ball([0.09, 0.1, 0.05], c.belly, [0, 0.18, 0.11]),
    ball([0.05, 0.03, 0.065], c.fur, [-0.06, 0.03, 0.1]),
    ball([0.05, 0.03, 0.065], c.fur, [0.06, 0.03, 0.1]),
    rod(0.022, 0.03, 0.2, c.fur, [0, 0.27, -0.19], [-0.9, 0, 0]),
    ball([0.13, 0.12, 0.12], c.fur, [0, 0.38, 0.05]),
    ball([0.07, 0.055, 0.07], c.belly, [0, 0.34, 0.17]),
    ball([0.025, 0.02, 0.02], INK, [0, 0.36, 0.24]),
    ball([0.035, 0.085, 0.05], c.mark, [-0.12, 0.36, 0.03], [0, 0, 0.25]),
    ball([0.035, 0.085, 0.05], c.mark, [0.12, 0.36, 0.03], [0, 0, -0.25]),
    ...eyes(0.41, 0.15, 0.05, 0.02, false),
  ];
}

function rabbit(c: Colors, coat: string, asleep: boolean): BufferGeometry[] {
  const ears = coat === "patched" ? c.mark : c.fur;
  if (asleep) {
    return [
      ball([0.18, 0.12, 0.16], c.fur, [0, 0.11, -0.02]),
      ball([0.05, 0.05, 0.05], c.belly, [0, 0.14, -0.18]),
      ball([0.1, 0.09, 0.1], c.fur, [0, 0.14, 0.13]),
      ball([0.03, 0.022, 0.13], ears, [-0.04, 0.2, -0.02], [0.15, 0, 0]),
      ball([0.03, 0.022, 0.13], ears, [0.04, 0.2, -0.02], [0.15, 0, 0]),
      ball([0.012, 0.01, 0.01], PINK, [0, 0.14, 0.225]),
      ...eyes(0.16, 0.2, 0.045, 0.015, true),
    ];
  }
  return [
    ball([0.13, 0.14, 0.15], c.fur, [0, 0.14, -0.02]),
    ball([0.05, 0.05, 0.05], c.belly, [0, 0.12, -0.17]),
    ball([0.07, 0.08, 0.04], c.belly, [0, 0.16, 0.1]),
    ball([0.05, 0.03, 0.08], c.fur, [-0.07, 0.03, 0.06]),
    ball([0.05, 0.03, 0.08], c.fur, [0.07, 0.03, 0.06]),
    ball([0.11, 0.1, 0.1], c.fur, [0, 0.32, 0.05]),
    ball([0.032, 0.13, 0.02], ears, [-0.04, 0.5, 0.02], [0, 0, 0.12]),
    ball([0.032, 0.13, 0.02], ears, [0.04, 0.5, 0.02], [0, 0, -0.12]),
    ball([0.018, 0.09, 0.008], PINK, [-0.04, 0.5, 0.035], [0, 0, 0.12]),
    ball([0.018, 0.09, 0.008], PINK, [0.04, 0.5, 0.035], [0, 0, -0.12]),
    ball([0.012, 0.01, 0.01], PINK, [0, 0.31, 0.15]),
    ...eyes(0.34, 0.135, 0.045, 0.018, false),
  ];
}

function hedgehog(c: Colors, _coat: string, asleep: boolean): BufferGeometry[] {
  const spines: BufferGeometry[] = [];
  const rows = asleep ? 3 : 2;
  for (let row = 0; row < rows; row++) {
    const lat = 0.35 + row * 0.45;
    const n = 9 - row * 2;
    for (let i = 0; i < n; i++) {
      const lon = Math.PI * 0.15 + (i / Math.max(1, n - 1)) * Math.PI * (asleep ? 1.7 : 1.05) + row;
      const dir = new Vector3(
        Math.cos(lon) * Math.cos(lat),
        Math.sin(lat),
        Math.sin(lon) * Math.cos(lat) - 0.3,
      );
      dir.normalize();
      const at: V3 = [dir.x * 0.17, 0.13 + dir.y * 0.12, dir.z * 0.15 - 0.03];
      const q = new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), dir);
      const g = unindexed(new ConeGeometry(0.035, 0.11, 5));
      g.applyQuaternion(q);
      spines.push(part(g, c.mark, at));
    }
  }
  if (asleep) {
    return [
      ball([0.18, 0.14, 0.17], c.fur, [0, 0.13, 0]),
      ...spines,
      ball([0.06, 0.045, 0.05], c.belly, [0, 0.07, 0.17]),
      ball([0.014, 0.012, 0.012], INK, [0, 0.07, 0.22]),
    ];
  }
  return [
    ball([0.17, 0.13, 0.19], c.fur, [0, 0.13, -0.03]),
    ...spines,
    ball([0.08, 0.07, 0.09], c.belly, [0, 0.12, 0.15]),
    ball([0.035, 0.03, 0.05], c.belly, [0, 0.1, 0.24]),
    ball([0.016, 0.014, 0.014], INK, [0, 0.105, 0.29]),
    ball([0.02, 0.02, 0.012], c.belly, [-0.06, 0.18, 0.15]),
    ball([0.02, 0.02, 0.012], c.belly, [0.06, 0.18, 0.15]),
    ball([0.035, 0.02, 0.04], c.mark, [-0.07, 0.02, 0.08]),
    ball([0.035, 0.02, 0.04], c.mark, [0.07, 0.02, 0.08]),
    ...eyes(0.15, 0.21, 0.04, 0.014, false),
  ];
}

function duck(c: Colors, coat: string, asleep: boolean): BufferGeometry[] {
  const head = coat === "mallard" ? c.mark : c.fur;
  if (asleep) {
    return [
      ball([0.15, 0.12, 0.19], c.fur, [0, 0.12, 0]),
      ball([0.09, 0.06, 0.15], c.mark, [-0.1, 0.15, -0.01]),
      cone(0.05, 0.09, c.fur, [0, 0.16, -0.2], [-1.4, 0, 0]),
      ball([0.09, 0.08, 0.08], head, [0.03, 0.2, 0.06]),
      ball([0.05, 0.02, 0.04], c.bill, [0.08, 0.17, -0.01], [0, 0.8, 0]),
      ...eyes(0.22, 0.12, 0.04, 0.012, true).map((g) => g.translate(0.03, 0, 0)),
    ];
  }
  return [
    rod(0.012, 0.012, 0.06, c.bill, [-0.05, 0.03, 0.02]),
    rod(0.012, 0.012, 0.06, c.bill, [0.05, 0.03, 0.02]),
    ball([0.04, 0.008, 0.05], c.bill, [-0.05, 0.004, 0.05]),
    ball([0.04, 0.008, 0.05], c.bill, [0.05, 0.004, 0.05]),
    ball([0.14, 0.12, 0.19], c.fur, [0, 0.16, -0.02]),
    ...(coat === "mallard" ? [ball([0.08, 0.07, 0.05], c.mark2, [0, 0.16, 0.12])] : []),
    ball([0.05, 0.08, 0.15], c.mark, [-0.12, 0.18, -0.03]),
    ball([0.05, 0.08, 0.15], c.mark, [0.12, 0.18, -0.03]),
    cone(0.05, 0.1, c.fur, [0, 0.22, -0.22], [-1.1, 0, 0]),
    rod(0.05, 0.06, 0.12, head, [0, 0.3, 0.1]),
    ball([0.09, 0.085, 0.085], head, [0, 0.4, 0.11]),
    ...(coat === "mallard" ? [rod(0.054, 0.054, 0.015, 0xffffff, [0, 0.33, 0.1])] : []),
    ball([0.05, 0.018, 0.06], c.bill, [0, 0.38, 0.2]),
    ...eyes(0.42, 0.18, 0.045, 0.014, false),
  ];
}

function frog(c: Colors, coat: string, asleep: boolean): BufferGeometry[] {
  const spots = coat === "spotted" || coat === "blue";
  const body: BufferGeometry[] = [
    ball([0.19, 0.1, 0.17], c.fur, [0, 0.1, 0]),
    ball([0.14, 0.06, 0.08], c.belly, [0, 0.08, 0.1]),
    ball([0.07, 0.05, 0.1], c.fur, [-0.15, 0.05, -0.04]),
    ball([0.07, 0.05, 0.1], c.fur, [0.15, 0.05, -0.04]),
    ...(spots
      ? [
          ball([0.035, 0.02, 0.03], c.mark, [-0.07, 0.19, -0.06]),
          ball([0.03, 0.02, 0.025], c.mark, [0.08, 0.18, -0.08]),
        ]
      : []),
  ];
  const bumps = [-0.07, 0.07].map((x) => ball([0.05, 0.05, 0.05], c.fur, [x, 0.19, 0.08]));
  if (asleep) {
    return [
      ...body.map((g) => g.scale(1, 0.85, 1)),
      ...bumps,
      ...eyes(0.205, 0.125, 0.07, 0.022, true),
    ];
  }
  return [
    ...body,
    ball([0.025, 0.02, 0.05], c.fur, [-0.06, 0.02, 0.14]),
    ball([0.025, 0.02, 0.05], c.fur, [0.06, 0.02, 0.14]),
    ...bumps,
    ...[-0.07, 0.07].map((x) => ball([0.03, 0.03, 0.02], 0xffffff, [x, 0.2, 0.12])),
    ...eyes(0.2, 0.135, 0.07, 0.016, false),
  ];
}

function fox(c: Colors, _coat: string, asleep: boolean): BufferGeometry[] {
  if (asleep) {
    return [
      ball([0.2, 0.11, 0.17], c.fur, [0, 0.1, -0.02]),
      ball([0.1, 0.085, 0.1], c.fur, [0.05, 0.13, 0.12]),
      cone(0.045, 0.1, c.fur, [0.0, 0.23, 0.1], [0, 0, 0.3]),
      cone(0.045, 0.1, c.fur, [0.11, 0.23, 0.1], [0, 0, -0.3]),
      ...eyes(0.15, 0.2, 0.04, 0.015, true).map((g) => g.translate(0.05, 0, 0)),
      // The bushy tail wraps round over the nose, its tip pale.
      ball([0.21, 0.065, 0.07], c.fur, [-0.02, 0.07, 0.19], [0, 0.15, 0]),
      ball([0.06, 0.05, 0.05], c.belly, [0.17, 0.08, 0.2]),
    ];
  }
  return [
    ball([0.13, 0.16, 0.15], c.fur, [0, 0.16, -0.03]),
    ball([0.08, 0.11, 0.05], c.belly, [0, 0.18, 0.09]),
    ball([0.045, 0.03, 0.06], c.mark, [-0.06, 0.03, 0.1]),
    ball([0.045, 0.03, 0.06], c.mark, [0.06, 0.03, 0.1]),
    ball([0.08, 0.08, 0.2], c.fur, [0.05, 0.14, -0.22], [0.5, 0.4, 0]),
    ball([0.05, 0.05, 0.06], c.belly, [0.1, 0.06, -0.37]),
    ball([0.12, 0.11, 0.11], c.fur, [0, 0.38, 0.05]),
    cone(0.055, 0.14, c.fur, [-0.07, 0.52, 0.03], [0, 0, 0.2]),
    cone(0.055, 0.14, c.fur, [0.07, 0.52, 0.03], [0, 0, -0.2]),
    ball([0.055, 0.04, 0.09], c.belly, [0, 0.34, 0.16]),
    ball([0.018, 0.015, 0.015], INK, [0, 0.35, 0.25]),
    ...eyes(0.41, 0.145, 0.048, 0.018, false),
  ];
}

function tortoise(c: Colors, coat: string, asleep: boolean): BufferGeometry[] {
  const star = coat === "star";
  const skin = c.bill;
  const shell = ball([0.22, 0.16, 0.24], c.fur, [0, 0.07, 0], [0, 0, 0], 12);
  const plates = [
    [0, 0.22, 0],
    [-0.1, 0.17, -0.08],
    [0.1, 0.17, -0.08],
    [-0.1, 0.17, 0.08],
    [0.1, 0.17, 0.08],
  ].map(([x, y, z]) =>
    ball(star ? [0.03, 0.012, 0.03] : [0.07, 0.025, 0.07], c.mark, [
      x as number,
      y as number,
      z as number,
    ]),
  );
  const rim = rod(0.225, 0.235, 0.04, c.mark, [0, 0.07, 0]);
  const legs = [
    [-0.15, 0.13],
    [0.15, 0.13],
    [-0.15, -0.13],
    [0.15, -0.13],
  ].map(([x, z]) => ball([0.05, 0.04, 0.05], skin, [x as number, 0.03, z as number]));
  if (asleep)
    return [
      shell.translate(0, -0.02, 0),
      ...plates.map((g) => g.translate(0, -0.02, 0)),
      rim,
      ...legs,
      ball([0.045, 0.035, 0.03], skin, [0, 0.06, 0.24]),
    ];
  return [
    ...legs,
    shell,
    ...plates,
    rim,
    rod(0.035, 0.04, 0.1, skin, [0, 0.11, 0.24], [1.1, 0, 0]),
    ball([0.07, 0.06, 0.08], skin, [0, 0.15, 0.31]),
    ...eyes(0.17, 0.37, 0.04, 0.013, false),
    cone(0.02, 0.05, skin, [0, 0.06, -0.26], [-1.4, 0, 0]),
  ];
}

const BUILD: Record<PetKind, (c: Colors, coat: string, asleep: boolean) => BufferGeometry[]> = {
  cat,
  dog,
  rabbit,
  hedgehog,
  duck,
  frog,
  fox,
  tortoise,
};

/**
 * One pet's geometry, merged and shaded: feet on y = 0, facing +z, about half a tile tall. The
 * caller owns it; `petGeometries` keeps one per look for a scene.
 */
export function petGeometry(kind: PetKind, coat: PetCoat, posture: PetPosture): BufferGeometry {
  const parts = BUILD[kind](colorsOf(kind, coat), coat, posture === "asleep");
  const merged = mergeGeometries(parts);
  for (const p of parts) p.dispose();
  return shade(merged, 0.8);
}

/**
 * Darken the colors toward the feet, a cheap stand-in for the shadow a body casts on itself, like
 * `bakeShade` but keeping each part's color.
 */
function shade(geometry: BufferGeometry, bottom: number): BufferGeometry {
  const pos = geometry.getAttribute("position");
  const color = geometry.getAttribute("color");
  geometry.computeBoundingBox();
  const box = geometry.boundingBox;
  const y0 = box ? box.min.y : 0;
  const span = box ? Math.max(1e-6, box.max.y - box.min.y) : 1;
  for (let i = 0; i < pos.count; i++) {
    const t = Math.min(1, Math.max(0, (pos.getY(i) - y0) / span));
    const k = bottom + (1 - bottom) * Math.sqrt(t);
    color.setXYZ(i, color.getX(i) * k, color.getY(i) * k, color.getZ(i) * k);
  }
  color.needsUpdate = true;
  return geometry;
}

/** Pet geometries a scene shares, one per kind, coat, and posture, freed with the scene. */
export function petGeometries() {
  const made = new Map<string, BufferGeometry>();
  return {
    get(kind: PetKind, coat: PetCoat, posture: PetPosture): BufferGeometry {
      const key = `${kind}|${coat}|${posture}`;
      let g = made.get(key);
      if (!g) {
        g = petGeometry(kind, coat, posture);
        made.set(key, g);
      }
      return g;
    },
    dispose() {
      for (const g of made.values()) g.dispose();
      made.clear();
    },
  };
}

/** The one material every pet shares: Lambert paper, its colors in the vertices. */
export function petMaterial(): MeshLambertMaterial {
  return new MeshLambertMaterial({ vertexColors: true });
}
