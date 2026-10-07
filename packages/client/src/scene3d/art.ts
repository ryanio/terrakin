/**
 * The 3D art direction, shared by every 3D view: storybook low-poly under soft warm light, paper
 * matte materials in the brand palette, shade baked into vertex colors, a soft ground disc that
 * melts into a paper sky, and small idle motions that stop for prefers-reduced-motion. The light
 * follows the map's day and night and the weather (`daylight.ts`, decision 0098): a warm dusk, a
 * blue night with stars, and lamps, fires, and windows that glow after dark.
 *
 * Performance budget (decision 0030): device pixel ratio capped at 2, one shadow-casting sun
 * (2048 soft on desktop, 1024 on phones, dropped if frames run slow), Lambert materials, instanced
 * meshes for repeated things, no post-processing. Rendering pauses while the tab is hidden, and
 * `dispose()` frees every geometry, material, texture, and the WebGL context.
 *
 * Loaded only through `import()` (decision 0013): nothing in the main bundle imports this file.
 */
import type { Holiday } from "@terrakin/sim";
import { BRAND_HEX } from "@terrakin/ui/brand";
import { reducedMotion } from "@terrakin/ui/motion";
import {
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  CircleGeometry,
  Color,
  DirectionalLight,
  Fog,
  HemisphereLight,
  type Material,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  type MeshLambertMaterialParameters,
  type MeshPhongMaterial,
  NeutralToneMapping,
  type Object3D,
  PCFShadowMap,
  PerspectiveCamera,
  type PointLight,
  Points,
  PointsMaterial,
  RepeatWrapping,
  Scene,
  SRGBColorSpace,
  Texture,
  Vector3,
  WebGLRenderer,
} from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import type { SkyAmounts } from "../weather";
import { flicker, lampLevel, lightAt, type StageLight } from "./daylight";

type Quality = "high" | "phone";

/** Phones and small tablets get the cheaper light. Touch-first or a small screen counts. */
function pickQuality(): Quality {
  const coarse = window.matchMedia("(pointer: coarse)").matches;
  const small = Math.min(window.screen.width, window.screen.height) < 700;
  return coarse || small ? "phone" : "high";
}

interface FrameInfo {
  /** Seconds since the stage started (frozen when motion is reduced). */
  time: number;
  /** Seconds since the last frame, capped so a paused tab doesn't jump. */
  dt: number;
}

/**
 * Something that glows after dark, in step with the time of day (decision 0098). A pool of light
 * on the ground shows only after dark, up to `opacity`. A lamp's shade or a flame is lit from
 * inside from its `day` strength to its `night` one. A window lights up warm, and turns from glassy
 * to its `opacity[1]`. A point light comes on. With `flicker`, it wavers while motion is allowed.
 */
export type Glowing =
  | { kind: "pool"; material: Material; opacity: number }
  | {
      kind: "lamp";
      material: MeshLambertMaterial | MeshPhongMaterial;
      day: number;
      night: number;
      flicker?: boolean;
    }
  | {
      kind: "window";
      material: MeshLambertMaterial | MeshPhongMaterial;
      strength: number;
      opacity?: readonly [number, number];
    }
  | { kind: "light"; light: PointLight; intensity: number; flicker?: boolean };

