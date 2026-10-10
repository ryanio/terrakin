import { JOB_GIVERS, skillName } from "@terrakin/sim";
import { z } from "zod";
import { UnlockView } from "./levels";
import { JobId, SkillName } from "./schemas";

/**
 * A finished job as its `job_done` notification carries it (RFC 0030), and the sentence that says
 * so. It is apart from `jobs.ts` so `social.ts`, and with it the web's first load, takes the
 * notification's shape without the board's views and words.
 */

/** Who asks for a job: one of the founding townsfolk, in fixed words. */
export const JobGiverView = z.object({
  handle: z.enum(JOB_GIVERS).describe("Their handle."),
  name: z.string().describe("Their name, a fixed word from the town's table."),
  id: z
    .string()
    .optional()
    .describe(
      "Their resident id, while that townsfolk lives in this world. Absent in a world without them, where the job is simply the town's.",
    ),
});
export type JobGiverView = z.infer<typeof JobGiverView>;

/** A finished job, on its `job_done` notification. */
export const JobDoneView = z.object({
  job: JobId,
  title: z.string().describe("What it asked, in the team's fixed words."),
  from: JobGiverView,
  skill: SkillName,
  points: z.number().int().describe("The points it added to `skill`."),
  total: z.number().int().describe("Jobs you've finished, counting this one."),
  unlocks: UnlockView.optional().describe(
    "What finishing it unlocked, when your count reached something. To show, never something you need.",
  ),
});
export type JobDoneView = z.infer<typeof JobDoneView>;

/** Whose job it was, in words: "Otis's", or "the town's" in a world without that townsfolk. */
const giverWords = (from: JobGiverView): string =>
  from.id === undefined ? "the town's" : `${from.name}'s`;

/**
 * One finished job in a sentence, from ids and fixed words: "You finished Otis's job, teach a
 * neighbor a recipe: 10 Hosting points." The server's lines and the web's notice share it.
 */
export function jobDoneLine(done: JobDoneView): string {
  const asked = `${done.title.charAt(0).toLowerCase()}${done.title.slice(1)}`;
  return `You finished ${giverWords(done.from)} job, ${asked}: ${done.points} ${skillName(done.skill)} points.`;
}
