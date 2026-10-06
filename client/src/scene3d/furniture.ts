/**
 * Furniture from the workbench in 3D (RFC 0016): a table, a chair, a bookshelf of colored books, a
 * hooped barrel, a signpost, a lamp post that glows, a stone well with a roof, a low stone wall that
 * runs on to the walls beside it, a campfire, and a flower box. Each model is a few merged,
 * shade-baked parts, placed with decor's `placeParts`, so a plot full of chairs is one instanced draw
 * per part (decision 0030). Glows are an emissive shade and a soft pool of light on the ground,
 * never a light of their own, like the shop's lantern (decision 0060).
 */
import { BLOCK_COLORS, type FurnitureKind } from "@terrakin/sim";
import { WOOD_DARK as WOOD_BRAND } from "@terrakin/ui/brand";
import {
  AdditiveBlending,
  BufferAttribute,
  type BufferGeometry,
  ConeGeometry,
  CylinderGeometry,
  DodecahedronGeometry,
  IcosahedronGeometry,
  LatheGeometry,
  MeshBasicMaterial,
  MeshLambertMaterial,
  type Object3D,
  PlaneGeometry,
  type Texture,
  TorusGeometry,
  Vector2,
} from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { lin, paper, type Stage, spotTexture, unindexed } from "./art";
import { box, type DecorPlace, merged, type Part, placeParts } from "./decor";
import { BRAND, hex } from "./palette";

const WOOD_DARK = hex(WOOD_BRAND);
const IRON = hex("#5d5a55");
const STONE = hex(BLOCK_COLORS.stone_wall);
const STONE_CAP = hex("#c4beb2");

/** A shape in one color, its shade baked from bottom to top, for merging into a many-colored part. */
function colored(geometry: BufferGeometry, color: number, bottom = 0.72): BufferGeometry {
  const g = unindexed(geometry);
  g.computeBoundingBox();
  const pos = g.getAttribute("position");
  const y0 = g.boundingBox?.min.y ?? 0;
  const span = Math.max(1e-6, (g.boundingBox?.max.y ?? 1) - y0);
  const c = lin(color);
  const colors = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const k = bottom + (1 - bottom) * Math.sqrt((pos.getY(i) - y0) / span);
    colors.set([c.r * k, c.g * k, c.b * k], i * 3);
  }
  g.setAttribute("color", new BufferAttribute(colors, 3));
  return g;
}

/** Many-colored pieces as one part, in one draw. */
function mixedPart(pieces: BufferGeometry[], grain: Texture, cast = true): Part {
  const geometry = mergeGeometries(pieces);
  for (const p of pieces) p.dispose();
  return { geometry, material: paper(0xffffff, grain), cast };
}

/** A warm glow: an emissive shade that flickers a little, and a pool of light on the ground. */
function glow(stage: Stage, color: number, at: [number, number], size: number): Part {
  const pool = new PlaneGeometry(size, size);
  pool.rotateX(-Math.PI / 2);
  pool.translate(at[0], 0.02, at[1]);
  return {
    geometry: pool,
    material: new MeshBasicMaterial({
      map: stage.keep(spotTexture("255, 186, 92")),
      color,
      transparent: true,
      opacity: 0.5,
      depthWrite: false,
      blending: AdditiveBlending,
    }),
    cast: false,
    renderOrder: 1,
  };
}

/** A material that glows warm and flickers, stopping with the rest when motion is reduced. */
function flicker(stage: Stage, color: number, grain: Texture, base = 0.65): MeshLambertMaterial {
  const m = new MeshLambertMaterial({
    color,
    emissive: color,
    emissiveIntensity: base,
    map: grain,
    flatShading: true,
  });
  stage.animate(({ time }) => {
    m.emissiveIntensity = base + Math.sin(time * 2.7) * 0.06 + Math.sin(time * 6.3) * 0.04;
  });
  return m;
}

// ---------- the models ----------

function tableParts(grain: Texture): Part[] {
  const legs = [-0.38, 0.38].flatMap((x) =>
    [-0.27, 0.27].map((z) => box(0.08, 0.72, 0.08, [x, 0.36, z], [0, 0, 0], 0.02)),
  );
  return [
    {
      geometry: merged([box(0.94, 0.08, 0.74, [0, 0.76, 0], [0, 0, 0], 0.03), ...legs], 0.75),
      material: paper(hex(BLOCK_COLORS.table), grain),
      cast: true,
    },
  ];
}

