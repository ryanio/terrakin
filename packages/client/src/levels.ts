/**
 * Levels and skills (RFC 0029) in plain words. The server counts every point and says what each
 * level unlocked; this only says it. Pure and tested.
 */
import {
  type LevelUpView,
  type LevelView,
  levelName,
  levelUps,
  type ProgressResponse,
  type UnlockView,
} from "@terrakin/protocol";
import {
  EARNED_WEAR_SKILL,
  type EarnedWear,
  isEarnedWear,
  isJobWear,
  pointsFor,
  type Skill,
  skillName,
  skillUnlocks,
  titleLabel,
  UNLOCKS,
  WEAR_INFO,
  type WearItem,
} from "@terrakin/sim";
import { plural } from "@terrakin/ui/format";

/** "a", "a and b", "a, b, and c". */
const listed = (words: readonly string[]): string =>
  words.length < 3
    ? words.join(" and ")
    : `${words.slice(0, -1).join(", ")}, and ${words[words.length - 1]}`;

/**
 * What a level-up unlocked, as a sentence, or null when it unlocked nothing: "You can wear the sun
 * hat now.", "You can show the title Gardener now.", or both.
 */
export const unlockLine = (levels: readonly LevelUpView[]): string | null =>
  canNowLine(levels.flatMap((up) => (up.unlocks ? [up.unlocks] : [])));

/** What some unlocks let you do, as a sentence, or null for none. A finished job's notice uses it too. */
export function canNowLine(unlocks: readonly UnlockView[]): string | null {
  const can = unlocks.flatMap((u) => [
    ...(u.wear ? [`wear the ${WEAR_INFO[u.wear].label.toLowerCase()}`] : []),
    ...(u.title ? [`show the title ${titleLabel(u.title)}`] : []),
  ]);
  return can.length > 0 ? `You can ${listed(can)} now.` : null;
}

/**
 * A `level_reached` notice in plain words: which levels, a skill's by its name ("Growing 5") and
 * your own as "level 8", then what they unlocked.
 */
export function levelsLine(levels: readonly LevelUpView[]): { line: string; next: string | null } {
  const reached = levels.map((up) => (up.skill ? levelName(up) : `level ${up.level}`));
  return { line: `You reached ${listed(reached)}.`, next: unlockLine(levels) };
}

/** The world's toast for your own level-up: the notice's words on one line. */
function levelToast(levels: readonly LevelUpView[]): string {
  const { line, next } = levelsLine(levels);
  return next ? `${line} ${next}` : line;
}

/**
 * The toast for the levels `me` reached in one input's events (their `level_reached`, and the
 * `progress` that says what a skill's level unlocked), or null when they reached none.
 */
export function myLevelToast(events: readonly { type: string }[], me: string): string | null {
  const ups = levelUps(events).get(me);
  return ups?.length ? levelToast(ups) : null;
}

/** What floats over your figure after a deed that earned points: "+2 Growing". */
export const gainLine = (gain: { skill: Skill; points: number }): string =>
  `+${gain.points} ${skillName(gain.skill)}`;

/** The profile chip's words: "Level 8", with the title they show after it. */
export const chipWords = (view: Pick<LevelView, "level" | "title">): string =>
  view.title ? `Level ${view.level} · ${titleLabel(view.title)}` : `Level ${view.level}`;

/** The chip's metal at level 10, 25, and 50. Drawing only: it comes with nothing. */
export type ChipTone = "copper" | "silver" | "gold";
export const chipTone = (level: number): ChipTone | undefined =>
  level >= 50 ? "gold" : level >= 25 ? "silver" : level >= 10 ? "copper" : undefined;

/**
 * What earns each skill's points, in a line a newcomer can act on. Each is the sim's own rule for
 * that skill (the `...Counts` rules, the event credit, and pets meeting on the green).
 */
export const SKILL_HOW: Readonly<Record<Skill, string>> = {
  growing: "Harvest crops from your planters.",
  making: "Make things at a kitchen, workbench, or kiln.",
  foraging:
    "Pick up finds and recipe pages, and catch fish. Branches, stones, and clay don't count.",
  hosting:
    "Teach a neighbor a recipe, finish a bounty, host an event or go to one, and meet other pets when you walk yours on the green.",
  playing: "Play rated games at the tables in the town square.",
};

/** A bar: `count` of `total`, and what a screen reader says for it. */
interface Bar {
  count: number;
  total: number;
  label: string;
}

