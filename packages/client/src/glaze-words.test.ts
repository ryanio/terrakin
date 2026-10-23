import { GLAZES } from "@terrakin/sim";
import { describe, expect, it } from "vitest";
import { glazeCostLine, glazeName } from "./glaze-words";

describe("what a glaze takes (RFC 0047)", () => {
  it("names the thing and where it comes from, for every glaze", () => {
    expect(GLAZES.map((g) => `${glazeName(g)}: ${glazeCostLine(g)}`)).toEqual([
      "Bare clay: Nothing: the clay's own color",
      "Cream glaze: 1 seashell, found on the sand",
      "Sea glaze: 1 sea glass, found on the sand",
      "Crystal glaze: 1 crystal, found on stony ground",
      "Rose glaze: 1 flower, grown in a planter",
      "Honey glaze: 1 lemon, grown in a planter",
      "Berry glaze: 1 strawberry, grown in a planter",
      "Moss glaze: 1 bunch of herbs, grown in a planter",
    ]);
  });
});
