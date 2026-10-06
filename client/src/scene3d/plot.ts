/**
 * "Visit in 3D": one plot as a warm low-poly diorama. Blocks become rounded voxels (wood and stone
 * with planks and stones, glass as framed panes, leaf as swaying clumps), the hearth a little
 * stone fireplace with a glow and chimney smoke, residents soft peg figures in their color and
 * shape, and the neighbors' ground melts into the haze. A resident's own home model or picture,
 * when they have one, stands on the plot too.
 */

import { BLOCK_KINDS, DECOR_KINDS, isDecorKind, type ResourceKind } from "@terrakin/sim";
import type { Feeling } from "@terrakin/ui/feelings";
import { drawFeelingIcon, FEELING_ICON, type FeelingIcon } from "@terrakin/ui/figure";
import { isModelResource } from "@terrakin/ui/format";
import { CROP_HEX } from "@terrakin/ui/item-art";
import { lookPalette } from "@terrakin/ui/looks";
import {
  Box3,
  BufferAttribute,
  type BufferGeometry,
  type CanvasTexture,
  CircleGeometry,
  type Color,
  CylinderGeometry,
  DodecahedronGeometry,
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
  RingGeometry,
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
import { idPhase, type Pose, pose, restingPose, type Shown } from "../feelings";
import {
  addWind,
  bakeShade,
  blobShadow,
  canvasTexture,
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
import { createPictures, displayedThings } from "./displays";
import { painting } from "./items";
import {
  type Bounds,
  cornerLight,
  FIGURE_SCALE,
  fitModel,
  groundDecor,
  type HomeExtras,
  hearthPull,
  hearthStand,
  inBounds,
  type LayoutBlock,
  type LayoutCrop,
  type LayoutFigure,
  modelFootprint,
  overBudget,
  type PlotLayout,
  SIGN_SIZE,
  signSize,
  tagHeight,
  tileHash,
  underFootprint,
} from "./layout";
import { BRAND, blockLook, hex, mix, residentHex, SKY, shade } from "./palette";
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
  // Whatever stands under their own model gives way to it, like the blocks.
  const shown = <T extends { x: number; y: number }>(list: readonly T[]) =>
    footprint ? list.filter((t) => !underFootprint(footprint, t.x, t.y)) : list;
  const crops = cropPlants(stage, origin, shown(layout.crops));
  if (crops.length) root.add(...crops);
  root.add(
    displayedThings(stage, origin, shown(layout.displays), stage.keep(createPictures()), grain),
  );
  const shadowMap = stage.keep(spotTexture());
  // Someone on the hearth's tile stands clear of the stonework, not inside it.
  const home = layout.hearth;
  const stand = home
    ? hearthStand((dx, dy) => {
        const x = home.x + dx;
        const y = home.y + dy;
        return layout.inWorld(x, y) && !solid.has(`${x},${y}`);
      })
    : undefined;
  const figures: Group[] = [];
  for (const f of layout.figures) {
    const fig = figure(stage, f, shadowMap);
    const pull = home && stand ? hearthPull(f.x, f.y, home.x, home.y) : 0;
    fig.position.set(toX(f.x) + (stand?.x ?? 0) * pull, 0, toZ(f.y) + (stand?.y ?? 0) * pull);
    // Face the camera's usual side (south-east), with a little turn each.
    fig.rotation.y = 0.5 + ((tileHash(f.x, f.y) % 100) / 100 - 0.5) * 0.8;
    root.add(fig);
    figures.push(fig);
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
  // Signs keep a readable size as the camera pulls back. Only a zoom changes it.
  const { camera, controls } = stage;
  const fitSigns = () => {
    const size = signSize(camera.position.distanceTo(controls.target), camera.fov);
    for (const fig of figures) sizeSign(fig, size);
  };
  fitSigns();
  controls.addEventListener("change", fitSigns);
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
 * every ripe crop, about 100 triangles a planter, swaying in the breeze. Pumpkins grow on a vine
 * instead (`pumpkinPatch`). Shared by the plot and the world.
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
  const pumpkins = all.filter((c) => c.crop === "pumpkin");
  if (pumpkins.length > 0) out.push(...pumpkinPatch(stage, place, pumpkins));
  const crops = all.filter((c) => c.crop !== "pumpkin");
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
 * Pumpkins in planters (RFC 0017): a low vine of leaves on the soil, and a ribbed pumpkin that
 * swells from a green bud and turns orange, stem up, once it's ready. One draw for every vine and
 * one for every pumpkin, about 160 triangles a planter. The leaves sway; the pumpkins sit still.
 */
function pumpkinPatch(
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
  const pumpkinGeo = mergeGeometries([
    ...lobes.map((g) => tinted(g, 0xffffff)),
    tinted(stalk, 0x6a6136),
  ]);
  for (const g of [...lobes, stalk]) g.dispose();
  const pumpkinMat = new MeshLambertMaterial({ vertexColors: true, flatShading: true });
  const body = new InstancedMesh(pumpkinGeo, pumpkinMat, growing.length);
  const ripe = hex(CROP_HEX.pumpkin);
  growing.forEach((c, i) => {
    const swell = (c.done - 0.2) / 0.8;
    body.setMatrixAt(i, place(c, 0.3 + 0.7 * swell));
    body.setColorAt(i, lin(c.done >= 1 ? ripe : mix(0x8cbf5a, ripe, swell * 0.5)));
  });
  body.castShadow = true;
  return [vines, body];
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

const HEAD_Y = 0.66;
const HEAD_R = 0.17;

/** Put a flat face part on the head's surface at (x, y) from its middle, facing out. */
function onHeadSurface(m: Mesh, x: number, y: number) {
  const z = Math.sqrt(HEAD_R * HEAD_R - x * x - y * y);
  const k = (HEAD_R + 0.004) / HEAD_R;
  m.position.set(x * k, y * k, z * k);
  m.rotation.set(-Math.asin(y / HEAD_R), Math.atan2(x, z), 0, "YXZ");
}

/** The parts of a peg's face that change with a feeling (RFC 0013). */
interface FaceParts {
  /** The head and everything on it, turned to look at someone and tilted by feelings. */
  head: Group;
  /** The eyes, turned together to look up or down. */
  eyes: Group;
  dots: Mesh[];
  arcs: Mesh[];
  smile: Mesh;
  mouth: Mesh;
  cheeks: Mesh[];
  cheekMat: MeshBasicMaterial;
}

/**
 * The face, drawn flat on the head: dot eyes (squashed to blink), arc eyes for happy, laugh and
 * love, a smile or an open mouth, and cheeks that blush. No textures. Built once per figure; only
 * the parts a feeling uses are visible, so a neutral face draws the same four parts it always did.
 */
export function faceParts(color: number = BRAND.ink): FaceParts {
  const head = new Group();
  head.position.y = HEAD_Y;
  const ink = new MeshBasicMaterial({ color });
  const eyes = new Group();
  const dotGeo = new CircleGeometry(0.024, 8);
  const arcGeo = new RingGeometry(0.015, 0.026, 6, 1, 0, Math.PI);
  const dots: Mesh[] = [];
  const arcs: Mesh[] = [];
  for (const x of [-0.06, 0.06]) {
    const dot = new Mesh(dotGeo, ink);
    onHeadSurface(dot, x, 0.02);
    const arc = new Mesh(arcGeo, ink);
    onHeadSurface(arc, x, 0.012);
    arc.visible = false;
    dots.push(dot);
    arcs.push(arc);
    eyes.add(dot, arc);
  }
  const smile = new Mesh(new RingGeometry(0.016, 0.026, 6, 1, Math.PI, Math.PI), ink);
  onHeadSurface(smile, 0, -0.078);
  const mouth = new Mesh(new CircleGeometry(0.024, 8), ink);
  onHeadSurface(mouth, 0, -0.09);
  smile.visible = false;
  mouth.visible = false;
  const cheekMat = new MeshBasicMaterial({ color: 0xf2a08f, transparent: true, opacity: 0.7 });
  const cheekGeo = new CircleGeometry(0.03, 8);
  const cheeks = [-0.1, 0.1].map((x) => {
    const c = new Mesh(cheekGeo, cheekMat);
    onHeadSurface(c, x, -0.03);
    c.scale.set(1, 0.6, 1);
    return c;
  });
  head.add(eyes, smile, mouth, ...cheeks);
  return { head, eyes, dots, arcs, smile, mouth, cheeks, cheekMat };
}

/** How tall a name tag is, in a figure's own units, and the gap between it and the sign. */
const TAG_SIZE = 0.3;
const SIGN_GAP = 0.03;

/**
 * What floats over figures draws last, in this order, with no depth test: name tags, then
 * feelings' signs, then chat bubbles. Geometry never covers them, and two never fight.
 */
export const OVERHEAD_ORDER = { tag: 5, sign: 6, bubble: 7 } as const;

/** A sprite material for something over a figure: drawn on top of everything, see-through. */
export function overheadMaterial(map: Texture | null = null): SpriteMaterial {
  return new SpriteMaterial({ map, depthTest: false, depthWrite: false, transparent: true });
}

/** Each feeling's floating sign, drawn once from canvas and shared by every figure. */
const icons = new Map<FeelingIcon, CanvasTexture>();
/** The signs drawn so far: shared, so dropping one figure must not free them. */
export const ICON_TEXTURES: ReadonlySet<Texture> = new Set<Texture>();

function iconTexture(icon: FeelingIcon): CanvasTexture {
  let texture = icons.get(icon);
  if (!texture) {
    const c = document.createElement("canvas");
    c.width = 128;
    c.height = 128;
    const g = c.getContext("2d") as CanvasRenderingContext2D;
    g.translate(64, 64);
    drawFeelingIcon(g, icon, 128);
    texture = canvasTexture(c);
    icons.set(icon, texture);
    (ICON_TEXTURES as Set<Texture>).add(texture);
  }
  return texture;
}

interface Rig extends FaceParts {
  body: Group;
  hand: Mesh;
  icon: Sprite;
  iconMat: SpriteMaterial;
  /** The top of the name tag, where the sign sits, and how big the sign is drawn. */
  tagTop: number;
  iconSize: number;
  phase: number;
  shown: Shown | undefined;
  /** The feeling the face parts are set for. */
  drawn: Feeling;
  pose: Pose;
}

const rigs = new WeakMap<Object3D, Rig>();

/** The parts that hold still for a feeling: which eyes and mouth, the blush, and the sign. */
function setFace(rig: Rig, feeling: Feeling) {
  rig.drawn = feeling;
  const curved = feeling === "happy" || feeling === "laugh" || feeling === "love";
  for (const a of rig.arcs) a.visible = curved;
  for (const d of rig.dots) d.visible = !curved;
  const wide = feeling === "surprised" ? 1.35 : 1;
  for (const d of rig.dots) d.scale.set(wide, feeling === "sleepy" ? 0.18 : wide, 1);
  rig.eyes.rotation.set(
    feeling === "shy" ? 0.14 : feeling === "thinking" ? -0.12 : 0,
    feeling === "thinking" ? 0.16 : 0,
    0,
  );
  const { smile, mouth } = rig;
  smile.visible =
    feeling === "happy" || feeling === "love" || feeling === "shy" || feeling === "sad";
  smile.rotation.z = feeling === "sad" ? Math.PI : 0;
  smile.scale.setScalar(feeling === "shy" ? 0.65 : 1);
  mouth.visible =
    feeling === "laugh" ||
    feeling === "surprised" ||
    feeling === "sleepy" ||
    feeling === "thinking";
  if (feeling === "laugh") mouth.scale.set(1.15, 0.85, 1);
  else if (feeling === "surprised") mouth.scale.set(0.6, 0.75, 1);
  else if (feeling === "sleepy") mouth.scale.set(0.35, 0.4, 1);
  else mouth.scale.set(0.6, 0.18, 1);
  const blush = feeling === "love" || feeling === "shy";
  for (const c of rig.cheeks) c.scale.set(blush ? 1.5 : 1, blush ? 0.9 : 0.6, 1);
  rig.cheekMat.opacity = blush ? 0.95 : 0.7;
  const icon = FEELING_ICON[feeling];
  rig.icon.visible = icon !== undefined;
  if (icon) {
    const map = iconTexture(icon);
    if (rig.iconMat.map !== map) {
      if (!rig.iconMat.map) rig.iconMat.needsUpdate = true;
      rig.iconMat.map = map;
    }
  }
}

/** The parts that move: blinking eyes, the head's tilt, the waving hand, and the drifting sign. */
function movePose(rig: Rig, p: Pose) {
  if (p.feeling !== rig.drawn) setFace(rig, p.feeling);
  const open = p.feeling === "surprised" ? 1.35 : 1;
  if (p.feeling !== "sleepy") for (const d of rig.dots) d.scale.y = p.blink ? 0.15 : open;
  rig.head.rotation.z = p.tilt;
  rig.hand.visible = p.wave > 0;
  if (p.wave) {
    const lean = p.wave === 1 ? 0.35 : 0.75;
    rig.hand.position.set(0.2 + Math.sin(lean) * 0.2, 0.42 + Math.cos(lean) * 0.2, 0.02);
  }
  rig.icon.position.y = rig.tagTop + SIGN_GAP + rig.iconSize / 2 + p.rise;
  rig.iconMat.opacity = p.fade;
}

/**
 * Show a reaction (or nothing: neutral) on a figure built by `figure()`. Sets the face straight
 * away, so it shows under reduced motion too, where nothing animates. True when it changed, so the
 * caller draws a frame.
 */
export function showFeeling(fig: Object3D, shown: Shown | undefined, now: number): boolean {
  const rig = rigs.get(fig);
  if (!rig || rig.shown === shown) return false;
  rig.shown = shown;
  movePose(rig, pose(shown, now, rig.phase, true, rig.pose));
  return true;
}

/**
 * Draw a figure's sign `size` units across (in the figure's own units), so it stays readable as the
 * camera pulls back (`signSize` in `layout.ts`). Only changes a scale, so it's cheap to call often.
 */
export function sizeSign(fig: Object3D, size: number) {
  const rig = rigs.get(fig);
  if (!rig || rig.iconSize === size) return;
  rig.iconSize = size;
  rig.icon.scale.setScalar(size);
  movePose(rig, rig.pose);
}

/** How high over a figure's feet (in its own units) the name tag, and the sign when shown, reach. */
export function overheadTop(fig: Object3D): number {
  const rig = rigs.get(fig);
  if (!rig) return 0;
  return rig.icon.visible ? rig.icon.position.y + rig.iconSize / 2 : rig.tagTop;
}

/** Turn a figure's head `yaw` radians from where its body faces, to look at someone. */
export function turnHead(fig: Object3D, yaw: number) {
  const rig = rigs.get(fig);
  if (rig) rig.head.rotation.y = yaw;
}

/**
 * A soft peg figure: a body in their color and shape, a round head with a nose and a face that
 * shows feelings, and their wear. It faces +z. `f.feeling` is one to hold (sleepy at the hearth);
 * reactions come and go through `showFeeling`.
 */
export function figure(stage: Stage, f: LayoutFigure, shadowMap: Texture): Group {
  const group = new Group();
  group.name = "figure";
  const body = new Group();
  // Like the map's figure: clothes in the outfit's main color, the head in their own.
  const bodyMat = new MeshLambertMaterial({
    color: lookPalette(f.look.theme, f.color).main,
    vertexColors: true,
  });
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
  const skin = new MeshLambertMaterial({ color: residentHex(f.color) });
  // A small nose, part of the head's mesh, so you can tell which way they face from above.
  const nose = new SphereGeometry(0.036, 10, 8).translate(0, -0.025, 0.16);
  const skull = new Mesh(mergeGeometries([new SphereGeometry(HEAD_R, 18, 12), nose]), skin);
  // Light eyes and mouth on a coal head, as on the map.
  const face = faceParts(f.color === "coal" ? BRAND.paper : BRAND.ink);
  face.head.add(skull);
  // A mitten that comes up to wave.
  const hand = new Mesh(new IcosahedronGeometry(0.05, 0), skin);
  hand.visible = false;
  body.add(torso, face.head, hand);
  if (f.kind === "agent") {
    // Agents wear a little sprout antenna with a sun bulb (the 2D map marks them with a gear).
    const stalk = new Mesh(
      new CylinderGeometry(0.012, 0.012, 0.16, 5),
      new MeshLambertMaterial({ color: BRAND.moss }),
    );
    stalk.position.y = 0.88 - HEAD_Y;
    const bulb = new Mesh(
      new SphereGeometry(0.04, 10, 8),
      new MeshLambertMaterial({ color: BRAND.sun, emissive: BRAND.sun, emissiveIntensity: 0.4 }),
    );
    bulb.position.y = 0.97 - HEAD_Y;
    face.head.add(stalk, bulb);
  }
  const wear = wearGroup(f);
  // Hats, glasses and bows turn with the head.
  for (const piece of wear.children.filter((o) => o.userData.onHead)) {
    piece.position.y -= HEAD_Y;
    face.head.add(piece);
  }
  body.add(wear);
  // The flat face parts are too thin to cast a shadow.
  body.traverse((o) => {
    if (o instanceof Mesh && !(o.material instanceof MeshBasicMaterial)) o.castShadow = true;
  });
  group.add(blobShadow(shadowMap, 0.3), body);

  // The name tag and the sign over it draw over everything, so a chimney or a wall never hides
  // them, the sign after the tag so the two never fight.
  const tag = nameTag(f.name, f.owner);
  const label = new Sprite(overheadMaterial(tag.texture));
  label.scale.set(TAG_SIZE * tag.aspect, TAG_SIZE, 1);
  label.position.y = tagHeight(f);
  label.renderOrder = OVERHEAD_ORDER.tag;
  group.add(label);

  // The feeling's sign floats over the name tag. Its texture is set when a feeling needs one.
  const iconMat = overheadMaterial();
  const icon = new Sprite(iconMat);
  icon.scale.setScalar(SIGN_SIZE);
  icon.renderOrder = OVERHEAD_ORDER.sign;
  icon.visible = false;
  const tagTop = tagHeight(f) + TAG_SIZE / 2;
  icon.position.y = tagTop + SIGN_GAP + SIGN_SIZE / 2;
  group.add(icon);

  group.scale.setScalar(FIGURE_SCALE);
  // The world view leans the body as it steps.
  group.userData.body = body;
  const phase = (tileHash(f.x * 7, f.y * 13) % 1000) / 160;
  const rig: Rig = {
    ...face,
    body,
    hand,
    icon,
    iconMat,
    tagTop,
    iconSize: SIGN_SIZE,
    phase: idPhase(f.id),
    shown: undefined,
    drawn: "neutral",
    pose: restingPose(),
  };
  rigs.set(group, rig);
  if (f.feeling)
    showFeeling(group, { feeling: f.feeling, at: 0, until: Number.POSITIVE_INFINITY }, 0);
  stage.animate(({ time }) => {
    const breathe = Math.sin(time * 2 + phase);
    const p = pose(rig.shown, performance.now(), rig.phase, false, rig.pose);
    body.position.y = Math.max(0, breathe) * 0.025 + p.lift;
    body.scale.set(1 + breathe * 0.012, 1 - breathe * 0.012, 1 + breathe * 0.012);
    body.rotation.z = Math.sin(time * 0.9 + phase) * 0.04;
    movePose(rig, p);
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
