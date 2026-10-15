import type { FireworkColor } from "@terrakin/sim";
import { BRAND_HEX } from "@terrakin/ui/brand";

// ---------- fireworks (RFC 0034) ----------

/** A firework set off lately: where it bursts, its color, and when it went up. */
export interface BurstMark {
  x: number;
  y: number;
  color: FireworkColor;
  /** When it arrived, on the frame's clock (ms). */
  at: number;
}

/** How long a firework shows: it rises, bursts, and fades. */
export const BURST_MS = 2200;

/** The most bursts drawn at once; a new one past it drops the oldest (RFC 0034). */
export const BURSTS_MAX = 12;

/** The colors each firework bursts in, bright enough to read over the night. */
const BURST_HEX: Readonly<Record<FireworkColor, string>> = {
  gold: "#ffd36b",
  red: "#ff6b6b",
  green: "#7fe08a",
  blue: "#6fb8ff",
  violet: "#c79bff",
  white: BRAND_HEX.paper,
};

/**
 * One firework over the tile at (sx, sy): a spark rising for its first quarter, then a ring of
 * sparks spreading and fading. Under reduced motion it shows its burst at once, still.
 */
export function paintBurst(
  ctx: CanvasRenderingContext2D,
  b: BurstMark,
  sx: number,
  sy: number,
  scale: number,
  now: number,
  still: boolean,
) {
  const age = now - b.at;
  if (age < 0 || age > BURST_MS) return;
  const t = still ? 0.5 : age / BURST_MS;
  const color = BURST_HEX[b.color];
  const cx = sx + scale / 2;
  const top = sy - scale * 2.2;
  ctx.save();
  if (t < 0.25) {
    const y = sy + (top - sy) * (t / 0.25);
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(cx, y, scale * 0.05, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    return;
  }
  const k = (t - 0.25) / 0.75;
  const r = scale * (0.3 + 1.1 * Math.sqrt(k));
  ctx.globalAlpha = 1 - k;
  ctx.fillStyle = color;
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * Math.PI * 2;
    ctx.beginPath();
    ctx.arc(
      cx + Math.cos(a) * r,
      top + Math.sin(a) * r + k * scale * 0.3,
      scale * 0.045,
      0,
      Math.PI * 2,
    );
    ctx.fill();
  }
  ctx.globalAlpha = (1 - k) * 0.35;
  const g = ctx.createRadialGradient(cx, top, 0, cx, top, r);
  g.addColorStop(0, color);
  g.addColorStop(1, "rgba(0, 0, 0, 0)");
  ctx.fillStyle = g;
  ctx.fillRect(cx - r, top - r, r * 2, r * 2);
  ctx.restore();
}
