import { BLOCK_COLORS, type BlockKind, DOOR_LOOK } from "@terrakin/sim";
import { withAlpha } from "@terrakin/ui/looks";

/**
 * How thick a wall between tiles is drawn (RFC 0050), as a share of a tile: thin enough that the
 * room keeps its floor, thick enough to read as a wall from a step away. The 3D view uses the same
 * share (`EDGE_DEPTH` in `scene3d/edges.ts`).
 */
const EDGE_THICKNESS = 0.22;

/** Whether a block is a window when it stands between tiles. */
const isPane = (block: BlockKind) => block === "glass" || block === "sea_glass_pane";

/**
 * A wall between tiles on the map (RFC 0050): a slab along its line, `n` (across the top of the
 * tile at `left`, `top`) or `w` (down its left side), reaching past each end by half its thickness
 * so walls meet at their corners. A window is a pale pane in a frame, a door a frame round the door,
 * and every other kind its own color with a light top and a shaded lip, as a wall block is drawn.
 */
export function paintEdge(
  ctx: CanvasRenderingContext2D,
  block: BlockKind,
  side: "n" | "w",
  left: number,
  top: number,
  size: number,
) {
  const t = Math.max(3, Math.round(size * EDGE_THICKNESS));
  const half = t / 2;
  const x = side === "n" ? left - half : left - half;
  const y = side === "n" ? top - half : top - half;
  const w = side === "n" ? size + t : t;
  const h = side === "n" ? t : size + t;
  const radius = Math.min(t / 2, 3);
  ctx.save();
  // A soft shadow on the ground south of the wall.
  ctx.fillStyle = "rgba(74, 52, 28, 0.18)";
  ctx.beginPath();
  ctx.roundRect(x + 1, y + Math.max(2, t * 0.45), w, h, radius);
  ctx.fill();
  if (block === "door") {
    ctx.fillStyle = DOOR_LOOK.frame;
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, radius);
    ctx.fill();
    const long = side === "n" ? w : h;
    const inset = long * 0.24;
    ctx.fillStyle = DOOR_LOOK.panel;
    ctx.beginPath();
    if (side === "n") ctx.roundRect(x + inset, y + 1, w - inset * 2, h - 2, radius / 2);
    else ctx.roundRect(x + 1, y + inset, w - 2, h - inset * 2, radius / 2);
    ctx.fill();
    ctx.restore();
    return;
  }
  const color = BLOCK_COLORS[block];
  if (isPane(block)) {
    ctx.fillStyle = "#8a6a4a";
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, radius);
    ctx.fill();
    ctx.fillStyle = withAlpha(color, 0.92);
    ctx.beginPath();
    ctx.roundRect(x + 1.5, y + 1.5, Math.max(1, w - 3), Math.max(1, h - 3), radius / 2);
    ctx.fill();
    ctx.fillStyle = "rgba(255, 255, 255, 0.45)";
    if (side === "n") ctx.fillRect(x + w * 0.2, y + 2, w * 0.18, Math.max(1, h * 0.25));
    else ctx.fillRect(x + 2, y + h * 0.2, Math.max(1, w * 0.25), h * 0.18);
    ctx.restore();
    return;
  }
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, radius);
  ctx.fill();
  // A lighter top and a shaded lower lip, as a wall block wears them.
  ctx.fillStyle = "rgba(255, 255, 255, 0.22)";
  ctx.fillRect(x + 1, y + 1, w - 2, Math.max(1, h * (side === "n" ? 0.3 : 0.08)));
  ctx.fillStyle = "rgba(60, 40, 20, 0.22)";
  ctx.fillRect(
    x + 1,
    y + h - Math.max(1, h * (side === "n" ? 0.3 : 0.08)) - 1,
    w - 2,
    Math.max(1, h * (side === "n" ? 0.3 : 0.08)),
  );
  ctx.restore();
}
