/**
 * The words and the one rule behind signing in with a passkey (RFC 0037), pure so tests pin them:
 * what a notice from Terrakin says, how a bound passkey reads in the Signing in sheet, and when a
 * person with no passkey is offered one.
 *
 * Nothing here knows about a device, because the server never learns one: a passkey is told from
 * another only by when it was added.
 */
import type { ClaimView, ProfileView } from "@terrakin/protocol";
import { shortDate } from "@terrakin/ui/format";

/** Where both halves of the undo live, named the same way everywhere a notice points at them. */
const SIGNIN_ROW = "Signing in";

/**
 * A passkey notice in plain words: one was bound, or one signed in. Both carry only the fact and
 * the time, so the words are fixed, and each says what to do if it wasn't you.
 */
export function passkeyNoticeLine(type: "passkey_bound" | "passkey_signin"): {
  line: string;
  next: string;
} {
  if (type === "passkey_bound") {
    return {
      line: "A passkey was added to this character.",
      next: `It can open Terrakin as this character from now on. If that wasn't you, remove it under ${SIGNIN_ROW} on your profile: the sessions it made end with it.`,
    };
  }
  return {
    line: "Someone signed in as this character with a passkey.",
    next: `That is another session, beside the ones already open. If it wasn't you, sign the others out under ${SIGNIN_ROW} on your profile.`,
  };
}

/** Whether `at` falls on the reader's own day. */
function today(at: number, nowMs: number, timeZone?: string): boolean {
  return shortDate(at, nowMs, timeZone) === shortDate(nowMs, nowMs, timeZone);
}

/**
 * The two lines under a passkey in the sheet: when it was added, and when it last signed in. A
 * passkey that has never signed in says so, since that is how a person spots one they didn't make.
 */
export function passkeyLines(
  claim: Pick<ClaimView, "boundAt" | "usedAt">,
  nowMs: number,
  timeZone?: string,
): [string, string] {
  const added = `Added ${shortDate(Date.parse(claim.boundAt), nowMs, timeZone)}`;
  if (claim.usedAt === undefined) return [added, "Never used to sign in"];
  const used = Date.parse(claim.usedAt);
  return [
    added,
    today(used, nowMs, timeZone)
      ? "Signed in today"
      : `Last signed in ${shortDate(used, nowMs, timeZone)}`,
  ];
}

/** What the Signing in sheet says above the list, from how many passkeys are bound. */
export function signinSummary(count: number): string {
  if (count === 0) {
    return "No passkey yet, so this browser is the only thing holding your character.";
  }
  if (count === 1) {
    return "One passkey opens it, with Face ID, a fingerprint, or a screen lock.";
  }
  return `${count} passkeys open it. Terrakin keeps nothing about the device each one is on, so they go by when they were added.`;
}

/**
 * Whether to offer a person a passkey on the home wall: the prompt RFC 0037 asks for after a plot
 * is claimed, never on the way in. Only a person's own character (someone who plays through their
 * AI already has one, bound by the link that let them in), only once there is something to lose,
 * only where the browser can make one, and only until this device puts it away.
 */
export function offerPasskey(o: {
  kind: ProfileView["kind"];
  /** They live on a plot: the first moment they have something to lose. */
  settled: boolean;
  /** How many passkeys are bound to them already. */
  passkeys: number;
  /** Whether this browser can make a passkey at all. */
  works: boolean;
  /** Whether this device has already put the prompt away. */
  hidden: boolean;
}): boolean {
  return o.kind === "human" && o.settled && o.passkeys === 0 && o.works && !o.hidden;
}
