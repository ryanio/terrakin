/**
 * Hair on the 3D peg figures (decision 0074), in the color the 2D figure gives it (`hairOf`).
 * Built in the head's own space, so it turns with the head: the head is a sphere of 0.17 around
 * the origin, facing +z. Shells sit just outside it and leave the face open. A hat that covers the
 * crown hides what would be above its band, so longer styles still show below it. Every piece of a
 * figure's hair is merged into one mesh, colored per vertex, so it costs one draw call.
 */
import type { WearItem } from "@terrakin/sim";
import { type FigureLook, hairOf, hairTieColor } from "@terrakin/ui/figure";
import { lookPalette } from "@terrakin/ui/looks";
import {
  BufferAttribute,
  type BufferGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  Mesh,
  MeshLambertMaterial,
  Quaternion,
  SphereGeometry,
  Vector3,
} from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { HAT_BAND } from "./layout";

/** The shell the hair makes around the head (0.17). */
const SHELL = 0.182;

/** The polar angle (0 straight up) where a shell of radius `r` crosses height `y`. */
const angleAt = (r: number, y: number) => Math.acos(Math.max(-1, Math.min(1, y / r)));

/**
 * A piece of shell between polar angles `from` and `to`, all the way round, or with `open` set,
 * leaving that many radians clear each side of the face.
 */
function shell(r: number, from: number, to: number, open = 0): BufferGeometry | undefined {
  if (to <= from) return undefined;
  // three.js measures phi from -x, so +z (the face) is at pi / 2.
  const start = open ? Math.PI / 2 + open : 0;
  const length = open ? Math.PI * 2 - 2 * open : Math.PI * 2;
  const rows = Math.max(1, Math.round((to - from) / 0.2));
  return new SphereGeometry(r, 18, rows, start, length, from, to - from);
}

/** A tapered tube from `a` to `b`, `r0` thick at `a` and `r1` at `b`, open at both ends. */
function rod(a: Vector3, b: Vector3, r0: number, r1: number): BufferGeometry {
  const dir = b.clone().sub(a);
  const length = dir.length();
  const geo = new CylinderGeometry(r1, r0, length, 10, 1, true);
  geo.translate(0, length / 2, 0);
  geo.applyQuaternion(new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), dir.normalize()));
  return geo.translate(a.x, a.y, a.z);
}

/** A small round ball at (x, y, z). */
const ball = (x: number, y: number, z: number, r: number, detail = 1) =>
  new SphereGeometry(r, 6 + 2 * detail, 4 + 2 * detail).translate(x, y, z);

const v = (x: number, y: number, z: number) => new Vector3(x, y, z);

/** A point on a sphere of radius `r`, `polar` down from the top and `phi` round from -x. */
const onSphere = (r: number, polar: number, phi: number) =>
  v(-Math.cos(phi) * Math.sin(polar) * r, Math.cos(polar) * r, Math.sin(phi) * Math.sin(polar) * r);

/**
 * Curls of radius `size` in rings round a sphere of radius `r`, each ring [polar angle as a share
 * of pi, how many, radians to leave open each side of the face]. `keep` gets each curl's top.
 */
function curlRings(
  r: number,
  rings: readonly (readonly [number, number, number])[],
  size: number,
  keep: (top: number) => boolean,
): BufferGeometry[] {
  const out: BufferGeometry[] = [];
  for (const [polar, count, open] of rings) {
    const span = Math.PI * 2 - 2 * open;
    for (let i = 0; i < count; i++) {
      const at = onSphere(r, polar * Math.PI, Math.PI / 2 + open + (span * (i + 0.5)) / count);
      if (keep(at.y + size)) out.push(ball(at.x, at.y, at.z, size, 0));
    }
  }
  return out;
}

/** A braid hanging down beside the head on side `s`: plaits, and the tuft under its tie. */
function braid(s: number): BufferGeometry[] {
  const at = (i: number) => [s * (0.155 + 0.027 * i), -0.06 - 0.075 * i, 0.03] as const;
  const plaits = [0, 1, 2, 3].map((i) => ball(...at(i), 0.042, 0));
  return [...plaits, ball(...at(4.4), 0.026, 0)];
}

/** One piece of a style: its geometry, and whether it's a tie in the outfit's accent. */
export interface HairPiece {
  geo: BufferGeometry;
  tie?: boolean;
}

/**
 * The pieces of a style, all below `band` (the head's own y) when a hat covers the crown. Pure apart
 * from making geometry, so tests can measure it.
 */
