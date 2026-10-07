import { LEAF_TONES, type ResourceKind, type Season } from "@terrakin/sim";
import {
  CircleGeometry,
  CylinderGeometry,
  DodecahedronGeometry,
  Group,
  IcosahedronGeometry,
  InstancedMesh,
  Matrix4,
  MeshLambertMaterial,
  Quaternion,
  Vector3,
} from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { addWind, bakeShade, lin, noShade, type Stage, unindexed } from "./art";
import type { GroundLeaf } from "./layout";
import { BRAND, blockLook, hex, mix } from "./palette";

// ---------- tufts and flowers ----------

/**
 * Grass tufts, flowers, and autumn's fallen leaves at tile positions, each kind one instanced draw;
 * tufts and flowers sway. Tufts go olive in autumn and pale in winter, as on the map.
 */
export function scenery(
  stage: Stage,
  origin: { x: number; y: number },
  tufts: readonly { x: number; y: number; turn: number }[],
  flowers: readonly { x: number; y: number; warm: boolean }[],
  leaves: readonly GroundLeaf[] = [],
  season?: Season,
): Group {
  const group = new Group();
  const m = new Matrix4();
  const q = new Quaternion();
  const up = new Vector3(0, 1, 0);
  const toX = (x: number) => x - origin.x;
  const toZ = (y: number) => y - origin.y;

  if (tufts.length) {
    const blades = [-0.06, 0, 0.06].map((x, i) => {
      const g = new CylinderGeometry(0, 0.025, 0.2 + i * 0.03 - (i === 2 ? 0.06 : 0), 3);
      g.rotateZ(-x * 3);
      g.translate(x, 0.1, (i - 1) * 0.02);
      return g.toNonIndexed();
    });
    const geo = bakeShade(mergeGeometries(blades), 0.6, 1.1);
    for (const g of blades) g.dispose();
    const color =
      season === "autumn"
        ? mix(BRAND.moss, 0xb08a3e, 0.55)
        : season === "winter"
          ? mix(BRAND.moss, 0xf4f1ea, 0.45)
          : BRAND.moss;
    const mat = new MeshLambertMaterial({ color, vertexColors: true });
    const wind = addWind(mat, 0.9);
    stage.animate(({ time }) => wind.tick(time));
    const mesh = new InstancedMesh(geo, mat, tufts.length);
    tufts.forEach((t, i) => {
      q.setFromAxisAngle(up, t.turn);
      m.compose(new Vector3(toX(t.x), 0, toZ(t.y)), q, new Vector3(1, 1, 1));
      mesh.setMatrixAt(i, m);
    });
    group.add(mesh);
  }
  if (flowers.length) {
    const head = new IcosahedronGeometry(0.05, 0);
    head.translate(0, 0.14, 0);
    const stem = new CylinderGeometry(0.008, 0.008, 0.14, 3);
    stem.translate(0, 0.07, 0);
    const geo = noShade(mergeGeometries([unindexed(head), unindexed(stem)]));
    head.dispose();
    stem.dispose();
    const mat = new MeshLambertMaterial({ color: 0xffffff, vertexColors: true });
    const wind = addWind(mat, 0.8);
    stage.animate(({ time }) => wind.tick(time));
    const mesh = new InstancedMesh(geo, mat, flowers.length);
    flowers.forEach((f, i) => {
      m.compose(new Vector3(toX(f.x), 0, toZ(f.y)), q.identity(), new Vector3(1, 1, 1));
      mesh.setMatrixAt(i, m);
      mesh.setColorAt(i, lin(f.warm ? BRAND.sun : 0xfff4d6));
    });
    group.add(mesh);
  }
  if (leaves.length) {
    // A leaf: a flat diamond lying just over the ground, turned and colored by tile.
    const geo = new CircleGeometry(0.075, 4);
    geo.scale(1.6, 0.85, 1);
    geo.rotateX(-Math.PI / 2);
    geo.translate(0, 0.02, 0);
    const mesh = new InstancedMesh(
      geo,
      new MeshLambertMaterial({ color: 0xffffff }),
      leaves.length,
    );
    leaves.forEach((l, i) => {
      q.setFromAxisAngle(up, l.turn);
      m.compose(new Vector3(toX(l.x), 0, toZ(l.y)), q, new Vector3(1, 1, 1));
      mesh.setMatrixAt(i, m);
      mesh.setColorAt(i, lin(hex(LEAF_TONES[l.tone])));
    });
    mesh.receiveShadow = true;
    group.add(mesh);
  }
  return group;
}

// ---------- fallen branches and loose stones ----------

/**
 * Today's pickups lying on the ground (phase 1 gathering): a fallen branch as two crossed sticks,
 * a loose stone as a low pebble, in the wood and stone block colors. Each kind is one instanced
 * draw, turned by tile so neighbors don't look stamped.
 */
export function pickups(
  origin: { x: number; y: number },
  items: readonly { x: number; y: number; kind: ResourceKind }[],
): Group {
  const group = new Group();
  const m = new Matrix4();
  const q = new Quaternion();
  const up = new Vector3(0, 1, 0);
  const one = new Vector3(1, 1, 1);
  const place = (mesh: InstancedMesh, list: typeof items) => {
    list.forEach((p, i) => {
      q.setFromAxisAngle(up, ((p.x * 7 + p.y * 13) % 63) / 10);
      m.compose(new Vector3(p.x - origin.x, 0, p.y - origin.y + 0.05), q, one);
      mesh.setMatrixAt(i, m);
    });
    group.add(mesh);
  };
  const wood = items.filter((p) => p.kind === "wood");
  if (wood.length) {
    const sticks = [0.5, -0.6].map((turn, i) => {
      const g = new CylinderGeometry(0.025, 0.03, 0.42 - i * 0.08, 5);
      g.rotateZ(Math.PI / 2);
      g.rotateY(turn);
      g.translate(0, 0.03 + i * 0.03, 0);
      return g.toNonIndexed();
    });
    const geo = bakeShade(mergeGeometries(sticks), 0.7, 1);
    for (const g of sticks) g.dispose();
    const mat = new MeshLambertMaterial({ color: blockLook("wood").color, vertexColors: true });
    place(new InstancedMesh(geo, mat, wood.length), wood);
  }
  const stone = items.filter((p) => p.kind === "stone");
  if (stone.length) {
    const geo = new DodecahedronGeometry(0.14, 0);
    geo.scale(1.1, 0.6, 0.9);
    geo.translate(0, 0.07, 0);
    const mat = new MeshLambertMaterial({ color: blockLook("stone").color, flatShading: true });
    place(new InstancedMesh(geo, mat, stone.length), stone);
  }
  return group;
}
