import type { Input } from "../types";
import { TOWN_ACTOR } from "../types";
import { SHOP_CONFIG, SHOP_LOG } from "./shop-log";

/**
 * The shop world after recipes open (RFC 0024): everyone living there keeps every recipe, and Eve,
 * who moves in after, starts with the base and the holiday recipes. She picks three cards from the
 * autumn shelf (lemonade, pumpkin pie, and a well), buys the herb sachet card, grows herbs and
 * flowers, and makes herb tea (the base) and a herb sachet (the card she bought). `recipes.test.ts`
 * replays it and checks the hash pinned below, so once recipes are live a change to the base, the
 * shelf, a card's price, or a recipe rule that would replay the real log differently fails loudly.
 */
export const RECIPES_CONFIG = SHOP_CONFIG;

const DAY = 20_000;
const town = (command: Input["command"]): Input => ({ actor: TOWN_ACTOR, command });
const eve = (command: Input["command"]): Input => ({ actor: "eve", command });

export const RECIPES_LOG: Input[] = [
  ...SHOP_LOG,
  // Day 20014, in autumn: Ada, Bob, Clem, Cy, and Dee live here, so they keep every recipe.
  town({ type: "open_recipes" }),
  eve({ type: "join", name: "Eve", kind: "human" }),
  eve({ type: "settle", px: 0, py: 1 }),
  eve({ type: "build_starter_home" }),
  // Stepping off her hearth and back brings her starter kit and her allowance.
  eve({ type: "move", dir: "s" }),
  eve({ type: "move", dir: "n" }),
  eve({ type: "pick_recipe", recipe: "lemonade" }),
  eve({ type: "pick_recipe", recipe: "pumpkin_pie" }),
  eve({ type: "shop_buy", sku: "recipe:herb_sachet" }),
  eve({ type: "place", x: 2, y: 10, block: "planter" }),
  eve({ type: "place", x: 2, y: 11, block: "planter" }),
  eve({ type: "place", x: 2, y: 12, block: "planter" }),
  eve({ type: "place", x: 4, y: 10, block: "kitchen" }),
  eve({ type: "place", x: 4, y: 12, block: "workbench" }),
  eve({ type: "plant", x: 2, y: 10, seed: "herb" }),
  eve({ type: "plant", x: 2, y: 11, seed: "herb" }),
  eve({ type: "plant", x: 2, y: 12, seed: "flower" }),
  town({ type: "new_day", day: DAY + 16 }),
  eve({ type: "home" }),
  eve({ type: "harvest", x: 2, y: 10 }),
  eve({ type: "harvest", x: 2, y: 11 }),
  eve({ type: "harvest", x: 2, y: 12 }),
  eve({ type: "craft", recipe: "herb_tea", x: 4, y: 10, label: "Garden" }),
  eve({ type: "craft", recipe: "herb_sachet", x: 4, y: 12 }),
  eve({ type: "pick_recipe", recipe: "well" }),
  town({ type: "new_day", day: DAY + 17 }),
];

/** `hashWorld(replay(RECIPES_CONFIG, RECIPES_LOG))`, pinned when recipes landed. */
export const RECIPES_HASH = "c483537b";
