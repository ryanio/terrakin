import {
  CATALOG,
  type CraftKind,
  ITEM_INFO,
  kindHoliday,
  RECIPE_NAMES,
  type RecipeName,
  ROTATION_GOODS,
  recipeOf,
} from "./catalog";
import { coinCount as coins, oneTimeSwitch, refuse } from "./check";
import { allowanceDue, isTownsfolk, movePurse, moveTreasury } from "./economy";
import { dayName } from "./holiday";
import { own } from "./own";
import { type Season, seasonOf } from "./season";
import {
  BUY_ORDERS,
  buySeason,
  nextSeasonStart,
  opened,
  type SellKind,
  seasonLastDay,
  treasuryShareOf,
} from "./shop";
import type { Command, RecipesState, Rejection, ResidentId, WorldEvent, WorldState } from "./types";

/**
 * Recipes you learn (RFC 0024, decision 0170). A resident knows the base, every holiday recipe, and
 * what they learned: with a free pick, a card from the shop's Recipes shelf, a lesson, or a recipe
 * page. Townsfolk know everything, and so does everyone who lived here when `open_recipes` was
 * logged.
 *
 * Nothing here runs until the server sends `open_recipes`. Until then `knows` says yes to everyone,
 * so worlds from before it replay to the hash they always had.
 */

/**
 * The numbers. The card prices come from a rule, not a table (`recipeCardPrice`), so a recipe
 * added later is priced the same way. Changing one changes what a logged `shop_buy` of a card cost,
 * so once recipes are open in a live world a change needs a logged switch.
 */
export const RECIPES_RULES = {
  /** Free picks each resident gets on top of the base. */
  starterPicks: 3,
  /** A card for a good the town buys on its rotation: this many times what the town pays for one. */
  rotationTimes: 5,
  /** A card for a good the town buys every day of its season: this many times what it pays. */
  seasonTimes: 8,
  /** A card for anything the town doesn't buy: this many coins... */
  plainCoins: 10,
  /** ...plus this many for each thing one craft uses up. */
  perThing: 3,
  /** Every card's price is rounded to the nearest this many coins. */
  roundTo: 5,
} as const;

/**
 * The recipes everyone knows, frozen by name: what the first pantry and the starter seeds make
 * (`herb_tea` and `jam`), a gift from the garden and the first furniture from gathered wood and
 * stone, and the fishing rod, which fishing needs. A new base recipe is a rule change that needs a
 * logged input of its own.
 */
export const BASE_RECIPES = [
  "herb_tea",
  "jam",
  "bouquet",
  "chair",
  "table",
  "stone_wall",
  "fishing_rod",
] as const satisfies readonly RecipeName[];

export const isRecipeName = (r: unknown): r is RecipeName =>
  typeof r === "string" && (RECIPE_NAMES as readonly string[]).includes(r);

/** A family recipe's id (`jam`) has no kind of its own, so no holiday either. */
const holidayOfRecipe = (recipe: RecipeName) =>
  Object.hasOwn(CATALOG, recipe) ? kindHoliday(recipe as CraftKind) : undefined;

/**
 * Recipes everyone knows, all year, because the catalog marks them with a holiday: today candy,
 * candy canes, and the jack-o'-lantern. A recipe for a future holiday joins by its mark.
 */
export const HOLIDAY_RECIPES: readonly RecipeName[] = RECIPE_NAMES.filter(
  (r) => holidayOfRecipe(r) !== undefined,
);

/** Whether everyone knows `recipe`: it's in the base, or belongs to a holiday. */
export const knownByAll = (recipe: RecipeName): boolean =>
  (BASE_RECIPES as readonly string[]).includes(recipe) || HOLIDAY_RECIPES.includes(recipe);

/** Every recipe the shop sells a card for: all but the base and the holiday recipes. */
export const CARD_RECIPES: readonly RecipeName[] = RECIPE_NAMES.filter((r) => !knownByAll(r));

