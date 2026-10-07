/**
 * What a resident wears, on the 3D peg figures: one small low-poly piece per worn item, in the
 * color and pattern the 2D figure gives it (`wornPieces`). Sizes are in the figure's own units:
 * the body fills about y 0 to 0.55 with a radius near 0.25, and the head is a sphere of 0.17 at
 * y 0.66, facing +z.
 */
import { WEAR_INFO, type WearItem } from "@terrakin/sim";
import { BRAND_HEX, WOOD_DARK } from "@terrakin/ui/brand";
import { BAT_WING, HALLOWEEN_HEX, PatternCache } from "@terrakin/ui/looks";
import {
  BoxGeometry,
  type BufferGeometry,
  CircleGeometry,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  Group,
  type Material,
  Mesh,
  MeshLambertMaterial,
  OctahedronGeometry,
  RingGeometry,
  Shape,
  ShapeGeometry,
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

/** A carved pumpkin's face, lit from inside: the warm candle color, glowing day and night. */
const candle = () =>
  new MeshLambertMaterial({
    color: HALLOWEEN_HEX.lit,
    emissive: HALLOWEEN_HEX.lit,
    emissiveIntensity: 0.85,
    side: DoubleSide,
  });

/** The pumpkin head's middle lobe, which the face is carved into: its radii and where it sits. */
const PUMPKIN = { y: 0.66, rx: 0.165, ry: 0.19, rz: 0.205 };

/** A flat part laid on the pumpkin's front at (x, y), facing out. */
function onPumpkin(m: Mesh, x: number, y: number): Mesh {
  const { rx, ry, rz } = PUMPKIN;
  const dy = y - PUMPKIN.y;
  const z = rz * Math.sqrt(Math.max(0, 1 - (x / rx) ** 2 - (dy / ry) ** 2)) + 0.004;
  m.position.set(x, y, z);
  m.rotation.set(-Math.atan2(dy, z) * 0.6, Math.atan2(x, z), 0, "YXZ");
  return m;
}

/** A bat wing, spread from the back to `dir` (1 to the right, -1 to the left), swept back. */
function wing(mat: Material, dir: 1 | -1): Mesh {
  const shape = new Shape();
  BAT_WING.forEach(([x, y], i) => {
    if (i === 0) shape.moveTo(-x * dir, -y);
    else shape.lineTo(-x * dir, -y);
  });
  const m = new Mesh(new ShapeGeometry(shape), mat);
  m.position.set(0, 0, -0.16);
  m.rotation.y = dir * 0.45;
  return m;
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

    // Halloween's costumes (RFC 0022).
    case "witch_hat": {
      // A brim, a cone, and a tip that bends back over, banded in orange with a buckle in front.
      const tip = at(new ConeGeometry(0.036, 0.13, 10).translate(0, 0.065, 0), mat, 0, 1.03);
      tip.rotation.set(-0.95, 0, -0.3);
      return [
        at(new CylinderGeometry(0.29, 0.29, 0.02, 24), mat, 0, 0.79),
        at(new CylinderGeometry(0.038, 0.135, 0.24, 16), mat, 0, 0.91),
        tip,
        at(new CylinderGeometry(0.13, 0.134, 0.035, 16), solid(HALLOWEEN_HEX.witchBand), 0, 0.815),
        at(new BoxGeometry(0.05, 0.034, 0.012), solid(HALLOWEEN_HEX.buckle), 0, 0.815, 0.132),
      ];
    }
    case "cat_ears": {
      // A headband over the top of the head, and two pointed ears with pink insides.
      const band = at(new TorusGeometry(0.172, 0.011, 6, 20, Math.PI), mat, 0, 0.66);
      const pink = solid(HALLOWEEN_HEX.catInner);
      const ear = (x: number) => {
        const lean = -Math.sign(x) * 0.35;
        const outer = at(new ConeGeometry(0.058, 0.13, 4), mat, x, 0.83, -0.01);
        outer.rotation.set(0, Math.PI / 4, lean);
        const inner = at(new ConeGeometry(0.03, 0.08, 3), pink, x * 1.04, 0.815, 0.03);
        inner.rotation.z = lean;
        return [outer, inner];
      };
      return [band, ...ear(-0.1), ...ear(0.1)];
    }
    case "pumpkin_head": {
      // Three lobes round the head, a stem, and a face carved in and lit from inside.
      const { y, rx, ry, rz } = PUMPKIN;
      const lobe = (x: number, k: number) => {
        const m = at(new SphereGeometry(1, 18, 12), mat, x, y);
        m.scale.set(rx * k, ry * k, rz * k);
        return m;
      };
      const lit = candle();
      const eye = (x: number) => {
        const m = onPumpkin(new Mesh(new CircleGeometry(0.038, 3), lit), x, y + 0.035);
        m.rotateZ(Math.PI / 2);
        return m;
      };
      const grin = onPumpkin(
        new Mesh(new RingGeometry(0.03, 0.065, 10, 1, Math.PI * 1.08, Math.PI * 0.84), lit),
        0,
        y - 0.02,
      );
      return [
        lobe(-0.072, 0.93),
        lobe(0.072, 0.93),
        lobe(0, 1),
        eye(-0.06),
        eye(0.06),
        grin,
        at(new CylinderGeometry(0.017, 0.025, 0.08, 6), solid(HALLOWEEN_HEX.pumpkinStem), 0, 0.88),
      ];
    }
    case "ghost_sheet":
      // A sheet from the head to the ground. The head under it takes the sheet's color
      // (`figure` in figure.ts), and its face shows through.
      return [at(new CylinderGeometry(0.15, 0.33, 0.6, 24, 1, true), mat, 0, 0.3)];
    case "bat_wings": {
      if (mat instanceof MeshLambertMaterial) mat.side = DoubleSide;
      return [wing(mat, 1), wing(mat, -1)];
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
    case "umbrella": {
      // Held up over the head in the rain (`setUmbrella` in figure.ts), and otherwise rolled up and
      // carried like a walking stick, its hooked handle in the hand and its tip on the ground.
      const wood = solid("#5a4632");
      const open = [
        at(new CylinderGeometry(0.01, 0.01, 0.8, 6), wood, 0.26, 0.62),
        at(new ConeGeometry(0.34, 0.14, 16), mat, 0.26, 1.06),
      ];
      const stick = at(new CylinderGeometry(0.01, 0.01, 0.58, 6), wood, 0.31, 0.29, 0.04);
      const rolled = at(new ConeGeometry(0.045, 0.32, 10), mat, 0.31, 0.29, 0.04);
      rolled.rotation.x = Math.PI;
      const hook = at(new TorusGeometry(0.035, 0.009, 6, 12, Math.PI), wood, 0.275, 0.58, 0.04);
      for (const m of open) {
        m.userData.umbrella = "open";
        m.visible = false;
      }
      for (const m of [stick, rolled, hook]) m.userData.umbrella = "furled";
      return [...open, stick, rolled, hook];
    }
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
    const head = onHead(p.item);
    for (const mesh of piece(p.item, mat)) {
      mesh.castShadow = true;
      mesh.userData.onHead = head;
      group.add(mesh);
    }
  }
  return group;
}

/** Worn on the head, so it turns with it: hats, glasses, and the bow. */
export const onHead = (item: WearItem): boolean =>
  WEAR_INFO[item].slot === "hat" || item === "glasses" || item === "bow";
