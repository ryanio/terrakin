import type { Input } from "../types";
import { TOWN_ACTOR } from "../types";
import { JOBS_CONFIG, JOBS_LOG } from "./jobs-log";

/**
 * The jobs world moved to the second edition of the jobs table (decision 0265), as the server
 * does: right after the `new_day` of Tuesday, December 24, 2024, in Midwinter. The second edition
 * has the first one's jobs, and each lane's regular jobs carry on from the last one it gave, so
 * Tuesday's walk is a find on the sand where the first edition has one in the forest. Dee takes
 * it. On Wednesday the job for home is cranberries, so the walk is a find, the finds lane's next
 * one, and Eve takes it. On Thursday Clem asks for a hot cranberry punch, where the first edition
 * has Ansel's bouquet, and Bob takes that.
 *
 * `jobs.test.ts` replays it to the hash pinned below, so a change to how the second edition reads
 * the table, which would replay the live log differently once it's switched on, fails loudly.
 */
export const JOB_EDITION_CONFIG = JOBS_CONFIG;

/** December 24, 2024, the day after the jobs log ends. */
const DAY = 20_081;
const town = (command: Input["command"]): Input => ({ actor: TOWN_ACTOR, command });
const bob = (command: Input["command"]): Input => ({ actor: "bob", command });
const dee = (command: Input["command"]): Input => ({ actor: "dee", command });
const eve = (command: Input["command"]): Input => ({ actor: "eve", command });

export const JOB_EDITION_LOG: Input[] = [
  ...JOBS_LOG,
  // Tuesday: clem_candy_canes, marlo_sand_find, pip_win.
  town({ type: "new_day", day: DAY }),
  town({ type: "set_job_edition", edition: 2 }),
  dee({ type: "take_job", job: "marlo_sand_find" }),
  // Wednesday: juniper_cranberries, marlo_forest_find, otis_host.
  town({ type: "new_day", day: DAY + 1 }),
  eve({ type: "take_job", job: "marlo_forest_find" }),
  // Thursday: clem_cranberry_punch, marlo_find, pip_game.
  town({ type: "new_day", day: DAY + 2 }),
  bob({ type: "take_job", job: "clem_cranberry_punch" }),
];

/** `hashWorld(replay(JOB_EDITION_CONFIG, JOB_EDITION_LOG))`, pinned when the second edition landed. */
export const JOB_EDITION_HASH = "0cdf93e5";
