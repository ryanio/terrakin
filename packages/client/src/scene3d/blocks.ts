import { BLOCK_KINDS, DECOR_KINDS, FURNITURE_KINDS, isHeldBlock, POND_LOOK } from "@terrakin/sim";
import {
  AdditiveBlending,
  type BufferGeometry,
  type CanvasTexture,
  CircleGeometry,
  Color,
  IcosahedronGeometry,
  InstancedMesh,
  Matrix4,
  MeshBasicMaterial,
  MeshLambertMaterial,
  MeshPhongMaterial,
  type Object3D,
  PlaneGeometry,
  Quaternion,
  type Texture,
  Vector3,
} from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import {
  addWind,
  bakeShade,
  canvasTexture,
  lin,
  paper,
  plankTexture,
  type Stage,
  spotTexture,
  stoneTexture,
  unindexed,
} from "./art";
import { glowsAfterDark } from "./daylight";
import { decorInstances } from "./decor";
import { furnitureInstances } from "./furniture";
import { type LayoutBlock, tileHash } from "./layout";
import { BRAND, blockLook, hex, mix, SKY, shade } from "./palette";

// ---------- blocks ----------

/**
 * Blocks as instanced meshes, one draw per kind (and per part of a decor model), placed relative
 * to `origin` (the tile that sits at the scene's middle), with their pools of light after dark.
 * Shared by the plot and the world, which passes one plank, stone, and pool texture for all its
 * plots.
 */
