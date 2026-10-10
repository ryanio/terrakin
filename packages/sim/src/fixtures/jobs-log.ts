import type { Input } from "../types";
import { TOWN_ACTOR } from "../types";
import { LEVELS_CONFIG, LEVELS_LOG } from "./levels-log";

/**
 * The levels world after jobs open (RFC 0030), on Monday, December 2, 2024. Eve takes Pip's game
 * job and lets it go, takes Marlo's find job, and plants her three planters. On Tuesday the board
 * has moved on, and the seashell she picks up on her own sand still finishes the job she holds.
 * Dee takes Juniper's flowers and never picks one. On Thursday Eve catches three fish for Sable,
 * with a boot between them that doesn't count, and on Saturday her three harvests finish Juniper's
 * job: three in one UTC week.
 *
 * The next Monday starts a new week. Eve takes Sable's night job, and a minnow at noon doesn't
 * move it where one at night does. On Tuesday Dee's job lapses, seven days after she took it. On
 * Saturday Bob takes Clem's herb tea job, holding only a jar Ada made, and Eve takes it too and
 * hands in the oldest jar she made herself.
 *
 * That same Saturday Hal arrives, settles south of the Commons, and picks up a four-leaf clover
 * for Marlo, and then his record is merged into Gus's, and his one job with it. Dee takes Pip's
 * game job and loses a rated Hearth race to Eve, which finishes it. On Sunday Dee visits, takes
 * Otis's job, and teaches Eve the bookshelf, and Eve catches a night fish: her third that week.
 * Four more fish jobs over the next eight days, with Bob's job lapsing on the way, bring her to
 * ten jobs finished, and she shows the title Helping hand.
 *
 * `jobs.test.ts` replays it to the hash pinned below, so once jobs are live a change to the board,
 * a bound, a job's count, its points, a lapse, what a hand-in takes, what a lesson or a game
 * counts, the count of jobs finished, its title, or a merge that would replay the real log
 * differently fails loudly. It has no `set_job_edition`: no second edition exists to switch to.
 */
export const JOBS_CONFIG = LEVELS_CONFIG;

/** December 2, 2024, a Monday: the day the levels log ends on. */
const DAY = 20_059;
const SALT = "fedcba9876543210fedcba9876543210";
const town = (command: Input["command"]): Input => ({ actor: TOWN_ACTOR, command });
const bob = (command: Input["command"]): Input => ({ actor: "bob", command });
const dee = (command: Input["command"]): Input => ({ actor: "dee", command });
const eve = (command: Input["command"]): Input => ({ actor: "eve", command });
const hal = (command: Input["command"]): Input => ({ actor: "hal", command });
/** A cast from Eve's hearth into her pond. Roll 0 is a boot, and 600 a minnow at any hour. */
const cast = (roll: number, timeOfDay: "day" | "dusk" | "night" = "day"): Input =>
  eve({ type: "fish", roll, weather: "clear", timeOfDay });
/** One round of the race: Eve moves 3, Dee 2, and the round closes. */
const round = (n: number): Input[] => [
  eve({ type: "decide", table: "g_2", round: n, move: 3 }),
  dee({ type: "decide", table: "g_2", round: n, move: 2 }),
  town({ type: "close_round", table: "g_2", round: n, at: 30_000 + n * 1_000 }),
];

