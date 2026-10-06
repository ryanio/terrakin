import type { Input } from "../types";
import { TOWN_ACTOR } from "../types";
import { MARKET_CONFIG, MARKET_LOG } from "./market-log";

/**
 * The market world after bounties open (RFC 0008, phase 5, decision 0062): Dee posts a bounty,
 * Ada claims it, says it's done, and Dee pays her; Dee posts another and takes it back. Ada
 * proposes a grant for Dee, which passes, and a maintainer releases it from the treasury.
 * `bounties.test.ts` replays it and checks the hash pinned below, so once bounties are live a
 * change to a bounty rule or number that would replay the real log differently fails loudly.
 */
export const BOUNTIES_CONFIG = MARKET_CONFIG;

const DAY = 20_000;
const town = (command: Input["command"]): Input => ({ actor: TOWN_ACTOR, command });

export const BOUNTIES_LOG: Input[] = [
  ...MARKET_LOG,
  town({ type: "open_bounties" }),
  { actor: "dee", command: { type: "post_bounty", title: "Water my lemons", reward: 12 } },
  { actor: "ada", command: { type: "claim_bounty", bounty: "b_1" } },
  { actor: "ada", command: { type: "complete_bounty", bounty: "b_1" } },
  { actor: "dee", command: { type: "confirm_bounty", bounty: "b_1", to: "ada" } },
  {
    actor: "dee",
    command: { type: "post_bounty", title: "A fence", text: "Six posts.", reward: 5 },
  },
  { actor: "dee", command: { type: "cancel_bounty", bounty: "b_2" } },
  // Cy steps out, so she counts as active when the grant opens.
  { actor: "cy", command: { type: "move", dir: "s" } },
  {
    actor: "ada",
    command: { type: "propose", kind: "grant", title: "For Dee", text: "", amount: 100, to: "dee" },
  },
  { actor: "cy", command: { type: "vote", proposal: "t_3", choice: "yes" } },
  { actor: "dee", command: { type: "vote", proposal: "t_3", choice: "yes" } },
  { actor: "ada", command: { type: "vote", proposal: "t_3", choice: "yes" } },
  town({ type: "new_day", day: DAY + 17 }),
  town({ type: "close_proposal", proposal: "t_3" }),
  // A maintainer releases the grant held for Dee.
  town({ type: "confirm_town_bounty", bounty: "b_3", to: "dee", by: "staff_0123456789ab" }),
];

/** `hashWorld(replay(BOUNTIES_CONFIG, BOUNTIES_LOG))`, pinned when bounties landed. */
export const BOUNTIES_HASH = "54afd52a";