export function blockMeshes(
  stage: Stage,
  origin: { x: number; y: number },
  blocks: readonly LayoutBlock[],
  grain: Texture,
  shared?: { plank: Texture; stone: Texture; pool?: Texture },
): Object3D[] {
  const out: Object3D[] = [];
  const toX = (x: number) => x - origin.x;
  const toZ = (y: number) => y - origin.y;
  const fogColor = SKY.fog;
  const m = new Matrix4();
  const q = new Quaternion();
  const one = new Vector3(1, 1, 1);

  const colorFor = (base: number, b: LayoutBlock) => {
    // A little variety per block, and neighbors melt into the haze.
    const jitter = ((tileHash(b.x, b.y) % 100) / 100 - 0.5) * 0.12;
    return mix(shade(base, jitter), fogColor, b.own ? 0 : 0.25 + b.fade * 0.6);
  };

  for (const kind of ["wood", "stone"] as const) {
    const list = blocks.filter((b) => b.block === kind);
    if (list.length === 0) continue;
    const tex =
      shared?.[kind === "wood" ? "plank" : "stone"] ??
      stage.keep(kind === "wood" ? plankTexture() : stoneTexture());
    const look = blockLook(kind);
    const geo = bakeShade(new RoundedBoxGeometry(0.96, look.height, 0.96, 2, 0.09), 0.62, 1);
    geo.translate(0, look.height / 2, 0);
    const mesh = new InstancedMesh(geo, paper(0xffffff, tex), list.length);
    list.forEach((b, i) => {
      m.compose(new Vector3(toX(b.x), 0, toZ(b.y)), q, one);
      mesh.setMatrixAt(i, m);
      mesh.setColorAt(i, lin(colorFor(look.color, b)));
    });
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    out.push(mesh);
  }

  // Planters, kitchens, workbenches, pedestals, and any other plain block: paper voxels in their
  // own color and height.
  const plain = BLOCK_KINDS.filter(
    (k) => blockLook(k).form === "voxel" && k !== "wood" && k !== "stone" && k !== "glass",
  );
  for (const kind of plain) {
    const list = blocks.filter((b) => b.block === kind);
    if (list.length === 0) continue;
    const look = blockLook(kind);
    let geo = bakeShade(new RoundedBoxGeometry(0.9, look.height, 0.9, 2, 0.08), 0.62, 1);
    geo.translate(0, look.height / 2, 0);
    if (kind === "planter") {
      // Dark soil inset in the top, like the map's planter, in the same draw.
      const soil = new RoundedBoxGeometry(0.7, 0.04, 0.7, 1, 0.015);
      soil.translate(0, look.height + 0.005, 0);
      const merged = mergeGeometries([unindexed(geo), unindexed(bakeShade(soil, 0.34, 0.34))]);
      geo.dispose();
      soil.dispose();
      geo = merged;
    }
    const mesh = new InstancedMesh(geo, paper(0xffffff, grain), list.length);
    list.forEach((b, i) => {
      m.compose(new Vector3(toX(b.x), 0, toZ(b.y)), q, one);
      mesh.setMatrixAt(i, m);
      mesh.setColorAt(i, lin(colorFor(look.color, b)));
    });
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    out.push(mesh);
  }

  // Glass: a pale pane in a paper-white frame with a cross, on a low wooden sill.
  const glass = blocks.filter((b) => b.block === "glass");
  if (glass.length > 0) {
    const look = blockLook("glass");
    const h = look.height;
    const frameParts: BufferGeometry[] = [];
    const bar = (w: number, hh: number, d: number, x: number, y: number) => {
      const g = new RoundedBoxGeometry(w, hh, d, 1, Math.min(w, hh, d) * 0.3);
      g.translate(x, y, 0);
      frameParts.push(g);
    };
    bar(0.96, 0.22, 0.96, 0, 0.11); // sill
    bar(0.96, 0.1, 0.5, 0, h - 0.05); // lintel
    bar(0.1, h - 0.3, 0.5, -0.43, 0.22 + (h - 0.3) / 2);
    bar(0.1, h - 0.3, 0.5, 0.43, 0.22 + (h - 0.3) / 2);
    bar(0.06, h - 0.3, 0.12, 0, 0.22 + (h - 0.3) / 2);
    bar(0.86, 0.06, 0.12, 0, 0.22 + (h - 0.3) / 2);
    const frameGeo = bakeShade(mergeGeometries(frameParts.map(unindexed)), 0.72, 1);
    for (const g of frameParts) g.dispose();
    const frame = new InstancedMesh(frameGeo, paper(0xffffff, grain), glass.length);
    const paneGeo = new RoundedBoxGeometry(0.8, h - 0.3, 0.42, 1, 0.04);
    paneGeo.translate(0, 0.22 + (h - 0.3) / 2, 0);
    // Panes turn to run along the wall they sit in: across x unless walls run north to south.
    const place = (b: LayoutBlock) => {
      const ns = solidAt(blocks, b.x, b.y - 1) || solidAt(blocks, b.x, b.y + 1);
      const ew = solidAt(blocks, b.x - 1, b.y) || solidAt(blocks, b.x + 1, b.y);
      q.setFromAxisAngle(UP, ns && !ew ? Math.PI / 2 : 0);
      return m.compose(new Vector3(toX(b.x), 0, toZ(b.y)), q, one);
    };
    glass.forEach((b, i) => {
      frame.setMatrixAt(i, place(b));
      frame.setColorAt(i, lin(colorFor(BRAND.paper2, b)));
    });
    q.identity();
    frame.castShadow = true;
    frame.receiveShadow = true;
    out.push(frame);
    // The panes: glassy, and after dark the windows of a home someone's in lit warm from inside
    // (decision 0098), one draw for each.
    for (const lit of [false, true]) {
      const list = glass.filter((b) => Boolean(b.lit) === lit);
      if (list.length === 0) continue;
      const material = new MeshPhongMaterial({
        color: look.color,
        transparent: true,
        opacity: look.opacity,
        shininess: 90,
        specular: 0xffffff,
        depthWrite: false,
        ...(lit ? { emissive: WINDOW_LIGHT } : {}),
      });
      if (lit)
        stage.glow({ kind: "window", material, strength: 1.1, opacity: [look.opacity, 0.8] });
      // The lit and the dark panes share one shape, freed with the plot.
      const pane = new InstancedMesh(paneGeo, material, list.length);
      list.forEach((b, i) => {
        pane.setMatrixAt(i, place(b));
        pane.setColorAt(i, lin(colorFor(look.color, b)));
      });
      q.identity();
      pane.renderOrder = 2;
      out.push(pane);
    }
  }

  // Leaf: a clump of low-poly leaves that sways in the breeze.
  const leaves = blocks.filter((b) => b.block === "leaf");
  if (leaves.length > 0) {
    const parts = [
      [0, 0.42, 0, 0.36],
      [0.2, 0.3, 0.14, 0.26],
      [-0.2, 0.32, 0.1, 0.25],
      [0.04, 0.3, -0.22, 0.26],
      [0.02, 0.68, 0.02, 0.22],
    ].map(([x, y, z, r]) => {
      const g = new IcosahedronGeometry(r as number, 0);
      g.translate(x as number, y as number, z as number);
      return g;
    });
    const geo = bakeShade(mergeGeometries(parts), 0.55, 1.08);
    for (const g of parts) g.dispose();
    const mat = new MeshLambertMaterial({ color: 0xffffff, flatShading: true, vertexColors: true });
    const wind = addWind(mat, 0.07);
    stage.animate(({ time }) => wind.tick(time));
    const mesh = new InstancedMesh(geo, mat, leaves.length);
    leaves.forEach((b, i) => {
      q.setFromAxisAngle(new Vector3(0, 1, 0), (tileHash(b.x, b.y) % 628) / 100);
      m.compose(new Vector3(toX(b.x), 0, toZ(b.y)), q, one);
      mesh.setMatrixAt(i, m);
      mesh.setColorAt(i, lin(colorFor(blockLook("leaf").color, b)));
    });
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    out.push(mesh);
  }

  // Decor from the town shop: real little models, fence rails reaching the fences beside them.
  const fences = new Set(blocks.filter((b) => b.block === "fence").map((b) => `${b.x},${b.y}`));
  const fenceAt = (x: number, y: number) => fences.has(`${x},${y}`);
  for (const kind of DECOR_KINDS) {
    const list = blocks.filter((b) => b.block === kind);
    const places = list.map((b) => ({
      x: toX(b.x),
      z: toZ(b.y),
      tint: mix(0xffffff, fogColor, b.own ? 0 : 0.25 + b.fade * 0.6),
      ...(kind === "fence"
        ? {
            joins: {
              n: fenceAt(b.x, b.y - 1),
              e: fenceAt(b.x + 1, b.y),
              s: fenceAt(b.x, b.y + 1),
              w: fenceAt(b.x - 1, b.y),
            },
          }
        : {}),
    }));
    out.push(...decorInstances(stage, kind, grain, places));
  }

  // Furniture from the workbench (RFC 0016), low stone walls running on to the walls beside them.
  const walls = new Set(blocks.filter((b) => b.block === "stone_wall").map((b) => `${b.x},${b.y}`));
  const wallAt = (x: number, y: number) => walls.has(`${x},${y}`);
  for (const kind of FURNITURE_KINDS) {
    const list = blocks.filter((b) => b.block === kind);
    const places = list.map((b) => ({
      x: toX(b.x),
      z: toZ(b.y),
      tint: mix(0xffffff, fogColor, b.own ? 0 : 0.25 + b.fade * 0.6),
      ...(kind === "stone_wall"
        ? {
            joins: {
              n: wallAt(b.x, b.y - 1),
              e: wallAt(b.x + 1, b.y),
              s: wallAt(b.x, b.y + 1),
              w: wallAt(b.x - 1, b.y),
            },
          }
        : {}),
    }));
    out.push(...furnitureInstances(stage, kind, grain, places));
  }

  // Ponds (RFC 0023): water flat in the ground, with a stone rim along each bank.
  const ponds = blocks.filter((b) => b.block === "pond");
  if (ponds.length > 0) out.push(...pondMeshes(stage, origin, ponds, colorFor));

  // After dark, a pool of warm light under every lamp and fire and around every lit window, for
  // any kind whose look is marked to glow: one draw for the whole plot (decision 0098).
  const glows = blocks.filter((b) => glowsAfterDark(b.block, b.lit));
  if (glows.length > 0) out.push(glowPools(stage, origin, glows, shared?.pool));
  return out;
}

