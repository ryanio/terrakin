import type { WorldSnapshot } from "@terrakin/protocol";
import { counterTiles, hallTiles, landSquare, route, stepFrom } from "@terrakin/sim";
import { describe, expect, it } from "vitest";
import { landNameAt } from "./lands";
import { Mirror } from "./mirror";

/**
 * New lands on the web (RFC 0038). Downtown is 3 by 3 plots of 8 tiles, the water is plot column
 * 3, and Willowmere is columns 4 and 5, bridged along the Commons' latitude. The mirror answers
 * the water question with the sim's own rule, so a tap-to-walk route crosses by the bridge and a
 * tile of water never shows a branch to pick up.
 */
const BRIDGE = Array.from({ length: 8 }, (_, i) => 24 + i).flatMap((x) =>
  [11, 12].map((y) => ({ x, y })),
);
const ISLAND = {
  id: "willowmere",
  name: "Willowmere",
  plots: [
    { px: 4, py: 0 },
    { px: 4, py: 1 },
    { px: 5, py: 0 },
    { px: 5, py: 1 },
  ],
  bridge: BRIDGE,
  /** Its own square, south of its west column: its hall and its counter, and no plot to claim. */
  square: { px: 4, py: 2 },
};

const base: WorldSnapshot = {
  v: 1,
  seq: 3,
  hash: "x",
  time: { nowMs: 0, dayLengthMs: 600_000 },
  season: "summer",
  weather: "clear",
  timeOfDay: "day",
  day: 20_380,
  townHall: [],
  config: { width: 24, height: 24, plotSize: 8, maxPlotsPerResident: 1, reach: 3 },
  commons: { px: 1, py: 1 },
  residents: [],
  plots: [],
  blocks: [],
};

/** The same world once Willowmere is open: the config has grown and `lands` names its tiles. */
const opened: WorldSnapshot = {
  ...base,
  config: { ...base.config, width: 48 },
  lands: { home: { width: 24, height: 24 }, list: [ISLAND] },
};

describe("a world of one grid", () => {
  it("has no water, and walks as it always did", () => {
    const mirror = new Mirror(base);
    expect(mirror.lands).toBeUndefined();
    expect(mirror.isSea(12, 12)).toBe(false);
    expect(mirror.onBridge(24, 11)).toBe(false);
    expect(mirror.ground().obstacle(12, 12)).toBeUndefined();
  });
});

describe("the mirror's water", () => {
  it("is what the snapshot's lands leave over, and stops a walk", () => {
    const mirror = new Mirror(opened);
    expect(mirror.isSea(27, 3)).toBe(true);
    expect(mirror.isSea(27, 11)).toBe(false);
    expect(mirror.isSea(35, 3)).toBe(false);
    expect(mirror.onBridge(27, 11)).toBe(true);
    expect(mirror.onBridge(27, 3)).toBe(false);
    const ground = mirror.ground();
    expect(ground.obstacle(27, 3)).toBe("sea");
    expect(stepFrom(ground, { x: 23, y: 3 }, "e").ok).toBe(false);
  });

  it("routes a tap-to-walk over the bridge instead of into a refusal", () => {
    const mirror = new Mirror(opened);
    const path = route(mirror.ground(), { x: 12, y: 3 }, { x: 35, y: 3 }, 0, 64);
    const at = { x: 12, y: 3 };
    for (const dir of path) {
      const step = stepFrom(mirror.ground(), at, dir);
      expect(step.ok, `step ${dir} from ${at.x},${at.y}`).toBe(true);
      if (!step.ok) break;
      at.x = step.to.x;
      at.y = step.to.y;
      expect(mirror.isSea(at.x, at.y)).toBe(false);
    }
    expect(at).toEqual({ x: 35, y: 3 });
  });

  it("draws nothing lying on the water", () => {
    const mirror = new Mirror(opened);
    const wet: string[] = [];
    for (let x = 0; x < 48; x++) {
      for (let y = 0; y < 24; y++) {
        if (mirror.isSea(x, y) && mirror.pickupAt(x, y)) wet.push(`${x},${y}`);
      }
    }
    expect(wet).toEqual([]);
  });
});

