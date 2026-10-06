/**
 * Pure helpers for letters, gestures, streaks, and invites (decision 0020). No DOM, so tests pin
 * them. Names and letter text that pass through here are untrusted and only ever reach the page
 * as text.
 */
import type {
  AuthorView,
  GestureItem,
  GestureKind,
  GestureView,
  InviteView,
  LetterView,
} from "@terrakin/protocol";
import { thingCount } from "./things";

const LETTER_MEDIA_PATH = /^\/v1\/letters\/l_[0-9a-f]{16}\/media\/m_[0-9a-f]{16}$/;

/**
 * True for a letter image URL exactly as our server makes it. Letter images are private, so the
 * page fetches them with the token and shows a `blob:` URL; nothing else may be fetched that way.
 */
export function isLetterMediaUrl(url: unknown): url is string {
  return typeof url === "string" && LETTER_MEDIA_PATH.test(url);
}

export interface Conversation {
  with: AuthorView;
  /** The newest letter either way. */
  last: LetterView;
  /** Letters from them you haven't opened. */
  unread: number;
}

/** Letters (newest first) grouped by the other person, newest conversation first. */
export function conversations(letters: readonly LetterView[], me: string): Conversation[] {
  const byPerson = new Map<string, Conversation>();
  for (const letter of letters) {
    const other = letter.from.id === me ? letter.to : letter.from;
    const unread = letter.to.id === me && letter.readAt === null ? 1 : 0;
    const known = byPerson.get(other.id);
    if (known) known.unread += unread;
    else byPerson.set(other.id, { with: other, last: letter, unread });
  }
  return [...byPerson.values()].sort(
    (a, b) => Date.parse(b.last.createdAt) - Date.parse(a.last.createdAt),
  );
}

export interface GestureInfo {
  kind: GestureKind;
  /** Button label. */
  label: string;
  /** A picture for the button and the little float-up animation. */
  emoji: string;
  /** "a hug", for sentences. */
  noun: string;
  /** Offered only to people who are close (see `gestureChoices`). */
  close?: true;
}

export const GESTURES: readonly GestureInfo[] = [
  { kind: "hug", label: "Hug", emoji: "🤗", noun: "a hug" },
  { kind: "kiss", label: "Kiss", emoji: "😘", noun: "a kiss", close: true },
  { kind: "wave", label: "Wave", emoji: "👋", noun: "a wave" },
  { kind: "high_five", label: "High five", emoji: "🙌", noun: "a high five" },
  { kind: "comfort", label: "Comfort", emoji: "🫂", noun: "some comfort" },
  { kind: "gift", label: "Gift", emoji: "🎁", noun: "a gift" },
];

/** A gesture streak this long with someone makes the two of you close. */
export const CLOSE_STREAK_DAYS = 7;

/**
 * The gesture buttons to show for one person. Kiss is there only when you are close: you share a
 * plot, you have kissed them before, or your streak is `CLOSE_STREAK_DAYS` or more. A kiss from
 * them shows here only once you've kissed back, so it unlocks nothing on its own. The API takes any
 * kind from anyone; this only decides what the page offers.
 */
export function gestureChoices(
  between: readonly (Pick<GestureView, "kind"> & { from: { id: string } })[],
  streak: number,
  me: string,
  sharesPlot = false,
): GestureInfo[] {
  const kissed = between.some((g) => g.kind === "kiss" && g.from.id === me);
  const close = sharesPlot || streak >= CLOSE_STREAK_DAYS || kissed;
  return GESTURES.filter((g) => close || !g.close);
}

/**
 * What the page says after you send a gesture. A kiss stays secret until they send one back; the
 * one that answers theirs tells you they had.
 */
export function sentLine(
  kind: GestureKind,
  to: string,
  sent: { secret?: true | undefined; answered?: true | undefined },
): string {
  const { noun } = gestureInfo(kind);
  if (sent.answered) return `${to} sent you ${noun} too`;
  if (sent.secret) return `You sent ${to} ${noun}. They'll only know if they send you one too.`;
  return `You sent ${noun} to ${to}`;
}

export const gestureInfo = (kind: GestureKind): GestureInfo =>
  GESTURES.find((g) => g.kind === kind) ?? (GESTURES[0] as GestureInfo);

/**
 * "Ada sent you a hug", or with a gift, "Ada sent you a gift: a jar of honey". A gift that carried
 * a thing names it, then the note: "Ada sent you a gift: 3 lemons. “Picked today”". A wave from
 * someone's putter says so: "Wren waved as they puttered past".
 */
export function gestureLine(
  kind: GestureKind,
  from: string,
  note: string,
  putter = false,
  item?: Pick<GestureItem, "kind" | "count">,
): string {
  if (putter) return `${from} waved as they puttered past`;
  const base = `${from} sent you ${gestureInfo(kind).noun}`;
  if (item) {
    const what = `${base}: ${thingCount(item.kind, item.count)}`;
    return note ? `${what}. “${note}”` : what;
  }
  return note ? `${base}: ${note}` : base;
}

/** The streak with one person, in plain words. */
export function streakLine(days: number): string {
  if (days <= 0) return "No streak yet. Send a little something today to start one.";
  if (days === 1) return "1 day in a row. Come back tomorrow to keep it going.";
  return `${days} days in a row`;
}

/** The full link for an invite path, on whatever host serves this page. */
export const inviteLink = (path: string, origin: string) => new URL(path, origin).href;

/**
 * Whether a saved invite can be handed out again instead of making a new one: same kind of offer,
 * at least an hour left before it expires, and never copied or shared. An invite works once, so a
 * link already sent to one person would fail for the next.
 */
export function reusableInvite(
  saved: InviteView | undefined,
  share: boolean,
  nowMs: number,
  handedOut = false,
): saved is InviteView {
  if (!saved || saved.share !== share || handedOut) return false;
  return Date.parse(saved.expiresAt) - nowMs > 60 * 60_000;
}

/**
 * The welcome the world shows after accepting an invite. Without a plot (none free nearby), it
 * says only what did happen: you follow each other.
 */
export function arrivalLine(
  inviter: string,
  accepted: { shared: boolean; plot: unknown | null },
): string {
  if (accepted.shared) return `Welcome home. You share ${inviter}'s plot now.`;
  if (accepted.plot) return `Welcome! You live next to ${inviter} now.`;
  return `Welcome! You and ${inviter} follow each other now. Walk out of the Commons to claim a plot.`;
}

/** A line the world shows once when you arrive from an invite (sessionStorage). */
export const ARRIVAL_KEY = "terrakin.arrival";
