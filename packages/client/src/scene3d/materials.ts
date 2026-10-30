import { type Grade, type WallKind, wallMarks } from "@terrakin/sim";
import { paintMarks } from "@terrakin/ui/ground-art";
import type { CanvasTexture, Texture } from "three";
import { canvasTexture, type Stage } from "./art";
import { blockLook } from "./palette";

/** Side of a wall's texture, in pixels: small, like the plank and stone textures. */
const SIZE = 128;

/**
 * A wall's surface as a texture (decision 0030: drawn on a canvas, nothing loaded): its 3D color, the
 * marks `WALL_LOOK` gives it with its grade's over them (`GRADE_LOOK`, RFC 0051: the same the map
 * and the plot photos draw), and a little paper fiber. It carries its own color, so a wall drawn
 * with it is tinted white. Kept apart from any shape, so whatever form a wall takes can wear it.
 */
export function materialTexture(kind: WallKind, grade: Grade = "plain"): CanvasTexture {
  const c = document.createElement("canvas");
  c.width = SIZE;
  c.height = SIZE;
  const g = c.getContext("2d") as CanvasRenderingContext2D;
  g.fillStyle = `#${blockLook(kind).color.toString(16).padStart(6, "0")}`;
  g.fillRect(0, 0, SIZE, SIZE);
  paintMarks(g, wallMarks(kind, grade), 0, 0, SIZE, SIZE);
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
 * Each wall kind's texture at each grade (RFC 0051), drawn the first time a wall of it is shown
 * and then shared by every plot on the stage, so a graded wall costs one small texture per kind and
 * grade on screen. Each goes into `spare` so freeing one plot leaves it for the rest.
 */
export function wallTextures(stage: Stage, spare: Set<Texture>): WallTextures {
  const made = new Map<string, Texture>();
  return (kind, grade = "plain") => {
    let t = made.get(`${kind}:${grade}`);
    if (!t) {
      t = stage.keep(materialTexture(kind, grade));
      spare.add(t);
      made.set(`${kind}:${grade}`, t);
    }
    return t;
  };
}

/** A wall kind's texture at a grade, shared by everything a stage draws. */
export type WallTextures = (kind: WallKind, grade?: Grade) => Texture;
