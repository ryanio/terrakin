import { POND_LOOK, SEA_LOOK } from "@terrakin/sim";
import { type ArtKind, itemArtImage } from "@terrakin/ui/item-art";
import { WOOD_DARK } from "./palette";

/** A cast someone made into the water at (x, y), and what it brought up, from `fished`. */
export interface CastMark {
  x: number;
  y: number;
  caught: string;
  /** When it arrived, on the frame's clock (ms). */
  at: number;
}

/** How long a cast shows on the water: the float, its rings, and what it brought up. */
export const CAST_MS = 2600;

/**
 * A tile of pond (RFC 0023), flat in the ground in the sim's `POND_LOOK`: water, a shade where it
 * deepens away from each bank, a stone rim with pebbles along each side that doesn't run on into
 * more pond, a lily pad on some tiles, and two glints that drift and shimmer, still under reduced
 * motion. `open` says which sides are bank.
 */
export function paintPond(
  ctx: CanvasRenderingContext2D,
  left: number,
  top: number,
  w: number,
  h: number,
  open: { n: boolean; e: boolean; s: boolean; w: boolean },
  seed: number,
  now: number,
  still: boolean,
) {
  const u = Math.min(w, h);
  ctx.fillStyle = POND_LOOK.water;
  ctx.fillRect(left, top, w, h);
  const band = u * 0.28;
  const rim = Math.max(2, Math.round(u * POND_LOOK.rim));
  const sides = [
    [open.n, left, top, w, band, left, top, w, rim],
    [open.s, left, top + h - band, w, band, left, top + h - rim, w, rim],
    [open.w, left, top, band, h, left, top, rim, h],
    [open.e, left + w - band, top, band, h, left + w - rim, top, rim, h],
  ] as const;
  ctx.fillStyle = POND_LOOK.shade;
  for (const [on, x, y, sw, sh] of sides) if (on) ctx.fillRect(x, y, sw, sh);
  ctx.fillStyle = POND_LOOK.stone;
  for (const [on, , , , , x, y, sw, sh] of sides) if (on) ctx.fillRect(x, y, sw, sh);
  // A few darker pebbles set in the rim.
  ctx.fillStyle = POND_LOOK.pebble;
  ctx.beginPath();
  const r = Math.max(1, rim * 0.32);
  for (const [on, , , , , x, y, sw, sh] of sides) {
    if (!on) continue;
    for (const t of [0.22, 0.58, 0.86]) {
      const px = sw > sh ? x + sw * t : x + sw / 2;
      const py = sw > sh ? y + sh / 2 : y + sh * t;
      ctx.moveTo(px + r, py);
      ctx.arc(px, py, r, 0, Math.PI * 2);
    }
  }
  ctx.fill();
  if (seed % 3 === 0) {
    // A lily pad: a round leaf with a notch, floating.
    const cx = left + w * (0.3 + ((seed >> 3) % 4) * 0.12);
    const cy = top + h * (0.62 - ((seed >> 5) % 3) * 0.1);
    const pr = u * 0.13;
    ctx.fillStyle = POND_LOOK.lily;
    ctx.strokeStyle = POND_LOOK.lilyEdge;
    ctx.lineWidth = Math.max(1, u * 0.02);
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, pr, 0.35, Math.PI * 2 - 0.15);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }
  const t = still ? 0 : now / 1000;
  const shimmer = 0.42 + 0.3 * Math.sin(t * 1.6 + seed);
  const drift = still ? 0 : Math.sin(t * 0.7 + seed * 1.3) * u * 0.05;
  ctx.strokeStyle = POND_LOOK.glint;
  ctx.globalAlpha = shimmer;
  ctx.lineWidth = Math.max(1, u * 0.045);
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(left + w * 0.26 + drift, top + h * 0.4);
  ctx.lineTo(left + w * 0.44 + drift, top + h * 0.4);
  ctx.moveTo(left + w * 0.54 - drift, top + h * 0.7);
  ctx.lineTo(left + w * 0.66 - drift, top + h * 0.7);
  ctx.stroke();
  ctx.globalAlpha = 1;
}

/**
 * A cast on the water (RFC 0023): rings spreading from a red and white float that bobs, and then,
 * for a fish or a boot, what it brought up leaping out and falling back. Still under reduced
 * motion: the float and one ring, then the catch beside it.
 */
