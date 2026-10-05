import type { Input } from "../types";
import { TOWN_ACTOR } from "../types";
import { PRE_ECONOMY_CONFIG, PRE_ECONOMY_LOG } from "./pre-economy-log";

/**
 * The pre-economy world after coins open: owner pairs and maintainers, a welcome gift, allowances,
 * townsfolk budgets and tips, gifts inside and outside a pair, a budget returned at `new_day`,
 * and one handed back when a resident leaves the townsfolk. `economy.test.ts` replays it and
 * checks the hash pinned below, so once coins are live a change to `ECONOMY` or to a coin rule
 * that would replay the real log differently fails loudly.
 */
export const POST_ECONOMY_CONFIG = PRE_ECONOMY_CONFIG;

const DAY = 20_000;
const town = (command: Input["command"]): Input => ({ actor: TOWN_ACTOR, command });

export const POST_ECONOMY_LOG: Input[] = [
  ...PRE_ECONOMY_LOG,
  town({ type: "set_owner_pairs", pairs: [["bob", "ada"]] }),
  town({ type: "set_maintainers", ids: ["cy"] }),
  town({ type: "open_economy" }),
  { actor: "dee", command: { type: "join", name: "Dee", kind: "human" } },
  { actor: "dee", command: { type: "settle", px: 1, py: 0 } },
  { actor: "dee", command: { type: "build_starter_home" } },
  { actor: "ada", command: { type: "home" } },
  town({ type: "new_day", day: DAY + 6 }),
  { actor: "clem", command: { type: "give_coins", to: "dee", amount: 20, note: "welcome!" } },
  { actor: "clem", command: { type: "give_coins", to: "ada", amount: 25 } },
  { actor: "ada", command: { type: "home" } },
  { actor: "bob", command: { type: "join", name: "Bob", kind: "agent" } },
  { actor: "ada", command: { type: "give_coins", to: "bob", amount: 40, note: "for you" } },
  { actor: "ada", command: { type: "give_coins", to: "dee", amount: 5 } },
  { actor: "dee", command: { type: "give_coins", to: "ada", amount: 1 } },
  town({ type: "new_day", day: DAY + 7 }),
  { actor: "dee", command: { type: "move", dir: "s" } },
  { actor: "dee", command: { type: "move", dir: "n" } },
  town({ type: "set_townsfolk", ids: [] }),
];

/** `hashWorld(replay(POST_ECONOMY_CONFIG, POST_ECONOMY_LOG))`, pinned when coins landed. */
export const POST_ECONOMY_HASH = "8013bd6c";
