import type { Input } from "../types";
import { TOWN_ACTOR } from "../types";
import { MARKET_CONFIG, MARKET_LOG } from "./market-log";

/**
 * The market world on both sides of `name_sales`. Ada sells Bob two sugar at the market, and
 * her purse line says only that something sold. The town then logs the switch: Ada sells Bob two
 * more, and Cy sells the town a bouquet by its id, and both of those lines keep the kind and
 * count. `shop.test.ts` replays it to the hash pinned below, so a change to which sales keep what
 * they sold fails loudly. Every older fixture hashes as before.
 */
export const NAMED_SALES_CONFIG = MARKET_CONFIG;

const town = (command: Input["command"]): Input => ({ actor: TOWN_ACTOR, command });

export const NAMED_SALES_LOG: Input[] = [
  ...MARKET_LOG,
  { actor: "ada", command: { type: "list_item", item: "sugar", count: 2, price: 4 } },
  { actor: "bob", command: { type: "buy_listing", listing: "l_3" } },
  town({ type: "name_sales" }),
  { actor: "ada", command: { type: "list_item", item: "sugar", count: 2, price: 4 } },
  { actor: "bob", command: { type: "buy_listing", listing: "l_4" } },
  { actor: "cy", command: { type: "sell_to_town", item: "i_2" } },
];

/** `hashWorld(replay(NAMED_SALES_CONFIG, NAMED_SALES_LOG))`, pinned when sales were named. */
export const NAMED_SALES_HASH = "d7e7aa8c";
