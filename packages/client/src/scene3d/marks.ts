/**
 * Marks over the world in 3D for pottery (RFC 0047), the same the map draws: a teapot with steam
 * where tea is out at an event (`teaSpots`), and a gold sparkle over a kiln whose pot is ready.
 * A handful of sprites at most, rebuilt only when the list changes, and animated each frame
 * unless motion is still.
 */
import type { Tile } from "@terrakin/sim";
import { Group, Sprite, SpriteMaterial } from "three";
import type { TeaSpot } from "../tea-spots";
import { type Stage, spotTexture } from "./art";
import { artCanvas, type Pictures } from "./displays";

export interface WorldMarks {
  group: Group;
  /** Show these, and move the steam and the sparkles. True when anything drawn moved. */
  set(teas: readonly TeaSpot[], kilns: readonly Tile[], now: number, still: boolean): boolean;
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
    map: stage.keep(spotTexture("255, 224, 138")),
    transparent: true,
    depthWrite: false,
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
  let stars: Sprite[] = [];
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
          const star = new Sprite(sparkle);
          star.position.set(k.x + 0.2, 1.25, k.y);
          group.add(star);
          stars.push(star);
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
      for (const [i, s] of stars.entries()) {
        const size = still ? 0.4 : 0.32 + 0.1 * Math.sin(now / 260 + i);
        s.scale.set(size, size, 1);
        if (!still) moved = true;
      }
      return moved;
    },
  };
}
