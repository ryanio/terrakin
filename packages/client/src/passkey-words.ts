/**
 * The words and the one rule behind signing in with a passkey (RFC 0037), pure so tests pin them:
 * what a notice from Terrakin says, how a bound passkey reads in the Signing in sheet, and when a
 * person with no passkey is offered one, and in what words.
 *
 * Nothing here knows about a device, because the server never learns one: a passkey is told from
 * another only by when it was added.
 */
import type { ClaimView, ProfileView, WorldEvent } from "@terrakin/protocol";
import { DAY_MS } from "@terrakin/sim";
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
  claim: Pick<ClaimView, "boundAt" | "usedAt" | "thisSession">,
  nowMs: number,
  timeZone?: string,
): string[] {
  const added = `Added ${shortDate(Date.parse(claim.boundAt), nowMs, timeZone)}`;
  const used =
    claim.usedAt === undefined
      ? "Never used to sign in"
      : today(Date.parse(claim.usedAt), nowMs, timeZone)
        ? "Signed in today"
        : `Last signed in ${shortDate(Date.parse(claim.usedAt), nowMs, timeZone)}`;
  // The one thing that tells a passkey apart on sight, and the one a person has to be warned
  // about: removing it signs them out of the page they are standing on.
  return claim.thisSession
    ? [added, used, "This is the one signing you in here. Removing it signs you out."]
    : [added, used, "Removing it ends the sessions it made."];
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

/** How long a person who put the offer away goes before it comes back, on any screen. */
export const ASK_AGAIN_MS = DAY_MS;

/**
 * Whether to offer a person a passkey now: only a person's own character (someone who plays
 * through their AI already has one, bound by the link that let them in), only with none bound yet,
 * only where the browser can make one, and at most once a day. The offer comes on the way in and
 * keeps coming back, at the home wall and at the moments below, until there is a passkey.
 */
export function offerPasskey(o: {
  kind: ProfileView["kind"];
  /** How many passkeys are bound to them already. */
  passkeys: number;
  /** Whether this browser can make a passkey at all. */
  works: boolean;
  /** When this device last asked them, if it has. */
  askedAt: number | undefined;
  nowMs: number;
}): boolean {
  const rested = o.askedAt === undefined || o.nowMs - o.askedAt >= ASK_AGAIN_MS;
  return o.kind === "human" && o.passkeys === 0 && o.works && rested;
}

/** When the world asks: just in, or a moment that gave them more to lose. */
export type PasskeyMoment = "joined" | "plot" | "hearth" | "level";

/**
 * The moment an applied event is, for `me`: a plot claimed, a hearth set, or the first level-up
 * (to level 2 overall). Anything else, and anyone else's, is no moment to ask.
 */
export function passkeyMoment(event: WorldEvent, me: string): PasskeyMoment | undefined {
  if (event.type === "plot_claimed" && event.ownerId === me) return "plot";
  if (event.type === "hearth_set" && event.residentId === me) return "hearth";
  if (
    event.type === "level_reached" &&
    event.residentId === me &&
    event.skill === undefined &&
    event.level === 2
  ) {
    return "level";
  }
  return undefined;
}

/** The sheet's title, the same at every moment. */
export const PASSKEY_ASK_TITLE = "Keep your character on any device";

const HOW = "with Face ID, a fingerprint, or your screen lock, and nothing to write down";

/** What the sheet says under its title, for the moment it comes at. */
export function passkeyAskLine(moment: PasskeyMoment): string {
  switch (moment) {
    case "joined":
      return `For now this browser is the only thing holding your character. Add a passkey and you can open Terrakin as yourself on any phone or computer, ${HOW}.`;
    case "plot":
      return `You have a plot now. If this browser forgets you, Terrakin can't tell it's yours. A passkey brings you back on any device, ${HOW}.`;
    case "hearth":
      return `Your home is set. If this browser forgets you, Terrakin can't tell it's yours. A passkey brings you back on any device, ${HOW}.`;
    case "level":
      return `You reached level 2. Keep what you've built: a passkey brings you back on any device, ${HOW}.`;
  }
}
