import type { Input } from "../types";
import { TOWN_ACTOR } from "../types";
import { ITEMS_CONFIG, ITEMS_LOG } from "./items-log";

/**
 * The items world on both sides of `raise_inventory` (decision 0388). On day 20012 Ada holds 199
 * things, so coming home brings 1 bag of sugar of the pantry's 2 and leaves her at the old cap of
 * 200. The server logs the switch, and on day 20013 her pantry gives in full (2 sugar, 2 jars) and
 * a grant of 196 herbs takes her to the new cap of 400. `items.test.ts` replays it and checks the
 * hash pinned below, so a change to either cap, or to which inputs read which, fails loudly.
 */
export const RAISED_INVENTORY_CONFIG = ITEMS_CONFIG;

const town = (command: Input["command"]): Input => ({ actor: TOWN_ACTOR, command });

export const RAISED_INVENTORY_LOG: Input[] = [
  ...ITEMS_LOG,
  town({ type: "new_day", day: 20012 }),
  town({ type: "test_grant", to: "ada", stacks: { herb: 178 } }),
  { actor: "ada", command: { type: "home" } },
  town({ type: "raise_inventory" }),
  town({ type: "new_day", day: 20013 }),
  { actor: "ada", command: { type: "home" } },
  town({ type: "test_grant", to: "ada", stacks: { herb: 196 } }),
];

/** `hashWorld(replay(RAISED_INVENTORY_CONFIG, RAISED_INVENTORY_LOG))`, pinned when the cap rose. */
export const RAISED_INVENTORY_HASH = "6ff3b1b1";
