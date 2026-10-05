/**
 * "Visit in 3D": one plot as a warm low-poly diorama. Blocks become rounded voxels (wood and stone
 * with planks and stones, glass as framed panes, leaf as swaying clumps), the hearth a little
 * stone fireplace with a glow and chimney smoke, residents soft peg figures in their color and
 * shape, and the neighbors' ground melts into the haze. A resident's own home model or picture,
 * when they have one, stands on the plot too.
 */

import { BLOCK_KINDS, DECOR_KINDS, isDecorKind } from "@terrakin/sim";
import { isModelResource } from "@terrakin/ui/format";
import {
  Box3,
  BufferAttribute,
  type BufferGeometry,
  type Color,
  CylinderGeometry,
  Group,
  IcosahedronGeometry,
  InstancedMesh,
  LoadingManager,
  type Material,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  MeshPhongMaterial,
  type Object3D,
  OctahedronGeometry,
  PlaneGeometry,
  PointLight,
  Quaternion,
  SphereGeometry,
  Sprite,
  SpriteMaterial,
  SRGBColorSpace,
  type Texture,
  TextureLoader,
  Vector3,
} from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import {
  addWind,
  bakeShade,
  blobShadow,
  disposeTree,
  grainTexture,
  lin,
  nameTag,
  noShade,
  paper,
  plankTexture,
  type Stage,
  spotTexture,
  stoneTexture,
  unindexed,
} from "./art";
import { decorInstances } from "./decor";
import { painting } from "./items";
import {
  type Bounds,
  cornerLight,
  fitModel,
  groundDecor,
  type HomeExtras,
  inBounds,
  type LayoutBlock,
  type LayoutFigure,
  modelFootprint,
  overBudget,
  type PlotLayout,
  tagHeight,
  tileHash,
  underFootprint,
} from "./layout";
import { BRAND, blockLook, mix, residentHex, SKY, shade } from "./palette";
import { wearGroup } from "./wear";

export interface PlotSceneOptions {
  /** A note for the page when the owner's own model or picture couldn't be shown. */
  onNote?(text: string): void;
}

/** Build the plot into the stage. Everything added is freed by `stage.dispose()`. */
export function buildPlot(
  stage: Stage,
  layout: PlotLayout,
  extras: HomeExtras,
  opts: PlotSceneOptions = {},
) {
  const root = new Group();
  stage.scene.add(root);
  const grain = stage.keep(grainTexture());
  const origin = layout.center;
  const toX = (x: number) => x - origin.x;
  const toZ = (y: number) => y - origin.y;

  const footprint = extras.homeModel ? modelFootprint(layout) : undefined;
  const blocks = footprint
    ? layout.blocks.filter((b) => !(b.own && underFootprint(footprint, b.x, b.y)))
    : layout.blocks;
  const solid = new Set(blocks.map((b) => `${b.x},${b.y}`));
  if (layout.hearth) solid.add(`${layout.hearth.x},${layout.hearth.y}`);

  root.add(ground(layout, solid));
  root.add(border(layout.bounds, origin, grain));
  root.add(...blockMeshes(stage, origin, blocks, grain));
  const { tufts, flowers } = groundDecor(
    {
      x0: layout.bounds.x0 - 2,
      y0: layout.bounds.y0 - 2,
      x1: layout.bounds.x1 + 2,
      y1: layout.bounds.y1 + 2,
    },
    solid,
  );
  root.add(scenery(stage, origin, tufts, flowers));
  if (layout.hearth) {
    const h = hearth(stage, grain);
    h.position.set(toX(layout.hearth.x), 0, toZ(layout.hearth.y));
    root.add(h);
  }
  const shadowMap = stage.keep(spotTexture());
  for (const f of layout.figures) {
    const fig = figure(stage, f, shadowMap);
    fig.position.set(toX(f.x), 0, toZ(f.y));
    // Face the camera's usual side (south-east), with a little turn each.
    fig.rotation.y = 0.5 + ((tileHash(f.x, f.y) % 100) / 100 - 0.5) * 0.8;
    root.add(fig);
  }

  if (extras.homeModel && footprint) {
    loadHomeModel(stage, root, extras.homeModel, {
      x: toX(footprint.x),
      z: toZ(footprint.y),
      fit: { width: footprint.width, depth: footprint.depth, height: footprint.height },
    })
      .then((ok) => {
        if (!ok)
          opts.onNote?.(
            "Their home model is too detailed to show here, so you're seeing their blocks.",
          );
      })
      .catch(() =>
        opts.onNote?.("Their home model couldn't be shown, so you're seeing their blocks."),
      );
  } else if (extras.homeArt) {
    loadSign(stage, root, extras.homeArt, layout).catch(() => {
      opts.onNote?.("Their picture couldn't be shown.");
    });
  }

  const radius = layout.size * 0.56;
  const center = new Vector3(0, 0.6, 0);
  stage.light(new Vector3(0, 0, 0), layout.size / 2 + layout.margin);
  stage.frame(center, radius, new Vector3(0.55, 0.78, 1));
  return root;
}

