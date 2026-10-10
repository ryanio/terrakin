import { type BlockKind, GROUND_KINDS, type GroundKind } from "@terrakin/sim";
import { paintGround } from "@terrakin/ui/ground-art";
import {
  BufferAttribute,
  BufferGeometry,
  type CanvasTexture,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshLambertMaterial,
  Quaternion,
  type Texture,
  Vector3,
} from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { bakeShade, canvasTexture, lin, paper } from "./art";
import { floorY } from "./layout";
import { blockLook, mix, SKY, shade } from "./palette";

// ---------- paths and flooring (RFC 0016) ----------

/** Cells across and down the ground atlas, and each cell's side in pixels. */
const ATLAS_CELLS = 4;
const ATLAS_CELL = 64;

/**
 * Every kind of path and flooring drawn once into one texture, a cell each, from the sim's looks (the same
 * drawing the map uses), so all the ground on a plot is one draw. Stepping stones leave their
 * cell's background clear, and the grass under them shows. About 340 kB with mipmaps.
 */
export function groundAtlas(): CanvasTexture {
  const side = ATLAS_CELLS * ATLAS_CELL;
  const c = document.createElement("canvas");
  c.width = side;
  c.height = side;
  const ctx = c.getContext("2d") as CanvasRenderingContext2D;
  GROUND_KINDS.forEach((kind, i) => {
    const x = (i % ATLAS_CELLS) * ATLAS_CELL;
    const y = Math.floor(i / ATLAS_CELLS) * ATLAS_CELL;
    paintGround(ctx, kind, x, y, ATLAS_CELL, ATLAS_CELL);
  });
  return canvasTexture(c);
}

/** A kind's cell in the atlas as UVs, inset a little so neighbors don't bleed in at a distance. */
function atlasCell(kind: GroundKind): [number, number, number, number] {
  const i = GROUND_KINDS.indexOf(kind);
  const side = ATLAS_CELLS * ATLAS_CELL;
  const inset = 2 / side;
  const u0 = ((i % ATLAS_CELLS) * ATLAS_CELL) / side + inset;
  const v1 = 1 - (Math.floor(i / ATLAS_CELLS) * ATLAS_CELL) / side - inset;
  const cell = ATLAS_CELL / side - inset * 2;
  return [u0, v1 - cell, u0 + cell, v1];
}

/** A path or flooring on a tile, as both 3D views have it. */
interface Laid {
  x: number;
  y: number;
  ground: GroundKind;
  own?: boolean;
  fade?: number;
  /** The floor it's laid on (RFC 0028): absent on the ground floor. */
  floor?: number | undefined;
}

/** How much a neighbor's ground and flooring melt into the haze, as their blocks do. */
const hazeOf = (t: Pick<Laid, "own" | "fade">) =>
  t.own === false ? 0.25 + (t.fade ?? 0) * 0.6 : 0;

/**
 * How far paths and flooring are pulled toward the camera in the depth test (`polygonOffset`), so
 * they never flicker through the ground or a slab under them. Anything that lies on a path or a
 * flooring, like a pool of lamplight, pulls further, or a path hides it when seen at a slant.
 */
export const LAID_DEPTH_OFFSET = -1;

/**
 * Paths and flooring as one mesh: a flat quad a hair above the ground on each tile, or above its
 * slab on flooring upstairs (RFC 0028), textured from the atlas, tinted toward the haze for a
 * neighbor's like their blocks. Null when there are none.
 */