export interface Stage {
  renderer: WebGLRenderer;
  scene: Scene;
  camera: PerspectiveCamera;
  controls: OrbitControls;
  sun: DirectionalLight;
  quality: Quality;
  reducedMotion: boolean;
  /** Run every frame (only while motion is allowed). Returns a function that stops it. */
  animate(fn: (f: FrameInfo) => void): () => void;
  /** Free this with the stage even though it isn't in the scene (shared textures, say). */
  keep<T extends { dispose(): void }>(thing: T): T;
  /** Point the camera at a sphere so it fills the view, from a direction (from the target). */
  frame(center: Vector3, radius: number, from?: Vector3): void;
  /**
   * Put the camera back on the view `frame()` set: the whole scene framed from its clean angle,
   * whatever the visitor dragged it to since (issue #48). Does nothing until `frame()` runs.
   */
  reframe(): void;
  /** Light and shadow sized to a scene of this radius around `center`. */
  light(center: Vector3, radius: number): void;
  /** Ask for one more frame (reduced motion renders only when something changes). */
  invalidate(): void;
  /**
   * Grey the light, the sky, and the haze for the weather (decision 0073): cloud dims the sun and
   * greys the sky, and fog pales the haze and pulls it in. Cheap to call every frame.
   */
  skyLook(sky: SkyAmounts): void;
  /**
   * Light the scene for a moment of the day (decision 0098), the map's `phase` (0 dawn, 0.25 noon,
   * 0.5 dusk, 0.75 midnight), or full day without one. Cheap to call every frame.
   */
  timeOfDay(phase: number | undefined): void;
  /**
   * Tint the evenings for a holiday that has its own (RFC 0022: Halloween), from the world's day,
   * or none. Cheap to call every frame.
   */
  holiday(holiday: Holiday | undefined): void;
  /** The light now, for this time of day and this weather (`lightAt`). */
  lightNow(): Readonly<StageLight>;
  /** Make something glow after dark, from now until the function this returns is called. */
  glow(thing: Glowing): () => void;
  /** How far the haze reaches in this weather, as a share of a clear day's (1 when clear). */
  hazeReach(): number;
  /** A PNG of the current view at up to 2x, or null if the browser can't make one. */
  photo(): Promise<Blob | null>;
  dispose(): void;
}

export interface StageOptions {
  /** Turn slowly until someone touches it. */
  autoRotate?: boolean;
  /**
   * Called once if frames still run slower than 1/15 s (the median over ~2 seconds) after the
   * stage has stepped down. The world view goes back to the 2D map then.
   */
  onSlow?: () => void;
  /** Vertical field of view in degrees on tall screens and on wide ones. Default 44 and 34. */
  fov?: { tall: number; wide: number };
}

/**
 * A part of a stage that comes and goes on its own (a chunk of the world, one figure): what it
 * animates and keeps is tracked, so `release()` stops and frees just that part. Hand the scope to
 * the shared builders in place of the stage.
 */
export interface Scope extends Stage {
  release(): void;
}

export function scoped(stage: Stage): Scope {
  const stops: (() => void)[] = [];
  const kept: { dispose(): void }[] = [];
  return {
    ...stage,
    animate(fn) {
      const stop = stage.animate(fn);
      stops.push(stop);
      return stop;
    },
    glow(thing) {
      const stop = stage.glow(thing);
      stops.push(stop);
      return stop;
    },
    keep(thing) {
      kept.push(thing);
      return thing;
    },
    release() {
      for (const stop of stops.splice(0)) stop();
      for (const k of kept.splice(0)) k.dispose();
    },
  };
}

/**
 * How far the camera stands from the center it looks at, so a sphere of `radius` fills the view
 * without being cut through (issue #48): a bigger scene stands further back rather than cropping.
 * Portrait phones crop the sides a little rather than shrinking the scene to a speck; wide
 * screens show a little more around it. Pure, so `scene3d.test.ts` can pin it.
 */
export function frameDistance(radius: number, fovDeg: number, aspect: number): number {
  const vHalf = (fovDeg * Math.PI) / 360;
  const hHalf = Math.atan(Math.tan(vHalf) * aspect);
  const portrait = aspect < 1;
  const fitHalf = portrait ? Math.max(Math.min(vHalf, hHalf), vHalf * 0.62) : vHalf;
  return ((radius * (portrait ? 1 : 1.18)) / Math.sin(fitHalf)) * 1.02;
}

