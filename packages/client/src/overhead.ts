/**
 * What shows around a resident besides their face: a puff when they land from a jump, and a bubble
 * with what they said. Plain canvas drawing, so the map draws it in place and the 3D view draws it
 * onto its sprites. Chat is their words: it's only ever drawn as canvas text, which can't run
 * anything.
 */
import { BRAND_HEX } from "@terrakin/ui/brand";

const PAPER = BRAND_HEX.paper;
const PAPER_EDGE = BRAND_HEX.paperEdge;
const INK = BRAND_HEX.ink;

/** A puff of dust where someone lands after a jump, `t` from 0 to 1. */
export function drawPoof(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  scale: number,
  t: number,
) {
  ctx.fillStyle = `rgba(255, 250, 240, ${(0.75 * (1 - t)).toFixed(3)})`;
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const reach = scale * (0.2 + t * 0.35);
    const px = x + Math.cos(a) * reach;
    const py = y - scale * 0.1 + Math.sin(a) * reach * 0.45;
    const r = scale * (0.12 - t * 0.06);
    ctx.moveTo(px + r, py);
    ctx.arc(px, py, r, 0, Math.PI * 2);
  }
  ctx.fill();
}

/** A little kick of dust at someone's feet as a step pushes off, `t` from 0 to 1. */
export function drawDust(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  scale: number,
  t: number,
) {
  ctx.fillStyle = `rgba(196, 168, 124, ${(0.75 * (1 - t)).toFixed(3)})`;
  ctx.beginPath();
  for (const side of [-1, 1]) {
    const px = x + side * scale * (0.16 + t * 0.14);
    const py = y - scale * (0.03 + t * 0.05);
    const r = scale * (0.05 + t * 0.03);
    ctx.moveTo(px + r, py);
    ctx.arc(px, py, r, 0, Math.PI * 2);
  }
  ctx.fill();
}

/** A box on screen, in CSS pixels. */
export interface Box {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/**
 * How far to raise each bubble, in order, so it clears `avoid` (name tags and signs) and the
 * bubbles placed before it. Put the nearest first: it keeps the spot right over its speaker.
 */
export function stackBubbles(bubbles: readonly Box[], avoid: readonly Box[], gap = 3): number[] {
  const placed = [...avoid];
  return bubbles.map((b) => {
    let raise = 0;
    for (let tries = 0; tries < 12; tries++) {
      const top = b.top - raise;
      const bottom = b.bottom - raise;
      const hit = placed.find(
        (o) =>
          b.left < o.right + gap &&
          b.right > o.left - gap &&
          top < o.bottom + gap &&
          bottom > o.top - gap,
      );
      if (!hit) break;
      raise = b.bottom - (hit.top - gap);
    }
    placed.push({ ...b, top: b.top - raise, bottom: b.bottom - raise });
    return raise;
  });
}

/** How much of a name tag's paper shows while the tag lies over something standing on the map. */
export const TAG_OVER_ART = 0.45;
/** How far into a tile a tag reaches before it counts as over it, in tiles. */
const TAG_SLIVER = 0.3;

/**
 * How strongly to draw a name tag's paper: whole on open ground, and see-through (`TAG_OVER_ART`)
 * while the tag lies over a tile with something standing on it, so decor north of someone, a
 * snowman or a lamp, still shows behind their name. The name itself is always drawn whole, and the
 * tag stays where it was, so tags and bubbles stack as they did. `tileAt` is the tile under a
 * point on screen, `scale` a tile's size there, and `stands` whether the map draws a block
 * standing on a tile. A sliver of a neighboring tile under the tag's edge doesn't count.
 */
export function tagPaper(
  tag: Box,
  scale: number,
  tileAt: (sx: number, sy: number) => { x: number; y: number },
  stands: (x: number, y: number) => boolean,
): number {
  const edge = scale * TAG_SLIVER;
  // A tag too small to trim still lies over the tile under its middle.
  const trim = (lo: number, hi: number) =>
    hi - lo > edge * 2
      ? ([lo + edge, hi - edge] as const)
      : ([(lo + hi) / 2, (lo + hi) / 2] as const);
  const [left, right] = trim(tag.left, tag.right);
  const [top, bottom] = trim(tag.top, tag.bottom);
  const from = tileAt(left, top);
  const to = tileAt(right, bottom);
  for (let y = from.y; y <= to.y; y++) {
    for (let x = from.x; x <= to.x; x++) if (stands(x, y)) return TAG_OVER_ART;
  }
  return 1;
}

/** Where a bubble with its tail's tip at (x, bottom) sits, before any raise. */
export function bubbleBox(
  ctx: CanvasRenderingContext2D,
  x: number,
  bottom: number,
  lines: string[],
  fontSize: number,
  font: string,
  right: number,
): Box {
  const { w, h } = bubbleSize(ctx, lines, fontSize, font);
  const left = Math.min(Math.max(x - w / 2, 4), right - w - 4);
  return { left, right: left + w, top: bottom - h, bottom };
}

/** The size of a bubble holding `lines`, its tail included. */
export function bubbleSize(
  ctx: CanvasRenderingContext2D,
  lines: string[],
  fontSize: number,
  font: string,
): { w: number; h: number } {
  ctx.font = font;
  const w = Math.max(...lines.map((l) => ctx.measureText(l).width)) + fontSize * 1.2;
  return { w, h: lines.length * fontSize * 1.25 + fontSize * 0.7 + fontSize * 0.45 };
}

/**
 * What someone said, on a paper bubble with its tail's tip at (x, bottom), kept between 4 and
 * `right - 4` across. `raise` lifts the bubble clear of others, and its tail stretches down to
 * the tip. Their words, drawn as text.
 */
export function drawBubble(
  ctx: CanvasRenderingContext2D,
  x: number,
  bottom: number,
  lines: string[],
  alpha: number,
  fontSize: number,
  font: string,
  right: number,
  raise = 0,
) {
  const lineH = fontSize * 1.25;
  const tail = fontSize * 0.45;
  const { w, h: whole } = bubbleSize(ctx, lines, fontSize, font);
  const h = whole - tail;
  const top = bottom - raise - tail - h;
  const left = Math.min(Math.max(x - w / 2, 4), right - w - 4);
  ctx.globalAlpha = alpha;
  ctx.fillStyle = "rgba(74, 52, 28, 0.16)";
  ctx.beginPath();
  ctx.roundRect(left, top + 2, w, h, fontSize * 0.7);
  ctx.fill();
  ctx.fillStyle = PAPER;
  ctx.strokeStyle = PAPER_EDGE;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.roundRect(left, top, w, h, fontSize * 0.7);
  ctx.moveTo(x - tail, top + h);
  ctx.lineTo(x, bottom);
  ctx.lineTo(x + tail, top + h);
  ctx.fill();
  ctx.stroke();
  // Paint over the seam where the tail meets the bubble.
  ctx.fillRect(x - tail + 1, top + h - 1.5, tail * 2 - 2, 2);
  ctx.fillStyle = INK;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (const [i, line] of lines.entries())
    ctx.fillText(line, left + w / 2, top + fontSize * 0.35 + lineH * (i + 0.5));
  ctx.globalAlpha = 1;
}
