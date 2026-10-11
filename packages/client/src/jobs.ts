/**
 * The town's jobs (RFC 0030) in plain words. The server owns the board, every bound, and every
 * count, and says whether you can take a job (`you.canTake` and `you.why`); this only says it, and
 * picks which button a row shows from that answer. A job's words are the server's fixed ones, and
 * the giver's name is the town's own, never a resident's text. Pure and tested.
 */
import {
  type HeldJobView,
  type JobDeedView,
  type JobGiverView,
  type JobsResponse,
  type JobView,
  unlockedAt,
} from "@terrakin/protocol";
import {
  ITEM_INFO,
  isJobWear,
  type JobWear,
  jobUnlocks,
  type ShownTitle,
  skillName,
  titleLabel,
  WEAR_INFO,
} from "@terrakin/sim";
import { plural } from "@terrakin/ui/format";
import { canNowLine } from "./levels";

/** Where you stand, as `GET /v1/jobs` answers with a token. */
export type JobStanding = NonNullable<JobsResponse["you"]>;

/** What the board and the held job share: enough to say who asked and what for. */
export type JobAsked = Pick<JobView, "from" | "skill" | "title" | "shape" | "deed" | "bring">;

/**
 * Who a job is for, after "for": the giver's name while that townsfolk lives in this world, else
 * the town, as the server's own lines have it.
 */
export const forWhom = (from: JobGiverView): string =>
  from.id === undefined ? "the town" : from.name;

/** A board row's line under the job's words: "For Bram". */
export const askedLine = (from: JobGiverView): string => `For ${forWhom(from)}`;

/** How many more jobs can count this week. */
export const weekLeft = (week: JobStanding["week"]): number => Math.max(0, week.max - week.done);

/** The line under the board: "2 of 3 left this week", and when more count once none are. */
export function weekLine(week: JobStanding["week"]): string {
  const left = weekLeft(week);
  const line = `${left} of ${week.max} left this week`;
  return left > 0 ? `${line}.` : `${line}. Jobs count again from Monday.`;
}

/**
 * What a board row offers: Take when the server says one can be taken, a mark on the job you
 * already hold, and nothing otherwise (nobody signed in, or the server's reason, which the list
 * says once under its rows).
 */
export type JobRowAction = "take" | "held" | "none";
export function jobRowAction(job: Pick<JobView, "id">, you: JobStanding | null): JobRowAction {
  if (!you) return "none";
  if (you.held?.job === job.id) return "held";
  return you.canTake ? "take" : "none";
}

/**
 * Why no row has a Take button, in the server's words, or null when one does or the reason is
 * already on screen (the job you hold sits above the list).
 */
export const cantTakeLine = (you: JobStanding | null): string | null =>
  !you || you.canTake || you.held ? null : (you.why ?? null);

/** What the job you hold can do: a bring job is handed in, and any job can be let go. */
export const heldMoves = (held: Pick<HeldJobView, "shape">): ("hand_in" | "drop")[] =>
  held.shape === "bring" ? ["hand_in", "drop"] : ["drop"];

/** A held job's bar: how far along it is, in the words a screen reader says. */
export function heldBar(held: Pick<HeldJobView, "count" | "of" | "shape">): {
  count: number;
  total: number;
  label: string;
} {
  const count = Math.min(held.count, held.of);
  return {
    count,
    total: held.of,
    label: held.shape === "bring" ? "Not handed in yet" : `${count} of ${held.of} done`,
  };
}

/** The line under a held job's bar: where it stands, and what finishes it. */
export function heldLine(held: Pick<HeldJobView, "count" | "of" | "shape">): string {
  if (held.shape === "bring") return "Make it yourself, then hand it in. It goes to the town.";
  return `${Math.min(held.count, held.of)} of ${held.of} done.`;
}

/** How long a held job is kept, from the world's day: "5 days left to finish it." */
export function keptLine(held: Pick<HeldJobView, "lapsesDay">, day: number | null): string | null {
  if (day === null) return null;
  const days = held.lapsesDay - day;
  if (days <= 0) return null;
  return days === 1
    ? "Today is the last day to finish it. Nothing is lost if it lapses."
    : `${days} days left to finish it. Nothing is lost if it lapses.`;
}

/** The world's chip while you hold a job: "Job: 1 of 3". */
export const chipLabel = (held: Pick<HeldJobView, "count" | "of">): string =>
  `Job: ${Math.min(held.count, held.of)} of ${held.of}`;

/** One kind's plural in running words: "herbs", "jars of lemon jam". */
const kinds = (kind: string): string | undefined =>
  Object.hasOwn(ITEM_INFO, kind)
    ? ITEM_INFO[kind as keyof typeof ITEM_INFO].plural.toLowerCase()
    : undefined;

