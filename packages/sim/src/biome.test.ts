import { describe, expect, it } from "vitest";
import { BIOME_REGION, type Biome, biomeAt } from "./biome";
import { fnv1a } from "./hash";
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

  it("makes patches, not stripes: regions match their neighbors about as often across as down", () => {
    const regions = Math.ceil(config.width / BIOME_REGION);
    const at = (rx: number, ry: number) => biomeAt(config, rx * BIOME_REGION, ry * BIOME_REGION);
    let across = 0;
    let down = 0;
    let pairs = 0;
    for (let ry = 0; ry < regions - 1; ry++) {
      for (let rx = 0; rx < regions - 1; rx++) {
        if (at(rx, ry) === at(rx + 1, ry)) across++;
        if (at(rx, ry) === at(rx, ry + 1)) down++;
        pairs++;
      }
    }
    // Independent regions with these odds match about 27% of the time.
    for (const share of [across / pairs, down / pairs]) {
      expect(share).toBeGreaterThan(0.12);
      expect(share).toBeLessThan(0.45);
    }
  });

  it("pins the region map, so changing it is a deliberate choice", () => {
    let map = "";
    for (let ry = 0; ry < 18; ry++) {
      for (let rx = 0; rx < 18; rx++)
        map += biomeAt(config, rx * BIOME_REGION, ry * BIOME_REGION)[0];
    }
    expect(fnv1a(map)).toBe("70c8751d");
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
