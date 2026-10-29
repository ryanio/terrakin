/**
 * Name tags on a scene photo (RFC 0049), laid out in screen space after the scene has drawn.
 * Pure: given where each head is on the picture and how wide text measures, it says where every
 * tag goes, so the rules are tested without a browser.
 *
 * - Readable: 24 px text on a solid paper backing, ink on paper well past 4.5:1, day or night. A
 *   name wider than 14 characters is cut with an ellipsis.
 * - No overlaps: a tag starts just above its head. When it would touch a tag already placed or
 *   cover someone's face, it moves up a step, then sideways, and gets a thin leader line back.
 * - Leaders: short, and never across another tag, another leader, or anyone's face.
 * - Edges: every tag keeps `TAG_STYLE.inset` inside the frame, pulled inward with a leader line
 *   rather than cropped. A face the frame cuts gets no tag.
 * - Crowds: at most `maxTags`, the subject and the nearest first; the rest are counted in `more`.
 */

import { BRAND_HEX } from "@terrakin/ui/brand";

export const TAG_STYLE = {
  /** Text size on the 1200x900 picture. */
  fontPx: 24,
  font: '600 24px "Figtree Variable", system-ui, sans-serif',
  padX: 14,
  padY: 8,
  /** The gap between the top of a head and the tag's bottom. */
  gap: 8,
  /** How far inside the frame's edges every tag stays. */
  inset: 24,
  /** How far apart two tags stay. */
  spacing: 6,
  /** Ink on paper: the player-text colors of the name tags in the world. */
  backing: BRAND_HEX.paper,
  edge: BRAND_HEX.paperEdge,
  text: BRAND_HEX.ink,
  leader: BRAND_HEX.ink,
  /** A name cut past this many characters' width. */
  maxChars: 14,
  /** The longest leader line: a tag further off than this from its head is left out instead. */
  maxLeader: 180,
} as const;

/** Where a resident's head is on the picture, in pixels. */
export interface TagHead {
  id: string;
  name: string;
  /** The top of the head. */
  x: number;
  y: number;
  /** How far from the camera: nearer heads are placed first and keep their spots. */
  depth: number;
  /** The face's radius on the picture, so no tag covers it. */
  face: number;
}

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface PlacedTag {
  id: string;
  text: string;
  box: Box;
  /** From the tag back to its head, when the tag had to move from just above it. */
  leader?: { x1: number; y1: number; x2: number; y2: number };
}

export interface TagLayout {
  tags: PlacedTag[];
  /** Residents in the picture who got no tag: past the most, or nowhere clear to put one. */
  more: number;
}

export interface TagOptions {
  width: number;
  height: number;
  /** Text width in pixels at `TAG_STYLE.font`. */
  measure: (text: string) => number;
  /** Who keeps a tag first in a crowd, in order: the subject, then the nearest. */
  first?: readonly string[];
  maxTags?: number;
}

/** A name cut to fit `maxChars` characters' width, with an ellipsis. */
function fitName(name: string, measure: (text: string) => number): string {
  const room = measure("n".repeat(TAG_STYLE.maxChars));
  if (measure(name) <= room) return name;
  let cut = name;
  while (cut.length > 1 && measure(`${cut}…`) > room) cut = cut.slice(0, -1);
  return `${cut.trimEnd()}…`;
}

type Segment = { x1: number; y1: number; x2: number; y2: number };

/** Whether two segments cross. */
function crosses(a: Segment, b: Segment): boolean {
  const side = (px: number, py: number, s: Segment) =>
    Math.sign((s.x2 - s.x1) * (py - s.y1) - (s.y2 - s.y1) * (px - s.x1));
  return (
    side(a.x1, a.y1, b) * side(a.x2, a.y2, b) < 0 && side(b.x1, b.y1, a) * side(b.x2, b.y2, a) < 0
  );
}