/** A card's sku in `shop_buy` and `GET /v1/shop`: `recipe:lemonade`. */
export const cardSku = (recipe: RecipeName) => `recipe:${recipe}` as const;
export type CardSku = ReturnType<typeof cardSku>;
export const CARD_SKUS: readonly CardSku[] = CARD_RECIPES.map(cardSku);

/** Whether a sku asks for a recipe card, a known one or not. */
export const isCardSku = (sku: unknown): sku is string =>
  typeof sku === "string" && sku.startsWith("recipe:");

/** The card a sku names, or undefined when it names none. */
export function cardOf(sku: string): RecipeName | undefined {
  const recipe = sku.slice("recipe:".length);
  return isCardSku(sku) && CARD_RECIPES.includes(recipe as RecipeName)
    ? (recipe as RecipeName)
    : undefined;
}

/** What the town pays for what `recipe` makes, when it buys it at all. */
const orderFor = (recipe: RecipeName) =>
  Object.hasOwn(BUY_ORDERS, recipe) ? BUY_ORDERS[recipe as SellKind] : undefined;

/**
 * What a recipe card costs: 5 times the town's price for a good it buys on its rotation, 8 times
 * for one it buys every day of its season, and otherwise 10 coins plus 3 for each thing one craft
 * uses up, rounded to the nearest 5 (RFC 0024).
 */
export function recipeCardPrice(recipe: RecipeName): number {
  const { rotationTimes, seasonTimes, plainCoins, perThing, roundTo } = RECIPES_RULES;
  const order = orderFor(recipe);
  let raw: number;
  if (order && (ROTATION_GOODS as readonly string[]).includes(recipe)) {
    raw = rotationTimes * order.price;
  } else if (order && buySeason(recipe as SellKind)) {
    raw = seasonTimes * order.price;
  } else {
    const needs = Object.values(CATALOG[recipe as CraftKind].recipe?.needs ?? {});
    raw = plainCoins + perThing * needs.reduce((sum, n) => sum + n, 0);
  }
  return Math.round(raw / roundTo) * roundTo;
}

/**
 * The season a card is on the shelf in: the season the town buys what it makes every day of, like
 * pumpkin pie in autumn (RFC 0017). Undefined for a card on the shelf all year.
 */
export const cardSeason = (recipe: RecipeName): Season | undefined =>
  orderFor(recipe) ? buySeason(recipe as SellKind) : undefined;

/** Whether `recipe`'s card is on the shop's Recipes shelf on `day`. */
export const onShelf = (recipe: RecipeName, day: number): boolean => {
  const season = cardSeason(recipe);
  return CARD_RECIPES.includes(recipe) && (season === undefined || season === seasonOf(day));
};

/** The cards on the shop's Recipes shelf on `day`, in catalog order. */
export const shelfOn = (day: number): RecipeName[] =>
  CARD_RECIPES.filter((recipe) => onShelf(recipe, day));

// ---------- reading ----------

/** Whether `id` knows every recipe: before `open_recipes`, as townsfolk, or from living here then. */
export const knowsEverything = (state: WorldState, id: ResidentId): boolean =>
  !state.recipes || isTownsfolk(state, id) || state.recipes.everything.includes(id);

/**
 * Whether `id` knows `recipe`: the one check `craft` makes, which clients call too to hold back
 * what the sim would refuse (decision 0052).
 */
export function knows(state: WorldState, id: ResidentId, recipe: RecipeName): boolean {
  if (knowsEverything(state, id) || knownByAll(recipe)) return true;
  return own(state.recipes?.learned, id)?.includes(recipe) ?? false;
}

/** Every recipe `id` knows, sorted by name. Before `open_recipes`, every recipe. */
export const knownRecipes = (state: WorldState, id: ResidentId): RecipeName[] =>
  RECIPE_NAMES.filter((recipe) => knows(state, id, recipe)).sort();

/**
 * The free picks `id` has left: none before `open_recipes`, and none for anyone who already knows
 * everything.
 */
export function picksLeft(state: WorldState, id: ResidentId): number {
  if (knowsEverything(state, id)) return 0;
  const used = own(state.recipes?.picks, id) ?? 0;
  return Math.max(0, RECIPES_RULES.starterPicks - used);
}

