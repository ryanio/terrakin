import {
  chebyshev,
  isRecipeName,
  isTownsfolk,
  knows,
  type RecipeName,
  rejoined,
  residentById,
  taughtToday,
  teachable,
  townsfolkLessonDue,
  type WorldState,
} from "@terrakin/sim";
import { specialtiesFor } from "./lesson-plan";
import type { SocialService } from "./social-service";
import { report } from "./telemetry";
import type { WorldService } from "./world-service";

/**
 * Townsfolk lessons (RFC 0024): a townsfolk teaches one of their specialties (`SPECIALTIES` in
 * `lesson-plan.ts`) to a resident standing within reach of them who doesn't know it, at most once
 * a week per resident. `run`, from the minute sweep after welcome visits, looks at each townsfolk
 * in turn and sends an ordinary `teach` from them through `arrive` and `act`, as `/v1/actions`
 * does, so the sim checks every rule (both online and within reach, the learner's lesson of the
 * day, the townsfolk's week) and the server's own checks apply too (blocks either way, a suspended
 * learner). The learner hears it like any lesson: the toast in the world and a `recipe_taught`
 * notification.
 *
 * Guards here, before anything is sent: only the townsfolk's specialties, only residents within
 * reach of where that townsfolk stands, never a suspended resident or one blocked either way, never
 * someone taught today or by a townsfolk in the last week, nothing while recipes aren't learned in
 * the world, at most `LESSONS.perRun` lessons a run, and `TERRAKIN_TOWNSFOLK_LESSONS` (`off` by
 * default) turns it all off. A dry run checks each learner's lesson once a world day. Logs carry
 * counts and codes only.
 */

export type LessonsMode = "off" | "dry" | "on";
const LESSONS_MODES: readonly LessonsMode[] = ["off", "dry", "on"];

/** `TERRAKIN_TOWNSFOLK_LESSONS`: `off` (the default), `dry`, or `on`. */
export function lessonsMode(env: { TERRAKIN_TOWNSFOLK_LESSONS?: string | undefined }): LessonsMode {
  const mode = env.TERRAKIN_TOWNSFOLK_LESSONS?.trim();
  return LESSONS_MODES.includes(mode as LessonsMode) ? (mode as LessonsMode) : "off";
}

export const LESSONS = {
  /** Lessons a run, across every townsfolk, so a crowd at the cafe spreads over a few minutes. */
  perRun: 3,
} as const;

/** What a run came to. Counts and codes only. */
export interface LessonsRun {
  skipped?: "off" | "closed";
  /** Lessons given (in a dry run, the ones that would be). */
  taught: number;
  /** Refusal codes from the world, in order. */
  codes: string[];
}

export interface TownsfolkLessonsOptions {
  mode: LessonsMode;
  world: WorldService;
  social: SocialService;
  /** The founding townsfolk, from `TERRAKIN_TOWNSFOLK`. */
  townsfolk: ReadonlySet<string>;
}

/** One lesson the run would give: who teaches whom what. */
export interface Lesson {
  by: string;
  to: string;
  recipe: RecipeName;
}

/** A townsfolk's specialties as recipes, by the handle they go by. Never resident text. */
function specialtiesOf(handle: string | undefined): RecipeName[] {
  return specialtiesFor(handle).filter(isRecipeName);
}

/**
 * What a townsfolk could teach `viewer` (their profile's `canTeach`): their specialties the viewer
 * doesn't know. Empty before recipes are learned.
 */
function townsfolkCanTeach(state: WorldState, handle: string | undefined, viewer: string) {
  if (!state.recipes) return [];
  return specialtiesOf(handle).filter((r) => !knows(state, viewer, r));
}

/**
 * A profile's `canTeach` and `canLearn` (RFC 0024): what `subject` could teach `viewer`, and what
 * `viewer` could teach them. Absent without a viewer, on your own profile, across a block either
 * way (a lesson can't cross one), and before recipes are learned. A townsfolk teaches only their
 * specialties, so theirs lists those.
 */
export function teachFields(
  state: WorldState,
  subject: string,
  viewer: string | undefined,
  checks: {
    handleOf: (id: string) => string | undefined;
    blockedEither: (a: string, b: string) => boolean;
  },
): { canTeach?: RecipeName[]; canLearn?: RecipeName[] } {
  if (!state.recipes || viewer === undefined || viewer === subject) return {};
  if (!residentById(state, viewer) || !residentById(state, subject)) return {};
  if (checks.blockedEither(viewer, subject)) return {};
  const { handleOf } = checks;
  const canTeach = isTownsfolk(state, subject)
    ? townsfolkCanTeach(state, handleOf(subject), viewer)
    : teachable(state, subject, viewer);
  return { canTeach, canLearn: teachable(state, viewer, subject) };
}

