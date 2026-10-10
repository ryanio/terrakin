/**
 * Lengths of time in milliseconds, and the UTC day a moment falls in. Arithmetic for code that is
 * handed a clock's reading: nothing here reads a clock.
 */
export const MINUTE_MS = 60_000;
export const HOUR_MS = 60 * MINUTE_MS;
export const DAY_MS = 24 * HOUR_MS;

/** UTC days since 1970-01-01. Everyone's day turns over at once, at midnight UTC. */
export const utcDay = (ms: number) => Math.floor(ms / DAY_MS);
