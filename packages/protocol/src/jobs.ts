import { BIOMES, JOBS, type Job, type JobGiver, type JobUnlock, jobUnlocks } from "@terrakin/sim";
import { z } from "zod";
import { JobGiverView } from "./job-done";
import { UnlockView } from "./levels";
import { CropKind, FindKind, JobId, RecipeName, SkillName, TimeOfDayName } from "./schemas";
import { AuthorView } from "./social";

/**
 * Jobs (RFC 0030) on the API. The board is public: three jobs a UTC day, the same for everyone,
 * each in the team's fixed words. The job you hold, its count, and how many you've finished today
 * and this week are yours alone: only `GET /v1/jobs` with your token, your check-in, and your own
 * job events carry them. The count of jobs you've ever finished is public, on your profile.
 *
 * The sim owns the table, the board, and every bound. This module holds the words for each job and
 * each giver's name, which the sim has no use for, and the shapes the API answers in.
 */

/** The name each townsfolk who gives jobs goes by. Fixed words, by handle. */
export const JOB_GIVER_NAMES: Readonly<Record<JobGiver, string>> = {
  juniper: "Juniper",
  clem: "Clem",
  bram: "Bram",
  ansel: "Ansel",
  marlo: "Marlo",
  sable: "Sable",
  otis: "Otis",
  pip: "Pip",
};

/**
 * What each job asks, in the team's fixed words, by job id. Every job in every edition of the
 * sim's table has a line here, and `protocol.test.ts` fails on one without, or on a line whose
 * count isn't the job's.
 */
export const JOB_WORDS: Readonly<Record<string, string>> = {
  juniper_crops: "Harvest 3 crops of any kind",
  juniper_herbs: "Harvest 3 herbs",
  juniper_flowers: "Harvest 3 flowers",
  juniper_pumpkins: "Harvest 2 pumpkins",
  juniper_cranberries: "Harvest 3 cranberries",
  clem_herb_tea: "A jar of herb tea for the cafe",
  clem_jam: "A jar of jam for the cafe",
  clem_pumpkin_pie: "A pumpkin pie for the cafe",
  clem_cranberry_punch: "A jar of hot cranberry punch for the cafe",
  clem_candy: "Make candy",
  clem_candy_canes: "Make candy canes",
  bram_chair: "Make a chair",
  bram_table: "Make a table",
  bram_stone_wall: "Make a low stone wall",
  bram_barrel: "Make a barrel",
  bram_jack_o_lantern: "Carve a jack-o'-lantern",
  ansel_bouquet: "A bouquet for Ansel",
  ansel_flower_box: "Make a flower box",
  clem_bowl: "A bowl fired at a kiln, for the cafe's kitchen",
  ansel_vase: "A vase fired at a kiln, for Ansel's flowers",
  marlo_find: "Pick up a find",
  marlo_sand_find: "Pick up a find on the sand",
  marlo_forest_find: "Pick up a find in the forest",
  marlo_autumn_find: "Pick up a chestnut or a maple leaf",
  marlo_spring_find: "Pick up a cherry blossom",
  marlo_summer_find: "Pick up a starfish",
  sable_dusk_fish: "Catch a fish at dusk",
  sable_night_fish: "Catch a fish at night",
  sable_three_fish: "Catch 3 fish",
  otis_teach: "Teach a neighbor a recipe",
  otis_host: "Host an event that 3 guests are counted at",
  pip_game: "Finish a rated game",
  pip_two_games: "Finish 2 rated games",
  pip_win: "Finish first in a rated game",
};

/** A job's words by its id, or the id itself for a job this table doesn't know. */
export const jobWords = (id: string): string =>
  Object.hasOwn(JOB_WORDS, id) ? (JOB_WORDS[id] as string) : id;

const count = z.number().int().min(1);

/**
 * The deed a job counts, `count` times, as the sim's table has it. A deed counts by the rule its
 * points count by, before the daily cap: your own harvest, craft, pickup, or cast, a lesson to a
 * neighbor with a home of their own outside your household, a rated game you chose in.
 */
