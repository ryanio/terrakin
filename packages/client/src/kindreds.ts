/**
 * Kindreds (RFC 0033) in words, for the kindred's page and the Town Hall's Kindreds section. Pure,
 * so tests pin them. A kindred's name and residents' names are their own words: these lines put
 * them in as plain strings, and the views draw them as text.
 */
import type { KindredInvite, KindredMember, KindredSummary } from "@terrakin/protocol";
import { relativeDayWords } from "@terrakin/sim";
import { plural } from "@terrakin/ui/format";

/** "Forming" or "Formed". */
export const statusWords = (status: KindredSummary["status"]) =>
  status === "formed" ? "Formed" : "Forming";

/** "1 member", "4 members". */
export const membersWords = (n: number) => plural(n, "member", "members");

/** "Gathered 3 weeks, 2 in a row", "Hasn't gathered yet". */
export function gatheredLine(weeks: number, run: number): string {
  if (weeks === 0) return "Hasn't gathered yet";
  const total = `Gathered ${plural(weeks, "week", "weeks")}`;
  return run > 1 ? `${total}, ${run} in a row` : total;
}

/** "Ada invited you. It has 4 members." */
export const inviteLine = (i: Pick<KindredInvite, "by" | "members">) =>
  `${i.by.name} invited you. It has ${membersWords(i.members)}.`;

/**
 * When an invite lapses, relative to the world's day (the page's `day`, never this device's
 * clock): "Lapses tomorrow", "Lapses in 7 days".
 */
export const inviteOpenLine = (lapsesDay: number, today: number) =>
  `Lapses ${relativeDayWords(lapsesDay, today)}`;

/** "Steward · Founded it", "Joined today", "Joined 3 days ago". */
export function memberLine(
  m: Pick<KindredMember, "steward" | "since">,
  founder: boolean,
  today: number,
): string {
  const joined = founder ? "Founded it" : `Joined ${relativeDayWords(m.since, today)}`;
  return m.steward ? `Steward · ${joined}` : joined;
}

/** "Its hall is plot 4, 2", "No hall yet". */
export const hallWords = (hall: KindredSummary["hall"]) =>
  hall ? `Its hall is plot ${hall.px}, ${hall.py}` : "No hall yet";

/** A kindred's row on the Town Hall: its members and how it's gathered. */
export const summaryLine = (k: Pick<KindredSummary, "members" | "gathered" | "run">) =>
  `${membersWords(k.members)} · ${gatheredLine(k.gathered, k.run)}`;