// ---------- ground ----------

/** One corner of a ground grid: its color (linear) and how opaque it is. */
export interface GroundCorner {
  color: Color;
  alpha: number;
}

/**
 * A square grid of ground, `n` tiles a side from tile corner (x0 - 0.5, y0 - 0.5), one vertex per
 * tile corner. `corner(cx, cy)` colors the corner shared by tiles (cx - 1 .. cx, cy - 1 .. cy).
 * Shared by the plot and the world, so both lay their ground the same way.
 */
export function groundGrid(
  x0: number,
  y0: number,
  n: number,
  origin: { x: number; y: number },
  corner: (cx: number, cy: number, distance: number) => GroundCorner,
): Mesh {
  const geo = new PlaneGeometry(n, n, n, n);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.getAttribute("position");
  const colors = new Float32Array(pos.count * 4);
  const cx0 = x0 + n / 2 - 0.5;
  const cy0 = y0 + n / 2 - 0.5;
  for (let i = 0; i < pos.count; i++) {
    const lx = pos.getX(i);
    const lz = pos.getZ(i);
    const cx = Math.round(lx + cx0 + 0.5);
    const cy = Math.round(lz + cy0 + 0.5);
    const { color, alpha } = corner(cx, cy, Math.hypot(lx, lz));
    colors[i * 4] = color.r;
    colors[i * 4 + 1] = color.g;
    colors[i * 4 + 2] = color.b;
    colors[i * 4 + 3] = alpha;
  }
  geo.setAttribute("color", new BufferAttribute(colors, 4));
  const mesh = new Mesh(
    geo,
    new MeshLambertMaterial({ vertexColors: true, transparent: true, depthWrite: true }),
  );
  mesh.position.set(cx0 - origin.x, 0, cy0 - origin.y);
  mesh.receiveShadow = true;
  mesh.renderOrder = -1;
  return mesh;
}

/**
 * The ground around the plot: meadow tints by hash, a warmer tint on the plot, the sand of the
 * world's edge, soft shade around blocks, and a radial fade so the edge melts into the sky.
 */
function ground(layout: PlotLayout, solid: ReadonlySet<string>): Mesh {
  const ring = layout.margin + 14;
  const n = layout.size + ring * 2;
  const grass = [BRAND.grass, 0xa1c27d, 0xa9c986, 0x9dbe79].map(lin);
  const plotTint = lin(0xb4cd86);
  const sand = lin(BRAND.sand);
  const fog = lin(SKY.fog);
  const fadeStart = layout.size / 2 + layout.margin + 2;
  const fadeEnd = n / 2 - 0.5;
  // Plot centers sit between tiles on even plots; the grid is centered on the plot.
  return groundGrid(
    layout.bounds.x0 - ring,
    layout.bounds.y0 - ring,
    n,
    layout.center,
    (cx, cy, d) => {
      const tx = cx - 1 + ((cx + cy) & 1);
      const ty = cy - 1;
      const onPlot =
        cx > layout.bounds.x0 &&
        cx <= layout.bounds.x1 &&
        cy > layout.bounds.y0 &&
        cy <= layout.bounds.y1;
      let c = (grass[tileHash(tx, ty) & 3] ?? plotTint).clone();
      if (onPlot) c.lerp(plotTint, 0.5);
      if (!layout.inWorld(tx, ty)) c = sand.clone();
      c.multiplyScalar(cornerLight(solid, cx, cy));
      const t = Math.min(1, Math.max(0, (d - fadeStart) / (fadeEnd - fadeStart)));
      c.lerp(fog, t * t * 0.9);
      return { color: c, alpha: 1 - t * t * t };
    },
  );
}

