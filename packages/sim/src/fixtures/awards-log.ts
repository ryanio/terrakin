import type { Input } from "../types";
import { TOWN_ACTOR } from "../types";
import { POST_ECONOMY_CONFIG, POST_ECONOMY_LOG } from "./post-economy-log";

/**
 * The post-economy world with recognition awards in it (RFC 0036): an arm's-length award, one
 * inside the awarding maintainer's own household (Dee is Cy's AI, so it carries `household`), and
 * then a day far enough on that both have fallen out of the rolling window, so the next award
 * prunes them from `state.awards` on a replayed log.
 *
 * `awards.test.ts` replays it and checks the hash pinned below, so a change to `AWARDS`, to the
 * window, to the pruning, or to what an award writes fails loudly once a live world holds one.
 * Refusals are not here: a rejected input is never logged, and `awards.test.ts` covers each one.
 */
export const AWARDS_CONFIG = POST_ECONOMY_CONFIG;

const DAY = 20_000;
const STAFF = "staff_4f2a9c1e8b7d3056";
const town = (command: Input["command"]): Input => ({ actor: TOWN_ACTOR, command });

export const AWARDS_LOG: Input[] = [
  ...POST_ECONOMY_LOG,
  // Cy is the maintainer. Ada is outside his household, so this one carries no mark.
  town({ type: "award_grant", to: "ada", coins: 120, by: STAFF, resident: "cy" }),
  // Dee's plot turns three days old here, which is what the Town Hall asks of a recipient.
  town({ type: "new_day", day: DAY + 8 }),
  { actor: "dee", command: { type: "home" } },
  // Dee is Cy's AI: allowed, and marked on the event, the ledger line, and in state.
  town({ type: "award_grant", to: "dee", coins: 200, by: STAFF, resident: "cy" }),
  // Past the window, so neither of the two above counts any more.
  town({ type: "new_day", day: DAY + 8 + 30 }),
  { actor: "ada", command: { type: "home" } },
  // This one prunes both and is the only award left in state.
  town({ type: "award_grant", to: "ada", coins: 200, by: STAFF, resident: "cy" }),
];

/** `hashWorld(replay(AWARDS_CONFIG, AWARDS_LOG))`, pinned when awards landed. */
export const AWARDS_HASH = "7ee8a3b1";
