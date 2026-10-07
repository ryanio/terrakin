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
import { own, residentById } from "./own";
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
import type {
  Command,
  ItemsState,
  RecipesState,
  Rejection,
  ResidentId,
  WorldEvent,
  WorldState,
} from "./types";
import { chebyshev, walkHint } from "./world";

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
  /** Recipes each resident may teach a UTC day. A townsfolk's lessons aren't counted. */
  teachPerDay: 1,
  /** Recipes each resident may be taught a UTC day, by neighbors and townsfolk together. */
  taughtPerDay: 1,
  /** A townsfolk teaches each resident at most once in this many world days. */
  townsfolkEveryDays: 7,
  /** About one find in this many is a recipe page (`pageOn`). */
  pageOneIn: 20,
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

/**
 * The recipes a page on the ground can teach, frozen by name in the order `pageOn` counts them: a
 * logged `gather` of a page replays only while this list stays exactly as it is. Today it's every
 * card. A recipe added later is no page until a new list starts at a logged switch.
 */
export const PAGE_RECIPES = [
  "lemonade",
  "tomato_sauce",
  "herb_sachet",
  "flower_wreath",
  "pumpkin_pie",
  "pumpkin_soup",
  "bookshelf",
  "barrel",
  "signpost",
  "lamp_post",
  "well",
  "campfire",
  "flower_box",
  "cranberry_punch",
  "fried_minnows",
  "fish_stew",
] as const satisfies readonly RecipeName[];

/**
 * The roll for a recipe page on a tile and a day, a whole number below 2^32. Its own constants and
 * finalizer, so it never follows a tile's other rolls.
 */
function pageRoll(x: number, y: number, day: number): number {
  let h = (Math.imul(x, 0x5bd1e995) + Math.imul(y, 0x1b873593) + Math.imul(day, 0xcc9e2d51)) | 0;
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12;
  h = Math.imul(h, 0x297a2d39);
  h ^= h >>> 15;
  return h >>> 0;
}

/**
 * The recipe a find on (x, y) on `day` would be a page for, or null when it would stay a find:
 * about one in `RECIPES_RULES.pageOneIn`, each page recipe as likely. Pure, like the find itself,
 * so every client draws the same page and replay never needs it logged. Only asked once recipes
 * are learned and a find lies there.
 */
export function pageOn(x: number, y: number, day: number): RecipeName | null {
  const n = pageRoll(x, y, day) % (RECIPES_RULES.pageOneIn * PAGE_RECIPES.length);
  return n < PAGE_RECIPES.length ? (PAGE_RECIPES[n] as RecipeName) : null;
}

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
export const howToMake = (recipe: RecipeName) =>
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
  const others = otherWays(state, recipe);
  if (!onShelf(recipe, day)) {
    return `${shelfWhen(recipe, day)}Then you can ${left > 0 ? `pick it with a free pick (pick_recipe), or ` : ""}${card}.${others}`;
  }
  if (left > 0) {
    const pick = left === 1 ? "your last free pick" : `one of your ${left} free picks`;
    return `Pick it with ${pick} (pick_recipe with recipe ${recipe}), or ${card}.${others}`;
  }
  return `${card.charAt(0).toUpperCase()}${card.slice(1)}.${others}`;
}

