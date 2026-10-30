import { type RoofShape, roofSnow, type Season, SNOW_WHITE } from "@terrakin/sim";
import { BufferAttribute, BufferGeometry, Mesh, type Texture } from "three";
import { paper } from "./art";
import { FLOOR_HEIGHT, floorY } from "./layout";
import { blockLook, hex, mix, SKY, shade } from "./palette";

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

/** How deep a graded roof's fascia hangs under its eaves (RFC 0051), and how dark it is lit. */
const FASCIA = 0.07;
const FASCIA_LIGHT = 0.4;

/** A roof's surface, lit from the ridge down, in its covering's own color. */
export function roofMesh(
  origin: { x: number; y: number },
  roof: RoofShape,
  grain: Texture,
  fade = 0,
  season?: Season,
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
    // A graded covering (RFC 0051) wears a dark fascia under its eaves, as a graded wall wears
    // its plinth: a narrow band hung from the edge, in the same geometry, so it costs no draw.
    if (roof.grade) {
      const band = (a: [number, number, number], b: [number, number, number]) => {
        const da: [number, number, number] = [a[0], a[1] - FASCIA, a[2]];
        const db: [number, number, number] = [b[0], b[1] - FASCIA, b[2]];
        tri(a, da, db, [FASCIA_LIGHT, FASCIA_LIGHT, FASCIA_LIGHT]);
        tri(a, db, b, [FASCIA_LIGHT, FASCIA_LIGHT, FASCIA_LIGHT]);
      };
      if (!on(tile.x, tile.y - 1)) band(NE, NW);
      if (!on(tile.x, tile.y + 1)) band(SW, SE);
      if (!on(tile.x - 1, tile.y)) band(NW, SW);
      if (!on(tile.x + 1, tile.y)) band(SE, NE);
    }
  }
  // A masterwork covering's carved mark (RFC 0051): a small bright diamond standing on its highest
  // tile, unless something already stands on the ridge.
  if (roof.grade === "masterwork" && !roof.top) {
    let peak = roof.tiles[0];
    for (const t of roof.tiles) if (peak && Math.max(...t.h) > Math.max(...peak.h)) peak = t;
    if (peak) {
      const y = base + Math.max(...peak.h) * rise;
      const cx = peak.x - origin.x;
      const cz = peak.y - origin.y;
      const r = 0.11;
      const light: [number, number, number] = [1.2, 1.2, 1.2];
      for (const [dx, dz] of [
        [r, 0],
        [0, r],
      ] as const) {
        const left: [number, number, number] = [cx - dx, y + r, cz - dz];
        const right: [number, number, number] = [cx + dx, y + r, cz + dz];
        const low: [number, number, number] = [cx, y, cz];
        const high: [number, number, number] = [cx, y + r * 2, cz];
        tri(low, right, high, light);
        tri(low, high, left, light);
      }
    }
  }
  // What stands on the ridge (RFC 0041), in the same geometry: it is the roof's own color taken
  // right down, so a mark costs no draw call, no material and no light of its own.
  const top = roof.top;
  if (top) {
    const at = roof.tiles.find((t) => t.x === top.x && t.y === top.y);
    const stands = base + Math.max(...(at?.h ?? [0])) * rise;
    const cx = top.x - origin.x;
    const cz = top.y - origin.y;
    const DARK = 0.42;
    /** An upright quad, so a mark reads from any side the camera comes round to. */
    const panel = (
      x0: number,
      z0: number,
      x1: number,
      z1: number,
      y0: number,
      y1: number,
      light = DARK,
    ) => {
      const a: [number, number, number] = [cx + x0, y0, cz + z0];
      const b: [number, number, number] = [cx + x1, y0, cz + z1];
      const c: [number, number, number] = [cx + x1, y1, cz + z1];
      const d: [number, number, number] = [cx + x0, y1, cz + z0];
      tri(a, b, c, [light, light, light]);
      tri(a, c, d, [light, light, light]);
    };
    const tall = FLOOR_HEIGHT * 0.3;
    if (top.kind === "nest") {
      // A low ring of twigs, drawn as a shallow box so it reads as a lump from above and aside.
      const r = 0.16;
      panel(-r, -r, r, -r, stands, stands + tall * 0.3);
      panel(-r, r, r, r, stands, stands + tall * 0.3);
      panel(-r, -r, -r, r, stands, stands + tall * 0.3);
      panel(r, -r, r, r, stands, stands + tall * 0.3);
    } else {
      // A pole, as two crossed quads, with the vane's arms or the flag's cloth near its top.
      panel(-0.02, 0, 0.02, 0, stands, stands + tall);
      panel(0, -0.02, 0, 0.02, stands, stands + tall);
      if (top.kind === "vane") {
        panel(-0.18, 0, 0.18, 0, stands + tall * 0.78, stands + tall * 0.92);
        panel(0, -0.18, 0, 0.18, stands + tall * 0.78, stands + tall * 0.92);
      } else {
        panel(0.02, 0, 0.26, 0, stands + tall * 0.58, stands + tall * 0.95);
      }
    }
  }
  const geo = new BufferGeometry();
  geo.setAttribute("position", new BufferAttribute(new Float32Array(points), 3));
  geo.setAttribute("color", new BufferAttribute(new Float32Array(shades), 3));
  geo.computeVertexNormals();
  const look = blockLook(roof.material);
  // Winter's snow lies on it, the sim's own mix (`roofSnow`), then a neighbor's roof melts into
  // the haze as their blocks do.
  const snowy = mix(look.color, hex(SNOW_WHITE), roofSnow(season));
  const color = mix(shade(snowy, 0.04), SKY.fog, fade);
  const mesh = new Mesh(geo, paper(color, grain));
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.name = "roof";
  return mesh;
}
