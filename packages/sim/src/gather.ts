import { type Biome, biomeAt } from "./biome";
import type { RecipeName } from "./catalog";
import { oneTimeSwitch, refuse } from "./check";
import {
  addStack,
  closed,
  type FindKind,
  ITEMS,
  type ItemsChecked,
  inventory,
  inventoryEvent,
  inventorySize,
  type ResourceKind,
  reachProblem,
} from "./items";
import { tileKey } from "./keys";
import { howToMake, knows, learn, pageOn } from "./recipes";
import { type Season, seasonOf } from "./season";
import type {
  Command,
  ItemsState,
  Plot,
  RecipesState,
  ResidentId,
  Tile,
  WorldConfig,
  WorldEvent,
  WorldState,
} from "./types";
import { canBuildOn, inBounds, plotAtTile, walkHint } from "./world";

/**
 * Simple gathering (phase 1, item 9; decision 0063): fallen branches in forests and loose stones
 * on stone ground. Each tile grows at most one pickup back a UTC day; `gather {x, y}` picks it up
 * into the gatherer's inventory, and `gather` with no tile picks up everything within reach the
 * gatherer may take (decision 0125). No coins move: the most grindable thing in phase 1 is a walk.
 *
 * The spawn is a pure function of the tile and the day, like `biomeAt`, so every client draws the
 * same sticks and stones without the log carrying them. Only the day's pickups live in state
 * (`items.gathered`, tile to day), and `new_day` forgets yesterday's, so old logs replay to the
 * hash they always had.
 *
 * Once the server logs `own_plot_pickups`, a claimed plot's pickups are for its owner and
 * co-owners only. The Commons and unclaimed land stay open to everyone. Gathers logged before the
 * switch replay as they were made.
 *
 * Once the server logs `open_finds` (RFC 0021), a tile with no branch or stone may hold a find
 * instead: an acorn, a seashell, a geode, by its biome and the season (`FIND_SPAWNS`). Branches
 * and stones lie exactly where they did, and before the switch nothing else does, so gathers
 * logged before it replay as they were made.
 *
 * Once recipes are learned too (`open_recipes`, RFC 0024), about one find in 20 is a recipe page
 * instead (`pageOn`): gathering it teaches its recipe and puts nothing in your things, and a page
 * you already know stays where it lies. Before that switch finds lie exactly as they did.
 */

/** The numbers. Every count is a whole number of pickups. */
export const GATHER = {
  /** Chance a forest tile drops a fallen branch on a day. */
  woodChance: 0.08,
  /** Chance a stone-ground tile drops a loose stone on a day. */
  stoneChance: 0.08,
  /** What one pickup puts in your things. */
  perPickup: 1,
} as const;

/**
 * A recipe page lying on the ground (RFC 0024). It isn't a thing you hold: gathering it teaches
 * its recipe (`pageOn` says which).
 */
export const RECIPE_PAGE = "recipe_page";

/**
 * What can lie on a tile to pick up: a branch, a stone, or (once finds are out) a find, or (once
 * recipes are learned too) a recipe page.
 */
export type PickupKind = ResourceKind | FindKind | typeof RECIPE_PAGE;

/** One find's place in the spawn: its biome, its chance per tile a day, and its seasons if any. */
export interface FindSpawn {
  kind: FindKind;
  biome: Biome;
  /** Chance a tile of its biome, with no branch or stone on it, holds one on a day. */
  chance: number;
  /** It lies only on days in these seasons. Absent: every day of the year. */
  seasons?: readonly Season[];
}

/**
 * Where finds lie (RFC 0021, decision 0099), frozen: a logged `gather` of a find replays only
 * while this list, its order, and its chances stay exactly as they are. A tile's biome keeps the
 * finds in season on the day, in this order, and a roll of its own picks the first whose running
 * total of chances covers it. A new find, or new numbers, is a new list behind a new logged switch,
 * never an edit to this one. `gather.test.ts` pins it.
 */
