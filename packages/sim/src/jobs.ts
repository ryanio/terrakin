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
import { CIRCLE_TITLE_INFO } from "./circles";
import { isTownsfolk } from "./economy";
import { findEvent } from "./events";
import { findsOpen } from "./gather";
import {
  dayName,
  HOLIDAYS,
  type Holiday,
  holidayLastDay,
  inHoliday,
  nextHolidayStart,
} from "./holiday";
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
  TITLE_INFO,
  townBountyCounts,
} from "./levels";
import { isJobWear, JOB_WEAR, type JobWear, WEAR_INFO } from "./looks";
import { own, residentById } from "./own";
import { clayOpen, finishRank, isPotKind, potName, potsOf } from "./pottery";
import { knownByAll } from "./recipes";
import { type Season, seasonOf, seasonSpan, weekStart } from "./season";
import type { TimeOfDay } from "./time-of-day";
import {
  type Command,
  type GameTable,
  type Good,
  type HeldJob,
  isCircleTitle,
  isJobTitle,
  JOB_TITLES,
  type JobsState,
  type JobTitle,
  type Rejection,
  type ResidentId,
  type ShownTitle,
  type Skill,
  type WorldEvent,
  type WorldState,
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
 * The first edition's table. The first edition has no job for a `guest` deed or a `bounty` deed:
 * both wait on a neighbor's calendar, and the economy run's residents seldom finished them
 * (decision 0255).
 */
const FIRST_TABLE: readonly Job[] = [
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
  {
    id: "marlo_spring_find",
    giver: "marlo",
    skill: "foraging",
    deed: { type: "find", count: 1, kinds: ["cherry_blossom"] },
    season: "spring",
  },
  {
    id: "marlo_summer_find",
    giver: "marlo",
    skill: "foraging",
    deed: { type: "find", count: 1, kinds: ["starfish"] },
    season: "summer",
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
];

/**
 * The table, by edition. An edition is frozen once a live world reads it: a logged `take_job` is
 * checked against its day's board, so the board for a past day must never change. A changed table
 * or a changed rule for reading it is the next edition. A job's id and what it asks stay the same
 * in every edition that has it, so a job held under one edition still finishes under the next.
 *
 * The second edition has the first one's jobs and changes how a lane's regular jobs take their
 * turns (`carriesOn`): each one is the next in table order after the last one the lane gave, so a
 * holiday or a season's edge never sends the lane back to a job it just gave or past one it hadn't.
 *
 * A season's jobs may be added to the shared table before that season first comes round in a live
 * world (RFC 0030's softer case, decision 0268), since no logged day reads them. `jobs.test.ts`
 * pins the boards of every day a live world has logged, so an addition that moves one fails.
 */
/**
 * The third edition (RFC 0047): the second's jobs and two pottery hand-ins, a bowl for Clem's
 * kitchen and a vase for Ansel's flowers, both in the Making lane. Neither is up until clay is out
 * (`partOpen`), so a world on it without pottery reads the second edition's boards.
 */
const POTTERY_JOBS: readonly Job[] = [
  { id: "clem_bowl", giver: "clem", skill: "making", bring: "bowl" },
  { id: "ansel_vase", giver: "ansel", skill: "making", bring: "vase" },
];

/**
 * Whether a job takes turns of its own in its lane while it's up, rather than waiting its place
 * among the lane's regular jobs: a holiday's jobs, every other turn, so a short holiday's come up,
 * and pottery's (RFC 0047), every third turn (`turnsEvery`), so a potter meets one in any week
 * once clay is out and the lane's regular jobs still come round within decision 0265's bound.
 * Only the third edition has pottery's, so the boards of the first two read as they always did.
 */
const takesTurns = (job: Job): boolean => job.holiday !== undefined || POTTERY_JOBS.includes(job);

/** How often a lane's own-turn jobs come: every other turn with a holiday's up, else every third. */
const turnsEvery = (run: { festive: readonly Job[] }): 2 | 3 =>
  run.festive.some((job) => job.holiday !== undefined) ? 2 : 3;

/** The edition pottery's jobs are in, which the server moves the board to once clay is out. */
export const POTTERY_JOB_EDITION = 3;

export const JOB_EDITIONS: Readonly<Record<number, readonly Job[]>> = {
  1: FIRST_TABLE,
  2: FIRST_TABLE,
  3: [...FIRST_TABLE, ...POTTERY_JOBS],
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
 * lesson, bounties for a bounty, and pottery for a pot (RFC 0047). Nothing else a job asks for has
 * a switch that can be off once jobs are open.
 */
function partOpen(state: WorldState, job: Job): boolean {
  if (job.bring !== undefined && isPotKind(job.bring)) return clayOpen(state);
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
 * turn, so a short holiday's jobs always come up. This is the first edition's rule; from the
 * second on, a lane's regular jobs carry on (`carriedBoard`).
 */
function laneJob(up: readonly Job[], turn: number): Job | undefined {
  const regular = up.filter((job) => !takesTurns(job));
  const festive = up.filter((job) => takesTurns(job));
  if (festive.length === 0) return regular[turn % regular.length];
  const half = Math.floor(turn / 2);
  if (turn % 2 === 0 || regular.length === 0) return festive[half % festive.length];
  return regular[half % regular.length];
}

/** The jobs of `table` that are up on `day`: their part of the game open, in season, in their holiday. */
function upOn(state: WorldState, table: readonly Job[], day: number): Job[] {
  const season = seasonOf(day);
  return table.filter(
    (job) =>
      partOpen(state, job) &&
      (job.season === undefined || job.season === season) &&
      (job.holiday === undefined || inHoliday(job.holiday, day)),
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

// ---------- the board from the second edition: lanes that carry on ----------

/**
 * Whether an edition's lanes carry on (decision 0265). In the first edition a lane's regular job
 * is its `turn`th in the list of those up that day, and that list changes size at a season's edge
 * and gives every other turn to a holiday's jobs, so the lane can go back to a job it just gave
 * and leave one unasked for five weeks. From the second edition on, each regular job is the next
 * one up after the last one the lane gave, and a walk that becomes a find takes the finds lane's
 * next one and leaves the fish where it was.
 */
const carriesOn = (edition: number) => edition >= 2;

/** One lane while the jobs up stay the same: its regular jobs and whether a holiday's are up. */
interface LaneRun {
  lane: Lane;
  regular: readonly Job[];
  festive: readonly Job[];
}

/**
 * A slot's lanes with something up, in `SLOTS` order: with two, the first takes the even days and
 * the second the odd ones, on turn `floor(day / 2)`; with one, it takes every day, on turn `day`.
 */
interface SlotRun {
  on: readonly LaneRun[];
}

/** The slots' lanes for the jobs up, which hold from one edge (`nextEdge`) to the next. */
function slotRuns(up: readonly Job[]): SlotRun[] {
  return SLOTS.map((lanes) => ({
    on: lanes
      .map((lane) => {
        const jobs = inLane(up, lane);
        return {
          lane,
          regular: jobs.filter((job) => !takesTurns(job)),
          festive: jobs.filter((job) => takesTurns(job)),
        };
      })
      .filter((run) => run.regular.length + run.festive.length > 0),
  }));
}

/**
 * The next day after `day` on which the jobs up can change: the first day of the next season, or
 * of a holiday, or the day after one ends.
 */
function nextEdge(day: number): number {
  let edge = seasonSpan(day).end;
  for (const holiday of HOLIDAYS) {
    const at = inHoliday(holiday, day)
      ? holidayLastDay(holiday, day) + 1
      : nextHolidayStart(holiday, day);
    if (at !== undefined) edge = Math.min(edge, at);
  }
  return edge;
}

/** Each lane's last regular job given, by its place in the table; a lane that gave none has -1. */
type Given = Map<Lane, number>;

/** A table as the second edition reads it: each job's place in it, and which need nothing bought. */
interface Reading {
  place: ReadonlyMap<Job, number>;
  solo: ReadonlySet<Job>;
}
const reading = (table: readonly Job[]): Reading => ({
  place: new Map(table.map((job, i) => [job, i])),
  solo: new Set(table.filter(soloJob)),
});

/** The first of `regular` after the lane's last one in `table`, going round to the start. */
function nextOf(r: Reading, regular: readonly Job[], last: number): Job | undefined {
  return regular.find((job) => (r.place.get(job) ?? -1) > last) ?? regular[0];
}

/**
 * What a slot gives on `day`: the lane whose day it is, and its job. While a holiday's jobs are
 * up in the lane they take its even turns, and the regular jobs its odd ones, as in the first
 * edition. A regular turn gives the next regular job after the last one (`nextOf`).
 */
function slotGives(
  r: Reading,
  slot: SlotRun,
  day: number,
  given: Given,
): { run: LaneRun; job: Job; regular: boolean } | undefined {
  const shared = slot.on.length === 2;
  const run = shared ? slot.on[day % 2] : slot.on[0];
  if (!run) return undefined;
  const turn = shared ? Math.floor(day / 2) : day;
  const every = turnsEvery(run);
  if (run.festive.length > 0 && (turn % every === 0 || run.regular.length === 0)) {
    const job = run.festive[Math.floor(turn / every) % run.festive.length];
    return job && { run, job, regular: false };
  }
  const job = nextOf(r, run.regular, given.get(run.lane) ?? -1);
  return job && { run, job, regular: true };
}

/**
 * The board on `day` from what each lane last gave: the slots' jobs, then, on a day with no job
 * that needs nothing bought, the walk as the finds lane's next regular job, when it has two or
 * more up so the day either side can't give the same one. The lanes that gave a regular job are
 * in `gave`; a fish the find stood in for isn't, so it comes on the lane's next turn.
 */
function dayBoard(r: Reading, slots: readonly SlotRun[], day: number, given: Given) {
  const picks = slots.map((slot) => slotGives(r, slot, day, given));
  const board = picks.map((pick) => pick?.job);
  const gave = new Map<Lane, Job>();
  for (const pick of picks) if (pick?.regular) gave.set(pick.run.lane, pick.job);
  if (!board.some((job) => job && r.solo.has(job))) {
    const finds = slots[WALK]?.on.find((run) => run.lane === "finds");
    const walk = picks[WALK];
    if (finds && finds.regular.length > 1 && walk) {
      const find = nextOf(r, finds.regular, given.get("finds") ?? -1);
      if (find) {
        board[WALK] = find;
        gave.delete(walk.run.lane);
        gave.set("finds", find);
      }
    }
  }
  return { board, gave };
}

/**
 * Whether a day of `slots` could have no job that needs nothing bought, so its walk could become
 * a find: each slot has something up that needs something bought, or nothing up at all.
 */
const mayChangeWalk = (r: Reading, slots: readonly SlotRun[]) =>
  slots.every(
    (slot) =>
      slot.on.length === 0 ||
      slot.on.some((run) => [...run.regular, ...run.festive].some((job) => !r.solo.has(job))),
  );

/** How many days in `[from, to)` are `rest` past a multiple of `every`. */
const daysIn = (from: number, to: number, every: number, rest: number) =>
  Math.ceil((to - rest) / every) - Math.ceil((from - rest) / every);

/**
 * Each lane's last regular job given before `day`, counted from `from`, the day jobs opened. It
 * goes a stretch at a time between the days the jobs up can change. Where every day of a stretch
 * has a job that needs nothing bought, it counts each lane's regular turns there and moves through
 * the stretch's regular jobs by that count; elsewhere it goes day by day, since a walk that
 * becomes a find moves the finds lane and not the fish.
 */
function lastGiven(
  state: WorldState,
  table: readonly Job[],
  r: Reading,
  from: number,
  day: number,
): Given {
  const given: Given = new Map();
  for (let start = from; start < day; ) {
    const end = Math.min(nextEdge(start), day);
    const slots = slotRuns(upOn(state, table, start));
    if (mayChangeWalk(r, slots)) {
      for (let d = start; d < end; d++) {
        for (const [lane, job] of dayBoard(r, slots, d, given).gave) {
          given.set(lane, r.place.get(job) ?? -1);
        }
      }
    } else {
      for (const slot of slots) {
        const shared = slot.on.length === 2;
        slot.on.forEach((run, i) => {
          if (run.regular.length === 0) return;
          // A lane's days and, while a holiday's jobs are up in it, its odd turns only, or while
          // only pottery's are (RFC 0047), every turn but each third.
          const festive = run.festive.length > 0;
          const every = turnsEvery(run);
          const count = shared
            ? !festive
              ? daysIn(start, end, 2, i)
              : every === 2
                ? daysIn(start, end, 4, 2 + i)
                : daysIn(start, end, 2, i) - daysIn(start, end, 6, i)
            : !festive
              ? end - start
              : every === 2
                ? daysIn(start, end, 2, 1)
                : end - start - daysIn(start, end, 3, 0);
          if (count === 0) return;
          const last = given.get(run.lane) ?? -1;
          const first = Math.max(
            0,
            run.regular.findIndex((job) => (r.place.get(job) ?? -1) > last),
          );
          const job = run.regular[(first + count - 1) % run.regular.length];
          if (job) given.set(run.lane, r.place.get(job) ?? -1);
        });
      }
    }
    start = end;
  }
  return given;
}

/** The board on `day` in an edition whose lanes carry on. */
function carriedBoard(state: WorldState, table: readonly Job[], day: number, opened: number) {
  const r = reading(table);
  const given = lastGiven(state, table, r, Math.min(opened, day), day);
  return dayBoard(r, slotRuns(upOn(state, table, day)), day, given).board;
}

/**
 * Today's board: three jobs, each in a different skill, the same for everyone (RFC 0030, section
 * 2). A pure function of the world's day, the season and holiday it and the days either side fall
 * in, which parts of the game are open, and the edition's table. Empty before `open_jobs`. From
 * the second edition it also reads the day jobs opened, which `carriedBoard` counts from.
 *
 * In the first edition it's what the lanes' turns give (`turns`), with one change. Every day has
 * one job that needs nothing bought (`soloJob`), and the turns leave some days without: the even
 * days when Growing's turn falls on a crop whose seed only the shop sells, beside a fish and a job
 * for a host. On a day like that the walk is a find in place of the fish: the first find up that
 * day that the turns give neither the day before nor the day after, so no job comes two days
 * running.
 */
export function jobsOn(state: WorldState): Job[] {
  const jobs = state.jobs;
  const day = state.day;
  if (!jobs || day === undefined) return [];
  const table = JOB_EDITIONS[jobs.edition] ?? [];
  if (carriesOn(jobs.edition)) {
    return carriedBoard(state, table, day, jobs.opened).filter((job) => job !== undefined);
  }
  const board = turns(state, table, day);
  if (!board.some((job) => job && soloJob(job))) {
    const near = [day - 1, day + 1].map((d) => turns(state, table, d)[WALK]);
    const find = inLane(upOn(state, table, day), "finds").find((job) => !near.includes(job));
    if (find) board[WALK] = find;
  }
  return board.filter((job) => job !== undefined);
}

/**
 * A round of `job`'s lane on `day`: the days it takes the lane to give each of its regular jobs
 * up that day once. That's one turn a job, and a lane that shares its slot with a lane that has
 * something up takes a turn every other day. 0 for a job that isn't a regular job up that day. A
 * job its lane skipped once waits two rounds less a day, so the economy run and `jobs.test.ts`
 * hold every regular job's wait under that (decision 0265).
 */
export function laneRound(state: WorldState, job: Job, day: number): number {
  const table = JOB_EDITIONS[state.jobs?.edition ?? FIRST_EDITION] ?? [];
  return roundIn(upOn(state, table, day), job);
}

/** `laneRound` from the jobs up that day. */
function roundIn(up: readonly Job[], job: Job): number {
  const lane = laneOf(job);
  const regular = inLane(up, lane).filter((j) => !takesTurns(j));
  if (!regular.some((j) => j.id === job.id)) return 0;
  const lanes = SLOTS.find((slot) => slot.includes(lane)) ?? [];
  const shared = lanes.every((l) => inLane(up, l).length > 0);
  return regular.length * (shared ? 2 : 1);
}

/** A regular job's longest wait for the board, from `jobWaits`. */
export interface JobWait {
  job: Job;
  /** The most days it waited, from `from` to the day it was next on the board. */
  wait: number;
  from: number;
  /** The longest round of its lane on those days (`laneRound`). */
  round: number;
}

/**
 * Each regular job's longest wait for the board, from any of `days` that it's up on: the days from
 * there until it's next on the board. A start whose job stops being up before it comes is left
 * out, since a season's job can't come once its season ends. Holiday jobs aren't regular and
 * aren't here. `laneRound`'s bound is `wait < 2 * round - 1`.
 */
export function jobWaits(state: WorldState, days: readonly number[]): JobWait[] {
  const table = JOB_EDITIONS[state.jobs?.edition ?? FIRST_EDITION] ?? [];
  const seen = new Map<number, { up: Job[]; board: Job[] }>();
  const dayOf = (day: number) => {
    let known = seen.get(day);
    if (!known) {
      known = { up: upOn(state, table, day), board: jobsOn({ ...state, day }) };
      seen.set(day, known);
    }
    return known;
  };
  const waits: JobWait[] = [];
  for (const job of table) {
    if (takesTurns(job)) continue;
    let longest: JobWait | undefined;
    for (const from of days) {
      let round = roundIn(dayOf(from).up, job);
      let day = from;
      while (round > 0 && !dayOf(day).board.some((j) => j.id === job.id)) {
        day++;
        const next = roundIn(dayOf(day).up, job);
        round = next > 0 ? Math.max(round, next) : 0;
      }
      if (round === 0) continue;
      if (!longest || day - from > longest.wait) longest = { job, wait: day - from, from, round };
    }
    if (longest) waits.push(longest);
  }
  return waits;
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

/** The job a resident holds, with the day they took it and its count so far. Theirs alone. */
export const heldJob = (state: WorldState, id: ResidentId): HeldJob | undefined =>
  own(state.jobs?.held, id);

/** How many jobs a resident has finished this UTC week. Theirs alone. */
export function jobsThisWeek(state: WorldState, id: ResidentId): number {
  const week = state.jobs?.week;
  if (!week || state.day === undefined || week.start !== weekStart(state.day)) return 0;
  return own(week.done, id) ?? 0;
}

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
  const problem = takeJobProblem(state, actor);
  if (problem || !jobs || day === undefined) {
    return problem ?? refuse("unknown_job", "The town has no jobs in this world yet.");
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

/**
 * Why `actor` couldn't take any of today's jobs now, or null when they could: every check
 * `take_job` makes before it looks at the job it names. A view reads it to say so before the tap.
 */
export function takeJobProblem(state: WorldState, actor: ResidentId): Rejection | null {
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
  // The week before the day: on the day a third job is finished both hold, and the one that says
  // when the next can really be taken is the week's.
  if (jobsThisWeek(state, actor) >= JOBS.perWeek) {
    return refuse(
      "job_limit",
      `You've finished ${JOBS.perWeek} jobs this week, all a week has. The next one can be taken on Monday, ${dayName(weekStart(day) + 7)} (UTC).`,
    );
  }
  if (jobs.doneToday?.includes(actor)) {
    return refuse(
      "job_limit",
      "You finished a job today, and a day has one. The next one can be taken after midnight UTC.",
    );
  }
  return null;
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

/** How rare a pot's finish is, smooth first (RFC 0047); 0 for anything without one. */
const finishRankOf = (good: Good) => finishRank(good.finish);

/**
 * `hand_in {item?}`: finish the bring job you hold with a thing of its recipe that you made
 * yourself, your oldest or the one `item` names. The thing leaves the world. `handInPick` makes
 * every check.
 */
export function checkHandIn(
  state: WorldState,
  actor: ResidentId,
  command: Extract<Command, { type: "hand_in" }>,
): Mutation | Rejection {
  const pick = handInPick(state, actor, command.item);
  if ("code" in pick) return pick;
  const { jobs, items } = state;
  if (!jobs || !items) return noJob();
  const { id } = pick.good;
  const done = finishing(state, jobs, actor, pick.job);
  return () => {
    const mine = inventory(items, actor);
    mine.goods = mine.goods.filter((g) => g.id !== id);
    return [inventoryEvent(actor, "handed_in", [], { lost: [id] }), ...done()];
  };
}

const noJob = () => refuse("no_job", "You aren't holding a job.");

/**
 * The job a `hand_in` would finish and the made thing it would take, or why it's refused: with no
 * bring job held (`no_job`), for someone made townsfolk since they took it (`not_eligible`), and
 * when they hold nothing of the kind that they made, or `item` isn't one (`nothing_to_hand_in`). A
 * thing someone else made, given or bought, never finishes a job.
 *
 * A thing a duplicate record made counts as made by the record it was merged into: a merge is one
 * person's two records becoming one, and a made thing keeps the id that made it.
 *
 * The server answers a `hand_in`, dry or real, with the thing from here, so what it names is what
 * the commit takes.
 */
export function handInPick(
  state: WorldState,
  actor: ResidentId,
  item?: unknown,
): { job: Job; good: Good } | Rejection {
  const jobs = state.jobs;
  const items = state.items;
  const held = own(jobs?.held, actor);
  if (!jobs || !items || !held) return noJob();
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
  const mine = (g: Good) => g.maker === actor || own(state.mergedResidents, g.maker) === actor;
  let good: Good | undefined;
  if (item !== undefined) {
    good =
      typeof item === "string" && ITEM_ID_PATTERN.test(item)
        ? ofKind.find((g) => g.id === item)
        : undefined;
    if (!good) {
      return refuse(
        "nothing_to_hand_in",
        `You don't hold ${wanted} with that id. Leave out item to hand in the oldest one you made, a pot's commonest finish first.`,
      );
    }
    if (!mine(good)) {
      return refuse(
        "nothing_to_hand_in",
        "Someone else made that one. A job takes only a thing you made yourself.",
      );
    }
  } else {
    // A pot (RFC 0047) goes in its commonest finish first, so a job never takes your rarest one
    // unless you name it; anything else has no finish and goes oldest first.
    good = ofKind
      .filter(mine)
      .sort((a, b) => finishRankOf(a) - finishRankOf(b) || madeOrder(a) - madeOrder(b))[0];
    if (!good) {
      // A pot of theirs set down at home (RFC 0047) is theirs to take up first.
      const down = potsOf(state).find(
        (p) => p.pot.by === actor && mine(p.pot.good) && p.pot.good.kind === recipe,
      );
      const takeUp = down
        ? ` Your ${potName(down.pot.good, true)} is set down at (${down.x}, ${down.y}): take it up with {"type": "remove", "x": ${down.x}, "y": ${down.y}${down.floor === 0 ? "" : `, "floor": ${down.floor}`}} first, then hand it in.`
        : "";
      return refuse(
        "nothing_to_hand_in",
        ofKind.length > 0
          ? `Someone else made the ${wanted} you hold. A job takes only a thing you made yourself.${takeUp}`
          : down
            ? `You hold no ${wanted} that you made.${takeUp}`
            : `You hold no ${wanted} that you made. Make one with craft, then hand it in.`,
      );
    }
  }
  return { job, good };
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

/** One thing the count of jobs finished unlocks, with the count it takes. */
export interface JobUnlock {
  jobs: number;
  title?: JobTitle;
  wear?: JobWear;
}

/** Everything the count of jobs finished unlocks, in the order it comes. */
export const jobUnlocks = (): JobUnlock[] =>
  [
    ...JOB_TITLES.map((title) => ({ jobs: JOBS[JOB_TITLE_INFO[title].at], title })),
    ...JOB_WEAR.map((wear) => ({ jobs: JOBS.wearAt, wear })),
  ].sort((a, b) => a.jobs - b.jobs);

/** A title's words: one a skill's level unlocked, one from jobs finished, or one from circle nights. */
export const titleLabel = (title: ShownTitle): string =>
  isJobTitle(title)
    ? JOB_TITLE_INFO[title].label
    : isCircleTitle(title)
      ? CIRCLE_TITLE_INFO[title].label
      : TITLE_INFO[title].label;

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
 * `not_earned` rejection, or null. `join` and `profile` call it beside the skills' earned wear,
 * with the garments the input wears and the ones its `wearStyle` names.
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
    `The ${WEAR_INFO[item].label.toLowerCase()} comes with ${JOBS.wearAt} jobs finished, and you've finished ${mine}.`,
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
