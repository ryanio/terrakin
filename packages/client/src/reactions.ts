/**
 * Reactions as the client draws them, the small bits of post state that change when someone
 * reacts or reposts, and `PostToggles`, which keeps the viewer's taps in step with the server. The
 * server only sends keys; the emoji live here. No DOM, so tests pin them.
 */
import { type PostView, REACTION_KEYS, type ReactionKey } from "@terrakin/protocol";
import type { Result } from "@terrakin/ui/http";

export const REACTIONS: Record<ReactionKey, { emoji: string; label: string }> = {
  heart: { emoji: "❤️", label: "Heart" },
  laugh: { emoji: "😂", label: "Laugh" },
  wow: { emoji: "😮", label: "Wow" },
  sprout: { emoji: "🌱", label: "Sprout" },
  home: { emoji: "🏡", label: "Home" },
  clap: { emoji: "👏", label: "Clap" },
  hug: { emoji: "🫂", label: "Hug" },
  yum: { emoji: "😋", label: "Yum" },
  thanks: { emoji: "🙏", label: "Thanks" },
  sparkle: { emoji: "✨", label: "Sparkle" },
};

/** Each reaction with a count, in the fixed order, with whether the viewer left it. */
export function reactionSummary(
  post: Pick<PostView, "reactions" | "myReactions" | "likeCount" | "liked">,
  options: { skipHeart?: boolean } = {},
): { key: ReactionKey; count: number; mine: boolean }[] {
  const counts = { ...post.reactions };
  // Servers from before reactions only send likes.
  if (counts.heart === undefined && post.likeCount > 0) counts.heart = post.likeCount;
  const mine = new Set(post.myReactions ?? (post.liked ? ["heart"] : []));
  return REACTION_KEYS.filter((key) => !(options.skipHeart && key === "heart"))
    .map((key) => ({ key, count: counts[key] ?? 0, mine: mine.has(key) }))
    .filter((r) => r.count > 0);
}

/** Whether the viewer has left this reaction. */
export function hasReaction(post: PostView, key: ReactionKey): boolean {
  if (post.myReactions) return post.myReactions.includes(key);
  return key === "heart" && post.liked;
}

/**
 * Turn one of the viewer's reactions on or off in place, before the server answers. A heart moves
 * `likeCount` and `liked` with it, the same way the server counts them.
 */
export function applyReaction(post: PostView, key: ReactionKey, on: boolean): void {
  if (hasReaction(post, key) === on) return;
  const counts = { ...post.reactions };
  if (counts.heart === undefined && post.likeCount > 0) counts.heart = post.likeCount;
  const next = Math.max(0, (counts[key] ?? 0) + (on ? 1 : -1));
  if (next === 0) delete counts[key];
  else counts[key] = next;
  post.reactions = counts;
  const mine = new Set(post.myReactions ?? (post.liked ? ["heart"] : []));
  if (on) mine.add(key);
  else mine.delete(key);
  post.myReactions = REACTION_KEYS.filter((k) => mine.has(k));
  if (key === "heart") {
    post.liked = on;
    post.likeCount = counts.heart ?? 0;
  }
}

/** Repost on or off in place, before the server answers. */
export function applyRepost(post: PostView, on: boolean): void {
  if ((post.reposted ?? false) === on) return;
  post.reposted = on;
  post.repostCount = Math.max(0, (post.repostCount ?? 0) + (on ? 1 : -1));
}

/** The fields that change when people react, reply, or repost. Item fields like `repostedBy` stay. */
const STATE_FIELDS = [
  "likeCount",
  "liked",
  "reactions",
  "myReactions",
  "replyCount",
  "repostCount",
  "quoteCount",
  "reposted",
] as const;

/** Copy the counts and the viewer's flags from one copy of a post to another. */
export function copyPostState(from: PostView, to: PostView): void {
  const target = to as Record<string, unknown>;
  for (const field of STATE_FIELDS) {
    if (from[field] !== undefined) target[field] = from[field];
  }
}

/** A snapshot of the state fields, to put back if the server says no. */
export function postState(post: PostView): PostView {
  const copy = { ...post };
  if (post.reactions) copy.reactions = { ...post.reactions };
  if (post.myReactions) copy.myReactions = [...post.myReactions];
  return copy;
}

// ---------- the viewer's taps, in step with the server ----------

/** What the viewer turns on and off on a post: one of their reactions, or their repost. */
export type Toggle = ReactionKey | "repost";

/** Whether the viewer has `toggle` on. */
function isOn(post: PostView, toggle: Toggle): boolean {
  return toggle === "repost" ? (post.reposted ?? false) : hasReaction(post, toggle);
}

function applyToggle(post: PostView, toggle: Toggle, on: boolean): void {
  if (toggle === "repost") applyRepost(post, on);
  else applyReaction(post, toggle, on);
}

/** The server's answer to one toggle: the post as it has it now, or why not. */
export type ToggleAnswer = Result<{ post: PostView }>;

export interface PostTogglesOptions {
  /** Ask the server to turn `toggle` on or off. */
  send(toggle: Toggle, on: boolean): Promise<ToggleAnswer>;
  /** After each answer, once the post shows it: what was asked, and how the server answered. */
  settled?(toggle: Toggle, on: boolean, answer: ToggleAnswer): void;
}

/**
 * The viewer's reactions and repost on one post, kept in step with the server without losing a
 * tap. A tap shows on the post at once. Requests go one at a time, since each answer carries the
 * whole post: a tap while one is out waits for it, then goes if the server's post still differs
 * from the newest tap. So the post always shows the server's last answer with the taps it hasn't
 * answered yet on top, and once nothing waits, its counts are the server's own.
 */
export class PostToggles {
  /** The post as the server last answered. */
  private server: PostView;
  /** The newest tap on each toggle the server hasn't caught up with. */
  private readonly wanted = new Map<Toggle, boolean>();
  private sending = false;

  constructor(
    /** The post as shown, changed in place. */
    private readonly post: PostView,
    private readonly options: PostTogglesOptions,
  ) {
    this.server = postState(post);
  }

  /** Turn `toggle` on or off: on the post now, and on the server once it has answered the rest. */
  set(toggle: Toggle, on: boolean): void {
    // With nothing waiting, the post as shown is the server's newest word, which another card
    // showing the same post may have copied in since this one last heard back.
    if (!this.sending && this.wanted.size === 0) this.server = postState(this.post);
    this.wanted.set(toggle, on);
    applyToggle(this.post, toggle, on);
    void this.flush();
  }

  private async flush(): Promise<void> {
    if (this.sending) return;
    this.sending = true;
    try {
      for (let next = this.next(); next; next = this.next()) {
        const [toggle, on] = next;
        const answer = await this.options.send(toggle, on);
        if (answer.ok) this.server = postState(answer.data.post);
        // Answered either way. A refusal undoes this tap, but a newer one on the same toggle stands.
        if (this.wanted.get(toggle) === on) this.wanted.delete(toggle);
        this.show();
        this.options.settled?.(toggle, on, answer);
      }
    } finally {
      this.sending = false;
    }
  }

  /** The next tap the server's post doesn't match yet. Taps it already matches need no request. */
  private next(): [Toggle, boolean] | undefined {
    for (const [toggle, on] of this.wanted) {
      if (isOn(this.server, toggle) !== on) return [toggle, on];
      this.wanted.delete(toggle);
    }
    return undefined;
  }

  /** The server's post, with the taps it hasn't answered yet on top. */
  private show(): void {
    copyPostState(postState(this.server), this.post);
    for (const [toggle, on] of this.wanted) applyToggle(this.post, toggle, on);
  }
}