/** The ways to learn that cost nothing and wait on someone or something: a lesson, and a page. */
function otherWays(state: WorldState, recipe: RecipeName): string {
  const reach = state.config.reach;
  const page = (PAGE_RECIPES as readonly string[]).includes(recipe)
    ? " Now and then a find on the ground is its recipe page, which teaches it when you gather it."
    : "";
  return ` Or ask a neighbor who knows it to teach you while you stand within ${reach} tiles of each other (they send teach).${page}`;
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
export function learn(recipes: RecipesState, id: ResidentId, recipe: RecipeName) {
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

/** Lessons `id` gave today, and lessons they were taught today. */
export const teachingToday = (state: WorldState, id: ResidentId): number =>
  own(state.items?.today.teaching, id) ?? 0;
export const taughtToday = (state: WorldState, id: ResidentId): number =>
  own(state.items?.today.taught, id) ?? 0;

/**
 * Whether a townsfolk may teach `id` on `day`: their last townsfolk lesson, if any, was at least
 * `RECIPES_RULES.townsfolkEveryDays` world days ago.
 */
export function townsfolkLessonDue(state: WorldState, id: ResidentId, day: number): boolean {
  const last = own(state.recipes?.townsfolkTaught, id);
  return last === undefined || day - last >= RECIPES_RULES.townsfolkEveryDays;
}

/**
 * What `teacher` could teach `learner` right now as far as knowing goes: every recipe the teacher
 * knows that the learner doesn't, past the base and the holiday recipes, in `RECIPE_NAMES` order.
 * Empty before recipes are learned, when everyone knows everything. Distance, being online, and
 * today's lessons are `teach`'s own checks.
 */
export function teachable(
  state: WorldState,
  teacher: ResidentId,
  learner: ResidentId,
): RecipeName[] {
  if (!state.recipes || teacher === learner) return [];
  return RECIPE_NAMES.filter(
    (r) => !knownByAll(r) && knows(state, teacher, r) && !knows(state, learner, r),
  );
}

/**
 * `teach {recipe, to}`: teach a recipe you know to a resident within reach who doesn't (RFC 0024).
 * Both must be online and within `config.reach` of each other. Each resident teaches
 * `RECIPES_RULES.teachPerDay` a day and is taught `taughtPerDay` a day. A townsfolk's lesson (the
 * server's townsfolk run sends them) isn't counted against the townsfolk, and comes to each
 * resident at most once in `townsfolkEveryDays` days.
 */
export function checkTeach(
  state: WorldState,
  actor: ResidentId,
  command: Extract<Command, { type: "teach" }>,
): RecipesChecked {
  const { recipes, day } = state;
  const items = state.items as ItemsState | undefined;
  if (!recipes || !items || day === undefined) {
    return refuse(
      "already_known",
      "Everyone knows every recipe in this world for now, so there's nothing to teach. GET /v1/inventory lists them.",
    );
  }
  const me = state.residents[actor];
  if (!me) return refuse("not_joined", "Join the world first.");
  const { recipe, to } = command;
  const reach = state.config.reach;
  if (!isRecipeName(recipe)) {
    return refuse(
      "unknown_item",
      "There's no recipe by that name. GET /v1/inventory lists the recipes you know.",
    );
  }
  if (knownByAll(recipe)) {
    return refuse(
      "already_known",
      `Everyone knows ${howToMake(recipe)} already, so there's nothing to teach.`,
    );
  }
  if (!knows(state, actor, recipe)) {
    return refuse(
      "recipe_unknown",
      `You don't know ${howToMake(recipe)} yet, so you can't teach it. GET /v1/inventory lists the recipes you know.`,
    );
  }
  if (to === actor) {
    return refuse(
      "already_known",
      `You already know ${howToMake(recipe)}. Teach a neighbor standing within ${reach} tiles of you: send teach with to set to their id.`,
    );
  }
  const them = residentById(state, to);
  if (!them) return refuse("unknown_resident", "Nobody in the world has that id.");
  if (!them.online) {
    return refuse(
      "not_joined",
      `${them.id} isn't in the world right now. You can teach someone only while you both stand within ${reach} tiles of each other.`,
    );
  }
  if (knows(state, them.id, recipe)) {
    return refuse("already_known", `${them.id} already knows ${howToMake(recipe)}.`);
  }
  if (chebyshev(me, them) > reach) {
    return refuse(
      "not_near",
      `${them.id} is more than ${reach} tiles away. Stand within ${reach} tiles of each other to teach.${walkHint(me, them, reach)}`,
    );
  }
  const townsfolk = isTownsfolk(state, actor);
  if (!townsfolk && teachingToday(state, actor) >= RECIPES_RULES.teachPerDay) {
    return refuse(
      "taught_today",
      `You've taught ${RECIPES_RULES.teachPerDay === 1 ? "a recipe" : `${RECIPES_RULES.teachPerDay} recipes`} today, all one day has. Teach again after midnight UTC.`,
    );
  }
  if (taughtToday(state, them.id) >= RECIPES_RULES.taughtPerDay) {
    return refuse(
      "taught_today",
      `${them.id} has learned a recipe from someone today already. Teach them after midnight UTC.`,
    );
  }
  if (townsfolk && !townsfolkLessonDue(state, them.id, day)) {
    return refuse(
      "taught_today",
      `${them.id} had a townsfolk's lesson in the last ${RECIPES_RULES.townsfolkEveryDays} days. A townsfolk teaches each resident once a week.`,
    );
  }
  const learner = them.id;
  return () => {
    learn(recipes, learner, recipe);
    items.today.taught ??= {};
    items.today.taught[learner] = taughtToday(state, learner) + 1;
    if (townsfolk) {
      recipes.townsfolkTaught[learner] = day;
    } else {
      items.today.teaching ??= {};
      items.today.teaching[actor] = teachingToday(state, actor) + 1;
    }
    return [{ type: "recipe_learned", residentId: learner, recipe, how: "taught", from: actor }];
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