/** A plot's edge as a dashed line of little clay stepping stones, like the 2D map's border. */
export function border(
  bounds: Bounds,
  origin: { x: number; y: number },
  grain: Texture,
): InstancedMesh {
  const S = bounds.x1 - bounds.x0 + 1;
  const half = S / 2;
  const mx = (bounds.x0 + bounds.x1) / 2 - origin.x;
  const mz = (bounds.y0 + bounds.y1) / 2 - origin.y;
  const geo = bakeShade(new RoundedBoxGeometry(0.42, 0.06, 0.12, 2, 0.025), 0.8, 1);
  const mat = paper(mix(BRAND.clay, BRAND.paperEdge, 0.3), grain);
  const mesh = new InstancedMesh(geo, mat, S * 4);
  const m = new Matrix4();
  const q = new Quaternion();
  const up = new Vector3(0, 1, 0);
  let i = 0;
  for (let k = 0; k < S; k++) {
    const along = -half + k + 0.5;
    for (const [x, z, turn] of [
      [along, -half, 0],
      [along, half, 0],
      [-half, along, Math.PI / 2],
      [half, along, Math.PI / 2],
    ] as const) {
      q.setFromAxisAngle(up, turn);
      m.compose(new Vector3(mx + x, 0.03, mz + z), q, new Vector3(1, 1, 1));
      mesh.setMatrixAt(i++, m);
    }
  }
  mesh.receiveShadow = true;
  return mesh;
}

// ---------- blocks ----------

/**
 * Blocks as instanced meshes, one draw per kind (and per part of a decor model), placed relative
 * to `origin` (the tile that sits at the scene's middle). Shared by the plot and the world, which
 * passes one plank and one stone texture for all its plots.
 */
export function blockMeshes(
  stage: Stage,
  origin: { x: number; y: number },
  blocks: readonly LayoutBlock[],
  grain: Texture,
  shared?: { plank: Texture; stone: Texture },
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
    const geo = bakeShade(new RoundedBoxGeometry(0.9, look.height, 0.9, 2, 0.08), 0.62, 1);
    geo.translate(0, look.height / 2, 0);
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
    const pane = new InstancedMesh(
      paneGeo,
      new MeshPhongMaterial({
        color: blockLook("glass").color,
        transparent: true,
        opacity: look.opacity,
        shininess: 90,
        specular: 0xffffff,
        depthWrite: false,
      }),
      glass.length,
    );
    glass.forEach((b, i) => {
      m.compose(new Vector3(toX(b.x), 0, toZ(b.y)), q, one);
      frame.setMatrixAt(i, m);
      pane.setMatrixAt(i, m);
      frame.setColorAt(i, lin(colorFor(BRAND.paper2, b)));
      pane.setColorAt(i, lin(colorFor(look.color, b)));
    });
    // Panes turn to run along the wall they sit in: across x unless walls run north to south.
    glass.forEach((b, i) => {
      const ns = solidAt(blocks, b.x, b.y - 1) || solidAt(blocks, b.x, b.y + 1);
      const ew = solidAt(blocks, b.x - 1, b.y) || solidAt(blocks, b.x + 1, b.y);
      if (ns && !ew) {
        q.setFromAxisAngle(new Vector3(0, 1, 0), Math.PI / 2);
        m.compose(new Vector3(toX(b.x), 0, toZ(b.y)), q, one);
        frame.setMatrixAt(i, m);
        pane.setMatrixAt(i, m);
        q.identity();
      }
    });
    frame.castShadow = true;
    frame.receiveShadow = true;
    pane.renderOrder = 2;
    out.push(frame, pane);
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
  return out;
}

function solidAt(blocks: readonly LayoutBlock[], x: number, y: number): boolean {
  return blocks.some((b) => b.x === x && b.y === y && b.block !== "leaf" && !isDecorKind(b.block));
}

// ---------- tufts and flowers ----------

/** Grass tufts and flowers at tile positions, each kind one instanced draw that sways. */
export function scenery(
  stage: Stage,
  origin: { x: number; y: number },
  tufts: readonly { x: number; y: number; turn: number }[],
  flowers: readonly { x: number; y: number; warm: boolean }[],
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
    const mat = new MeshLambertMaterial({ color: BRAND.moss, vertexColors: true });
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
  return group;
}

