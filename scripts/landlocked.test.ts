import { describe, expect, it } from "vitest";
import { issueBody, landlockedIn, type WorldRead } from "./landlocked";

// 3 by 3 plots of 8 tiles, the Commons in the middle at (1, 1). Plot (0, 0) is claimed with its
// hearth at (3, 3), and so are both plots beside it, so its one way out is the diagonal from its
// south-east corner (7, 7) onto the Commons at (8, 8), past (8, 7) and (7, 8).
function world(blocks: WorldRead["blocks"] = []): WorldRead {
  return {
    config: { width: 24, height: 24, plotSize: 8, maxPlotsPerResident: 1, reach: 3 },
    commons: { px: 1, py: 1 },
    plots: [
      { px: 0, py: 0, ownerId: "r_a" },
      { px: 1, py: 0, ownerId: "r_b" },
      { px: 0, py: 1, ownerId: "r_c" },
    ],
    blocks,
    residents: [{ hearth: { x: 3, y: 3 } }, {}],
    solidBuildings: true,
    townHall: [],
    shop: [],
  };
}

describe("the landlocked check (decision 0351)", () => {
  it("reads the snapshot's ground floor: a block upstairs is no wall", () => {
    expect(landlockedIn(world())).toEqual([]);
    expect(landlockedIn(world([{ x: 8, y: 7, block: "stone", floor: 1 }]))).toEqual([]);
    expect(landlockedIn(world([{ x: 8, y: 7, block: "stone" }]))).toEqual([
      { px: 0, py: 0, ownerId: "r_a", why: "walled" },
    ]);
  });

  it("reads the snapshot's ways: a step onto one is a way out, on whoever's plot (RFC 0046)", () => {
    const walled = world([{ x: 8, y: 7, block: "stone" }]);
    // Down the west edge of (1, 0) and round the stone onto the Commons.
    const ways = [
      ...Array.from({ length: 7 }, (_, y) => ({ x: 8, y })),
      { x: 9, y: 6 },
      { x: 9, y: 7 },
    ];
    expect(landlockedIn({ ...walled, ways })).toEqual([]);
    // Without its last tile it leads nowhere, so it is no way out.
    expect(landlockedIn({ ...walled, ways: ways.slice(0, 8) })).toHaveLength(1);
  });

  it("writes an issue that counts them and names each by its coordinates and owner's id", () => {
    const found = landlockedIn(world([{ x: 8, y: 7, block: "stone" }]));
    const body = issueBody(found, 3, "https://terrakin.org");
    expect(body).toContain("1 of 3 claimed plots have no way out onto open ground");
    expect(body).toContain("0 are surrounded");
    expect(body).toContain("- Plot (0, 0), walled, owner `r_a`: https://terrakin.org/world?at=0,0");
  });
});
