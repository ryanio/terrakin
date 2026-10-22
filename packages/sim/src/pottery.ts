/**
 * Pottery (RFC 0047, phase 1): clay on meadow and sand, a kiln paid for in stone, and three pots
 * fired overnight in a glaze their maker paid for, with a finish the server rolls when the kiln is
 * opened.
 *
 * Nothing here runs until the server logs `open_clay` (`clayOpen`). Before it a kiln can't be
 * placed, a pot can't be made, no clay lies anywhere, and the pottery cards are on no shelf, so a
 * world without the switch reads and replays exactly as it did.
 *
 * A pot is made when it's loaded (`craft` at a kiln): its id, maker, label and glaze are set then,
 * and so are the craft count and the making points. It waits in `items.firings` until the next
 * world day, and `harvest` at the kiln takes it out. The finish is the only part left to chance,
 * and the sim never draws it: the server logs a `roll` with the `harvest`, as it does with a cast
 * (RFC 0023), and `finishOf` reads it through the frozen `FINISHES`.
 */
import { CATALOG, GOOD_KINDS, type GoodKind, type StackKind } from "./catalog";
import { isWhole, oneTimeSwitch, refuse } from "./check";
import { dayDateWords, relativeDayWords } from "./day-words";
import {
  addStack,
  closed,
  ITEMS,
  type ItemsChecked,
  inventory,
  inventoryEvent,
  inventorySize,
  isReady,
} from "./items";
import { parseKey, tileKey } from "./keys";
import type { Command, Firing, Good, ItemsState, Rejection, ResidentId, WorldState } from "./types";

/** The numbers (RFC 0047). Tuned with `scripts/economy-sim.ts --kiln`. */
export const POTTERY = {
  /** What a kiln takes to place, given back to whoever takes it up. */
  kilnStone: 4,
  /**
   * Chance a meadow or sand tile with nothing else on it holds clay on a day, in a world whose
   * `open_clay` came without `water`. Frozen: that rule is the kiln fixture's, and no live world
   * has it.
   */
  clayChance: 0.25,
  /**
   * Chance a tile beside water (a pond, or the sea) with nothing else on it holds clay on a day,
   * once `open_clay` came with `water`. Tuned with `scripts/economy-sim.ts --kiln`.
   */
  clayByWaterChance: 0.2,
  /** The most clay a resident picks up in a UTC day once clay lies beside water. */
  clayPerDay: 6,
  /** Days from loading a kiln to taking the pot out: ready when the next day starts. */
  fireDays: 1,
  /** A finish's roll is a whole number from 0 to one less than this, and chances are out of it. */
  outOf: 10_000,
} as const;

/** The block a pot is fired in. */
export const KILN = "kiln" as const;

/**
 * The glazes, a curated set like materials (RFC 0041): `bare` costs nothing, and each of the rest
 * costs one thing, so a pot's color says where its maker walks and what they grow. New glazes go on
 * the end.
 */
export const GLAZES = [
  "bare",
  "cream",
  "sea",
  "crystal",
  "rose",
  "honey",
  "berry",
  "moss",
] as const;
export type Glaze = (typeof GLAZES)[number];

/** What each glaze takes from your things when the kiln is loaded: one of this kind, or nothing. */
export const GLAZE_COSTS = {
  bare: null,
  cream: "seashell",
  sea: "sea_glass",
  crystal: "crystal",
  rose: "flower",
  honey: "lemon",
  berry: "strawberry",
  moss: "herb",
} as const satisfies Readonly<Record<Glaze, StackKind | null>>;

export const isGlaze = (g: unknown): g is Glaze =>
  typeof g === "string" && (GLAZES as readonly string[]).includes(g);

/** What a pot can come out of the kiln as: plain, or one of `FINISHES`. */
export const FINISH_NAMES = ["plain", "speckled", "crackle", "iridescent"] as const;
export type Finish = (typeof FINISH_NAMES)[number];

