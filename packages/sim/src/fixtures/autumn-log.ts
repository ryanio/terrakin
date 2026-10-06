import type { Input } from "../types";
import { TOWN_ACTOR } from "../types";
import { MARKET_CONFIG, MARKET_LOG } from "./market-log";

/**
 * The market world through its first autumn (RFC 0017). Day 20016 is 2024-10-20: Ada buys pumpkin
 * seeds and a hay bale, plants a pumpkin and some herbs, and places the bale, and Dee buys a
 * scarecrow and puts it up. Five days on, Ada picks both, makes pumpkin soup, sells the soup and a
 * pumpkin to the town, and plants again. Day 20058 is 2024-12-01, winter: the shop has stopped
 * selling autumn's stock and the town has stopped buying pumpkins, but Ada still picks, bakes a
 * pie, plants a seed she held, and moves her hay bale. `seasons.test.ts` checks the hash pinned
 * below, so a change to autumn's numbers or a seasonal rule that would replay the real log
 * differently fails loudly.
 */
export const AUTUMN_CONFIG = MARKET_CONFIG;

const DAY = 20_000;
const town = (command: Input["command"]): Input => ({ actor: TOWN_ACTOR, command });

export const AUTUMN_LOG: Input[] = [
  ...MARKET_LOG,
  town({ type: "new_day", day: DAY + 16 }),
  { actor: "ada", command: { type: "home" } },
  { actor: "ada", command: { type: "shop_buy", sku: "pumpkin_seed", count: 2 } },
  { actor: "ada", command: { type: "plant", x: 2, y: 2, seed: "pumpkin" } },
  { actor: "ada", command: { type: "place", x: 4, y: 4, block: "planter" } },
  { actor: "ada", command: { type: "plant", x: 4, y: 4, seed: "herb" } },
  { actor: "ada", command: { type: "shop_buy", sku: "hay_bale" } },
  { actor: "ada", command: { type: "place", x: 2, y: 3, block: "hay_bale" } },
  { actor: "dee", command: { type: "shop_buy", sku: "scarecrow" } },
  { actor: "dee", command: { type: "place", x: 11, y: 4, block: "scarecrow" } },
  // Pumpkins take five days.
  town({ type: "new_day", day: DAY + 21 }),
  { actor: "ada", command: { type: "harvest", x: 2, y: 2 } },
  { actor: "ada", command: { type: "harvest", x: 4, y: 4 } },
  {
    actor: "ada",
    command: { type: "craft", recipe: "pumpkin_soup", x: 4, y: 2, label: "Harvest" },
  },
  { actor: "ada", command: { type: "sell_to_town", item: "pumpkin_soup" } },
  { actor: "ada", command: { type: "sell_to_town", item: "pumpkin" } },
  { actor: "ada", command: { type: "plant", x: 2, y: 2, seed: "pumpkin" } },
  // Winter: what Ada already has keeps working.
  town({ type: "new_day", day: DAY + 58 }),
  { actor: "ada", command: { type: "harvest", x: 2, y: 2 } },
  { actor: "ada", command: { type: "craft", recipe: "pumpkin_pie", x: 4, y: 2 } },
  { actor: "ada", command: { type: "plant", x: 2, y: 2, seed: "pumpkin" } },
  { actor: "ada", command: { type: "remove", x: 2, y: 3 } },
  { actor: "ada", command: { type: "place", x: 3, y: 2, block: "hay_bale" } },
];

/** `hashWorld(replay(AUTUMN_CONFIG, AUTUMN_LOG))`, pinned when autumn landed. */
export const AUTUMN_HASH = "2e3d1bda";
