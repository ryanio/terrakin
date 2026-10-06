/**
 * The weather in the 3D views (decision 0073): rain as falling streaks and snow as drifting flakes
 * in a box around what the camera looks at, and the stage's light, sky, and haze greyed for cloud
 * and fog (`Stage.skyLook`). Rain and snow are one draw each, a few hundred points moved on the CPU
 * each frame, each drawn from a small texture made once, and hidden when they aren't falling.
 * Under reduced motion they hold still. Loaded only through `import()`, with the rest of `scene3d/`.
 */
import {
  BufferAttribute,
  BufferGeometry,
  type CanvasTexture,
  Group,
  Points,
  PointsMaterial,
} from "three";
import type { SkyAmounts } from "../weather";
import { canvasTexture, type Stage, spotTexture } from "./art";

export interface WeatherScene {
  /** Show this much cloud, rain, snow, and fog (0 to 1 each). Cheap to call every frame. */
  set(sky: SkyAmounts): void;
  /** Keep the rain and snow falling around this point on the ground. */
  follow(x: number, z: number): void;
}

/** How fast rain falls, in tiles a second, and how big a streak is drawn. */
const RAIN = { speed: 11, spread: 4, size: 0.62 };
/** How fast snow falls, in tiles a second, and how far it sways. */
const SNOW = { speed: 0.9, spread: 0.5, sway: 0.3 };

/** A small seeded random, so the drops fall in the same places every visit. */
function seeded(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
}

/**
 * A raindrop's streak, leaning with the wind: a soft dark edge and a pale core, so it shows against
 * the sky and the ground alike. Points are square, so it's drawn down the middle of a square.
 */
function streakTexture(): CanvasTexture {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d") as CanvasRenderingContext2D;
  g.lineCap = "round";
  for (const [width, rgb, alpha] of [
    [6, "88, 108, 146", 0.55],
    [2.5, "240, 246, 255", 0.95],
  ] as const) {
    const fade = g.createLinearGradient(0, 0, 0, 64);
    fade.addColorStop(0, `rgba(${rgb}, 0)`);
    fade.addColorStop(1, `rgba(${rgb}, ${alpha})`);
    g.strokeStyle = fade;
    g.lineWidth = width;
    g.beginPath();
    g.moveTo(37, 3);
    g.lineTo(28, 61);
    g.stroke();
  }
  return canvasTexture(c);
}

/**
 * Rain and snow over `radius` tiles each way from the point it follows, falling from `height`.
 * Everything it adds is freed with the stage.
 */
export function createWeather(stage: Stage, { radius = 11, height = 9 } = {}): WeatherScene {
  const phone = stage.quality === "phone";
  const group = new Group();
  group.name = "weather";
  stage.scene.add(group);
  const rand = seeded(97);

  const drops = phone ? 340 : 600;
  const drop = Array.from({ length: drops }, () => ({
    x: (rand() * 2 - 1) * radius,
    z: (rand() * 2 - 1) * radius,
    y: rand() * height,
    speed: RAIN.speed + rand() * RAIN.spread,
  }));
  // The attribute keeps this very array (a Float32BufferAttribute would copy it), so writing a
  // position here moves the drop.
  const rainAt = new Float32Array(drops * 3);
  const rainGeo = new BufferGeometry();
  rainGeo.setAttribute("position", new BufferAttribute(rainAt, 3));
  const rainMat = new PointsMaterial({
    color: 0xffffff,
    map: stage.keep(streakTexture()),
    size: RAIN.size,
    sizeAttenuation: true,
    transparent: true,
    opacity: 0,
    depthWrite: false,
  });
  const rain = new Points(rainGeo, rainMat);
  // Moved on the CPU every frame, so its bounds go stale: always draw it.
  rain.frustumCulled = false;
  rain.visible = false;

  const flakes = phone ? 320 : 520;
  const flake = Array.from({ length: flakes }, () => ({
    x: (rand() * 2 - 1) * radius,
    z: (rand() * 2 - 1) * radius,
    y: rand() * height,
    speed: SNOW.speed + rand() * SNOW.spread,
    phase: rand() * Math.PI * 2,
  }));
  const snowAt = new Float32Array(flakes * 3);
  const snowGeo = new BufferGeometry();
  snowGeo.setAttribute("position", new BufferAttribute(snowAt, 3));
  const snowMat = new PointsMaterial({
    color: 0xffffff,
    map: stage.keep(spotTexture("255, 255, 255")),
    size: 0.26,
    sizeAttenuation: true,
    transparent: true,
    opacity: 0,
    depthWrite: false,
  });
  const snow = new Points(snowGeo, snowMat);
  snow.frustumCulled = false;
  snow.visible = false;
  group.add(rain, snow);

  const place = (time: number) => {
    if (rain.visible) {
      for (let i = 0; i < drops; i++) {
        const d = drop[i] as (typeof drop)[number];
        const k = i * 3;
        rainAt[k] = d.x;
        rainAt[k + 1] = height - ((height - d.y + time * d.speed) % height);
        rainAt[k + 2] = d.z;
      }
      (rainGeo.getAttribute("position") as BufferAttribute).needsUpdate = true;
    }
    if (snow.visible) {
      for (let i = 0; i < flakes; i++) {
        const f = flake[i] as (typeof flake)[number];
        const y = height - ((height - f.y + time * f.speed) % height);
        const k = i * 3;
        snowAt[k] = f.x + Math.sin(time * 0.9 + f.phase) * SNOW.sway;
        snowAt[k + 1] = y;
        snowAt[k + 2] = f.z + Math.cos(time * 0.7 + f.phase) * SNOW.sway * 0.5;
      }
      (snowGeo.getAttribute("position") as BufferAttribute).needsUpdate = true;
    }
  };
  if (!stage.reducedMotion) stage.animate(({ time }) => place(time));

  return {
    set(sky) {
      stage.skyLook(sky);
      const raining = sky.rain > 0.01;
      const snowing = sky.snow > 0.01;
      const appeared = (raining && !rain.visible) || (snowing && !snow.visible);
      rain.visible = raining;
      snow.visible = snowing;
      rainMat.opacity = 0.85 * sky.rain;
      snowMat.opacity = 0.95 * sky.snow;
      // Something just started falling: put it in place, so a still scene shows it too.
      if (appeared) place(0);
    },
    follow(x, z) {
      group.position.set(x, 0, z);
    },
  };
}
