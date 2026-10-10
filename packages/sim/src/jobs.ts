import { type Biome, biomeAt } from "./biome";
import {
  CROP_INFO,
  type CraftKind,
  type Crop,
  type FindKind,
  FURNITURE_RECIPES,
  PANTRY_STAPLES,
  RECIPES,
  type RecipeName,
  recipeOf,
  STARTER_SEEDS,
  SWEET_RECIPES,
} from "./catalog";
import { isWhole, oneTimeSwitch, refuse } from "./check";
import { isTownsfolk } from "./economy";
import { findEvent } from "./events";
import { findsOpen } from "./gather";
import { dayName, type Holiday, holidayOf } from "./holiday";
import {
  ITEM_ID_PATTERN,
  ITEM_INFO,
  inventory,
  inventoryEvent,
  isCrop,
  isGoodKind,
  isResourceKind,
} from "./items";
import {
  bountyCounts,
  catchCounts,
  craftCounts,
  earned,
  eventCounts,
  gameCounts,
  harvestCounts,
  jobEarns,
  lessonCounts,
  pickupCounts,
  showTitle,
  townBountyCounts,
} from "./levels";
import { isJobWear, JOB_WEAR_INFO } from "./looks";
import { own, residentById } from "./own";
import { knownByAll } from "./recipes";
import { type Season, seasonOf, weekStart } from "./season";
import type { TimeOfDay } from "./time-of-day";
import type {
  Command,
  GameTable,
  Good,
  JobsState,
  JobTitle,
  Rejection,
  ResidentId,
  Skill,
  WorldEvent,
  WorldState,
} from "./types";

/**
 * Jobs (RFC 0030). A job is a small thing the town asks for through one of the townsfolk: a deed
 * the sim already knows, done one to three times, or one made thing handed in. Each UTC day the
 * town has three, the same for everyone, read from the day and a frozen table (`jobsOn`), never
 * stored. A resident takes one, does it, and it adds `JOBS.points` to its skill, outside that
 * skill's daily cap. They hold one at a time, finish at most one a day, and three a UTC week. The
 * count of jobs a resident has finished unlocks two titles and a garment, which show and do
 * nothing else.
 *
 * Jobs are not coins: nothing here mints, burns, or moves one. A thing handed in leaves the world.
 * Nothing runs until the server logs `open_jobs`, which creates `state.jobs`, so every older log
 * replays as it was made.
 */

/**
 * The numbers. Once jobs are open in a live world, changing one changes how logged inputs replay,
 * so it needs a logged switch. `board`, `held`, and `perDay` say what the rules' own shape is and
 * no rule reads them: the board has three slots, `jobs.held` holds one job a resident, and
 * `jobs.doneToday` lists a resident once. Changing one of those takes changing that shape.
 */
export const JOBS = {
  /** Jobs on the board each UTC day: one for home, one for a walk, one with neighbors. */
  board: 3,
  /** Jobs a resident holds at once. */
  held: 1,
  /** Jobs a resident finishes in a UTC day. */
  perDay: 1,
  /** Jobs a resident finishes in a UTC week, Monday to Sunday. */
  perWeek: 3,
  /** Days a held job lasts. It lapses at the `new_day` that many days after it was taken. */
  keepDays: 7,
  /** Points a finished job adds to its skill, outside the skill's daily cap. */
  points: 10,
  /** Jobs finished that unlock the first title, the garment, and the second title. */
  titleAt: 10,
  wearAt: 25,
  masterAt: 75,
} as const;

/**
 * Each job title's words, and which of the `JOBS` numbers is the count of jobs finished that
 * unlocks it. Fixed, never resident text.
 */
export const JOB_TITLE_INFO: Record<JobTitle, { label: string; at: "titleAt" | "masterAt" }> = {
  helping_hand: { label: "Helping hand", at: "titleAt" },
  pillar_of_the_town: { label: "Pillar of the town", at: "masterAt" },
};

/** The townsfolk who give jobs, by handle. Fixed words: a giver holds nothing and decides nothing. */
export const JOB_GIVERS = [
  "juniper",
  "clem",
  "bram",
  "ansel",
  "marlo",
  "sable",
  "otis",
  "pip",
] as const;
export type JobGiver = (typeof JOB_GIVERS)[number];

