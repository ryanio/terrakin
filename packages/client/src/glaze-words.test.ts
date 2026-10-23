import { GLAZES, kindsIn, RECIPES } from "@terrakin/sim";
import { describe, expect, it } from "vitest";
import { glazeCostLine, glazeName, potteryHint } from "./glaze-words";

describe("what a glaze takes (RFC 0047)", () => {
  it("names the thing and where it comes from, for every glaze", () => {
    expect(GLAZES.map((g) => `${glazeName(g)}: ${glazeCostLine(g)}`)).toEqual([
      "Bare clay: nothing, the clay's own color",
      "Cream glaze: 1 seashell, found on the sand",
      "Sea glaze: 1 sea glass, found on the sand",
      "Crystal glaze: 1 crystal, found on stony ground",
      "Rose glaze: 1 flower, grown in a planter",
      "Honey glaze: 1 lemon, grown in a planter",
      "Berry glaze: 1 strawberry, grown in a planter",
      "Moss glaze: 1 bunch of herbs, grown in a planter",
    ]);
  });

  it("says how to get each pottery kind not yet in the book", () => {
    expect(kindsIn("pottery").map((k) => [k, potteryHint(k)])).toEqual([
      ["clay", "beside water, by a pond or the sea"],
      ["bowl", `${RECIPES.bowl.needs.clay} clay, at a kiln`],
      ["vase", `${RECIPES.vase.needs.clay} clay, at a kiln`],
      ["teapot", `${RECIPES.teapot.needs.clay} clay, ${RECIPES.teapot.needs.wood} wood, at a kiln`],
      [
        "pot_of_tea",
        `a teapot and ${RECIPES.pot_of_tea.needs.herb} bunches of herbs, at a kitchen`,
      ],
      ["cup_of_tea", "a guest's keepsake from a host's tea"],
    ]);
  });
});
