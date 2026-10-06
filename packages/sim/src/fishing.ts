/**
 * Fishing (RFC 0023): a pond is a block of water paid for in stone (`POND` in `items.ts`), and
 * `fish` casts a line from right beside one, with a fishing rod in your things. What bites is
 * `CATCHES`: each kind with its own chance a cast, in the seasons, times of day, and weather it
 * bites in, so a rainy night brings up what a sunny noon never does.
 *
 * Nothing here reads a clock or the weather. The server draws each cast's `roll` and notes the
 * `weather` and the map's `timeOfDay` on its own clock, and logs all three with the cast, so replay
 * reads the same values, and the season comes from `state.day`. Nobody can know a catch before the
 * cast is logged, and casting fast or often buys nothing past `FISHING.castsPerDay`.
 */
import { type FishKind, type ItemKind, RECIPES } from "./catalog";
import { isWhole, refuse } from "./check";
import {
  addStack,
  closed,
  countOf,
  GATHER_HINT,
  ITEMS,
  type ItemsChecked,
  inventory,
  inventoryEvent,
  inventorySize,
  POND,
} from "./items";
import { tileKey } from "./keys";
import { type Season, seasonOf } from "./season";
import { isTimeOfDay, type TimeOfDay } from "./time-of-day";
import type {
  Command,
  Inventory,
  ItemsState,
  ResidentId,
  Tile,
  WorldEvent,
  WorldState,
} from "./types";
import { WEATHERS, type Weather } from "./weather";
import { inBounds, walkHint } from "./world";

/** The numbers (decision 0123). */
export const FISHING = {
  /** Casts one resident may make in a UTC day, whatever they bring up. */
  castsPerDay: 10,
  /** A cast's roll is a whole number from 0 to one less than this, and chances are out of it. */
  outOf: 10_000,
  /** How far around a cast with no water beside it the refusal looks for some. */
  hintRadius: 12,
} as const;

/** What `fish` needs in your things: any one fishing rod, made by anyone. */
export const FISHING_ROD = "fishing_rod" as const;

/** What a cast brings up: a fish, an old boot that goes straight back in, or nothing. */
export type Catch = FishKind | "boot" | "nothing";

/** One kind's place in what bites: its chance a cast, and when it bites. */
export interface CatchChance {
  /** A fish, or the old boot. */
  kind: FishKind | "boot";
  /** Out of `FISHING.outOf`, on a cast while it bites. */
  chance: number;
  /** It bites only in these seasons. Absent: all year. */
  seasons?: readonly Season[];
  /** It bites only at these times of day. Absent: any time. */
  times?: readonly TimeOfDay[];
  /** It bites only in this weather. Absent: in any. */
  weathers?: readonly Weather[];
}

/**
 * What bites (RFC 0023, decision 0123), frozen: a logged cast replays only while this list, its
 * order, and its numbers stay exactly as they are. A cast keeps the kinds biting then, in this
 * order, and its roll picks the first whose running total of chances covers it; past them all,
 * nothing bites. A new fish, or new numbers, is a new list behind a new logged switch, never an
 * edit to this one. `fishing.test.ts` pins it.
 */
export const CATCHES = [
  { kind: "boot", chance: 500 },
  { kind: "minnow", chance: 3000 },
  { kind: "perch", chance: 1500, times: ["dawn", "day"] },
  { kind: "carp", chance: 1500 },
  { kind: "catfish", chance: 1500, times: ["dusk", "night"] },
  { kind: "eel", chance: 1000, times: ["night"], weathers: ["rain", "fog"] },
  {
    kind: "trout",
    chance: 1200,
    seasons: ["spring", "summer"],
    times: ["dawn", "day"],
    weathers: ["clear", "cloudy"],
  },
  { kind: "smelt", chance: 1200, seasons: ["spring"], times: ["dusk", "night"] },
  { kind: "sunfish", chance: 1200, seasons: ["summer"], times: ["day"], weathers: ["clear"] },
  { kind: "salmon", chance: 1200, seasons: ["autumn"] },
  { kind: "pike", chance: 800, seasons: ["autumn", "winter"], times: ["dawn", "dusk", "night"] },
  { kind: "char", chance: 1000, seasons: ["winter"], weathers: ["cloudy", "fog", "snow"] },
  { kind: "golden_koi", chance: 40, times: ["dawn", "day"], weathers: ["clear", "cloudy"] },
  { kind: "moonfish", chance: 120, times: ["night"], weathers: ["rain", "fog", "snow"] },
] as const satisfies readonly CatchChance[];

/** What bites in a season, at a time of day, in a weather: `CATCHES` that fit, in its order. */
export function biting(season: Season, time: TimeOfDay, weather: Weather): CatchChance[] {
  return (CATCHES as readonly CatchChance[]).filter(
    (c) =>
      (c.seasons === undefined || c.seasons.includes(season)) &&
      (c.times === undefined || c.times.includes(time)) &&
      (c.weathers === undefined || c.weathers.includes(weather)),
  );
}

/** What a cast with `roll` brings up in a season, at a time of day, in a weather. Pure. */
export function catchOf(roll: number, season: Season, time: TimeOfDay, weather: Weather): Catch {
  let total = 0;
  for (const c of biting(season, time, weather)) {
    total += c.chance;
    if (roll < total) return c.kind;
  }
  return "nothing";
}

