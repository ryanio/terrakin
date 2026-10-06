import { ROUTINES } from "@terrakin/sim";
import { z } from "zod";
import { ErrorCode, RoutineKind, RoutineView } from "./schemas";
import { AuthorView } from "./social";

/**
 * Offline routines (RFC 0009) as the REST API shows them: what you have on, and the away log, a
 * list of what your routines did while you were away. Turn them on with the `set_routines` action,
 * which is in `schemas.ts` with the routine shapes and the `routines_set` event.
 */

/** The numbers the server keeps for routines, beyond the sim's `ROUTINES`. */
export const ROUTINE_LIMITS = {
  /** Routines pause after this many UTC days with no call from their resident; the next call resumes them. */
  pauseAfterDays: 14,
  /** Away log lines are kept this many days. */
  keepDays: 30,
  /** Routine waves one resident can get in a UTC day, from everyone's `greet` together. */
  wavesPerRecipient: 10,
  /** Minutes between a stroll's walk out and its walk back. */
  strollPauseMinutes: 3,
  /**
   * Minutes an away resident is drawn awake, where they are, after a routine's step, before they
   * sleep at home again.
   */
  awakeMinutes: 4,
  /** Away log lines a check-in carries. */
  checkinLines: 20,
  /** Away log lines a page of `GET /v1/routines` holds. */
  pageLines: 30,
} as const;

/** What a client can show beside the routines: the menu's defaults and limits. */
export const ROUTINE_RULES = {
  walkHomeHour: ROUTINES.walkHomeHour,
  strollHour: ROUTINES.strollHour,
  greetMax: ROUTINES.greetMax,
  greetMostMax: ROUTINES.greetMostMax,
  strollTiles: ROUTINES.strollTiles,
  pauseAfterDays: ROUTINE_LIMITS.pauseAfterDays,
  keepDays: ROUTINE_LIMITS.keepDays,
} as const;

export const RoutineRules = z.object({
  /** `walk_home`'s hour when you leave it out, UTC. */
  walkHomeHour: z.number().int(),
  /** `stroll`'s hour when you leave it out, UTC. */
  strollHour: z.number().int(),
  /** `greet`'s waves a day when you leave `max` out. */
  greetMax: z.number().int(),
  /** The most `max` can be. */
  greetMostMax: z.number().int(),
  /** The most tiles a stroll walks in a day, out and back. */
  strollTiles: z.number().int(),
  /** Days with no call from you before your routines pause. Your next call starts them again. */
  pauseAfterDays: z.number().int(),
  /** Days the away log keeps a line. */
  keepDays: z.number().int(),
});

/** How a routine's try went: it `done` its step, was `refused`, or every routine `paused`. */
export const AWAY_RESULTS = ["done", "refused", "paused"] as const;
export const AwayResult = z.enum(AWAY_RESULTS);
export type AwayResult = z.infer<typeof AwayResult>;

/**
 * One line of the away log. The Terrakin server writes it from codes and ids, never from anyone's
 * words: a step that went, a step the world refused with the fix in `reason`, a wave, or a pause.
 */
export const AwayLine = z.object({
  id: z.string().describe("The line's id, like `a_12`. Pass it as `before` for older lines."),
  at: z
    .string()
    .describe("When it happened. A refusal that came back day after day: the latest time."),
  routine: RoutineKind.optional().describe(
    "Which routine. Absent on a `paused` line, which covers them all.",
  ),
  result: AwayResult,
  code: ErrorCode.optional().describe("A `refused` line: why, as the world's error code."),
  reason: z
    .string()
    .optional()
    .describe(
      "A `refused` or `paused` line in plain words, with what would fix it. Written by the Terrakin server from the code.",
    ),
  seq: z.number().int().optional().describe("A step that went: the world's `seq` it took."),
  to: AuthorView.optional().describe(
    "A `greet` line: who you waved at. Their name is their own words, like any name.",
  ),
  days: z
    .number()
    .int()
    .optional()
    .describe("A refusal that came back on several days in a row, folded into one line: how many."),
});
export type AwayLine = z.infer<typeof AwayLine>;

export const RoutinesResponse = z.object({
  routines: z
    .array(RoutineView)
    .describe("The routines you have on, in menu order. Empty when they're all off."),
  paused: z
    .boolean()
    .describe(
      "Whether your routines are held right now: a maintainer suspended you. They also pause after days with no call from you, and your next call starts them again, so this answer never shows that; the away log does.",
    ),
  rules: RoutineRules,
  away: z.object({
    items: z.array(AwayLine).describe("What your routines did while you were away, newest first."),
    next: z
      .string()
      .nullable()
      .describe("Pass as `before` for older lines. Null when there are none."),
  }),
});
export type RoutinesResponse = z.infer<typeof RoutinesResponse>;
