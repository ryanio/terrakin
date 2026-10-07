import { CROP_HEX, onVine } from "@terrakin/ui/item-art";
import {
  BufferAttribute,
  type BufferGeometry,
  CylinderGeometry,
  DodecahedronGeometry,
  IcosahedronGeometry,
  InstancedMesh,
  Matrix4,
  MeshLambertMaterial,
  type Object3D,
  OctahedronGeometry,
  Quaternion,
  Vector3,
} from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { addWind, lin, noShade, type Stage, unindexed } from "./art";
import { type LayoutCrop, tileHash } from "./layout";
import { blockLook, hex, mix } from "./palette";

// ---------- crops in planters ----------

/** A part of a plant in one flat color, for merging. */
function tinted(geometry: BufferGeometry, color: number): BufferGeometry {
  const g = unindexed(geometry);
  const c = lin(color);
  const n = g.getAttribute("position").count;
  const colors = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) colors.set([c.r, c.g, c.b], i * 3);
  g.setAttribute("color", new BufferAttribute(colors, 3));
  return g;
}

/**
 * Crops growing in planters, the way the map draws them: a sprout that grows with the days, then
 * the crop's color in three small fruit once it's ready. One draw for every plant and one for
 * every ripe crop, about 100 triangles a planter, swaying in the breeze. A crop whose look has a
 * vine on top, like a pumpkin, grows along the soil instead (`vinePatch`). Each ripe crop takes its
 * color from its entry in the catalog. Shared by the plot and the world.
 */
export function cropPlants(
  stage: Stage,
  origin: { x: number; y: number },
  all: readonly LayoutCrop[],
): Object3D[] {
  if (all.length === 0) return [];
  const out: Object3D[] = [];
  const top = blockLook("planter").height;
  const m = new Matrix4();
  const q = new Quaternion();
  const up = new Vector3(0, 1, 0);
  const place = (c: LayoutCrop, scale: number) => {
    q.setFromAxisAngle(up, (tileHash(c.x, c.y) % 628) / 100);
    m.compose(
      new Vector3(c.x - origin.x, top, c.y - origin.y),
      q,
      new Vector3(scale, scale, scale),
    );
    return m;
  };
  const vines = all.filter((c) => onVine(c.crop));
  if (vines.length > 0) out.push(...vinePatch(stage, place, vines));
  const crops = all.filter((c) => !onVine(c.crop));
  if (crops.length === 0) return out;

  const stem = new CylinderGeometry(0.02, 0.03, 0.5, 5);
  stem.translate(0, 0.25, 0);
  const leaves = [
    [-0.1, 0.26, 0.5],
    [0.1, 0.3, -0.5],
    [0, 0.5, 0],
  ].map(([x, y, tilt]) => {
    const g = new OctahedronGeometry(0.1, 0);
    g.scale(1, 0.35, 0.6);
    g.rotateZ(tilt as number);
    g.translate(x as number, y as number, 0);
    return g;
  });
  const plantGeo = mergeGeometries([
    tinted(stem, 0x5f9a43),
    ...leaves.map((g) => tinted(g, 0x6fae4c)),
  ]);
  stem.dispose();
  for (const g of leaves) g.dispose();
  const plantMat = new MeshLambertMaterial({ vertexColors: true, flatShading: true });
  const plantWind = addWind(plantMat, 0.5);
  stage.animate(({ time }) => plantWind.tick(time));
  const plants = new InstancedMesh(plantGeo, plantMat, crops.length);
  crops.forEach((c, i) => {
    plants.setMatrixAt(i, place(c, 0.45 + 0.55 * c.done));
  });
  plants.castShadow = true;
  out.push(plants);

  const ripe = crops.filter((c) => c.done >= 1);
  if (ripe.length > 0) {
    const fruit = [
      [-0.11, 0.4, 0.04],
      [0.11, 0.36, -0.03],
      [0, 0.52, 0.05],
    ].map(([x, y, z]) => {
      const g = new IcosahedronGeometry(0.065, 0);
      g.translate(x as number, y as number, z as number);
      return unindexed(g);
    });
    const fruitGeo = noShade(mergeGeometries(fruit));
    for (const g of fruit) g.dispose();
    const fruitMat = new MeshLambertMaterial({ vertexColors: true, flatShading: true });
    const fruitWind = addWind(fruitMat, 0.5);
    stage.animate(({ time }) => fruitWind.tick(time));
    const mesh = new InstancedMesh(fruitGeo, fruitMat, ripe.length);
    ripe.forEach((c, i) => {
      mesh.setMatrixAt(i, place(c, 1));
      mesh.setColorAt(i, lin(hex(CROP_HEX[c.crop])));
    });
    mesh.castShadow = true;
    out.push(mesh);
  }
  return out;
}