// ---------- the hearth ----------

/**
 * A little stone fireplace with a chimney, a flickering fire, a warm glow, and smoke. With
 * `light`, a warm point light on desktop; the world leaves it out, since a light coming into view
 * makes every material recompile. The world passes one `stone` and `glow` texture for every hearth.
 */
export function hearth(
  stage: Stage,
  grain: Texture,
  { light: withLight = true, stone: stoneMap, glow: glowMap } = {} as {
    light?: boolean;
    stone?: Texture;
    glow?: Texture;
  },
): Group {
  const group = new Group();
  group.name = "hearth";
  const stones = stoneMap ?? stage.keep(stoneTexture());
  const stone = paper(0xb9b1a5, stones);
  const base = new Mesh(
    bakeShade(new RoundedBoxGeometry(0.82, 0.5, 0.62, 2, 0.08), 0.65, 1),
    stone,
  );
  base.position.y = 0.25;
  const chimney = new Mesh(
    bakeShade(new RoundedBoxGeometry(0.34, 1.35, 0.3, 2, 0.05), 0.7, 1),
    stone,
  );
  chimney.position.set(0, 0.68, -0.14);
  const cap = new Mesh(
    bakeShade(new RoundedBoxGeometry(0.44, 0.1, 0.4, 2, 0.03), 0.8, 1),
    paper(BRAND.clay, grain),
  );
  cap.position.set(0, 1.4, -0.14);
  // The fire opening: a dark arch with embers and a flame.
  const mouth = new Mesh(new PlaneGeometry(0.4, 0.3), new MeshBasicMaterial({ color: 0x3a2214 }));
  mouth.position.set(0, 0.2, 0.312);
  const flameMat = new MeshBasicMaterial({ color: BRAND.ember });
  const flame = new Mesh(new OctahedronGeometry(0.1, 0), flameMat);
  flame.scale.set(1, 1.6, 0.6);
  flame.position.set(0, 0.17, 0.3);
  const coreMat = new MeshBasicMaterial({ color: 0xfff1b0 });
  const core = new Mesh(new OctahedronGeometry(0.05, 0), coreMat);
  core.scale.set(1, 1.5, 0.6);
  core.position.set(0, 0.13, 0.33);
  group.add(base, chimney, cap, mouth, flame, core);
  for (const o of [base, chimney, cap]) {
    o.castShadow = true;
    o.receiveShadow = true;
  }

  // A warm pool of light on the ground in front.
  const glow = new Mesh(
    new PlaneGeometry(1.8, 1.8),
    new MeshBasicMaterial({
      map: glowMap ?? stage.keep(spotTexture("255, 170, 80")),
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
    }),
  );
  glow.rotation.x = -Math.PI / 2;
  glow.position.set(0, 0.015, 0.55);
  glow.renderOrder = 1;
  group.add(glow);

  let light: PointLight | undefined;
  if (withLight && stage.quality === "high") {
    light = new PointLight(0xffa54d, 1.6, 3.2, 1.6);
    light.position.set(0, 0.35, 0.6);
    group.add(light);
  }

  // Smoke: a few soft puffs that rise from the chimney, swell, and fade, then start again.
  const puffGeo = new IcosahedronGeometry(0.11, 1);
  const puffs: { mesh: Mesh; mat: MeshLambertMaterial; offset: number }[] = [];
  const count = 5;
  for (let i = 0; i < count; i++) {
    const mat = new MeshLambertMaterial({
      color: 0xfbf3e4,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      flatShading: true,
    });
    const mesh = new Mesh(i === 0 ? puffGeo : puffGeo.clone(), mat);
    mesh.position.set(0, 1.5, -0.14);
    group.add(mesh);
    puffs.push({ mesh, mat, offset: i / count });
  }
  const placePuffs = (time: number) => {
    for (const p of puffs) {
      const t = (time * 0.18 + p.offset) % 1;
      p.mesh.position.set(
        Math.sin(t * 5 + p.offset * 9) * 0.12 + t * 0.35,
        1.5 + t * 1.6,
        -0.14 - t * 0.2,
      );
      p.mesh.scale.setScalar(0.6 + t * 1.6);
      p.mat.opacity = Math.sin(Math.PI * Math.min(1, t * 1.15)) * 0.7;
    }
  };
  placePuffs(1.3);
  stage.animate(({ time }) => {
    placePuffs(time);
    const f = 1 + Math.sin(time * 11) * 0.08 + Math.sin(time * 17.3) * 0.06;
    flame.scale.set(1, 1.6 * f, 0.6);
    core.scale.set(1, 1.5 * (2 - f), 0.6);
    if (light) light.intensity = 1.5 * f;
  });
  return group;
}

