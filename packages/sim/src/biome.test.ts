import { describe, expect, it } from "vitest";
import { BIOME_REGION, type Biome, biomeAt } from "./biome";
import { fnv1a } from "./hash";
import { createWorld } from "./world";

const config = createWorld().config;
const ALL: Biome[] = ["meadow", "forest", "stone", "sand"];

describe("biomes", () => {
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

  it("gives every tile one of the four biomes, and all four appear somewhere", () => {
    const seen = new Set<Biome>();
    for (let x = 0; x < config.width; x++) {
      for (let y = 0; y < config.height; y++) {
        seen.add(biomeAt(config, x, y));
      }
    }
    expect(seen).toEqual(new Set(ALL));
  });
});