/** What a deed job counts, as the words after "2 of 3": "harvests of herbs", "fish", "games". */
export function deedNoun(deed: JobDeedView): string {
  switch (deed.type) {
    case "harvest": {
      // A harvest counts once however much it brings up, so the word is the harvest, with the
      // crop as the job's own words have it: "harvests of herbs", not "bunches of herbs".
      const crop = deed.crops?.length === 1 ? kinds(deed.crops[0] ?? "") : undefined;
      return crop ? `harvests of ${crop.replace(/^.+ of /, "")}` : "harvests";
    }
    case "craft":
      return kinds(deed.recipe) ?? "made";
    case "find":
      return "finds";
    case "fish":
      return "fish";
    case "teach":
      return "lessons";
    case "guest":
    case "host":
      return "events";
    case "bounty":
      return "bounties";
    case "game":
      return deed.first ? "wins" : "games";
  }
}

/** A deed that moved your job: "2 of 3 harvests of herbs for Juniper." */
export function progressLine(
  progress: { count: number; of: number },
  job: Pick<JobAsked, "from" | "deed"> | undefined,
): string {
  const so = `${progress.count} of ${progress.of}`;
  if (!job) return `Your job: ${so} done.`;
  return `${so} ${job.deed ? deedNoun(job.deed) : "done"} for ${forWhom(job.from)}.`;
}

/**
 * A job you just finished: "Job done for Juniper: 10 Growing points. 2 left this week.", then what
 * the count unlocked, when it reached something. `perWeek` is the server's bound when it's known.
 */
export function doneLine(
  done: { skill: JobView["skill"]; points: number; week: number; total: number },
  from: JobGiverView | undefined,
  perWeek: number | undefined,
): string {
  const whom = from ? ` for ${forWhom(from)}` : "";
  const left = perWeek === undefined ? undefined : Math.max(0, perWeek - done.week);
  const week =
    left === undefined
      ? ""
      : left > 0
        ? ` ${left} left this week.`
        : " That's every job that counts this week.";
  const unlocked = unlockedAt(done.total);
  const now = unlocked ? canNowLine([unlocked]) : null;
  return `Job done${whom}: ${done.points} ${skillName(done.skill)} points.${week}${now ? ` ${now}` : ""}`;
}

/** A job that lapsed after its seven days, or one you let go. */
export const droppedLine = (lapsed: boolean): string =>
  lapsed ? "Your job lapsed. Nothing is lost, and you can take another." : "You let the job go.";

/** One thing the count unlocks, in a few words: "the town satchel", "the title Helping hand". */
const unlockWords = (u: { title?: ShownTitle | undefined; wear?: JobWear | undefined }): string =>
  u.wear
    ? `the ${WEAR_INFO[u.wear].label.toLowerCase()}`
    : `the title ${titleLabel(u.title as ShownTitle)}`;

/**
 * The skills sheet's row for jobs: "Jobs: 12 finished", a bar from the last thing the count
 * unlocked to the next, and what that is. Full, with nothing left to say, past the last one.
 */
export function jobsRow(finished: number): {
  name: string;
  bar: { count: number; total: number; label: string };
  lines: string[];
  /** The garment the count brings, and whether it's reached, for the row's picture. */
  wear: { item: JobWear; reached: boolean } | undefined;
} {
  const unlocks = jobUnlocks();
  const garment = unlocks.find((u) => u.wear);
  const wear =
    garment?.wear === undefined
      ? undefined
      : { item: garment.wear, reached: finished >= garment.jobs };
  const name = `Jobs: ${finished} finished`;
  const next = unlocks.find((u) => u.jobs > finished);
  if (!next) {
    return {
      name,
      bar: { count: 1, total: 1, label: "Everything jobs bring is yours" },
      lines: ["Nothing left to unlock."],
      wear,
    };
  }
  const from = Math.max(0, ...unlocks.filter((u) => u.jobs <= finished).map((u) => u.jobs));
  const count = finished - from;
  const total = next.jobs - from;
  return {
    name,
    bar: {
      count,
      total,
      label: `${count} of ${plural(total, "job", "jobs")} to ${unlockWords(next)}`,
    },
    lines: [`${plural(next.jobs, "job", "jobs")} finished bring ${unlockWords(next)}.`],
    wear,
  };
}

/** The titles your count of jobs has unlocked, from `you.unlocked`, for the title picker. */
export const jobTitles = (unlocked: JobStanding["unlocked"]): ShownTitle[] =>
  unlocked.flatMap((u) => (u.title ? [u.title] : []));

/** The garments your count of jobs has unlocked, from `you.unlocked`, for the look editor. */
export const jobWear = (unlocked: JobStanding["unlocked"]): JobWear[] =>
  unlocked.flatMap((u) => (isJobWear(u.wear) ? [u.wear] : []));

/** What the look editor says on the job garment before it's reached: "25 jobs". */
export function jobWearAt(item: JobWear): string {
  const at = jobUnlocks().find((u) => u.wear === item)?.jobs;
  return at === undefined ? "Jobs" : plural(at, "job", "jobs");
}
