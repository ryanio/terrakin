import {
  AdditiveBlending,
  Group,
  IcosahedronGeometry,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  OctahedronGeometry,
  PlaneGeometry,
  PointLight,
  type Texture,
} from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { bakeShade, paper, type Stage, spotTexture, stoneTexture } from "./art";
import { BRAND } from "./palette";

// ---------- the hearth ----------

/** The color of a hearth's pool of firelight, a little deeper than a lamp's. */
export const HEARTH_LIGHT = "255, 170, 80";

/**
 * A little stone fireplace with a chimney, a flickering fire, and smoke, and after dark a warm pool
 * of light in front (decision 0098). With `light`, a warm point light on desktop that comes on
 * after dark; the world leaves it out, since a light coming into view makes every material
 * recompile. The world passes one `stone` and `glow` texture for every hearth.
 */
export function hearth(
  stage: Stage,
  grain: Texture,
  { light: withLight = true, stone: stoneMap, glow: glowMap } = {} as {
    light?: boolean;
    stone?: Texture;
    glow?: Texture;
  },
): Group {
  const group = new Group();
  group.name = "hearth";
  const stones = stoneMap ?? stage.keep(stoneTexture());
  const stone = paper(0xb9b1a5, stones);
  const base = new Mesh(
    bakeShade(new RoundedBoxGeometry(0.82, 0.5, 0.62, 2, 0.08), 0.65, 1),
    stone,
  );
  base.position.y = 0.25;
  const chimney = new Mesh(
    bakeShade(new RoundedBoxGeometry(0.34, 1.35, 0.3, 2, 0.05), 0.7, 1),
    stone,
  );
  chimney.position.set(0, 0.68, -0.14);
  const cap = new Mesh(
    bakeShade(new RoundedBoxGeometry(0.44, 0.1, 0.4, 2, 0.03), 0.8, 1),
    paper(BRAND.clay, grain),
  );
  cap.position.set(0, 1.4, -0.14);
  // The fire opening: a dark arch with embers and a flame.
  const mouth = new Mesh(new PlaneGeometry(0.4, 0.3), new MeshBasicMaterial({ color: 0x3a2214 }));
  mouth.position.set(0, 0.2, 0.312);
  const flameMat = new MeshBasicMaterial({ color: BRAND.ember });
  const flame = new Mesh(new OctahedronGeometry(0.1, 0), flameMat);
  flame.scale.set(1, 1.6, 0.6);
  flame.position.set(0, 0.17, 0.3);
  const coreMat = new MeshBasicMaterial({ color: 0xfff1b0 });
  const core = new Mesh(new OctahedronGeometry(0.05, 0), coreMat);
  core.scale.set(1, 1.5, 0.6);
  core.position.set(0, 0.13, 0.33);
  group.add(base, chimney, cap, mouth, flame, core);
  for (const o of [base, chimney, cap]) {
    o.castShadow = true;
    o.receiveShadow = true;
  }

  // A warm pool of light on the ground in front, after dark.
  const pool = new MeshBasicMaterial({
    map: glowMap ?? stage.keep(spotTexture(HEARTH_LIGHT)),
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
  });
  stage.glow({ kind: "pool", material: pool, opacity: 0.6 });
  const glow = new Mesh(new PlaneGeometry(1.8, 1.8), pool);
  glow.rotation.x = -Math.PI / 2;
  glow.position.set(0, 0.015, 0.55);
  glow.renderOrder = 1;
  group.add(glow);

  if (withLight && stage.quality === "high") {
    const light = new PointLight(0xffa54d, 0, 3.2, 1.6);
    light.position.set(0, 0.35, 0.6);
    group.add(light);
    stage.glow({ kind: "light", light, intensity: 1.6, flicker: true });
  }

  // Smoke: a few soft puffs that rise from the chimney, swell, and fade, then start again.
  const puffGeo = new IcosahedronGeometry(0.11, 1);
  const puffs: { mesh: Mesh; mat: MeshLambertMaterial; offset: number }[] = [];
  const count = 5;
  for (let i = 0; i < count; i++) {
    const mat = new MeshLambertMaterial({
      color: 0xfbf3e4,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      flatShading: true,
    });
    const mesh = new Mesh(i === 0 ? puffGeo : puffGeo.clone(), mat);
    mesh.position.set(0, 1.5, -0.14);
    group.add(mesh);
    puffs.push({ mesh, mat, offset: i / count });
  }
  const placePuffs = (time: number) => {
    for (const p of puffs) {
      const t = (time * 0.18 + p.offset) % 1;
      p.mesh.position.set(
        Math.sin(t * 5 + p.offset * 9) * 0.12 + t * 0.35,
        1.5 + t * 1.6,
        -0.14 - t * 0.2,
      );
      p.mesh.scale.setScalar(0.6 + t * 1.6);
      p.mat.opacity = Math.sin(Math.PI * Math.min(1, t * 1.15)) * 0.7;
    }
  };
  placePuffs(1.3);
  stage.animate(({ time }) => {
    placePuffs(time);
    const f = 1 + Math.sin(time * 11) * 0.08 + Math.sin(time * 17.3) * 0.06;
    flame.scale.set(1, 1.6 * f, 0.6);
    core.scale.set(1, 1.5 * (2 - f), 0.6);
  });
  return group;
}