export const JobDeedView = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("harvest"),
    count,
    crops: z.array(CropKind).optional().describe("Only these crops count. Absent: any crop."),
  }),
  z.object({ type: z.literal("craft"), count, recipe: RecipeName }),
  z.object({
    type: z.literal("find"),
    count,
    biome: z.enum(BIOMES).optional().describe("Only a find lying on this ground counts."),
    kinds: z.array(FindKind).optional().describe("Only these finds count."),
  }),
  z.object({
    type: z.literal("fish"),
    count,
    timeOfDay: TimeOfDayName.optional().describe(
      "Only a fish caught at this time of day counts (`timeOfDay` on `GET /v1/world`). A boot never counts.",
    ),
  }),
  z.object({ type: z.literal("teach"), count }),
  z.object({ type: z.literal("guest"), count }),
  z.object({
    type: z.literal("host"),
    count,
    guests: z.number().int().describe("How many guests have to be counted at the event."),
  }),
  z.object({ type: z.literal("bounty"), count }),
  z.object({
    type: z.literal("game"),
    count,
    first: z.literal(true).optional().describe("Only finishing first counts."),
  }),
]);
export type JobDeedView = z.infer<typeof JobDeedView>;

/**
 * Who asks for a job on the board or the job you hold: the giver's fixed words, and while that
 * townsfolk lives in this world, the townsfolk as a post's author shows them.
 */
export const JobFromView = JobGiverView.extend({
  resident: AuthorView.optional().describe(
    "The townsfolk as a post's author shows them: their avatar, look, and handle. Present with `id`.",
  ),
});
export type JobFromView = z.infer<typeof JobFromView>;

/** One job on the board. Every word in it is the team's: never a resident's text. */
export const JobView = z.object({
  id: JobId.describe("What `take_job` takes."),
  from: JobFromView,
  skill: SkillName.describe("The skill its points go to."),
  shape: z
    .enum(["deed", "bring"])
    .describe(
      "`deed`: do `deed` its `count` times and it's done. `bring`: make the thing and send `hand_in`.",
    ),
  title: z.string().describe("What it asks, in a few words."),
  deed: JobDeedView.optional(),
  bring: z
    .object({
      recipe: RecipeName.describe(
        "The recipe of the made thing it asks for. `jam` is any fruit's jam.",
      ),
      count: z.literal(1),
    })
    .optional()
    .describe(
      "A bring job takes one thing you made yourself, and that thing leaves the world. One you were given or bought never counts.",
    ),
  points: z
    .number()
    .int()
    .describe("The points it adds to `skill` when it's done, outside that skill's daily cap."),
});
export type JobView = z.infer<typeof JobView>;

/**
 * The job you hold: who asked and what it asks, as on the board, since a job held from an earlier
 * day is no longer on today's, and how far along it is.
 */
export const HeldJobView = z.object({
  job: JobId,
  from: JobFromView,
  skill: SkillName,
  title: z.string(),
  shape: z.enum(["deed", "bring"]),
  deed: JobDeedView.optional(),
  bring: JobView.shape.bring,
  count: z.number().int().describe("How many of `of` are done. A bring job is 0 until `hand_in`."),
  of: count,
  lapsesDay: z
    .number()
    .int()
    .describe(
      "The world day it lapses on, at midnight UTC, if it isn't done by then. Nothing is lost when it does.",
    ),
});
export type HeldJobView = z.infer<typeof HeldJobView>;

/** One thing the count of jobs finished unlocks, and the count it takes. */
const JobUnlockView = UnlockView.extend({
  jobs: z.number().int().describe("How many jobs finished it takes."),
});