export const FIND_SPAWNS = [
  { kind: "acorn", biome: "forest", chance: 0.003 },
  { kind: "pinecone", biome: "forest", chance: 0.0025 },
  { kind: "mushroom", biome: "forest", chance: 0.0012 },
  { kind: "feather", biome: "forest", chance: 0.0003 },
  { kind: "chestnut", biome: "forest", chance: 0.003, seasons: ["autumn"] },
  { kind: "holly", biome: "forest", chance: 0.002, seasons: ["winter"] },
  { kind: "seashell", biome: "sand", chance: 0.006 },
  { kind: "driftwood", biome: "sand", chance: 0.003 },
  { kind: "sea_glass", biome: "sand", chance: 0.0008 },
  { kind: "starfish", biome: "sand", chance: 0.002, seasons: ["summer"] },
  { kind: "crystal", biome: "stone", chance: 0.003 },
  { kind: "fossil", biome: "stone", chance: 0.0012 },
  { kind: "geode", biome: "stone", chance: 0.0004 },
  { kind: "four_leaf_clover", biome: "meadow", chance: 0.0002 },
  { kind: "maple_leaf", biome: "meadow", chance: 0.0025, seasons: ["autumn"] },
  { kind: "cherry_blossom", biome: "meadow", chance: 0.0025, seasons: ["spring"] },
] as const satisfies readonly FindSpawn[];

/** The finds that may lie in a biome on a day: its spawns in season, in `FIND_SPAWNS` order. */
export function findsIn(biome: Biome, day: number): FindSpawn[] {
  const season = seasonOf(day);
  return FIND_SPAWNS.filter(
    (f: FindSpawn) => f.biome === biome && (f.seasons === undefined || f.seasons.includes(season)),
  );
}

/**
 * The roll for a find on a tile and a day, in [0, 1). Its own constants and murmur3's finalizer,
 * so it never follows the branch-and-stone roll: a tile's two rolls are independent.
 */
function findRoll(x: number, y: number, day: number): number {
  let h = (Math.imul(x, 0x27d4eb2f) + Math.imul(y, 0x165667b1) + Math.imul(day, 0x9e3779b1)) | 0;
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 0x100000000;
}

/**
 * The most a biome's finds can add up to on any day, every season's together. A roll at or past it
 * holds nothing, which most tiles' rolls are, so the season is only looked up for the rest: the
 * map asks about every tile on screen each frame.
 */
const MOST: Partial<Record<Biome, number>> = {};
for (const f of FIND_SPAWNS) MOST[f.biome] = (MOST[f.biome] ?? 0) + f.chance;

/** The find on a tile of `biome` on `day`, if its roll lands on one. Pure. */
function findAt(biome: Biome, x: number, y: number, day: number): FindKind | null {
  const roll = findRoll(x, y, day);
  if (roll >= (MOST[biome] ?? 0)) return null;
  let total = 0;
  for (const spawn of findsIn(biome, day)) {
    total += spawn.chance;
    if (roll < total) return spawn.kind;
  }
  return null;
}

/**
 * What lies on tile (x, y) on `day`, if anything: a fallen branch in a forest, a loose stone on
 * stone ground, and, with `finds` on (`open_finds` was logged), a find on a tile with neither,
 * which with `pages` on too (`open_recipes` was logged) is now and then a recipe page. Pure: the
 * same tile, day, and switches always answer the same, on every client and replay. With `finds`
 * off it answers exactly as it did before finds, and with `pages` off as it did before pages.
 */
export function gatherableAt(
  config: WorldConfig,
  x: number,
  y: number,
  day: number,
  finds = false,
  pages = false,
): PickupKind | null {
  const biome = biomeAt(config, x, y);
  const kind: ResourceKind | null =
    biome === "forest" ? "wood" : biome === "stone" ? "stone" : null;
  if (kind) {
    // Mix the three integers with a finalizer, like biomeAt, so neighboring tiles and days are
    // independent.
    let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(day, 2246822519)) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    const roll = ((h ^ (h >>> 16)) >>> 0) / 0x100000000;
    const chance = kind === "wood" ? GATHER.woodChance : GATHER.stoneChance;
    if (roll < chance) return kind;
  }
  if (!finds) return null;
  const find = findAt(biome, x, y, day);
  return find && pages && pageOn(x, y, day) ? RECIPE_PAGE : find;
}

/**
 * What still lies on (x, y) on `day`: its spawn, unless the tile is built on or was picked clean
 * today. `finds` says whether finds are out (`findsOpen` in the world), and `pages` whether
 * recipes are learned (`recipesOpen`). Pure, so a client draws exactly what `gather` would take
 * from its own copy of the world.
 */