export function hairPieces(style: NonNullable<FigureLook["hair"]>, band?: number): HairPiece[] {
  const out: HairPiece[] = [];
  const add = (geo: BufferGeometry | undefined, tie = false) => {
    if (geo) out.push(tie ? { geo, tie } : { geo });
  };
  const below = (top: number) => band === undefined || top <= band;
  const cutAt = (r: number) => (band === undefined ? 0 : angleAt(r, band));
  // Where a tail or tie hangs from: its usual height, or under the hat's band.
  const root = (y: number) => (band === undefined ? y : Math.min(y, band - 0.06));
  // The crown down to the fringe at `fringe`, then the sides and back down to `low`, tucked a
  // little under the crown so no crack shows between them.
  const crown = (fringe: number, low: number, open: number, r = SHELL) => {
    add(shell(r, cutAt(r), fringe * Math.PI));
    const side = r * 0.996;
    add(shell(side, Math.max(cutAt(side), fringe * Math.PI - 0.04), low * Math.PI, open));
  };
  switch (style) {
    case "short":
      crown(0.36, 0.6, 0.75);
      break;
    case "bob":
      crown(0.4, 0.74, 0.62, 0.188);
      break;
    case "long": {
      crown(0.38, 0.8, 0.62, 0.186);
      // The fall down the back, to the shoulder blades.
      const fall = new CylinderGeometry(0.168, 0.192, 0.27, 16, 1, true, Math.PI / 2, Math.PI);
      add(fall.translate(0, -0.12, -0.012));
      break;
    }
    case "curly": {
      crown(0.34, 0.58, 0.75);
      const rings = [
        [0.06, 1, 0],
        [0.22, 6, 0],
        [0.39, 7, 0.72],
        [0.55, 5, 0.95],
      ] as const;
      for (const curl of curlRings(SHELL, rings, 0.058, below)) add(curl);
      break;
    }
    case "bun":
      crown(0.3, 0.55, 0.8);
      if (below(0.23)) add(ball(0, 0.15, -0.11, 0.078));
      break;
    case "ponytail": {
      crown(0.3, 0.55, 0.8);
      // The tail hangs from its tie down the back of the head, fullest just below the tie.
      const y = root(0.07);
      add(ball(0, y + 0.01, -0.175, 0.036), true);
      add(rod(v(0, y, -0.2), v(0, y - 0.13, -0.26), 0.05, 0.058));
      add(rod(v(0, y - 0.13, -0.26), v(0, y - 0.31, -0.25), 0.058, 0.022));
      add(ball(0, y - 0.13, -0.26, 0.058));
      add(ball(0, y - 0.31, -0.25, 0.022, 0));
      break;
    }
    case "braids":
      crown(0.36, 0.6, 0.8);
      for (const s of [-1, 1]) {
        for (const geo of braid(s)) add(geo);
        add(ball(s * 0.265, -0.345, 0.03, 0.03, 0), true);
      }
      break;
    case "spiky":
      crown(0.36, 0.58, 0.75);
      for (const [polar, count] of [
        [0, 1],
        [0.2, 6],
        [0.36, 7],
      ] as const) {
        for (let i = 0; i < count; i++) {
          const dir = onSphere(1, polar * Math.PI, (Math.PI * 2 * (i + 0.5)) / count + Math.PI / 2);
          const base = dir.clone().multiplyScalar(SHELL - 0.02);
          const tip = base.clone().addScaledVector(dir, 0.13);
          if (!below(Math.max(base.y, tip.y) + 0.03)) continue;
          const spike = new ConeGeometry(0.038, 0.13, 5);
          spike.translate(0, 0.065, 0);
          spike.applyQuaternion(new Quaternion().setFromUnitVectors(v(0, 1, 0), dir));
          add(spike.translate(base.x, base.y, base.z));
        }
      }
      break;
    case "afro": {
      // A round puff a little above and behind the head, open at the face, with curls all over.
      const r = 0.2;
      const lift = (g: BufferGeometry | undefined) => g?.translate(0, 0.02, -0.04);
      const cut = band === undefined ? 0 : angleAt(r, band - 0.02);
      add(lift(shell(r, cut, 0.3 * Math.PI)));
      add(lift(shell(r * 0.996, Math.max(cut, 0.3 * Math.PI - 0.04), 0.74 * Math.PI, 0.85)));
      const rings = [
        [0, 1, 0],
        [0.2, 5, 0],
        [0.38, 7, 0.75],
        [0.56, 6, 0.95],
        [0.7, 4, 1.2],
      ] as const;
      for (const curl of curlRings(r, rings, 0.07, (top) => below(top + 0.02))) add(lift(curl));
      break;
    }
    case "pigtails":
      crown(0.36, 0.58, 0.8);
      for (const s of [-1, 1]) {
        // Each tail stands out from its tie and falls, round at the end.
        const y = root(0.05);
        add(rod(v(0.17 * s, y, -0.04), v(0.25 * s, y - 0.07, -0.05), 0.045, 0.055));
        add(rod(v(0.25 * s, y - 0.07, -0.05), v(0.27 * s, y - 0.24, -0.04), 0.055, 0.03));
        add(ball(0.25 * s, y - 0.07, -0.05, 0.055));
        add(ball(0.27 * s, y - 0.24, -0.04, 0.03, 0));
        add(ball(0.165 * s, y + 0.015, -0.035, 0.034), true);
      }
      break;
  }
  return out;
}

/** Paint every vertex of `geo` one color, in the renderer's linear space. */
function painted(geo: BufferGeometry, color: Color): BufferGeometry {
  const count = geo.getAttribute("position").count;
  const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) colors.set([color.r, color.g, color.b], i * 3);
  geo.setAttribute("color", new BufferAttribute(colors, 3));
  return geo;
}

/** The figure's hair as one mesh, ready to add to its head, or undefined when it has none. */
export function hairMesh(look: FigureLook, wear: readonly WearItem[] = []): Mesh | undefined {
  const hair = hairOf(look);
  if (!hair) return undefined;
  const hat = wear.find((w) => Object.hasOwn(HAT_BAND, w));
  const pieces = hairPieces(hair.style, hat ? HAT_BAND[hat] : undefined);
  const strands = new Color(hair.hex);
  const tie = new Color(hairTieColor(lookPalette(look.theme, look.color)));
  const merged = mergeGeometries(pieces.map((p) => painted(p.geo, p.tie ? tie : strands)));
  for (const p of pieces) p.geo.dispose();
  if (!merged) return undefined;
  const mesh = new Mesh(merged, new MeshLambertMaterial({ vertexColors: true, side: DoubleSide }));
  mesh.name = "hair";
  mesh.castShadow = true;
  return mesh;
}
