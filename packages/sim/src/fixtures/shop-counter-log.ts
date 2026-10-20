import type { Input } from "../types";
import { TOWN_ACTOR } from "../types";
import { SHOP_CONFIG, SHOP_LOG } from "./shop-log";

/**
 * The shop world on both sides of `shop_in_person` ([RFC 0042](../../../../docs/rfcs/0042-actions-that-need-you-there.md)).
 * Ada buys a fence post from her own hearth, which is how the shop served everyone before the
 * switch, then the server logs it and she walks the nine steps out of her hut and across to the
 * counter at (12, 14) before buying another. The walk is what the rule is for, so the log holds it
 * a step at a time. `shop.test.ts` replays this and checks the hash pinned below, so a change to
 * where the shop stands, to reach, or to the counter rule fails loudly, and every older fixture,
 * with its purchases from anywhere, hashes as before.
 */
export const SHOP_COUNTER_CONFIG = SHOP_CONFIG;

const town = (command: Input["command"]): Input => ({ actor: TOWN_ACTOR, command });
const ada = (command: Input["command"]): Input => ({ actor: "ada", command });

export const SHOP_COUNTER_LOG: Input[] = [
  ...SHOP_LOG,
  town({ type: "new_day", day: 20_015 }),
  // Home for the allowance, then a purchase from the hearth: the shop reached everywhere.
  ada({ type: "home" }),
  ada({ type: "shop_buy", sku: "fence", count: 1 }),
  town({ type: "shop_in_person" }),
  // Out through the hut's doorway, then across the square to the counter.
  ...(["s", "s", "s", "e", "se", "se", "se", "se", "se"] as const).map((dir) =>
    ada({ type: "move", dir }),
  ),
  ada({ type: "shop_buy", sku: "fence", count: 1 }),
];

/** Pinned in `shop.test.ts`. */
export const SHOP_COUNTER_HASH = "235014b9";
