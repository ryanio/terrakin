import { describe, expect, it } from "vitest";
import { SetRoofAction } from "../../packages/protocol/src/index";
import { BUILDING_BLOCKS } from "../../packages/sim/src/index";
import { PERSONAS } from "./personas.ts";
import { planRoof, type RoofChoice, type RoofOnPlot } from "./roof-plan.ts";

const PLOT = { px: 3, py: 2 };
const GABLE: RoofChoice = { style: "gable", material: "glass" };

describe("the townsfolk's roofs", () => {
  it("are what the API takes, each covered in a block that costs nothing", () => {
    for (const p of PERSONAS) {
      const roof = p.home.roof;
      expect(SetRoofAction.safeParse({ type: "set_roof", ...PLOT, ...roof }).success, p.name).toBe(
        true,
      );
      // A made material would mean gathering finds and crafting at a workbench first, which the
      // seed doesn't do (decision 0330). The four free blocks are taken and given back for nothing.
      expect(BUILDING_BLOCKS, p.name).toContain(roof.material);
    }
  });
});

describe("planRoof", () => {
  it("sends the roof unless the plot wears that style in that covering already", () => {
    const set = { kind: "set", action: { type: "set_roof", ...PLOT, ...GABLE } };
    // No roof, another style, or the same style in another covering: send it.
    const others: RoofOnPlot[] = [
      undefined,
      { style: "hip", material: "glass" },
      { style: "gable", material: "stone" },
    ];
    for (const from of others) {
      expect(planRoof(PLOT, GABLE, from), JSON.stringify(from)).toMatchObject(set);
    }
    expect(planRoof(PLOT, GABLE, { ...GABLE })).toEqual({ kind: "done", roof: GABLE });
  });
});