export const JOBS_LOG: Input[] = [
  ...LEVELS_LOG,
  // Monday's board: bram_chair, marlo_find, pip_game.
  town({ type: "open_jobs" }),
  eve({ type: "take_job", job: "pip_game" }),
  eve({ type: "drop_job" }),
  eve({ type: "take_job", job: "marlo_find" }),
  eve({ type: "plant", x: 2, y: 10, seed: "herb" }),
  eve({ type: "plant", x: 2, y: 11, seed: "herb" }),
  eve({ type: "plant", x: 2, y: 12, seed: "flower" }),
  // Tuesday: juniper_flowers, sable_night_fish, otis_host.
  town({ type: "new_day", day: DAY + 1 }),
  eve({ type: "gather", x: 6, y: 11 }),
  dee({ type: "take_job", job: "juniper_flowers" }),
  // Thursday: juniper_cranberries, sable_three_fish, otis_bounty.
  town({ type: "new_day", day: DAY + 3 }),
  eve({ type: "take_job", job: "sable_three_fish" }),
  cast(600),
  cast(0),
  cast(600),
  cast(600),
  // Saturday: juniper_crops, sable_dusk_fish, otis_teach.
  town({ type: "new_day", day: DAY + 5 }),
  eve({ type: "take_job", job: "juniper_crops" }),
  eve({ type: "harvest", x: 2, y: 10 }),
  eve({ type: "harvest", x: 2, y: 11 }),
  eve({ type: "harvest", x: 2, y: 12 }),
  // Monday, a new week: juniper_herbs, sable_night_fish, otis_guest.
  town({ type: "new_day", day: DAY + 7 }),
  eve({ type: "take_job", job: "sable_night_fish" }),
  cast(600),
  cast(600, "night"),
  // Tuesday: Dee's job lapses.
  town({ type: "new_day", day: DAY + 8 }),
  // Saturday: clem_herb_tea, marlo_find, pip_game.
  town({ type: "new_day", day: DAY + 12 }),
  bob({ type: "take_job", job: "clem_herb_tea" }),
  eve({ type: "take_job", job: "clem_herb_tea" }),
  eve({ type: "hand_in" }),
  // Hal's hearth is two tiles from a four-leaf clover. One job, and his record is merged away.
  hal({ type: "join", name: "Hal", kind: "human" }),
  hal({ type: "settle", px: 1, py: 2 }),
  hal({ type: "set_hearth", x: 11, y: 19 }),
  hal({ type: "take_job", job: "marlo_find" }),
  hal({ type: "gather", x: 12, y: 17 }),
  hal({ type: "leave" }),
  town({ type: "merge_resident", from: "hal", into: "gus" }),
  // A rated Hearth race for Pip: Eve wins it, and Dee, who holds the job, finishes it.
  dee({ type: "take_job", job: "pip_game" }),
  eve({ type: "open_table", game: "hearth_race", pace: "slow", salt: SALT, at: 20_000 }),
  dee({ type: "sit", table: "g_2", at: 21_000 }),
  eve({ type: "start_game", table: "g_2", at: 22_000 }),
  ...[1, 2, 3, 4].flatMap(round),
  eve({ type: "home" }),
  dee({ type: "visit", px: 0, py: 1, x: 6, y: 11 }),
  // Sunday: juniper_crops, sable_night_fish, otis_teach.
  town({ type: "new_day", day: DAY + 13 }),
  dee({ type: "take_job", job: "otis_teach" }),
  dee({ type: "teach", recipe: "bookshelf", to: "eve" }),
  eve({ type: "take_job", job: "sable_night_fish" }),
  cast(600, "night"),
  // Tuesday, in a new week: juniper_herbs, sable_three_fish, otis_guest.
  town({ type: "new_day", day: DAY + 15 }),
  eve({ type: "take_job", job: "sable_three_fish" }),
  cast(600),
  cast(600),
  cast(600),
  // Thursday: juniper_flowers, sable_dusk_fish, otis_host.
  town({ type: "new_day", day: DAY + 17 }),
  eve({ type: "take_job", job: "sable_dusk_fish" }),
  cast(600, "dusk"),
  // Saturday, the first day of Midwinter: Bob's job lapses, and Eve's ninth is another night fish.
  town({ type: "new_day", day: DAY + 19 }),
  eve({ type: "take_job", job: "sable_night_fish" }),
  cast(600, "night"),
  // Monday: three fish make ten jobs, and ten jobs are a title.
  town({ type: "new_day", day: DAY + 21 }),
  eve({ type: "take_job", job: "sable_three_fish" }),
  cast(600),
  cast(600),
  cast(600),
  eve({ type: "profile", title: "helping_hand" }),
];

/** `hashWorld(replay(JOBS_CONFIG, JOBS_LOG))`, pinned when jobs landed in the sim. */
export const JOBS_HASH = "5e228d0b";
