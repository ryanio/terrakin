import { SEASON_GROUND, seasonTone } from "@terrakin/sim";
import {
  BufferAttribute,
  type Color,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshLambertMaterial,
  PlaneGeometry,
  Quaternion,
  type Texture,
  Vector3,
} from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { bakeShade, lin, paper } from "./art";
import { type Bounds, cornerLight, type PlotLayout, tileHash } from "./layout";
import { BRAND, hex, mix, SKY } from "./palette";

// ---------- ground ----------

/** One corner of a ground grid: its color (linear) and how opaque it is. */
export interface GroundCorner {
  color: Color;
  alpha: number;
}

/**
 * A square grid of ground, `n` tiles a side from tile corner (x0 - 0.5, y0 - 0.5), one vertex per
 * tile corner. `corner(cx, cy)` colors the corner shared by tiles (cx - 1 .. cx, cy - 1 .. cy).
 * Shared by the plot and the world, so both lay their ground the same way.
 */
export function groundGrid(
  x0: number,
  y0: number,
  n: number,
  origin: { x: number; y: number },
  corner: (cx: number, cy: number, distance: number) => GroundCorner,
): Mesh {
  const geo = new PlaneGeometry(n, n, n, n);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.getAttribute("position");
  const colors = new Float32Array(pos.count * 4);
  const cx0 = x0 + n / 2 - 0.5;
  const cy0 = y0 + n / 2 - 0.5;
  for (let i = 0; i < pos.count; i++) {
    const lx = pos.getX(i);
    const lz = pos.getZ(i);
    const cx = Math.round(lx + cx0 + 0.5);
    const cy = Math.round(lz + cy0 + 0.5);
    const { color, alpha } = corner(cx, cy, Math.hypot(lx, lz));
    colors[i * 4] = color.r;
    colors[i * 4 + 1] = color.g;
    colors[i * 4 + 2] = color.b;
    colors[i * 4 + 3] = alpha;
  }
  geo.setAttribute("color", new BufferAttribute(colors, 4));
  const mesh = new Mesh(
    geo,
    new MeshLambertMaterial({ vertexColors: true, transparent: true, depthWrite: true }),
  );
  mesh.position.set(cx0 - origin.x, 0, cy0 - origin.y);
  mesh.receiveShadow = true;
  mesh.renderOrder = -1;
  return mesh;
}

/**
 * The ground around the plot: meadow tints by hash, a warmer tint on the plot, the sand of the
 * world's edge, soft shade around blocks, and a radial fade so the edge melts into the sky.
 */
export function ground(layout: PlotLayout, solid: ReadonlySet<string>): Mesh {
  const ring = layout.margin + 14;
  const n = layout.size + ring * 2;
  // The world's meadow, as the season wears it.
  const grass = SEASON_GROUND[layout.season ?? "summer"].ground.meadow.map((c) => lin(hex(c)));
  const plotTint = lin(hex(seasonTone("#b4cd86", layout.season)));
  const sand = lin(BRAND.sand);
  const fog = lin(SKY.fog);
  const fadeStart = layout.size / 2 + layout.margin + 2;
  const fadeEnd = n / 2 - 0.5;
  // Plot centers sit between tiles on even plots; the grid is centered on the plot.
  return groundGrid(
    layout.bounds.x0 - ring,
    layout.bounds.y0 - ring,
    n,
    layout.center,
    (cx, cy, d) => {
      const tx = cx - 1 + ((cx + cy) & 1);
      const ty = cy - 1;
      const onPlot =
        cx > layout.bounds.x0 &&
        cx <= layout.bounds.x1 &&
        cy > layout.bounds.y0 &&
        cy <= layout.bounds.y1;
      let c = (grass[tileHash(tx, ty) & 3] ?? plotTint).clone();
      if (onPlot) c.lerp(plotTint, 0.5);
      if (!layout.inWorld(tx, ty)) c = sand.clone();
      c.multiplyScalar(cornerLight(solid, cx, cy));
      const t = Math.min(1, Math.max(0, (d - fadeStart) / (fadeEnd - fadeStart)));
      c.lerp(fog, t * t * 0.9);
      return { color: c, alpha: 1 - t * t * t };
    },
  );
}

/** A plot's edge as a dashed line of little clay stepping stones, like the 2D map's border. */
export function border(
  bounds: Bounds,
  origin: { x: number; y: number },
  grain: Texture,
): InstancedMesh {
  const S = bounds.x1 - bounds.x0 + 1;
  const half = S / 2;
  const mx = (bounds.x0 + bounds.x1) / 2 - origin.x;
  const mz = (bounds.y0 + bounds.y1) / 2 - origin.y;
  const geo = bakeShade(new RoundedBoxGeometry(0.42, 0.06, 0.12, 2, 0.025), 0.8, 1);
  const mat = paper(mix(BRAND.clay, BRAND.paperEdge, 0.3), grain);
  const mesh = new InstancedMesh(geo, mat, S * 4);
  const m = new Matrix4();
  const q = new Quaternion();
  const up = new Vector3(0, 1, 0);
  let i = 0;
  for (let k = 0; k < S; k++) {
    const along = -half + k + 0.5;
    for (const [x, z, turn] of [
      [along, -half, 0],
      [along, half, 0],
      [-half, along, Math.PI / 2],
      [half, along, Math.PI / 2],
    ] as const) {
      q.setFromAxisAngle(up, turn);
      m.compose(new Vector3(mx + x, 0.03, mz + z), q, new Vector3(1, 1, 1));
      mesh.setMatrixAt(i++, m);
    }
  }
  mesh.receiveShadow = true;
  return mesh;
}