/** `how to make wells`, for messages. */
const howToMake = (recipe: RecipeName) =>
  Object.hasOwn(CATALOG, recipe)
    ? `how to make ${ITEM_INFO[recipe as CraftKind].plural.toLowerCase()}`
    : `the ${recipe} recipe`;

/** When a seasonal card is next on the shelf, or nothing when it's there today. */
function shelfWhen(recipe: RecipeName, day: number): string {
  const season = cardSeason(recipe);
  if (!season || season === seasonOf(day)) return "";
  const name = ITEM_INFO[recipe as CraftKind].name.toLowerCase();
  return `The shop has the ${name} card only in ${season}, which starts on ${dayName(nextSeasonStart(season, day))} (UTC). `;
}

/**
 * Every way `id` can learn `recipe` today, in words: a free pick while they have one and the card
 * is on the shelf, and the card itself, with its price and sku.
 */
function waysToLearn(state: WorldState, id: ResidentId, recipe: RecipeName, day: number): string {
  const sku = cardSku(recipe);
  const price = coins(recipeCardPrice(recipe));
  const card = `buy its card at the town shop (${price}, shop_buy with sku ${sku})`;
  const left = picksLeft(state, id);
  if (!onShelf(recipe, day)) {
    return `${shelfWhen(recipe, day)}Then you can ${left > 0 ? `pick it with a free pick (pick_recipe), or ` : ""}${card}.`;
  }
  if (left > 0) {
    const pick = left === 1 ? "your last free pick" : `one of your ${left} free picks`;
    return `Pick it with ${pick} (pick_recipe with recipe ${recipe}), or ${card}.`;
  }
  return `${card.charAt(0).toUpperCase()}${card.slice(1)}.`;
}

/**
 * Why `id` can't make `kind` because they don't know its recipe, or null when they know it. `craft`
 * asks after every check of its own and before it takes anything.
 */
export function recipeUnknown(
  state: WorldState,
  id: ResidentId,
  kind: CraftKind,
): Rejection | null {
  const recipe = recipeOf(kind);
  if (knows(state, id, recipe) || state.day === undefined) return null;
  return refuse(
    "recipe_unknown",
    `You don't know ${howToMake(recipe)} yet. ${waysToLearn(state, id, recipe, state.day)} GET /v1/inventory lists the recipes you know.`,
  );
}

// ---------- changing ----------

type Mutation = () => WorldEvent[];
export type RecipesChecked = Mutation | Rejection;

/** `open_recipes`, which only TOWN_ACTOR sends: everyone here now keeps every recipe. */
export function checkOpenRecipes(state: WorldState): RecipesChecked {
  return oneTimeSwitch({
    on: state.recipes,
    already: "Recipes are already learned in this world.",
    notYet: () =>
      state.shop ? null : refuse("not_due", "Recipes are learned once the town shop is open."),
    turnOn: () => {
      state.recipes = {
        everything: Object.keys(state.residents).sort(),
        learned: {},
        picks: {},
        townsfolkTaught: {},
      };
    },
    event: { type: "recipes_opened" },
  });
}

/** Add `recipe` to what `id` learned, keeping the list sorted. Call only when committing. */
function learn(recipes: RecipesState, id: ResidentId, recipe: RecipeName) {
  recipes.learned[id] = [...(own(recipes.learned, id) ?? []), recipe].sort();
}

/** The cards on today's shelf, for a message. */
const shelfList = (day: number) => shelfOn(day).join(", ");

