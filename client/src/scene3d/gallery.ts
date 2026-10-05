/**
 * The 3D gallery: a little storybook room, open on two sides like a dollhouse, with paintings on
 * the walls, jam jars on pedestals, and a potted lemon tree. It shows off the art direction, and
 * `?item=` admires one item up close on a soft ground disc.
 */

import { isDecorKind } from "@terrakin/sim";
import { isModelResource } from "@terrakin/ui/format";
import {
  BufferAttribute,
  CircleGeometry,
  Group,
  LoadingManager,
  Mesh,
  MeshLambertMaterial,
  SRGBColorSpace,
  type Texture,
  TextureLoader,
  Vector3,
} from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { bakeShade, grainTexture, lin, noShade, paper, plankTexture, type Stage } from "./art";
import { type GalleryRequest, jamFlavor } from "./catalog";
import { decorInstances, decorModel } from "./decor";
import {
  jamJar,
  landscapeTexture,
  lemonTree,
  PEDESTAL_TOP,
  painting,
  pedestal,
  pottedShrub,
} from "./items";
import { BRAND, blockLook, FLAVORS, hex, mix, SKY } from "./palette";

export interface GalleryOptions {
  onNote?(text: string): void;
}

export async function buildGallery(stage: Stage, req: GalleryRequest, opts: GalleryOptions = {}) {
  const grain = stage.keep(grainTexture());
  let picture: Texture | undefined;
  let aspect = 4 / 3;
  if (req.media) {
    try {
      const manager = new LoadingManager();
      manager.setURLModifier((u) => (isModelResource(u, location.origin) ? u : "data:,"));
      picture = stage.keep(await new TextureLoader(manager).loadAsync(req.media));
      picture.colorSpace = SRGBColorSpace;
      const img = picture.image as { width?: number; height?: number };
      aspect = (img.width ?? 4) / Math.max(1, img.height ?? 3);
    } catch {
      opts.onNote?.("That picture couldn't be loaded, so here's one of ours.");
    }
  }
  if (req.item) return admire(stage, req, grain, picture, aspect);
  return room(stage, grain, picture, aspect);
}

// ---------- the room ----------

