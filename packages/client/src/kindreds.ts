/**
 * Circles (RFC 0033) in words, for the kindred's page and the Town Hall's Kindreds section. Pure,
 * so tests pin them. A kindred's name and residents' names are their own words: these lines put
 * them in as plain strings, and the views draw them as text.
 */
import type {
  KindredInvite,
  KindredMember,
  KindredSummary,
  KindredsResponse,
} from "@terrakin/protocol";
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

/**
 * Who invited you and who founded the kindred (issue #73): "Ada invited you. Juniper founded it,
 * and it has 4 members." A steward who founded it is named once.
 */
export function inviteLine(i: {
  by: { id: string; name: string };
  founder: { id: string; name: string };
  members: number;
}): string {
  const size = `it has ${membersWords(i.members)}`;
  return i.by.id === i.founder.id
    ? `${i.by.name} founded this circle and invited you. Now ${size}.`
    : `${i.by.name} invited you. ${i.founder.name} founded it, and ${size}.`;
}

/**
 * Where the kindred stands, so an invitee knows what they'd be joining: a forming one has a day
 * to form by, a formed one a hall or not.
 */
export function inviteStandingLine(
  i: Pick<KindredInvite, "status" | "hall" | "formsIn">,
  rules: Pick<KindredsResponse["rules"], "formHouseholds">,
): string {
  if (i.status === "forming") {
    return `Still forming: it needs members from ${rules.formHouseholds} households ${i.formsIn ?? "soon"}, or it disbands and the fee goes back.`;
  }
  return `Formed. ${hallWords(i.hall)}.`;
}

/**
 * When an invite lapses, in the world's own words (never this device's clock): "Lapses tomorrow",
 * "Lapses in 7 days".
 */
export const inviteOpenLine = (i: Pick<KindredInvite, "lapsesIn">) => `Lapses ${i.lapsesIn}`;

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

/**
 * What founding costs against your coins, and the way to the rest, before you confirm (issue #69):
 * "Founding takes 25 coins, and you have 8. Your allowance at your hearth, 10 a day, gets you
 * there in about 2 days." Then what comes back if it doesn't form, and that members can chip in.
 */
export function foundingLine(
  rules: Pick<KindredsResponse["rules"], "fee" | "trialBurn" | "formDays" | "allowance">,
  balance: number,
): string {
  const short = rules.fee - balance;
  const days = Math.ceil(short / rules.allowance);
  const path =
    short > 0
      ? ` Your allowance at your hearth, ${rules.allowance} a day, gets you there in about ${plural(days, "day", "days")}.`
      : "";
  return `Founding takes ${rules.fee} coins, and you have ${balance}.${path} If it doesn't form within ${rules.formDays} days, all but ${rules.trialBurn} come back, and members can chip in toward it while it forms.`;
}