// ---------- residents ----------

/** A soft peg figure: a body in their color and shape, a round head, dot eyes, and their wear. */
export function figure(stage: Stage, f: LayoutFigure, shadowMap: Texture): Group {
  const group = new Group();
  group.name = "figure";
  const body = new Group();
  const color = residentHex(f.color);
  const bodyMat = new MeshLambertMaterial({ color, vertexColors: true });
  let bodyGeo: BufferGeometry;
  if (f.shape === "square") bodyGeo = new RoundedBoxGeometry(0.42, 0.46, 0.36, 3, 0.1);
  else if (f.shape === "diamond") {
    bodyGeo = new OctahedronGeometry(0.28, 0);
    bodyGeo.scale(0.95, 0.95, 0.8);
  } else {
    bodyGeo = new SphereGeometry(0.24, 18, 12);
    bodyGeo.scale(1, 1.1, 0.92);
  }
  bodyGeo.translate(0, 0.28, 0);
  const torso = new Mesh(bakeShade(bodyGeo, 0.7, 1.05), bodyMat);
  const skin = new MeshLambertMaterial({ color: 0xfbe6cc });
  const head = new Mesh(new SphereGeometry(0.17, 18, 12), skin);
  head.position.y = 0.66;
  const eyeMat = new MeshBasicMaterial({ color: BRAND.ink });
  const eyeGeo = new SphereGeometry(0.022, 8, 6);
  const eyes = [-0.06, 0.06].map((x) => {
    const e = new Mesh(eyeGeo, eyeMat);
    e.position.set(x, 0.68, 0.155);
    return e;
  });
  const cheekMat = new MeshBasicMaterial({ color: 0xf2a08f, transparent: true, opacity: 0.7 });
  const cheeks = [-0.1, 0.1].map((x) => {
    const c = new Mesh(new SphereGeometry(0.025, 8, 6), cheekMat);
    c.scale.set(1, 0.6, 0.4);
    c.position.set(x, 0.635, 0.145);
    return c;
  });
  body.add(torso, head, ...eyes, ...cheeks);
  if (f.kind === "agent") {
    // Agents wear a little sprout antenna with a sun bulb (the 2D map marks them with a gear).
    const stalk = new Mesh(
      new CylinderGeometry(0.012, 0.012, 0.16, 5),
      new MeshLambertMaterial({ color: BRAND.moss }),
    );
    stalk.position.y = 0.88;
    const bulb = new Mesh(
      new SphereGeometry(0.04, 10, 8),
      new MeshLambertMaterial({ color: BRAND.sun, emissive: BRAND.sun, emissiveIntensity: 0.4 }),
    );
    bulb.position.y = 0.97;
    body.add(stalk, bulb);
  }
  body.add(wearGroup(f));
  body.traverse((o) => {
    if (o instanceof Mesh) o.castShadow = true;
  });
  group.add(blobShadow(shadowMap, 0.3), body);

  const tag = nameTag(f.name, f.owner);
  const label = new Sprite(
    new SpriteMaterial({ map: tag.texture, depthWrite: false, transparent: true }),
  );
  const h = 0.3;
  label.scale.set(h * tag.aspect, h, 1);
  label.position.y = tagHeight(f);
  label.renderOrder = 5;
  group.add(label);

  group.scale.setScalar(1.3);
  const phase = (tileHash(f.x * 7, f.y * 13) % 1000) / 160;
  stage.animate(({ time }) => {
    const breathe = Math.sin(time * 2 + phase);
    body.position.y = Math.max(0, breathe) * 0.025;
    body.scale.set(1 + breathe * 0.012, 1 - breathe * 0.012, 1 + breathe * 0.012);
    body.rotation.z = Math.sin(time * 0.9 + phase) * 0.04;
  });
  return group;
}