/**
 * The finishes and their chances out of `POTTERY.outOf`, frozen: a logged `harvest` at a kiln
 * replays only while this list, its order, and its numbers stay as they are. A roll picks the first
 * whose running total covers it, and past them all the pot is plain. About one pot in five has a
 * finish and one in a hundred is iridescent. New odds are a new table behind a logged switch, never
 * an edit to this one.
 */
export const FINISHES = [
  { finish: "speckled", chance: 1500 },
  { finish: "crackle", chance: 500 },
  { finish: "iridescent", chance: 100 },
] as const satisfies readonly { finish: Exclude<Finish, "plain">; chance: number }[];

/** The finish a roll gives. Pure. */
export function finishOf(roll: number): Finish {
  let total = 0;
  for (const f of FINISHES) {
    total += f.chance;
    if (roll < total) return f.finish;
  }
  return "plain";
}

/** The pots: every good made at a kiln, in catalog order. */
export const POT_KINDS: readonly GoodKind[] = GOOD_KINDS.filter(
  (k) => CATALOG[k].recipe?.station === KILN,
);
export const isPotKind = (k: unknown): k is GoodKind =>
  typeof k === "string" && (POT_KINDS as readonly string[]).includes(k);

/** Whether pottery is open in this world (`open_clay` was logged). */
export const clayOpen = (state: Pick<WorldState, "items">): boolean =>
  state.items?.clayOpen === true;

/**
 * How clay lies in a world: nowhere before `open_clay`, on any meadow or sand tile after one without
 * `water` (the first rule, which only the kiln fixture has), and beside water after one with it.
 */
export type ClayRule = "none" | "meadow_and_sand" | "by_water";
export function clayRule(state: Pick<WorldState, "items">): ClayRule {
  if (!clayOpen(state)) return "none";
  return state.items?.clayByWater ? "by_water" : "meadow_and_sand";
}

/** The refusal for anything pottery before `open_clay`. */
export function potteryClosed(state: Pick<WorldState, "items">): Rejection | null {
  return clayOpen(state)
    ? null
    : refuse("pottery_closed", "Pottery hasn't opened in this world yet: no clay, kilns, or pots.");
}

/** The glaze's cost added to a pot's needs, in order: the recipe's first, then the glaze's. */
export function withGlaze(
  needs: Readonly<Partial<Record<StackKind, number>>>,
  glaze: Glaze,
): Partial<Record<StackKind, number>> {
  const all: Partial<Record<StackKind, number>> = { ...needs };
  const cost = GLAZE_COSTS[glaze];
  if (cost) all[cost] = (all[cost] ?? 0) + 1;
  return all;
}

/** The pot firing in the kiln at (x, y), if any. */
export const firingAt = (state: WorldState, x: number, y: number): Firing | undefined =>
  state.items?.firings?.[tileKey(x, y)];

/** A kiln with a pot in it, as views show it. */
export interface KilnAt {
  x: number;
  y: number;
  firing: Firing;
  ready: boolean;
}

/** Every pot firing, north to south then west to east. */
export function firingsOf(state: WorldState): KilnAt[] {
  const out: KilnAt[] = [];
  for (const [key, firing] of Object.entries(state.items?.firings ?? {})) {
    const [x, y] = parseKey(key);
    out.push({ x, y, firing, ready: isReady(firing.readyDay, state.day) });
  }
  return out.sort((a, b) => a.y - b.y || a.x - b.x);
}

/** The kilns `id` loaded whose pot is ready to come out, for the check-in. */
export const readyKilns = (state: WorldState, id: ResidentId): KilnAt[] =>
  firingsOf(state).filter((k) => k.ready && k.firing.by === id);

/**
 * `open_clay {water?}`, which only TOWN_ACTOR sends (RFC 0047). Needs items open, and comes once.
 * With `water`, which the server always sends, clay lies only beside water and a resident picks up
 * at most `POTTERY.clayPerDay` a day. Without it, clay lies on any meadow or sand tile, as the kiln
 * fixture's log has it.
 */
