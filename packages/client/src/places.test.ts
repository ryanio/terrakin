import { counterTiles, hallTiles, parkTile, type Square, type WorldConfig } from "@terrakin/sim";
import { describe, expect, it } from "vitest";
import { COMMONS_NAME, mapPlaces, type PlacesWorld, townSquares } from "./places";

/**
 * Places on the map: downtown is 3 by 3 plots of 8 tiles with the Commons in the middle, and
 * Willowmere (RFC 0038) has its own square at plot (4, 2). The halls and counters stand where the
 * sim builds them, so the places point at what the server walks residents around.
 */
const config: WorldConfig = {
  width: 48,
  height: 24,
  plotSize: 8,
  maxPlotsPerResident: 1,
  reach: 3,
};
const commons: Square = { px: 1, py: 1, x: 11 };
const island: Square = { px: 4, py: 2, x: 35 };
const lands = {
  home: { width: 24, height: 24 },
  list: [
    {
      id: "willowmere",
      name: "Willowmere",
      plots: [{ px: 4, py: 0 }],
      bridge: [],
      square: { px: island.px, py: island.py },
    },
  ],
};

const world = (o: { shop?: boolean; island?: boolean } = {}): PlacesWorld => {
  const squares = o.island ? [commons, island] : [commons];
  return {
    config,
    commons: { px: commons.px, py: commons.py },
    // The island's hall first, as a log could leave them: downtown still comes first.
    townHall: [...squares].reverse().flatMap((s) => hallTiles(config, s)),
    shop: o.shop ? squares.flatMap((s) => counterTiles(config, s)) : [],
    ...(o.island ? { lands } : {}),
  };
};

describe("townSquares", () => {
  it("finds downtown's square and each land's, downtown first, named for the land", () => {
    const squares = townSquares(world({ shop: true, island: true }));
    expect(squares.map((s) => s.name)).toEqual([COMMONS_NAME, "Willowmere"]);
    expect(squares[1]?.green).toEqual(parkTile(config, island));
    expect(squares.every((s) => s.shop.length > 0)).toBe(true);
  });

  it("marks no shop on a square before the shop opens", () => {
    expect(townSquares(world()).map((s) => s.shop.length)).toEqual([0]);
  });
});

describe("mapPlaces", () => {
  it("lists home, the Town Hall, the shop, the Green, and each land's square", () => {
    const hearth = { x: 3, y: 4 };
    const places = mapPlaces(world({ shop: true, island: true }), hearth);
    expect(places.map((p) => p.name)).toEqual([
      "Home",
      "Town Hall",
      "Shop",
      "The Green",
      "Willowmere",
    ]);
    expect(places[0]).toMatchObject({ ...hearth, near: 0 });
  });

  it("walks to beside a building's door, and onto a green", () => {
    const places = mapPlaces(world({ shop: true, island: true }));
    const hall = places.find((p) => p.kind === "hall");
    const shop = places.find((p) => p.kind === "shop");
    // The door is one of the building's own tiles, which nobody walks onto, so the walk stops
    // beside it.
    expect(hallTiles(config, commons)).toContainEqual({ x: hall?.x, y: hall?.y });
    expect(hall?.near).toBe(1);
    expect(counterTiles(config, commons)).toContainEqual({ x: shop?.x, y: shop?.y });
    expect(shop?.near).toBe(1);
    const island = places.find((p) => p.kind === "square");
    expect(island).toMatchObject({ near: 0, ...parkTile(config, { px: 4, py: 2, x: 35 }) });
  });

  it("leaves out home with no hearth, and the shop before it opens", () => {
    expect(mapPlaces(world()).map((p) => p.kind)).toEqual(["hall", "green"]);
  });
});
