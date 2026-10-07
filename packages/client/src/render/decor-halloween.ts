import { BLOCK_COLORS } from "@terrakin/sim";
import { BAT_POINTS, HALLOWEEN_HEX } from "@terrakin/ui/looks";
import { WOOD_DARK } from "./palette";

// ---------- Halloween's decor (RFC 0022) ----------

const H = HALLOWEEN_HEX;

/** A bat with its wings spread, centered on (cx, cy), `span` wide. */
function batShape(ctx: CanvasRenderingContext2D, cx: number, cy: number, span: number) {
  const k = span / 2;
  BAT_POINTS.forEach(([x, y], i) => {
    if (i === 0) ctx.moveTo(cx + x * k, cy + y * k);
    else ctx.lineTo(cx + x * k, cy + y * k);
  });
  ctx.closePath();
}

/** Bat bunting: paper bats and orange pennants on a string between two little posts. */
export function paintBatBunting(
  ctx: CanvasRenderingContext2D,
  left: number,
  top: number,
  size: number,
) {
  const x0 = left + size * 0.12;
  const x1 = left + size * 0.88;
  const y0 = top + size * 0.26;
  const dip = top + size * 0.52;
  const base = top + size * 0.92;
  ctx.strokeStyle = WOOD_DARK;
  ctx.lineWidth = Math.max(1.5, size * 0.06);
  ctx.beginPath();
  ctx.moveTo(x0, base);
  ctx.lineTo(x0, y0 - size * 0.04);
  ctx.moveTo(x1, base);
  ctx.lineTo(x1, y0 - size * 0.04);
  ctx.stroke();
  ctx.strokeStyle = "#5a4f60";
  ctx.lineWidth = Math.max(1, size * 0.02);
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.quadraticCurveTo((x0 + x1) / 2, dip, x1, y0);
  ctx.stroke();
  const at = (t: number): [number, number] => [
    x0 + (x1 - x0) * t,
    (1 - t) * (1 - t) * y0 + 2 * t * (1 - t) * dip + t * t * y0,
  ];
  ctx.fillStyle = H.witchBand;
  ctx.beginPath();
  for (const t of [0.35, 0.65]) {
    const [x, y] = at(t);
    ctx.moveTo(x - size * 0.06, y);
    ctx.lineTo(x + size * 0.06, y);
    ctx.lineTo(x, y + size * 0.14);
    ctx.closePath();
  }
  ctx.fill();
  ctx.fillStyle = H.bat;
  ctx.beginPath();
  for (const t of [0.18, 0.5, 0.82]) {
    const [x, y] = at(t);
    batShape(ctx, x, y + size * 0.07, size * 0.27);
  }
  ctx.fill();
}

/** A cauldron on three feet, a green brew in it, and a bubble or two rising. */
export function paintCauldron(
  ctx: CanvasRenderingContext2D,
  left: number,
  top: number,
  size: number,
) {
  const cx = left + size / 2;
  const rimY = top + size * 0.42;
  ctx.fillStyle = H.iron;
  ctx.fillRect(cx - size * 0.24, top + size * 0.78, size * 0.08, size * 0.14);
  ctx.fillRect(cx + size * 0.16, top + size * 0.78, size * 0.08, size * 0.14);
  ctx.beginPath();
  ctx.moveTo(cx - size * 0.34, rimY);
  ctx.bezierCurveTo(
    cx - size * 0.34,
    top + size * 0.86,
    cx + size * 0.34,
    top + size * 0.86,
    cx + size * 0.34,
    rimY,
  );
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = H.ironRim;
  ctx.beginPath();
  ctx.ellipse(cx, rimY, size * 0.36, size * 0.09, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = H.brew;
  ctx.beginPath();
  ctx.ellipse(cx, rimY, size * 0.28, size * 0.055, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = H.brewLight;
  ctx.beginPath();
  ctx.arc(cx - size * 0.08, rimY - size * 0.1, size * 0.045, 0, Math.PI * 2);
  ctx.arc(cx + size * 0.07, rimY - size * 0.18, size * 0.032, 0, Math.PI * 2);
  ctx.fill();
}

/** An orange bowl on a short stand, heaped with wrapped candy. */
export function paintCandyBowl(
  ctx: CanvasRenderingContext2D,
  left: number,
  top: number,
  size: number,
) {
  const cx = left + size / 2;
  const rimY = top + size * 0.5;
  ctx.fillStyle = H.pumpkinRib;
  ctx.beginPath();
  ctx.moveTo(cx - size * 0.12, top + size * 0.9);
  ctx.lineTo(cx + size * 0.12, top + size * 0.9);
  ctx.lineTo(cx + size * 0.07, top + size * 0.74);
  ctx.lineTo(cx - size * 0.07, top + size * 0.74);
  ctx.closePath();
  ctx.fill();
  const sweets: [number, number, number][] = [
    [-0.18, 0.44, 0],
    [0.17, 0.44, 1],
    [0, 0.37, 4],
    [-0.08, 0.47, 3],
    [0.08, 0.47, 2],
  ];
  for (const [dx, dy, c] of sweets) {
    ctx.fillStyle = H.candy[c] ?? H.candy[0];
    ctx.beginPath();
    ctx.arc(cx + dx * size, top + dy * size, size * 0.085, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
  ctx.fillStyle = BLOCK_COLORS.candy_bowl;
  ctx.beginPath();
  ctx.moveTo(cx - size * 0.38, rimY);
  ctx.lineTo(cx + size * 0.38, rimY);
  ctx.bezierCurveTo(
    cx + size * 0.38,
    top + size * 0.82,
    cx - size * 0.38,
    top + size * 0.82,
    cx - size * 0.38,
    rimY,
  );
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = H.candy[1];
  ctx.fillRect(cx - size * 0.34, rimY + size * 0.08, size * 0.68, size * 0.05);
}
