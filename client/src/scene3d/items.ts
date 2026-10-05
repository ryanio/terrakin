/**
 * Procedural item models for "Admire in 3D": a jam jar for each flavor, a framed painting, a
 * pedestal, and a potted lemon tree. Ready for RFC 0005 crafting, where an inventory item names a
 * template and a flavor. Every texture is drawn on a canvas here; a painting may take one of our
 * own media images instead (loaded by the caller through the same-origin guard).
 */
import { BRAND_HEX } from "@terrakin/ui/brand";
import {
  CylinderGeometry,
  DoubleSide,
  Group,
  IcosahedronGeometry,
  LatheGeometry,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  MeshPhongMaterial,
  PlaneGeometry,
  RingGeometry,
  type Texture,
  TorusGeometry,
  Vector2,
} from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { addWind, bakeShade, canvasTexture, noShade, paper, type Stage } from "./art";
import { BRAND, type Flavor, flavorLook, hex } from "./palette";

const castAll = (g: Group) => {
  g.traverse((o) => {
    if (o instanceof Mesh) {
      o.castShadow = true;
      o.receiveShadow = true;
    }
  });
  return g;
};

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return [c, c.getContext("2d") as CanvasRenderingContext2D];
}

// ---------- jam jar ----------

/** The fruit on a label, drawn in a box of size `s` centered at (x, y). */
function drawFruit(g: CanvasRenderingContext2D, flavor: Flavor, x: number, y: number, s: number) {
  const look = flavorLook(flavor);
  const leaf = (lx: number, ly: number, angle: number, len: number) => {
    g.save();
    g.translate(lx, ly);
    g.rotate(angle);
    g.fillStyle = "#6b9a4a";
    g.beginPath();
    g.ellipse(len / 2, 0, len / 2, len / 5, 0, 0, Math.PI * 2);
    g.fill();
    g.restore();
  };
  g.lineJoin = "round";
  if (flavor === "lemon") {
    // A whole lemon and a slice.
    leaf(x - s * 0.05, y - s * 0.32, -0.7, s * 0.34);
    g.fillStyle = look.fruit;
    g.beginPath();
    g.ellipse(x - s * 0.12, y, s * 0.3, s * 0.22, -0.25, 0, Math.PI * 2);
    g.fill();
    g.beginPath();
    g.ellipse(x - s * 0.43, y + s * 0.08, s * 0.06, s * 0.04, -0.25, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = "#fff6c9";
    g.beginPath();
    g.ellipse(x - s * 0.2, y - s * 0.08, s * 0.1, s * 0.05, -0.4, 0, Math.PI * 2);
    g.fill();
    const cx = x + s * 0.26;
    const cy = y + s * 0.12;
    const r = s * 0.2;
    g.fillStyle = "#f2c53d";
    g.beginPath();
    g.arc(cx, cy, r, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = "#fff3b8";
    g.beginPath();
    g.arc(cx, cy, r * 0.82, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = "#f7d75a";
    for (let i = 0; i < 8; i++) {
      const a0 = (i / 8) * Math.PI * 2 + 0.06;
      const a1 = ((i + 1) / 8) * Math.PI * 2 - 0.06;
      g.beginPath();
      g.moveTo(cx, cy);
      g.arc(cx, cy, r * 0.72, a0, a1);
      g.closePath();
      g.fill();
    }
  } else if (flavor === "strawberry") {
    g.fillStyle = look.fruit;
    g.beginPath();
    g.moveTo(x, y + s * 0.38);
    g.bezierCurveTo(x - s * 0.42, y + s * 0.05, x - s * 0.36, y - s * 0.3, x, y - s * 0.22);
    g.bezierCurveTo(x + s * 0.36, y - s * 0.3, x + s * 0.42, y + s * 0.05, x, y + s * 0.38);
    g.fill();
    g.fillStyle = "#ffe6a8";
    for (let i = 0; i < 12; i++) {
      const sx = x + (((i * 37) % 11) / 11 - 0.5) * s * 0.5;
      const sy = y - s * 0.12 + (((i * 53) % 13) / 13) * s * 0.38;
      g.beginPath();
      g.ellipse(sx, sy, s * 0.018, s * 0.028, 0, 0, Math.PI * 2);
      g.fill();
    }
    for (let i = -2; i <= 2; i++) leaf(x, y - s * 0.24, -Math.PI / 2 + i * 0.6, s * 0.22);
  } else if (flavor === "berry") {
    leaf(x + s * 0.02, y - s * 0.26, -0.5, s * 0.32);
    const berries = [
      [-0.16, 0.02, 0.17],
      [0.15, 0.04, 0.16],
      [0, 0.2, 0.17],
      [-0.02, -0.12, 0.13],
    ] as const;
    for (const [bx, by, br] of berries) {
      g.fillStyle = look.fruit;
      g.beginPath();
      g.arc(x + bx * s, y + by * s, br * s, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = "rgba(255,255,255,0.45)";
      g.beginPath();
      g.arc(x + (bx - br * 0.35) * s, y + (by - br * 0.35) * s, br * s * 0.28, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = "#2f2560";
      g.beginPath();
      g.arc(x + bx * s, y + (by - br * 0.75) * s, br * s * 0.16, 0, Math.PI * 2);
      g.fill();
    }
  } else {
    leaf(x + s * 0.04, y - s * 0.3, -0.9, s * 0.3);
    g.fillStyle = look.fruit;
    g.beginPath();
    g.arc(x, y + s * 0.04, s * 0.32, 0, Math.PI * 2);
    g.fill();
    const blush = g.createRadialGradient(
      x + s * 0.12,
      y + s * 0.12,
      0,
      x + s * 0.12,
      y + s * 0.12,
      s * 0.3,
    );
    blush.addColorStop(0, "rgba(224, 96, 63, 0.75)");
    blush.addColorStop(1, "rgba(224, 96, 63, 0)");
    g.fillStyle = blush;
    g.beginPath();
    g.arc(x, y + s * 0.04, s * 0.32, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = "rgba(160, 70, 30, 0.45)";
    g.lineWidth = s * 0.025;
    g.beginPath();
    g.moveTo(x - s * 0.02, y - s * 0.26);
    g.quadraticCurveTo(x - s * 0.14, y + s * 0.04, x - s * 0.02, y + s * 0.34);
    g.stroke();
  }
}

function labelTexture(flavor: Flavor): Texture {
  // The band wraps all the way round the jar (about 7.6 times as wide as it is tall), so the
  // canvas has the same shape and the fruit and name sit in the middle, which faces front.
  const W = 2048;
  const H = 272;
  const [c, g] = canvas(W, H);
  const look = flavorLook(flavor);
  g.fillStyle = BRAND_HEX.paper;
  g.fillRect(0, 0, W, H);
  g.strokeStyle = look.gingham;
  g.lineWidth = 6;
  g.setLineDash([16, 12]);
  for (const y of [18, H - 18]) {
    g.beginPath();
    g.moveTo(0, y);
    g.lineTo(W, y);
    g.stroke();
  }
  g.setLineDash([]);
  drawFruit(g, flavor, W / 2, 112, 150);
  g.fillStyle = BRAND_HEX.ink;
  g.font = 'italic 600 50px "Fraunces Variable", Georgia, serif';
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText(look.label, W / 2, 218);
  return canvasTexture(c);
}

function ginghamTexture(color: string): Texture {
  const [c, g] = canvas(64, 64);
  g.fillStyle = BRAND_HEX.paper;
  g.fillRect(0, 0, 64, 64);
  g.globalAlpha = 0.55;
  g.fillStyle = color;
  g.fillRect(0, 0, 32, 64);
  g.fillRect(0, 0, 64, 32);
  g.globalAlpha = 0.5;
  g.fillRect(0, 0, 32, 32);
  const t = canvasTexture(c, true);
  t.repeat.set(5, 5);
  return t;
}

/** A jar of jam: glass, flavor-colored jam, a paper label with the fruit, and a gingham lid cloth. */
export function jamJar(flavor: Flavor): Group {
  const look = flavorLook(flavor);
  const group = new Group();
  group.name = `jam-${flavor}`;

  const profile = (inset: number, top: number) =>
    [
      [0, 0],
      [0.17 - inset, 0],
      [0.2 - inset, 0.025],
      [0.205 - inset, 0.06],
      [0.205 - inset, top - 0.07],
      [0.19 - inset, top - 0.03],
      [0.165 - inset, top],
    ].map(([x, y]) => new Vector2(x, y));

  const jam = new Mesh(
    noShade(new LatheGeometry(profile(0.012, 0.36), 32)),
    new MeshLambertMaterial({
      color: look.jam,
      emissive: look.jam,
      emissiveIntensity: 0.22,
      vertexColors: true,
    }),
  );
  jam.position.y = 0.006;

  const label = new Mesh(
    new CylinderGeometry(0.207, 0.207, 0.17, 48, 1, true),
    new MeshLambertMaterial({ map: labelTexture(flavor), side: DoubleSide }),
  );
  label.position.y = 0.19;
  // The label's middle (where the fruit is) faces front.
  label.rotation.y = Math.PI;

  const glass = new Mesh(
    new LatheGeometry(profile(0, 0.42), 40),
    new MeshPhongMaterial({
      color: 0xeaf6f6,
      transparent: true,
      opacity: 0.32,
      shininess: 120,
      specular: 0xffffff,
      depthWrite: false,
    }),
  );
  glass.renderOrder = 2;

  const lid = new Mesh(
    new CylinderGeometry(0.172, 0.172, 0.045, 32),
    new MeshLambertMaterial({ color: hex("#d8b45a") }),
  );
  lid.position.y = 0.432;

  // A round of gingham draped over the lid, with a scalloped hem.
  const clothGeo = new RingGeometry(0.001, 0.28, 48, 12);
  clothGeo.rotateX(-Math.PI / 2);
  const cp = clothGeo.getAttribute("position");
  const lidR = 0.176;
  for (let i = 0; i < cp.count; i++) {
    const x = cp.getX(i);
    const z = cp.getZ(i);
    const r = Math.hypot(x, z);
    const a = Math.atan2(z, x);
    // Flat (a little domed) over the lid, then it folds down over the edge in soft pleats.
    const d = Math.max(0, r - lidR);
    const pleat = Math.sin(a * 9) * Math.min(1, d * 14);
    const rr = r <= lidR ? r : lidR + d * 0.28 + pleat * 0.012;
    const y = r <= lidR ? (lidR - r) * 0.05 : -d * 0.95 + pleat * 0.006;
    cp.setXYZ(i, Math.cos(a) * rr, y, Math.sin(a) * rr);
  }
  clothGeo.computeVertexNormals();
  const cloth = new Mesh(
    clothGeo,
    new MeshLambertMaterial({ map: ginghamTexture(look.gingham), side: DoubleSide }),
  );
  cloth.position.y = 0.465;

  const string = new Mesh(
    new TorusGeometry(0.19, 0.009, 6, 40),
    new MeshLambertMaterial({ color: hex("#c9a77a") }),
  );
  string.rotation.x = Math.PI / 2;
  string.position.y = 0.425;

  group.add(jam, label, glass, lid, cloth, string);
  castAll(group);
  glass.castShadow = false;
  return group;
}

// ---------- painting ----------

/** A little storybook landscape: a sun, hills, and a cottage. The default picture in a frame. */
export function landscapeTexture(
  variant: "meadow" | "dusk" | "sea" | "lemons" = "meadow",
): Texture {
  const W = 512;
  const H = 384;
  const [c, g] = canvas(W, H);
  const skies = {
    meadow: ["#f9e6c0", "#f6d39a"],
    dusk: ["#3d3a78", "#cdb4f6"],
    sea: ["#d6ecf2", "#a9d3e6"],
    lemons: ["#f4ead6", "#efdcb8"],
  } as const;
  const [s0, s1] = skies[variant];
  const sky = g.createLinearGradient(0, 0, 0, H);
  sky.addColorStop(0, s0);
  sky.addColorStop(1, s1);
  g.fillStyle = sky;
  g.fillRect(0, 0, W, H);

  // Painted texture: soft dabs over everything.
  const dab = (x: number, y: number, r: number, color: string, a: number) => {
    g.globalAlpha = a;
    g.fillStyle = color;
    g.beginPath();
    g.ellipse(x, y, r, r * 0.7, 0.4, 0, Math.PI * 2);
    g.fill();
    g.globalAlpha = 1;
  };

  if (variant === "lemons") {
    // A still life: a bowl of lemons on a table.
    g.fillStyle = "#c9a27a";
    g.fillRect(0, H * 0.66, W, H);
    g.fillStyle = "#7cb9dd";
    g.beginPath();
    g.ellipse(W / 2, H * 0.68, 150, 46, 0, 0, Math.PI);
    g.fill();
    for (const [x, y, r] of [
      [-80, -20, 46],
      [0, -36, 50],
      [78, -18, 44],
      [-36, 6, 42],
      [42, 8, 42],
    ] as const) {
      g.fillStyle = "#f2c53d";
      g.beginPath();
      g.ellipse(W / 2 + x, H * 0.62 + y, r, r * 0.74, -0.2, 0, Math.PI * 2);
      g.fill();
      dab(W / 2 + x - r * 0.3, H * 0.62 + y - r * 0.3, r * 0.3, "#fff6c9", 0.7);
    }
    g.fillStyle = "#6b9a4a";
    g.beginPath();
    g.ellipse(W / 2 + 30, H * 0.44, 40, 12, -0.6, 0, Math.PI * 2);
    g.fill();
  } else {
    const sunColor = variant === "dusk" ? BRAND_HEX.paper : BRAND_HEX.sun;
    g.fillStyle = sunColor;
    g.beginPath();
    g.arc(W * 0.74, H * 0.28, variant === "dusk" ? 26 : 40, 0, Math.PI * 2);
    g.fill();
    if (variant === "dusk") {
      for (let i = 0; i < 24; i++)
        dab((i * 131) % W, ((i * 71) % (H * 0.45)) + 10, 2.2, BRAND_HEX.paper, 0.9);
    }
    const hills =
      variant === "sea"
        ? [
            ["#7cb9dd", 0.62],
            ["#5d9cc6", 0.72],
            ["#e9d6a6", 0.86],
          ]
        : variant === "dusk"
          ? [
              ["#5b4d8f", 0.6],
              ["#46406f", 0.72],
              ["#2f2c50", 0.86],
            ]
          : [
              ["#a5c682", 0.58],
              ["#8fb36a", 0.7],
              ["#6b9a4a", 0.84],
            ];
    hills.forEach(([color, top], i) => {
      g.fillStyle = color as string;
      g.beginPath();
      g.moveTo(0, H);
      for (let x = 0; x <= W; x += 16)
        g.lineTo(x, H * (top as number) + Math.sin(x / (70 + i * 30) + i * 2) * (14 - i * 3));
      g.lineTo(W, H);
      g.fill();
    });
    if (variant !== "sea") {
      // The cottage from our brand mark.
      const hx = W * 0.32;
      const hy = H * 0.66;
      g.fillStyle = BRAND_HEX.paper;
      g.fillRect(hx - 34, hy - 24, 68, 52);
      g.fillStyle = variant === "dusk" ? "#ffb35c" : BRAND_HEX.sun;
      g.beginPath();
      g.roundRect(hx - 10, hy, 20, 28, 5);
      g.fill();
      g.fillStyle = BRAND_HEX.clay;
      g.beginPath();
      g.moveTo(hx - 46, hy - 20);
      g.lineTo(hx, hy - 62);
      g.lineTo(hx + 46, hy - 20);
      g.closePath();
      g.fill();
    } else {
      // A little sailboat.
      g.fillStyle = BRAND_HEX.clay;
      g.beginPath();
      g.moveTo(W * 0.3, H * 0.66);
      g.lineTo(W * 0.42, H * 0.66);
      g.lineTo(W * 0.4, H * 0.7);
      g.lineTo(W * 0.32, H * 0.7);
      g.fill();
      g.fillStyle = BRAND_HEX.paper;
      g.beginPath();
      g.moveTo(W * 0.36, H * 0.64);
      g.lineTo(W * 0.36, H * 0.48);
      g.lineTo(W * 0.43, H * 0.64);
      g.fill();
    }
  }
  // Brush texture.
  for (let i = 0; i < 260; i++) {
    const x = (i * 97) % W;
    const y = (i * 53) % H;
    dab(x, y, 6 + (i % 5), i % 2 ? "#ffffff" : "#5a4630", 0.018);
  }
  return canvasTexture(c);
}

/**
 * A painting in a wooden frame with a gold liner. `aspect` is width over height of the picture.
 * The picture's front faces +z; the back of the frame sits at z = 0.
 */
export function painting(picture: Texture, aspect: number, height = 1): Group {
  const a = Math.min(1.9, Math.max(0.55, aspect));
  const h = height;
  const w = h * a;
  const group = new Group();
  group.name = "painting";
  const border = 0.11 * h;
  const depth = 0.08;
  const wood = new MeshLambertMaterial({ color: hex("#8d5d36"), vertexColors: true });
  const bar = (bw: number, bh: number, x: number, y: number) => {
    const m = new Mesh(bakeShade(new RoundedBoxGeometry(bw, bh, depth, 2, 0.025), 0.82, 1), wood);
    m.position.set(x, y, depth / 2);
    group.add(m);
  };
  bar(w + border * 2, border, 0, h / 2 + border / 2);
  bar(w + border * 2, border, 0, -h / 2 - border / 2);
  bar(border, h, -w / 2 - border / 2, 0);
  bar(border, h, w / 2 + border / 2, 0);
  const liner = new Mesh(
    new PlaneGeometry(w + 0.04, h + 0.04),
    new MeshLambertMaterial({ color: hex("#d8b45a") }),
  );
  liner.position.z = 0.012;
  const canvasMesh = new Mesh(
    new PlaneGeometry(w, h),
    new MeshLambertMaterial({
      map: picture,
      emissive: 0xffffff,
      emissiveMap: picture,
      emissiveIntensity: 0.12,
    }),
  );
  canvasMesh.position.z = 0.02;
  const back = new Mesh(
    new PlaneGeometry(w + border * 2, h + border * 2),
    new MeshBasicMaterial({ color: 0x5a3a20 }),
  );
  back.rotation.y = Math.PI;
  back.position.z = 0.001;
  group.add(liner, canvasMesh, back);
  castAll(group);
  return group;
}

// ---------- pedestal ----------

/** A paper-white plinth for showing things. Its top is at `PEDESTAL_TOP`. */
export const PEDESTAL_TOP = 1.02;

export function pedestal(grain: Texture, color: number = BRAND.paper2): Group {
  const group = new Group();
  group.name = "pedestal";
  const mat = paper(color, grain);
  const part = (w: number, h: number, y: number, r: number) => {
    const m = new Mesh(bakeShade(new RoundedBoxGeometry(w, h, w, 3, r), 0.8, 1), mat);
    m.position.y = y + h / 2;
    group.add(m);
  };
  part(0.72, 0.12, 0, 0.04);
  part(0.54, 0.8, 0.12, 0.05);
  part(0.68, 0.1, 0.92, 0.035);
  castAll(group);
  return group;
}

// ---------- potted lemon tree ----------

/** A terracotta pot with a little lemon tree. About 1.5 tall. The canopy sways. */
export function lemonTree(stage: Stage, grain: Texture): Group {
  const group = new Group();
  group.name = "lemon-tree";
  const pot = new Mesh(
    bakeShade(
      new LatheGeometry(
        [
          [0, 0],
          [0.2, 0],
          [0.25, 0.32],
          [0.29, 0.34],
          [0.29, 0.42],
          [0.25, 0.42],
          [0.24, 0.36],
          [0, 0.36],
        ].map(([x, y]) => new Vector2(x, y)),
        24,
      ),
      0.7,
      1,
    ),
    paper(hex("#d08a62"), grain),
  );
  const soil = new Mesh(
    new CylinderGeometry(0.245, 0.245, 0.02, 24),
    new MeshLambertMaterial({ color: BRAND.earthDeep }),
  );
  soil.position.y = 0.39;
  const trunk = new Mesh(
    bakeShade(new CylinderGeometry(0.03, 0.05, 0.7, 7), 0.75, 1),
    paper(hex("#8a6040"), grain),
  );
  trunk.position.y = 0.72;

  const canopy = new Group();
  canopy.position.y = 1.08;
  const leafMat = new MeshLambertMaterial({
    color: BRAND.moss,
    flatShading: true,
    vertexColors: true,
  });
  const blobs = [
    [0, 0.08, 0, 0.3],
    [0.2, -0.04, 0.08, 0.22],
    [-0.2, -0.02, 0.06, 0.22],
    [0.04, -0.06, -0.2, 0.22],
    [-0.06, 0.02, 0.2, 0.2],
    [0.1, 0.22, -0.04, 0.18],
  ] as const;
  blobs.forEach(([x, y, z, r], i) => {
    const geo = bakeShade(new IcosahedronGeometry(r, 1), 0.72, 1.05);
    const m = new Mesh(geo, leafMat);
    m.position.set(x, y, z);
    m.rotation.set(i, i * 2, 0);
    m.material =
      i % 2
        ? leafMat
        : new MeshLambertMaterial({
            color: BRAND.mossLight,
            flatShading: true,
            vertexColors: true,
          });
    canopy.add(m);
  });
  const lemonMat = new MeshLambertMaterial({
    color: hex("#f5cf3c"),
    emissive: hex("#f5cf3c"),
    emissiveIntensity: 0.1,
  });
  const lemonGeo = new IcosahedronGeometry(0.055, 1);
  const lemons = [
    [0.27, -0.06, 0.16],
    [-0.24, -0.1, 0.18],
    [0.06, -0.12, 0.33],
    [0.2, 0.12, -0.16],
    [-0.16, 0.14, -0.12],
    [-0.3, 0.02, -0.06],
    [0.12, 0.3, 0.08],
  ] as const;
  for (const [x, y, z] of lemons) {
    const l = new Mesh(lemonGeo, lemonMat);
    l.scale.set(1, 0.8, 0.8);
    l.position.set(x, y, z);
    l.rotation.z = 0.4;
    canopy.add(l);
  }
  group.add(pot, soil, trunk, canopy);
  castAll(group);
  const phase = Math.random() * 10;
  stage.animate(({ time }) => {
    canopy.rotation.z = Math.sin(time * 0.9 + phase) * 0.035;
    canopy.rotation.x = Math.cos(time * 0.7 + phase) * 0.025;
  });
  return group;
}

/** A small round shrub in a pot, for corners. Sways with the shared wind. */
export function pottedShrub(stage: Stage, grain: Texture): Group {
  const group = new Group();
  const pot = new Mesh(
    bakeShade(new CylinderGeometry(0.2, 0.15, 0.32, 16), 0.7, 1),
    paper(hex("#c46a42"), grain),
  );
  pot.position.y = 0.16;
  const leaves = new MeshLambertMaterial({
    color: BRAND.mossLight,
    flatShading: true,
    vertexColors: true,
  });
  const wind = addWind(leaves, 0.12);
  stage.animate(({ time }) => wind.tick(time));
  for (const [x, y, z, r] of [
    [0, 0.5, 0, 0.24],
    [0.12, 0.42, 0.08, 0.16],
    [-0.12, 0.44, -0.04, 0.16],
  ] as const) {
    const geo = bakeShade(new IcosahedronGeometry(r, 1), 0.7, 1.05);
    const m = new Mesh(geo, leaves);
    m.position.set(x, y, z);
    group.add(m);
  }
  group.add(pot);
  castAll(group);
  return group;
}