function chairParts(grain: Texture): Part[] {
  const legs = [-0.2, 0.2].flatMap((x) =>
    [-0.17, 0.22].map((z) => box(0.06, 0.46, 0.06, [x, 0.23, z], [0, 0, 0], 0.02)),
  );
  return [
    {
      geometry: merged(
        [
          box(0.5, 0.07, 0.5, [0, 0.47, 0.03], [0, 0, 0], 0.02),
          box(0.06, 0.62, 0.06, [-0.22, 0.78, -0.19], [0, 0, 0], 0.02),
          box(0.06, 0.62, 0.06, [0.22, 0.78, -0.19], [0, 0, 0], 0.02),
          box(0.5, 0.12, 0.05, [0, 1.0, -0.19], [0, 0, 0], 0.02),
          box(0.5, 0.07, 0.05, [0, 0.78, -0.19], [0, 0, 0], 0.02),
          ...legs,
        ],
        0.75,
      ),
      material: paper(hex(BLOCK_COLORS.chair), grain),
      cast: true,
    },
  ];
}

const BOOKS = [BRAND.clay, hex("#7cb9dd"), BRAND.sun, BRAND.moss, hex("#a98bd8"), BRAND.paper];

function bookshelfParts(grain: Texture): Part[] {
  const frame = merged(
    [
      box(0.92, 1.5, 0.05, [0, 0.75, -0.17], [0, 0, 0], 0.02),
      box(0.06, 1.5, 0.4, [-0.43, 0.75, 0], [0, 0, 0], 0.02),
      box(0.06, 1.5, 0.4, [0.43, 0.75, 0], [0, 0, 0], 0.02),
      ...[0.03, 0.52, 1.0, 1.48].map((y) => box(0.92, 0.05, 0.4, [0, y, 0], [0, 0, 0], 0.015)),
    ],
    0.7,
  );
  const books: BufferGeometry[] = [];
  [0.06, 0.55, 1.03].forEach((shelf, row) => {
    let x = -0.37;
    let i = row * 2;
    while (x < 0.33) {
      const w = 0.07 + ((i * 7) % 4) * 0.015;
      const tall = 0.3 + ((i * 5) % 3) * 0.05;
      books.push(
        colored(
          box(w, tall, 0.26, [x + w / 2, shelf + tall / 2, 0.02], [0, 0, 0], 0.01),
          BOOKS[i % BOOKS.length] as number,
        ),
      );
      x += w + 0.012;
      i++;
    }
  });
  return [
    { geometry: frame, material: paper(hex(BLOCK_COLORS.bookshelf), grain), cast: true },
    mixedPart(books, grain),
  ];
}

function barrelParts(grain: Texture): Part[] {
  const profile = [
    [0.001, 0],
    [0.27, 0],
    [0.32, 0.2],
    [0.34, 0.41],
    [0.32, 0.62],
    [0.27, 0.82],
    [0.001, 0.82],
  ].map(([x, y]) => new Vector2(x, y));
  const body = new LatheGeometry(profile, 12);
  const hoops = [0.2, 0.62].map((y) => {
    const t = new TorusGeometry(0.33, 0.022, 4, 16);
    t.rotateX(Math.PI / 2);
    t.translate(0, y, 0);
    return t.toNonIndexed();
  });
  return [
    {
      geometry: merged([body.toNonIndexed()], 0.7),
      material: paper(hex(BLOCK_COLORS.barrel), grain),
      cast: true,
    },
    { geometry: merged(hoops, 0.9), material: paper(IRON, grain), cast: true },
  ];
}