export function pickupOn(
  config: WorldConfig,
  x: number,
  y: number,
  day: number,
  tile: { built: boolean; picked: boolean; finds?: boolean; pages?: boolean },
): PickupKind | null {
  if (tile.built || tile.picked) return null;
  return gatherableAt(config, x, y, day, tile.finds === true, tile.pages === true);
}

/** Whether finds lie on the ground in this world (`open_finds` was logged). */
export function findsOpen(state: WorldState): boolean {
  return state.items?.findsOpen === true;
}

/** Whether some finds are recipe pages: finds are out and recipes are learned (RFC 0024). */
export function pagesOpen(state: WorldState): boolean {
  return findsOpen(state) && state.recipes !== undefined;
}

/** Whether the pickup on a tile is still lying there today. */
export function pickupLeft(state: WorldState, x: number, y: number): PickupKind | null {
  const day = state.day;
  if (day === undefined) return null;
  const key = tileKey(x, y);
  return pickupOn(state.config, x, y, day, {
    built: state.blocks[key] !== undefined,
    picked: state.items?.gathered?.[key] === day,
    finds: findsOpen(state),
    pages: pagesOpen(state),
  });
}

/**
 * Whether a resident may gather on a tile of `plot` (undefined for the Commons and unclaimed
 * land). Pure, so clients ask it the same question the sim does: with `ownersOnly` off (before
 * `own_plot_pickups`), anyone may gather anywhere.
 */
export function mayGatherOn(
  plot: Pick<Plot, "ownerId" | "coOwners"> | undefined,
  residentId: ResidentId,
  ownersOnly: boolean,
): boolean {
  return !ownersOnly || !plot || canBuildOn(plot, residentId);
}

/** Whether the owners-only rule is on in this world (`own_plot_pickups` was logged). */
export function plotPickupsOwned(state: WorldState): boolean {
  return state.items?.plotPickupsOwned === true;
}

/**
 * The words in every refusal of a gather on someone else's plot, so clients can tell it from a
 * build refusal with the same code and say it their own way.
 */
export const OTHERS_PLOT_GATHER =
  "only its owner and the people they share it with can gather there";

/** How far around a refused gather the hint looks for one the resident may take. */
const HINT_RADIUS = 12;

/**
 * The nearest pickup lying today that `actor` may take, within `radius` of `from`: nearest by
 * Chebyshev distance, then north to south, then west to east. For a refusal's next step, and the
 * gather link's walk there.
 */
export function nearestOpenPickup(
  state: WorldState,
  actor: ResidentId,
  from: Tile,
  radius = HINT_RADIUS,
): Tile | null {
  const ownersOnly = plotPickupsOwned(state);
  for (let d = 0; d <= radius; d++) {
    for (let y = from.y - d; y <= from.y + d; y++) {
      for (let x = from.x - d; x <= from.x + d; x++) {
        if (Math.max(Math.abs(x - from.x), Math.abs(y - from.y)) !== d) continue;
        if (!inBounds(state.config, x, y) || !pickupLeft(state, x, y)) continue;
        if (mayGatherOn(plotAtTile(state, x, y), actor, ownersOnly)) return { x, y };
      }
    }
  }
  return null;
}

/** A pickup lying on a tile: where, and what. */
export type PickupAt = Tile & { kind: PickupKind };

/**
 * Every pickup within reach of `at` that `mayTake` allows, north to south, then west to east: what
 * `gather` with no tile picks up, in the order it takes them. `lying` says what still lies on a
 * tile (`pickupLeft` in the sim, `pickupOn` from a client's copy of the world), so the sim and the
 * map make the same list.
 */
export function pickupsInReach(
  config: WorldConfig,
  at: Tile,
  lying: (x: number, y: number) => PickupKind | null,
  mayTake: (x: number, y: number) => boolean,
): PickupAt[] {
  const found: PickupAt[] = [];
  for (let y = at.y - config.reach; y <= at.y + config.reach; y++) {
    for (let x = at.x - config.reach; x <= at.x + config.reach; x++) {
      if (!inBounds(config, x, y)) continue;
      const kind = lying(x, y);
      if (kind && mayTake(x, y)) found.push({ x, y, kind });
    }
  }
  return found;
}