/** The deed a job counts, `count` times, with the condition it must meet when it has one. */
export type JobDeed =
  /** A harvest, of any crop or one of `crops`. */
  | { type: "harvest"; count: number; crops?: readonly Crop[] }
  /** A craft of `recipe`. */
  | { type: "craft"; count: number; recipe: RecipeName }
  /** A find picked up (a recipe page counts as one), in `biome` or one of `kinds` when given. */
  | { type: "find"; count: number; biome?: Biome; kinds?: readonly FindKind[] }
  /** A fish caught, at `timeOfDay` when given. */
  | { type: "fish"; count: number; timeOfDay?: TimeOfDay }
  /** A lesson taught that counts for Hosting. */
  | { type: "teach"; count: number }
  /** Being a counted guest at an event. */
  | { type: "guest"; count: number }
  /** Hosting an event that at least `guests` guests are counted at. */
  | { type: "host"; count: number; guests: number }
  /** Being paid for a bounty that counts for Hosting. */
  | { type: "bounty"; count: number }
  /** A rated game finished, in first place when `first` is set. */
  | { type: "game"; count: number; first?: true };

interface JobBase {
  /** Never changes once shipped, and neither does what the job asks. */
  id: string;
  giver: JobGiver;
  /** Where the job's points go. */
  skill: Skill;
  /** On the board only in this season, or only while this holiday runs. */
  season?: Season;
  holiday?: Holiday;
}

/**
 * One job: a deed job counts a deed, and a bring job asks for one made thing of the `bring`
 * recipe, made by whoever hands it in.
 */
export type Job = JobBase &
  ({ deed: JobDeed; bring?: undefined } | { bring: RecipeName; deed?: undefined });

/**
 * The table, by edition. An edition is frozen once a live world reads it: a logged `take_job` is
 * checked against its day's board, so the board for a past day must never change. A changed table
 * is the next edition. A job's id and what it asks stay the same in every edition that has it, so
 * a job held under one edition still finishes under the next.
 *
 * The first edition has no job for a `guest` deed or a `bounty` deed: both wait on a neighbor's
 * calendar, and the economy run's residents seldom finished them (decision 0255).
 */
export const JOB_EDITIONS: Readonly<Record<number, readonly Job[]>> = {
  1: [
    // Juniper, for the garden.
    {
      id: "juniper_crops",
      giver: "juniper",
      skill: "growing",
      deed: { type: "harvest", count: 3 },
    },
    {
      id: "juniper_herbs",
      giver: "juniper",
      skill: "growing",
      deed: { type: "harvest", count: 3, crops: ["herb"] },
    },
    {
      id: "juniper_flowers",
      giver: "juniper",
      skill: "growing",
      deed: { type: "harvest", count: 3, crops: ["flower"] },
    },
    {
      id: "juniper_pumpkins",
      giver: "juniper",
      skill: "growing",
      deed: { type: "harvest", count: 2, crops: ["pumpkin"] },
      season: "autumn",
    },
    {
      id: "juniper_cranberries",
      giver: "juniper",
      skill: "growing",
      deed: { type: "harvest", count: 3, crops: ["cranberry"] },
      season: "winter",
    },
    // Clem, for the kitchen.
    { id: "clem_herb_tea", giver: "clem", skill: "making", bring: "herb_tea" },
    { id: "clem_jam", giver: "clem", skill: "making", bring: "jam" },
    {
      id: "clem_pumpkin_pie",
      giver: "clem",
      skill: "making",
      bring: "pumpkin_pie",
      season: "autumn",
    },
    {
      id: "clem_cranberry_punch",
      giver: "clem",
      skill: "making",
      bring: "cranberry_punch",
      season: "winter",
    },
    {
      id: "clem_candy",
      giver: "clem",
      skill: "making",
      deed: { type: "craft", count: 1, recipe: "candy" },
      holiday: "halloween",
    },
    {
      id: "clem_candy_canes",
      giver: "clem",
      skill: "making",
      deed: { type: "craft", count: 1, recipe: "candy_cane" },
      holiday: "midwinter",
    },
    // Bram, for the workbench.
    {
      id: "bram_chair",
      giver: "bram",
      skill: "making",
      deed: { type: "craft", count: 1, recipe: "chair" },
    },
    {
      id: "bram_table",
      giver: "bram",
      skill: "making",
      deed: { type: "craft", count: 1, recipe: "table" },
    },
    {
      id: "bram_stone_wall",
      giver: "bram",
      skill: "making",
      deed: { type: "craft", count: 1, recipe: "stone_wall" },
    },
    {
      id: "bram_barrel",
      giver: "bram",
      skill: "making",
      deed: { type: "craft", count: 1, recipe: "barrel" },
    },
    {
      id: "bram_jack_o_lantern",
      giver: "bram",
      skill: "making",
      deed: { type: "craft", count: 1, recipe: "jack_o_lantern" },
      holiday: "halloween",
    },
    // Ansel, for flowers.
    { id: "ansel_bouquet", giver: "ansel", skill: "making", bring: "bouquet" },
    {
      id: "ansel_flower_box",
      giver: "ansel",
      skill: "making",
      deed: { type: "craft", count: 1, recipe: "flower_box" },
    },
    // Marlo, for finds.
    { id: "marlo_find", giver: "marlo", skill: "foraging", deed: { type: "find", count: 1 } },
    {
      id: "marlo_sand_find",
      giver: "marlo",
      skill: "foraging",
      deed: { type: "find", count: 1, biome: "sand" },
    },
    {
      id: "marlo_forest_find",
      giver: "marlo",
      skill: "foraging",
      deed: { type: "find", count: 1, biome: "forest" },
    },
    {
      id: "marlo_autumn_find",
      giver: "marlo",
      skill: "foraging",
      deed: { type: "find", count: 1, kinds: ["chestnut", "maple_leaf"] },
      season: "autumn",
    },
    // Sable, for fish.
    {
      id: "sable_dusk_fish",
      giver: "sable",
      skill: "foraging",
      deed: { type: "fish", count: 1, timeOfDay: "dusk" },
    },
    {
      id: "sable_night_fish",
      giver: "sable",
      skill: "foraging",
      deed: { type: "fish", count: 1, timeOfDay: "night" },
    },
    { id: "sable_three_fish", giver: "sable", skill: "foraging", deed: { type: "fish", count: 3 } },
    // Otis, for hosting.
    { id: "otis_teach", giver: "otis", skill: "hosting", deed: { type: "teach", count: 1 } },
    {
      id: "otis_host",
      giver: "otis",
      skill: "hosting",
      deed: { type: "host", count: 1, guests: 3 },
    },
    // Pip, for the game tables.
    { id: "pip_game", giver: "pip", skill: "playing", deed: { type: "game", count: 1 } },
    { id: "pip_two_games", giver: "pip", skill: "playing", deed: { type: "game", count: 2 } },
    {
      id: "pip_win",
      giver: "pip",
      skill: "playing",
      deed: { type: "game", count: 1, first: true },
    },
  ],
};