/** One unlock in a few words: "the sun hat", "the title Gardener". */
const unlockWords = (u: UnlockView): string =>
  listed([
    ...(u.wear ? [`the ${WEAR_INFO[u.wear].label.toLowerCase()}`] : []),
    ...(u.title ? [`the title ${titleLabel(u.title)}`] : []),
  ]);

/** A row of the skills sheet: a skill's name and level, its bar, and the lines under it. */
export interface SkillRow {
  skill: Skill;
  name: string;
  bar: Bar;
  lines: string[];
}

/**
 * Your own row for a skill, from `GET /v1/progress`: the bar runs from the points this level
 * started at to the points the next one starts at, and the lines say what earns the skill, how many
 * points are left, what today has counted against the cap, and the next thing the skill unlocks.
 */
export function ownSkillRow(
  s: ProgressResponse["skills"][number],
  next: ProgressResponse["next"][number] | undefined,
): SkillRow {
  const from = pointsFor(s.level);
  const total = s.nextAt - from;
  const count = Math.min(total, Math.max(0, s.points - from));
  const after = levelName({ skill: s.skill, level: s.level + 1 });
  const left = s.nextAt - s.points;
  const today =
    s.today >= s.cap
      ? `${s.cap} of ${s.cap} today. That's today's most: more counts tomorrow.`
      : `${s.today} of ${s.cap} today`;
  return {
    skill: s.skill,
    name: levelName(s),
    bar: { count, total, label: `${count} of ${total} points to ${after}` },
    lines: [
      SKILL_HOW[s.skill],
      `${plural(left, "point", "points")} to ${after}`,
      today,
      ...(next ? [`${levelName(next)} brings ${unlockWords(next.unlocks)}.`] : []),
    ],
  };
}

/**
 * Someone else's row for a skill, from their profile's `level`. Their points are private, so the
 * bar counts levels instead: from the last thing the skill unlocked (or level 1) to the next, by
 * the sim's own list, and full once nothing is left. Its first line says what earns the skill.
 */
export function publicSkillRow(skill: Skill, level: number): SkillRow {
  const unlocks = skillUnlocks(skill);
  const next = unlocks.find((u) => u.level > level);
  const name = levelName({ skill, level });
  if (!next) {
    const last = levelName({ skill, level: UNLOCKS.master });
    return {
      skill,
      name,
      bar: { count: 1, total: 1, label: `Past ${last}` },
      lines: [SKILL_HOW[skill], "Nothing left to unlock."],
    };
  }
  const from = Math.max(1, ...unlocks.filter((u) => u.level <= level).map((u) => u.level));
  const goal = levelName({ skill, level: next.level });
  const what = unlockWords({
    ...(next.title ? { title: next.title } : {}),
    ...(next.wear ? { wear: next.wear } : {}),
  });
  const count = level - from;
  const total = next.level - from;
  return {
    skill,
    name,
    bar: { count, total, label: `${count} of ${plural(total, "level", "levels")} to ${goal}` },
    lines: [SKILL_HOW[skill], `${goal} brings ${what}.`],
  };
}

/** The skill and level an earned garment comes at, as the look editor labels one not reached. */
export const earnedAt = (item: EarnedWear): string =>
  levelName({ skill: EARNED_WEAR_SKILL[item], level: UNLOCKS.wear });

/**
 * How the look editor shows a garment: "open" can be put on (everything that isn't earned, and
 * what's earned that they're wearing or have reached), "locked" shows what it comes with instead
 * of a button, and "hidden" isn't listed. `earned` is `GET /v1/progress`'s `wear`, for the
 * garments a skill's level brings, and `fromJobs` the garments their count of jobs finished has
 * unlocked (`you.unlocked` on `GET /v1/jobs`, RFC 0030). Each is undefined while its part of the
 * world isn't open here (or its answer hasn't come), when only what's already worn shows.
 */
export function earnedState(
  item: WearItem,
  wearing: readonly WearItem[],
  earned: readonly string[] | undefined,
  fromJobs?: readonly string[] | undefined,
): "open" | "locked" | "hidden" {
  const fromJob = isJobWear(item);
  if (!isEarnedWear(item) && !fromJob) return "open";
  const reached = fromJob ? fromJobs : earned;
  if (wearing.includes(item) || reached?.includes(item)) return "open";
  return reached ? "locked" : "hidden";
}
