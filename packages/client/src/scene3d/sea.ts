import { SEA_LOOK } from "@terrakin/sim";
import {
  type CanvasTexture,
  ClampToEdgeWrapping,
  InstancedMesh,
  Matrix4,
  type Object3D,
  PlaneGeometry,
  Quaternion,
  type Texture,
  Vector3,
} from "three";
import { canvasTexture, noShade, paper, type Stage } from "./art";

/**
 * The open sea between lands (RFC 0038) in 3D, over the ground's own sea color: soft ripples that
 * drift across it, and foam that laps along every bank. Both are textures drawn here on small
 * canvases and slid along (decision 0030: no water shader, nothing loaded), so the sea moves for two
 * draws however much of it is in view. Under reduced motion the stage runs no animations, so it
 * holds still.
 */

/** How high the ripples and the foam lie: just over the ground, under anything standing. */
const RIPPLE_Y = 0.012;
const FOAM_Y = 0.016;
/** How far the foam reaches out from the bank, in tiles. */
const FOAM_REACH = 0.32;

/** One tile of sea, and which of its sides meet land or a bridge. */
export interface SeaTile {
  x: number;
  y: number;
  shore: { n: boolean; e: boolean; s: boolean; w: boolean };
}

export interface SeaLook {
  ripples: Texture;
  foam: Texture;
}

/** Pale ripples on clear, repeating in both directions, so tiles meet without a seam. */
function rippleTexture(): CanvasTexture {
  const size = 128;
  const c = document.createElement("canvas");
  c.width = size;
  c.height = size;
  const g = c.getContext("2d") as CanvasRenderingContext2D;
  g.lineCap = "round";
  g.strokeStyle = "#ffffff";
  // Each ripple a shallow wave, drawn again a tile over on each side so it wraps.
  const ripples = [
    [16, 22, 34, 0.55],
    [70, 40, 28, 0.4],
    [30, 74, 40, 0.5],
    [92, 98, 30, 0.45],
    [8, 112, 22, 0.35],
    [104, 10, 20, 0.35],
  ] as const;
  for (const [x, y, w, a] of ripples) {
    g.globalAlpha = a;
    g.lineWidth = 3;
    for (const dx of [-size, 0, size]) {
      for (const dy of [-size, 0, size]) {
        g.beginPath();
        g.moveTo(x + dx, y + dy);
        g.quadraticCurveTo(x + dx + w / 4, y + dy - 3, x + dx + w / 2, y + dy);
        g.quadraticCurveTo(x + dx + (w * 3) / 4, y + dy + 3, x + dx + w, y + dy);
        g.stroke();
      }
    }
  }
  return canvasTexture(c, true);
}

/**
 * Foam along a bank: a band at the top of the canvas (the bank's side), breaking into scallops
 * that thin out toward open water. It repeats along the bank and stops short of the open water.
 */
function foamTexture(): CanvasTexture {
  const w = 128;
  const h = 64;
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const g = c.getContext("2d") as CanvasRenderingContext2D;
  const fade = g.createLinearGradient(0, 0, 0, h);
  fade.addColorStop(0, "rgba(255, 255, 255, 0.7)");
  fade.addColorStop(0.5, "rgba(220, 244, 246, 0.35)");
  fade.addColorStop(1, "rgba(220, 244, 246, 0)");
  g.fillStyle = fade;
  g.fillRect(0, 0, w, h);
  g.fillStyle = SEA_LOOK.foam;
  g.fillRect(0, 0, w, 10);
  g.beginPath();
  for (const x of [0, 16, 32, 48, 64, 80, 96, 112, 128]) {
    const r = x % 32 === 0 ? 10 : 8;
    g.moveTo(x + r, 10);
    g.arc(x, 10, r, 0, Math.PI * 2);
  }
  g.fill();
  const t = canvasTexture(c, true);
  t.wrapT = ClampToEdgeWrapping;
  return t;
}

/** The sea's two textures, drawn once a stage and spared when a stretch of sea is freed. */
export function seaLook(stage: Stage, spare: Set<Texture>): SeaLook {
  const look = { ripples: stage.keep(rippleTexture()), foam: stage.keep(foamTexture()) };
  spare.add(look.ripples);
  spare.add(look.foam);
  return look;
}

/**
 * The ripples over every tile of `tiles` and the foam along each side of them that's bank, in world
 * tile coordinates (tile (x, y) centered on (x, 0, y)), and the animation that moves them, which
 * `stop` ends. Nothing for no tiles.
 */
export function seaMeshes(
  stage: Stage,
  tiles: readonly SeaTile[],
  look: SeaLook,
): { parts: Object3D[]; stop: () => void } {
  if (tiles.length === 0) return { parts: [], stop: () => {} };
  const m = new Matrix4();
  const q = new Quaternion();
  const one = new Vector3(1, 1, 1);
  const up = new Vector3(0, 1, 0);

  const sheet = noShade(new PlaneGeometry(1, 1));
  sheet.rotateX(-Math.PI / 2);
  const ripples = new InstancedMesh(
    sheet,
    paper(0xffffff, look.ripples, { transparent: true, opacity: 0.5, depthWrite: false }),
    tiles.length,
  );
  tiles.forEach((t, i) => {
    ripples.setMatrixAt(i, m.compose(new Vector3(t.x, RIPPLE_Y, t.y), q, one));
  });
  ripples.receiveShadow = true;
  ripples.renderOrder = 0;
  ripples.name = "sea-ripples";

  // A strip along the north side of a tile, its texture's top at the bank, turned for each side.
  const strip = noShade(new PlaneGeometry(1, FOAM_REACH));
  strip.rotateX(-Math.PI / 2);
  strip.translate(0, 0, -0.5 + FOAM_REACH / 2);
  const turns = { n: 0, e: -Math.PI / 2, s: Math.PI, w: Math.PI / 2 } as const;
  const banks: { x: number; y: number; turn: number }[] = [];
  for (const t of tiles)
    for (const side of ["n", "e", "s", "w"] as const)
      if (t.shore[side]) banks.push({ x: t.x, y: t.y, turn: turns[side] });
  const parts: Object3D[] = [ripples];
  if (banks.length > 0) {
    const foam = new InstancedMesh(
      strip,
      paper(0xffffff, look.foam, { transparent: true, depthWrite: false }),
      banks.length,
    );
    banks.forEach((b, i) => {
      q.setFromAxisAngle(up, b.turn);
      foam.setMatrixAt(i, m.compose(new Vector3(b.x, FOAM_Y, b.y), q, one));
    });
    foam.renderOrder = 1;
    foam.name = "sea-foam";
    parts.push(foam);
  } else strip.dispose();

  // The ripples drift with the current, and the foam laps in and out and slides along the bank.
  const stop = stage.animate(({ time }) => {
    look.ripples.offset.set((time * 0.025) % 1, (time * 0.011) % 1);
    look.foam.offset.set((time * 0.02) % 1, Math.sin(time * 1.1) * 0.06 + 0.02);
  });
  return { parts, stop };
}
