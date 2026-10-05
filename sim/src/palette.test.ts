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
  tileHash,
} from "./palette";
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

  it("dresses blocks in a theme, except glass", () => {
    const lemon = THEME_INFO.lemon.palette;
    expect(blockFill("wood")).toBe(BLOCK_COLORS.wood);
    expect(blockFill("wood", lemon)).toBe(mixHex(lemon.light, lemon.main, 0.45));
    expect(blockFill("glass", lemon)).toBe(BLOCK_COLORS.glass);
  });

  it("mixes and fades hex colors", () => {
    expect(mixHex("#000000", "#ffffff", 0.5)).toBe("#808080");
    expect(alphaHex("#f2b84b", 0.34)).toBe("rgba(242, 184, 75, 0.34)");
  });
});
