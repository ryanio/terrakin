import type { Input } from "../types";
import { TOWN_ACTOR } from "../types";
import { ITEMS_CONFIG, ITEMS_LOG } from "./items-log";

/**
 * The items world on both sides of `open_gifts`. Ada gives Bob a tomato seed, which keeps no gift
 * record, so nothing could send it back. The server then logs the switch, Ada gives him an herb
 * seed, which is kept as `gift_1`, and Bob sends it back to her. `items.test.ts` replays it and
 * checks the hash pinned below, so a change to which gives are kept fails loudly. Every older
 * fixture hashes as before.
 */
export const GIFTS_CONFIG = ITEMS_CONFIG;

const town = (command: Input["command"]): Input => ({ actor: TOWN_ACTOR, command });
const ada = (command: Input["command"]): Input => ({ actor: "ada", command });

export const GIFTS_LOG: Input[] = [
  ...ITEMS_LOG,
  ada({ type: "give", item: "tomato_seed", to: "bob" }),
  town({ type: "open_gifts" }),
  ada({ type: "give", item: "herb_seed", to: "bob" }),
  { actor: "bob", command: { type: "decline_gift", gift: "gift_1" } },
];

/** `hashWorld(replay(GIFTS_CONFIG, GIFTS_LOG))`, pinned when this fixture landed. */
export const GIFTS_HASH = "1209b99c";
