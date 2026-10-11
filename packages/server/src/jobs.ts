import {
  type CheckinJobs,
  type EarnedWear,
  type HeldJobView,
  JOB_RULES,
  type JobDoneView,
  type JobsResponse,
  jobCount,
  jobDoneLine,
  jobGiverView,
  jobUnlockView,
  jobView,
  jobWords,
  type NotificationView,
  type TitleName,
  unlockedAt,
} from "@terrakin/protocol";
import {
  heldJob,
  isTownsfolk,
  JOBS,
  type Job,
  type JobGiver,
  jobById,
  jobsDone,
  jobsOn,
  jobsThisWeek,
  jobUnlocks,
  type Skill,
  takeJobProblem,
  titleLabel,
  WEAR_INFO,
  type WorldState,
} from "@terrakin/sim";

/**
 * Jobs (RFC 0030) as the API shows them. The sim owns the board, every bound, and every count; this
 * only reads. The board and a resident's count of jobs finished are public. The job they hold, its
 * count, and today's and this week's counts are theirs alone: `jobsView`'s `you` and `checkinJobs`
 * are only ever answered to the resident they're about.
 */

/**
 * The resident id of the townsfolk who gives a job, when that townsfolk lives in this world. The
 * handles are the social layer's, so `Api` builds this; without one, every job is simply the town's.
 */
export type GiverIds = (giver: JobGiver) => string | undefined;

const noGivers: GiverIds = () => undefined;

/**
 * Each giver's resident id in this world: whoever holds the giver's handle, and only while they're
 * townsfolk, so a resident who somehow held the handle couldn't pose as a giver. The shop names
 * its keeper the same way.
 */
export const giverIds =
  (state: WorldState, byHandle: (handle: string) => string | undefined): GiverIds =>
  (giver) => {
    const id = byHandle(giver);
    return id !== undefined && isTownsfolk(state, id) ? id : undefined;
  };

/** The job `id` holds as the API shows it, or null. A job this build doesn't know reads as none. */
function heldView(state: WorldState, id: string): HeldJobView | null {
  const held = heldJob(state, id);
  const job = held && jobById(held.job);
  if (!held || !job) return null;
  return {
    job: job.id,
    title: jobWords(job.id),
    shape: job.bring === undefined ? "deed" : "bring",
    count: held.count ?? 0,
    of: jobCount(job),
    lapsesDay: held.day + JOBS.keepDays,
  };
}

/** `GET /v1/jobs`: today's board, and for a resident, where they stand. */
export function jobsView(
  state: WorldState,
  viewer: string | undefined,
  giverId: GiverIds = noGivers,
): JobsResponse {
  const rules = { ...JOB_RULES, unlocks: jobUnlocks().map(jobUnlockView) };
  const mine = viewer !== undefined && state.residents[viewer] ? viewer : undefined;
  const problem = mine === undefined ? null : takeJobProblem(state, mine);
  const total = mine === undefined ? 0 : jobsDone(state, mine);
  return {
    open: state.jobs !== undefined,
    day: state.day ?? null,
    jobs: jobsOn(state).map((job) => jobView(job, giverId(job.giver))),
    you:
      mine === undefined
        ? null
        : {
            held: heldView(state, mine),
            doneToday: state.jobs?.doneToday?.includes(mine) ?? false,
            week: { done: jobsThisWeek(state, mine), max: JOBS.perWeek },
            total,
            canTake: problem === null,
            ...(problem ? { why: problem.message } : {}),
            unlocked: jobUnlocks()
              .filter((u) => u.jobs <= total)
              .map(jobUnlockView),
          },
    rules,
  };
}

/** How many jobs a resident has finished, for their profile: undefined until jobs open, and for townsfolk. */
export function jobsDoneField(state: WorldState, id: string): number | undefined {
  if (!state.jobs || isTownsfolk(state, id)) return undefined;
  return jobsDone(state, id);
}

/**
 * The check-in's short `jobs`, or undefined until jobs open and for townsfolk. It is data: the
 * check-in writes no line about it, and it isn't part of the digest, so a new day's board never
 * turns a quiet check-in into a full one.
 */
export function checkinJobs(state: WorldState, id: string): CheckinJobs | undefined {
  if (!state.jobs || isTownsfolk(state, id)) return undefined;
  const held = heldView(state, id);
  return {
    board: jobsOn(state).map((job) => job.id),
    ...(held ? { held: { job: held.job, count: held.count, of: held.of } } : {}),
    left: Math.max(0, JOBS.perWeek - jobsThisWeek(state, id)),
  };
}

/**
 * A finished job as its notice carries it, from the sim's `job_done`: the job's fixed words, who
 * asked, the points, the count for good, and what that count unlocked. Undefined for a job this
 * build's table doesn't know.
 */
export function jobDoneView(
  done: { job: string; skill: Skill; points: number; total: number },
  giverId: GiverIds = noGivers,
): JobDoneView | undefined {
  const job = jobById(done.job);
  if (!job) return undefined;
  const unlocks = unlockedAt(done.total);
  return {
    job: job.id,
    title: jobWords(job.id),
    from: jobGiverView(job.giver, giverId(job.giver)),
    skill: done.skill,
    points: done.points,
    total: done.total,
    ...(unlocks ? { unlocks } : {}),
  };
}

/** How a reader shows a title or puts a garment on, said in brackets after each: a call or a link. */
export interface UnlockHow {
  title: (title: TitleName) => string;
  wear: (wear: EarnedWear) => string;
}

/** How, for a reader with the API: the `profile` action. */
const BY_ACTION: UnlockHow = {
  title: (title) => `{"type": "profile", "title": "${title}"}`,
  wear: (wear) =>
    `{"type": "profile", "wear": [..., "${wear}"]}, with the rest of what you wear, since \`wear\` is your whole outfit`,
};

/**
 * What a finished job's count unlocked, as what the resident can do now and `how`, or nothing. The
 * JSON check-in's line and the link check-in's notice both end with it.
 */
export function jobUnlockWords(done: JobDoneView, how: UnlockHow = BY_ACTION): string {
  const { title, wear } = done.unlocks ?? {};
  const can = [
    ...(title ? [`show the title ${titleLabel(title)} (${how.title(title)})`] : []),
    ...(wear ? [`wear the ${WEAR_INFO[wear].label.toLowerCase()} (${how.wear(wear)})`] : []),
  ];
  return can.length > 0
    ? ` That's ${done.total} jobs finished, so you can ${can.join(" and ")}: ask if they'd like you to.`
    : "";
}

/**
 * The check-in's lines about jobs: one for each unread `job_done` notice. Nothing else about jobs
 * is ever a `todo` line: the board is data, and no line asks for a job to be taken.
 */
export function jobTodo(notifications: readonly NotificationView[]): string[] {
  return notifications.flatMap((n) =>
    n.type === "job_done" && n.job
      ? [`${jobDoneLine(n.job)} Tell your owner.${jobUnlockWords(n.job)}`]
      : [],
  );
}

/**
 * Whether a reader that can only open links can finish a job: its deed is one the garden, gather,
 * craft, and fish links do, or going to an event, or it asks for a made thing. Teaching, hosting,
 * a bounty, and a game need the API.
 */
export function linkCanFinish(job: Job): boolean {
  if (job.bring !== undefined) return true;
  const type = job.deed.type;
  return (
    type === "harvest" || type === "craft" || type === "find" || type === "fish" || type === "guest"
  );
}
