import { HANUKKAH_HEX } from "@terrakin/ui/looks";

// ---------- Hanukkah's decor (RFC 0034) ----------

const K = HANUKKAH_HEX;

/**
 * A brass menorah with nine candles, the helper candle tall in the middle. On Hanukkah's `night`
 * (1 to 8) the helper and that many candles burn, the first night's on the far right; outside
 * Hanukkah (0) none do.
 */
export function paintMenorah(
  ctx: CanvasRenderingContext2D,
  left: number,
  top: number,
  size: number,
  night: number,
) {
  const x = (f: number) => left + size * f;
  const y = (f: number) => top + size * f;
  ctx.fillStyle = K.brassDark;
  ctx.beginPath();
  ctx.moveTo(x(0.36), y(0.88));
  ctx.lineTo(x(0.64), y(0.88));
  ctx.lineTo(x(0.6), y(0.8));
  ctx.lineTo(x(0.4), y(0.8));
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = K.brass;
  ctx.lineWidth = Math.max(1, size * 0.04);
  ctx.beginPath();
  ctx.moveTo(x(0.5), y(0.8));
  ctx.lineTo(x(0.5), y(0.44));
  for (let i = 1; i <= 4; i++) {
    const r = i * 0.094;
    ctx.moveTo(x(0.5 - r), y(0.44));
    ctx.arc(x(0.5), y(0.44), size * r, Math.PI, 0, true);
  }
  ctx.stroke();
  for (let i = 0; i < 9; i++) {
    const cx = x(0.125 + i * 0.094);
    const helper = i === 4;
    const cTop = y(helper ? 0.22 : 0.3);
    ctx.fillStyle = K.candle;
    ctx.fillRect(cx - size * 0.025, cTop, size * 0.05, y(0.44) - cTop);
    // The first night's candle is the far right one (i = 8), the next to its left, and so on.
    const lit = night > 0 && (helper || 8 - (i > 4 ? i - 1 : i) < night);
    if (!lit) continue;
    ctx.fillStyle = K.flame;
    ctx.beginPath();
    ctx.ellipse(cx, cTop - size * 0.05, size * 0.028, size * 0.05, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = K.flameCore;
    ctx.beginPath();
    ctx.arc(cx, cTop - size * 0.035, size * 0.013, 0, Math.PI * 2);
    ctx.fill();
  }
}

/** A four-sided blue spinning top on its point, with its handle up. */
export function paintDreidel(
  ctx: CanvasRenderingContext2D,
  left: number,
  top: number,
  size: number,
) {
  const x = (f: number) => left + size * f;
  const y = (f: number) => top + size * f;
  ctx.fillStyle = K.dreidelLight;
  ctx.fillRect(x(0.47), y(0.2), size * 0.06, size * 0.13);
  ctx.fillStyle = K.dreidel;
  ctx.beginPath();
  ctx.moveTo(x(0.3), y(0.33));
  ctx.lineTo(x(0.7), y(0.33));
  ctx.lineTo(x(0.7), y(0.62));
  ctx.lineTo(x(0.5), y(0.86));
  ctx.lineTo(x(0.3), y(0.62));
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = K.dreidelLight;
  ctx.globalAlpha = 0.55;
  ctx.beginPath();
  ctx.moveTo(x(0.5), y(0.33));
  ctx.lineTo(x(0.7), y(0.33));
  ctx.lineTo(x(0.7), y(0.62));
  ctx.lineTo(x(0.5), y(0.86));
  ctx.closePath();
  ctx.fill();
  ctx.globalAlpha = 1;
}