/** How high a pond's water lies: over the grass and any path, under everything standing. */
const WATER_Y = 0.035;

/**
 * Glints on water: a few soft white streaks on clear, drawn once and repeated, which drift across
 * every pond while motion is allowed (RFC 0023).
 */
function glintTexture(): CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 64;
  c.height = 64;
  const g = c.getContext("2d") as CanvasRenderingContext2D;
  g.strokeStyle = POND_LOOK.glint;
  g.lineCap = "round";
  for (const [x, y, w, a] of [
    [10, 18, 16, 0.7],
    [36, 40, 12, 0.55],
    [44, 12, 9, 0.45],
    [18, 52, 10, 0.4],
  ] as const) {
    g.globalAlpha = a;
    g.lineWidth = 3;
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + w, y);
    g.stroke();
  }
  return canvasTexture(c, true);
}

/**
 * A plot's ponds in 3D (RFC 0023), in the sim's `POND_LOOK`: one draw for the water, one for the
 * glints drifting on it (still under reduced motion), one for the stone rim along every bank that
 * doesn't run on into more pond, and one for the lily pads on some tiles, as on the map.
 */
function pondMeshes(
  stage: Stage,
  origin: { x: number; y: number },
  ponds: readonly LayoutBlock[],
  colorFor: (base: number, b: LayoutBlock) => number,
): Object3D[] {
  const out: Object3D[] = [];
  const at = new Set(ponds.map((b) => `${b.x},${b.y}`));
  const water = (x: number, y: number) => at.has(`${x},${y}`);
  const m = new Matrix4();
  const q = new Quaternion();
  const one = new Vector3(1, 1, 1);
  const spot = (b: LayoutBlock, dx = 0, y = WATER_Y, dz = 0) =>
    new Vector3(b.x - origin.x + dx, y, b.y - origin.y + dz);

  const sheet = new PlaneGeometry(1, 1);
  sheet.rotateX(-Math.PI / 2);
  const surface = new InstancedMesh(
    sheet,
    new MeshPhongMaterial({ color: 0xffffff, shininess: 70, specular: hex(POND_LOOK.deep) }),
    ponds.length,
  );
  ponds.forEach((b, i) => {
    surface.setMatrixAt(i, m.compose(spot(b), q, one));
    surface.setColorAt(i, lin(colorFor(hex(POND_LOOK.water), b)));
  });
  surface.receiveShadow = true;
  surface.name = "ponds";
  out.push(surface);

  const glints = stage.keep(glintTexture());
  const sheen = new InstancedMesh(
    sheet,
    new MeshBasicMaterial({ map: glints, transparent: true, depthWrite: false, opacity: 0.5 }),
    ponds.length,
  );
  ponds.forEach((b, i) => {
    sheen.setMatrixAt(i, m.compose(spot(b, 0, WATER_Y + 0.004), q, one));
  });
  sheen.renderOrder = 1;
  stage.animate(({ time }) => {
    glints.offset.set((time * 0.03) % 1, (Math.sin(time * 0.4) * 0.04 + 1) % 1);
  });
  out.push(sheen);

  // The rim: a low stone kerb along each side that's bank.
  const kerbs: { b: LayoutBlock; dx: number; dz: number; across: boolean }[] = [];
  for (const b of ponds) {
    if (!water(b.x, b.y - 1)) kerbs.push({ b, dx: 0, dz: -0.43, across: true });
    if (!water(b.x, b.y + 1)) kerbs.push({ b, dx: 0, dz: 0.43, across: true });
    if (!water(b.x - 1, b.y)) kerbs.push({ b, dx: -0.43, dz: 0, across: false });
    if (!water(b.x + 1, b.y)) kerbs.push({ b, dx: 0.43, dz: 0, across: false });
  }
  if (kerbs.length > 0) {
    const h = blockLook("pond").height;
    const kerbGeo = bakeShade(new RoundedBoxGeometry(1, h, 0.16, 1, 0.05), 0.7, 1);
    kerbGeo.translate(0, h / 2, 0);
    const rim = new InstancedMesh(kerbGeo, paper(0xffffff, null), kerbs.length);
    kerbs.forEach(({ b, dx, dz, across }, i) => {
      q.setFromAxisAngle(UP, across ? 0 : Math.PI / 2);
      rim.setMatrixAt(i, m.compose(spot(b, dx, 0, dz), q, one));
      rim.setColorAt(i, lin(colorFor(hex(POND_LOOK.stone), b)));
    });
    q.identity();
    rim.castShadow = true;
    rim.receiveShadow = true;
    out.push(rim);
  }

  // Lily pads on the same tiles the map floats them on.
  const pads = ponds.filter((b) => tileHash(b.x, b.y) % 3 === 0);
  if (pads.length > 0) {
    const padGeo = new CircleGeometry(0.15, 10, 0.35, Math.PI * 2 - 0.5);
    padGeo.rotateX(-Math.PI / 2);
    const lily = new InstancedMesh(
      padGeo,
      new MeshLambertMaterial({ color: hex(POND_LOOK.lily) }),
      pads.length,
    );
    pads.forEach((b, i) => {
      const n = tileHash(b.x, b.y);
      const dx = -0.2 + ((n >> 3) % 4) * 0.12;
      const dz = 0.12 - ((n >> 5) % 3) * 0.1;
      lily.setMatrixAt(i, m.compose(spot(b, dx, WATER_Y + 0.008, dz), q, one));
    });
    out.push(lily);
  }
  return out;
}

