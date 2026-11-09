import type { Input } from "../types";
import { TOWN_ACTOR } from "../types";
import { SHOP_CONFIG, SHOP_LOG } from "./shop-log";

/**
 * The shop world on both sides of `set_shop_share` (decision 0052). Ada buys four fence posts at
 * the share the shop opened with, so half of their 12 coins go to the treasury and half are
 * burned. The server then logs a 5% share, and the same purchase again sends the treasury nothing
 * (5% of 12 rounds down to 0) and burns all 12.
 * `shop.test.ts` replays it and checks the hash pinned below, so a change to which purchases read
 * which share fails loudly. Every older fixture hashes as before.
 */
export const SHOP_SHARE_CONFIG = SHOP_CONFIG;

const town = (command: Input["command"]): Input => ({ actor: TOWN_ACTOR, command });
const ada = (command: Input["command"]): Input => ({ actor: "ada", command });

export const SHOP_SHARE_LOG: Input[] = [
  ...SHOP_LOG,
  ada({ type: "home" }),
  ada({ type: "shop_buy", sku: "fence", count: 4 }),
  town({ type: "set_shop_share", percent: 5 }),
  ada({ type: "shop_buy", sku: "fence", count: 4 }),
];

/** `hashWorld(replay(SHOP_SHARE_CONFIG, SHOP_SHARE_LOG))`, pinned when this fixture landed. */
export const SHOP_SHARE_HASH = "555cb925";
