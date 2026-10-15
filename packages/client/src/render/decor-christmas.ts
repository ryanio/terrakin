import { CHRISTMAS_HEX } from "@terrakin/ui/looks";

// ---------- Christmas's decor (RFC 0034) ----------

const X = CHRISTMAS_HEX;

/** A red stocking hung by its loop, with a white cuff and toe. */
export function paintStocking(
  ctx: CanvasRenderingContext2D,
  left: number,
  top: number,
  size: number,
) {
  const x = (f: number) => left + size * f;
  const y = (f: number) => top + size * f;
  // Its loop, then the cuff it hangs from.
  ctx.strokeStyle = X.redDark;
  ctx.lineWidth = Math.max(1, size * 0.03);
  ctx.beginPath();
  ctx.arc(x(0.48), y(0.17), size * 0.045, Math.PI, 0);
  ctx.stroke();
  // The stocking itself: a leg that turns into a foot at the bottom.
  ctx.fillStyle = X.red;
  ctx.beginPath();
  ctx.moveTo(x(0.36), y(0.24));
  ctx.lineTo(x(0.6), y(0.24));
  ctx.lineTo(x(0.6), y(0.58));
  ctx.quadraticCurveTo(x(0.6), y(0.65), x(0.67), y(0.69));
  ctx.lineTo(x(0.8), y(0.76));
  ctx.quadraticCurveTo(x(0.89), y(0.81), x(0.86), y(0.89));
  ctx.quadraticCurveTo(x(0.83), y(0.95), x(0.74), y(0.95));
  ctx.lineTo(x(0.48), y(0.95));
  ctx.quadraticCurveTo(x(0.36), y(0.95), x(0.36), y(0.83));
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  // The toe cap, in the cuff's white.
  ctx.fillStyle = X.trim;
  ctx.beginPath();
  ctx.moveTo(x(0.67), y(0.69));
  ctx.lineTo(x(0.8), y(0.76));
  ctx.quadraticCurveTo(x(0.89), y(0.81), x(0.86), y(0.89));
  ctx.quadraticCurveTo(x(0.83), y(0.95), x(0.74), y(0.95));
  ctx.lineTo(x(0.6), y(0.95));
  ctx.quadraticCurveTo(x(0.64), y(0.82), x(0.67), y(0.69));
  ctx.closePath();
  ctx.fill();
  // The cuff.
  ctx.fillRect(x(0.335), y(0.2), size * 0.29, size * 0.1);
  ctx.strokeRect(x(0.335), y(0.2), size * 0.29, size * 0.1);
}