/** Whether a segment passes within `r` of the point (cx, cy). */
function segmentNear(s: Segment, cx: number, cy: number, r: number): boolean {
  const dx = s.x2 - s.x1;
  const dy = s.y2 - s.y1;
  const t = Math.max(
    0,
    Math.min(1, ((cx - s.x1) * dx + (cy - s.y1) * dy) / (dx * dx + dy * dy || 1)),
  );
  return (s.x1 + t * dx - cx) ** 2 + (s.y1 + t * dy - cy) ** 2 < r * r;
}

/** Whether a segment passes through a box (grown by `gap`). */
export function segmentHitsBox(s: Segment, b: Box, gap = 0): boolean {
  const x0 = b.x - gap;
  const y0 = b.y - gap;
  const x1 = b.x + b.w + gap;
  const y1 = b.y + b.h + gap;
  const inside = (x: number, y: number) => x > x0 && x < x1 && y > y0 && y < y1;
  if (inside(s.x1, s.y1) || inside(s.x2, s.y2)) return true;
  const edges: Segment[] = [
    { x1: x0, y1: y0, x2: x1, y2: y0 },
    { x1: x1, y1: y0, x2: x1, y2: y1 },
    { x1: x1, y1: y1, x2: x0, y2: y1 },
    { x1: x0, y1: y1, x2: x0, y2: y0 },
  ];
  return edges.some((e) => crosses(s, e));
}

const touches = (a: Box, b: Box, gap: number) =>
  a.x < b.x + b.w + gap && b.x < a.x + a.w + gap && a.y < b.y + b.h + gap && b.y < a.y + a.h + gap;

/** Whether box `b` covers any of the circle at (cx, cy) with radius r. */
function coversCircle(b: Box, cx: number, cy: number, r: number): boolean {
  const nx = Math.max(b.x, Math.min(cx, b.x + b.w));
  const ny = Math.max(b.y, Math.min(cy, b.y + b.h));
  return (nx - cx) ** 2 + (ny - cy) ** 2 < r * r;
}