/** Whether a tile holds water to fish in. */
export const isWater = (state: Pick<WorldState, "blocks">, x: number, y: number): boolean =>
  state.blocks[tileKey(x, y)] === POND.block;

/** The eight tiles around one, north first and on round clockwise. */
const AROUND: readonly [number, number][] = [
  [0, -1],
  [1, -1],
  [1, 0],
  [1, 1],
  [0, 1],
  [-1, 1],
  [-1, 0],
  [-1, -1],
];

/**
 * Where a line cast from `at` goes in: the first tile of water around it, north first and on
 * round clockwise, or undefined with none beside it. `water` answers for a tile, so a client asks
 * its own copy of the world the question the sim does.
 */
export function waterBeside(at: Tile, water: (x: number, y: number) => boolean): Tile | undefined {
  for (const [dx, dy] of AROUND) {
    const x = at.x + dx;
    const y = at.y + dy;
    if (water(x, y)) return { x, y };
  }
  return undefined;
}

/**
 * The nearest tile of water within `radius` of `from`: nearest by Chebyshev distance, then north to
 * south, then west to east. For a refusal's next step.
 */
export function nearestWater(state: WorldState, from: Tile, radius: number): Tile | undefined {
  for (let d = 1; d <= radius; d++) {
    for (let y = from.y - d; y <= from.y + d; y++) {
      for (let x = from.x - d; x <= from.x + d; x++) {
        if (Math.max(Math.abs(x - from.x), Math.abs(y - from.y)) !== d) continue;
        if (inBounds(state.config, x, y) && isWater(state, x, y)) return { x, y };
      }
    }
  }
  return undefined;
}

/** Whether a resident's things hold a fishing rod. */
export const holdsRod = (inv: Inventory | undefined): boolean =>
  inv?.goods.some((g) => g.kind === FISHING_ROD) ?? false;

/** How many times a resident cast a line today. */
export const castsToday = (state: WorldState, id: ResidentId): number =>
  state.items?.today.casts?.[id] ?? 0;

/** "3 wood", what a fishing rod takes at a workbench. */
const rodNeeds = () =>
  Object.entries(RECIPES[FISHING_ROD].needs)
    .map(([kind, n]) => countOf(kind as ItemKind, n as number))
    .join(" and ");

/**
 * `fish {roll, weather, timeOfDay}`: cast a line into the water beside you, with a fishing rod in
 * your things, at most `FISHING.castsPerDay` times a day. Every cast counts, whatever it brings up.
 */
export function checkFish(
  state: WorldState,
  actor: ResidentId,
  command: Extract<Command, { type: "fish" }>,
): ItemsChecked {
  const shut = closed(state);
  if (shut) return shut;
  const items = state.items as ItemsState;
  const me = state.residents[actor];
  if (!me) return refuse("not_joined", "Join the world first.");
  const { roll, weather, timeOfDay } = command;
  if (
    !isWhole(roll) ||
    roll < 0 ||
    roll >= FISHING.outOf ||
    !(WEATHERS as readonly unknown[]).includes(weather) ||
    !isTimeOfDay(timeOfDay)
  ) {
    return refuse(
      "server_only",
      "The server rolls each cast and notes the weather and the time of day. Send fish with nothing else.",
    );
  }
  const inv = items.inventories[actor];
  if (!holdsRod(inv)) {
    return refuse(
      "no_rod",
      `Fishing takes a fishing rod in your things. Make one at a workbench from ${rodNeeds()}: {"type": "craft", "recipe": "${FISHING_ROD}", "x": <x>, "y": <y>}. ${GATHER_HINT}`,
    );
  }
  const water = waterBeside(me, (x, y) => isWater(state, x, y));
  if (!water) {
    const near = nearestWater(state, me, FISHING.hintRadius);
    const where = near
      ? ` The nearest pond is at x ${near.x}, y ${near.y}.${walkHint(me, near, 1)}`
      : ` There's none within ${FISHING.hintRadius} tiles. Make one on your plot with {"type": "place", "x": <x>, "y": <y>, "block": "${POND.block}"}, ${countOf("stone", POND.stone)} a tile, or ask the Town Hall for one in the Commons.`;
    return refuse(
      "no_water",
      `Fish from right beside water: a pond tile next to you, diagonals included.${where}`,
    );
  }
  const cast = castsToday(state, actor);
  if (cast >= FISHING.castsPerDay) {
    return refuse(
      "cast_limit",
      `You've cast ${FISHING.castsPerDay} times today, all one day has. The fish bite again after midnight UTC.`,
    );
  }
  if (inventorySize(inv) + 1 > ITEMS.inventoryMax) {
    return refuse(
      "inventory_full",
      `You can hold ${ITEMS.inventoryMax} things, and a catch needs room for one more. Cook, give, or sell something first.`,
    );
  }
  const caught = catchOf(roll, seasonOf(state.day as number), timeOfDay, weather);
  return () => {
    items.today.casts ??= {};
    items.today.casts[actor] = cast + 1;
    const events: WorldEvent[] = [{ type: "fished", by: actor, x: water.x, y: water.y, caught }];
    if (caught !== "boot" && caught !== "nothing") {
      const change = addStack(inventory(items, actor), caught, 1);
      events.push(inventoryEvent(actor, "caught", [change]));
    }
    return events;
  };
}
