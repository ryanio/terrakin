/**
 * The time of day on the map's clock (RFC 0023): dawn, day, dusk, or night. Day and night is the
 * map's light (decision 0011), a cycle shorter than a UTC day that every client draws from the
 * server's clock, so it never matches the hour. Fishing reads it, as a value the server works out
 * from its own clock and logs with each cast: the sim never reads a clock, and changing the cycle's
 * length never changes how a logged cast replays.
 */

/**
 * One full turn of the map's day and night. It doesn't divide 24 hours, so someone who visits at
 * the same time every day sees a different part of the day each time. Tunable: clients read it
 * from the snapshot's `time`, and a cast logs the time of day it saw, never the length.
 */
export const DAY_LENGTH_MS = 210 * 60_000;

export const TIMES_OF_DAY = ["dawn", "day", "dusk", "night"] as const;
export type TimeOfDay = (typeof TIMES_OF_DAY)[number];

export const isTimeOfDay = (t: unknown): t is TimeOfDay =>
  typeof t === "string" && (TIMES_OF_DAY as readonly string[]).includes(t);

/**
 * Where a moment falls in the map's cycle, 0 to 1: 0 is dawn, 0.25 noon, 0.5 dusk, 0.75 midnight.
 * Wraps cleanly, so a clock before 1970 or a cycle that doesn't divide a UTC day still lands right.
 */
export function dayPhase(ms: number, dayLengthMs: number): number {
  const t = ((ms % dayLengthMs) + dayLengthMs) % dayLengthMs;
  return t / dayLengthMs;
}

/**
 * How dark the map looks at a phase of the cycle: 0 at noon, 1 at midnight, on a smooth curve with
 * dawn and dusk in between. The map and the pictures by link (decision 0160) both draw from it.
 */
export function nightAmount(phase: number): number {
  return (1 - Math.cos((phase - 0.25) * Math.PI * 2)) / 2;
}

/**
 * The time of day at a phase of the cycle: a quarter each, centered on dawn (0), noon (0.25),
 * dusk (0.5), and midnight (0.75).
 */
export function timeOfDay(phase: number): TimeOfDay {
  const p = ((phase % 1) + 1) % 1;
  if (p < 1 / 8 || p >= 7 / 8) return "dawn";
  if (p < 3 / 8) return "day";
  if (p < 5 / 8) return "dusk";
  return "night";
}

/** The time of day at a moment on a clock, on the map's cycle unless another is given. */
export const timeOfDayAt = (ms: number, dayLengthMs = DAY_LENGTH_MS): TimeOfDay =>
  timeOfDay(dayPhase(ms, dayLengthMs));
