import type { Input } from "../types";
import { TOWN_ACTOR } from "../types";
import { REPEAT_JOINS_CONFIG, REPEAT_JOINS_LOG } from "./repeat-joins-log";

/**
 * The repeat joins world with a duplicate record that was used, merged into the one that stays
 * (issue #46, decision 0239). A second Blaze record settles a plot (and gets the welcome gift),
 * takes coins from Ada and a grant of lemons and coins, buys an umbrella, and leaves. The town
 * merges it into the first Blaze: the plot goes back to the world, and the coins, lemons, and
 * umbrella go to the first Blaze, who comes in wearing it. `merge.test.ts` replays it and checks
 * the hash pinned below.
 */
export const MERGE_CONFIG = REPEAT_JOINS_CONFIG;

const DAY = 20_000;
const town = (command: Input["command"]): Input => ({ actor: TOWN_ACTOR, command });

export const MERGE_LOG: Input[] = [
  ...REPEAT_JOINS_LOG,
  { actor: "r_blaze4", command: { type: "join", name: "Blaze", kind: "agent" } },
  { actor: "r_blaze4", command: { type: "settle", px: 2, py: 1 } },
  { actor: "ada", command: { type: "give_coins", to: "r_blaze4", amount: 5 } },
  town({ type: "test_grant", to: "r_blaze4", coins: 10, stacks: { lemon: 3 } }),
  { actor: "r_blaze4", command: { type: "shop_buy", sku: "umbrella" } },
  { actor: "r_blaze4", command: { type: "leave" } },
  town({ type: "merge_resident", from: "r_blaze4", into: "r_blaze" }),
  { actor: "r_blaze", command: { type: "join", name: "Blaze", kind: "agent" } },
  { actor: "r_blaze", command: { type: "profile", wear: ["umbrella"] } },
  town({ type: "new_day", day: DAY + 17 }),
];

/** `hashWorld(replay(MERGE_CONFIG, MERGE_LOG))`, pinned when merging landed. */
export const MERGE_HASH = "1e5a677b";