export function groundTiles(
  origin: { x: number; y: number },
  tiles: readonly Laid[],
  atlas: Texture,
): Mesh | null {
  if (tiles.length === 0) return null;
  const positions = new Float32Array(tiles.length * 18);
  const normals = new Float32Array(tiles.length * 18);
  const uvs = new Float32Array(tiles.length * 12);
  const colors = new Float32Array(tiles.length * 18);
  const fog = lin(SKY.fog);
  tiles.forEach((t, i) => {
    const x = t.x - origin.x;
    const z = t.y - origin.y;
    const [u0, v0, u1, v1] = atlasCell(t.ground);
    // Two triangles, north-west, south-west, north-east; north-east, south-west, south-east.
    const corners = [
      [x - 0.5, z - 0.5, u0, v1],
      [x - 0.5, z + 0.5, u0, v0],
      [x + 0.5, z - 0.5, u1, v1],
      [x + 0.5, z - 0.5, u1, v1],
      [x - 0.5, z + 0.5, u0, v0],
      [x + 0.5, z + 0.5, u1, v0],
    ] as const;
    const haze = hazeOf(t);
    const y = floorY(t.floor) + 0.012;
    corners.forEach(([px, pz, u, v], k) => {
      positions.set([px, y, pz], (i * 6 + k) * 3);
      normals.set([0, 1, 0], (i * 6 + k) * 3);
      uvs.set([u, v], (i * 6 + k) * 2);
      colors.set(
        [1 + (fog.r - 1) * haze, 1 + (fog.g - 1) * haze, 1 + (fog.b - 1) * haze],
        (i * 6 + k) * 3,
      );
    });
  });
  const geo = new BufferGeometry();
  geo.setAttribute("position", new BufferAttribute(positions, 3));
  geo.setAttribute("normal", new BufferAttribute(normals, 3));
  geo.setAttribute("uv", new BufferAttribute(uvs, 2));
  geo.setAttribute("color", new BufferAttribute(colors, 3));
  const mesh = new Mesh(
    geo,
    new MeshLambertMaterial({
      map: atlas,
      vertexColors: true,
      alphaTest: 0.5,
      polygonOffset: true,
      polygonOffsetFactor: LAID_DEPTH_OFFSET,
      polygonOffsetUnits: LAID_DEPTH_OFFSET,
    }),
  );
  mesh.receiveShadow = true;
  mesh.name = "ground";
  return mesh;
}

/** How thick flooring upstairs is: a slab whose top is at its floor's height, over the walls below. */
const SLAB = 0.12;
/** How thick the dark cap on a cut wall's top is, as a share of a slab. */
const CAP = 0.3;

/**
 * Flooring upstairs (RFC 0028) as one instanced mesh: a thin timber slab under each tile, with its
 * ground kind's look on top from `groundTiles`. A cut's open walls (`cutWalls` in
 * `layout.ts`) get a dark cap on their tops from the same mesh, so the cut reads as a cut without
 * another draw. Null when there's neither.
 */
export function flooringSlabs(
  origin: { x: number; y: number },
  flooring: readonly Laid[],
  caps: readonly { x: number; y: number; block: BlockKind; floor?: number | undefined }[],
  grain: Texture,
): InstancedMesh | null {
  const count = flooring.length + caps.length;
  if (count === 0) return null;
  const geo = bakeShade(new RoundedBoxGeometry(1, SLAB, 1, 1, 0.025), 0.7, 1);
  geo.translate(0, -SLAB / 2, 0);
  const mesh = new InstancedMesh(geo, paper(0xffffff, grain), count);
  const m = new Matrix4();
  const q = new Quaternion();
  const one = new Vector3(1, 1, 1);
  // Whatever lies on top, flooring's edge is its timber.
  const timber = shade(blockLook("wood").color, -0.08);
  flooring.forEach((t, i) => {
    const at = new Vector3(t.x - origin.x, floorY(t.floor), t.y - origin.y);
    mesh.setMatrixAt(i, m.compose(at, q, one));
    mesh.setColorAt(i, lin(mix(timber, SKY.fog, hazeOf(t))));
  });
  const capSize = new Vector3(0.97, CAP, 0.97);
  caps.forEach((b, i) => {
    const look = blockLook(b.block);
    const top = floorY(b.floor) + look.height + SLAB * CAP * 0.5;
    const at = new Vector3(b.x - origin.x, top, b.y - origin.y);
    mesh.setMatrixAt(flooring.length + i, m.compose(at, q, capSize));
    mesh.setColorAt(flooring.length + i, lin(shade(look.color, -0.35)));
  });
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.name = "flooring upstairs";
  return mesh;
}
