/**
 * Marks over the world in 3D for pottery (RFC 0047), the same the map draws: a teapot with steam
 * where tea is out at an event (`teaSpots`), and gold sparkles over a kiln whose pot is ready.
 * A handful of sprites at most, rebuilt only when the list changes, and animated each frame
 * unless motion is still.
 */
import type { Glaze, Tile } from "@terrakin/sim";
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

/** How high a teapot stands: on a table's top, on a hearth's stones, or on the ground. */
const TEA_HEIGHT: Record<TeaSpot["on"], number> = { table: 0.78, hearth: 0.45, ground: 0.3 };

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
  // A teapot in each glaze some tea is out in, its picture taken once and kept while the view is.
  const teapots = new Map<Glaze, { release(): void; material?: SpriteMaterial }>();
  const teapotIn = (glaze: Glaze): SpriteMaterial | undefined => {
    const had = teapots.get(glaze);
    if (had) return had.material;
    const taken = pictures.take(`art:teapot|${glaze}`, () =>
      artCanvas({ kind: "teapot", glaze }, false),
    );
    const entry: { release(): void; material?: SpriteMaterial } = {
      release: () => taken.release(),
    };
    teapots.set(glaze, entry);
    void taken.texture.then((map) => {
      if (!map) return;
      entry.material = new SpriteMaterial({ map, alphaTest: 0.5 });
      key = "";
      stage.invalidate();
    });
    return undefined;
  };
  stage.keep({
    dispose() {
      for (const t of teapots.values()) {
        t.release();
        t.material?.dispose();
      }
      steam.dispose();
      sparkle.dispose();
    },
  });
  let key = "";
  let puffs: { sprite: Sprite; base: number; i: number }[] = [];
  let stars: { sprite: Sprite; i: number }[] = [];
  return {
    group,
    set(teas, kilns, now, still) {
      const next = `${teas.map((t) => `${t.x},${t.y},${t.on},${t.glaze}`).join(";")}|${kilns
        .map((k) => `${k.x},${k.y}`)
        .join(";")}`;
      let moved = false;
      if (next !== key) {
        key = next;
        group.clear();
        puffs = [];
        stars = [];
        for (const t of teas) {
          const base = TEA_HEIGHT[t.on];
          const material = teapotIn(t.glaze);
          if (material) {
            const pot = new Sprite(material);
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
