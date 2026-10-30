/**
 * The town square's buildings in 3D for the world view: the Town Hall and the town shop, drawn
 * after the 2D map's (`drawTownHall` and `drawShop` in render/buildings.ts) in the same colors and
 * with the same pieces. Each building is one many-colored merged mesh (`colored` pieces under a
 * white paper material), plus its window glass, which lights after dark, and the hall's flag, so a
 * building is a handful of draws (decision 0030). Nobody walks onto either once buildings are
 * solid; in a world from before that, a building turns see-through while you stand in it. After
 * dark the windows light up and pool light on the square, as on the map (`buildingGlows`, decision
 * 0098).
 */
import { CROP_HEX, HEARTH_COLOR } from "@terrakin/sim";
import {
  STONE_HI as STONE_HI_BRAND,
  STONE_LO as STONE_LO_BRAND,
  STRAW as STRAW_BRAND,
  STRAW_DEEP as STRAW_DEEP_BRAND,
  WOOD as WOOD_BRAND,
  WOOD_DARK as WOOD_DARK_BRAND,
} from "@terrakin/ui/brand";
import {
  AdditiveBlending,
  type BufferGeometry,
  CylinderGeometry,
  DoubleSide,
  ExtrudeGeometry,
  Group,
  IcosahedronGeometry,
  type Material,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  PlaneGeometry,
  Shape,
  Sprite,
  SpriteMaterial,
  type Texture,
} from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { colored, type Glowing, nameTag, noShade, paper, unindexed } from "./art";
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

const STONE_HI = hex(STONE_HI_BRAND);
const STONE_LO = hex(STONE_LO_BRAND);
const COLUMN = hex("#e8dfcc");
const GLASS = hex("#cfe6ee");
const CORK = hex("#c9a06a");
const WOOD = hex(WOOD_BRAND);
const WOOD_DARK = hex(WOOD_DARK_BRAND);
const STRAW = hex(STRAW_BRAND);
const STRAW_DEEP = hex(STRAW_DEEP_BRAND);
const HEARTH = hex(HEARTH_COLOR);
const crop = (kind: keyof typeof CROP_HEX) => hex(CROP_HEX[kind]);

function box(w: number, h: number, d: number, x: number, y: number, z: number, r = 0.03) {
  const g = new RoundedBoxGeometry(w, h, d, 1, Math.min(r, w / 2, h / 2, d / 2));
  g.translate(x, y, z);
  return unindexed(g);
}

/** A roof ridge or a pediment: a triangle `w` wide and `h` tall, `d` deep, its base at `y`. */
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

/** A round thing standing up: a column, a post, a crate's fruit heap's base. */
function cylinder(r: number, h: number, x: number, y: number, z: number, sides = 10) {
  const g = new CylinderGeometry(r, r, h, sides);
  g.translate(x, y, z);
  return g;
}

/** A disc facing +z (south), for a clock's face. */
function disc(r: number, x: number, y: number, z: number, deep = 0.03) {
  const g = new CylinderGeometry(r, r, deep, 16);
  g.rotateX(Math.PI / 2);
  g.translate(x, y, z);
  return g;
}

/** A low-poly fruit, its top lit and its bottom in shade like everything else. */
function fruit(r: number, x: number, y: number, z: number) {
  const g = new IcosahedronGeometry(r, 0);
  g.translate(x, y, z);
  return g;
}

