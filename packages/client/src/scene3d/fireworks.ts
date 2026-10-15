import type { FireworkColor } from "@terrakin/sim";
import { BufferAttribute, BufferGeometry, Color, Points, PointsMaterial } from "three";
import { BURST_HEX, BURST_MS, BURSTS_MAX, type BurstMark } from "../render/fireworks";
import { spotTexture } from "./art";

/**
 * Fireworks in the world in 3D (RFC 0034): the same bursts the map draws, on the map's timeline.
 * A spark rises for the first quarter, then a shell of sparks spreads, droops, and fades. One
 * point cloud for every burst on screen, its points rewritten each frame a burst is up.
 */

/** Sparks in one burst's shell. */
const SPARKS = 18;
/** How high a firework bursts, in tiles: low enough to stay on screen over the one who lit it. */
const BURST_HEIGHT = 3.5;
/** The points one burst can use: its rising spark, or its shell. */
const PER_BURST = SPARKS;

export interface Sparks {
  points: Points;
  /** Draw these bursts at `now`; true while any is up, so the scene keeps being drawn. */
  set(bursts: readonly BurstMark[], now: number, still: boolean): boolean;
}

/** Directions spread evenly over a sphere, the same for every burst. */
const DIRS = Array.from({ length: SPARKS }, (_, i) => {
  const y = 1 - (2 * (i + 0.5)) / SPARKS;
  const r = Math.sqrt(1 - y * y);
  const a = i * 2.399963;
  return [Math.cos(a) * r, y, Math.sin(a) * r] as const;
});

/** One spark at a moment: where it is, its burst's color, and how much of it shows. */
export interface Spark {
  x: number;
  y: number;
  z: number;
  color: FireworkColor;
  fade: number;
}

/** Every spark showing at `now`, the newest `BURSTS_MAX` bursts' worth. Pure, so a test pins it. */
export function sparksAt(bursts: readonly BurstMark[], now: number, still: boolean): Spark[] {
  const out: Spark[] = [];
  for (const b of bursts.slice(-BURSTS_MAX)) {
    const age = now - b.at;
    if (age < 0 || age > BURST_MS) continue;
    const t = still ? 0.5 : age / BURST_MS;
    if (t < 0.25) {
      out.push({
        x: b.x,
        y: 0.5 + (BURST_HEIGHT - 0.5) * (t / 0.25),
        z: b.y,
        color: b.color,
        fade: 1,
      });
      continue;
    }
    const k = (t - 0.25) / 0.75;
    const r = 0.3 + 1.2 * Math.sqrt(k);
    for (const [dx, dy, dz] of DIRS) {
      out.push({
        x: b.x + dx * r,
        y: BURST_HEIGHT + dy * r - k * 0.8,
        z: b.y + dz * r,
        color: b.color,
        fade: 1 - k,
      });
    }
  }
  return out;
}

export function fireworkSparks(): Sparks {
  const n = BURSTS_MAX * PER_BURST;
  const positions = new Float32Array(n * 3);
  // Each spark's color and how much of it shows, so a burst fades over a bright sky as well as
  // over the night.
  const colors = new Float32Array(n * 4);
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(positions, 3));
  geometry.setAttribute("color", new BufferAttribute(colors, 4));
  geometry.setDrawRange(0, 0);
  const material = new PointsMaterial({
    size: 12,
    sizeAttenuation: false,
    // A soft round spark, tinted by each point's color.
    map: spotTexture("255, 255, 255"),
    vertexColors: true,
    transparent: true,
    depthWrite: false,
  });
  const points = new Points(geometry, material);
  points.frustumCulled = false;
  points.renderOrder = 10;
  const tint = new Color();
  let shown = 0;
  return {
    points,
    set(bursts, now, still) {
      const sparks = sparksAt(bursts, now, still);
      if (sparks.length === 0 && shown === 0) return false;
      sparks.forEach((p, i) => {
        tint.set(BURST_HEX[p.color]);
        positions.set([p.x, p.y, p.z], i * 3);
        colors.set([tint.r, tint.g, tint.b, p.fade], i * 4);
      });
      shown = sparks.length;
      geometry.setDrawRange(0, shown);
      (geometry.getAttribute("position") as BufferAttribute).needsUpdate = true;
      (geometry.getAttribute("color") as BufferAttribute).needsUpdate = true;
      return true;
    },
  };
}