/** The edition `open_jobs` starts a world on. */
const FIRST_EDITION = 1;

type Mutation = () => WorldEvent[];

// ---------- the board ----------

/**
 * A job's lane. The board has three slots, each with two lanes that take turns by the day: home
 * is Growing one day and Making the next, a walk is a fish one day and a find the next, and
 * neighbors is Hosting one day and Playing the next. On even days the first lane of each is up,
 * so every day has a harvest or a find.
 */
type Lane = "growing" | "making" | "fish" | "finds" | "hosting" | "playing";
const SLOTS: readonly (readonly [Lane, Lane])[] = [
  ["growing", "making"],
  ["fish", "finds"],
  ["hosting", "playing"],
];
/** The slot for a walk, in `SLOTS`. */
const WALK = 1;

function laneOf(job: Job): Lane {
  if (job.skill !== "foraging") return job.skill;
  return job.deed?.type === "fish" ? "fish" : "finds";
}

/**
 * Whether the part of the game a job needs is open in this world: finds for a find, lessons for a
 * lesson, and bounties for a bounty. Nothing else a job asks for has a switch that can be off
 * once jobs are open.
 */
function partOpen(state: WorldState, job: Job): boolean {
  switch (job.deed?.type) {
    case "find":
      return findsOpen(state);
    case "teach":
      return state.recipes !== undefined;
    case "bounty":
      return state.bounties !== undefined;
    default:
      return true;
  }
}

/**
 * The job a lane gives on its `turn`th turn, from its jobs that are up today, in table order, one
 * after the other. While a holiday runs, a lane with jobs for it gives one of those every other
 * turn, so a short holiday's jobs always come up.
 */
function laneJob(up: readonly Job[], turn: number): Job | undefined {
  const regular = up.filter((job) => job.holiday === undefined);
  const festive = up.filter((job) => job.holiday !== undefined);
  if (festive.length === 0) return regular[turn % regular.length];
  const half = Math.floor(turn / 2);
  if (turn % 2 === 0 || regular.length === 0) return festive[half % festive.length];
  return regular[half % regular.length];
}

/** The jobs of `table` that are up on `day`: their part of the game open, in season, in their holiday. */
function upOn(state: WorldState, table: readonly Job[], day: number): Job[] {
  const season = seasonOf(day);
  const holiday = holidayOf(day);
  return table.filter(
    (job) =>
      partOpen(state, job) &&
      (job.season === undefined || job.season === season) &&
      (job.holiday === undefined || job.holiday === holiday),
  );
}

const inLane = (up: readonly Job[], lane: Lane) => up.filter((job) => laneOf(job) === lane);

/**
 * What the lanes' turns give each slot on `day`: an even day has each slot's first lane and an
 * odd day its second. A lane with nothing up that day leaves its slot to the other lane, which
 * then takes a turn every day, and a slot with neither has no job.
 */
