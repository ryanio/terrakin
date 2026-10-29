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
import { CATALOG, GOOD_KINDS, type GoodKind, STACK_KINDS, type StackKind } from "./catalog";
import { isWhole, oneTimeSwitch, refuse } from "./check";
import { dayDateWords, relativeDayWords } from "./day-words";
import {
  addStack,
  closed,
  type ItemsChecked,
  inventory,
  inventoryEvent,
  inventoryMaxOf,
  inventorySize,
  isReady,
} from "./items";
import { parseKey, tileKey } from "./keys";
import { own } from "./own";
import type {
  BlockKind,
  Command,
  Firing,
  Good,
  HostedEvent,
  ItemsState,
  PlacedPot,
  PotCodes,
  PotterRecord,
  Rejection,
  ResidentId,
  WorldEvent,
  WorldState,
} from "./types";

/** The numbers (RFC 0047). Tuned with `scripts/economy-sim.ts --kiln`. */
export const POTTERY = {
  /**
   * What a kiln takes to place, given back to whoever takes it up: 2 stone, as a tile of pond
   * takes, so most potters have one in their first week (`scripts/economy-sim.ts --kiln`: 82% at
   * 2, half at 3).
   */
  kilnStone: 2,
  /** A kiln's stone in a world whose clay came by the first rule, which only the kiln fixture has. */
  kilnStoneFirstRule: 4,
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
  /**
   * The tiles around a dug pond where clay comes up every day for sure, once clay lies beside
   * water (`onSpring` in `gather.ts`), so a newcomer's first pond is a steady start rather than a
   * roll. Tuned with `scripts/economy-sim.ts --kiln`.
   */
  springsPerPond: 3,
  /**
   * Hosting points a host earns on top of `PROGRESS.guest` for each counted guest at an event they
   * served a pot of tea at.
   */
  teaPerGuest: 1,
  /** Days from loading a kiln to taking the pot out: ready when the next day starts. */
  fireDays: 1,
  /** A finish's roll is a whole number from 0 to one less than this, and chances are out of it. */
  outOf: 10_000,
  /**
   * A gentle floor under the finishes: of every this many pots a resident fires in a row, at least
   * one comes out with a finish. A pot whose roll says smooth after one less than this many smooth
   * pots in a row comes out speckled (`floorFinish`), counted in the sim, so the server still rolls
   * every pot and a logged roll replays the same.
   */
  finishFloor: 10,
  /**
   * What the pot cards cost, set here rather than by `recipeCardPrice`'s rule, so the coins they
   * burn keep the money supply per active resident within 2% of a month without pottery (RFC 0047's
   * first check, `scripts/economy-sim.ts --kiln`). No live world has bought one.
   */
  potCards: { vase: 6, teapot: 8 },
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

/**
 * What a pot can come out of the kiln as: smooth, or one of `FINISHES`, the same words on the web
 * and the API.
 */
export const FINISH_NAMES = ["smooth", "speckled", "crackle", "iridescent"] as const;
export type Finish = (typeof FINISH_NAMES)[number];

/**
 * The finishes and their chances out of `POTTERY.outOf`, frozen: a logged `harvest` at a kiln
 * replays only while this list, its order, and its numbers stay as they are. A roll picks the first
 * whose running total covers it, and past them all the pot is smooth. About one pot in five has a
 * finish and one in a hundred is iridescent. New odds are a new table behind a logged switch, never
 * an edit to this one.
 */
export const FINISHES = [
  { finish: "speckled", chance: 1500 },
  { finish: "crackle", chance: 500 },
  { finish: "iridescent", chance: 100 },
] as const satisfies readonly { finish: Exclude<Finish, "smooth">; chance: number }[];

/** The finish a roll gives. Pure. */
export function finishOf(roll: number): Finish {
  let total = 0;
  for (const f of FINISHES) {
    total += f.chance;
    if (roll < total) return f.finish;
  }
  return "smooth";
}

/** How rare a finish is: smooth 0, then speckled, crackle, and iridescent. */
export const finishRank = (finish: Finish | undefined): number =>
  finish ? FINISH_NAMES.indexOf(finish) : 0;

/** A resident's kiln record (RFC 0047), absent until their first pot comes out. */
export const potterOf = (state: WorldState, id: ResidentId): PotterRecord | undefined =>
  state.items?.potters ? own(state.items.potters, id) : undefined;

/**
 * The finish a pot comes out with for its loader: the roll's, unless the roll says smooth after
 * `POTTERY.finishFloor` less one smooth pots in a row, when it's speckled.
 */
export function floorFinish(record: PotterRecord | undefined, roll: number): Finish {
  const rolled = finishOf(roll);
  return rolled === "smooth" && (record?.smoothRun ?? 0) >= POTTERY.finishFloor - 1
    ? "speckled"
    : rolled;
}

/** A potter's record with one more pot out of the kiln. */
function withPot(record: PotterRecord | undefined, pot: PotCodes): PotterRecord {
  const smoothRun = pot.finish === "smooth" ? (record?.smoothRun ?? 0) + 1 : 0;
  const best =
    record?.best && finishRank(record.best.finish) >= finishRank(pot.finish) ? record.best : pot;
  return { fired: (record?.fired ?? 0) + 1, ...(smoothRun > 0 ? { smoothRun } : {}), best };
}

/**
 * `merge_resident`'s part (RFC 0047): `from`'s pots fired add to `into`'s, the better of their best
 * pots stays, and `into`'s run of smooth pots is kept.
 */
export function mergePotters(items: ItemsState, from: ResidentId, into: ResidentId) {
  const theirs = items.potters ? own(items.potters, from) : undefined;
  if (!items.potters || !theirs) return;
  delete items.potters[from];
  const mine = own(items.potters, into);
  const best =
    mine?.best && finishRank(mine.best.finish) >= finishRank(theirs.best.finish)
      ? mine.best
      : theirs.best;
  items.potters[into] = {
    fired: (mine?.fired ?? 0) + theirs.fired,
    ...(mine?.smoothRun ? { smoothRun: mine.smoothRun } : {}),
    best,
  };
}

/** A pot of tea (RFC 0047): brewed at a kitchen in a teapot you hold, and served at your own event. */
export const TEA = "pot_of_tea" as const;
/** The pot a pot of tea is brewed in. */
export const TEAPOT = "teapot" as const;

/**
 * The glaze a host's tea is drawn in when served (RFC 0047): their teapot's, the first in their
 * things, else the first they've set down, else bare clay. Drawing only: it goes on the dish and
 * `dish_brought`, never on the pot of tea, which isn't a pot.
 */
export function teapotGlaze(items: ItemsState, host: ResidentId): Glaze {
  const held = own(items.inventories, host)?.goods.find((g) => g.kind === TEAPOT);
  if (held) return held.glaze ?? "bare";
  const down = Object.values(items.pots ?? {}).find((p) => p.by === host && p.good.kind === TEAPOT);
  return down?.good.glaze ?? "bare";
}

/** Whether a recipe is pottery's (RFC 0047): a pot, or a pot of tea. Nobody knows one before clay. */
export const isPotteryRecipe = (r: unknown): boolean => isPotKind(r) || r === TEA;

/** Whether the host of `e` served a pot of tea at it (`bring_dish` at their own event). */
export const servedTea = (e: Pick<HostedEvent, "dishes" | "host">): boolean =>
  (e.dishes ?? []).some((d) => d.by === e.host && d.kind === TEA);

/** The pots: every good made at a kiln, in catalog order. */
export const POT_KINDS: readonly GoodKind[] = GOOD_KINDS.filter(
  (k) => CATALOG[k].recipe?.station === KILN,
);
export const isPotKind = (k: unknown): k is GoodKind =>
  typeof k === "string" && (POT_KINDS as readonly string[]).includes(k);

/** The finishes past smooth, rarest last: a pot with one of these is worth saying so louder. */
export const RARE_FINISHES: readonly Finish[] = ["crackle", "iridescent"];

/**
 * A pot in words (RFC 0047), the one name the web, the API's answers, the check-in and plot news
 * all use: its finish once it has one, its glaze ("clay" when bare), its kind, and a vase's flowers.
 * "Speckled rose vase of tulips", "Smooth clay bowl", "Sea teapot" before it's out of the kiln.
 * Codes only, never a label. Capitalized; `lower` for the middle of a sentence.
 */
export function potName(
  pot: {
    kind: string;
    glaze?: string | undefined;
    finish?: string | undefined;
    flower?: string | undefined;
  },
  lower = false,
): string {
  const kind = CATALOG[pot.kind as GoodKind]?.name.toLowerCase() ?? pot.kind;
  const glaze = !pot.glaze || pot.glaze === "bare" ? "clay" : pot.glaze;
  const flower = pot.flower
    ? ` of ${CATALOG[pot.flower as StackKind]?.plural.toLowerCase() ?? pot.flower}`
    : "";
  const words = [pot.finish, glaze, kind].filter(Boolean).join(" ") + flower;
  return lower ? words : `${words.charAt(0).toUpperCase()}${words.slice(1)}`;
}

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
  const fits = inventorySize(items.inventories[owner]) + 1 <= inventoryMaxOf(state);
  if (owner === actor && !fits) {
    return refuse(
      "inventory_full",
      `You can hold ${inventoryMaxOf(state)} things, and the pot needs room for one more. Give, place, or sell something first.`,
    );
  }
  const finish = floorFinish(potterOf(state, owner), roll);
  const good: Good = { ...firing.good, finish };
  return () => {
    const firings = items.firings as Record<string, Firing>;
    delete firings[key];
    if (Object.keys(firings).length === 0) delete items.firings;
    const pot = {
      kind: good.kind as GoodKind,
      glaze: good.glaze ?? "bare",
      finish,
      maker: good.maker,
    };
    const potters = items.potters ?? {};
    potters[owner] = withPot(own(potters, owner), {
      kind: pot.kind,
      glaze: pot.glaze,
      finish,
    });
    items.potters = potters;
    const events: WorldEvent[] = [{ type: "kiln_emptied", x, y, by: actor, pot }];
    if (!fits) {
      // Someone who can build here opened it for a loader with no room: it waits for them.
      items.heldAside = [...(items.heldAside ?? []), { good, by: owner, day }];
      return events;
    }
    inventory(items, owner).goods.push(good);
    return [...events, inventoryEvent(owner, "fired", [], { gained: [good] })];
  };
}

