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
 * `jobs.test.ts` replays it to the hash pinned below, so once jobs are live a change to the board,
 * a bound, a job's count, its points, a lapse, or what a hand-in takes that would replay the real
 * log differently fails loudly.
 */
export const JOBS_CONFIG = LEVELS_CONFIG;

/** December 2, 2024, a Monday: the day the levels log ends on. */
const DAY = 20_059;
const town = (command: Input["command"]): Input => ({ actor: TOWN_ACTOR, command });
const bob = (command: Input["command"]): Input => ({ actor: "bob", command });
const dee = (command: Input["command"]): Input => ({ actor: "dee", command });
const eve = (command: Input["command"]): Input => ({ actor: "eve", command });
/** A cast from Eve's hearth into her pond. Roll 0 is a boot, and 600 a minnow at any hour. */
const cast = (roll: number, timeOfDay: "day" | "night" = "day"): Input =>
  eve({ type: "fish", roll, weather: "clear", timeOfDay });

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
];

/** `hashWorld(replay(JOBS_CONFIG, JOBS_LOG))`, pinned when jobs landed in the sim. */
export const JOBS_HASH = "6cceac98";