function turns(state: WorldState, table: readonly Job[], day: number): (Job | undefined)[] {
  const up = upOn(state, table, day);
  return SLOTS.map((lanes) => {
    const [first, second] = lanes.map((lane) => inLane(up, lane)).filter((l) => l.length > 0);
    return first && second
      ? laneJob(day % 2 === 0 ? first : second, Math.floor(day / 2))
      : first && laneJob(first, day);
  });
}

/**
 * Today's board: three jobs, each in a different skill, the same for everyone (RFC 0030, section
 * 2). A pure function of the world's day, the season and holiday it and the days either side fall
 * in, which parts of the game are open, and the edition's table. Empty before `open_jobs`.
 *
 * It's what the lanes' turns give (`turns`), with one change. Every day has one job that needs
 * nothing bought (`soloJob`), and the turns leave some days without: the even days when Growing's
 * turn falls on a crop whose seed only the shop sells, beside a fish and a job for a host. On a
 * day like that the walk is a find in place of the fish: the first find up that day that the
 * turns give neither the day before nor the day after, so no job comes two days running.
 */
export function jobsOn(state: WorldState): Job[] {
  const jobs = state.jobs;
  const day = state.day;
  if (!jobs || day === undefined) return [];
  const table = JOB_EDITIONS[jobs.edition] ?? [];
  const board = turns(state, table, day);
  if (!board.some((job) => job && soloJob(job))) {
    const near = [day - 1, day + 1].map((d) => turns(state, table, d)[WALK]);
    const find = inLane(upOn(state, table, day), "finds").find((job) => !near.includes(job));
    if (find) board[WALK] = find;
  }
  return board.filter((job) => job !== undefined);
}

/** The job with this id in any edition, so a job held across a change of edition is still known. */
export function jobById(id: unknown): Job | undefined {
  for (const table of Object.values(JOB_EDITIONS)) {
    const job = table.find((j) => j.id === id);
    if (job) return job;
  }
  return undefined;
}

/**
 * Whether a resident has `kind` without buying it: a crop the first pantry's seeds grow, sugar or
 * a jar, which the pantry tops up each day, or wood or stone, which lie on the land.
 */
const comesFree = (kind: string): boolean =>
  (isCrop(kind) && (STARTER_SEEDS as readonly string[]).includes(CROP_INFO[kind].seed)) ||
  (PANTRY_STAPLES as readonly string[]).includes(kind) ||
  isResourceKind(kind);

/**
 * Whether everyone can make a thing of `recipe` with nothing bought: everyone knows it, and one of
 * the things it makes takes only what comes free. Jam is, from a lemon. Candy isn't, since it takes
 * a pumpkin.
 */
const madeFree = (recipe: RecipeName): boolean =>
  knownByAll(recipe) &&
  Object.entries({ ...RECIPES, ...FURNITURE_RECIPES, ...SWEET_RECIPES }).some(
    ([kind, { needs }]) =>
      recipeOf(kind as CraftKind) === recipe && Object.keys(needs).every(comesFree),
  );

/**
 * Whether `job` needs nothing bought: a resident with a hearth can do it alone with what a first
 * pantry and the land give, no recipe to learn, and no fishing rod. That's a find, a harvest of
 * any crop or of one a starter seed grows, and a craft or a made thing everyone can make from what
 * comes free. Every day's board has at least one in a world with finds out (`jobsOn`).
 */
export function soloJob(job: Job): boolean {
  if (job.bring !== undefined) return madeFree(job.bring);
  switch (job.deed.type) {
    case "find":
      return true;
    case "harvest":
      return job.deed.crops === undefined || job.deed.crops.some(comesFree);
    case "craft":
      return madeFree(job.deed.recipe);
    default:
      return false;
  }
}

/** How many jobs a resident has ever finished. Public. */
export const jobsDone = (state: WorldState, id: ResidentId): number =>
  own(state.jobs?.total, id) ?? 0;

// ---------- taking and letting go ----------

/**
 * `take_job {job}`: hold one of today's jobs, from anywhere. It takes a hearth, and it's refused
 * for townsfolk (`not_eligible`), while you hold one (`job_held`), once you've finished one today
 * or `JOBS.perWeek` this UTC week (`job_limit`), and for a job that isn't on today's board
 * (`unknown_job`), which is every job before `open_jobs`.
 */