/**
 * Crops on a vine in planters, like pumpkins (RFC 0017): a low vine of leaves on the soil, and a
 * ribbed fruit that swells from a green bud and turns the crop's color, stem up, once it's ready.
 * One draw for every vine and one for every fruit, about 160 triangles a planter. The leaves sway;
 * the fruit sits still.
 */
function vinePatch(
  stage: Stage,
  place: (c: LayoutCrop, scale: number) => Matrix4,
  crops: readonly LayoutCrop[],
): Object3D[] {
  const leaves = [
    [-0.2, 0.04, 0.1, 0.6],
    [0.21, 0.04, -0.08, -0.5],
    [0.03, 0.05, -0.23, 2.2],
    [-0.06, 0.04, 0.25, -2.4],
  ].map(([x, y, z, turn]) => {
    const g = new OctahedronGeometry(0.13, 0);
    g.scale(1, 0.26, 0.7);
    g.rotateY(turn as number);
    g.translate(x as number, y as number, z as number);
    return g;
  });
  const vineGeo = mergeGeometries(leaves.map((g) => tinted(g, 0x6fae4c)));
  for (const g of leaves) g.dispose();
  const vineMat = new MeshLambertMaterial({ vertexColors: true, flatShading: true });
  const vineWind = addWind(vineMat, 0.25);
  stage.animate(({ time }) => vineWind.tick(time));
  const vines = new InstancedMesh(vineGeo, vineMat, crops.length);
  crops.forEach((c, i) => {
    vines.setMatrixAt(i, place(c, 0.6 + 0.4 * c.done));
  });
  vines.castShadow = true;

  // Once it's past a fifth of the way, as on the map.
  const growing = crops.filter((c) => c.done > 0.2);
  if (growing.length === 0) return [vines];
  const lobes = [-0.11, 0.11, 0].map((x, i) => {
    const g = new DodecahedronGeometry(0.16, 0);
    g.scale(0.8, 0.72, i === 2 ? 1.05 : 0.95);
    g.translate(x, 0.115, 0);
    return g;
  });
  const stalk = new CylinderGeometry(0.02, 0.032, 0.11, 5);
  stalk.rotateZ(0.25);
  stalk.translate(0.015, 0.26, 0);
  const fruitGeo = mergeGeometries([
    ...lobes.map((g) => tinted(g, 0xffffff)),
    tinted(stalk, 0x6a6136),
  ]);
  for (const g of [...lobes, stalk]) g.dispose();
  const fruitMat = new MeshLambertMaterial({ vertexColors: true, flatShading: true });
  const body = new InstancedMesh(fruitGeo, fruitMat, growing.length);
  growing.forEach((c, i) => {
    const ripe = hex(CROP_HEX[c.crop]);
    const swell = (c.done - 0.2) / 0.8;
    body.setMatrixAt(i, place(c, 0.3 + 0.7 * swell));
    body.setColorAt(i, lin(c.done >= 1 ? ripe : mix(0x8cbf5a, ripe, swell * 0.5)));
  });
  body.castShadow = true;
  return [vines, body];
}
