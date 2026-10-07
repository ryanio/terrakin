import { GROUND_KINDS, type GroundKind } from "@terrakin/sim";
import { paintGround } from "@terrakin/ui/ground-art";
import {
  BufferAttribute,
  BufferGeometry,
  type CanvasTexture,
  Mesh,
  MeshLambertMaterial,
  type Texture,
} from "three";
import { canvasTexture, lin } from "./art";
import { SKY } from "./palette";

// ---------- paths and floors (RFC 0016) ----------

/** Cells across and down the ground atlas, and each cell's side in pixels. */
const ATLAS_CELLS = 4;
const ATLAS_CELL = 64;

/**
 * Every path and floor drawn once into one texture, a cell each, from the sim's looks (the same
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

/**
 * Paths and floors as one mesh: a flat quad a hair above the ground on each tile, textured from
 * the atlas, tinted toward the haze for a neighbor's like their blocks. Null when there are none.
 */
export function groundTiles(
  origin: { x: number; y: number },
  tiles: readonly { x: number; y: number; ground: GroundKind; own?: boolean; fade?: number }[],
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
    const haze = t.own === false ? 0.25 + (t.fade ?? 0) * 0.6 : 0;
    corners.forEach(([px, pz, u, v], k) => {
      positions.set([px, 0.012, pz], (i * 6 + k) * 3);
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
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    }),
  );
  mesh.receiveShadow = true;
  mesh.name = "ground";
  return mesh;
}