function room(stage: Stage, grain: Texture, picture: Texture | undefined, aspect: number) {
  const root = new Group();
  stage.scene.add(root);
  const W = 8;
  const D = 6;
  const H = 3.2;

  // Floor: warm planks on a thick base, so the room reads as a diorama.
  const planks = stage.keep(plankTexture());
  planks.repeat.set(4, 6);
  const floor = new Mesh(
    bakeShade(new RoundedBoxGeometry(W, 0.3, D, 2, 0.06), 0.6, 1),
    paper(hex("#d6b48a"), planks),
  );
  floor.position.y = -0.15;
  floor.receiveShadow = true;
  root.add(floor);

  // A round rug in brand colors.
  const rug = new Mesh(
    new CircleGeometry(1.9, 40),
    new MeshLambertMaterial({ color: mix(BRAND.clay, BRAND.paper, 0.25), map: grain }),
  );
  rug.rotation.x = -Math.PI / 2;
  rug.scale.set(1.35, 0.8, 1);
  rug.position.set(0.2, 0.006, 0.5);
  rug.receiveShadow = true;
  const rugInner = new Mesh(
    new CircleGeometry(1.65, 40),
    new MeshLambertMaterial({ color: hex("#f4d48a"), map: grain }),
  );
  rugInner.rotation.x = -Math.PI / 2;
  rugInner.scale.set(1.35, 0.8, 1);
  rugInner.position.set(0.2, 0.01, 0.5);
  rugInner.receiveShadow = true;
  root.add(rug, rugInner);

  // Walls: paper above a soft sage wainscot, with a wooden rail between.
  const wallMat = paper(hex("#fcefd8"), grain, {
    emissive: hex("#fff4e0"),
    emissiveIntensity: 0.12,
  });
  const wainMat = paper(hex("#b9cf9a"), grain);
  const railMat = paper(hex("#a77a52"), grain);
  const wall = (w: number, x: number, z: number, turn: number) => {
    const g = new Group();
    const upper = new Mesh(
      bakeShade(new RoundedBoxGeometry(w, H - 1, 0.2, 2, 0.04), 0.9, 1),
      wallMat,
    );
    upper.position.y = 1 + (H - 1) / 2;
    const lower = new Mesh(
      bakeShade(new RoundedBoxGeometry(w, 1, 0.24, 2, 0.04), 0.66, 1),
      wainMat,
    );
    lower.position.y = 0.5;
    const rail = new Mesh(noShade(new RoundedBoxGeometry(w, 0.08, 0.3, 2, 0.03)), railMat);
    rail.position.y = 1.02;
    const top = new Mesh(noShade(new RoundedBoxGeometry(w, 0.1, 0.28, 2, 0.03)), railMat);
    top.position.y = H;
    for (const m of [upper, lower, rail, top]) {
      m.castShadow = true;
      m.receiveShadow = true;
    }
    g.add(upper, lower, rail, top);
    g.position.set(x, 0, z);
    g.rotation.y = turn;
    root.add(g);
  };
  wall(W, 0, -D / 2 - 0.1, 0);
  wall(D + 0.2, -W / 2 - 0.1, 0.1 - 0.1, Math.PI / 2);

  // Paintings: three on the back wall, one on the side wall. Yours hangs in the middle.
  const hang = (
    pic: Texture,
    a: number,
    h: number,
    x: number,
    y: number,
    z: number,
    turn: number,
  ) => {
    const p = painting(pic, a, h);
    p.position.set(x, y, z);
    p.rotation.y = turn;
    root.add(p);
  };
  const backZ = -D / 2 + 0.02;
  hang(stage.keep(landscapeTexture("meadow")), 4 / 3, 0.9, -2.4, 2.05, backZ, 0);
  hang(
    picture ?? stage.keep(landscapeTexture("lemons")),
    picture ? aspect : 4 / 3,
    1.15,
    0.2,
    2.1,
    backZ,
    0,
  );
  hang(stage.keep(landscapeTexture("sea")), 0.8, 1.05, 2.6, 2.1, backZ, 0);
  hang(stage.keep(landscapeTexture("dusk")), 4 / 3, 0.95, -W / 2 + 0.02, 2.05, -0.6, Math.PI / 2);

  // Jam on pedestals, one of each flavor.
  FLAVORS.forEach((flavor, i) => {
    const x = -2.1 + i * 1.4;
    const z = 0.6;
    const p = pedestal(grain);
    p.position.set(x, 0, z);
    const jar = jamJar(flavor);
    jar.position.set(x, PEDESTAL_TOP, z);
    jar.rotation.y = 0.35;
    jar.scale.setScalar(1.35);
    root.add(p, jar);
  });

  const tree = lemonTree(stage, grain);
  tree.position.set(-3.1, 0, -2.1);
  tree.scale.setScalar(1.25);
  const shrub = pottedShrub(stage, grain);
  shrub.position.set(3.3, 0, -2.4);
  root.add(tree, shrub);

  stage.light(new Vector3(0, 0, 0), 5.2);
  stage.sun.position.set(5, 8.5, 6.5);
  stage.frame(new Vector3(0, 1.1, 0), 4.1, new Vector3(0.75, 0.55, 1));
  // Stay on the open sides, like looking into a dollhouse.
  stage.controls.minAzimuthAngle = -0.25;
  stage.controls.maxAzimuthAngle = Math.PI / 2 + 0.25;
  return root;
}

// ---------- one item, up close ----------

