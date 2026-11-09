import type { Input } from "../types";
import { TOWN_ACTOR } from "../types";
import { HALLOWEEN_CONFIG, HALLOWEEN_LOG } from "./halloween-log";

/**
 * The Halloween world on both sides of `lower_holiday_prices` (decision 0210). On the next
 * Halloween's first day Ada buys bat bunting at decision 0107's price, 12 coins. The server then
 * logs the switch, and her second bunting costs the catalog's 6. `shop.test.ts` replays it and
 * checks the hash pinned below, so a change to which purchases pay which price fails loudly.
 * Every older fixture hashes as before.
 */
export const HOLIDAY_PRICES_CONFIG = HALLOWEEN_CONFIG;

const town = (command: Input["command"]): Input => ({ actor: TOWN_ACTOR, command });
const ada = (command: Input["command"]): Input => ({ actor: "ada", command });

export const HOLIDAY_PRICES_LOG: Input[] = [
  ...HALLOWEEN_LOG,
  town({ type: "new_day", day: 20_750 }),
  ada({ type: "home" }),
  ada({ type: "shop_buy", sku: "bat_bunting" }),
  town({ type: "lower_holiday_prices" }),
  ada({ type: "shop_buy", sku: "bat_bunting" }),
];

/** `hashWorld(replay(HOLIDAY_PRICES_CONFIG, HOLIDAY_PRICES_LOG))`, pinned when this fixture landed. */
export const HOLIDAY_PRICES_HASH = "aa60719f";
