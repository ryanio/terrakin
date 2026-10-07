import { WINTER_HEX } from "@terrakin/ui/looks";
import { WOOD_DARK } from "./palette";

// ---------- winter's decor (RFC 0017) ----------

const W = WINTER_HEX;
/** A cool edge for snow, so a snowman reads against snowy ground. */
const SNOW_EDGE = "rgba(84, 104, 128, 0.7)";

/** A ball of snow with a cool shade on its far side, outlined. */
function snowBall(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number) {
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.clip();
  ctx.fillStyle = W.snowShade;
  ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
  ctx.fillStyle = W.snow;
  ctx.beginPath();
  ctx.arc(cx - r * 0.2, cy - r * 0.2, r * 0.96, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  ctx.strokeStyle = SNOW_EDGE;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.stroke();
}

/** A snowman: three balls of snow, twig arms, coal eyes, a carrot nose, a red scarf, a hat. */
export function paintSnowman(
  ctx: CanvasRenderingContext2D,
  left: number,
  top: number,
  size: number,
  outline: number,
) {
  const cx = left + size / 2;
  const y = (f: number) => top + size * f;
  ctx.strokeStyle = WOOD_DARK;
  ctx.lineWidth = Math.max(1, size * 0.035);
  ctx.beginPath();
  ctx.moveTo(cx - size * 0.1, y(0.46));
  ctx.lineTo(cx - size * 0.36, y(0.3));
  ctx.moveTo(cx + size * 0.1, y(0.46));
  ctx.lineTo(cx + size * 0.36, y(0.3));
  ctx.stroke();
  ctx.lineWidth = outline;
  snowBall(ctx, cx, y(0.74), size * 0.2);
  snowBall(ctx, cx, y(0.47), size * 0.145);
  snowBall(ctx, cx, y(0.25), size * 0.105);
  ctx.fillStyle = W.coal;
  ctx.beginPath();
  for (const [dx, fy, r] of [
    [-0.04, 0.235, 0.018],
    [0.04, 0.235, 0.018],
    [0, 0.44, 0.02],
    [0, 0.51, 0.02],
  ] as const) {
    ctx.moveTo(cx + dx * size + r * size, y(fy));
    ctx.arc(cx + dx * size, y(fy), r * size, 0, Math.PI * 2);
  }
  ctx.fill();
  ctx.fillStyle = W.carrot;
  ctx.beginPath();
  ctx.moveTo(cx, y(0.255));
  ctx.lineTo(cx + size * 0.11, y(0.272));
  ctx.lineTo(cx, y(0.29));
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = W.scarf;
  ctx.strokeStyle = "rgba(70, 40, 18, 0.55)";
  ctx.beginPath();
  ctx.roundRect(cx - size * 0.13, y(0.335), size * 0.26, size * 0.06, size * 0.03);
  ctx.roundRect(cx + size * 0.04, y(0.36), size * 0.06, size * 0.13, size * 0.02);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = W.hat;
  ctx.beginPath();
  ctx.roundRect(cx - size * 0.13, y(0.14), size * 0.26, size * 0.035, size * 0.015);
  ctx.roundRect(cx - size * 0.075, y(0.03), size * 0.15, size * 0.12, size * 0.02);
  ctx.fill();
  ctx.stroke();
}

/** Where each bulb of a string of lights hangs in its block's box, and its color. */
export function lightBulbs(left: number, top: number, size: number) {
  const x0 = left + size * 0.1;
  const x1 = left + size * 0.9;
  const y0 = top + size * 0.32;
  const dip = top + size * 0.56;
  return [0.12, 0.31, 0.5, 0.69, 0.88].map((t, i) => ({
    x: x0 + (x1 - x0) * t,
    y: (1 - t) * (1 - t) * y0 + 2 * t * (1 - t) * dip + t * t * y0 + size * 0.07,
    color: W.bulbs[i % W.bulbs.length] as string,
  }));
}

/** A string of colored bulbs between two little posts. After dark, each bulb glows its color. */
export function paintStringLights(
  ctx: CanvasRenderingContext2D,
  left: number,
  top: number,
  size: number,
) {
  const x0 = left + size * 0.1;
  const x1 = left + size * 0.9;
  const y0 = top + size * 0.32;
  const base = top + size * 0.92;
  ctx.strokeStyle = WOOD_DARK;
  ctx.lineWidth = Math.max(1.5, size * 0.06);
  ctx.beginPath();
  ctx.moveTo(x0, base);
  ctx.lineTo(x0, y0 - size * 0.04);
  ctx.moveTo(x1, base);
  ctx.lineTo(x1, y0 - size * 0.04);
  ctx.stroke();
  ctx.strokeStyle = W.wire;
  ctx.lineWidth = Math.max(1, size * 0.025);
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.quadraticCurveTo((x0 + x1) / 2, top + size * 0.56, x1, y0);
  ctx.stroke();
  ctx.strokeStyle = "rgba(70, 40, 18, 0.55)";
  ctx.lineWidth = Math.max(1, size / 40);
  for (const b of lightBulbs(left, top, size)) {
    ctx.fillStyle = b.color;
    ctx.beginPath();
    ctx.ellipse(b.x, b.y, size * 0.036, size * 0.052, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
}

/** A little fir in a clay pot: three tiers of needles dusted with snow, and a gold star. */
export function paintLittleFir(
  ctx: CanvasRenderingContext2D,
  left: number,
  top: number,
  size: number,
) {
  const cx = left + size / 2;
  const y = (f: number) => top + size * f;
  ctx.fillStyle = WOOD_DARK;
  ctx.fillRect(cx - size * 0.035, y(0.64), size * 0.07, size * 0.1);
  for (const [apex, base, half] of [
    [0.36, 0.7, 0.3],
    [0.2, 0.53, 0.23],
    [0.06, 0.35, 0.16],
  ] as const) {
    ctx.fillStyle = W.needles;
    ctx.beginPath();
    ctx.moveTo(cx, y(apex));
    ctx.lineTo(cx + size * half, y(base));
    ctx.quadraticCurveTo(cx, y(base + 0.05), cx - size * half, y(base));
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = W.needlesLight;
    ctx.beginPath();
    ctx.moveTo(cx, y(apex));
    ctx.lineTo(cx - size * half * 0.75, y(base - 0.02));
    ctx.lineTo(cx - size * half * 0.45, y(base - 0.01));
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = W.snow;
    ctx.beginPath();
    ctx.ellipse(cx - size * half * 0.7, y(base), size * 0.06, size * 0.022, 0, 0, Math.PI * 2);
    ctx.ellipse(cx + size * half * 0.65, y(base), size * 0.07, size * 0.024, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = W.pot;
  ctx.beginPath();
  ctx.moveTo(cx - size * 0.17, y(0.75));
  ctx.lineTo(cx + size * 0.17, y(0.75));
  ctx.lineTo(cx + size * 0.13, y(0.93));
  ctx.lineTo(cx - size * 0.13, y(0.93));
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = W.potRim;
  ctx.beginPath();
  ctx.roundRect(cx - size * 0.2, y(0.7), size * 0.4, size * 0.07, size * 0.02);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = W.star;
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const r = size * (i % 2 === 0 ? 0.07 : 0.03);
    const px = cx + Math.cos(a) * r;
    const py = y(0.07) + Math.sin(a) * r;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
}

/** A sled from the side: red slats on two iron runners that curl up in front, and its rope. */
export function paintSled(ctx: CanvasRenderingContext2D, left: number, top: number, size: number) {
  const x = (f: number) => left + size * f;
  const y = (f: number) => top + size * f;
  const edge = ctx.strokeStyle;
  const runner = (dx: number, dy: number, color: string) => {
    ctx.strokeStyle = color;
    ctx.lineWidth = Math.max(1.5, size * 0.045);
    ctx.beginPath();
    ctx.moveTo(x(0.08 + dx), y(0.86 + dy));
    ctx.lineTo(x(0.74 + dx), y(0.86 + dy));
    ctx.quadraticCurveTo(x(0.92 + dx), y(0.86 + dy), x(0.9 + dx), y(0.68 + dy));
    for (const f of [0.18, 0.44, 0.68]) {
      ctx.moveTo(x(f + dx), y(0.86 + dy));
      ctx.lineTo(x(f + dx), y(0.72 + dy));
    }
    ctx.stroke();
  };
  runner(0.05, -0.07, "#6e6a66");
  runner(0, 0, W.runner);
  ctx.strokeStyle = edge;
  ctx.lineWidth = Math.max(1, size / 30);
  ctx.fillStyle = "#9e3428";
  ctx.beginPath();
  ctx.moveTo(x(0.1), y(0.66));
  ctx.lineTo(x(0.78), y(0.66));
  ctx.lineTo(x(0.78), y(0.74));
  ctx.lineTo(x(0.1), y(0.74));
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = W.slat;
  ctx.beginPath();
  ctx.moveTo(x(0.1), y(0.66));
  ctx.lineTo(x(0.17), y(0.58));
  ctx.lineTo(x(0.85), y(0.58));
  ctx.lineTo(x(0.78), y(0.66));
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.strokeStyle = W.rope;
  ctx.lineWidth = Math.max(1, size * 0.03);
  ctx.beginPath();
  ctx.moveTo(x(0.88), y(0.62));
  ctx.quadraticCurveTo(x(1), y(0.6), x(0.96), y(0.78));
  ctx.stroke();
}