export function checkTakeJob(
  state: WorldState,
  actor: ResidentId,
  command: Extract<Command, { type: "take_job" }>,
): Mutation | Rejection {
  const jobs = state.jobs;
  const day = state.day;
  if (!jobs || day === undefined) {
    return refuse("unknown_job", "The town has no jobs in this world yet.");
  }
  if (isTownsfolk(state, actor)) {
    return refuse("not_eligible", "Townsfolk give the town's jobs and never take one.");
  }
  if (!residentById(state, actor)?.hearth) {
    return refuse("no_hearth", "Jobs start once you have a hearth. Settle on a plot first.");
  }
  const held = own(jobs.held, actor);
  if (held) {
    return refuse(
      "job_held",
      `You're holding a job (${held.job}). Finish it, or let it go first with {"type": "drop_job"}.`,
    );
  }
  if (jobs.doneToday?.includes(actor)) {
    return refuse(
      "job_limit",
      "You finished a job today, and a day has one. The next one can be taken after midnight UTC.",
    );
  }
  const monday = weekStart(day);
  const week = jobs.week?.start === monday ? (own(jobs.week.done, actor) ?? 0) : 0;
  if (week >= JOBS.perWeek) {
    return refuse(
      "job_limit",
      `You've finished ${JOBS.perWeek} jobs this week, all a week has. The next one can be taken on Monday, ${dayName(monday + 7)} (UTC).`,
    );
  }
  const board = jobsOn(state);
  const job = board.find((j) => j.id === command.job);
  if (!job) {
    return refuse(
      "unknown_job",
      `That isn't one of today's jobs. Today's are ${board.map((j) => j.id).join(", ")}.`,
    );
  }
  const seq = state.seq + 1;
  return () => {
    jobs.held = { ...(jobs.held ?? {}), [actor]: { job: job.id, day, seq } };
    return [{ type: "job_taken", residentId: actor, job: job.id }];
  };
}

/** Take `id`'s held job out of the world's list, and the list with it when it was the last. */
function letGo(jobs: JobsState, id: ResidentId) {
  if (!jobs.held) return;
  delete jobs.held[id];
  if (Object.keys(jobs.held).length === 0) delete jobs.held;
}

/** `drop_job`: let go of the job you hold. It costs nothing, and you can take another. */
export function checkDropJob(state: WorldState, actor: ResidentId): Mutation | Rejection {
  const jobs = state.jobs;
  const held = own(jobs?.held, actor);
  if (!jobs || !held) return refuse("no_job", "You aren't holding a job.");
  return () => {
    letGo(jobs, actor);
    return [{ type: "job_dropped", residentId: actor, job: held.job }];
  };
}

// ---------- doing ----------

/**
 * What finishing `job` does, as a commit: the job leaves the resident's hands, they're on today's
 * list, this UTC week's count and their count for good each go up by one, and the job's points
 * land outside the daily cap. The week's count starts again with the first job finished in a later
 * week.
 */
function finishing(state: WorldState, jobs: JobsState, id: ResidentId, job: Job): Mutation {
  const monday = weekStart(state.day as number);
  const points = jobEarns(state, id, job.skill, JOBS.points);
  return () => {
    letGo(jobs, id);
    jobs.doneToday = [...(jobs.doneToday ?? []), id].sort();
    if (jobs.week?.start !== monday) jobs.week = { start: monday, done: {} };
    const week = (own(jobs.week.done, id) ?? 0) + 1;
    jobs.week.done[id] = week;
    const total = (own(jobs.total, id) ?? 0) + 1;
    jobs.total = { ...(jobs.total ?? {}), [id]: total };
    return [
      {
        type: "job_done",
        residentId: id,
        job: job.id,
        skill: job.skill,
        points: JOBS.points,
        week,
        total,
      },
      ...earned(points),
    ];
  };
}

/** A deed a resident just did, as a job sees it. */
type Done =
  | { type: "harvest"; crop: string }
  | { type: "craft"; recipe: RecipeName }
  | { type: "find"; kind: string; biome: Biome }
  | { type: "fish"; timeOfDay: TimeOfDay }
  | { type: "teach" }
  | { type: "guest" }
  | { type: "host"; guests: number }
  | { type: "bounty" }
  | { type: "game"; first: boolean };

/** Whether a deed is the one a job counts. */
function fits(wanted: JobDeed, done: Done): boolean {
  switch (wanted.type) {
    case "harvest":
      return (
        done.type === "harvest" &&
        (wanted.crops === undefined || (wanted.crops as readonly string[]).includes(done.crop))
      );
    case "craft":
      return done.type === "craft" && done.recipe === wanted.recipe;
    case "find":
      return (
        done.type === "find" &&
        (wanted.biome === undefined || done.biome === wanted.biome) &&
        (wanted.kinds === undefined || (wanted.kinds as readonly string[]).includes(done.kind))
      );
    case "fish":
      return (
        done.type === "fish" &&
        (wanted.timeOfDay === undefined || done.timeOfDay === wanted.timeOfDay)
      );
    case "teach":
    case "guest":
    case "bounty":
      return done.type === wanted.type;
    case "host":
      return done.type === "host" && done.guests >= wanted.guests;
    case "game":
      return done.type === "game" && (wanted.first !== true || done.first);
  }
}

