/**
 * The Commons buildings in 3D for the world view: the Town Hall and the town shop, drawn after the
 * 2D map's (`drawTownHall` and `drawShop` in render.ts) in the same colors. Each is a handful of
 * merged, shade-baked parts, one draw per material. Residents can walk across both (old worlds
 * must replay), so a building turns see-through while you stand in it.
 */
import {
  type BufferGeometry,
  CylinderGeometry,
  DoubleSide,
  ExtrudeGeometry,
  Group,
  type Material,
  Mesh,
  MeshLambertMaterial,
  PlaneGeometry,
  Shape,
  Sprite,
  SpriteMaterial,
  type Texture,
} from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { bakeShade, nameTag, noShade, paper, unindexed } from "./art";
import { BRAND, hex } from "./palette";

/** A building's tiles as a box in tile units: its middle, and how wide and deep it is. */
export interface Footprint {
  x: number;
  y: number;
  width: number;
  depth: number;
}

/** The box around a set of tiles, or undefined for none. */
export function footprintOf(tiles: readonly { x: number; y: number }[]): Footprint | undefined {
  if (tiles.length === 0) return undefined;
  const xs = tiles.map((t) => t.x);
  const ys = tiles.map((t) => t.y);
  const x0 = Math.min(...xs);
  const x1 = Math.max(...xs);
  const y0 = Math.min(...ys);
  const y1 = Math.max(...ys);
  return { x: (x0 + x1) / 2, y: (y0 + y1) / 2, width: x1 - x0 + 1, depth: y1 - y0 + 1 };
}

const STONE = hex("#c9c2b5");
const COLUMN = hex("#e8dfcc");
const GLASS = hex("#cfe6ee");
const WOOD_DARK = hex("#6e4a2c");

function box(w: number, h: number, d: number, x: number, y: number, z: number, r = 0.04) {
  const g = new RoundedBoxGeometry(w, h, d, 1, Math.min(r, w / 2, h / 2, d / 2));
  g.translate(x, y, z);
  return unindexed(g);
}

/** A roof ridge: a triangle `w` wide and `h` tall, `d` deep, its base at `y`. */
function gable(w: number, h: number, d: number, y: number, z = 0): BufferGeometry {
  const s = new Shape();
  s.moveTo(-w / 2, 0);
  s.lineTo(0, h);
  s.lineTo(w / 2, 0);
  s.lineTo(-w / 2, 0);
  const g = new ExtrudeGeometry(s, { depth: d, bevelEnabled: false });
  g.translate(0, y, z - d / 2);
  return g;
}

