import { describe, expect, it } from "vitest";
import { biomeAt } from "./biome";
import { THEME_INFO } from "./looks";
import {
  alphaHex,
  BLOCK_COLORS,
  blockFill,
  COMMONS_GROUND,
  GROUND,
  groundTile,
  mixHex,
  TUFT_STROKE,
  tileHash,
  tuftStroke,
} from "./palette";
import type { Season } from "./season";
import { DEFAULT_CONFIG } from "./world";

describe("the world palette", () => {
  it("tones each tile from its biome, and the Commons from its own sand", () => {
    for (let y = 0; y < 40; y += 3) {
      for (let x = 0; x < 40; x += 5) {
        const tile = groundTile(DEFAULT_CONFIG, x, y, false);
        expect(tile.biome).toBe(biomeAt(DEFAULT_CONFIG, x, y));
        expect(GROUND[tile.biome]).toContain(tile.fill);
        expect(COMMONS_GROUND).toContain(groundTile(DEFAULT_CONFIG, x, y, true).fill);
      }
    }
  });

  it("grows tufts and flowers only on meadow and forest, never in the Commons", () => {
    let grown = 0;
    for (let y = 0; y < 64; y++) {
      for (let x = 0; x < 64; x++) {
        const tile = groundTile(DEFAULT_CONFIG, x, y, false);
        if (tile.scenery) {
          grown++;
          expect(["meadow", "forest"]).toContain(tile.biome);
        }
        expect(groundTile(DEFAULT_CONFIG, x, y, true).scenery).toBeNull();
      }
    }
    expect(grown).toBeGreaterThan(100);
  });

  it("pins the hash, so the world and its photos keep the same ground", () => {
    expect(tileHash(0, 0)).toBe(0);
    expect(tileHash(3, 7)).toBe(260_807_386);
  });

  it("dresses blocks in a theme, except glass, stations, and decor", () => {
    const lemon = THEME_INFO.lemon.palette;
    expect(blockFill("wood")).toBe(BLOCK_COLORS.wood);
    expect(blockFill("wood", lemon)).toBe(mixHex(lemon.light, lemon.main, 0.45));
    expect(blockFill("glass", lemon)).toBe(BLOCK_COLORS.glass);
    expect(blockFill("kitchen", lemon)).toBe(BLOCK_COLORS.kitchen);
    expect(blockFill("lantern", lemon)).toBe(BLOCK_COLORS.lantern);
    expect(blockFill("fence", lemon)).toBe(BLOCK_COLORS.fence);
  });

  it("mixes and fades hex colors", () => {
    expect(mixHex("#000000", "#ffffff", 0.5)).toBe("#808080");
    expect(alphaHex("#f2b84b", 0.34)).toBe("rgba(242, 184, 75, 0.34)");
  });
});

describe("the ground through the seasons", () => {
  const tiles = (season: Season | undefined, inCommons = false) => {
    const out = [];
    for (let y = 0; y < 64; y++)
      for (let x = 0; x < 64; x++) out.push(groundTile(DEFAULT_CONFIG, x, y, inCommons, season));
    return out;
  };
  const rgb = (hex: string) => {
    const n = Number.parseInt(hex.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255] as const;
  };
  const kinds = (list: ReturnType<typeof tiles>) =>
    new Set(list.map((t) => t.scenery?.kind).filter(Boolean));

  it("keeps today's look in spring and summer", () => {
    expect(tiles("spring")).toEqual(tiles(undefined));
    expect(tiles("summer")).toEqual(tiles(undefined));
    expect(tuftStroke("summer")).toBe(TUFT_STROKE);
  });

  it("warms the grass in autumn and scatters fallen leaves where flowers grew", () => {
    const summer = tiles("summer");
    const autumn = tiles("autumn");
    const leaves = autumn.filter((t) => t.scenery?.kind === "leaf");
    expect(kinds(autumn)).toEqual(new Set(["tuft", "leaf"]));
    expect(leaves.length).toBeGreaterThan(summer.filter((t) => t.scenery).length);
    for (const leaf of leaves) expect(["meadow", "forest"]).toContain(leaf.biome);
    for (const [i, tile] of autumn.entries()) {
      if (tile.biome !== "meadow") continue;
      const [r, , b] = rgb(tile.fill);
      const [r0, , b0] = rgb(summer[i]?.fill ?? "");
      expect(r).toBeGreaterThan(r0);
      expect(b).toBeLessThan(b0);
    }
    expect(tiles("autumn", true)).toEqual(tiles(undefined, true));
  });

  it("lays snow on every biome and the Commons in winter, with no flowers, only tufts", () => {
    const summer = [...tiles("summer"), ...tiles("summer", true)];
    const winter = [...tiles("winter"), ...tiles("winter", true)];
    expect(kinds(winter)).toEqual(new Set(["tuft"]));
    const light = (hex: string) => rgb(hex).reduce((sum, c) => sum + c, 0);
    for (const [i, tile] of winter.entries())
      expect(light(tile.fill)).toBeGreaterThan(light(summer[i]?.fill ?? ""));
  });
});
