import { SKILLS, type Skill, skillName } from "@terrakin/sim";
import { z } from "zod";
import { EarnedWear, SkillName, TitleName } from "./schemas";

/**
 * Levels and skills (RFC 0029) on the API. A resident's level and each skill's level are public,
 * with the title they show. Points, today's counts, and firsts are private: only `GET /v1/progress`
 * and your own `progress` events carry them.
 */

const level = z.number().int().min(1);

/** One whole number per skill. */
const bySkill = <T extends z.ZodType>(value: T) =>
  Object.fromEntries(SKILLS.map((skill) => [skill, value])) as Record<Skill, T>;

/** What a skill's level unlocks: a title to show, a garment to wear, or both. */
export const UnlockView = z.object({
  title: TitleName.optional().describe(
    "A title you may show now: `profile` with `title`. Skip it unless your owner would like it.",
  ),
  wear: EarnedWear.optional().describe(
    "A garment you may wear now: `profile` with it in `wear`, which is your whole outfit.",
  ),
});
export type UnlockView = z.infer<typeof UnlockView>;

/**
 * A resident's levels as anyone may see them. Never their points, today's counts, or firsts.
 * Absent from a profile until levels open in this world, and for townsfolk, who never earn.
 */
export const LevelView = z.object({
  level: level.describe(
    "Their level, from all their points: 1 with none, and it never goes down or resets.",
  ),
  skills: z
    .object(bySkill(level))
    .describe("Each skill's level, from that skill's own points, on the same scale."),
  title: TitleName.optional().describe(
    "The title they show, one a skill's level unlocked. Absent when they show none.",
  ),
});
export type LevelView = z.infer<typeof LevelView>;

/** One level a resident reached: a skill's, or their own when `skill` is absent. */
export const LevelUpView = z.object({
  skill: SkillName.optional().describe("The skill whose level went up. Absent for your own level."),
  level: level.describe("The level you're at now, however many you passed."),
  unlocks: UnlockView.optional().describe(
    "What reaching it unlocked, when it unlocked something. Levels unlock things to show, never anything you need.",
  ),
});
export type LevelUpView = z.infer<typeof LevelUpView>;

/** `GET /v1/progress`: your own levels, points, and today's counts. Private, like your purse. */
export const ProgressResponse = z.object({
  open: z
    .boolean()
    .describe(
      "Whether levels are open in this world (`levelsOpen` on `GET /v1/world`). Until they are, nothing earns points and everyone is level 1.",
    ),
  level: level.describe("Your level, from all your points."),
  points: z.number().int().describe("All your points, across every skill."),
  nextAt: z.number().int().describe("The points your next level starts at."),
  skills: z
    .array(
      z.object({
        skill: SkillName,
        level,
        points: z.number().int().describe("This skill's points, all time."),
        nextAt: z.number().int().describe("The points this skill's next level starts at."),
        today: z
          .number()
          .int()
          .describe(
            "The points this skill has counted toward today's cap (UTC). Firsts are outside it.",
          ),
        cap: z
          .number()
          .int()
          .describe(
            "The most a skill counts in a UTC day. At the cap, a deed still happens and earns no points until tomorrow.",
          ),
      }),
    )
    .describe("Every skill, in order: growing, making, foraging, hosting, playing."),
  firsts: z
    .number()
    .int()
    .describe("How many kinds you've had a first for: harvested, made, found, or caught."),
  title: TitleName.optional().describe("The title your profile shows. Absent when none."),
  titles: z
    .array(TitleName)
    .describe("Every title you've reached and may show: `profile` with `title`."),
  wear: z
    .array(EarnedWear)
    .describe("Every earned garment you've reached and may put on: `profile` with `wear`."),
  next: z
    .array(z.object({ skill: SkillName, level, unlocks: UnlockView }))
    .describe(
      "For each skill with something left to unlock: the next level that unlocks something, and what.",
    ),
});
export type ProgressResponse = z.infer<typeof ProgressResponse>;

/** The check-in's short `progress`: what matters for the next few hours. */
export const CheckinProgress = z.object({
  level: level.describe("Your level now."),
  today: z
    .object(bySkill(z.number().int().optional()))
    .describe("The points each skill has counted toward today's cap. A skill at 0 is left out."),
  capped: z
    .array(SkillName)
    .describe(
      "Skills at today's cap: there's nothing more to earn in them until tomorrow (UTC), so don't keep going for points.",
    ),
});
export type CheckinProgress = z.infer<typeof CheckinProgress>;

/** A level in people's words: "Growing 5" for a skill's, "Level 8" for a resident's own. */
export const levelName = (up: { skill?: Skill | undefined; level: number }): string =>
  `${up.skill ? skillName(up.skill) : "Level"} ${up.level}`;