export function layoutTags(heads: readonly TagHead[], o: TagOptions): TagLayout {
  const { width, height, measure } = o;
  const { inset, gap, spacing, padX, padY, fontPx } = TAG_STYLE;
  const maxTags = o.maxTags ?? 12;
  // Only a face the frame shows whole: one cut by an edge is someone mostly out of the picture.
  const whole = heads.filter(
    (h) => h.x - h.face >= 0 && h.x + h.face <= width && h.y >= 0 && h.y + h.face * 2 <= height,
  );
  // Two people on one tile are drawn one over the other: only the nearer gets a tag, since two
  // lines to one head can't say which name is whose.
  const nearer = (a: TagHead, b: TagHead) =>
    a.depth < b.depth || (a.depth === b.depth && a.id < b.id);
  const inFrame = whole.filter(
    (h) =>
      !whole.some(
        (o) =>
          o !== h && nearer(o, h) && Math.hypot(o.x - h.x, o.y - h.y) < Math.min(o.face, h.face),
      ),
  );
  const rank = new Map((o.first ?? []).map((id, i) => [id, i]));
  const byKeep = [...inFrame].sort(
    (a, b) =>
      (rank.get(a.id) ?? Infinity) - (rank.get(b.id) ?? Infinity) ||
      a.depth - b.depth ||
      (a.id < b.id ? -1 : 1),
  );
  const kept = byKeep.slice(0, maxTags);
  // Faces nobody's tag may cover: everyone, even a head just past the edge whose face shows.
  const faces = heads.map((h) => ({ id: h.id, cx: h.x, cy: h.y + h.face, r: h.face }));
  const placed: PlacedTag[] = [];
  const h = Math.round(fontPx * 1.2 + padY * 2);
  const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
  const fits = (b: Box, own: string, leader: Segment | undefined) =>
    !placed.some((p) => touches(p.box, b, spacing)) &&
    !placed.some((p) => p.leader !== undefined && segmentHitsBox(p.leader, b, 2)) &&
    !(
      leader &&
      (Math.hypot(leader.x2 - leader.x1, leader.y2 - leader.y1) > TAG_STYLE.maxLeader ||
        faces.some((f) => f.id !== own && segmentNear(leader, f.cx, f.cy, f.r)) ||
        placed.some(
          (p) =>
            segmentHitsBox(leader, p.box, 2) ||
            (p.leader !== undefined && crosses(leader, p.leader)),
        ))
    ) &&
    !faces.some((f) => f.id !== own && coversCircle(b, f.cx, f.cy, f.r)) &&
    !faces.some((f) => f.id === own && coversCircle(b, f.cx, f.cy, f.r * 0.9));
  // Nearest the camera first: the one further back is the one that moves.
  for (const head of [...kept].sort((a, b) => a.depth - b.depth || (a.id < b.id ? -1 : 1))) {
    const text = fitName(head.name, measure);
    const w = Math.ceil(measure(text) + padX * 2);
    if (w > width - inset * 2) continue;
    const place = (cx: number, bottom: number): Box => ({
      x: clamp(Math.round(cx - w / 2), inset, width - inset - w),
      y: clamp(Math.round(bottom - h), inset, height - inset - h),
      w,
      h,
    });
    const step = h + spacing;
    const tries: Box[] = [];
    // Straight up a step at a time, then a little to each side and up: a column of tags with
    // short straight leaders reads better than lines running across the picture.
    for (let up = 0; up <= 5; up++) tries.push(place(head.x, head.y - gap - up * step));
    for (let side = 1; side <= 2; side++) {
      for (let up = 0; up <= 4; up++) {
        for (const dir of [1, -1]) {
          tries.push(place(head.x + dir * side * (w / 2 + spacing), head.y - gap - up * step));
        }
      }
    }
    // Beside the face, then below it, for a head too near the top for anything above it, as in a
    // portrait.
    for (const dir of [1, -1])
      tries.push(place(head.x + dir * (head.face + spacing + w / 2), head.y + head.face + h / 2));
    // Below it last.
    for (let down = 0; down <= 2; down++)
      tries.push(place(head.x, head.y + head.face * 2 + gap + h + down * step));
    // Where it would sit with no frame and nobody else: anything else gets a leader.
    const natural = { x: Math.round(head.x - w / 2), y: Math.round(head.y - gap - h) };
    const leaderFor = (box: Box): Segment | undefined => {
      const moved = Math.abs(box.x - natural.x) > 2 || Math.abs(box.y - natural.y) > 2;
      if (!moved) return undefined;
      // From the tag's nearest edge back to the head: down to its top from above, across to the
      // side of the face from beside it, up to the chin from below.
      if (box.y + box.h <= head.y)
        return {
          x1: clamp(head.x, box.x + 8, box.x + box.w - 8),
          y1: box.y + box.h,
          x2: head.x,
          y2: head.y - 2,
        };
      const middle = head.y + head.face;
      if (box.y < middle && box.y + box.h > middle - head.face) {
        const right = box.x >= head.x;
        return {
          x1: right ? box.x : box.x + box.w,
          y1: box.y + box.h / 2,
          x2: head.x + (right ? 1 : -1) * (head.face + 2),
          y2: middle,
        };
      }
      return {
        x1: clamp(head.x, box.x + 8, box.x + box.w - 8),
        y1: box.y,
        x2: head.x,
        y2: head.y + head.face * 2 + 2,
      };
    };
    const box = tries.find((b) => fits(b, head.id, leaderFor(b)));
    if (!box) continue;
    const leader = leaderFor(box);
    const tag: PlacedTag = { id: head.id, text, box, ...(leader ? { leader } : {}) };
    placed.push(tag);
  }
  return { tags: placed, more: whole.length - placed.length };
}

/** WCAG contrast ratio between two `#rrggbb` colors. */
export function contrastRatio(a: string, b: string): number {
  const lum = (hex: string) => {
    const [r, g, bl] = [1, 3, 5].map((i) => {
      const c = Number.parseInt(hex.slice(i, i + 2), 16) / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * (r ?? 0) + 0.7152 * (g ?? 0) + 0.0722 * (bl ?? 0);
  };
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return ((hi ?? 0) + 0.05) / ((lo ?? 0) + 0.05);
}