export function createStage(host: HTMLElement, options: StageOptions = {}): Stage {
  const quality = pickQuality();
  const still = reducedMotion();
  const renderer = new WebGLRenderer({
    antialias: true,
    powerPreference: "high-performance",
  });
  const maxRatio = Math.min(window.devicePixelRatio || 1, 2);
  renderer.setPixelRatio(maxRatio);
  renderer.outputColorSpace = SRGBColorSpace;
  // Neutral keeps brand colors close to their hex values while rolling off bright highlights.
  renderer.toneMapping = NeutralToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = PCFShadowMap;
  renderer.domElement.classList.add("stage-canvas");
  host.append(renderer.domElement);

  const disposables = new Set<{ dispose(): void }>();
  const keep = <T extends { dispose(): void }>(thing: T): T => {
    disposables.add(thing);
    return thing;
  };

  const scene = new Scene();
  const day = lightAt(undefined, CLEAR);
  const sky = keep(skyTexture(day.top, day.horizon));
  scene.background = sky.texture;
  const fog = new Fog(day.horizon, 18, 42);
  scene.fog = fog;

  // Warm sky over earthy ground, and a low sun from the south-east: storybook light. After dark the
  // same sun is the moon, so shadows never swing round (decision 0098).
  const hemi = new HemisphereLight(day.hemi.sky, day.hemi.ground, day.hemi.intensity);
  scene.add(hemi);
  const sun = new DirectionalLight(day.sun.color, day.sun.intensity);
  sun.castShadow = true;
  const mapSize = quality === "high" ? 2048 : 1024;
  sun.shadow.mapSize.set(mapSize, mapSize);
  sun.shadow.radius = quality === "high" ? 5 : 3;
  sun.shadow.bias = -0.0006;
  sun.shadow.normalBias = 0.03;
  scene.add(sun, sun.target);
  // A cool lilac fill from behind keeps shadowed sides from going muddy.
  const fill = new DirectionalLight(day.fill.color, day.fill.intensity);
  fill.position.set(-6, 4, -8);
  scene.add(fill);
  // Stars in the backdrop, after dark only. Freed with the scene.
  const stars = starField(quality === "high" ? 360 : 200);
  scene.add(stars.points);
  /** How far the haze reaches in this weather, and the framed scene's own haze, set by `fit`. */
  let reach = 1;
  let haze: { distance: number; radius: number } | undefined;
  const applyHaze = () => {
    if (!haze) return;
    fog.near = haze.distance + haze.radius * 0.4 * reach;
    fog.far = haze.distance + haze.radius * 3.2 * reach;
  };

  // ---- the time of day and the weather light the stage together (`lightAt`) ----
  let phase: number | undefined;
  let weather: SkyAmounts = CLEAR;
  /** A holiday with evenings of its own, tinting the light (RFC 0022). */
  let festive: Holiday | undefined;
  let light = day;
  let lightSeen = "";
  /** What glows after dark, each with its own flicker so no two lamps waver together. */
  const glowing = new Map<Glowing, number>();
  let seeds = 0;
  const shine = (g: Glowing, wave: number) => {
    const k = light.glow;
    if (g.kind === "pool") {
      g.material.visible = k > 0.004;
      g.material.opacity = g.opacity * k;
    } else if (g.kind === "lamp") {
      g.material.emissiveIntensity = lampLevel(g.day, g.night, k) * (g.flicker ? wave : 1);
    } else if (g.kind === "window") {
      g.material.emissiveIntensity = g.strength * k;
      if (g.opacity) g.material.opacity = g.opacity[0] + (g.opacity[1] - g.opacity[0]) * k;
    } else g.light.intensity = g.intensity * k * (g.flicker ? wave : 1);
  };
  /** Light every glow for now, wavering at `time` seconds, or steady without one. */
  const shineAll = (time?: number) => {
    for (const [g, seed] of glowing) shine(g, time === undefined ? 1 : flicker(time, seed));
  };
  const relight = () => {
    const key = `${phase === undefined ? "day" : phase.toFixed(3)}|${festive ?? ""}|${[
      weather.cloud,
      weather.rain,
      weather.snow,
      weather.fog,
    ]
      .map((v) => v.toFixed(3))
      .join()}`;
    if (key === lightSeen) return;
    lightSeen = key;
    light = lightAt(phase, weather, festive);
    sun.color.set(light.sun.color);
    sun.intensity = light.sun.intensity;
    hemi.color.set(light.hemi.sky);
    hemi.groundColor.set(light.hemi.ground);
    hemi.intensity = light.hemi.intensity;
    fill.color.set(light.fill.color);
    fill.intensity = light.fill.intensity;
    fog.color.set(light.horizon);
    sky.paint(light.top, light.horizon);
    stars.show(light.stars);
    reach = light.reach;
    applyHaze();
    shineAll();
    dirty = true;
    start();
  };

  const camera = new PerspectiveCamera(34, 1, 0.1, 200);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.enablePan = false;
  controls.rotateSpeed = 0.7;
  controls.zoomSpeed = 0.8;
  controls.maxPolarAngle = Math.PI * 0.44;
  controls.minPolarAngle = Math.PI * 0.08;
  controls.autoRotate = Boolean(options.autoRotate) && !still;
  controls.autoRotateSpeed = 0.5;
  let touched = false;
  controls.addEventListener("start", () => {
    touched = true;
    controls.autoRotate = false;
  });

  let dirty = true;
  controls.addEventListener("change", () => {
    dirty = true;
  });

  const animators: ((f: FrameInfo) => void)[] = [];
  let framing: { center: Vector3; radius: number; from: Vector3 } | undefined;

  const fit = () => {
    if (!framing) return;
    const { center, radius, from } = framing;
    const distance = frameDistance(radius, camera.fov, camera.aspect);
    camera.position.copy(center).addScaledVector(from.clone().normalize(), distance);
    controls.target.copy(center);
    controls.minDistance = distance * 0.35;
    controls.maxDistance = distance * 1.6;
    camera.near = Math.max(0.05, distance / 60);
    camera.far = distance * 8;
    // Haze starts just past the scene and swallows the far ground, whatever the distance, and comes
    // in closer in fog.
    haze = { distance, radius };
    applyHaze();
    camera.updateProjectionMatrix();
    controls.update();
  };

  const resize = () => {
    const w = Math.max(1, host.clientWidth);
    const hgt = Math.max(1, host.clientHeight);
    renderer.setSize(w, hgt, false);
    camera.aspect = w / hgt;
    // A wider lens on tall screens keeps the scene from feeling like a keyhole.
    camera.fov = camera.aspect < 0.8 ? (options.fov?.tall ?? 44) : (options.fov?.wide ?? 34);
    camera.updateProjectionMatrix();
    // Until someone moves the camera, keep the whole scene framed as the window changes shape.
    if (!touched) fit();
    dirty = true;
  };
  const observer = new ResizeObserver(resize);
  observer.observe(host);

  // ---- the loop: pauses while hidden, eases quality down if frames run long ----
  let raf = 0;
  let disposed = false;
  let last = performance.now();
  let clock = 0;
  const slow: number[] = [];
  let downgraded = false;
  let gaveUp = false;

  const loop = (now: number) => {
    raf = 0;
    if (disposed || document.hidden) return;
    raf = requestAnimationFrame(loop);
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    const moving = !still && animators.length > 0;
    if (moving) {
      clock += dt;
      for (const a of animators) a({ time: clock, dt });
      // Flames and lamps waver; with reduced motion they burn steady.
      if (light.glow > 0) shineAll(clock);
    }
    const changed = controls.update();
    if (!(moving || changed || dirty || controls.autoRotate)) return;
    dirty = false;
    stars.follow(camera, renderer.getPixelRatio());
    renderer.render(scene, camera);
    watchSpeed(dt);
  };

  /**
   * Over ~2 seconds, if most frames take longer than 1/40 s, step down once: a lower pixel ratio
   * and a smaller, cheaper shadow. Phones that keep 60 fps never notice.
   */
  const watchSpeed = (dt: number) => {
    if (gaveUp || dt <= 0) return;
    if (downgraded && !options.onSlow) return;
    slow.push(dt);
    if (slow.length < 120) return;
    const sorted = [...slow].sort((a, b) => a - b);
    const median = sorted[sorted.length >> 1] ?? 0;
    slow.length = 0;
    if (downgraded) {
      if (median > 1 / 15) {
        gaveUp = true;
        options.onSlow?.();
      }
      return;
    }
    if (median > 1 / 40) {
      downgraded = true;
      renderer.setPixelRatio(Math.min(maxRatio, 1.25));
      sun.shadow.mapSize.set(512, 512);
      sun.shadow.radius = 2;
      sun.shadow.map?.dispose();
      sun.shadow.map = null;
      resize();
    }
  };

  const start = () => {
    if (disposed || raf || document.hidden) return;
    last = performance.now();
    raf = requestAnimationFrame(loop);
  };
  const onVisibility = () => {
    if (document.hidden) {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
    } else {
      dirty = true;
      start();
    }
  };
  document.addEventListener("visibilitychange", onVisibility);

  const stage: Stage = {
    renderer,
    scene,
    camera,
    controls,
    sun,
    quality,
    reducedMotion: still,
    animate(fn) {
      animators.push(fn);
      return () => {
        const i = animators.indexOf(fn);
        if (i >= 0) animators.splice(i, 1);
      };
    },
    keep,
    frame(center, radius, from = new Vector3(0.62, 0.62, 1)) {
      framing = { center: center.clone(), radius, from: from.clone() };
      fit();
      dirty = true;
    },
    reframe() {
      fit();
      dirty = true;
    },
    light(center, radius) {
      sun.position.copy(center).add(new Vector3(radius * 0.9, radius * 1.6, radius * 1.1));
      sun.target.position.copy(center);
      const cam = sun.shadow.camera;
      const r = radius * 1.15;
      cam.left = -r;
      cam.right = r;
      cam.top = r;
      cam.bottom = -r;
      cam.near = 0.1;
      cam.far = radius * 5;
      cam.updateProjectionMatrix();
      dirty = true;
    },
    invalidate() {
      dirty = true;
      start();
    },
    skyLook(look) {
      weather = look;
      relight();
    },
    timeOfDay(at) {
      phase = at;
      relight();
    },
    holiday(h) {
      if (h === festive) return;
      festive = h;
      relight();
    },
    lightNow() {
      return light;
    },
    glow(thing) {
      glowing.set(thing, (seeds++ * 2.39996) % (Math.PI * 2));
      shine(thing, 1);
      dirty = true;
      return () => {
        glowing.delete(thing);
      };
    },
    hazeReach() {
      return reach;
    },
    photo() {
      // Draw one frame at up to 2x and copy it right away, in the same task, before the browser
      // clears the drawing buffer. Then put the screen's own size back.
      const before = renderer.getPixelRatio();
      renderer.setPixelRatio(2);
      resize();
      controls.update();
      stars.follow(camera, 2);
      renderer.render(scene, camera);
      const blob = new Promise<Blob | null>((done) => {
        try {
          renderer.domElement.toBlob(done, "image/png");
        } catch {
          done(null);
        }
      });
      renderer.setPixelRatio(before);
      resize();
      dirty = true;
      return blob;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      animators.length = 0;
      glowing.clear();
      document.removeEventListener("visibilitychange", onVisibility);
      observer.disconnect();
      controls.dispose();
      disposeTree(scene);
      for (const d of disposables) d.dispose();
      disposables.clear();
      sun.shadow.map?.dispose();
      renderer.renderLists.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
    },
  };
  relight();
  resize();
  start();
  return stage;
}