/** `pick_recipe {recipe}`: learn a card from today's Recipes shelf with a free pick. */
export function checkPickRecipe(
  state: WorldState,
  actor: ResidentId,
  command: Extract<Command, { type: "pick_recipe" }>,
): RecipesChecked {
  const { recipes, day } = state;
  if (!recipes || day === undefined) {
    return refuse(
      "already_known",
      "Everyone knows every recipe in this world for now, so there's nothing to pick. GET /v1/inventory lists them.",
    );
  }
  if (!state.residents[actor]) return refuse("not_joined", "Join the world first.");
  const { recipe } = command;
  if (!isRecipeName(recipe)) {
    return refuse(
      "unknown_item",
      `There's no recipe by that name. The shop's Recipes shelf has today: ${shelfList(day)}.`,
    );
  }
  if (knows(state, actor, recipe)) {
    return refuse(
      "already_known",
      `You already know ${howToMake(recipe)}. GET /v1/inventory lists the recipes you know.`,
    );
  }
  const used = own(recipes.picks, actor) ?? 0;
  if (used >= RECIPES_RULES.starterPicks) {
    return refuse(
      "no_picks_left",
      `You've used all ${RECIPES_RULES.starterPicks} free picks. Buy a card at the town shop instead (shop_buy with sku ${cardSku(recipe)}, ${coins(recipeCardPrice(recipe))}).`,
    );
  }
  if (!onShelf(recipe, day)) {
    return refuse(
      "out_of_season",
      `${shelfWhen(recipe, day)}Pick from the cards on the shelf today: ${shelfList(day)}.`,
    );
  }
  return () => {
    learn(recipes, actor, recipe);
    recipes.picks[actor] = used + 1;
    return [{ type: "recipe_learned", residentId: actor, recipe, how: "picked" }];
  };
}

/**
 * `shop_buy {sku: "recipe:<name>"}` once recipes are open: a recipe card, one at a time, learned
 * on the spot. The shop's split applies: the treasury's share, and the rest burned.
 */
export function checkBuyCard(
  state: WorldState,
  actor: ResidentId,
  command: Extract<Command, { type: "shop_buy" }>,
): RecipesChecked {
  const open = opened(state, actor);
  if ("code" in open) return open;
  const recipes = state.recipes;
  if (!recipes) return refuse("shop_closed", "The shop's Recipes shelf isn't open yet.");
  const { econ, day } = open;
  const recipe = cardOf(command.sku);
  if (!recipe) {
    return refuse(
      "unknown_item",
      `The shop has no card by that name. Its Recipes shelf has today: ${shelfOn(day).map(cardSku).join(", ")}.`,
    );
  }
  if (command.count !== undefined && command.count !== 1) {
    return refuse("invalid_amount", "A recipe card is learned once. Leave out count.");
  }
  if (knows(state, actor, recipe)) {
    return refuse(
      "already_known",
      `You already know ${howToMake(recipe)}, so its card would teach you nothing.`,
    );
  }
  if (!onShelf(recipe, day)) {
    return refuse(
      "out_of_season",
      `${shelfWhen(recipe, day)}GET /v1/shop lists the cards on the shelf today.`,
    );
  }
  const price = recipeCardPrice(recipe);
  const have = econ.coins[actor] ?? 0;
  if (have < price) {
    // The allowance pays after a command commits, so a purchase can't count on it: say so.
    const tip = allowanceDue(state, actor)
      ? "Today's allowance is waiting: send home first."
      : "Come home each day for your allowance.";
    return refuse(
      "not_enough_coins",
      `That card is ${coins(price)}, and you have ${coins(have)}. ${tip}`,
    );
  }
  const at = { seq: state.seq + 1, day };
  const toTreasury = Math.floor((price * treasuryShareOf(state)) / 100);
  return () => {
    const events: WorldEvent[] = [movePurse(econ, actor, -price, "shop", at)];
    // The treasury's history is public, so its share is a line that doesn't say who bought.
    if (toTreasury > 0) events.push(moveTreasury(econ, toTreasury, "shop", at));
    econ.burned += price - toTreasury;
    learn(recipes, actor, recipe);
    events.push({ type: "recipe_learned", residentId: actor, recipe, how: "bought", price });
    return events;
  };
}

/** The last day a seasonal card is on the shelf this season, for views. */
export const cardLastDay = (recipe: RecipeName, day: number): number | undefined =>
  cardSeason(recipe) ? seasonLastDay(day) : undefined;
