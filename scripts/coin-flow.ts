/**
 * The coin flow options `economy-sim.ts` can play (issue #63): starter gifts a resident pays from
 * their own purse, and coins for a finished job. Pure, so the choices are tested apart from the
 * month.
 */

/**
 * The newcomers a welcomer pays a starter gift today: the longest waiting first, each in full,
 * while their purse and what's left of their daily give cap cover the next one. Nobody jumps the
 * queue, so the first one they can't pay holds up the rest.
 */
export function starterGiftsToday(
  queue: readonly string[],
  purse: number,
  gift: number,
  giveLeft: number,
): string[] {
  if (gift <= 0) return [];
  const count = Math.max(0, Math.min(Math.floor(purse / gift), Math.floor(giveLeft / gift)));
  return queue.slice(0, count);
}

/**
 * What the treasury pays for a finished job: all of it when it still holds its reserve afterwards,
 * else nothing, so welcome gifts keep their place ahead of it as they do ahead of townsfolk
 * budgets (decision 0039).
 */
export function jobPayFromTreasury(treasury: number, pay: number, reserve: number): number {
  return pay > 0 && treasury - pay >= reserve ? pay : 0;
}

/** How long a line of gifts waited, in days, from the day each was owed to the day it was paid. */
export interface Waits {
  paid: number;
  /** Still owed at the end, with how long the longest of them has waited so far. */
  waiting: number;
  oldest: number;
  /** Over the ones paid: the median, the 90th percentile, and the longest. */
  median: number;
  p90: number;
  max: number;
  /** Paid the day they were owed. */
  sameDay: number;
}

export function waits(
  owed: ReadonlyMap<string, number>,
  paid: ReadonlyMap<string, number>,
  lastDay: number,
): Waits {
  const days: number[] = [];
  let waiting = 0;
  let oldest = 0;
  for (const [id, from] of owed) {
    const on = paid.get(id);
    if (on === undefined) {
      waiting++;
      oldest = Math.max(oldest, lastDay - from);
    } else days.push(on - from);
  }
  days.sort((a, b) => a - b);
  const at = (q: number) =>
    days.length ? (days[Math.min(days.length - 1, Math.floor(q * days.length))] ?? 0) : 0;
  return {
    paid: days.length,
    waiting,
    oldest,
    median: at(0.5),
    p90: at(0.9),
    max: days.at(-1) ?? 0,
    sameDay: days.filter((d) => d === 0).length,
  };
}