export function checkOpenClay(
  state: WorldState,
  command: Extract<Command, { type: "open_clay" }>,
): ItemsChecked {
  const shut = closed(state);
  if (shut) return shut;
  const items = state.items as ItemsState;
  const { water } = command;
  if (water !== undefined && water !== true) {
    return refuse("server_only", "water is true or left out.");
  }
  return oneTimeSwitch({
    on: items.clayOpen,
    already: "Clay is already out.",
    turnOn: () => {
      items.clayOpen = true;
      if (water) items.clayByWater = true;
    },
    event: water ? { type: "clay_opened", water } : { type: "clay_opened" },
  });
}

/**
 * The commit of a `craft` at a kiln, which `checkCraft` has checked whole: what the pot needs
 * leaves the maker's things, and the pot goes in the kiln until the next day.
 */
export function loadKiln(
  items: ItemsState,
  actor: ResidentId,
  at: { x: number; y: number; day: number },
  good: Good,
  needs: Partial<Record<StackKind, number>>,
) {
  const readyDay = at.day + POTTERY.fireDays;
  items.firings ??= {};
  items.firings[tileKey(at.x, at.y)] = { good, by: actor, readyDay };
  const mine = inventory(items, actor);
  const changes = (Object.entries(needs) as [StackKind, number][]).map(([kind, n]) =>
    addStack(mine, kind, -n),
  );
  return [
    { type: "kiln_loaded" as const, x: at.x, y: at.y, by: actor, readyDay },
    inventoryEvent(actor, "craft", changes),
  ];
}

/**
 * `harvest {x, y, roll}` at a kiln (RFC 0047), after `checkHarvest`'s own checks of where: the pot
 * comes out with the finish the server's roll gives, into its loader's things, or held aside for
 * them when someone else opens it and they have no room.
 */
export function checkOpenKiln(
  state: WorldState,
  actor: ResidentId,
  x: number,
  y: number,
  roll: number | undefined,
): ItemsChecked {
  const items = state.items as ItemsState;
  const day = state.day as number;
  const key = tileKey(x, y);
  const firing = items.firings?.[key];
  if (!firing) {
    return refuse(
      "no_crop",
      `The kiln is empty. Load a pot with {"type": "craft", "recipe": "bowl", "x": ${x}, "y": ${y}} and take it out the next day.`,
    );
  }
  if (!isReady(firing.readyDay, day)) {
    return refuse(
      "not_ready",
      `The pot is still firing. It comes out ${relativeDayWords(firing.readyDay, day)}, ${dayDateWords(firing.readyDay, day)}, when that day starts at midnight UTC.`,
    );
  }
  if (!isWhole(roll) || roll < 0 || roll >= POTTERY.outOf) {
    return refuse(
      "server_only",
      "The server rolls each pot's finish as the kiln opens. Send harvest with x and y only.",
    );
  }
  const owner = firing.by;
  const fits = inventorySize(items.inventories[owner]) + 1 <= ITEMS.inventoryMax;
  if (owner === actor && !fits) {
    return refuse(
      "inventory_full",
      `You can hold ${ITEMS.inventoryMax} things, and the pot needs room for one more. Give, place, or sell something first.`,
    );
  }
  const good: Good = { ...firing.good, finish: finishOf(roll) };
  return () => {
    const firings = items.firings as Record<string, Firing>;
    delete firings[key];
    if (Object.keys(firings).length === 0) delete items.firings;
    const events = [{ type: "kiln_emptied" as const, x, y, by: actor }];
    if (!fits) {
      // Someone who can build here opened it for a loader with no room: it waits for them.
      items.heldAside = [...(items.heldAside ?? []), { good, by: owner, day }];
      return events;
    }
    inventory(items, owner).goods.push(good);
    return [...events, inventoryEvent(owner, "fired", [], { gained: [good] })];
  };
}

/** Why the kiln at (x, y) can't be taken up: it holds a pot. Read in `remove`'s check. */
export function kilnRemoveProblem(state: WorldState, x: number, y: number): Rejection | null {
  return firingAt(state, x, y)
    ? refuse(
        "tile_occupied",
        "A pot is firing in that kiln. Take it out with harvest once it's ready.",
      )
    : null;
}