function part(pieces: BufferGeometry[], material: Material, bottom = 0.72): Mesh {
  const g = bakeShade(mergeGeometries(pieces), bottom, 1);
  for (const p of pieces) p.dispose();
  const mesh = new Mesh(g, material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

/** A paper label floating over the building, the way the 2D map names it. */
function label(text: string, height: number): Sprite {
  const tag = nameTag(text, false);
  const sprite = new Sprite(
    new SpriteMaterial({ map: tag.texture, depthWrite: false, transparent: true }),
  );
  const h = 0.42;
  sprite.scale.set(h * tag.aspect, h, 1);
  sprite.position.y = height;
  sprite.renderOrder = 5;
  return sprite;
}

/**
 * The Town Hall: columns under a clay pediment on stone steps, a gold door, a round window, and a
 * moss flag. Its door faces south, onto the square.
 */
export function townHall(f: Footprint, grain: Texture): Group {
  const group = new Group();
  group.name = "town-hall";
  const w = f.width * 0.86;
  const d = f.depth * 0.7;
  const steps = part(
    [box(w, 0.12, d + 0.3, 0, 0.06, 0.1), box(w * 0.86, 0.12, d + 0.1, 0, 0.18, 0.02)],
    paper(STONE, grain),
  );
  const bodyH = 1.3;
  const body = part(
    [box(w * 0.82, bodyH, d * 0.8, 0, 0.24 + bodyH / 2, -0.08)],
    paper(BRAND.paper, grain),
  );
  const cols: BufferGeometry[] = [];
  for (const k of [-0.42, -0.15, 0.15, 0.42]) {
    const c = new CylinderGeometry(0.07, 0.08, bodyH, 10);
    c.translate(k * w * 0.9, 0.24 + bodyH / 2, d * 0.38);
    cols.push(c);
  }
  const columns = part(cols, paper(COLUMN, grain), 0.8);
  const roofY = 0.24 + bodyH;
  const cornice = part(
    [box(w * 1.04, 0.12, d + 0.1, 0, roofY + 0.06, 0)],
    paper(BRAND.clayDeep, grain),
  );
  const roof = part([gable(w * 1.04, 0.62, d + 0.1, roofY + 0.12)], paper(BRAND.clay, grain), 0.85);
  const door = new Mesh(
    noShade(box(0.36, 0.72, 0.04, 0, 0.24 + 0.36, d * 0.32 - 0.06)),
    new MeshLambertMaterial({ color: BRAND.sun, vertexColors: true }),
  );
  const windowGeo = new CylinderGeometry(0.13, 0.13, 0.04, 16);
  windowGeo.rotateX(Math.PI / 2);
  windowGeo.translate(0, roofY + 0.36, (d + 0.1) / 2 + 0.01);
  const roundWindow = new Mesh(noShade(windowGeo), paper(BRAND.paper, null));
  const pole = new CylinderGeometry(0.025, 0.025, 1.0, 6);
  pole.translate(0, roofY + 0.62 + 0.5, 0);
  const flagpole = part([pole], new MeshLambertMaterial({ color: BRAND.ink, vertexColors: true }));
  const flagGeo = new PlaneGeometry(0.42, 0.24);
  flagGeo.translate(0.21, roofY + 0.62 + 0.86, 0);
  const flag = new Mesh(
    noShade(flagGeo),
    new MeshLambertMaterial({ color: BRAND.moss, vertexColors: true, side: DoubleSide }),
  );
  flag.castShadow = true;
  group.add(steps, body, columns, cornice, roof, door, roundWindow, flagpole, flag);
  group.add(label("Town Hall", roofY + 1.95));
  return group;
}

/**
 * The town shop: cream walls on a stone footing under a moss roof, a striped clay awning over two
 * windows, a door, and a clay chimney. Its door faces north, across the square to the Town Hall.
 */
export function shop(f: Footprint, grain: Texture): Group {
  const group = new Group();
  group.name = "shop";
  const w = f.width * 0.86;
  const d = f.depth * 0.72;
  const wallH = 1.15;
  const footing = part([box(w, 0.14, d, 0, 0.07, 0)], paper(STONE, grain));
  const walls = part(
    [box(w * 0.96, wallH, d * 0.94, 0, 0.14 + wallH / 2, 0)],
    paper(BRAND.paper, grain),
  );
  const roofY = 0.14 + wallH;
  // The ridge runs east to west, so the gable ends face the sides.
  const roof = part(
    [gable(d * 1.04, 0.85, w * 1.04, roofY - 0.02).rotateY(Math.PI / 2)],
    paper(BRAND.moss, grain),
    0.85,
  );
  const chimney = part(
    [
      box(0.18, 0.5, 0.18, w * 0.3, roofY + 0.45, 0.1),
      box(0.24, 0.06, 0.24, w * 0.3, roofY + 0.72, 0.1),
    ],
    paper(BRAND.clay, grain),
  );
  // The awning over the front (north, -z): stripes in clay and paper.
  const front = -d * 0.47 - 0.02;
  const stripes = 7;
  const sw = (w * 0.98) / stripes;
  const clayStripes: BufferGeometry[] = [];
  const paleStripes: BufferGeometry[] = [];
  for (let i = 0; i < stripes; i++) {
    const g = box(sw, 0.04, 0.42, -w * 0.49 + sw * (i + 0.5), 0, 0, 0.01);
    g.rotateX(-0.45);
    g.translate(0, roofY - 0.28, front - 0.16);
    (i % 2 === 0 ? clayStripes : paleStripes).push(g);
  }
  const awningClay = part(clayStripes, paper(BRAND.clay, grain), 0.9);
  const awningPale = part(paleStripes, paper(BRAND.paper2, grain), 0.9);
  const panes: BufferGeometry[] = [];
  for (const k of [-0.3, 0.3]) panes.push(box(w * 0.22, 0.42, 0.04, k * w, 0.62, front));
  const windows = new Mesh(noShade(mergeGeometries(panes)), paper(GLASS, null));
  for (const p of panes) p.dispose();
  const door = part([box(0.3, 0.66, 0.05, 0, 0.14 + 0.33, front)], paper(WOOD_DARK, grain));
  group.add(footing, walls, roof, chimney, awningClay, awningPale, windows, door);
  group.add(label("Shop", roofY + 1.15));
  return group;
}

/** Make a building see-through while you stand in it, and solid again after. */
export function seeThrough(group: Group, on: boolean) {
  group.traverse((o) => {
    if (!(o instanceof Mesh)) return;
    const list: Material[] = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of list) {
      if (m.userData.seeThrough === on) continue;
      m.userData.seeThrough = on;
      m.transparent = on;
      m.opacity = on ? 0.32 : 1;
      m.depthWrite = !on;
      m.needsUpdate = true;
    }
    o.castShadow = !on;
  });
}
