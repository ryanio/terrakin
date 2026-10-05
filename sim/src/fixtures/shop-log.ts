import type { Input } from "../types";
import { TOWN_ACTOR } from "../types";
import { ITEMS_CONFIG, ITEMS_LOG } from "./items-log";

/**
 * The items world after the town shop opens (RFC 0008, phase 2): fence posts
 * bought, placed, and taken back up, an umbrella bought and worn, and herbs sold to the town on a
 * day it buys them. `shop.test.ts` replays it and checks the hash pinned below, so once the shop is
 * live a change to the catalog, the buy orders, the rotation, or a shop rule that would replay the
 * real log differently fails loudly.
 */
export const SHOP_CONFIG = ITEMS_CONFIG;

const DAY = 20_000;
const town = (command: Input["command"]): Input => ({ actor: TOWN_ACTOR, command });

export const SHOP_LOG: Input[] = [
  ...ITEMS_LOG,
  town({ type: "open_shop" }),
  // Day 20013: the town buys herb sachets, lemon jam, tomato sauce, and herbs.
  town({ type: "new_day", day: DAY + 13 }),
  { actor: "ada", command: { type: "home" } },
  { actor: "ada", command: { type: "shop_buy", sku: "fence", count: 2 } },
  { actor: "ada", command: { type: "place", x: 2, y: 4, block: "fence" } },
  { actor: "ada", command: { type: "place", x: 3, y: 4, block: "fence" } },
  { actor: "ada", command: { type: "remove", x: 3, y: 4 } },
  { actor: "ada", command: { type: "sell_to_town", item: "herb" } },
  // Ada and Bob are a pair, so her gift skips the caps and gets him to the umbrella's price.
  { actor: "ada", command: { type: "give_coins", to: "bob", amount: 20 } },
  { actor: "bob", command: { type: "shop_buy", sku: "umbrella" } },
  { actor: "bob", command: { type: "profile", wear: ["umbrella"] } },
  town({ type: "new_day", day: DAY + 14 }),
];

/** `hashWorld(replay(SHOP_CONFIG, SHOP_LOG))`, pinned when the shop landed. */
export const SHOP_HASH = "53fd259a";
