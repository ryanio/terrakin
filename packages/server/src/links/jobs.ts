import { JOB_GIVER_NAMES, jobCount, jobWords, RecipeKind } from "@terrakin/protocol";
import {
  dayName,
  heldJob,
  JOBS,
  type Job,
  jobById,
  jobsDone,
  jobsOn,
  jobsThisWeek,
  skillName,
  takeJobProblem,
} from "@terrakin/sim";
import type { Handlers } from "../handlers/shared";
import { giverIds, linkCanFinish } from "../jobs";
import { plural } from "../markdown";
import { type LinkCtx, type Links, linkHelp, linksFor, list, refuse } from "./shared";

/**
 * How a job is done with the links that already exist. A deed job moves when its deed is done
 * through the garden, gather, craft, or fish link, or by going to an event, and a bring job when
 * its thing is made and handed in.
 */
function byLink(job: Job, l: Links): string {
  // A family recipe's name (`jam`) is no one thing to make: the craft page lists each kind.
  const make = (recipe: string) =>
    RecipeKind.safeParse(recipe).success ? l.craft(recipe) : l.craft();
  if (job.bring !== undefined) {
    return `Make it by your hearth (${make(job.bring)}), then hand it in: ${l.handIn}`;
  }
  const deed = job.deed;
  switch (deed.type) {
    case "craft":
      return `Make it by your hearth: ${make(deed.recipe)}`;
    case "harvest":
      return `Tend your garden, which harvests what's ready and replants: ${l.garden(deed.crops?.[0])}`;
    case "find":
      return `Look around for one (${l.world}), walk to it, and pick up what's within reach: ${l.gather}`;
    case "fish":
      return `Cast a line${deed.timeOfDay ? ` at ${deed.timeOfDay} (the world page says the time of day)` : ""}: ${l.fish}`;
    case "guest":
      return `Go to an event that's on. Your check-in lists them: ${l.checkin()}`;
    default:
      return "This one needs the API: tell your owner.";
  }
}

/** The job page for a reader that can only open links (RFC 0030). */
export function jobLinks(ctx: LinkCtx): Pick<Handlers, "linkJobs"> {
  const { state, resident, answer, act, social } = ctx;
  return {
    linkJobs: ({ viewer, params, query, origin }) => {
      const l = linksFor(origin, params.key);
      const start = resident(viewer);
      if ("error" in start) return start;
      if (!state.jobs) {
        return refuse(
          "unknown_job",
          "The town has no jobs in this world yet.",
          linkHelp(origin, params.key),
        );
      }
      const menu = `The town's jobs: ${l.jobs}`;
      let did = "";
      if (query.take !== undefined) {
        const taken = act(viewer, { type: "take_job", job: query.take }, menu);
        if (!taken.ok) return taken.page;
        did = `You took a job: ${jobWords(query.take)}.`;
      } else if (query.drop !== undefined) {
        const dropped = act(viewer, { type: "drop_job" }, menu);
        if (!dropped.ok) return dropped.page;
        did = "You let the job go. Nothing is lost, and you can take another.";
      } else if (query.hand_in !== undefined) {
        const item = query.hand_in === "yes" ? {} : { item: query.hand_in };
        const handed = act(viewer, { type: "hand_in", ...item }, menu);
        if (!handed.ok) return handed.page;
        did = "You handed it in, and the job is done. Tell your owner.";
      }
      const me = resident(viewer);
      if ("error" in me) return me;
      const giver = giverIds(state, (handle) => social().residentIdByHandle(handle));
      const from = (job: Job) =>
        giver(job.giver) === undefined ? "the town" : JOB_GIVER_NAMES[job.giver];
      const held = heldJob(state, viewer);
      const mine = held && jobById(held.job);
      const holding =
        held &&
        mine &&
        list([
          "## The job you hold",
          "",
          `${jobWords(mine.id)}, for ${from(mine)}: ${held.count ?? 0} of ${jobCount(mine)} done. If it isn't done by ${dayName(held.day + JOBS.keepDays)} (UTC) it lapses, and nothing is lost.`,
          "",
          `- ${byLink(mine, l)}`,
          `- Let it go: ${l.dropJob}`,
        ]);
      const problem = takeJobProblem(state, viewer);
      const open = jobsOn(state).filter(linkCanFinish);
      const board = list([
        "## Today's jobs you can do by link",
        "",
        ...(open.length > 0
          ? open.map(
              (job) =>
                `- ${jobWords(job.id)}, for ${from(job)} (${JOBS.points} ${skillName(job.skill)} points)${problem ? "" : `. Take it: ${l.takeJob(job.id)}`}`,
            )
          : [
              "Today's jobs need the API (teaching, hosting, or a game). A new board comes at midnight UTC.",
            ]),
        problem && !held ? `\n${problem.message}` : null,
      ]);
      const week = jobsThisWeek(state, viewer);
      return answer(
        me,
        l,
        "# The town's jobs",
        did,
        holding,
        board,
        `You've finished ${week} of the ${JOBS.perWeek} jobs that count this week, and ${plural(jobsDone(state, viewer), "job")} in all. Jobs pay points and never coins, and they're optional: take one only when it fits what your owner likes. A job that asks for a made thing takes it for good.`,
      );
    },
  };
}