/**
 * `gather` with no tile: everything within reach the resident may take, in `pickupsInReach`'s
 * order, as far as there's room in their things. One `gathered` for each tile, then one `inventory`
 * with each kind's total, in the order the kinds came up. A recipe page takes no room: each one for
 * a recipe the resident doesn't know is gathered and ends in a `recipe_learned` after the
 * `inventory`, and the rest (known, or a second page for the same recipe) stay where they lie.
 */
function checkGatherAll(
  state: WorldState,
  actor: ResidentId,
  me: Tile,
  items: ItemsState,
  day: number,
): ItemsChecked {
  const ownersOnly = plotPickupsOwned(state);
  const lying = (x: number, y: number) => pickupLeft(state, x, y);
  const mine = pickupsInReach(state.config, me, lying, (x, y) =>
    mayGatherOn(plotAtTile(state, x, y), actor, ownersOnly),
  );
  if (mine.length === 0) {
    // Nothing here is yours to take, so the next step is the nearest one that is.
    const theirs = pickupsInReach(state.config, me, lying, () => true).length > 0;
    const near = nearestOpenPickup(state, actor, me);
    const why = theirs
      ? `What lies within reach is on someone else's plot: ${OTHERS_PLOT_GATHER}.`
      : "Nothing lies within reach today.";
    const finds = findsOpen(state) ? " Now and then a tile with neither holds a find." : "";
    const next = near
      ? ` The nearest one you may take is at x ${near.x}, y ${near.y}.${walkHint(me, near, state.config.reach)} Then send {"type": "gather"} again.`
      : ` Fallen branches lie in forests, loose stones on stone ground, and each tile grows one back a day.${finds} pickups in GET /v1/world lists what's lying today.`;
    return refuse("nothing_to_gather", `${why}${next}`);
  }
  // Pages teach rather than fill your things (RFC 0024). Before recipes are learned there are none.
  const stacks = mine.filter((t) => t.kind !== RECIPE_PAGE);
  const pages: { at: PickupAt; recipe: RecipeName }[] = [];
  let knownPage: RecipeName | undefined;
  for (const at of mine) {
    if (at.kind !== RECIPE_PAGE) continue;
    const recipe = pageOn(at.x, at.y, day) as RecipeName;
    if (knows(state, actor, recipe) || pages.some((p) => p.recipe === recipe)) knownPage ??= recipe;
    else pages.push({ at, recipe });
  }
  const room = ITEMS.inventoryMax - inventorySize(items.inventories[actor]);
  const fits = Math.floor(room / GATHER.perPickup);
  if (pages.length === 0 && stacks.length === 0 && knownPage) {
    return refuse(
      "already_known",
      `The recipe page within reach teaches ${howToMake(knownPage)}, which you already know, so it stays for someone else.`,
    );
  }
  if (fits < 1 && pages.length === 0) {
    return refuse(
      "inventory_full",
      `You can hold ${ITEMS.inventoryMax} things. Make or give something first.`,
    );
  }
  const kept = new Set(stacks.slice(0, Math.max(0, fits)));
  const take = mine.filter((t) => kept.has(t) || pages.some((p) => p.at === t));
  const recipes = state.recipes as RecipesState;
  return () => {
    if (!items.gathered) items.gathered = {};
    const gathered = items.gathered;
    const events: WorldEvent[] = [];
    const totals: { kind: StackPickup; amount: number }[] = [];
    for (const t of take) {
      gathered[tileKey(t.x, t.y)] = day;
      events.push({ type: "gathered", x: t.x, y: t.y, kind: t.kind, by: actor });
      if (t.kind === RECIPE_PAGE) continue;
      const total = totals.find((c) => c.kind === t.kind);
      if (total) total.amount += GATHER.perPickup;
      else totals.push({ kind: t.kind, amount: GATHER.perPickup });
    }
    if (totals.length > 0) {
      const inv = inventory(items, actor);
      const changes = totals.map((c) => addStack(inv, c.kind, c.amount));
      events.push(inventoryEvent(actor, "gather", changes));
    }
    for (const { recipe } of pages) {
      learn(recipes, actor, recipe);
      events.push({ type: "recipe_learned", residentId: actor, recipe, how: "found" });
    }
    return events;
  };
}

/** A pickup that goes in your things: anything but a recipe page. */
type StackPickup = Exclude<PickupKind, typeof RECIPE_PAGE>;

/**
 * `gather {x, y}`: pick up the fallen branch, loose stone, or find on a tile within reach. With
 * neither `x` nor `y`, everything within reach (`checkGatherAll`). The API took a gather only with
 * both until then, so every logged gather names a tile and replays as it was made.
 */
