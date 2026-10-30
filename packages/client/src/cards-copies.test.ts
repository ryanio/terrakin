/**
 * `packages/cards` depends on nothing in the repo, so it keeps its own copies of the colors and
 * sizes the sim, `packages/ui`, and the map own. These checks read the cards' sources as text and
 * fail when a copy drifts from the value it copies.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { BATH_WATER, BLOCK_COLORS, DOOR_LOOK, PET_BOX, PET_FEET, WEATHERS } from "@terrakin/sim";
import {
  BRAND_HEX,
  LINEN,
  STONE_HI,
  STONE_LO,
  STRAW,
  STRAW_DEEP,
  WOOD,
  WOOD_DARK,
} from "@terrakin/ui/brand";
import {
  HALLOWEEN_HEX,
  HANUKKAH_HEX,
  RESIDENT_COLOR_HEX,
  THANKSGIVING_HEX,
  WINTER_HEX,
} from "@terrakin/ui/looks";
import { describe, expect, it } from "vitest";

const ROOT = join(import.meta.dirname, "../../..");
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");

/** The `const NAME = value;` lines of a file whose value is a number, a string, or a list of them. */
function constsIn(path: string): Map<string, unknown> {
  const found = new Map<string, unknown>();
  for (const m of read(path).matchAll(
    /^(?:export )?const (\w+) = ("[^"\n]*"|\[[^\]\n]*\]|[\d.]+)(?: as const)?;$/gm,
  )) {
    found.set(m[1] as string, JSON.parse(m[2] as string));
  }
  return found;
}

/** The `key: "#rrggbb",` lines of the object a file exports as `name`. */
function colorsIn(path: string, name: string): Record<string, string> {
  const text = read(path);
  const start = text.indexOf(`export const ${name}`);
  const body = text.slice(start, text.indexOf("\n}", start));
  return Object.fromEntries(
    [...body.matchAll(/^ {2}(\w+): "(#[0-9a-f]{6})",$/gm)].map((m) => [m[1], m[2]]),
  );
}

const PLOT = constsIn("packages/cards/src/plot.ts");
const ROOFS = constsIn("packages/client/src/render/roofs.ts");
const EDGES = constsIn("packages/client/src/render/edges.ts");
const WINTER_MAP = constsIn("packages/client/src/render/decor-winter.ts");

/** Each copy in `packages/cards/src/plot.ts`, and the value it copies. */
const PLOT_COPIES: Record<string, unknown> = {
  // Walls between tiles (RFC 0050): a door's frame and panel, and how thick the map draws one.
  DOOR_FRAME: DOOR_LOOK.frame,
  DOOR_PANEL: DOOR_LOOK.panel,
  EDGE_THICKNESS: EDGES.get("EDGE_THICKNESS"),
  PET_BOX,
  PET_FEET,
  WOOD_DARK,
  WOOD,
  STRAW,
  STRAW_DEEP,
  STONE_LO,
  STONE_HI,
  LINEN,
  POND_WATER: BATH_WATER,
  TOP_INK: ROOFS.get("TOP_INK"),
  TOP_PAPER: ROOFS.get("TOP_PAPER"),
  SNOW_EDGE: WINTER_MAP.get("SNOW_EDGE"),
  IRON_RIM: HALLOWEEN_HEX.ironRim,
  BREW: HALLOWEEN_HEX.brew,
  BREW_LIGHT: HALLOWEEN_HEX.brewLight,
  CANDY: HALLOWEEN_HEX.candy,
  SNOW: WINTER_HEX.snow,
  SNOW_SHADE: WINTER_HEX.snowShade,
  COAL: WINTER_HEX.coal,
  CARROT: WINTER_HEX.carrot,
  SCARF: WINTER_HEX.scarf,
  SNOW_HAT: WINTER_HEX.hat,
  WIRE: WINTER_HEX.wire,
  // A decor's main color is its block color, so the cards' lists leave it out.
  BULBS: WINTER_HEX.bulbs.filter((c) => c !== BLOCK_COLORS.string_lights),
  NEEDLES_LIGHT: WINTER_HEX.needlesLight,
  POT: WINTER_HEX.pot,
  POT_RIM: WINTER_HEX.potRim,
  STAR: WINTER_HEX.star,
  RUNNER: WINTER_HEX.runner,
  ROPE: WINTER_HEX.rope,
  WEAVE: THANKSGIVING_HEX.weave,
  APPLE: THANKSGIVING_HEX.apple,
  GOURD: THANKSGIVING_HEX.gourd,
  GRAPES: THANKSGIVING_HEX.grapes,
  TWINE: THANKSGIVING_HEX.twine,
  LEAVES: THANKSGIVING_HEX.leaves.filter((c) => c !== BLOCK_COLORS.leaf_garland),
  BRASS_DARK: HANUKKAH_HEX.brassDark,
  CANDLE: HANUKKAH_HEX.candle,
  DREIDEL_LIGHT: HANUKKAH_HEX.dreidelLight,
};

describe("the cards' copies", () => {
  it("keep the plot pictures' colors and sizes as their owners have them", () => {
    // A parse that finds nothing would pass every comparison.
    expect(PLOT.size).toBeGreaterThan(40);
    expect(ROOFS.get("TOP_INK")).toMatch(/^#/);
    expect(WINTER_MAP.get("SNOW_EDGE")).toMatch(/^rgba/);
    const drift = Object.entries(PLOT_COPIES).flatMap(([name, want]) => {
      const got = PLOT.get(name);
      return JSON.stringify(got) === JSON.stringify(want) ? [] : [`${name}: ${got} is ${want}`];
    });
    expect(drift).toEqual([]);
  });

  it("keep the weather, the brand, and the resident colors", () => {
    expect(constsIn("packages/cards/src/sky.ts").get("WEATHERS")).toEqual(WEATHERS);
    expect(colorsIn("packages/cards/src/templates.ts", "RESIDENT_HEX")).toEqual(RESIDENT_COLOR_HEX);
    const palette = colorsIn("packages/cards/src/brand.ts", "PALETTE");
    expect(Object.keys(palette).length).toBeGreaterThan(5);
    const drift = Object.entries(palette).filter(
      ([name, value]) => BRAND_HEX[name as keyof typeof BRAND_HEX] !== value,
    );
    expect(drift).toEqual([]);
  });
});
