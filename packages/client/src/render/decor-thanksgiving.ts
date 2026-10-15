import { leafPath, THANKSGIVING_HEX } from "@terrakin/ui/looks";
import { WOOD_DARK } from "./palette";

// ---------- Thanksgiving's decor (RFC 0034) ----------

const T = THANKSGIVING_HEX;

/** A fruit as a filled circle at a fraction of the box. */
function fruit(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: string) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
}

/** A wicker horn of plenty on its side, its mouth to the right, spilling fruit. */
export function paintCornucopia(
  ctx: CanvasRenderingContext2D,
  left: number,
  top: number,
  size: number,
) {
  const x = (f: number) => left + size * f;
  const y = (f: number) => top + size * f;
  ctx.fillStyle = T.wicker;
  ctx.beginPath();
  ctx.moveTo(x(0.86), y(0.62));
  ctx.bezierCurveTo(x(0.86), y(0.86), x(0.5), y(0.9), x(0.2), y(0.62));
  ctx.bezierCurveTo(x(0.1), y(0.5), x(0.08), y(0.36), x(0.14), y(0.34));
  ctx.bezierCurveTo(x(0.2), y(0.34), x(0.2), y(0.46), x(0.3), y(0.44));
  ctx.bezierCurveTo(x(0.42), y(0.38), x(0.54), y(0.36), x(0.66), y(0.38));
  ctx.bezierCurveTo(x(0.8), y(0.4), x(0.86), y(0.5), x(0.86), y(0.62));
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.strokeStyle = T.weave;
  ctx.lineWidth = Math.max(1, size * 0.025);
  ctx.beginPath();
  for (const f of [0.34, 0.46, 0.58]) {
    ctx.moveTo(x(f), y(0.42));
    ctx.lineTo(x(f + 0.08), y(0.74));
  }
  ctx.stroke();
  ctx.strokeStyle = "rgba(70, 40, 18, 0.55)";
  ctx.lineWidth = Math.max(1, size / 30);
  ctx.fillStyle = T.weave;
  ctx.beginPath();
  ctx.ellipse(x(0.73), y(0.62), size * 0.13, size * 0.19, 0, 0, Math.PI * 2);
  ctx.fill();
  fruit(ctx, x(0.71), y(0.52), size * 0.095, T.apple);
  fruit(ctx, x(0.82), y(0.67), size * 0.09, T.gourd);
  ctx.fillStyle = T.grapes;
  ctx.beginPath();
  for (const [fx, fy] of [
    [0.66, 0.71],
    [0.73, 0.74],
    [0.69, 0.78],
  ] as const) {
    ctx.moveTo(x(fx) + size * 0.04, y(fy));
    ctx.arc(x(fx), y(fy), size * 0.04, 0, Math.PI * 2);
  }
  ctx.fill();
}

/** Two posts with a string of maple leaves sagging between them. */
export function paintLeafGarland(
  ctx: CanvasRenderingContext2D,
  left: number,
  top: number,
  size: number,
) {
  const at = (t: number) => ({
    x: left + size * (0.12 + 0.76 * t),
    y: top + size * (0.26 + 0.52 * t * (1 - t)),
  });
  ctx.strokeStyle = WOOD_DARK;
  ctx.lineWidth = Math.max(1, size * 0.06);
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(left + size * 0.12, top + size * 0.92);
  ctx.lineTo(left + size * 0.12, top + size * 0.22);
  ctx.moveTo(left + size * 0.88, top + size * 0.92);
  ctx.lineTo(left + size * 0.88, top + size * 0.22);
  ctx.stroke();
  ctx.strokeStyle = T.twine;
  ctx.lineWidth = Math.max(1, size * 0.02);
  ctx.beginPath();
  ctx.moveTo(left + size * 0.12, top + size * 0.26);
  ctx.quadraticCurveTo(left + size * 0.5, top + size * 0.52, left + size * 0.88, top + size * 0.26);
  ctx.stroke();
  ctx.strokeStyle = "rgba(70, 40, 18, 0.55)";
  ctx.lineWidth = Math.max(1, size / 40);
  [0.14, 0.32, 0.5, 0.68, 0.86].forEach((t, i) => {
    const p = at(t);
    const leaf = new Path2D(leafPath(p.x, p.y + size * 0.08, size * 0.19));
    ctx.fillStyle = T.leaves[i % T.leaves.length] as string;
    ctx.fill(leaf);
    ctx.stroke(leaf);
  });
}