/**
 * What deeds a resident just did add to the job they hold, as a commit for the deed's own commit
 * to run, or null: with no job held, a bring job, or no deed that fits. A deed moves only a job
 * taken before it, since the count starts when the job is taken. A deed that's reported in a later
 * input than it was done in says when it was done (`doneAt`, a `seq`), and a job taken since then
 * doesn't move. When the count is reached the job is done, in that same commit.
 */
function moving(
  state: WorldState,
  id: ResidentId,
  done: readonly Done[],
  doneAt?: number,
): Mutation | null {
  const jobs = state.jobs;
  const held = own(jobs?.held, id);
  if (!jobs || !held) return null;
  if (doneAt !== undefined && held.seq >= doneAt) return null;
  const job = jobById(held.job);
  const wanted = job?.deed;
  if (!job || !wanted) return null;
  const fitting = done.filter((d) => fits(wanted, d)).length;
  if (fitting === 0) return null;
  const count = Math.min(wanted.count, (held.count ?? 0) + fitting);
  if (count >= wanted.count) return finishing(state, jobs, id, job);
  return () => {
    held.count = count;
    return [{ type: "job_progress", residentId: id, job: job.id, count, of: wanted.count }];
  };
}

/**
 * Each hook reads the rule its deed's points read, before the cap (`...Counts` in `levels.ts`), so
 * a deed that would never earn never moves a job, and one past the daily cap still does.
 */

/** A harvest of `crop`, for the job its resident holds. */
export const harvestJob = (state: WorldState, id: ResidentId, crop: string) =>
  harvestCounts(state, id, crop) ? moving(state, id, [{ type: "harvest", crop }]) : null;

/** A craft of `kind`, a good, a piece of furniture, or a sweet. */
export const craftJob = (state: WorldState, id: ResidentId, kind: string) =>
  craftCounts(state, id, kind)
    ? moving(state, id, [{ type: "craft", recipe: recipeOf(kind as CraftKind) }])
    : null;

/** What one `gather` picked up: each find or recipe page, with the biome it lay in. */
export const gatherJob = (
  state: WorldState,
  id: ResidentId,
  pickups: readonly { kind: string; x: number; y: number }[],
) =>
  moving(
    state,
    id,
    pickups
      .filter((p) => pickupCounts(state, id, p.kind))
      .map((p) => ({ type: "find", kind: p.kind, biome: biomeAt(state.config, p.x, p.y) })),
  );

/** A cast that caught `caught`, at the time of day the server logged with it. */
export const catchJob = (
  state: WorldState,
  id: ResidentId,
  caught: string,
  timeOfDay: TimeOfDay,
) => (catchCounts(state, id, caught) ? moving(state, id, [{ type: "fish", timeOfDay }]) : null);

/**
 * The deeds with a second resident read their points' rule too, and that rule is what keeps a
 * household or a ring from feeding itself: the other side is outside your household, has a hearth,
 * could vote, was counted by the event's own samples, or sat in a seat rated at the start. Townsfolk
 * are never the other side of any of them.
 */

/** A lesson `teacher` gave `learner`, for the job the teacher holds. */
export const lessonJob = (state: WorldState, teacher: ResidentId, learner: ResidentId) =>
  lessonCounts(state, teacher, learner) ? moving(state, teacher, [{ type: "teach" }]) : null;

/** A resident's bounty its poster just paid `claimant` for. */
export const bountyJob = (
  state: WorldState,
  poster: ResidentId,
  claimant: ResidentId,
  reward: number,
) =>
  bountyCounts(state, poster, claimant, reward)
    ? moving(state, claimant, [{ type: "bounty" }])
    : null;

/** A town bounty or a released grant a maintainer just paid `claimant` for. */
export const townBountyJob = (state: WorldState, claimant: ResidentId) =>
  townBountyCounts(state, claimant) ? moving(state, claimant, [{ type: "bounty" }]) : null;

/** Every commit in `moves`, as one, or null when there's none. */
const together = (moves: readonly (Mutation | null)[]): Mutation | null => {
  const real = moves.filter((move) => move !== null);
  return real.length > 0 ? () => real.flatMap((move) => move()) : null;
};

/** A game that just ended, for each seat it counts for: a rated seat that chose in it. */
export const gameJob = (
  state: WorldState,
  table: GameTable,
  rounds: readonly Readonly<Record<ResidentId, number | null>>[],
  places: Readonly<Record<ResidentId, number>>,
  away: readonly ResidentId[],
) =>
  together(
    gameCounts(state, table, rounds, places, away).map((seat) =>
      moving(state, seat.resident, [{ type: "game", first: seat.first }]),
    ),
  );

