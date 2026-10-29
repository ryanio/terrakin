/**
 * Where the camera stands for a scene photo (RFC 0049). Pure, so the framings are tested without
 * a browser: world units are tiles, `x` east, `z` south, `y` up, and every shot looks from the
 * south, the side the world's own camera starts on.
 *
 * - `portrait`: one resident head to toe, filling most of the frame's height, seen from the front.
 * - `near`: about nine tiles across where the subject stands.
 * - `wide`: the whole plot and a ring of its neighbors.
 */

export type PhotoFramingName = "portrait" | "near" | "wide";

interface Vec {
  x: number;
  y: number;
  z: number;
}

export interface PhotoView {
  target: Vec;
  position: Vec;
  /** Where the haze starts and where it has swallowed everything, from the camera. */
  fogNear: number;
  fogFar: number;
  /** How wide the sun's shadow reaches around the target. */
  lightRadius: number;
}

export interface FramingInput {
  /** The tile the shot is about. */
  focus: { x: number; z: number };
  /** The side a portrait is taken from, as a flat unit step (`clearSide`). Absent: the south. */
  from?: { x: number; z: number };
  /** How high the top of the subject's head is over their feet, for a portrait. */
  figureTop?: number;
  /** Where the subject's feet stand: their floor's height (RFC 0028). */
  floorY?: number;
  /** A plot's size in tiles, for `wide`. */
  plotSize: number;
  /** The camera's vertical field of view, in degrees, and the frame's width over its height. */
  fovDeg: number;
  aspect: number;
}

/** How much of the frame's height a portrait's subject fills. */
export const PORTRAIT_FILL = 0.82;
/** Tiles across a `near` shot, where the subject stands. */
export const NEAR_ACROSS = 9;
/** How many plots' width a `wide` shot shows: the plot and most of a ring on each side. */
export const WIDE_PLOTS = 2.4;

const unit = (v: Vec): Vec => {
  const l = Math.hypot(v.x, v.y, v.z) || 1;
  return { x: v.x / l, y: v.y / l, z: v.z / l };
};
const along = (from: Vec, dir: Vec, d: number): Vec => ({
  x: from.x + dir.x * d,
  y: from.y + dir.y * d,
  z: from.z + dir.z * d,
});

export function photoView(framing: PhotoFramingName, o: FramingInput): PhotoView {
  const vHalf = (o.fovDeg * Math.PI) / 360;
  const hHalf = Math.atan(Math.tan(vHalf) * o.aspect);
  const base = o.floorY ?? 0;
  if (framing === "portrait") {
    const top = o.figureTop ?? 1.9;
    const target = { x: o.focus.x, y: base + top * 0.52, z: o.focus.z };
    // Level with the chest and a touch above, so the face and the whole outfit both show.
    const side = o.from ?? { x: 0, z: 1 };
    const dir = unit({ x: side.x, y: 0.16, z: side.z });
    const distance = top / PORTRAIT_FILL / 2 / Math.tan(vHalf);
    return {
      target,
      position: along(target, dir, distance),
      // The plot behind stays, softened by haze rather than blur.
      fogNear: distance + 4,
      fogFar: distance + 30,
      lightRadius: 6,
    };
  }
  if (framing === "near") {
    const target = { x: o.focus.x, y: base + 0.6, z: o.focus.z };
    const dir = unit({ x: 0, y: 0.9, z: 1 });
    const distance = NEAR_ACROSS / 2 / Math.tan(hHalf);
    return {
      target,
      position: along(target, dir, distance),
      fogNear: distance + 4,
      fogFar: distance + 22,
      lightRadius: 10,
    };
  }
  const across = o.plotSize * WIDE_PLOTS;
  const target = { x: o.focus.x, y: 0, z: o.focus.z };
  const dir = unit({ x: 0, y: 1.15, z: 1 });
  const distance = across / 2 / Math.tan(hHalf);
  return {
    target,
    position: along(target, dir, distance),
    fogNear: distance + across * 0.5,
    fogFar: distance + across * 1.6,
    lightRadius: across * 0.75,
  };
}

/** How much of a picture's height a thing `height` tall at `distance` fills, by a `fovDeg` lens. */
export function heightShare(height: number, distance: number, fovDeg: number): number {
  return height / (2 * distance * Math.tan((fovDeg * Math.PI) / 360));
}

/** How many units across a picture shows at `distance`, by a `fovDeg` lens at `aspect`. */
export function widthAt(distance: number, fovDeg: number, aspect: number): number {
  const hHalf = Math.atan(Math.tan((fovDeg * Math.PI) / 360) * aspect);
  return 2 * distance * Math.tan(hHalf);
}

/** The sides a portrait tries, the south first, then round toward the north. */
const SIDES: readonly { x: number; z: number }[] = [
  { x: 0, z: 1 },
  { x: 1, z: 1 },
  { x: -1, z: 1 },
  { x: 1, z: 0 },
  { x: -1, z: 0 },
  { x: 1, z: -1 },
  { x: -1, z: -1 },
  { x: 0, z: -1 },
].map((d) => {
  const l = Math.hypot(d.x, d.z);
  return { x: d.x / l, z: d.z / l };
});

/**
 * The first side, the south first, from which nothing that stands as tall as a wall is between the
 * camera and the subject `reach` tiles out, by `blocked(x, y)`. Undefined when every side is walled.
 */
export function clearSide(
  blocked: (x: number, y: number) => boolean,
  at: { x: number; y: number },
  reach: number,
): { x: number; z: number } | undefined {
  return SIDES.find((d) => {
    for (let t = 0.75; t <= reach; t += 0.5) {
      if (blocked(Math.round(at.x + d.x * t), Math.round(at.y + d.z * t))) return false;
    }
    return true;
  });
}

/**
 * The tiles a walled-in portrait leaves out of its own copy of the world, like the open side of a
 * dollhouse: those between the subject and a camera `reach` tiles out on `side`, a tile and a half
 * either side of the line, so the wall in front opens as wide as the lens sees through it.
 */
export function sightline(
  at: { x: number; y: number },
  side: { x: number; z: number },
  reach: number,
): { x: number; y: number }[] {
  const seen = new Map<string, { x: number; y: number }>();
  for (let t = 0.75; t <= reach + 0.5; t += 0.25) {
    for (let across = -1.5; across <= 1.5; across += 0.5) {
      const x = Math.round(at.x + side.x * t - side.z * across);
      const y = Math.round(at.y + side.z * t + side.x * across);
      if (x === at.x && y === at.y) continue;
      seen.set(`${x},${y}`, { x, y });
    }
  }
  return [...seen.values()];
}

/** How far out a portrait's camera stands, in tiles, for `clearSide`'s reach. */
export function portraitReach(figureTop: number, fovDeg: number): number {
  return Math.ceil(figureTop / PORTRAIT_FILL / 2 / Math.tan((fovDeg * Math.PI) / 360));
}

/**
 * The plots a `near` or `wide` photo takes the roofs off, in its own copy of the world: the plot
 * the shot is about, so whoever is home shows, and the plot south of it, between it and the
 * camera, whose roof would cover its front. A portrait stands too close for a roof to matter and
 * opens its own way through the walls (`sightline`).
 */
export function openRoofs(
  framing: PhotoFramingName,
  focus: { x: number; y: number },
  plotSize: number,
): { px: number; py: number }[] {
  if (framing === "portrait") return [];
  const px = Math.floor(focus.x / plotSize);
  const py = Math.floor(focus.y / plotSize);
  return [
    { px, py },
    { px, py: py + 1 },
  ];
}
