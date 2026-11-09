import { BIOMES } from "@terrakin/sim";
import { describe, expect, it } from "vitest";
import {
  FEATURE_KINDS,
  featureOn,
  onRoad,
  plotFeature,
  type YardGrowth,
  yardGrowth,
} from "./wild-yard";

/** A slot after the regrid: 16 tiles, its middle 8 by 8 starting 4 in. */
const SLOT = 16;
const RING = 4;

/** What grows on every tile of slot (px, py)'s ring, in `biome`. */
function ringOf(px: number, py: number, biome: (typeof BIOMES)[number], season?: "winter") {
  const out: (YardGrowth | null)[] = [];
  for (let y = 0; y < SLOT; y++) {
    for (let x = 0; x < SLOT; x++) {
      const middle = x >= RING && x < RING + 8 && y >= RING && y < RING + 8;
      if (!middle) out.push(yardGrowth(px * SLOT + x, py * SLOT + y, biome, season));
    }
  }
  return out;
}

const count = (list: (YardGrowth | null)[], kind: YardGrowth["kind"]) =>
  list.filter((g) => g?.kind === kind).length;

describe("the wild yard's growth", () => {
  it("makes a meadow yard feel grown, not bare and not a wood: some trees and bushes, flowers, and open grass", () => {
    // Across many slots, so the check is about the mix, not one lucky slot.
    for (const [px, py] of [
      [2, 3],
      [5, 1],
      [7, 6],
      [0, 0],
    ] as const) {
      const ring = ringOf(px, py, "meadow");
      expect(ring).toHaveLength(192);
      expect(count(ring, "tree")).toBeGreaterThanOrEqual(2);
      expect(count(ring, "tree")).toBeLessThanOrEqual(18);
      expect(count(ring, "bush")).toBeGreaterThanOrEqual(3);
      expect(count(ring, "flowers")).toBeGreaterThanOrEqual(12);
      // Most of it stays open to walk and look across.
      expect(ring.filter((g) => g === null || g.kind === "grass").length).toBeGreaterThan(130);
    }
  });

  it("grows thicker in a forest and sparser on sand, where no tree or flower grows", () => {
    const forest = ringOf(3, 3, "forest");
    const meadow = ringOf(3, 3, "meadow");
    const sand = ringOf(3, 3, "sand");
    expect(count(forest, "tree")).toBeGreaterThan(count(meadow, "tree"));
    expect(count(sand, "tree")).toBe(0);
    expect(count(sand, "flowers")).toBe(0);
  });

  it("puts no flower out in winter, and no tree on a street's verge", () => {
    expect(count(ringOf(4, 2, "meadow", "winter"), "flowers")).toBe(0);
    for (let x = 0; x < 400; x++)
      expect(yardGrowth(x, 7, "forest", undefined, "verge")?.kind).not.toBe("tree");
  });

  it("keeps everything inside its own tile, so a canopy never reaches the next", () => {
    for (const biome of BIOMES) {
      for (const g of ringOf(6, 4, biome)) {
        if (!g || (g.kind !== "tree" && g.kind !== "bush")) continue;
        expect(g.fx - g.size).toBeGreaterThanOrEqual(0);
        expect(g.fx + g.size).toBeLessThanOrEqual(1);
        expect(g.fy - g.size).toBeGreaterThanOrEqual(0);
        expect(g.fy + g.size).toBeLessThanOrEqual(1);
      }
    }
  });
});

describe("a slot's feature", () => {
  const slots = Array.from({ length: 400 }, (_, i) => [i % 20, Math.floor(i / 20)] as const);

  it("stands in the ring, never in the middle 8 by 8 where homes built before the regrid are", () => {
    for (const [px, py] of slots) {
      for (const t of plotFeature(px, py, SLOT, RING)?.tiles ?? []) {
        expect(t.x).toBeGreaterThanOrEqual(0);
        expect(t.y).toBeGreaterThanOrEqual(0);
        expect(t.x).toBeLessThan(SLOT);
        expect(t.y).toBeLessThan(SLOT);
        const middle = t.x >= RING && t.x < RING + 8 && t.y >= RING && t.y < RING + 8;
        expect(middle).toBe(false);
      }
    }
  });

  it("is one of the four kinds, or none, and every kind turns up somewhere", () => {
    const kinds = slots.map(([px, py]) => plotFeature(px, py, SLOT, RING)?.kind ?? "none");
    for (const kind of [...FEATURE_KINDS, "none"]) expect(kinds).toContain(kind);
    // Most slots have one, so a street of homes doesn't read as alike.
    expect(kinds.filter((k) => k === "none").length).toBeLessThan(slots.length / 3);
  });

  it("is nothing in a world before its regrid, where a slot has no yard", () => {
    for (const [px, py] of slots.slice(0, 40)) expect(plotFeature(px, py, 8, 0)).toBeNull();
  });

  it("draws whole or not at all: a way or a grown lot over any of its tiles leaves it out", () => {
    const [px, py] = slots.find(([x, y]) => plotFeature(x, y, SLOT, RING)) ?? [0, 0];
    const whole = featureOn(px, py, SLOT, RING, () => true);
    expect(whole?.world.length).toBeGreaterThan(0);
    const first = whole?.world[0];
    const blocked = featureOn(px, py, SLOT, RING, (x, y) => x !== first?.x || y !== first?.y);
    expect(blocked).toBeNull();
  });
});

describe("a street's road", () => {
  const none = { n: false, e: false, s: false, w: false };
  const row = (ly: number, arms: typeof none) =>
    Array.from({ length: SLOT }, (_, lx) => (onRoad(lx, ly, SLOT, arms) ? "#" : ".")).join("");

  it("runs four tiles wide down the middle toward the streets beside it, with verge either side", () => {
    const eastWest = { ...none, e: true, w: true };
    expect(row(5, eastWest)).toBe("................");
    expect(row(6, eastWest)).toBe("################");
    expect(row(9, eastWest)).toBe("################");
    expect(row(10, eastWest)).toBe("................");
    // A corner turns: north out of the middle, and west.
    const corner = { ...none, n: true, w: true };
    expect(row(0, corner)).toBe("......####......");
    expect(row(7, corner)).toBe("##########......");
    expect(row(12, corner)).toBe("................");
  });

  it("runs east and west when nothing beside it is a street", () => {
    expect(row(7, none)).toBe("################");
    expect(row(0, none)).toBe("................");
  });
});