/**
 * A `credit_event` the sim just took: each guest it counts, and the host with how many guests the
 * list holds. `apply.ts` runs it after the credit's own commit, and only for a list `credit_event`
 * accepted, so a guest the event's samples didn't see, one in the host's household, and townsfolk
 * never reach it. The credit comes after the event, sometimes long after, so the deed is dated by
 * the input that ended the event (`endedSeq`): a job taken after that doesn't move, and neither
 * does any job for an event that ended before jobs opened.
 */
export function creditJob(
  state: WorldState,
  command: Extract<Command, { type: "credit_event" }>,
): Mutation | null {
  const e = findEvent(state, command.event);
  const ended = e?.endedSeq;
  if (!e || ended === undefined) return null;
  const { guests } = command;
  const counted = eventCounts(state, e.host, guests);
  return together([
    counted.host ? moving(state, e.host, [{ type: "host", guests: guests.length }], ended) : null,
    ...counted.guests.map(({ id }) => moving(state, id, [{ type: "guest" }], ended)),
  ]);
}

// ---------- handing in ----------

/** A made thing's place in the order things were made: ids come from one counter. */
const madeOrder = (good: Good) => Number(good.id.slice(2));

/**
 * `hand_in {item?}`: finish the bring job you hold with a thing of its recipe that you made
 * yourself, your oldest or the one `item` names. Refused when you hold no bring job (`no_job`),
 * for someone made townsfolk since they took it (`not_eligible`), and when you hold nothing of the
 * kind that you made, or `item` isn't one (`nothing_to_hand_in`): a thing someone else made, given
 * or bought, never finishes a job. The thing leaves the world.
 */
export function checkHandIn(
  state: WorldState,
  actor: ResidentId,
  command: Extract<Command, { type: "hand_in" }>,
): Mutation | Rejection {
  const jobs = state.jobs;
  const items = state.items;
  const held = own(jobs?.held, actor);
  if (!jobs || !items || !held) return refuse("no_job", "You aren't holding a job.");
  // Someone made townsfolk while they held a job: townsfolk never finish one.
  if (isTownsfolk(state, actor)) {
    return refuse("not_eligible", "Townsfolk give the town's jobs and never finish one.");
  }
  const job = jobById(held.job);
  const recipe = job?.bring;
  if (!job || recipe === undefined) {
    return refuse(
      "no_job",
      `The job you hold (${held.job}) has nothing to hand in: it's done when you've done what it asks.`,
    );
  }
  const ofKind = (own(items.inventories, actor)?.goods ?? []).filter(
    (good) => isGoodKind(good.kind) && recipeOf(good.kind) === recipe,
  );
  const wanted = Object.hasOwn(ITEM_INFO, recipe)
    ? ITEM_INFO[recipe as CraftKind].name.toLowerCase()
    : recipe;
  const { item } = command;
  let good: Good | undefined;
  if (item !== undefined) {
    good =
      typeof item === "string" && ITEM_ID_PATTERN.test(item)
        ? ofKind.find((g) => g.id === item)
        : undefined;
    if (!good) {
      return refuse(
        "nothing_to_hand_in",
        `You don't hold ${wanted} with that id. Leave out item to hand in the oldest one you made.`,
      );
    }
    if (good.maker !== actor) {
      return refuse(
        "nothing_to_hand_in",
        "Someone else made that one. A job takes only a thing you made yourself.",
      );
    }
  } else {
    good = ofKind.filter((g) => g.maker === actor).sort((a, b) => madeOrder(a) - madeOrder(b))[0];
    if (!good) {
      return refuse(
        "nothing_to_hand_in",
        ofKind.length > 0
          ? `Someone else made the ${wanted} you hold. A job takes only a thing you made yourself.`
          : `You hold no ${wanted} that you made. Make one with craft, then hand it in.`,
      );
    }
  }
  const { id } = good;
  const done = finishing(state, jobs, actor, job);
  return () => {
    const mine = inventory(items, actor);
    mine.goods = mine.goods.filter((g) => g.id !== id);
    return [inventoryEvent(actor, "handed_in", [], { lost: [id] }), ...done()];
  };
}

// ---------- server inputs ----------

/**
 * `open_jobs`, which only TOWN_ACTOR sends, once: from now on the town has a board and residents
 * may take jobs. It needs levels open, since a job pays points.
 */