function signpostParts(grain: Texture): Part[] {
  const board = (y: number, turn: number, flip: number) => {
    const plank = box(0.56, 0.15, 0.05, [0.2 * flip, 0, 0], [0, 0, 0], 0.02);
    const tip = new CylinderGeometry(0.105, 0.105, 0.05, 3);
    tip.rotateX(Math.PI / 2);
    tip.rotateZ(flip > 0 ? -Math.PI / 2 : Math.PI / 2);
    tip.translate(0.5 * flip, 0, 0);
    const g = mergeGeometries([unindexed(plank), tip.toNonIndexed()]);
    plank.dispose();
    tip.dispose();
    g.rotateY(turn);
    g.translate(0, y, 0.06);
    return g;
  };
  return [
    {
      geometry: merged([box(0.09, 1.32, 0.09, [0, 0.66, 0], [0, 0, 0], 0.02)], 0.7),
      material: paper(WOOD_DARK, grain),
      cast: true,
    },
    {
      geometry: merged([board(1.14, 0.25, 1), board(0.86, -0.35, -1)], 0.85),
      material: paper(hex(BLOCK_COLORS.signpost), grain),
      cast: true,
    },
  ];
}

function lampPostParts(stage: Stage, grain: Texture): Part[] {
  const post = new CylinderGeometry(0.04, 0.055, 1.5, 6);
  post.translate(0, 0.79, 0);
  const cap = new ConeGeometry(0.17, 0.14, 4);
  cap.rotateY(Math.PI / 4);
  cap.translate(0, 1.84, 0);
  const lamp = new CylinderGeometry(0.1, 0.075, 0.24, 6);
  lamp.translate(0, 1.66, 0);
  return [
    {
      geometry: merged([
        box(0.26, 0.08, 0.26, [0, 0.04, 0], [0, 0, 0], 0.02),
        post.toNonIndexed(),
        cap.toNonIndexed(),
        box(0.24, 0.04, 0.24, [0, 1.53, 0], [0, 0, 0], 0.01),
      ]),
      material: paper(hex(BLOCK_COLORS.lamp_post), grain),
      cast: true,
    },
    {
      geometry: merged([lamp.toNonIndexed()], 1),
      material: flicker(stage, hex("#f9d27a"), grain, 0.7),
      cast: false,
    },
    glow(stage, 0xffffff, [0, 0.15], 2),
  ];
}

function wellParts(grain: Texture): Part[] {
  const ring = new CylinderGeometry(0.43, 0.46, 0.56, 12);
  ring.translate(0, 0.28, 0);
  const rim = new TorusGeometry(0.43, 0.05, 4, 12);
  rim.rotateX(Math.PI / 2);
  rim.translate(0, 0.56, 0);
  const water = new CylinderGeometry(0.36, 0.36, 0.02, 12);
  water.translate(0, 0.55, 0);
  const roof = new ConeGeometry(0.66, 0.4, 4);
  roof.rotateY(Math.PI / 4);
  roof.translate(0, 1.52, 0);
  const bucket = new CylinderGeometry(0.08, 0.065, 0.13, 8);
  bucket.translate(0, 0.98, 0);
  return [
    {
      geometry: merged([ring.toNonIndexed(), rim.toNonIndexed()], 0.65),
      material: paper(hex(BLOCK_COLORS.well), grain),
      cast: true,
    },
    {
      geometry: merged(
        [
          box(0.07, 1.05, 0.07, [-0.38, 0.86, 0], [0, 0, 0], 0.02),
          box(0.07, 1.05, 0.07, [0.38, 0.86, 0], [0, 0, 0], 0.02),
          box(0.84, 0.05, 0.05, [0, 1.2, 0], [0, 0, 0], 0.015),
          bucket.toNonIndexed(),
        ],
        0.75,
      ),
      material: paper(WOOD_DARK, grain),
      cast: true,
    },
    {
      geometry: merged([roof.toNonIndexed()], 0.8),
      material: paper(BRAND.clay, grain),
      cast: true,
    },
    {
      geometry: merged([water.toNonIndexed()], 1),
      material: paper(hex("#3f5f6f"), null),
      cast: false,
    },
  ];
}

function stoneWallParts(grain: Texture): Part[] {
  const wall = (w: number, x: number) => [
    box(w, 0.5, 0.36, [x, 0.25, 0], [0, 0, 0], 0.04),
    box(w + 0.02, 0.08, 0.42, [x, 0.53, 0], [0, 0, 0], 0.03),
  ];
  return [
    { geometry: merged(wall(0.5, 0), 0.7), material: paper(STONE, grain), cast: true },
    // One stretch from the middle out to the tile's east edge; it turns to face each joined side.
    {
      geometry: merged(wall(0.5, 0.25), 0.7),
      material: paper(STONE, grain),
      cast: true,
      rail: true,
    },
    {
      geometry: merged([box(0.52, 0.03, 0.44, [0, 0.58, 0], [0, 0, 0], 0.01)], 1),
      material: paper(STONE_CAP, grain),
      cast: false,
    },
  ];
}

