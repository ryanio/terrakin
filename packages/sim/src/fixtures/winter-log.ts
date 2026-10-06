import type { Input } from "../types";
import { TOWN_ACTOR } from "../types";
import { HALLOWEEN_CONFIG, HALLOWEEN_LOG } from "./halloween-log";

/**
 * The Halloween world's first winter (RFC 0017). Day 20423 is 2025-12-01, the first day of winter:
 * Ada buys cranberry seeds and plants them, plants a lemon beside them, and buys a snowman and puts
 * it up by her door. Dee buys a string of lights and a sled and puts them up, and Bob buys a little
 * fir. Four days on, Ada picks her cranberries and her lemons, makes cranberry jam and hot
 * cranberry punch, sells both and a cranberry to the town, and plants again. Day 20443 is December
 * 21, the first day of Midwinter (RFC 0022): Ada makes five candy canes and gives Bob two, and Dee
 * buys three at the shop. Day 20513 is 2026-03-01, spring: the shop has stopped selling winter's
 * stock and the town has stopped buying cranberries, but Ada still picks, plants a seed she held,
 * makes jam and candy canes, and moves her snowman. `winter.test.ts` checks the hash pinned below,
 * so a change to a winter number or rule that would replay the real log differently fails loudly.
 */
export const WINTER_CONFIG = HALLOWEEN_CONFIG;

const town = (command: Input["command"]): Input => ({ actor: TOWN_ACTOR, command });

export const WINTER_LOG: Input[] = [
  ...HALLOWEEN_LOG,
  town({ type: "new_day", day: 20_423 }),
  { actor: "ada", command: { type: "home" } },
  { actor: "ada", command: { type: "shop_buy", sku: "cranberry_seed", count: 2 } },
  { actor: "ada", command: { type: "plant", x: 2, y: 2, seed: "cranberry" } },
  { actor: "ada", command: { type: "plant", x: 4, y: 4, seed: "cranberry" } },
  { actor: "ada", command: { type: "place", x: 2, y: 3, block: "planter" } },
  { actor: "ada", command: { type: "plant", x: 2, y: 3, seed: "lemon" } },
  { actor: "ada", command: { type: "shop_buy", sku: "snowman" } },
  { actor: "ada", command: { type: "place", x: 6, y: 6, block: "snowman" } },
  { actor: "dee", command: { type: "home" } },
  { actor: "dee", command: { type: "shop_buy", sku: "string_lights" } },
  { actor: "dee", command: { type: "place", x: 14, y: 5, block: "string_lights" } },
  { actor: "dee", command: { type: "shop_buy", sku: "sled" } },
  { actor: "dee", command: { type: "place", x: 8, y: 6, block: "sled" } },
  { actor: "bob", command: { type: "home" } },
  { actor: "bob", command: { type: "shop_buy", sku: "little_fir" } },
  { actor: "bob", command: { type: "place", x: 22, y: 6, block: "little_fir" } },
  // Cranberries and lemons take four days.
  town({ type: "new_day", day: 20_427 }),
  { actor: "ada", command: { type: "harvest", x: 2, y: 2 } },
  { actor: "ada", command: { type: "harvest", x: 4, y: 4 } },
  { actor: "ada", command: { type: "harvest", x: 2, y: 3 } },
  { actor: "ada", command: { type: "craft", recipe: "cranberry_jam", x: 4, y: 2 } },
  {
    actor: "ada",
    command: { type: "craft", recipe: "cranberry_punch", x: 4, y: 2, label: "Snow day" },
  },
  { actor: "ada", command: { type: "sell_to_town", item: "cranberry_jam" } },
  { actor: "ada", command: { type: "sell_to_town", item: "cranberry_punch" } },
  { actor: "ada", command: { type: "sell_to_town", item: "cranberry" } },
  { actor: "ada", command: { type: "plant", x: 2, y: 2, seed: "cranberry" } },
  { actor: "ada", command: { type: "plant", x: 4, y: 4, seed: "cranberry" } },
  // Midwinter.
  town({ type: "new_day", day: 20_443 }),
  { actor: "ada", command: { type: "home" } },
  { actor: "ada", command: { type: "craft", recipe: "candy_cane", x: 4, y: 2 } },
  { actor: "ada", command: { type: "give", item: "candy_cane", to: "bob", count: 2 } },
  { actor: "dee", command: { type: "home" } },
  { actor: "dee", command: { type: "shop_buy", sku: "candy_cane", count: 3 } },
  // Spring: what Ada already has keeps working.
  town({ type: "new_day", day: 20_513 }),
  { actor: "ada", command: { type: "home" } },
  { actor: "ada", command: { type: "harvest", x: 2, y: 2 } },
  { actor: "ada", command: { type: "plant", x: 2, y: 2, seed: "cranberry" } },
  { actor: "ada", command: { type: "craft", recipe: "cranberry_jam", x: 4, y: 2 } },
  { actor: "ada", command: { type: "craft", recipe: "candy_cane", x: 4, y: 2 } },
  { actor: "ada", command: { type: "remove", x: 6, y: 6 } },
  { actor: "ada", command: { type: "place", x: 6, y: 5, block: "snowman" } },
];

/** `hashWorld(replay(WINTER_CONFIG, WINTER_LOG))`, pinned when winter landed. */
export const WINTER_HASH = "8402a298";