export function checkOpenJobs(state: WorldState): Mutation | Rejection {
  return oneTimeSwitch({
    on: state.jobs,
    already: "Jobs are already open.",
    // Levels open only once the world counts days, so with levels there's a day.
    notYet: () => (state.progress ? null : refuse("not_due", "Jobs open once levels are open.")),
    turnOn: () => {
      state.jobs = { opened: state.day as number, edition: FIRST_EDITION };
    },
    event: { type: "jobs_opened" },
  });
}

/**
 * `set_job_edition {edition}`, which only TOWN_ACTOR sends: the board reads that edition of the
 * table from now on. Days before it were read under the edition they had, so a `take_job` logged
 * then replays against the board it saw. A job held across the switch stays held and still
 * finishes, since `jobById` knows every edition's jobs.
 */
export function checkSetJobEdition(
  state: WorldState,
  command: Extract<Command, { type: "set_job_edition" }>,
): Mutation | Rejection {
  const jobs = state.jobs;
  if (!jobs) return refuse("not_due", "Jobs aren't open in this world yet.");
  const { edition } = command;
  if (!isWhole(edition) || !Object.hasOwn(JOB_EDITIONS, edition)) {
    return refuse("server_only", "The server names an edition of the jobs table that exists.");
  }
  if (edition === jobs.edition) {
    return refuse("already_set", `The board already reads edition ${edition}.`);
  }
  return () => {
    jobs.edition = edition;
    return [{ type: "job_edition_set", edition }];
  };
}

// ---------- what the count unlocks ----------

/**
 * What a `profile`'s `title` does when it's a title from jobs finished: a rejection short of its
 * count (`not_earned`, which is every job title before `open_jobs`), else what `showTitle` does.
 * The title is kept where a skill's is, so a resident shows one or the other.
 */
export function checkJobTitle(
  state: WorldState,
  id: ResidentId,
  title: JobTitle,
): Mutation | Rejection | undefined {
  const { label, at } = JOB_TITLE_INFO[title];
  const jobs = JOBS[at];
  const mine = jobsDone(state, id);
  if (mine < jobs) {
    return refuse(
      "not_earned",
      `${label} comes with ${jobs} jobs finished, and you've finished ${mine}.`,
    );
  }
  return showTitle(state, id, title);
}

/**
 * The first job garment in `wear` that the resident hasn't finished enough jobs for, as a
 * `not_earned` rejection, or null. `join` and `profile` call it beside the skills' earned wear.
 */
export function unearnedJobWear(
  state: WorldState,
  id: ResidentId,
  wear: readonly unknown[],
): Rejection | null {
  const mine = jobsDone(state, id);
  const item = wear.find(isJobWear);
  if (item === undefined || mine >= JOBS.wearAt) return null;
  return refuse(
    "not_earned",
    `The ${JOB_WEAR_INFO[item].label.toLowerCase()} comes with ${JOBS.wearAt} jobs finished, and you've finished ${mine}.`,
  );
}

/**
 * What `merge_resident` does to jobs: `from`'s count of jobs finished joins `into`'s, with a
 * `job_total` for `into`, and what only counts toward now is dropped: the job `from` held, their
 * place on today's list, and their count this week.
 */
export function mergeJobs(state: WorldState, from: ResidentId, into: ResidentId): WorldEvent[] {
  const jobs = state.jobs;
  if (!jobs) return [];
  letGo(jobs, from);
  const today = (jobs.doneToday ?? []).filter((id) => id !== from);
  if (today.length > 0) jobs.doneToday = today;
  else delete jobs.doneToday;
  if (jobs.week && Object.hasOwn(jobs.week.done, from)) delete jobs.week.done[from];
  const theirs = own(jobs.total, from);
  if (!jobs.total || theirs === undefined) return [];
  delete jobs.total[from];
  const total = (own(jobs.total, into) ?? 0) + theirs;
  jobs.total[into] = total;
  return [{ type: "job_total", residentId: into, total }];
}

/**
 * At `new_day`: today's list of who finished a job starts again, and a held job lapses once
 * `JOBS.keepDays` days have passed since it was taken, with a `job_dropped` for its resident, in
 * id order. Nothing is lost with it. The week's count stays: it starts again with the first job
 * finished in a later week.
 */
export function jobsNewDay(state: WorldState, day: number): Mutation | null {
  const jobs = state.jobs;
  if (!jobs) return null;
  const lapsed = Object.entries(jobs.held ?? {})
    .filter(([, held]) => day - held.day >= JOBS.keepDays)
    .sort(([a], [b]) => (a < b ? -1 : 1));
  if (!jobs.doneToday && lapsed.length === 0) return null;
  return () => {
    delete jobs.doneToday;
    return lapsed.map(([id, held]): WorldEvent => {
      letGo(jobs, id);
      return { type: "job_dropped", residentId: id, job: held.job, lapsed: true };
    });
  };
}