function campfireParts(stage: Stage, grain: Texture): Part[] {
  const stones: BufferGeometry[] = [];
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2;
    const s = new DodecahedronGeometry(0.09, 0);
    s.scale(1.2, 0.75, 1);
    s.translate(Math.cos(a) * 0.3, 0.06, Math.sin(a) * 0.3);
    stones.push(s.toNonIndexed());
  }
  const logs = [0.6, -0.6].map((turn, i) => {
    const log = new CylinderGeometry(0.045, 0.05, 0.56, 6);
    log.rotateZ(Math.PI / 2);
    log.rotateY(turn);
    log.translate(0, 0.07 + i * 0.05, 0);
    return log.toNonIndexed();
  });
  const outer = new ConeGeometry(0.16, 0.44, 7);
  outer.translate(0, 0.32, 0);
  const inner = new ConeGeometry(0.09, 0.28, 6);
  inner.translate(0, 0.26, 0.03);
  return [
    { geometry: merged(stones, 0.75), material: paper(hex(BLOCK_COLORS.stone), grain), cast: true },
    { geometry: merged(logs, 0.8), material: paper(WOOD_DARK, grain), cast: true },
    {
      geometry: merged([outer.toNonIndexed()], 1),
      material: flicker(stage, hex(BLOCK_COLORS.campfire), grain, 0.75),
      cast: false,
    },
    {
      geometry: merged([inner.toNonIndexed()], 1),
      material: flicker(stage, BRAND.sun, grain, 0.9),
      cast: false,
    },
    glow(stage, 0xffffff, [0, 0], 2.2),
  ];
}

const FLOWERS = [hex("#e58fb6"), BRAND.sun, BRAND.paper, hex("#a98bd8")];

function flowerBoxParts(grain: Texture): Part[] {
  const plants: BufferGeometry[] = [];
  for (let i = 0; i < 6; i++) {
    const x = -0.3 + i * 0.12;
    const z = i % 2 ? 0.06 : -0.05;
    const leafy = new IcosahedronGeometry(0.07, 0);
    leafy.scale(1, 0.7, 1);
    leafy.translate(x, 0.4, z);
    plants.push(colored(leafy, BRAND.moss));
    const head = new IcosahedronGeometry(0.055, 0);
    head.translate(x + 0.02, 0.5 + (i % 3) * 0.03, z);
    plants.push(colored(head, FLOWERS[i % FLOWERS.length] as number, 0.95));
  }
  return [
    {
      geometry: merged([box(0.86, 0.3, 0.42, [0, 0.15, 0], [0, 0, 0], 0.03)], 0.7),
      material: paper(hex(BLOCK_COLORS.flower_box), grain),
      cast: true,
    },
    {
      geometry: merged([box(0.78, 0.04, 0.34, [0, 0.31, 0], [0, 0, 0], 0.01)], 1),
      material: paper(hex("#6a4a33"), null),
      cast: false,
    },
    mixedPart(plants, grain),
  ];
}

function partsOf(stage: Stage, kind: FurnitureKind, grain: Texture): Part[] {
  switch (kind) {
    case "table":
      return tableParts(grain);
    case "chair":
      return chairParts(grain);
    case "bookshelf":
      return bookshelfParts(grain);
    case "barrel":
      return barrelParts(grain);
    case "signpost":
      return signpostParts(grain);
    case "lamp_post":
      return lampPostParts(stage, grain);
    case "well":
      return wellParts(grain);
    case "stone_wall":
      return stoneWallParts(grain);
    case "campfire":
      return campfireParts(stage, grain);
    case "flower_box":
      return flowerBoxParts(grain);
  }
}

/**
 * Every piece of one kind of furniture as instanced meshes: one draw per part. A low stone wall's
 * stretches go out once per side that joins another wall.
 */
export function furnitureInstances(
  stage: Stage,
  kind: FurnitureKind,
  grain: Texture,
  places: readonly DecorPlace[],
): Object3D[] {
  if (places.length === 0) return [];
  return placeParts(partsOf(stage, kind, grain), places);
}