/** A sky with no weather in it. */
const CLEAR: SkyAmounts = { cloud: 0, rain: 0, snow: 0, fog: 0 };

/**
 * Add every object in `objects` to `parent`. three.js logs an error when `add()` is sent nothing,
 * which is what spreading an empty list does (a plot with no blocks yet), so an empty list adds
 * nothing. Lists of parts go in through here, never as `add(...list)`.
 */
export function addAll(parent: Object3D, objects: readonly Object3D[]): void {
  if (objects.length > 0) parent.add(...objects);
}

/**
 * Free every geometry, material, and texture under `root`. Textures in `spare` are shared with
 * things still on stage, so they're left alone.
 */
export function disposeTree(root: Object3D, spare?: ReadonlySet<Texture>) {
  root.traverse((obj) => {
    const mesh = obj as Partial<Mesh> & { dispose?: () => void };
    mesh.geometry?.dispose();
    if (mesh.material) {
      const list: Material[] = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const m of list) disposeMaterial(m, spare);
    }
    // InstancedMesh frees its instance buffers here.
    if (obj !== root && typeof mesh.dispose === "function" && "isInstancedMesh" in obj)
      mesh.dispose();
  });
  if (root instanceof Scene && root.background instanceof Texture) root.background.dispose();
}

function disposeMaterial(m: Material, spare?: ReadonlySet<Texture>) {
  for (const value of Object.values(m))
    if (value instanceof Texture && !spare?.has(value)) value.dispose();
  m.dispose();
}

