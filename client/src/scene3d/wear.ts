/**
 * What a resident wears, on the 3D peg figures: one small low-poly piece per worn item, in the
 * color and pattern the 2D figure gives it (`wornPieces`). Sizes are in the figure's own units:
 * the body fills about y 0 to 0.55 with a radius near 0.25, and the head is a sphere of 0.17 at
 * y 0.66, facing +z.
 */
import type { WearItem } from "@terrakin/sim";
import { BRAND_HEX, WOOD_DARK } from "@terrakin/ui/brand";
import { PatternCache } from "@terrakin/ui/looks";
import {
  BoxGeometry,
  type BufferGeometry,
  ConeGeometry,
  CylinderGeometry,
  Group,
  type Material,
  Mesh,
  MeshLambertMaterial,
  OctahedronGeometry,
  SphereGeometry,
  TorusGeometry,
} from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { canvasTexture } from "./art";
import type { LayoutFigure } from "./layout";
import { type WornPiece, wornPieces } from "./layout";

const patterns = new PatternCache();
const TILE = 64;

/** A garment's material: its color, with its pattern printed on when it has one. */
function cloth(piece: WornPiece): Material {
  if (!piece.pattern) return new MeshLambertMaterial({ color: piece.color });
  const c = document.createElement("canvas");
  c.width = c.height = TILE;
  const ctx = c.getContext("2d") as CanvasRenderingContext2D;
  ctx.fillStyle = piece.color;
  ctx.fillRect(0, 0, TILE, TILE);
  const motif = patterns.named(ctx, piece.pattern, piece.palette, TILE / 2);
  if (motif) {
    ctx.fillStyle = motif;
    ctx.fillRect(0, 0, TILE, TILE);
  }
  const map = canvasTexture(c, true);
  map.repeat.set(2, 2);
  return new MeshLambertMaterial({ map });
}

const solid = (color: string | number) => new MeshLambertMaterial({ color });

/** Gold for the halo's studs (the brand's sun). */
const GOLD = BRAND_HEX.sun;

/** Make a garment glow softly in its own color, or its own pattern when it has one. */
function glow(mat: Material, amount: number): Material {
  if (!(mat instanceof MeshLambertMaterial)) return mat;
  if (mat.map) {
    mat.emissive.set("#ffffff");
    mat.emissiveMap = mat.map;
  } else {
    mat.emissive.copy(mat.color);
  }
  mat.emissiveIntensity = amount;
  return mat;
}

function at(geo: BufferGeometry, mat: Material, x: number, y: number, z = 0): Mesh {
  const m = new Mesh(geo, mat);
  m.position.set(x, y, z);
  return m;
}

/** An open tube around the body, from `y0` to `y1`, slightly wider than it. */
function band(mat: Material, y0: number, y1: number, top = 0.255, bottom = 0.26): Mesh {
  const geo = new CylinderGeometry(top, bottom, y1 - y0, 20, 1, true);
  const m = at(geo, mat, 0, (y0 + y1) / 2);
  return m;
}

/** A pair of feet, toes peeking out in front of the body. */
function feet(make: () => Mesh, y: number): Mesh[] {
  return [-0.09, 0.09].map((x) => {
    const m = make();
    m.position.set(x, y, 0.21);
    return m;
  });
}

