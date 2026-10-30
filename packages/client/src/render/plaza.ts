import { groundTile, type Season, tileHash, tileKey } from "@terrakin/sim";
import { type Camera, tileToScreen } from "../camera";
import type { Mirror } from "../mirror";

/** The kerb that edges a plaza: a darker sandstone than its setts. */
const KERB = "#9a8462";

/**
 * Where a town square's plaza (`PLAZA_LOOK`, drawn through `Mirror.drawnPaving`) meets open
 * ground: a stone kerb just inside its edge, with the grass beyond growing over it in soft
 * scallops, so the square doesn't end in a hard line. Against a path, a street, a way, or the
 * water there is only the kerb. Each scallop's size comes from its tile's hash, so the edge holds
 * still and looks the same on every screen. Drawn after the ground, before anything stands on it.
 */
export function drawPlazaEdges(
  ctx: CanvasRenderingContext2D,
  mirror: Mirror,
  cam: Camera,
  season: Season | undefined,
) {
  const { config } = mirror;
  const S = config.plotSize;
  const s = cam.scale;
  const half = s / 2;
  const drawn = mirror.drawnPaving;
  const kerb = new Path2D();
  const grass = new Map<string, Path2D>();
  const grassOf = (fill: string) => {
    let path = grass.get(fill);
    if (!path) {
      path = new Path2D();
      grass.set(fill, path);
    }
    return path;
  };
  for (const { px, py } of mirror.squares()) {
    const x0 = px * S;
    const y0 = py * S;
    const a = tileToScreen(cam, x0, y0);
    const b = tileToScreen(cam, x0 + S - 1, y0 + S - 1);
    if (a.sx - half > cam.width || a.sy - half > cam.height) continue;
    if (b.sx + half < 0 || b.sy + half < 0) continue;
    const inset = s * 0.07;
    kerb.rect(
      a.sx - half + inset,
      a.sy - half + inset,
      b.sx - a.sx + s - inset * 2,
      b.sy - a.sy + s - inset * 2,
    );
    // Each side's tiles, the tile beyond it, and which way is out.
    for (let k = 0; k < S; k++) {
      for (const [tx, ty, ox, oy] of [
        [x0 + k, y0, 0, -1],
        [x0 + k, y0 + S - 1, 0, 1],
        [x0, y0 + k, -1, 0],
        [x0 + S - 1, y0 + k, 1, 0],
      ] as const) {
        const nx = tx + ox;
        const ny = ty + oy;
        if (nx < 0 || ny < 0 || nx >= config.width || ny >= config.height) continue;
        if (drawn.has(tileKey(nx, ny)) || mirror.isSea(nx, ny)) continue;
        const fill = groundTile(config, nx, ny, false, season).fill;
        const path = grassOf(fill);
        const { sx, sy } = tileToScreen(cam, tx, ty);
        // The edge's middle, and the line along it.
        const ex = sx + ox * half;
        const ey = sy + oy * half;
        const n = tileHash(nx, ny);
        for (let i = 0; i < 3; i++) {
          const along = (i - 1) * 0.34 * s;
          const r = s * (0.14 + (((n >>> (i * 3)) & 7) / 7) * 0.12);
          const cx = ex + (oy === 0 ? 0 : along) - ox * r * 0.4;
          const cy = ey + (ox === 0 ? 0 : along) - oy * r * 0.4;
          path.moveTo(cx + r, cy);
          path.arc(cx, cy, r, 0, Math.PI * 2);
        }
      }
    }
  }
  ctx.save();
  ctx.strokeStyle = KERB;
  ctx.lineWidth = Math.max(1, s * 0.09);
  ctx.lineJoin = "round";
  ctx.stroke(kerb);
  for (const [fill, path] of grass) {
    ctx.fillStyle = fill;
    ctx.fill(path);
  }
  ctx.restore();
}