// ---------- textures, drawn on a canvas so nothing loads from anywhere ----------

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return [c, c.getContext("2d") as CanvasRenderingContext2D];
}

export function canvasTexture(c: HTMLCanvasElement, repeat = false): CanvasTexture {
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  t.anisotropy = 4;
  if (repeat) t.wrapS = t.wrapT = RepeatWrapping;
  return t;
}

/**
 * Paper sky: warm cream at the top, sand at the horizon, so the fog meets it without a seam. The
 * time of day and the weather paint it (`lightAt`), with the horizon always the haze's own color.
 */
function skyTexture(
  top: number,
  horizon: number,
): {
  texture: CanvasTexture;
  paint(top: number, horizon: number): void;
  dispose(): void;
} {
  const [c, g] = canvas(4, 256);
  const texture = canvasTexture(c);
  const css = (color: number) => `#${color.toString(16).padStart(6, "0")}`;
  const paint = (top: number, horizon: number) => {
    const grad = g.createLinearGradient(0, 0, 0, 256);
    grad.addColorStop(0, css(top));
    grad.addColorStop(0.62, css(horizon));
    grad.addColorStop(1, css(horizon));
    g.fillStyle = grad;
    g.fillRect(0, 0, 4, 256);
    texture.needsUpdate = true;
  };
  paint(top, horizon);
  return { texture, paint, dispose: () => texture.dispose() };
}

