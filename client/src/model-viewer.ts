/**
 * A small three.js viewer for one .glb model. Loaded with `import()` only when someone taps a model,
 * so three.js never weighs on the feed (see decision 0013). Warm, soft light; turns slowly on its
 * own until touched; follows its box's size; everything is freed when the viewer closes.
 */

import { isModelResource } from "@terrakin/ui/format";
import {
  Box3,
  DirectionalLight,
  HemisphereLight,
  LoadingManager,
  type Material,
  Mesh,
  type Object3D,
  PerspectiveCamera,
  Scene,
  SRGBColorSpace,
  Texture,
  Vector3,
  WebGLRenderer,
} from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

export interface ModelViewerOptions {
  onLoaded?(): void;
  onError?(err: unknown): void;
}

/** Show the model at `url` inside `host`. Returns a function that tears everything down. */
export function showModel(host: HTMLElement, url: string, options: ModelViewerOptions = {}) {
  const renderer = new WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.setClearColor(0x000000, 0);
  host.append(renderer.domElement);

  const scene = new Scene();
  // Warm sky, earthy ground, and a low sun from the side: storybook light, no harsh shadows.
  scene.add(new HemisphereLight(0xfff3dc, 0x8a6a48, 1.3));
  const sun = new DirectionalLight(0xffe2b8, 1.8);
  sun.position.set(3, 5, 4);
  scene.add(sun);
  const fill = new DirectionalLight(0xcdb4f6, 0.6);
  fill.position.set(-4, 2, -3);
  scene.add(fill);

  const camera = new PerspectiveCamera(40, 1, 0.01, 1000);
  camera.position.set(2.2, 1.6, 2.6);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.enablePan = false;
  controls.autoRotate = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  controls.autoRotateSpeed = 1.6;
  // The first touch hands control to the person.
  controls.addEventListener("start", () => {
    controls.autoRotate = false;
  });

  let model: Object3D | undefined;
  let frame = 0;
  let disposed = false;

  const resize = () => {
    const w = Math.max(1, host.clientWidth);
    const hgt = Math.max(1, host.clientHeight);
    renderer.setSize(w, hgt, false);
    renderer.domElement.style.width = "100%";
    renderer.domElement.style.height = "100%";
    camera.aspect = w / hgt;
    camera.updateProjectionMatrix();
  };
  const observer = new ResizeObserver(resize);
  observer.observe(host);
  resize();

  const tick = () => {
    frame = requestAnimationFrame(tick);
    controls.update();
    renderer.render(scene, camera);
  };
  tick();

  // A .glb can point at other files (buffers, textures) by URL. Only inline data, the loader's own
  // blobs, and our own media may load; anything else becomes an empty data URL and fails quietly.
  const manager = new LoadingManager();
  manager.setURLModifier((u) => (isModelResource(u, location.origin) ? u : "data:,"));

  new GLTFLoader(manager).load(
    url,
    (gltf) => {
      if (disposed) {
        disposeObject(gltf.scene);
        return;
      }
      model = gltf.scene;
      // Center it and frame it so any size of model fills the view nicely.
      const box = new Box3().setFromObject(model);
      const size = box.getSize(new Vector3());
      const center = box.getCenter(new Vector3());
      model.position.sub(center);
      scene.add(model);
      // Fit the bounding sphere inside the narrower of the two fields of view (portrait phones).
      const radius = Math.max(size.length() / 2, 0.001);
      const vHalf = (camera.fov * Math.PI) / 360;
      const hHalf = Math.atan(Math.tan(vHalf) * camera.aspect);
      const distance = (radius / Math.sin(Math.min(vHalf, hHalf))) * 1.05;
      camera.position.copy(new Vector3(0.62, 0.42, 0.66).normalize().multiplyScalar(distance));
      camera.near = distance / 100;
      camera.far = distance * 100;
      camera.updateProjectionMatrix();
      controls.minDistance = distance * 0.35;
      controls.maxDistance = distance * 3;
      controls.target.set(0, 0, 0);
      controls.update();
      options.onLoaded?.();
    },
    undefined,
    (err) => {
      if (!disposed) options.onError?.(err);
    },
  );

  return () => {
    disposed = true;
    cancelAnimationFrame(frame);
    observer.disconnect();
    controls.dispose();
    if (model) disposeObject(model);
    renderer.dispose();
    renderer.forceContextLoss();
    renderer.domElement.remove();
  };
}

/** Free a model's geometry, materials, and textures. */
function disposeObject(root: Object3D) {
  root.traverse((obj) => {
    if (!(obj instanceof Mesh)) return;
    obj.geometry.dispose();
    const materials: Material[] = Array.isArray(obj.material) ? obj.material : [obj.material];
    for (const m of materials) {
      for (const value of Object.values(m)) if (value instanceof Texture) value.dispose();
      m.dispose();
    }
  });
}
