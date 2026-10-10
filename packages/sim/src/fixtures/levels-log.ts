import type { Input } from "../types";
import { TOWN_ACTOR } from "../types";
import { LESSONS_CONFIG, LESSONS_LOG } from "./lessons-log";

/**
 * The lessons world after levels open (RFC 0029). Bounties open, then `open_levels` with a
 * one-time credit for Eve and Ada. On that Monday Eve plants, makes herb tea and a fishing rod,
 * digs a pond and casts twice (a boot, then a minnow), and picks up a chestnut. Dee visits and
 * teaches her the barrel. Eve pays Dee for a bounty, which counts; Bob pays Ada, his own person,
 * which doesn't; and Eve pays Dee a second time that week, which doesn't either. Eve and Dee play
 * a rated Hearth race. Two days on Eve harvests what the credit already counted as firsts, and in
 * December she harvests again, in a second season. `levels.test.ts` replays it to the hash pinned
 * below, so once levels are live a change to a deed's points, the cap, a first, the bounty week,
 * or the credit that would replay the real log differently fails loudly.
 */
export const LEVELS_CONFIG = LESSONS_CONFIG;

/** October 28, 2024, a Monday: the day the lessons log ends on. */
const DAY = 20_024;
const SALT = "0123456789abcdef0123456789abcdef";
const town = (command: Input["command"]): Input => ({ actor: TOWN_ACTOR, command });
const ada = (command: Input["command"]): Input => ({ actor: "ada", command });
const bob = (command: Input["command"]): Input => ({ actor: "bob", command });
const dee = (command: Input["command"]): Input => ({ actor: "dee", command });
const eve = (command: Input["command"]): Input => ({ actor: "eve", command });
const cast = (roll: number): Input =>
  eve({ type: "fish", roll, weather: "clear", timeOfDay: "day" });
/** A bounty posted, claimed, done, and paid. */
const bounty = (
  poster: (c: Input["command"]) => Input,
  claimant: (c: Input["command"]) => Input,
  to: string,
  id: string,
): Input[] => [
  poster({ type: "post_bounty", title: "Water my lemons", reward: 5 }),
  claimant({ type: "claim_bounty", bounty: id }),
  claimant({ type: "complete_bounty", bounty: id }),
  poster({ type: "confirm_bounty", bounty: id, to }),
];
/** One round of the race: Eve moves 3, Dee 2, and the round closes. */
const round = (n: number): Input[] => [
  eve({ type: "decide", table: "g_1", round: n, move: 3 }),
  dee({ type: "decide", table: "g_1", round: n, move: 2 }),
  town({ type: "close_round", table: "g_1", round: n, at: 10_000 + n * 1_000 }),
];

export const LEVELS_LOG: Input[] = [
  ...LESSONS_LOG,
  town({ type: "open_bounties" }),
  town({
    type: "open_levels",
    firsts: [
      { resident: "eve", kinds: ["herb", "flower", "lemonade"] },
      { resident: "ada", kinds: ["lemon", "lemon_jam"] },
    ],
  }),
  // Eve stands on her hearth at (3, 11), with planters, a kitchen, and a workbench in her hut.
  eve({ type: "plant", x: 2, y: 10, seed: "herb" }),
  eve({ type: "plant", x: 2, y: 11, seed: "flower" }),
  eve({ type: "craft", recipe: "herb_tea", x: 4, y: 10 }),
  town({ type: "test_grant", to: "eve", stacks: { wood: 3, stone: 2 } }),
  eve({ type: "craft", recipe: "fishing_rod", x: 4, y: 12 }),
  eve({ type: "place", x: 3, y: 10, block: "pond" }),
  cast(0),
  cast(500),
  // A chestnut lies at (0, 13) today.
  eve({ type: "gather", x: 0, y: 13 }),
  dee({ type: "visit", px: 0, py: 1, x: 6, y: 11 }),
  dee({ type: "teach", recipe: "barrel", to: "eve" }),
  ...bounty(eve, dee, "dee", "b_1"),
  ...bounty(bob, ada, "ada", "b_2"),
  ...bounty(eve, dee, "dee", "b_3"),
  eve({ type: "open_table", game: "hearth_race", pace: "slow", salt: SALT, at: 1_000 }),
  dee({ type: "sit", table: "g_1", at: 2_000 }),
  eve({ type: "start_game", table: "g_1", at: 3_000 }),
  ...[1, 2, 3, 4].flatMap(round),
  town({ type: "new_day", day: DAY + 2 }),
  eve({ type: "home" }),
  eve({ type: "harvest", x: 2, y: 10 }),
  eve({ type: "harvest", x: 2, y: 11 }),
  eve({ type: "plant", x: 2, y: 10, seed: "herb" }),
  // December 2: winter, so these points count in a second season.
  town({ type: "new_day", day: DAY + 35 }),
  eve({ type: "harvest", x: 2, y: 10 }),
];

/** `hashWorld(replay(LEVELS_CONFIG, LEVELS_LOG))`, pinned when levels landed in the sim. */
export const LEVELS_HASH = "3cc7e39a";