/** How big a star is drawn, in CSS pixels. */
const STAR_PX = 2.4;

/**
 * Stars for the night sky (decision 0098), part of the backdrop like the sky's gradient: `count`
 * points spread over the top half of the view, held just inside the camera's far plane so whatever
 * the scene draws hides them and they show only where the backdrop does, fainter toward the haze.
 * Both 3D cameras look down, so the true horizon is never on screen and a dome of stars would be.
 * One draw, shown only after dark, never hazed by the fog.
 */
function starField(count: number): {
  points: Points;
  /** Show this much of the stars' brightness, 0 to 1. */
  show(amount: number): void;
  /** Hold them in front of the camera, filling its view, at this pixel ratio. */
  follow(camera: PerspectiveCamera, pixelRatio: number): void;
} {
  const rand = rng(41);
  const at = new Float32Array(count * 3);
  const colors = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) {
    // Across the view (-1 to 1), and from its middle up past the top edge (0 to 1.05).
    const x = rand() * 2 - 1;
    const y = rand() * 1.05;
    at.set([x, y, 0], i * 3);
    const bright = 0.45 + rand() * 0.55;
    const warm = rand() > 0.8 ? 1 : 0.88;
    const fade = Math.min(1, y / 0.6);
    colors.set([bright * warm, bright * 0.94, bright, fade * fade], i * 4);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(at, 3));
  geometry.setAttribute("color", new BufferAttribute(colors, 4));
  const material = new PointsMaterial({
    size: STAR_PX,
    sizeAttenuation: false,
    map: spotTexture("255, 255, 255"),
    vertexColors: true,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    fog: false,
  });
  const points = new Points(geometry, material);
  points.name = "stars";
  // Drawn first of the see-through things, so the ground's soft edge lies over them.
  points.renderOrder = -2;
  points.frustumCulled = false;
  points.visible = false;
  return {
    points,
    show(amount) {
      points.visible = amount > 0.01;
      material.opacity = amount;
    },
    follow(camera, pixelRatio) {
      if (!points.visible) return;
      const far = camera.far * 0.94;
      const half = far * Math.tan((camera.fov * Math.PI) / 360);
      points.position.copy(camera.position);
      points.quaternion.copy(camera.quaternion);
      points.translateZ(-far);
      points.scale.set(half * camera.aspect, half, 1);
      material.size = STAR_PX * pixelRatio;
    },
  };
}

/** Small seeded random for texture noise. Visual only. */
function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) % 10000) / 10000;
  };
}

