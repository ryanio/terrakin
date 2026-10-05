import { describe, expect, it } from "vitest";
import { BIOME_REGION, type Biome, biomeAt } from "./biome";
import { createWorld } from "./world";

const config = createWorld().config;
const ALL: Biome[] = ["meadow", "forest", "stone", "sand"];

describe("biomes", () => {
  it("returns one of the four biomes for every tile in the world", () => {
    for (let x = 0; x < config.width; x++) {
      for (let y = 0; y < config.height; y++) {
        expect(ALL).toContain(biomeAt(config, x, y));
      }
    }
  });

  it("is a deterministic function of position, not of state or call order", () => {
    expect(biomeAt(config, 0, 0)).toBe(biomeAt(config, 0, 0));
    expect(biomeAt(config, 71, 71)).toBe(biomeAt(config, 71, 71));
    // A second world with a different config still answers from coordinates alone.
    expect(biomeAt({ ...config, width: 144 }, 5, 5)).toBe(biomeAt(config, 5, 5));
  });

  it("is coherent inside a region: neighbors usually share the biome", () => {
    expect(biomeAt(config, 1, 2)).toBe(biomeAt(config, 0, 0));
    expect(biomeAt(config, BIOME_REGION - 1, BIOME_REGION - 1)).toBe(biomeAt(config, 0, 0));
  });

  it("varies across the world: all four biomes appear somewhere", () => {
    const seen = new Set<Biome>();
    for (let x = 0; x < config.width; x++) {
      for (let y = 0; y < config.height; y++) {
        seen.add(biomeAt(config, x, y));
      }
    }
    expect(seen).toEqual(new Set(ALL));
  });
});