/**
 * The lessons due now, at most `LESSONS.perRun`: for each townsfolk in id order, the residents
 * online within reach of where they stand (or would stand, coming back), nearest first, each the
 * first specialty they don't know. Pure over the world and the checks passed in.
 */
function planLessons(
  state: WorldState,
  townsfolk: readonly string[],
  checks: {
    handleOf: (id: string) => string | undefined;
    suspended: (id: string) => boolean;
    blockedEither: (a: string, b: string) => boolean;
    /** A learner to pass over this run. */
    skip?: (id: string) => boolean;
  },
): Lesson[] {
  const day = state.day;
  if (!state.recipes || day === undefined) return [];
  const lessons: Lesson[] = [];
  const taught = new Set<string>();
  for (const by of [...townsfolk].sort()) {
    if (lessons.length >= LESSONS.perRun) break;
    const teacher = residentById(state, by);
    if (!teacher || !isTownsfolk(state, by) || checks.suspended(by)) continue;
    const specialties = specialtiesOf(checks.handleOf(by));
    if (specialties.length === 0) continue;
    const at = teacher.online ? teacher : (rejoined(state, by) ?? teacher);
    const near = Object.values(state.residents)
      .filter(
        (r) =>
          r.online &&
          r.id !== by &&
          !taught.has(r.id) &&
          !isTownsfolk(state, r.id) &&
          chebyshev(r, at) <= state.config.reach,
      )
      .sort((a, b) => chebyshev(a, at) - chebyshev(b, at) || (a.id < b.id ? -1 : 1));
    for (const r of near) {
      if (checks.skip?.(r.id) || checks.suspended(r.id) || checks.blockedEither(by, r.id)) continue;
      if (taughtToday(state, r.id) > 0 || !townsfolkLessonDue(state, r.id, day)) continue;
      const recipe = specialties.find((s) => !knows(state, r.id, s));
      if (!recipe) continue;
      lessons.push({ by, to: r.id, recipe });
      taught.add(r.id);
      break;
    }
  }
  return lessons;
}

export class TownsfolkLessons {
  readonly mode: LessonsMode;
  private readonly world: WorldService;
  private readonly social: SocialService;
  private readonly townsfolk: ReadonlySet<string>;
  /**
   * In a dry run, each learner already checked, with the world's day it was checked on. A dry run
   * teaches nothing, so without this it would check the same lesson every minute, and each check
   * counts as the townsfolk acting, which keeps an online townsfolk from going idle.
   */
  private readonly dryChecked = new Map<string, number>();

  constructor(options: TownsfolkLessonsOptions) {
    this.mode = options.mode;
    this.world = options.world;
    this.social = options.social;
    this.townsfolk = options.townsfolk;
  }

  /** The lessons due now, as `planLessons` reads them from the world and the social layer. */
  plan(): Lesson[] {
    const day = this.world.state.day;
    return planLessons(this.world.state, [...this.townsfolk], {
      handleOf: (id) => this.social.authorView(id)?.handle,
      suspended: (id) => this.social.safety.suspendedUntil(id) !== undefined,
      blockedEither: (a, b) => this.social.blockedEither(a, b),
      skip: (id) => this.mode === "dry" && this.dryChecked.get(id) === day,
    });
  }

  /** Give the lessons that are due. A refusal is a code in the run, never a retry. */
  run(): LessonsRun {
    const result: LessonsRun = { taught: 0, codes: [] };
    if (this.mode === "off") return { ...result, skipped: "off" };
    if (!this.world.state.recipes) return { ...result, skipped: "closed" };
    const dry = this.mode === "dry";
    const day = this.world.state.day;
    for (const [id, on] of this.dryChecked) if (on !== day) this.dryChecked.delete(id);
    for (const lesson of this.plan()) {
      // Checked once a day: a dry run's answer won't change until the learner does something.
      if (dry && day !== undefined) this.dryChecked.set(lesson.to, day);
      try {
        if (!dry && !this.world.arrive(lesson.by, "teach").ok) {
          result.codes.push("arrive");
          continue;
        }
        const done = this.world.act(lesson.by, {
          type: "teach",
          recipe: lesson.recipe,
          to: lesson.to,
          ...(dry ? { dry: true } : {}),
        });
        if (done.ok) result.taught++;
        else result.codes.push(done.error.code);
      } catch (err) {
        report(err, "lessons.run");
        result.codes.push("error");
      }
    }
    if (result.taught > 0 || result.codes.length > 0) {
      console.info(
        `Townsfolk lessons (${this.mode}): taught ${result.taught}${result.codes.length ? ` (${result.codes.join(" ")})` : ""}`,
      );
    }
    return result;
  }
}