/** Pale paper fibers: multiplies whatever color a material has, so everything feels printed. */
export function grainTexture(): CanvasTexture {
  const size = 128;
  const [c, g] = canvas(size, size);
  const rand = rng(7);
  const img = g.createImageData(size, size);
  for (let i = 0; i < size * size; i++) {
    const v = 242 + rand() * 13;
    img.data[i * 4] = v;
    img.data[i * 4 + 1] = v - 2;
    img.data[i * 4 + 2] = v - 6;
    img.data[i * 4 + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  // A few longer fibers.
  g.strokeStyle = "rgba(120, 90, 50, 0.06)";
  for (let i = 0; i < 40; i++) {
    g.beginPath();
    const x = rand() * size;
    const y = rand() * size;
    g.moveTo(x, y);
    g.lineTo(x + (rand() - 0.5) * 30, y + (rand() - 0.5) * 30);
    g.stroke();
  }
  return canvasTexture(c, true);
}

/** Planks for wood: three boards with soft seams and a little grain. */
export function plankTexture(): CanvasTexture {
  const size = 128;
  const [c, g] = canvas(size, size);
  const rand = rng(11);
  g.fillStyle = "#f4ece0";
  g.fillRect(0, 0, size, size);
  const boards = 3;
  for (let b = 0; b < boards; b++) {
    const y = (b * size) / boards;
    const tone = 228 + rand() * 24;
    g.fillStyle = `rgb(${tone}, ${tone - 3}, ${tone - 7})`;
    g.fillRect(0, y + 2, size, size / boards - 3);
    g.strokeStyle = "rgba(110, 70, 30, 0.12)";
    for (let i = 0; i < 5; i++) {
      g.beginPath();
      const gy = y + 6 + rand() * (size / boards - 12);
      g.moveTo(0, gy);
      g.bezierCurveTo(size * 0.3, gy + 2, size * 0.6, gy - 2, size, gy + 1);
      g.stroke();
    }
    g.fillStyle = "rgba(90, 55, 25, 0.35)";
    g.fillRect(0, y, size, 2);
  }
  return canvasTexture(c, true);
}

/** Stones for stone: two staggered rows of rounded blocks with soft mortar. */
export function stoneTexture(): CanvasTexture {
  const size = 128;
  const [c, g] = canvas(size, size);
  const rand = rng(23);
  g.fillStyle = "#d9d3c8";
  g.fillRect(0, 0, size, size);
  const rows = 3;
  const rowH = size / rows;
  for (let r = 0; r < rows; r++) {
    const offset = r % 2 ? size / 4 : 0;
    for (let k = -1; k < 2; k++) {
      const x = k * (size / 2) + offset;
      const tone = 236 + rand() * 19;
      g.fillStyle = `rgb(${tone}, ${tone - 2}, ${tone - 6})`;
      g.beginPath();
      g.roundRect(x + 3, r * rowH + 3, size / 2 - 6, rowH - 6, 7);
      g.fill();
    }
  }
  return canvasTexture(c, true);
}

/** A soft round spot: blob shadows under figures and the warm glow around a hearth. */
export function spotTexture(color = "0, 0, 0"): CanvasTexture {
  const [c, g] = canvas(64, 64);
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, `rgba(${color}, 1)`);
  grad.addColorStop(0.5, `rgba(${color}, 0.45)`);
  grad.addColorStop(1, `rgba(${color}, 0)`);
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  return canvasTexture(c);
}

// ---------- materials and shading ----------

/** Matte paper: Lambert with the grain texture, vertex colors on so baked shade shows. */
export function paper(
  color: number,
  map: Texture | null,
  extra: MeshLambertMaterialParameters = {},
): MeshLambertMaterial {
  return new MeshLambertMaterial({ color, map, vertexColors: true, ...extra });
}

/**
 * Bake a soft top-to-bottom shade into a geometry's vertex colors: the base sits in shadow and
 * the top catches light, a cheap stand-in for ambient occlusion.
 */
export function bakeShade(geometry: BufferGeometry, bottom = 0.68, top = 1): BufferGeometry {
  const pos = geometry.getAttribute("position");
  geometry.computeBoundingBox();
  const box = geometry.boundingBox;
  const y0 = box ? box.min.y : 0;
  const span = box ? Math.max(1e-6, box.max.y - box.min.y) : 1;
  const colors = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const t = (pos.getY(i) - y0) / span;
    // Ease so most of the darkening hugs the very bottom.
    const k = bottom + (top - bottom) * Math.sqrt(Math.min(1, Math.max(0, t)));
    colors[i * 3] = k;
    colors[i * 3 + 1] = k;
    colors[i * 3 + 2] = k;
  }
  geometry.setAttribute("color", new BufferAttribute(colors, 3));
  return geometry;
}

