import { DEFAULT_CONFIG, starterHome } from "@terrakin/sim";
import { describe, expect, it } from "vitest";
import { type PlantView, planFirstPlanting, plantedLine, soonestCrop } from "./first-plant";

// Plot (2, 2) is ours; the starter hut's hearth sits in its middle.
const { hearth } = starterHome(DEFAULT_CONFIG, 2, 2, "wood", "glass");
const size = DEFAULT_CONFIG.plotSize;
const ours = (t: { x: number; y: number }) =>
  Math.floor(t.x / size) === 2 && Math.floor(t.y / size) === 2;
const at = (dx: number, dy: number) => `${hearth.x + dx},${hearth.y + dy}`;

function view(over: Partial<PlantView> = {}): PlantView {
  const seeds = new Map([
    ["herb_seed", 2],
    ["lemon_seed", 2],
  ]);
  return {
    config: DEFAULT_CONFIG,
    hearth,
    blocks: new Map(),
    crops: new Map(),
    mine: ours,
    standing: () => false,
    held: (kind) => seeds.get(kind) ?? 0,
    ...over,
  };
}

describe("a first seed in one tap", () => {
  it("picks the held seed that's ready soonest", () => {
    const held = (kinds: Record<string, number>) => (k: string) => kinds[k] ?? 0;
    expect(soonestCrop(held({ lemon_seed: 2, tomato_seed: 1 }))).toBe("tomato");
    expect(soonestCrop(held({ lemon_seed: 2, herb_seed: 1 }))).toBe("herb");
    expect(soonestCrop(held({ lemon_seed: 0 }))).toBeUndefined();
  });

  it("puts a new planter in the hut's corner, clear of the way in, on a bare starter hut", () => {
    expect(planFirstPlanting(view())).toEqual({
      tile: { x: hearth.x - 1, y: hearth.y - 1 },
      place: true,
      crop: "herb",
    });
  });

  it("uses an empty planter of yours within reach before placing one", () => {
    const blocks = new Map([
      [at(-1, -1), "planter"],
      [at(2, 0), "planter"],
      [at(0, 3), "planter"],
    ]);
    // The corner's planter has something growing, so the empty one beside the hut is used.
    const crops = new Map([[at(-1, -1), {}]]);
    expect(planFirstPlanting(view({ blocks, crops }))).toEqual({
      tile: { x: hearth.x + 2, y: hearth.y },
      place: false,
      crop: "herb",
    });
  });

  it("passes over hut tiles with a block, with someone on them, or on a plot not yours", () => {
    const blocks = new Map([[at(-1, -1), "workbench"]]);
    const standing = (t: { x: number; y: number }) => t.x === hearth.x + 1 && t.y === hearth.y - 1;
    const plan = planFirstPlanting(view({ blocks, standing }));
    expect(plan).toMatchObject({ tile: { x: hearth.x - 1, y: hearth.y + 1 }, place: true });
    expect(planFirstPlanting(view({ mine: () => false }))).toEqual({ problem: "no_room" });
  });

  it("says why when it can't: no seeds, or no hut and no planter", () => {
    expect(planFirstPlanting(view({ held: () => 0 }))).toEqual({ problem: "no_seeds" });
    // A hearth set by hand, away from where a starter hut puts it.
    expect(planFirstPlanting(view({ hearth: { x: hearth.x + 2, y: hearth.y } }))).toEqual({
      problem: "no_room",
    });
  });

  it("says what was planted and when it's ready", () => {
    expect(plantedLine("herb")).toBe("You planted an herb seed by your hearth. Ready in 2 days.");
    expect(plantedLine("tomato")).toBe(
      "You planted a tomato seed by your hearth. Ready in 3 days.",
    );
  });
});
