import { describe, expect, it } from "vitest";
import {
  type Box,
  contrastRatio,
  layoutTags,
  segmentHitsBox,
  TAG_STYLE,
  type TagHead,
} from "./photo-tags";

/** Text as wide as a 24 px semibold face sets it, near enough: 13 px a character. */
const measure = (text: string) => text.length * 13;
const FRAME = { width: 1200, height: 836, measure };

const touch = (a: Box, b: Box) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/** Every rule the RFC sets, checked on one layout. */
function expectClean(heads: TagHead[], layout: ReturnType<typeof layoutTags>, frame = FRAME) {
  const { inset } = TAG_STYLE;
  for (const t of layout.tags) {
    expect(t.box.x, t.id).toBeGreaterThanOrEqual(inset);
    expect(t.box.y, t.id).toBeGreaterThanOrEqual(inset);
    expect(t.box.x + t.box.w, t.id).toBeLessThanOrEqual(frame.width - inset);
    expect(t.box.y + t.box.h, t.id).toBeLessThanOrEqual(frame.height - inset);
    for (const o of layout.tags) {
      if (o === t) continue;
      expect(touch(t.box, o.box), `${t.id} ${o.id}`).toBe(false);
      // No leader runs through another tag.
      if (t.leader)
        expect(segmentHitsBox(t.leader, o.box), `${t.id}'s line over ${o.id}`).toBe(false);
    }
    if (t.leader) {
      const { x1, y1, x2, y2 } = t.leader;
      expect(Math.hypot(x2 - x1, y2 - y1), `${t.id}'s line`).toBeLessThanOrEqual(
        TAG_STYLE.maxLeader,
      );
    }
    for (const h of heads) {
      if (h.id === t.id) continue;
      // No tag over another resident's face.
      const cx = h.x;
      const cy = h.y + h.face;
      const nx = Math.max(t.box.x, Math.min(cx, t.box.x + t.box.w));
      const ny = Math.max(t.box.y, Math.min(cy, t.box.y + t.box.h));
      expect((nx - cx) ** 2 + (ny - cy) ** 2, `${t.id} over ${h.id}`).toBeGreaterThanOrEqual(
        h.face ** 2,
      );
    }
  }
  expect(layout.tags.length).toBeLessThanOrEqual(12);
}

const head = (id: string, x: number, y: number, depth = 10, face = 18): TagHead => ({
  id,
  name: id,
  x,
  y,
  depth,
  face,
});

describe("name tags on a scene photo", () => {
  it("are big enough to read, ink on a solid backing well past 4.5:1", () => {
    expect(TAG_STYLE.fontPx).toBeGreaterThanOrEqual(22);
    expect(contrastRatio(TAG_STYLE.text, TAG_STYLE.backing)).toBeGreaterThanOrEqual(4.5);
  });

  it("sits a tag just above a lone head, with no leader", () => {
    const layout = layoutTags([head("Ada", 600, 400)], FRAME);
    expect(layout.more).toBe(0);
    const [tag] = layout.tags;
    expect(tag?.leader).toBeUndefined();
    expect((tag?.box.y ?? 0) + (tag?.box.h ?? 0)).toBe(400 - TAG_STYLE.gap);
    expect((tag?.box.x ?? 0) + (tag?.box.w ?? 0) / 2).toBeCloseTo(600, -1);
  });

  it("pulls a tag at the frame's edge inward with a leader, and leaves out a head outside it", () => {
    // Edge's face just fits at the left; Gone's is cut by the frame, so they're mostly out of it.
    const heads = [head("Edge", 20, 300), head("Top", 900, 10), head("Gone", 6, 500)];
    const layout = layoutTags(heads, FRAME);
    expectClean(heads, layout);
    expect(layout.tags.map((t) => t.id).sort()).toEqual(["Edge", "Top"]);
    expect(layout.more).toBe(0);
    expect(layout.tags.find((t) => t.id === "Edge")?.leader).toBeDefined();
  });

  it("tags only the nearer of two people drawn one over the other", () => {
    const heads = [head("Front", 600, 400, 5), head("Behind", 603, 402, 5.2)];
    const layout = layoutTags(heads, FRAME);
    expect(layout.tags.map((t) => t.id)).toEqual(["Front"]);
    expect(layout.more).toBe(1);
  });

  it("puts a portrait's tag beside the face when there's no room above the head", () => {
    // A selfie: the head's top just under the frame's top, the face large.
    const heads = [head("Bay", 600, 60, 2, 140)];
    const layout = layoutTags(heads, FRAME);
    expectClean(heads, layout);
    const box = layout.tags[0]?.box;
    if (!box) throw new Error("no tag");
    // Level with the face, clear of it to one side, never on the chest under it.
    expect(box.y + box.h).toBeLessThan(60 + 2 * 140);
    expect(box.x >= 600 + 140 || box.x + box.w <= 600 - 140).toBe(true);
  });

  it("cuts a long name with an ellipsis", () => {
    const layout = layoutTags(
      [{ ...head("a", 600, 400), name: "Bartholomew_the_Third_of_Clay" }],
      FRAME,
    );
    expect(layout.tags[0]?.text).toMatch(/…$/);
    expect(measure(layout.tags[0]?.text ?? "")).toBeLessThanOrEqual(measure("n".repeat(14)));
  });

  it("keeps a crowd to 12 tags, the subject first, and counts the rest", () => {
    // Twenty people at an event, packed shoulder to shoulder in four rows.
    const heads = Array.from({ length: 20 }, (_, i) =>
      head(`r${i}`, 380 + (i % 5) * 90, 380 + Math.floor(i / 5) * 60, 4 + Math.floor(i / 5), 16),
    );
    const subject = "r19";
    const layout = layoutTags(heads, { ...FRAME, first: [subject] });
    expectClean(heads, layout);
    expect(layout.tags.length).toBeGreaterThan(0);
    expect(layout.tags.length + layout.more).toBe(20);
    expect(layout.tags.map((t) => t.id)).toContain(subject);
  });

  it("never overlaps, crops, or covers a face, whatever the scene", () => {
    // Pseudo-random scenes, the same every run.
    let seed = 7;
    const rand = () => {
      seed = (seed * 1103515245 + 12345) % 2 ** 31;
      return seed / 2 ** 31;
    };
    for (let scene = 0; scene < 200; scene++) {
      const count = 1 + Math.floor(rand() * 24);
      const heads = Array.from({ length: count }, (_, i) => ({
        ...head(`p${i}`, rand() * 1260 - 30, rand() * 900 - 30, rand() * 30, 8 + rand() * 30),
        name: "x".repeat(1 + Math.floor(rand() * 24)),
      }));
      expectClean(heads, layoutTags(heads, FRAME));
    }
  });
});