/** The meshes for one worn item. */
function piece(item: WearItem, mat: Material): Mesh[] {
  switch (item) {
    // ---------- hats ----------
    case "straw_hat":
      return [
        at(new CylinderGeometry(0.27, 0.27, 0.02, 24), mat, 0, 0.79),
        at(new CylinderGeometry(0.11, 0.13, 0.11, 18), mat, 0, 0.85),
        at(new CylinderGeometry(0.132, 0.132, 0.03, 18), solid("#c95a3a"), 0, 0.81),
      ];
    case "beret": {
      const m = at(new SphereGeometry(0.17, 18, 10), mat, 0.03, 0.8);
      m.scale.set(1.05, 0.35, 1.05);
      m.rotation.z = -0.25;
      return [m];
    }
    case "beanie":
      return [
        at(new SphereGeometry(0.178, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2), mat, 0, 0.69),
        at(new CylinderGeometry(0.18, 0.18, 0.05, 18), mat, 0, 0.7),
        at(new SphereGeometry(0.045, 10, 8), mat, 0, 0.88),
      ];
    case "top_hat":
      return [
        at(new CylinderGeometry(0.21, 0.21, 0.02, 24), mat, 0, 0.79),
        at(new CylinderGeometry(0.12, 0.12, 0.24, 18), mat, 0, 0.91),
      ];
    case "flower_crown": {
      const ring = at(new TorusGeometry(0.15, 0.022, 8, 24), mat, 0, 0.78);
      ring.rotation.x = Math.PI / 2;
      const petals = [0, 1, 2, 3, 4, 5].map((i) => {
        const a = (i / 6) * Math.PI * 2;
        return at(new SphereGeometry(0.04, 8, 6), mat, Math.cos(a) * 0.15, 0.8, Math.sin(a) * 0.15);
      });
      return [ring, ...petals];
    }
    case "muse_halo": {
      const lit = glow(mat, 0.35);
      const ring = at(new TorusGeometry(0.14, 0.035, 8, 24), lit, 0, 0.9);
      ring.rotation.x = Math.PI / 2;
      const gold = new MeshLambertMaterial({ color: GOLD, emissive: GOLD, emissiveIntensity: 0.3 });
      const stud = new OctahedronGeometry(0.045);
      const studs = [0.25, 0.5, 0.75].map((t) => {
        const a = t * Math.PI;
        const m = at(stud, gold, Math.cos(a) * 0.14, 0.93, Math.sin(a) * 0.14);
        m.scale.set(0.7, 1, 0.7);
        return m;
      });
      return [ring, ...studs];
    }

    // ---------- tops ----------
    case "apron":
      return [at(new BoxGeometry(0.28, 0.32, 0.02), mat, 0, 0.27, 0.235)];
    case "scarf": {
      const ring = at(new TorusGeometry(0.14, 0.045, 10, 24), mat, 0, 0.53);
      ring.rotation.x = Math.PI / 2;
      const tail = at(new BoxGeometry(0.07, 0.18, 0.03), mat, 0.07, 0.42, 0.2);
      tail.rotation.z = 0.15;
      return [ring, tail];
    }
    case "cardigan":
      return [band(mat, 0.14, 0.5, 0.21, 0.27)];
    case "overalls":
      return [band(mat, 0.04, 0.26), at(new BoxGeometry(0.2, 0.16, 0.02), mat, 0, 0.34, 0.23)];
    case "raincoat":
      return [band(mat, 0.02, 0.52, 0.2, 0.3)];
    case "dress":
      return [at(new CylinderGeometry(0.2, 0.33, 0.46, 24, 1, true), mat, 0, 0.23)];

    // ---------- bottoms ----------
    case "skirt":
      return [at(new CylinderGeometry(0.25, 0.33, 0.18, 24, 1, true), mat, 0, 0.1)];
    case "trousers":
      return [band(mat, 0.0, 0.22)];
    case "shorts":
      return [band(mat, 0.08, 0.2)];

    // ---------- feet ----------
    case "socks":
      return feet(() => new Mesh(new SphereGeometry(0.06, 10, 8), mat), 0.04);
    case "boots":
      return feet(() => new Mesh(new RoundedBoxGeometry(0.1, 0.12, 0.15, 2, 0.03), mat), 0.06);
    case "sneakers":
      return feet(() => {
        const shoe = new Mesh(new RoundedBoxGeometry(0.09, 0.06, 0.16, 2, 0.025), mat);
        shoe.add(at(new BoxGeometry(0.095, 0.015, 0.165), solid("#f4efe4"), 0, -0.03));
        return shoe;
      }, 0.035);

    // ---------- things they carry or wear ----------
    case "glasses": {
      const lens = (x: number) => at(new TorusGeometry(0.035, 0.008, 6, 16), mat, x, 0.68, 0.165);
      return [
        lens(-0.06),
        lens(0.06),
        at(new BoxGeometry(0.05, 0.008, 0.008), mat, 0, 0.685, 0.17),
      ];
    }
    case "bow": {
      const loop = (x: number) => {
        const m = at(new ConeGeometry(0.05, 0.08, 10), mat, x, 0.8, 0);
        m.rotation.z = x > 0 ? Math.PI / 2 : -Math.PI / 2;
        return m;
      };
      return [loop(0.17), loop(0.07), at(new SphereGeometry(0.025, 8, 6), mat, 0.12, 0.8)];
    }
    case "satchel": {
      const strap = at(new TorusGeometry(0.27, 0.012, 6, 32), mat, 0, 0.32);
      strap.rotation.z = 0.6;
      strap.scale.set(1, 1, 0.75);
      return [at(new RoundedBoxGeometry(0.06, 0.12, 0.14, 2, 0.02), mat, 0.28, 0.18), strap];
    }
    case "basket": {
      const handle = at(new TorusGeometry(0.06, 0.01, 6, 16, Math.PI), mat, 0.31, 0.27);
      return [at(new CylinderGeometry(0.08, 0.06, 0.08, 14), mat, 0.31, 0.22), handle];
    }
    case "umbrella":
      return [
        at(new CylinderGeometry(0.01, 0.01, 0.8, 6), solid("#5a4632"), 0.26, 0.62),
        at(new ConeGeometry(0.34, 0.14, 16), mat, 0.26, 1.06),
      ];
    case "muse_lantern": {
      const wood = solid(WOOD_DARK);
      const stick = at(new CylinderGeometry(0.009, 0.009, 0.22, 6), wood, 0.34, 0.34, 0.06);
      stick.rotation.z = -0.7;
      const paper = at(new SphereGeometry(0.07, 12, 8), glow(mat, 0.45), 0.41, 0.33, 0.06);
      paper.scale.set(1, 1.1, 1);
      const cap = (y: number) =>
        at(new CylinderGeometry(0.035, 0.035, 0.02, 10), wood, 0.41, y, 0.06);
      return [stick, paper, cap(0.41), cap(0.25)];
    }
  }
}

/** Everything a figure wears, as one group to add to its body. */
export function wearGroup(f: Pick<LayoutFigure, "look">): Group {
  const group = new Group();
  group.name = "wear";
  for (const p of wornPieces(f.look)) {
    const mat = cloth(p);
    for (const mesh of piece(p.item, mat)) {
      mesh.castShadow = true;
      group.add(mesh);
    }
  }
  return group;
}
