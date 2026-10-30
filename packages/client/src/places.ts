/**
 * The places the map names and the Places sheet lists: your home, and each town square with its
 * Town Hall, its shop, and its green. Downtown's square is the Commons; every land beyond it
 * (RFC 0038) has a square of its own, named for the land. Where each one is comes from the sim's
 * own rules (`squareOf`, `hallDoor`, `counterDoor`, `parkTile`) over the snapshot's tiles, so the
 * map points where the server builds. Pure and tested (`places.test.ts`).
 */
import {
  bySquare,
  counterDoor,
  hallDoor,
  parkTile,
  type Square,
  squareOf,
  type Tile,
  type WorldConfig,
} from "@terrakin/sim";
import type { LandsView } from "./lands";

/** What the places are read from: a mirror, or a plain copy of one in tests. */
export interface PlacesWorld {
  config: WorldConfig;
  commons: { px: number; py: number };
  townHall: readonly Tile[];
  shop: readonly Tile[];
  lands?: LandsView | undefined;
}

/** A town square as the map marks it. */
export interface TownSquare {
  /** The Commons downtown, or the land's own name. The town's words, never a resident's. */
  name: string;
  /** Downtown's own square, rather than a land's. */
  downtown: boolean;
  square: Square;
  /** Its Town Hall's tiles. */
  hall: readonly Tile[];
  /** Its shop's tiles, empty until the shop is open. */
  shop: readonly Tile[];
  /** The middle of its green (RFC 0045). */
  green: Tile;
}

/** What downtown's square is called on the map. */
export const COMMONS_NAME = "The Commons";

/**
 * Every town square, downtown's first and then each land's in the order it opened. A square is
 * found from its Town Hall, which every square has; its shop from the shop's tiles on it.
 */
export function townSquares(world: PlacesWorld): TownSquare[] {
  const { config } = world;
  const shops = bySquare(config, world.shop);
  const squares: TownSquare[] = [];
  for (const hall of bySquare(config, world.townHall)) {
    const square = squareOf(config, hall);
    if (!square) continue;
    const downtown = square.px === world.commons.px && square.py === world.commons.py;
    const land = world.lands?.list.find(
      (l) => l.square.px === square.px && l.square.py === square.py,
    );
    if (!downtown && !land) continue;
    const shop = shops.find((g) => {
      const s = squareOf(config, g);
      return s?.px === square.px && s.py === square.py;
    });
    squares.push({
      name: land ? land.name : COMMONS_NAME,
      downtown,
      square,
      hall,
      shop: shop ?? [],
      green: parkTile(config, square),
    });
  }
  return squares.sort((a, b) => Number(b.downtown) - Number(a.downtown));
}

/** One line in the Places sheet, and where choosing it goes. */
export interface MapPlace {
  id: string;
  kind: "home" | "hall" | "shop" | "green" | "square";
  name: string;
  line: string;
  /** The tile to walk to or look at. */
  x: number;
  y: number;
  /** How close a walk gets: beside a building's door, onto open ground. */
  near: number;
}

/**
 * The places the sheet lists: your home when you have a hearth, downtown's Town Hall, shop (once
 * open), and green, and then each land's square. A building's place is its door, walked to the
 * tile beside it, since nobody walks into the hall or behind the counter.
 */
export function mapPlaces(world: PlacesWorld, hearth?: Tile | null): MapPlace[] {
  const { config } = world;
  const places: MapPlace[] = [];
  if (hearth) {
    places.push({
      id: "home",
      kind: "home",
      name: "Home",
      line: "Your hearth",
      x: hearth.x,
      y: hearth.y,
      near: 0,
    });
  }
  for (const s of townSquares(world)) {
    if (s.downtown) {
      const hall = hallDoor(config, s.square);
      places.push({
        id: "hall",
        kind: "hall",
        name: "Town Hall",
        line: "On the Commons",
        ...hall,
        near: 1,
      });
      if (s.shop.length > 0) {
        const shop = counterDoor(config, s.square);
        places.push({
          id: "shop",
          kind: "shop",
          name: "Shop",
          line: "On the Commons",
          ...shop,
          near: 1,
        });
      }
      places.push({
        id: "green",
        kind: "green",
        name: "The Green",
        line: "Where pets go out",
        ...s.green,
        near: 0,
      });
      continue;
    }
    places.push({
      id: `square:${s.square.px},${s.square.py}`,
      kind: "square",
      name: s.name,
      line: s.shop.length > 0 ? "Its square, hall, and shop" : "Its square and hall",
      ...s.green,
      near: 0,
    });
  }
  return places;
}