export function checkGather(
  state: WorldState,
  actor: ResidentId,
  command: Extract<Command, { type: "gather" }>,
): ItemsChecked {
  const shut = closed(state);
  if (shut) return shut;
  const items = state.items as ItemsState;
  const day = state.day as number;
  const me = state.residents[actor];
  if (!me) return refuse("not_joined", "Join the world first.");
  const { x, y } = command;
  if (x === undefined && y === undefined) return checkGatherAll(state, actor, me, items, day);
  if (x === undefined || y === undefined) {
    return refuse(
      "out_of_bounds",
      'Send both x and y to pick up what lies on one tile, or neither to gather everything within reach: {"type": "gather"}.',
    );
  }
  const far = reachProblem(state, me, { x, y });
  if (far) return far;
  const kind = pickupLeft(state, x, y);
  if (!kind) {
    const finds = findsOpen(state)
      ? " Now and then a tile with neither holds a find instead: an acorn, a seashell, a crystal."
      : "";
    return refuse(
      "nothing_to_gather",
      `Nothing to pick up there. Fallen branches lie in forests, loose stones on stone ground, and each tile grows one back a day.${finds} pickups in GET /v1/world lists what's lying today.`,
    );
  }
  const plot = plotAtTile(state, x, y);
  if (!mayGatherOn(plot, actor, plotPickupsOwned(state))) {
    const near = nearestOpenPickup(state, actor, me);
    const hint = near ? ` The nearest one you may take is at x ${near.x}, y ${near.y}.` : "";
    return refuse(
      "not_your_plot",
      `That's ${plot?.ownerId}'s plot: ${OTHERS_PLOT_GATHER}. The Commons and unclaimed land are free to gather, and so is your own plot.${hint}`,
    );
  }
  const key = tileKey(x, y);
  if (kind === RECIPE_PAGE) {
    // A page teaches its recipe and takes no room (RFC 0024). One you know stays for someone else.
    const recipe = pageOn(x, y, day) as RecipeName;
    if (knows(state, actor, recipe)) {
      return refuse(
        "already_known",
        `That recipe page teaches ${howToMake(recipe)}, which you already know, so it stays for someone else.`,
      );
    }
    const recipes = state.recipes as RecipesState;
    return () => {
      if (!items.gathered) items.gathered = {};
      items.gathered[key] = day;
      learn(recipes, actor, recipe);
      return [
        { type: "gathered", x, y, kind, by: actor },
        { type: "recipe_learned", residentId: actor, recipe, how: "found" },
      ];
    };
  }
  if (inventorySize(items.inventories[actor]) + GATHER.perPickup > ITEMS.inventoryMax) {
    return refuse(
      "inventory_full",
      `You can hold ${ITEMS.inventoryMax} things. Make or give something first.`,
    );
  }
  return () => {
    if (!items.gathered) items.gathered = {};
    items.gathered[key] = day;
    const change = addStack(inventory(items, actor), kind, GATHER.perPickup);
    const events: WorldEvent[] = [
      { type: "gathered", x, y, kind, by: actor },
      inventoryEvent(actor, "gather", [change]),
    ];
    return events;
  };
}

/** `own_plot_pickups`, which only TOWN_ACTOR sends: from now on, a plot's pickups are its owners'. */
export function checkOwnPlotPickups(state: WorldState): ItemsChecked {
  const shut = closed(state);
  if (shut) return shut;
  const items = state.items as ItemsState;
  return oneTimeSwitch({
    on: items.plotPickupsOwned,
    already: "Pickups on a plot are already for its owners only.",
    turnOn: () => {
      items.plotPickupsOwned = true;
    },
    event: { type: "plot_pickups_owned" },
  });
}

/**
 * `open_finds`, which only TOWN_ACTOR sends (RFC 0021): from now on, a tile with no branch or stone
 * may hold a find. Needs items open, and comes once.
 */
export function checkOpenFinds(state: WorldState): ItemsChecked {
  const shut = closed(state);
  if (shut) return shut;
  const items = state.items as ItemsState;
  return oneTimeSwitch({
    on: items.findsOpen,
    already: "Finds are already out.",
    turnOn: () => {
      items.findsOpen = true;
    },
    event: { type: "finds_opened" },
  });
}