describe("land_opened", () => {
  it("grows the world and brings the water and the bridge with it", () => {
    const mirror = new Mirror(base);
    expect(
      mirror.apply({
        seq: 4,
        event: {
          type: "land_opened",
          land: ISLAND.id,
          name: ISLAND.name,
          width: 48,
          height: 24,
          square: ISLAND.square,
          plots: ISLAND.plots,
          bridge: ISLAND.bridge,
        },
      }),
    ).toBe("applied");
    expect(mirror.config.width).toBe(48);
    expect(mirror.lands?.home).toEqual({ width: 24, height: 24 });
    expect(mirror.lands?.list.map((l) => l.name)).toEqual(["Willowmere"]);
    expect(mirror.isSea(27, 3)).toBe(true);
    expect(mirror.onBridge(27, 11)).toBe(true);
    // The ground a walk reads was built before the land opened, and is built again after it.
    expect(mirror.ground().obstacle(27, 3)).toBe("sea");
  });

  it("brings the island's hall and counter, so a tab open at the time draws them", () => {
    // Downtown's own buildings, as the snapshot gives them: the hall on the Commons' square and
    // the counter facing it. The shop has to be open for an island to get a counter.
    const mirror = new Mirror({
      ...base,
      townHall: [{ x: 12, y: 9 }],
      shop: [{ x: 12, y: 14 }],
    });
    const halls = mirror.townHall.length;
    const counters = mirror.shop.length;
    expect(halls).toBeGreaterThan(0);
    expect(counters).toBeGreaterThan(0);
    expect(
      mirror.apply({
        seq: 4,
        event: {
          type: "land_opened",
          land: ISLAND.id,
          name: ISLAND.name,
          width: 48,
          height: 24,
          square: ISLAND.square,
          plots: ISLAND.plots,
          bridge: ISLAND.bridge,
        },
      }),
    ).toBe("applied");
    // The event names no tiles, so the mirror works the square's buildings out, as it does for
    // `shop_opened`. Without this the island's hall and counter are drawn nowhere, a tap-to-walk
    // route is planned straight through them, and Enter never shows beside either door.
    expect(mirror.townHall.length).toBeGreaterThan(halls);
    expect(mirror.shop.length).toBeGreaterThan(counters);
    // And on exactly the tiles the sim puts them on, by the sim's own rule, so the web can
    // never draw an island's buildings on a different column than the world has them.
    const square = landSquare(mirror.config, ISLAND.square.px, ISLAND.square.py);
    expect(mirror.townHall.slice(halls)).toEqual(hallTiles(mirror.config, square));
    expect(mirror.shop.slice(counters)).toEqual(counterTiles(mirror.config, square));
  });
});

describe("the town's own ground, drawn (RFC 0046)", () => {
  it("draws squares as plazas, streets as cobbles and ways in their own look, under what anyone laid, for drawing only", () => {
    const mirror = new Mirror({
      ...opened,
      lands: {
        home: { width: 24, height: 24 },
        list: [{ ...ISLAND, streets: [{ px: 5, py: 2 }] }],
      },
      ways: [{ x: 7, y: 2 }],
      ground: [{ x: 7, y: 3, ground: "brick" }],
    });
    const drawn = mirror.drawnPaving;
    expect(drawn.get("40,16")).toBe("cobble");
    expect(drawn.get("47,23")).toBe("cobble");
    expect(drawn.get("7,2")).toBe("way");
    expect(drawn.get("7,3")).toBe("brick");
    // The Commons and the island's own square are paved, edge to edge.
    expect(drawn.get("8,8")).toBe("plaza");
    expect(drawn.get("39,23")).toBe("plaza");
    // Lifting and walking read what was laid, where none of them is.
    expect(mirror.paving.has("8,8")).toBe(false);
    expect(mirror.paving.has("40,16")).toBe(false);
    expect(mirror.paving.has("7,2")).toBe(false);
    // A way opened later is drawn at once, and one taken up goes.
    mirror.apply({ seq: 4, event: { type: "ways_opened", tiles: [{ x: 6, y: 2 }] } });
    mirror.apply({ seq: 5, event: { type: "ways_closed", tiles: [{ x: 7, y: 2 }] } });
    expect(mirror.drawnPaving.get("6,2")).toBe("way");
    expect(mirror.drawnPaving.has("7,2")).toBe(false);
  });
});

describe("a land's name", () => {
  it("is found from its square too, for the sign in front of its hall", () => {
    const { lands } = new Mirror(opened);
    expect(landNameAt(lands, ISLAND.square.px, ISLAND.square.py)).toBe("Willowmere");
    expect(landNameAt(lands, 4, 0)).toBe("Willowmere");
    expect(landNameAt(lands, 1, 1)).toBeUndefined();
  });
});