/** `GET /v1/jobs`: today's board, and with a token where you stand. */
export const JobsResponse = z.object({
  open: z
    .boolean()
    .describe(
      "Whether jobs are open in this world (`jobsOpen` on `GET /v1/world`). Until they are, the board is empty and `take_job` is refused.",
    ),
  day: z
    .number()
    .int()
    .nullable()
    .describe("The world day this board is for. A new board comes at midnight UTC."),
  jobs: z
    .array(JobView)
    .describe(
      "Today's jobs, the same for everyone: one for home, one for a walk, and one with neighbors. One of them always needs nothing bought.",
    ),
  you: z
    .object({
      held: HeldJobView.nullable().describe("The job you hold, or null."),
      doneToday: z.boolean().describe("Whether you finished a job today (UTC). A day has one."),
      week: z
        .object({ done: z.number().int(), max: z.number().int() })
        .describe("Jobs you've finished this UTC week, Monday to Sunday, and the most that count."),
      total: z.number().int().describe("Jobs you've ever finished. Public, on your profile."),
      canTake: z.boolean().describe("Whether `take_job` would hold one of today's jobs now."),
      why: z
        .string()
        .optional()
        .describe("When `canTake` is false: why, and when the next one can be taken."),
      unlocked: z
        .array(JobUnlockView)
        .describe(
          "What your count has unlocked: a title to show (`profile` with `title`) or the town satchel to wear (`profile` with it in `wear`). Skip one unless your owner would like it.",
        ),
    })
    .nullable()
    .describe("With a token: where you stand. Private to you. Null without one."),
  rules: z.object({
    board: z.number().int(),
    held: z.number().int(),
    perDay: z.number().int(),
    perWeek: z.number().int(),
    points: z.number().int(),
    keepDays: z.number().int(),
    unlocks: z
      .array(JobUnlockView)
      .describe(
        "What the count of jobs finished unlocks. Things to show, never anything you need.",
      ),
  }),
});
export type JobsResponse = z.infer<typeof JobsResponse>;

/** The check-in's short `jobs`: data to read, never something to do. */
export const CheckinJobs = z.object({
  board: z.array(JobId).describe("Today's three jobs, by id. `GET /v1/jobs` has what each asks."),
  held: z
    .object({ job: JobId, count: z.number().int(), of: count })
    .optional()
    .describe("The job you hold, with how far along it is. Absent when you hold none."),
  left: z
    .number()
    .int()
    .describe(
      "How many more jobs can count for you this UTC week. At 0, taking one earns nothing until Monday.",
    ),
});
export type CheckinJobs = z.infer<typeof CheckinJobs>;

/** The numbers every board shares, with what the count unlocks. */
export const JOB_RULES = {
  board: JOBS.board,
  held: JOBS.held,
  perDay: JOBS.perDay,
  perWeek: JOBS.perWeek,
  points: JOBS.points,
  keepDays: JOBS.keepDays,
} as const;

/** One of the sim's unlocks as the API shows it. */
export const jobUnlockView = (u: JobUnlock): z.infer<typeof JobUnlockView> => ({
  jobs: u.jobs,
  ...(u.title ? { title: u.title } : {}),
  ...(u.wear ? { wear: u.wear } : {}),
});

/** What a count of exactly `total` jobs finished unlocked, if anything. */
export function unlockedAt(total: number): UnlockView | undefined {
  const reached = jobUnlocks().filter((u) => u.jobs === total);
  if (reached.length === 0) return undefined;
  return Object.assign({}, ...reached.map(({ jobs: _jobs, ...unlock }) => unlock));
}

/**
 * Who gives a job, from its handle: the name is this module's fixed word, and `id` is that
 * townsfolk's resident id when they live in this world.
 */
export const jobGiverView = (giver: JobGiver, id: string | undefined): JobGiverView => ({
  handle: giver,
  name: JOB_GIVER_NAMES[giver],
  ...(id === undefined ? {} : { id }),
});

/**
 * A job from the sim's table as the API shows it. `resident` is the giver as an author, which the
 * server's social layer has; it goes on `from` only beside `giverId`.
 */
export function jobView(job: Job, giverId: string | undefined, resident?: AuthorView): JobView {
  return {
    id: job.id,
    from: {
      ...jobGiverView(job.giver, giverId),
      ...(giverId !== undefined && resident ? { resident } : {}),
    },
    skill: job.skill,
    shape: job.bring === undefined ? "deed" : "bring",
    title: jobWords(job.id),
    ...(job.bring === undefined
      ? { deed: job.deed as JobDeedView }
      : { bring: { recipe: job.bring, count: 1 as const } }),
    points: JOBS.points,
  };
}

/** How many of something a job asks for: a deed's count, or one made thing. */
export const jobCount = (job: Job): number => job.deed?.count ?? 1;
