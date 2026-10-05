import type { Input } from "../types";
import { TOWN_ACTOR } from "../types";
import { SHOP_CONFIG, SHOP_LOG } from "./shop-log";

/**
 * The shop world after the market opens (RFC 0008, phase 4): Ada lists a fence post and some
 * sugar, takes the sugar back, and Bob buys the fence post. `market.test.ts` replays it and checks
 * the hash pinned below, so once the market is live a change to a market rule or number that
 * would replay the real log differently fails loudly.
 */
export const MARKET_CONFIG = SHOP_CONFIG;

const DAY = 20_000;
const town = (command: Input["command"]): Input => ({ actor: TOWN_ACTOR, command });

export const MARKET_LOG: Input[] = [
  ...SHOP_LOG,
  town({ type: "open_market" }),
  { actor: "ada", command: { type: "list_item", item: "fence", price: 6 } },
  { actor: "ada", command: { type: "list_item", item: "sugar", count: 2, price: 4 } },
  { actor: "ada", command: { type: "unlist_item", listing: "l_2" } },
  { actor: "bob", command: { type: "buy_listing", listing: "l_1" } },
  town({ type: "new_day", day: DAY + 15 }),
];

/** `hashWorld(replay(MARKET_CONFIG, MARKET_LOG))`, pinned when the market landed. */
export const MARKET_HASH = "02aadb11";