function admire(
  stage: Stage,
  req: GalleryRequest,
  grain: Texture,
  picture: Texture | undefined,
  aspect: number,
) {
  const root = new Group();
  stage.scene.add(root);
  root.add(groundDisc(3.2));
  const item = req.item ?? "jam-lemon";
  const flavor = jamFlavor(item);
  let top = PEDESTAL_TOP;
  let radius = 1.1;
  if (item === "lemon-tree") {
    const tree = lemonTree(stage, grain);
    root.add(tree);
    top = 1.6;
    radius = 1.05;
  } else if (isDecorKind(item)) {
    // Decor stands on the ground, as it does on a plot. A fence is a short run, so its rails show.
    if (item === "fence") {
      const run = [-1, 0, 1].map((x) => ({
        x,
        z: 0,
        tint: 0xffffff,
        joins: { n: false, s: false, e: x < 1, w: x > -1 },
      }));
      root.add(...decorInstances(stage, item, grain, run));
      radius = 1.35;
    } else {
      root.add(decorModel(stage, item, grain));
      radius = item === "bench" ? 0.85 : 0.95;
    }
    top = blockLook(item).height;
  } else if (item === "painting") {
    const pic = picture ?? stage.keep(landscapeTexture("meadow"));
    const p = painting(pic, picture ? aspect : 4 / 3, 1);
    p.position.set(0, 1.06, 0.12);
    p.rotation.x = -0.1;
    root.add(p, easel());
    top = 1.8;
    radius = 1.15;
  } else {
    const p = pedestal(grain);
    root.add(p);
    if (flavor) {
      const jar = jamJar(flavor);
      jar.position.y = PEDESTAL_TOP;
      jar.rotation.y = 0.35;
      root.add(jar);
      top = PEDESTAL_TOP + 0.5;
    }
  }
  stage.light(new Vector3(0, 0, 0), 2.4);
  if (flavor) stage.frame(new Vector3(0, PEDESTAL_TOP + 0.2, 0), 0.55, new Vector3(0.5, 0.45, 1));
  else stage.frame(new Vector3(0, top / 2, 0), radius, new Vector3(0.55, 0.4, 1));
  return root;
}

/** A soft round of paper ground that fades into the sky at its edge. */
function groundDisc(radius: number): Mesh {
  const geo = new CircleGeometry(radius, 48, 0, Math.PI * 2);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.getAttribute("position");
  const colors = new Float32Array(pos.count * 4);
  const center = lin(hex("#efe2c6"));
  const edge = lin(SKY.fog);
  for (let i = 0; i < pos.count; i++) {
    const t = Math.hypot(pos.getX(i), pos.getZ(i)) / radius;
    const c = center.clone().lerp(edge, t);
    colors.set([c.r, c.g, c.b, 1 - t * t], i * 4);
  }
  geo.setAttribute("color", new BufferAttribute(colors, 4));
  const m = new Mesh(geo, new MeshLambertMaterial({ vertexColors: true, transparent: true }));
  m.receiveShadow = true;
  m.renderOrder = -1;
  return m;
}

/** A wooden easel for a painting admired on its own. */
function easel(): Group {
  const g = new Group();
  const wood = new MeshLambertMaterial({ color: hex("#a77a52"), vertexColors: true });
  const leg = (x: number, z: number, tiltX: number, tiltZ: number) => {
    const m = new Mesh(bakeShade(new RoundedBoxGeometry(0.06, 1.9, 0.06, 1, 0.02), 0.7, 1), wood);
    m.position.set(x, 0.92, z);
    m.rotation.set(tiltX, 0, tiltZ);
    m.castShadow = true;
    g.add(m);
  };
  leg(-0.42, 0.05, -0.12, -0.08);
  leg(0.42, 0.05, -0.12, 0.08);
  leg(0, -0.42, 0.28, 0);
  const shelf = new Mesh(bakeShade(new RoundedBoxGeometry(1.1, 0.06, 0.16, 1, 0.02), 0.8, 1), wood);
  shelf.position.set(0, 0.52, 0.16);
  shelf.castShadow = true;
  g.add(shelf);
  return g;
}
