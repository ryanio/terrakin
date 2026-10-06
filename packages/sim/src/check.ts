import type { Rejection, RejectionCode } from "./types";

/** The small helpers every rule module's checks share. */

export const refuse = (code: RejectionCode, message: string): Rejection => ({ code, message });

/** A whole number the sim can count with exactly. */
export const isWhole = (n: unknown): n is number =>
  typeof n === "number" && Number.isSafeInteger(n);

/** "1 coin", "40 coins". */
export const coinCount = (n: number) => (n === 1 ? "1 coin" : `${n} coins`);