export function paintCast(
  ctx: CanvasRenderingContext2D,
  c: CastMark,
  sx: number,
  sy: number,
  scale: number,
  now: number,
  still: boolean,
) {
  const age = now - c.at;
  if (age < 0 || age > CAST_MS) return;
  const k = age / CAST_MS;
  const fade = k < 0.85 ? 1 : (1 - k) / 0.15;
  ctx.save();
  ctx.globalAlpha = fade;
  ctx.strokeStyle = "rgba(255, 255, 255, 0.85)";
  ctx.lineWidth = Math.max(1, scale * 0.035);
  for (const delay of still ? [0.3] : [0, 0.3]) {
    const ring = still ? 0.5 : (k * 1.6 - delay) % 1;
    if (ring < 0) continue;
    ctx.globalAlpha = fade * (1 - ring) * 0.9;
    ctx.beginPath();
    ctx.ellipse(
      sx,
      sy,
      scale * (0.1 + ring * 0.38),
      scale * (0.05 + ring * 0.19),
      0,
      0,
      Math.PI * 2,
    );
    ctx.stroke();
  }
  ctx.globalAlpha = fade;
  const bob = still ? 0 : Math.sin(age / 160) * scale * 0.03;
  const fr = scale * 0.07;
  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.arc(sx, sy + bob, fr, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#d1453b";
  ctx.beginPath();
  ctx.arc(sx, sy + bob, fr, Math.PI, Math.PI * 2);
  ctx.fill();
  if (c.caught !== "nothing" && k > 0.3) {
    // What came up: a leap from the water and back, or, when still, a moment beside the float.
    const leap = still ? 0.5 : Math.min(1, (k - 0.3) / 0.5);
    const lift = still ? scale * 0.5 : Math.sin(leap * Math.PI) * scale * 0.85;
    const size = scale * 0.62;
    const x = sx + (still ? scale * 0.35 : (leap - 0.5) * scale * 0.4);
    const y = sy - lift - size * 0.25;
    const picture = c.caught === "boot" ? undefined : itemArtImage(c.caught as ArtKind);
    if (picture) {
      ctx.drawImage(picture, x - size / 2, y - size / 2, size, size);
    } else if (c.caught === "boot") {
      // An old boot, dripping.
      ctx.fillStyle = WOOD_DARK;
      ctx.beginPath();
      ctx.roundRect(x - size * 0.18, y - size * 0.3, size * 0.22, size * 0.42, size * 0.05);
      ctx.roundRect(x - size * 0.18, y + size * 0.02, size * 0.42, size * 0.16, size * 0.07);
      ctx.fill();
    }
  }
  ctx.restore();
}

/** Which sides of a tile the land (or a bridge) is on. */
export interface Sides {
  n: boolean;
  e: boolean;
  s: boolean;
  w: boolean;
}

/**
 * A tile of open water between lands (RFC 0038), flat in the ground like a pond but with no rim:
 * the sea, shallows and lapping foam along each side that meets land or a bridge (`paintShore`),
 * and a glint that drifts, still under reduced motion. A tile with water on all four sides is drawn deeper, so a channel darkens away
 * from either bank in one band rather than tile by tile. `shore` says which sides are dry.
 */
export function paintSea(
  ctx: CanvasRenderingContext2D,
  left: number,
  top: number,
  w: number,
  h: number,
  shore: Sides,
  seed: number,
  now: number,
  still: boolean,
) {
  const u = Math.min(w, h);
  ctx.fillStyle = SEA_LOOK.water;
  ctx.fillRect(left, top, w, h);
  // Out of sight of either bank, the water is deeper. Whole tiles, so the channel darkens in one
  // band instead of drawing a lattice of edges.
  if (!shore.n && !shore.e && !shore.s && !shore.w) {
    ctx.fillStyle = SEA_LOOK.deep;
    ctx.fillRect(left, top, w, h);
  }
  const t = still ? 0 : now / 1000;
  paintShore(ctx, left, top, w, h, shore, seed, t);
  const drift = still ? 0 : Math.sin(t * 0.5 + seed * 1.7) * u * 0.07;
  ctx.strokeStyle = POND_LOOK.glint;
  ctx.globalAlpha = 0.3 + 0.18 * Math.sin(t * 1.1 + seed);
  ctx.lineWidth = Math.max(1, u * 0.04);
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(left + w * 0.22 + drift, top + h * (seed % 2 === 0 ? 0.38 : 0.62));
  ctx.lineTo(left + w * 0.46 + drift, top + h * (seed % 2 === 0 ? 0.38 : 0.62));
  ctx.stroke();
  ctx.globalAlpha = 1;
}

/** Where along a shore side each scallop of foam sits, overlapping into one wavy edge. */
const SCALLOPS = [0.1, 0.3, 0.5, 0.7, 0.9] as const;

/**
 * Where the sea meets land: paler shallows, then a band of foam whose edge breaks into scallops
 * that lap in and out with `t` (seconds, 0 under reduced motion, which holds them still). The
 * scallops sit at the same places along every tile's side, so a shore reads as one long edge.
 */
function paintShore(
  ctx: CanvasRenderingContext2D,
  left: number,
  top: number,
  w: number,
  h: number,
  shore: Sides,
  seed: number,
  t: number,
) {
  if (!shore.n && !shore.e && !shore.s && !shore.w) return;
  const u = Math.min(w, h);
  const shallow = u * 0.26;
  const foam = Math.max(1.5, u * 0.07);
  const bubble = Math.max(1, u * 0.1);
  // Each side as where it starts, which way it runs, and which way is out to sea.
  const sides = [
    [shore.n, left, top, 1, 0, 0, 1, w],
    [shore.s, left, top + h, 1, 0, 0, -1, w],
    [shore.w, left, top, 0, 1, 1, 0, h],
    [shore.e, left + w, top, 0, 1, -1, 0, h],
  ] as const;
  ctx.fillStyle = SEA_LOOK.shallow;
  for (const [on, x, y, ax, ay, ox, oy, len] of sides) {
    if (!on) continue;
    ctx.fillRect(
      Math.min(x, x + ox * shallow),
      Math.min(y, y + oy * shallow),
      ax * len + Math.abs(ox) * shallow,
      ay * len + Math.abs(oy) * shallow,
    );
  }
  // Kept to the tile, so a scallop never spills onto the bank.
  ctx.save();
  ctx.beginPath();
  ctx.rect(left, top, w, h);
  ctx.clip();
  ctx.fillStyle = SEA_LOOK.foam;
  ctx.beginPath();
  for (const [on, x, y, ax, ay, ox, oy, len] of sides) {
    if (!on) continue;
    ctx.rect(
      Math.min(x, x + ox * foam),
      Math.min(y, y + oy * foam),
      ax * len + Math.abs(ox) * foam,
      ay * len + Math.abs(oy) * foam,
    );
    for (const [k, f] of SCALLOPS.entries()) {
      const lap = Math.sin(t * 1.3 + seed * 0.7 + k * 2.1) * 0.5 + 0.5;
      const out = foam - bubble * (0.55 - lap * 0.35);
      const r = bubble * (0.9 + lap * 0.25);
      const cx = x + ax * len * f + ox * out;
      const cy = y + ay * len * f + oy * out;
      ctx.moveTo(cx + r, cy);
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
    }
  }
  ctx.fill();
  ctx.restore();
}

/**
 * A tile of bridge over the water (RFC 0038): a timber deck with planks across the way it runs and
 * a rail along each side that meets open water, so the crossing reads as a walk rather than ground
 * that happens to be dry. `run` says which sides carry on to more bridge or to land.
 */
export function paintBridge(
  ctx: CanvasRenderingContext2D,
  left: number,
  top: number,
  w: number,
  h: number,
  run: Sides,
  seed: number,
) {
  const u = Math.min(w, h);
  ctx.fillStyle = SEA_LOOK.deck;
  ctx.fillRect(left, top, w, h);
  // Planks lie across the way the crossing runs: east to west along it, north to south across.
  const alongX = run.e || run.w;
  ctx.strokeStyle = SEA_LOOK.plank;
  ctx.lineWidth = Math.max(1, u * 0.055);
  ctx.beginPath();
  for (const f of [0.22, 0.5, 0.78]) {
    if (alongX) {
      const x = left + w * f;
      ctx.moveTo(x, top);
      ctx.lineTo(x, top + h);
    } else {
      const y = top + h * f;
      ctx.moveTo(left, y);
      ctx.lineTo(left + w, y);
    }
  }
  ctx.stroke();
  // A rail where the deck's edge is over water.
  const rail = Math.max(1.5, u * 0.12);
  ctx.fillStyle = SEA_LOOK.rail;
  if (!run.n) ctx.fillRect(left, top, w, rail);
  if (!run.s) ctx.fillRect(left, top + h - rail, w, rail);
  if (!run.w) ctx.fillRect(left, top, rail, h);
  if (!run.e) ctx.fillRect(left + w - rail, top, rail, h);
  // One darker board, so a long crossing isn't a flat ribbon.
  if (seed % 3 === 0) {
    ctx.fillStyle = SEA_LOOK.plank;
    if (alongX) ctx.fillRect(left + w * 0.36, top + rail, w * 0.14, h - rail * 2);
    else ctx.fillRect(left + rail, top + h * 0.36, w - rail * 2, h * 0.14);
  }
}