/** Pieces of many colors as one shaded mesh, in one draw. */
function painted(pieces: BufferGeometry[], grain: Texture): Mesh {
  const g = mergeGeometries(pieces);
  for (const p of pieces) p.dispose();
  const mesh = new Mesh(g, paper(0xffffff, grain));
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

/** Window glass, lit from inside after dark (`buildingGlows`). */
function glass(panes: BufferGeometry[]): Mesh {
  const g = noShade(mergeGeometries(panes));
  for (const p of panes) p.dispose();
  const mesh = new Mesh(g, paper(GLASS, null, { emissive: WINDOW_LIGHT }));
  mesh.userData.glow = "window";
  return mesh;
}

/** A pool of window light on the square, `w` by `d`, shown only after dark. */
function lightPool(pool: Texture, w: number, d: number, x: number, z: number): Mesh {
  const geo = new PlaneGeometry(w, d);
  geo.rotateX(-Math.PI / 2);
  const spot = new Mesh(
    geo,
    new MeshBasicMaterial({
      map: pool,
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
    }),
  );
  spot.position.set(x, 0.02, z);
  spot.renderOrder = 1;
  spot.userData.glow = "pool";
  // Light on the ground never takes a tap meant for the tile under it.
  spot.raycast = () => {};
  return spot;
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
 * The Town Hall, filling its footprint: a stone plinth and steps up to a portico of four columns,
 * a gold door, a clay pediment with the town clock in it and a moss flag on top, arched windows in
 * the wings, and a notice board beside the door. Its door faces south, onto the square. On a
 * land's square a signboard in front names the land (`land`). With a `pool` texture, its windows
 * pool light on the square after dark.
 */
export function townHall(f: Footprint, grain: Texture, pool?: Texture, land?: string): Group {
  const group = new Group();
  group.name = "town-hall";
  const W = f.width;
  const D = f.depth;
  // The walls stand at the back; the portico and the steps come forward to the square.
  const wallW = W * 0.94;
  const wallD = D * 0.56;
  const wallZ = -D * 0.14;
  const front = wallZ + wallD / 2;
  const floor = 0.18;
  const wallH = 1.1;
  const top = floor + wallH;
  const porticoW = W * 0.46;
  const colZ = front + 0.34;
  const boardX = -porticoW / 2 - 0.2;
  const pieces: BufferGeometry[] = [
    // Plinth, portico floor, and two steps down to the square.
    colored(box(W * 0.97, floor, wallD + 0.12, 0, floor / 2, wallZ), STONE_HI, 0.8),
    colored(box(porticoW + 0.12, 0.24, 0.5, 0, 0.12, front + 0.22), STONE_HI, 0.85),
    colored(box(porticoW + 0.28, 0.16, 0.2, 0, 0.08, front + 0.57), STONE_HI, 0.85),
    colored(box(porticoW + 0.44, 0.08, 0.16, 0, 0.04, front + 0.74), STONE_LO, 0.9),
    // Walls, and the entablature and cornice over them.
    colored(box(wallW, wallH, wallD, 0, floor + wallH / 2, wallZ), BRAND.paper),
    colored(box(W * 0.99, 0.1, wallD + 0.14, 0, top + 0.05, wallZ), BRAND.clayDeep, 0.9),
    colored(box(porticoW + 0.16, 0.14, 0.52, 0, top + 0.07, front + 0.22), BRAND.clayDeep, 0.9),
    // The low roof over the wings, its ridge east to west, and the pediment over the portico.
    colored(
      gable(wallD + 0.18, 0.46, W * 0.99, top + 0.1)
        .rotateY(Math.PI / 2)
        .translate(0, 0, wallZ),
      BRAND.clay,
      0.85,
    ),
    colored(gable(porticoW + 0.22, 0.5, 0.54, top + 0.14, front + 0.22), HEARTH, 0.85),
    colored(gable(porticoW - 0.1, 0.34, 0.02, top + 0.2, front + 0.5), BRAND.paper, 1),
    // The town clock, at ten past ten.
    colored(disc(0.13, 0, top + 0.37, front + 0.52), BRAND.sun, 1),
    colored(disc(0.1, 0, top + 0.37, front + 0.535), BRAND.paper, 1),
    // The door: gold in a dark frame, at the back of the portico.
    colored(box(0.42, 0.7, 0.04, 0, 0.24 + 0.35, front + 0.01), WOOD_DARK, 1),
    colored(box(0.34, 0.62, 0.05, 0, 0.24 + 0.31, front + 0.02), BRAND.sun, 0.9),
    // The notice board on the left wing, beside the portico: cork in a frame, notes pinned up.
    colored(box(0.32, 0.34, 0.04, boardX, 0.78, front + 0.01), WOOD_DARK, 1),
    colored(box(0.27, 0.29, 0.05, boardX, 0.78, front + 0.015), CORK, 1),
  ];
  // The clock's hands: the hour toward ten, the minute toward two.
  for (const [long, turn] of [
    [0.06, 1.05],
    [0.085, -0.95],
  ] as const) {
    const hand = new RoundedBoxGeometry(0.02, long, 0.012, 1, 0.005);
    hand.translate(0, long / 2, 0);
    hand.rotateZ(turn);
    hand.translate(0, top + 0.37, front + 0.555);
    pieces.push(colored(unindexed(hand), BRAND.ink, 1));
  }
  for (const [dx, dy, color] of [
    [-0.07, 0.07, BRAND.paper],
    [0.05, 0.08, BRAND.sun],
    [-0.06, -0.06, BRAND.mossLight],
    [0.06, -0.05, BRAND.paper],
  ] as const) {
    pieces.push(
      colored(box(0.09, 0.1, 0.01, boardX + dx, 0.78 + dy, front + 0.045, 0.004), color, 1),
    );
  }
  // Four columns with their capitals and bases.
  for (const k of [-0.42, -0.14, 0.14, 0.42]) {
    const cx = k * porticoW * 1.06;
    pieces.push(colored(cylinder(0.065, top - 0.24, cx, (top + 0.24) / 2, colZ), COLUMN, 0.8));
    pieces.push(colored(box(0.18, 0.06, 0.18, cx, top - 0.03, colZ), BRAND.paper, 1));
    pieces.push(colored(box(0.18, 0.05, 0.18, cx, 0.265, colZ), BRAND.paper, 1));
  }
  // Window surrounds and sills in the wings: one on the left, two on the right.
  const windowsAt = [-W * 0.41, porticoW / 2 + 0.22, W * 0.41];
  for (const wx of windowsAt) {
    pieces.push(colored(box(0.3, 0.54, 0.03, wx, 0.76, front + 0.005), STONE_HI, 1));
    pieces.push(colored(box(0.32, 0.04, 0.08, wx, 0.48, front + 0.03), STONE_LO, 1));
  }
  // The flagpole over the pediment, with a gold finial.
  pieces.push(colored(cylinder(0.022, 0.86, 0, top + 0.64 + 0.43, front + 0.22, 6), BRAND.ink, 1));
  pieces.push(colored(fruit(0.045, 0, top + 1.52, front + 0.22), BRAND.sun, 1));
  if (land) pieces.push(...landSignPost(W, D));
  group.add(painted(pieces, grain));

  group.add(glass(windowsAt.map((wx) => box(0.22, 0.46, 0.04, wx, 0.77, front + 0.01, 0.02))));
  const flagGeo = new PlaneGeometry(0.46, 0.26, 3, 1);
  // A little wave along the cloth, fixed so it holds still with motion reduced.
  const pos = flagGeo.getAttribute("position");
  for (let i = 0; i < pos.count; i++) pos.setZ(i, Math.sin((pos.getX(i) + 0.23) * 7) * 0.035);
  flagGeo.computeVertexNormals();
  flagGeo.translate(0.23, top + 1.36, front + 0.22);
  const flag = new Mesh(
    noShade(flagGeo),
    new MeshLambertMaterial({ color: BRAND.moss, vertexColors: true, side: DoubleSide }),
  );
  flag.castShadow = true;
  group.add(flag);
  if (land) group.add(landSign(land, W, D));
  if (pool) group.add(lightPool(pool, W * 0.9, 1.1, 0, D / 2 + 0.45));
  group.add(label("Town Hall", top + 1.85));
  return group;
}

/** Where the land's signboard stands: in front of the hall, left of the steps. */
const signAt = (W: number, D: number) => ({ x: -W * 0.36, z: D / 2 + 0.35 });

/** The land sign's two posts and its board, for the hall's painted mesh. */
function landSignPost(W: number, D: number): BufferGeometry[] {
  const { x, z } = signAt(W, D);
  return [
    colored(cylinder(0.025, 0.66, x - 0.36, 0.33, z, 6), WOOD_DARK),
    colored(cylinder(0.025, 0.66, x + 0.36, 0.33, z, 6), WOOD_DARK),
    colored(box(0.96, 0.34, 0.04, x, 0.52, z), BRAND.clay, 0.9),
  ];
}

/** The land's name on the signboard's face, as canvas text on a paper tag, lit like the board. */
function landSign(name: string, W: number, D: number): Mesh {
  const { x, z } = signAt(W, D);
  const tag = nameTag(name, false);
  const h = 0.3;
  const w = Math.min(0.92, h * tag.aspect);
  const geo = new PlaneGeometry(w, w / tag.aspect);
  const face = new Mesh(
    geo,
    new MeshLambertMaterial({ map: tag.texture, transparent: true, depthWrite: false }),
  );
  face.position.set(x, 0.52, z + 0.025);
  face.renderOrder = 2;
  return face;
}

/**
 * The town shop, filling its footprint: cream walls on a stone footing under a moss roof, a
 * striped clay awning over a window display of jars, a green door, a sign hanging from a bracket,
 * crates and a basket of produce out front, and beside it to the east a small market stall under a
 * striped moss canopy, its counter heaped. Its door faces north, across the square to the Town
 * Hall. With a `pool` texture, its windows pool light on the square after dark.
 */
export function shop(f: Footprint, grain: Texture, pool?: Texture): Group {
  const group = new Group();
  group.name = "shop";
  const W = f.width;
  const D = f.depth;
  // The shop takes the west two thirds; the stall the east third.
  const shopW = W * 0.66;
  const bx = -W / 2 + shopW / 2 + 0.04;
  const wallD = D * 0.62;
  const wallZ = D * 0.12;
  const front = wallZ - wallD / 2;
  const wallH = 1.05;
  const roofY = 0.14 + wallH;
  const doorX = 0;
  const displayX = bx - shopW * 0.2;
  const pieces: BufferGeometry[] = [
    colored(box(shopW + 0.06, 0.14, wallD + 0.06, bx, 0.07, wallZ), STONE_HI, 0.8),
    colored(box(shopW, wallH, wallD, bx, 0.14 + wallH / 2, wallZ), BRAND.paper),
    // The roof, its ridge east to west, a light ridge cap, and a clay chimney.
    colored(
      gable(wallD + 0.2, 0.78, shopW + 0.12, roofY - 0.02)
        .rotateY(Math.PI / 2)
        .translate(bx, 0, wallZ),
      BRAND.moss,
      0.85,
    ),
    colored(box(shopW + 0.14, 0.06, 0.08, bx, roofY + 0.76, wallZ), BRAND.mossLight, 1),
    colored(box(0.18, 0.5, 0.18, bx + shopW * 0.28, roofY + 0.45, wallZ + 0.12), BRAND.clay),
    colored(
      box(0.24, 0.06, 0.24, bx + shopW * 0.28, roofY + 0.72, wallZ + 0.12),
      BRAND.clayDeep,
      1,
    ),
    // The door and its step, and the display window's frame, shelf, and sill.
    colored(box(0.36, 0.7, 0.04, doorX, 0.14 + 0.35, front - 0.005), BRAND.paperEdge, 1),
    colored(box(0.3, 0.64, 0.05, doorX, 0.14 + 0.32, front - 0.015), BRAND.moss, 0.9),
    colored(disc(0.06, doorX, 0.62, front - 0.045), GLASS, 1),
    colored(fruit(0.025, doorX + 0.1, 0.42, front - 0.05), BRAND.sun, 1),
    colored(box(0.5, 0.08, 0.22, doorX, 0.04, front - 0.1), STONE_HI, 0.9),
    colored(box(0.86, 0.54, 0.03, displayX, 0.66, front - 0.005), BRAND.paperEdge, 1),
    colored(box(0.92, 0.05, 0.14, displayX, 0.38, front - 0.06), WOOD_DARK, 1),
    // A box of flowers under the display.
    colored(box(0.8, 0.09, 0.1, displayX, 0.3, front - 0.07), WOOD, 0.9),
  ];
  for (let i = 0; i < 4; i++) {
    pieces.push(
      colored(fruit(0.04, displayX - 0.3 + i * 0.2, 0.37, front - 0.08), crop("flower"), 1),
    );
  }
  // Jars on the display's sill, in front of the glass.
  [BRAND.sun, BRAND.clay, BRAND.moss, crop("blueberry")].forEach((color, i) => {
    const jx = displayX - 0.27 + i * 0.18;
    pieces.push(colored(cylinder(0.045, 0.13, jx, 0.48, front - 0.06, 8), color, 0.85));
    pieces.push(colored(cylinder(0.05, 0.025, jx, 0.555, front - 0.06, 8), STRAW_DEEP, 1));
  });
  // The striped awning over the front, sloping out over the window and the door.
  const stripes = 9;
  const sw = (shopW + 0.08) / stripes;
  for (let i = 0; i < stripes; i++) {
    const g = box(sw, 0.035, 0.46, -shopW / 2 - 0.04 + sw * (i + 0.5), 0, 0, 0.01);
    g.rotateX(-0.45);
    g.translate(bx, roofY - 0.22, front - 0.2);
    pieces.push(colored(g, i % 2 === 0 ? BRAND.clay : BRAND.paper2, 0.95));
  }
  // The sign hanging from a bracket at the west corner, square to the wall.
  const signX = bx - shopW / 2 + 0.1;
  pieces.push(
    colored(box(0.03, 0.03, 0.4, signX, 1.0, front - 0.2), BRAND.ink, 1),
    colored(box(0.04, 0.26, 0.3, signX, 0.82, front - 0.26), BRAND.clay, 1),
    colored(box(0.05, 0.2, 0.24, signX, 0.82, front - 0.26), BRAND.paper, 1),
    colored(box(0.06, 0.1, 0.08, signX, 0.81, front - 0.26), BRAND.sun, 1),
  );
  // Crates and a basket of produce out front.
  for (const [cx, kind] of [
    [displayX - 0.22, "tomato"],
    [displayX + 0.16, "lemon"],
  ] as const) {
    pieces.push(colored(box(0.32, 0.22, 0.24, cx, 0.11, front - 0.34), WOOD, 0.7));
    for (let i = 0; i < 5; i++) {
      const fx = cx - 0.1 + (i % 3) * 0.1;
      const fz = front - 0.34 + (i < 3 ? -0.05 : 0.05);
      pieces.push(colored(fruit(0.055, fx, 0.25, fz), crop(kind), 0.85));
    }
  }
  pieces.push(colored(cylinder(0.12, 0.12, doorX - 0.36, 0.06, front - 0.3, 10), STRAW, 0.75));
  for (const [ax, az] of [
    [-0.04, 0],
    [0.04, -0.03],
    [0, 0.04],
  ] as const) {
    pieces.push(
      colored(fruit(0.045, doorX - 0.36 + ax, 0.15, front - 0.3 + az), crop("apple"), 0.85),
    );
  }
  // Two windows at the back, onto the south, each with a box of flowers.
  const back = wallZ + wallD / 2;
  const backWindows = [bx - shopW * 0.24, bx + shopW * 0.24];
  for (const wx of backWindows) {
    pieces.push(colored(box(0.4, 0.44, 0.03, wx, 0.7, back + 0.005), BRAND.paperEdge, 1));
    pieces.push(colored(box(0.44, 0.08, 0.1, wx, 0.44, back + 0.05), WOOD, 0.9));
    for (let i = 0; i < 3; i++) {
      pieces.push(colored(fruit(0.04, wx - 0.12 + i * 0.12, 0.5, back + 0.06), crop("flower"), 1));
    }
  }
  pieces.push(...marketStall(W, D));
  group.add(painted(pieces, grain));
  group.add(
    glass([
      box(0.76, 0.44, 0.04, displayX, 0.66, front - 0.02, 0.015),
      ...backWindows.map((wx) => box(0.32, 0.36, 0.04, wx, 0.7, back + 0.02, 0.015)),
    ]),
  );
  if (pool) group.add(lightPool(pool, 1.8, 1.1, displayX + 0.2, front - 0.6));
  group.add(label("Shop", roofY + 1.15));
  return group;
}

/** The market stall east of the shop: four posts, a striped canopy, and a counter heaped high. */
function marketStall(W: number, D: number): BufferGeometry[] {
  const sx = W / 2 - W * 0.15;
  const sz = -D * 0.08;
  const half = W * 0.12;
  const pieces: BufferGeometry[] = [];
  for (const px of [sx - half, sx + half]) {
    for (const pz of [sz - 0.3, sz + 0.3]) {
      pieces.push(colored(cylinder(0.03, 1.0, px, 0.5, pz, 6), WOOD_DARK, 0.8));
    }
  }
  pieces.push(colored(box(half * 2 + 0.1, 0.48, 0.46, sx, 0.24, sz - 0.04), WOOD, 0.7));
  pieces.push(colored(box(half * 2 + 0.14, 0.04, 0.5, sx, 0.49, sz - 0.04), WOOD_DARK, 1));
  pieces.push(colored(box(0.3, 0.14, 0.02, sx, 0.3, sz - 0.28), BRAND.paper, 1));
  // The canopy: five stripes running front to back, sloping down to the north.
  const stripes = 5;
  const sw = (half * 2 + 0.2) / stripes;
  for (let i = 0; i < stripes; i++) {
    const g = box(sw, 0.03, 0.8, 0, 0, 0, 0.01);
    g.rotateX(-0.22);
    g.translate(sx - half - 0.1 + sw * (i + 0.5), 1.06, sz);
    pieces.push(colored(g, i % 2 === 0 ? BRAND.moss : BRAND.paper2, 0.95));
  }
  // Heaps of what's in season along the counter.
  const heaps = [crop("pumpkin"), crop("carrot"), crop("cabbage"), crop("grape")];
  heaps.forEach((color, i) => {
    const hx = sx - half + 0.06 + i * ((half * 2 - 0.12) / 3);
    for (const [dx, dy, dz] of [
      [-0.05, 0, -0.05],
      [0.05, 0, 0.04],
      [0, 0.06, 0],
    ] as const) {
      pieces.push(colored(fruit(0.06, hx + dx, 0.56 + dy, sz - 0.04 + dz), color, 0.85));
    }
  });
  return pieces;
}

/** The warm light in the windows after dark. */
const WINDOW_LIGHT = hex("#ffa443");

/** What lights up on a building after dark (decision 0098): its windows, as on the map. */
export function buildingGlows(group: Group): Glowing[] {
  const out: Glowing[] = [];
  group.traverse((o) => {
    if (!(o instanceof Mesh)) return;
    if (o.userData.glow === "window" && o.material instanceof MeshLambertMaterial)
      out.push({ kind: "window", material: o.material, strength: 0.85 });
    else if (o.userData.glow === "pool" && o.material instanceof MeshBasicMaterial)
      out.push({ kind: "pool", material: o.material, opacity: 0.45 });
  });
  return out;
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