// ---------- pots set down on a plot ----------

/**
 * The block a pot is set down as (RFC 0047): `place {x, y, floor?, block: "pot", item, flower?}`
 * on a tile of a plot you can build on, ground floor or upstairs, puts one of your pots there as a
 * small decor block, and `remove` takes it up again, back to whoever set it down. The pot is the
 * good itself, with its maker, label, glaze and finish, so it's drawn as it is.
 */
export const POT_BLOCK = "pot" as const;

/** The flowers a vase can hold: the catalog's produce in the flower family. */
export const FLOWER_KINDS: readonly StackKind[] = STACK_KINDS.filter(
  (k) => CATALOG[k].family === "flower" && CATALOG[k].role === "produce",
);
export type FlowerKind = StackKind;
export const isFlowerKind = (k: unknown): k is FlowerKind =>
  typeof k === "string" && (FLOWER_KINDS as readonly string[]).includes(k);

/** The pot that holds a flower. */
const VASE = "vase";

/** Where `items.pots` keeps the pot on (x, y) of `floor`. */
export const potKey = (x: number, y: number, floor: number): string =>
  floor === 0 ? tileKey(x, y) : `${floor}:${tileKey(x, y)}`;

/** The pot set down on (x, y) of `floor`, if any. */
export const potAt = (state: WorldState, x: number, y: number, floor = 0): PlacedPot | undefined =>
  state.items?.pots?.[potKey(x, y, floor)];

