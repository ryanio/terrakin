import type { Input } from "../types";
import { TOWN_ACTOR } from "../types";
import { MARKET_CONFIG, MARKET_LOG } from "./market-log";

/**
 * The market world with pets (RFC 0019): Ada adopts a cat, fixes its name at once, and grooms it
 * into a new coat; Bob adopts a tortoise. Three days on, Ada picks strawberries, gives her own cat
 * one, and Bob one; Bob, brought back by acting once presence comes with it, treats Ada's cat the
 * next day, after she renames it again. Ada leaves and comes back, and her cat comes with her.
 * `pets.test.ts` checks the hash pinned below, so a change to a pet rule or number that would
 * replay the real log differently fails loudly. Every older fixture hashes as before.
 */
export const PETS_CONFIG = MARKET_CONFIG;

const DAY = 20_000;
const town = (command: Input["command"]): Input => ({ actor: TOWN_ACTOR, command });

export const PETS_LOG: Input[] = [
  ...MARKET_LOG,
  { actor: "ada", command: { type: "adopt_pet", kind: "cat", coat: "ginger", name: "Biscut" } },
  // A new pet can be renamed right away, so a typo is fixed for free.
  { actor: "ada", command: { type: "rename_pet", name: "Biscuit" } },
  { actor: "ada", command: { type: "groom_pet", coat: "tabby" } },
  { actor: "bob", command: { type: "adopt_pet", kind: "tortoise", coat: "star", name: "Shelly" } },
  { actor: "ada", command: { type: "plant", x: 2, y: 2, seed: "strawberry" } },
  // Strawberries take three days.
  town({ type: "new_day", day: DAY + 18 }),
  { actor: "ada", command: { type: "harvest", x: 2, y: 2 } },
  { actor: "ada", command: { type: "treat_pet", owner: "ada", item: "strawberry" } },
  { actor: "ada", command: { type: "treat_pet", owner: "bob", item: "strawberry" } },
  { actor: "ada", command: { type: "give", item: "strawberry", to: "bob" } },
  { actor: "ada", command: { type: "leave" } },
  { actor: "ada", command: { type: "join", name: "Ada", kind: "human" } },
  town({ type: "new_day", day: DAY + 19 }),
  { actor: "ada", command: { type: "rename_pet", name: "Biscuit the Brave" } },
  town({ type: "implicit_presence" }),
  town({ type: "leave_idle", ids: ["bob"] }),
  { actor: "bob", command: { type: "treat_pet", owner: "ada", item: "strawberry" } },
];

/** `hashWorld(replay(PETS_CONFIG, PETS_LOG))`, pinned when pets landed. */
export const PETS_HASH = "ee995e7b";
