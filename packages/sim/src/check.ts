import type { Rejection, RejectionCode, WorldEvent } from "./types";

/** The small helpers every rule module's checks share. */

export const refuse = (code: RejectionCode, message: string): Rejection => ({ code, message });

/** A whole number the sim can count with exactly. */
export const isWhole = (n: unknown): n is number =>
  typeof n === "number" && Number.isSafeInteger(n);

/** "1 coin", "40 coins". */
export const coinCount = (n: number) => (n === 1 ? "1 coin" : `${n} coins`);

/**
 * A logged switch that comes once, which only TOWN_ACTOR sends: refused (`already_open`, saying
 * `already`) once `on` is set, then with `notYet` when that names a reason, else a commit that runs
 * `turnOn` and emits `event`. Checks a switch makes before `already_open` come before the call.
 */
export function oneTimeSwitch(sw: {
  on: unknown;
  already: string;
  notYet?: () => Rejection | null;
  turnOn: () => void;
  event: WorldEvent;
}): (() => WorldEvent[]) | Rejection {
  if (sw.on) return refuse("already_open", sw.already);
  const notYet = sw.notYet?.();
  if (notYet) return notYet;
  return () => {
    sw.turnOn();
    return [sw.event];
  };
}
