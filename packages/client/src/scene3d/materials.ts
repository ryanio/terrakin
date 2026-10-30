import { WALL_LOOK, type WallKind } from "@terrakin/sim";
import { paintMarks } from "@terrakin/ui/ground-art";
import type { CanvasTexture, Texture } from "three";
import { canvasTexture, type Stage } from "./art";
import { blockLook } from "./palette";

/** Side of a wall's texture, in pixels: small, like the plank and stone textures. */
const SIZE = 128;

/**
 * A wall's surface as a texture (decision 0030: drawn on a canvas, nothing loaded): its 3D color, the
 * marks `WALL_LOOK` gives it (the same the map and the plot photos draw), and a little paper fiber.
 * It carries its own color, so a wall drawn with it is tinted white. Kept apart from any shape, so
 * whatever form a wall takes can wear it.
 */
export function materialTexture(kind: WallKind): CanvasTexture {
  const c = document.createElement("canvas");
  c.width = SIZE;
  c.height = SIZE;
  const g = c.getContext("2d") as CanvasRenderingContext2D;
  g.fillStyle = `#${blockLook(kind).color.toString(16).padStart(6, "0")}`;
  g.fillRect(0, 0, SIZE, SIZE);
  paintMarks(g, WALL_LOOK[kind], 0, 0, SIZE, SIZE);
  // Paper fibers: specks a shade lighter and darker, the same every time.
  let s = 0x9e3779b9 ^ kind.length;
  const next = () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
  for (let i = 0; i < 700; i++) {
    g.fillStyle = next() < 0.5 ? "rgba(255, 250, 240, 0.08)" : "rgba(60, 40, 20, 0.06)";
    g.fillRect(Math.floor(next() * SIZE), Math.floor(next() * SIZE), 1 + Math.floor(next() * 2), 1);
  }
  return canvasTexture(c, true);
}

/**
 * Each wall kind's texture, drawn the first time a wall of it is shown and then shared by every
 * plot on the stage. Each goes into `spare` so freeing one plot leaves it for the rest.
 */
export function wallTextures(stage: Stage, spare: Set<Texture>): (kind: WallKind) => Texture {
  const made = new Map<WallKind, Texture>();
  return (kind) => {
    let t = made.get(kind);
    if (!t) {
      t = stage.keep(materialTexture(kind));
      spare.add(t);
      made.set(kind, t);
    }
    return t;
  };
}
