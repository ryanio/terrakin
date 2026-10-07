import type { Input } from "../types";
import { TOWN_ACTOR } from "../types";
import { SHOP_CONFIG, SHOP_LOG } from "./shop-log";

/**
 * The shop world with repeat records of a name from before names were unique (issue #46), cleared
 * by `retire_repeat_joins` (decision 0230). Pip used the first of three records; nobody used
 * either Blaze; an unused "annals" shares its name with Annals, who walked. Recipes open while
 * they're all here, so they're in `everything`, and one more Blaze record joins on the day they go,
 * so it's among the day's newcomers. The town retires every unused record but the first Blaze, and
 * Eve joins and walks after. `repeat-joins.test.ts` replays it and checks the hash pinned below.
 */
export const REPEAT_JOINS_CONFIG = SHOP_CONFIG;

const DAY = 20_000;
const town = (command: Input["command"]): Input => ({ actor: TOWN_ACTOR, command });
/** A record joined and left again, never used. */
const unused = (actor: string, name: string, kind: "human" | "agent" = "agent"): Input[] => [
  { actor, command: { type: "join", name, kind } },
  { actor, command: { type: "leave" } },
];

export const REPEAT_JOINS_LOG: Input[] = [
  ...SHOP_LOG,
  { actor: "r_pip", command: { type: "join", name: "Pip", kind: "agent" } },
  { actor: "r_pip", command: { type: "move", dir: "e" } },
  { actor: "r_pip", command: { type: "leave" } },
  ...unused("r_pip2", "Pip"),
  ...unused("r_pip3", "pip"),
  ...unused("r_blaze", "Blaze"),
  ...unused("r_blaze2", "Blaze"),
  ...unused("r_annals", "annals", "human"),
  { actor: "r_annals2", command: { type: "join", name: "Annals", kind: "agent" } },
  { actor: "r_annals2", command: { type: "move", dir: "w" } },
  { actor: "r_annals2", command: { type: "leave" } },
  town({ type: "open_recipes" }),
  town({ type: "new_day", day: DAY + 15 }),
  ...unused("r_blaze3", "Blaze"),
  town({
    type: "retire_repeat_joins",
    ids: ["r_annals", "r_blaze2", "r_blaze3", "r_pip2", "r_pip3"],
  }),
  { actor: "eve", command: { type: "join", name: "Eve", kind: "human" } },
  { actor: "eve", command: { type: "move", dir: "s" } },
  town({ type: "new_day", day: DAY + 16 }),
];

/** `hashWorld(replay(REPEAT_JOINS_CONFIG, REPEAT_JOINS_LOG))`, pinned when the switch landed. */
export const REPEAT_JOINS_HASH = "1d8e2515";
