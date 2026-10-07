import { isModelResource } from "@terrakin/ui/format";
import {
  Box3,
  type BufferGeometry,
  Group,
  LoadingManager,
  type Material,
  Mesh,
  MeshLambertMaterial,
  SRGBColorSpace,
  type Texture,
  TextureLoader,
  Vector3,
} from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { bakeShade, disposeTree, type Stage } from "./art";
import { painting } from "./items";
import { fitModel, inBounds, overBudget, type PlotLayout } from "./layout";

// ---------- a resident's own home model and picture ----------

/** A manager that lets a model or texture load only our own media, inline data, or its blobs. */
function sameOriginManager(): LoadingManager {
  const manager = new LoadingManager();
  manager.setURLModifier((u) => (isModelResource(u, location.origin) ? u : "data:,"));
  return manager;
}

/** Load their .glb, refuse it if it's over budget, then fit it on the footprint. */
export async function loadHomeModel(
  stage: Stage,
  root: Group,
  url: string,
  at: { x: number; z: number; fit: { width: number; height: number; depth: number } },
): Promise<boolean> {
  const gltf = await new GLTFLoader(sameOriginManager()).loadAsync(url);
  const model = gltf.scene;
  let triangles = 0;
  let texturePixels = 0;
  const textures = new Set<Texture>();
  model.traverse((o) => {
    if (!(o instanceof Mesh)) return;
    const g = o.geometry as BufferGeometry;
    const count = g.index ? g.index.count : (g.getAttribute("position")?.count ?? 0);
    triangles += count / 3;
    const mats: Material[] = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of mats)
      for (const v of Object.values(m))
        if (v && (v as Texture).isTexture) textures.add(v as Texture);
  });
  for (const t of textures) {
    const img = t.image as { width?: number; height?: number } | undefined;
    texturePixels += (img?.width ?? 0) * (img?.height ?? 0);
  }
  if (overBudget({ triangles, texturePixels, textures: textures.size })) {
    disposeTree(model);
    for (const t of textures) t.dispose();
    return false;
  }
  if (!root.parent) {
    // The page closed while it loaded.
    disposeTree(model);
    return true;
  }
  model.updateMatrixWorld(true);
  const box = new Box3().setFromObject(model);
  const { scale, offset } = fitModel(
    { min: [box.min.x, box.min.y, box.min.z], max: [box.max.x, box.max.y, box.max.z] },
    at.fit,
  );
  const holder = new Group();
  model.scale.multiplyScalar(scale);
  model.position.multiplyScalar(scale).add(new Vector3(...offset));
  holder.add(model);
  holder.position.set(at.x, 0, at.z);
  model.traverse((o) => {
    if (o instanceof Mesh) {
      o.castShadow = true;
      o.receiveShadow = true;
    }
  });
  root.add(holder);
  stage.invalidate();
  return true;
}

/** Their picture as a painted sign on two posts, by the front of the plot. */
export async function loadSign(stage: Stage, root: Group, url: string, layout: PlotLayout) {
  const texture = await new TextureLoader(sameOriginManager()).loadAsync(url);
  texture.colorSpace = SRGBColorSpace;
  if (!root.parent) {
    texture.dispose();
    return;
  }
  const img = texture.image as { width?: number; height?: number };
  const aspect = (img.width ?? 4) / Math.max(1, img.height ?? 3);
  const sign = new Group();
  const pic = painting(texture, aspect, 0.9);
  pic.position.y = 0.75;
  const postMat = new MeshLambertMaterial({ color: 0x7a4f2c, vertexColors: true });
  const width = 0.9 * Math.min(1.9, Math.max(0.55, aspect));
  for (const x of [-width / 2 - 0.05, width / 2 + 0.05]) {
    const post = new Mesh(
      bakeShade(new RoundedBoxGeometry(0.08, 1.25, 0.08, 1, 0.02), 0.7, 1),
      postMat,
    );
    post.position.set(x, 0.62, -0.02);
    post.castShadow = true;
    sign.add(post);
  }
  sign.add(pic);
  // South-east corner of the plot, turned toward the usual camera, unless a block is in the way.
  const { x1, y1 } = layout.bounds;
  let spot = { x: x1 - 0.5, y: y1 - 0.2 };
  if (layout.blocks.some((b) => inBounds({ x0: x1 - 1, y0: y1 - 1, x1, y1 }, b.x, b.y)))
    spot = { x: layout.center.x, y: layout.bounds.y1 + 0.2 };
  sign.position.set(spot.x - layout.center.x, 0, spot.y - layout.center.y);
  sign.rotation.y = 0.45;
  root.add(sign);
  stage.invalidate();
}