/** Every pot set down, where it is and whose it is, north to south then west to east, by floor. */
export function potsOf(
  state: WorldState,
): { x: number; y: number; floor: number; pot: PlacedPot }[] {
  return Object.entries(state.items?.pots ?? {})
    .map(([key, pot]) => {
      const [floorPart, tile] = key.includes(":") ? key.split(":") : ["0", key];
      const [x, y] = parseKey(tile as string);
      return { x, y, floor: Number(floorPart), pot };
    })
    .sort((a, b) => a.floor - b.floor || a.y - b.y || a.x - b.x);
}

/**
 * The rest of `place`'s check for a pot, after the checks every block gets (where, whose, the
 * hearth, someone standing there, a public way, what holds it up): one of your fired pots by its
 * id, and for a vase a flower from your things, if you send one.
 */
export function checkPlacePot(
  state: WorldState,
  actor: ResidentId,
  command: Extract<Command, { type: "place" }>,
  at: { x: number; y: number; floor: number },
  blocks: Record<string, BlockKind>,
): ItemsChecked {
  const shut = potteryClosed(state);
  if (shut) return shut;
  const items = state.items as ItemsState;
  const { item, flower } = command;
  if (typeof item !== "string") {
    return refuse(
      "unknown_item",
      'Set a pot down by its id: {"type": "place", "block": "pot", "item": "i_12", "x": 4, "y": 5}. GET /v1/inventory lists your pots.',
    );
  }
  const good = items.inventories[actor]?.goods.find((g) => g.id === item);
  if (!good) return refuse("not_enough_items", "You don't hold a thing with that id.");
  if (!isPotKind(good.kind) || good.glaze === undefined) {
    return refuse("unknown_item", "Only a pot from a kiln is set down this way.");
  }
  if (flower !== undefined) {
    if (good.kind !== VASE) return refuse("unknown_item", "Only a vase holds a flower.");
    if (!isFlowerKind(flower)) {
      return refuse("unknown_item", `A vase holds one of: ${FLOWER_KINDS.join(", ")}.`);
    }
    if (good.flower !== undefined) {
      return refuse("already_set", "That vase holds a flower already.");
    }
    if ((items.inventories[actor]?.stacks[flower] ?? 0) < 1) {
      return refuse("not_enough_items", "You don't have that flower. Grow one in a planter.");
    }
  }
  const { x, y, floor } = at;
  const day = state.day as number;
  return () => {
    const mine = inventory(items, actor);
    mine.goods = mine.goods.filter((g) => g.id !== item);
    const changes = flower === undefined ? [] : [addStack(mine, flower, -1)];
    if (flower !== undefined) good.flower = flower;
    blocks[tileKey(x, y)] = POT_BLOCK;
    items.pots = { ...items.pots, [potKey(x, y, floor)]: { good, by: actor, day } };
    return [
      {
        type: "block_placed" as const,
        x,
        y,
        ...(floor === 0 ? {} : { floor }),
        block: POT_BLOCK,
        by: actor,
        pot: { ...good },
      },
      inventoryEvent(actor, "placed", changes, { lost: [item] }),
    ];
  };
}

