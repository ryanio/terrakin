import { CLAY_HEX, LEAF_TONES, type ResourceKind, type Season } from "@terrakin/sim";
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
import { canopyTone, YARD_LOOK, yardTone } from "../wild-yard";
import { addWind, bakeShade, lin, noShade, type Stage, unindexed } from "./art";
import type { GroundLeaf } from "./layout";
import { BRAND, blockLook, hex, mix } from "./palette";
import type { YardThings } from "./world-layout";

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

// ---------- the wild yard (RFC 0052) ----------

/**
 * The wild yard's bushes, trees, and stones (`YardThings`, from `wild-yard.ts`): each kind one
 * instanced draw, sized and colored per instance, a tree a trunk and a canopy. Trees and stones
 * cast the sun's shadow; bushes sit low enough not to. Canopies sway a little in the breeze.
 */
export function yardScenery(
  stage: Stage,
  origin: { x: number; y: number },
  yard: YardThings,
  season?: Season,
): Group {
  const group = new Group();
  const m = new Matrix4();
  const q = new Quaternion();
  const up = new Vector3(0, 1, 0);
  const at = (x: number, y: number) => new Vector3(x - origin.x, 0, y - origin.y);
  const turn = (x: number, y: number) => q.setFromAxisAngle(up, ((x * 7 + y * 13) % 63) / 10);
  if (yard.bushes.length) {
    const geo = bakeShade(new IcosahedronGeometry(1, 1).translate(0, 0.55, 0), 0.62, 1.05);
    const mat = new MeshLambertMaterial({ color: 0xffffff, vertexColors: true, flatShading: true });
    const mesh = new InstancedMesh(geo, mat, yard.bushes.length);
    const color = lin(hex(yardTone(YARD_LOOK.bush, season)));
    yard.bushes.forEach((b, i) => {
      const s = b.size;
      m.compose(at(b.x, b.y), turn(b.x, b.y), new Vector3(s, s * 0.8, s));
      mesh.setMatrixAt(i, m);
      mesh.setColorAt(i, color);
    });
    mesh.receiveShadow = true;
    group.add(mesh);
  }
  if (yard.trees.length) {
    // A trunk a tile's height for every size, and a canopy over it scaled by its size.
    const trunkGeo = bakeShade(new CylinderGeometry(0.05, 0.08, 1, 6).translate(0, 0.5, 0));
    const trunk = new InstancedMesh(
      trunkGeo,
      new MeshLambertMaterial({ color: hex(YARD_LOOK.bark), vertexColors: true }),
      yard.trees.length,
    );
    const crownGeo = bakeShade(new IcosahedronGeometry(1, 1), 0.7, 1.1);
    const crownMat = new MeshLambertMaterial({
      color: 0xffffff,
      vertexColors: true,
      flatShading: true,
    });
    const wind = addWind(crownMat, 0.025);
    stage.animate(({ time }) => wind.tick(time));
    const crown = new InstancedMesh(crownGeo, crownMat, yard.trees.length);
    yard.trees.forEach((t, i) => {
      const s = t.size;
      const height = 0.5 + s * 1.6;
      m.compose(at(t.x, t.y), turn(t.x, t.y), new Vector3(s * 1.4, height, s * 1.4));
      trunk.setMatrixAt(i, m);
      const top = at(t.x, t.y);
      top.y = height + s * 0.5;
      m.compose(top, turn(t.x, t.y), new Vector3(s * 1.15, s * 1.05, s * 1.15));
      crown.setMatrixAt(i, m);
      crown.setColorAt(i, lin(hex(canopyTone(t.tone, season))));
    });
    trunk.castShadow = true;
    crown.castShadow = true;
    crown.receiveShadow = true;
    group.add(trunk, crown);
  }
  if (yard.stones.length) {
    const geo = new DodecahedronGeometry(1, 0);
    geo.translate(0, 0.35, 0);
    const mesh = new InstancedMesh(
      geo,
      new MeshLambertMaterial({ color: hex(yardTone(YARD_LOOK.stone, season)), flatShading: true }),
      yard.stones.length,
    );
    yard.stones.forEach((s, i) => {
      m.compose(at(s.x, s.y), turn(s.x, s.y), new Vector3(s.sx, s.high, s.sz));
      mesh.setMatrixAt(i, m);
    });
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  }
  // A photo's tags look past the yard (`heads` in `world.ts`): someone among the trees is still
  // the one a tag would point at.
  for (const part of group.children) part.userData.seeThrough = true;
  return group;
}

// ---------- fallen branches and loose stones ----------

/**
 * Today's pickups lying on the ground (phase 1 gathering): a fallen branch as two crossed sticks,
 * a loose stone as a low pebble, in the wood and stone block colors, and clay (RFC 0047) as a low
 * lump. Each kind is one instanced
 * draw, turned by tile so neighbors don't look stamped.
 */
export function pickups(
  origin: { x: number; y: number },
  items: readonly { x: number; y: number; kind: ResourceKind }[],
  opacity = 1,
): Group {
  const group = new Group();
  // Faded, for what lies where you may not pick it up: every material in the group.
  const faded = opacity < 1 ? { transparent: true, opacity } : {};
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
    const mat = new MeshLambertMaterial({
      ...faded,
      color: blockLook("wood").color,
      vertexColors: true,
    });
    place(new InstancedMesh(geo, mat, wood.length), wood);
  }
  const stone = items.filter((p) => p.kind === "stone");
  if (stone.length) {
    const geo = new DodecahedronGeometry(0.14, 0);
    geo.scale(1.1, 0.6, 0.9);
    geo.translate(0, 0.07, 0);
    const mat = new MeshLambertMaterial({
      ...faded,
      color: blockLook("stone").color,
      flatShading: true,
    });
    place(new InstancedMesh(geo, mat, stone.length), stone);
  }
  // Clay (RFC 0047): two low mounds of it run together, lighter on top, in a dark patch of wet
  // ground, so nothing about it stands up like a cap on a stem or lies dry like a branch.
  const clay = items.filter((p) => p.kind === "clay");
  if (clay.length) {
    const mounds = [
      { r: 0.22, x: 0, z: 0.02 },
      { r: 0.15, x: 0.09, z: -0.07 },
    ].map(({ r, x, z }) => {
      const g = new DodecahedronGeometry(r, 1);
      g.scale(1.25, 0.26, 0.95);
      g.translate(x, 0.025, z);
      return g.toNonIndexed();
    });
    const geo = bakeShade(mergeGeometries(mounds), 0.72, 1);
    for (const g of mounds) g.dispose();
    const mat = new MeshLambertMaterial({ ...faded, color: hex(CLAY_HEX), vertexColors: true });
    place(new InstancedMesh(geo, mat, clay.length), clay);
    const patch = new CircleGeometry(0.36, 14);
    patch.rotateX(-Math.PI / 2);
    patch.scale(1, 1, 0.7);
    patch.translate(0, 0.006, 0);
    const damp = new MeshLambertMaterial({
      color: 0x40627a,
      transparent: true,
      opacity: 0.45 * opacity,
    });
    place(new InstancedMesh(patch, damp, clay.length), clay);
  }
  return group;
}
