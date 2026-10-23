/**
 * Marks over the world in 3D for pottery (RFC 0047), the same the map draws: a teapot with steam
 * where tea is out at an event (`teaSpots`), and gold sparkles over a kiln whose pot is ready.
 * A handful of sprites at most, rebuilt only when the list changes, and animated each frame
 * unless motion is still.
 */
import type { Tile } from "@terrakin/sim";
import { Group, Sprite, SpriteMaterial } from "three";
import { paintSparkle } from "../render/decor";
import type { TeaSpot } from "../tea-spots";
import { canvasTexture, type Stage, spotTexture } from "./art";
import { artCanvas, type Pictures } from "./displays";

export interface WorldMarks {
  group: Group;
  /** Show these, and move the steam and the sparkles. True when anything drawn moved. */
  set(teas: readonly TeaSpot[], kilns: readonly Tile[], now: number, still: boolean): boolean;
}

/** Where a ready kiln's three sparkles stand (across from its middle, and how high), and how big. */
const STARS = [
  [0.25, 1.35],
  [-0.15, 1.6],
  [0.05, 1.15],
] as const;
const STAR_SIZES = [0.55, 0.36, 0.28];

/** A four-point sparkle in gold, edged in amber so it reads on sky and on stone. */
function sparkleTexture() {
  const c = document.createElement("canvas");
  c.width = 64;
  c.height = 64;
  const g = c.getContext("2d") as CanvasRenderingContext2D;
  paintSparkle(g, 32, 32, 30, "#b8741a");
  paintSparkle(g, 32, 32, 25, "#ffd84a");
  return canvasTexture(c);
}

export function worldMarks(stage: Stage, pictures: Pictures): WorldMarks {
  const group = new Group();
  group.name = "pottery marks";
  const steam = new SpriteMaterial({
    map: stage.keep(spotTexture("255, 255, 255")),
    transparent: true,
    opacity: 0.7,
    depthWrite: false,
  });
  const sparkle = new SpriteMaterial({
    map: stage.keep(sparkleTexture()),
    transparent: true,
    depthWrite: false,
    depthTest: false,
  });
  const teapot = pictures.take("art:pot_of_tea", () => artCanvas({ kind: "pot_of_tea" }, false));
  let teapotMaterial: SpriteMaterial | undefined;
  void teapot.texture.then((map) => {
    if (!map) return;
    teapotMaterial = new SpriteMaterial({ map, alphaTest: 0.5 });
    key = "";
    stage.invalidate();
  });
  stage.keep({
    dispose() {
      teapot.release();
      steam.dispose();
      sparkle.dispose();
      teapotMaterial?.dispose();
    },
  });
  let key = "";
  let puffs: { sprite: Sprite; base: number; i: number }[] = [];
  let stars: { sprite: Sprite; i: number }[] = [];
  return {
    group,
    set(teas, kilns, now, still) {
      const next = `${teas.map((t) => `${t.x},${t.y},${t.table}`).join(";")}|${kilns
        .map((k) => `${k.x},${k.y}`)
        .join(";")}|${teapotMaterial ? 1 : 0}`;
      let moved = false;
      if (next !== key) {
        key = next;
        group.clear();
        puffs = [];
        stars = [];
        for (const t of teas) {
          const base = t.table ? 0.78 : 0.3;
          if (teapotMaterial) {
            const pot = new Sprite(teapotMaterial);
            pot.scale.set(0.62, 0.62, 1);
            pot.position.set(t.x, base, t.y);
            group.add(pot);
          }
          for (let i = 0; i < 3; i++) {
            const puff = new Sprite(steam);
            puff.position.set(t.x + 0.08, base + 0.3, t.y);
            group.add(puff);
            puffs.push({ sprite: puff, base: base + 0.3, i });
          }
        }
        for (const k of kilns) {
          for (const [i, [dx, y]] of STARS.entries()) {
            const star = new Sprite(sparkle);
            star.position.set(k.x + dx, y, k.y);
            star.renderOrder = 2;
            group.add(star);
            stars.push({ sprite: star, i });
          }
        }
        moved = true;
      }
      for (const p of puffs) {
        const phase = still ? (p.i + 1) / 4 : (now / 1600 + p.i / 3) % 1;
        const size = 0.12 + phase * 0.16;
        p.sprite.scale.set(size, size, 1);
        p.sprite.position.y = p.base + phase * 0.7;
        if (!still) moved = true;
      }
      for (const { sprite, i } of stars) {
        const big = STAR_SIZES[i] ?? 0.3;
        const size = still ? big : big * (0.65 + 0.35 * Math.sin(now / 240 + i * 2.1));
        sprite.scale.set(size, size, 1);
        if (!still) moved = true;
      }
      return moved;
    },
  };
}