/** The geometry without an index, for merging. Many shapes (rounded boxes, extrusions) have none. */
export function unindexed(geometry: BufferGeometry): BufferGeometry {
  return geometry.index ? geometry.toNonIndexed() : geometry;
}

/** Plain white vertex colors, for geometry that should show its material color as is. */
export function noShade(geometry: BufferGeometry): BufferGeometry {
  return bakeShade(geometry, 1, 1);
}

export interface Wind {
  /** Call with the stage's time every frame. */
  tick(time: number): void;
}

/**
 * Make a material sway in the breeze: vertices move more the higher they sit above their origin,
 * phased by where the instance (or object) stands. All on the GPU, so a meadow costs nothing.
 */
export function addWind(material: Material, strength = 0.06): Wind {
  const uniforms = { uTime: { value: 0 }, uSway: { value: strength } };
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = uniforms.uTime;
    shader.uniforms.uSway = uniforms.uSway;
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nuniform float uTime;\nuniform float uSway;")
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
        #ifdef USE_INSTANCING
          vec3 windAt = instanceMatrix[3].xyz;
        #else
          vec3 windAt = modelMatrix[3].xyz;
        #endif
        float windH = max(position.y, 0.0);
        float windK = windH * windH * uSway;
        transformed.x += sin(uTime * 1.4 + windAt.x * 0.9 + windAt.z * 0.5) * windK;
        transformed.z += cos(uTime * 1.1 + windAt.z * 0.8 + windAt.x * 0.3) * windK * 0.6;`,
      );
  };
  material.customProgramCacheKey = () => `wind-${strength}`;
  return {
    tick(time) {
      uniforms.uTime.value = time;
    },
  };
}

/** A soft round shadow lying on the ground, for things too small to cast a crisp one. */
export function blobShadow(map: Texture, radius: number, opacity = 0.28): Mesh {
  const m = new Mesh(
    new CircleGeometry(radius, 20),
    new MeshBasicMaterial({
      map,
      color: 0x3c2a14,
      transparent: true,
      opacity,
      depthWrite: false,
    }),
  );
  m.rotation.x = -Math.PI / 2;
  m.position.y = 0.012;
  m.renderOrder = 1;
  return m;
}

/** A linear-space color from a palette number, for vertex color math. */
export function lin(hex: number): Color {
  return new Color(hex);
}

/** Paper tag with a name on it, drawn on a canvas. Canvas text can't run anything. */
export function nameTag(text: string, mine: boolean): { texture: CanvasTexture; aspect: number } {
  const scale = 3;
  const font = `600 ${15 * scale}px "Figtree Variable", system-ui, sans-serif`;
  const [probe, pg] = canvas(4, 4);
  pg.font = font;
  const clipped = text.length > 28 ? `${text.slice(0, 27)}…` : text;
  const w = Math.ceil(pg.measureText(clipped).width + 22 * scale);
  const h = 26 * scale;
  probe.remove();
  const [c, g] = canvas(w + 4 * scale, h + 4 * scale);
  g.fillStyle = "rgba(74, 52, 28, 0.18)";
  g.beginPath();
  g.roundRect(2 * scale, 3.5 * scale, w, h, h / 2);
  g.fill();
  g.fillStyle = BRAND_HEX.paper;
  g.strokeStyle = mine ? BRAND_HEX.clay : BRAND_HEX.paperEdge;
  g.lineWidth = 1.5 * scale;
  g.beginPath();
  g.roundRect(2 * scale, 2 * scale, w, h, h / 2);
  g.fill();
  g.stroke();
  g.fillStyle = mine ? BRAND_HEX.clayDeep : BRAND_HEX.ink;
  g.font = font;
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText(clipped, 2 * scale + w / 2, 2 * scale + h / 2 + scale);
  return { texture: canvasTexture(c), aspect: c.width / c.height };
}