/**
 * `remove` on a pot (RFC 0047): it goes back to whoever set it down, flower and all. Anyone who can
 * build on the plot may take it up; when that's someone else and the pot's owner has no room, it's
 * held aside for them, as a thing taken down from display is.
 */
export function checkTakeUpPot(
  state: WorldState,
  actor: ResidentId,
  at: { x: number; y: number; floor: number },
  blocks: Record<string, BlockKind>,
): ItemsChecked {
  const items = state.items as ItemsState;
  const { x, y, floor } = at;
  const key = potKey(x, y, floor);
  const placed = items.pots?.[key];
  if (!placed) return refuse("no_block", "Nothing to remove there.");
  const { good, by } = placed;
  const fits = inventorySize(items.inventories[by]) + 1 <= inventoryMaxOf(state);
  if (by === actor && !fits) {
    return refuse(
      "inventory_full",
      `You can hold ${inventoryMaxOf(state)} things, and taking the pot up needs room for one more.`,
    );
  }
  const day = state.day as number;
  return () => {
    delete blocks[tileKey(x, y)];
    const pots = items.pots as Record<string, PlacedPot>;
    delete pots[key];
    if (Object.keys(pots).length === 0) delete items.pots;
    const events: WorldEvent[] = [
      { type: "block_removed", x, y, ...(floor === 0 ? {} : { floor }), by: actor },
    ];
    if (!fits) {
      items.heldAside = [...(items.heldAside ?? []), { good, by, day }];
      return events;
    }
    inventory(items, by).goods.push(good);
    return [...events, inventoryEvent(by, "picked_up", [], { gained: [good] })];
  };
}

/** Why a staff `clear_block` or a plan leaves a pot's tile: the pot is someone's thing. */
export function potRemoveProblem(
  state: WorldState,
  x: number,
  y: number,
  floor = 0,
): Rejection | null {
  return potAt(state, x, y, floor)
    ? refuse("tile_occupied", "A pot stands there. Whoever set it down takes it up with remove.")
    : null;
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

/** The keepsake a guest takes home from an event its host served tea at. */
export const CUP = "cup_of_tea" as const;

/**
 * At `credit_event`, for an event its host served tea at (RFC 0047): a cup of tea for each guest
 * on its `cups` list (or, without one, the credited list), signed by the host and carrying which
 * event it was and when it started (`tea`), into their things, or held aside for them when their
 * things are full, as a thing taken down from display is. With nobody on the list the pot of tea
 * goes back to its host (inventory reason `tea_kept`). Nothing when no tea was served.
 */
export function pourTea(
  state: WorldState,
  event: Pick<HostedEvent, "dishes" | "host" | "id" | "startsAt">,
  guests: readonly ResidentId[],
): WorldEvent[] {
  const items = state.items;
  if (!items || state.day === undefined || !servedTea(event)) return [];
  const day = state.day;
  const events: WorldEvent[] = [];
  if (guests.length === 0) {
    // Nobody was counted for a cup: the pot of tea comes back to its host, rather than going
    // nowhere, held aside when their things are full.
    const tea: Good = { id: `i_${items.nextId}`, kind: TEA, maker: event.host, madeDay: day };
    items.nextId += 1;
    if (inventorySize(items.inventories[event.host]) + 1 > inventoryMaxOf(state)) {
      items.heldAside = [...(items.heldAside ?? []), { good: tea, by: event.host, day }];
      return events;
    }
    inventory(items, event.host).goods.push(tea);
    return [inventoryEvent(event.host, "tea_kept", [], { gained: [tea] })];
  }
  for (const guest of guests) {
    const good: Good = {
      id: `i_${items.nextId}`,
      kind: CUP,
      maker: event.host,
      madeDay: day,
      tea: { event: event.id, startsAt: event.startsAt },
    };
    items.nextId += 1;
    if (inventorySize(items.inventories[guest]) + 1 > inventoryMaxOf(state)) {
      items.heldAside = [...(items.heldAside ?? []), { good, by: guest, day }];
      continue;
    }
    inventory(items, guest).goods.push(good);
    events.push(inventoryEvent(guest, "poured", [], { gained: [good] }));
  }
  return events;
}