const UP = new Vector3(0, 1, 0);
/** The warm light in a window after dark. */
const WINDOW_LIGHT = hex("#ffa443");
/** The color of a pool of lamplight, at its middle. */
export const POOL_LIGHT = "255, 168, 84";

/**
 * Pools of light on the ground after dark, one for each glowing block (its look's `glow` says how
 * big and where), added onto the ground so they brighten what's under them. A neighbor's pool fades
 * into the haze as their blocks do. Hidden by day (`Stage.glow`), so it costs nothing then.
 */
function glowPools(
  stage: Stage,
  origin: { x: number; y: number },
  blocks: readonly LayoutBlock[],
  map: Texture | undefined,
): InstancedMesh {
  const geo = new PlaneGeometry(1, 1);
  geo.rotateX(-Math.PI / 2);
  const material = new MeshBasicMaterial({
    map: map ?? stage.keep(spotTexture(POOL_LIGHT)),
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
  });
  stage.glow({ kind: "pool", material, opacity: 0.5 });
  const mesh = new InstancedMesh(geo, material, blocks.length);
  const m = new Matrix4();
  const q = new Quaternion();
  blocks.forEach((b, i) => {
    const glow = blockLook(b.block).glow;
    const size = glow?.pool ?? 1;
    const [ax, az] = glow?.at ?? [0, 0];
    m.compose(
      new Vector3(b.x - origin.x + ax, 0.02, b.y - origin.y + az),
      q,
      new Vector3(size, 1, size),
    );
    mesh.setMatrixAt(i, m);
    const k = b.own ? 1 : 1 - (0.25 + b.fade * 0.6);
    mesh.setColorAt(i, new Color(k, k, k));
  });
  mesh.renderOrder = 1;
  mesh.name = "glow pools";
  return mesh;
}

function solidAt(blocks: readonly LayoutBlock[], x: number, y: number): boolean {
  return blocks.some(
    (b) =>
      b.x === x && b.y === y && b.block !== "leaf" && b.block !== "pond" && !isHeldBlock(b.block),
  );
}
