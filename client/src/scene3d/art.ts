/**
 * The 3D art direction, shared by every 3D view: storybook low-poly under soft warm light, paper
 * matte materials in the brand palette, shade baked into vertex colors, a soft ground disc that
 * melts into a paper sky, and small idle motions that stop for prefers-reduced-motion.
 *
 * Performance budget (decision 0021): device pixel ratio capped at 2, one shadow-casting sun
 * (2048 soft on desktop, 1024 on phones, dropped if frames run slow), Lambert materials, instanced
 * meshes for repeated things, no post-processing. Rendering pauses while the tab is hidden, and
 * `dispose()` frees every geometry, material, texture, and the WebGL context.
 *
 * Loaded only through `import()` (decision 0013): nothing in the main bundle imports this file.
 */
import {
  BufferAttribute,
  type BufferGeometry,
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
  NeutralToneMapping,
  type Object3D,
  PCFShadowMap,
  PerspectiveCamera,
  RepeatWrapping,
  Scene,
  SRGBColorSpace,
  Texture,
  Vector3,
  WebGLRenderer,
} from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { SKY } from "./palette";

export type Quality = "high" | "phone";

/** Phones and small tablets get the cheaper light. Touch-first or a small screen counts. */
export function pickQuality(): Quality {
  const coarse = window.matchMedia("(pointer: coarse)").matches;
  const small = Math.min(window.screen.width, window.screen.height) < 700;
  return coarse || small ? "phone" : "high";
}

export interface FrameInfo {
  /** Seconds since the stage started (frozen when motion is reduced). */
  time: number;
  /** Seconds since the last frame, capped so a paused tab doesn't jump. */
  dt: number;
}

export interface Stage {
  renderer: WebGLRenderer;
  scene: Scene;
  camera: PerspectiveCamera;
  controls: OrbitControls;
  sun: DirectionalLight;
  quality: Quality;
  reducedMotion: boolean;
  /** Run every frame (only while motion is allowed). */
  animate(fn: (f: FrameInfo) => void): void;
  /** Free this with the stage even though it isn't in the scene (shared textures, say). */
  keep<T extends { dispose(): void }>(thing: T): T;
  /** Point the camera at a sphere so it fills the view, from a direction (from the target). */
  frame(center: Vector3, radius: number, from?: Vector3): void;
  /** Light and shadow sized to a scene of this radius around `center`. */
  light(center: Vector3, radius: number): void;
  /** Ask for one more frame (reduced motion renders only when something changes). */
  invalidate(): void;
  /** A PNG of the current view at up to 2x, or null if the browser can't make one. */
  photo(): Promise<Blob | null>;
  dispose(): void;
}

export interface StageOptions {
  /** Turn slowly until someone touches it. */
  autoRotate?: boolean;
}

