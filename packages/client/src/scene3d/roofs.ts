import type { RoofShape } from "@terrakin/sim";
import { BufferAttribute, BufferGeometry, Mesh, type Texture } from "three";
import { paper } from "./art";
import { FLOOR_HEIGHT, floorY } from "./layout";
import { blockLook, mix, SKY, shade } from "./palette";

/**
 * A home's roof in 3D (RFC 0041). What it covers comes from the sim (`roofShape`), a tile at a
 * time with the height of each of its four corners, so this builds one surface: two triangles a
 * tile, lifted to the top of the walls the roof sits on, plus a skirt wherever the surface ends
 * above the eaves, so there's no seeing under it. One merged mesh a plot, so a roof is one draw
 * call and adds no light and no shadow of its own (decision 0030's budget).
 */

/** How high the ridge of a roof stands over the top of the walls it sits on, as a wall's height. */
const RISE = 0.62;

/** How far a roof's eaves reach past the walls, so a home reads as sheltered rather than capped. */
const EAVE = 0.08;

/** A roof's surface, lit from the ridge down, in its covering's own color. */
export function roofMesh(
  origin: { x: number; y: number },
  roof: RoofShape,
  grain: Texture,
  fade = 0,
): Mesh | null {
  if (roof.tiles.length === 0) return null;
  const base = floorY(roof.floor) + FLOOR_HEIGHT;
  const rise = FLOOR_HEIGHT * RISE;
  const covered = new Set(roof.tiles.map((t) => `${t.x},${t.y}`));
  const on = (x: number, y: number) => covered.has(`${x},${y}`);
  const points: number[] = [];
  const shades: number[] = [];
  /** One triangle, each corner with the height that lights it. */
  const tri = (
    a: [number, number, number],
    b: [number, number, number],
    c: [number, number, number],
    light: [number, number, number],
  ) => {
    points.push(...a, ...b, ...c);
    for (const k of light) shades.push(k, k, k);
  };
  // The ridge catches the light and the eaves sit in shadow, as `bakeShade` does for a block.
  const lit = (h: number) => 0.74 + 0.26 * h;
  for (const tile of roof.tiles) {
    const [nw, ne, se, sw] = tile.h;
    const x0 = tile.x - origin.x - 0.5 - (on(tile.x - 1, tile.y) ? 0 : EAVE);
    const x1 = tile.x - origin.x + 0.5 + (on(tile.x + 1, tile.y) ? 0 : EAVE);
    const z0 = tile.y - origin.y - 0.5 - (on(tile.x, tile.y - 1) ? 0 : EAVE);
    const z1 = tile.y - origin.y + 0.5 + (on(tile.x, tile.y + 1) ? 0 : EAVE);
    const at = (h: number) => base + h * rise;
    const NW: [number, number, number] = [x0, at(nw), z0];
    const NE: [number, number, number] = [x1, at(ne), z0];
    const SE: [number, number, number] = [x1, at(se), z1];
    const SW: [number, number, number] = [x0, at(sw), z1];
    tri(NW, SW, SE, [lit(nw), lit(sw), lit(se)]);
    tri(NW, SE, NE, [lit(nw), lit(se), lit(ne)]);
    // Where the surface ends above the walls, a skirt closes it: a gable end, or a cut-off slope.
    const skirt = (
      a: [number, number, number],
      b: [number, number, number],
      ha: number,
      hb: number,
    ) => {
      if (ha <= 0 && hb <= 0) return;
      const fa: [number, number, number] = [a[0], base, a[2]];
      const fb: [number, number, number] = [b[0], base, b[2]];
      // A wall of the roof is flatter light than its slopes, so the two never read as one plane.
      tri(a, fa, fb, [lit(ha) * 0.86, 0.66, 0.66]);
      tri(a, fb, b, [lit(ha) * 0.86, 0.66, lit(hb) * 0.86]);
    };
    if (!on(tile.x, tile.y - 1)) skirt(NE, NW, ne, nw);
    if (!on(tile.x, tile.y + 1)) skirt(SW, SE, sw, se);
    if (!on(tile.x - 1, tile.y)) skirt(NW, SW, nw, sw);
    if (!on(tile.x + 1, tile.y)) skirt(SE, NE, se, ne);
  }
  const geo = new BufferGeometry();
  geo.setAttribute("position", new BufferAttribute(new Float32Array(points), 3));
  geo.setAttribute("color", new BufferAttribute(new Float32Array(shades), 3));
  geo.computeVertexNormals();
  const look = blockLook(roof.material);
  // A neighbor's roof melts into the haze as their blocks do.
  const color = mix(shade(look.color, 0.04), SKY.fog, fade);
  const mesh = new Mesh(geo, paper(color, grain));
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.name = "roof";
  return mesh;
}
