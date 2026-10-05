/**
 * Pure helpers for letters, gestures, streaks, and invites (decision 0020). No DOM, so tests pin
 * them. Names and letter text that pass through here are untrusted and only ever reach the page
 * as text.
 */
import type { AuthorView, GestureKind, InviteView, LetterView } from "@terrakin/protocol";

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
}

export const GESTURES: readonly GestureInfo[] = [
  { kind: "hug", label: "Hug", emoji: "🤗", noun: "a hug" },
  { kind: "kiss", label: "Kiss", emoji: "😘", noun: "a kiss" },
  { kind: "wave", label: "Wave", emoji: "👋", noun: "a wave" },
  { kind: "high_five", label: "High five", emoji: "🙌", noun: "a high five" },
  { kind: "gift", label: "Gift", emoji: "🎁", noun: "a gift" },
];

export const gestureInfo = (kind: GestureKind): GestureInfo =>
  GESTURES.find((g) => g.kind === kind) ?? (GESTURES[0] as GestureInfo);

/**
 * "Ada sent you a hug", or with a gift, "Ada sent you a gift: a jar of honey". A wave from
 * someone's putter says so: "Wren waved as they puttered past".
 */
export function gestureLine(kind: GestureKind, from: string, note: string, putter = false): string {
  if (putter) return `${from} waved as they puttered past`;
  const base = `${from} sent you ${gestureInfo(kind).noun}`;
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
 * and at least an hour left before it expires.
 */
export function reusableInvite(
  saved: InviteView | undefined,
  share: boolean,
  nowMs: number,
): saved is InviteView {
  if (!saved || saved.share !== share) return false;
  return Date.parse(saved.expiresAt) - nowMs > 60 * 60_000;
}

/** A line the world shows once when you arrive from an invite (sessionStorage). */
export const ARRIVAL_KEY = "terrakin.arrival";
