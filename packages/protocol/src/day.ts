import { DAY_MS } from "@terrakin/sim";

/**
 * `2026-10-04` if it is a real day in that form: a changelog day heading or a devlog post's name.
 * Its own module, so the home wall's devlog card doesn't bring the changelog's parser with it.
 */
export function isDay(text: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(Date.UTC(y, mo - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === mo - 1 && date.getUTCDate() === d;
}

/**
 * The ISO date of a world day: `2026-11-03` for UTC day 20760. A day on the wire is UTC days
 * since 1970-01-01, which sorts and compares cheaply but makes an assistant do calendar
 * arithmetic before it can say a date out loud, so the shapes it reads a date from carry this
 * beside the number. One place turns a day into a date, so the two can never disagree.
 */
export function dayIso(day: number): string {
  return new Date(day * DAY_MS).toISOString().slice(0, 10);
}
