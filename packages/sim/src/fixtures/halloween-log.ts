import type { Input } from "../types";
import { TOWN_ACTOR } from "../types";
import { AUTUMN_CONFIG, AUTUMN_LOG } from "./autumn-log";

/**
 * The autumn world's next Halloween (RFC 0022). Day 20385 is 2025-10-24, the first day of
 * Halloween: Ada buys cat ears and puts them on, picks the pumpkin she planted last winter, makes
 * five candies at her kitchen, and gives Bob two. Dee buys a candy bowl, three candies, and some
 * bat bunting, and puts the bowl and the bunting up. Day 20392 is October 31: Dee goes away, and
 * Ada knocks at her door (Dee's bowl hands out Dee's candy) and at Cy's (nobody there has any, so
 * the town gives one). Dee comes back and knocks at Bob's door, where Bob is home with candy. Day
 * 20394 is November 2: the night's knocks are gone, Ada still wears her cat ears, and candy still
 * comes out of her kitchen. `halloween.test.ts` checks the hash pinned below, so a change to a
 * Halloween number or rule that would replay the real log differently fails loudly.
 */
export const HALLOWEEN_CONFIG = AUTUMN_CONFIG;

const town = (command: Input["command"]): Input => ({ actor: TOWN_ACTOR, command });

export const HALLOWEEN_LOG: Input[] = [
  ...AUTUMN_LOG,
  town({ type: "new_day", day: 20_385 }),
  { actor: "ada", command: { type: "home" } },
  { actor: "ada", command: { type: "shop_buy", sku: "cat_ears" } },
  { actor: "ada", command: { type: "profile", wear: ["cat_ears"] } },
  { actor: "ada", command: { type: "harvest", x: 2, y: 2 } },
  { actor: "ada", command: { type: "craft", recipe: "candy", x: 4, y: 2 } },
  { actor: "ada", command: { type: "give", item: "candy", to: "bob", count: 2 } },
  { actor: "dee", command: { type: "home" } },
  { actor: "dee", command: { type: "shop_buy", sku: "candy_bowl" } },
  { actor: "dee", command: { type: "place", x: 12, y: 4, block: "candy_bowl" } },
  { actor: "dee", command: { type: "shop_buy", sku: "candy", count: 3 } },
  { actor: "dee", command: { type: "shop_buy", sku: "bat_bunting" } },
  { actor: "dee", command: { type: "place", x: 10, y: 4, block: "bat_bunting" } },
  // Trick-or-treat night.
  town({ type: "new_day", day: 20_392 }),
  { actor: "dee", command: { type: "leave" } },
  { actor: "ada", command: { type: "visit", px: 1, py: 0, x: 11, y: 0 } },
  { actor: "ada", command: { type: "trick_or_treat", px: 1, py: 0 } },
  { actor: "ada", command: { type: "visit", px: 0, py: 2, x: 3, y: 23 } },
  { actor: "ada", command: { type: "trick_or_treat", px: 0, py: 2 } },
  { actor: "dee", command: { type: "join", name: "Dee", kind: "human" } },
  { actor: "dee", command: { type: "visit", px: 2, py: 0, x: 19, y: 7 } },
  { actor: "dee", command: { type: "trick_or_treat", px: 2, py: 0 } },
  // After Halloween: what Ada bought is still hers, and candy is still a recipe.
  town({ type: "new_day", day: 20_394 }),
  { actor: "ada", command: { type: "home" } },
  { actor: "ada", command: { type: "profile", wear: [] } },
  { actor: "ada", command: { type: "profile", wear: ["cat_ears"] } },
  { actor: "ada", command: { type: "craft", recipe: "candy", x: 4, y: 2 } },
];

/** `hashWorld(replay(HALLOWEEN_CONFIG, HALLOWEEN_LOG))`, pinned when Halloween landed. */
export const HALLOWEEN_HASH = "f8bd7c3b";