export function createStage(host: HTMLElement, options: StageOptions = {}): Stage {
  const quality = pickQuality();
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
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
  scene.background = keep(skyTexture());
  const fog = new Fog(SKY.fog, 18, 42);
  scene.fog = fog;

  // Warm sky over earthy ground, and a low sun from the south-east: storybook light.
  const hemi = new HemisphereLight(0xfff6e8, 0x8f8a64, 1.3);
  scene.add(hemi);
  const sun = new DirectionalLight(0xffe8c8, 2.5);
  sun.castShadow = true;
  const mapSize = quality === "high" ? 2048 : 1024;
  sun.shadow.mapSize.set(mapSize, mapSize);
  sun.shadow.radius = quality === "high" ? 5 : 3;
  sun.shadow.bias = -0.0006;
  sun.shadow.normalBias = 0.03;
  scene.add(sun, sun.target);
  // A cool lilac fill from behind keeps shadowed sides from going muddy.
  const fill = new DirectionalLight(0xd9c8f4, 0.55);
  fill.position.set(-6, 4, -8);
  scene.add(fill);

  const camera = new PerspectiveCamera(34, 1, 0.1, 200);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.enablePan = false;
  controls.rotateSpeed = 0.7;
  controls.zoomSpeed = 0.8;
  controls.maxPolarAngle = Math.PI * 0.44;
  controls.minPolarAngle = Math.PI * 0.08;
  controls.autoRotate = Boolean(options.autoRotate) && !reducedMotion;
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
    const vHalf = (camera.fov * Math.PI) / 360;
    const hHalf = Math.atan(Math.tan(vHalf) * camera.aspect);
    // Portrait phones crop the sides a little rather than shrinking the scene to a speck.
    // Wide screens have room to show a little more around the scene.
    const portrait = camera.aspect < 1;
    const fitHalf = portrait ? Math.max(Math.min(vHalf, hHalf), vHalf * 0.62) : vHalf;
    const distance = ((radius * (portrait ? 1 : 1.18)) / Math.sin(fitHalf)) * 1.02;
    camera.position.copy(center).addScaledVector(from.clone().normalize(), distance);
    controls.target.copy(center);
    controls.minDistance = distance * 0.35;
    controls.maxDistance = distance * 1.6;
    camera.near = Math.max(0.05, distance / 60);
    camera.far = distance * 8;
    // Haze starts just past the scene and swallows the far ground, whatever the distance.
    fog.near = distance + radius * 0.4;
    fog.far = distance + radius * 3.2;
    camera.updateProjectionMatrix();
    controls.update();
  };

  const resize = () => {
    const w = Math.max(1, host.clientWidth);
    const hgt = Math.max(1, host.clientHeight);
    renderer.setSize(w, hgt, false);
    camera.aspect = w / hgt;
    // A wider lens on tall screens keeps the scene from feeling like a keyhole.
    camera.fov = camera.aspect < 0.8 ? 44 : 34;
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

  const loop = (now: number) => {
    raf = 0;
    if (disposed || document.hidden) return;
    raf = requestAnimationFrame(loop);
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    const moving = !reducedMotion && animators.length > 0;
    if (moving) {
      clock += dt;
      for (const a of animators) a({ time: clock, dt });
    }
    const changed = controls.update();
    if (!(moving || changed || dirty || controls.autoRotate)) return;
    dirty = false;
    renderer.render(scene, camera);
    watchSpeed(dt);
  };

  /**
   * Over ~2 seconds, if most frames take longer than 1/40 s, step down once: a lower pixel ratio
   * and a smaller, cheaper shadow. Phones that keep 60 fps never notice.
   */
  const watchSpeed = (dt: number) => {
    if (downgraded || dt <= 0) return;
    slow.push(dt);
    if (slow.length < 120) return;
    const sorted = [...slow].sort((a, b) => a - b);
    const median = sorted[sorted.length >> 1] ?? 0;
    slow.length = 0;
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
    reducedMotion,
    animate(fn) {
      animators.push(fn);
    },
    keep,
    frame(center, radius, from = new Vector3(0.62, 0.62, 1)) {
      framing = { center: center.clone(), radius, from: from.clone() };
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
    photo() {
      // Draw one frame at up to 2x and copy it right away, in the same task, before the browser
      // clears the drawing buffer. Then put the screen's own size back.
      const before = renderer.getPixelRatio();
      renderer.setPixelRatio(2);
      resize();
      controls.update();
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
  resize();
  start();
  return stage;
}

/** Free every geometry, material, and texture under `root`. */
export function disposeTree(root: Object3D) {
  root.traverse((obj) => {
    const mesh = obj as Partial<Mesh> & { dispose?: () => void };
    mesh.geometry?.dispose();
    if (mesh.material) {
      const list: Material[] = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const m of list) disposeMaterial(m);
    }
    // InstancedMesh frees its instance buffers here.
    if (obj !== root && typeof mesh.dispose === "function" && "isInstancedMesh" in obj)
      mesh.dispose();
  });
  if (root instanceof Scene && root.background instanceof Texture) root.background.dispose();
}

export function disposeMaterial(m: Material) {
  for (const value of Object.values(m)) if (value instanceof Texture) value.dispose();
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

/** Paper sky: warm cream at the top, sand at the horizon, so the fog meets it without a seam. */
function skyTexture(): CanvasTexture {
  const [c, g] = canvas(4, 256);
  const grad = g.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, SKY.top);
  grad.addColorStop(0.62, SKY.horizon);
  grad.addColorStop(1, SKY.horizon);
  g.fillStyle = grad;
  g.fillRect(0, 0, 4, 256);
  return canvasTexture(c);
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
  g.fillStyle = "#fffaf0";
  g.strokeStyle = mine ? "#b4532f" : "#ecdcc0";
  g.lineWidth = 1.5 * scale;
  g.beginPath();
  g.roundRect(2 * scale, 2 * scale, w, h, h / 2);
  g.fill();
  g.stroke();
  g.fillStyle = mine ? "#8f3d20" : "#2b2620";
  g.font = font;
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText(clipped, 2 * scale + w / 2, 2 * scale + h / 2 + scale);
  return { texture: canvasTexture(c), aspect: c.width / c.height };
}