// ---------- a resident's own home model and picture ----------

/** A manager that lets a model or texture load only our own media, inline data, or its blobs. */
function sameOriginManager(): LoadingManager {
  const manager = new LoadingManager();
  manager.setURLModifier((u) => (isModelResource(u, location.origin) ? u : "data:,"));
  return manager;
}

/** Load their .glb, refuse it if it's over budget, then fit it on the footprint. */
async function loadHomeModel(
  stage: Stage,
  root: Group,
  url: string,
  at: { x: number; z: number; fit: { width: number; height: number; depth: number } },
): Promise<boolean> {
  const gltf = await new GLTFLoader(sameOriginManager()).loadAsync(url);
  const model = gltf.scene;
  let triangles = 0;
  let texturePixels = 0;
  const textures = new Set<Texture>();
  model.traverse((o) => {
    if (!(o instanceof Mesh)) return;
    const g = o.geometry as BufferGeometry;
    const count = g.index ? g.index.count : (g.getAttribute("position")?.count ?? 0);
    triangles += count / 3;
    const mats: Material[] = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of mats)
      for (const v of Object.values(m))
        if (v && (v as Texture).isTexture) textures.add(v as Texture);
  });
  for (const t of textures) {
    const img = t.image as { width?: number; height?: number } | undefined;
    texturePixels += (img?.width ?? 0) * (img?.height ?? 0);
  }
  if (overBudget({ triangles, texturePixels, textures: textures.size })) {
    disposeTree(model);
    for (const t of textures) t.dispose();
    return false;
  }
  if (!root.parent) {
    // The page closed while it loaded.
    disposeTree(model);
    return true;
  }
  model.updateMatrixWorld(true);
  const box = new Box3().setFromObject(model);
  const { scale, offset } = fitModel(
    { min: [box.min.x, box.min.y, box.min.z], max: [box.max.x, box.max.y, box.max.z] },
    at.fit,
  );
  const holder = new Group();
  model.scale.multiplyScalar(scale);
  model.position.multiplyScalar(scale).add(new Vector3(...offset));
  holder.add(model);
  holder.position.set(at.x, 0, at.z);
  model.traverse((o) => {
    if (o instanceof Mesh) {
      o.castShadow = true;
      o.receiveShadow = true;
    }
  });
  root.add(holder);
  stage.invalidate();
  return true;
}

/** Their picture as a painted sign on two posts, by the front of the plot. */
async function loadSign(stage: Stage, root: Group, url: string, layout: PlotLayout) {
  const texture = await new TextureLoader(sameOriginManager()).loadAsync(url);
  texture.colorSpace = SRGBColorSpace;
  if (!root.parent) {
    texture.dispose();
    return;
  }
  const img = texture.image as { width?: number; height?: number };
  const aspect = (img.width ?? 4) / Math.max(1, img.height ?? 3);
  const sign = new Group();
  const pic = painting(texture, aspect, 0.9);
  pic.position.y = 0.75;
  const postMat = new MeshLambertMaterial({ color: 0x7a4f2c, vertexColors: true });
  const width = 0.9 * Math.min(1.9, Math.max(0.55, aspect));
  for (const x of [-width / 2 - 0.05, width / 2 + 0.05]) {
    const post = new Mesh(
      bakeShade(new RoundedBoxGeometry(0.08, 1.25, 0.08, 1, 0.02), 0.7, 1),
      postMat,
    );
    post.position.set(x, 0.62, -0.02);
    post.castShadow = true;
    sign.add(post);
  }
  sign.add(pic);
  // South-east corner of the plot, turned toward the usual camera, unless a block is in the way.
  const { x1, y1 } = layout.bounds;
  let spot = { x: x1 - 0.5, y: y1 - 0.2 };
  if (layout.blocks.some((b) => inBounds({ x0: x1 - 1, y0: y1 - 1, x1, y1 }, b.x, b.y)))
    spot = { x: layout.center.x, y: layout.bounds.y1 + 0.2 };
  sign.position.set(spot.x - layout.center.x, 0, spot.y - layout.center.y);
  sign.rotation.y = 0.45;
  root.add(sign);
  stage.invalidate();
}
