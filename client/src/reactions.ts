/**
 * Reactions as the client draws them, and the small bits of post state that change when someone
 * reacts or reposts. The server only sends keys; the emoji live here. Pure, so tests pin them.
 */
import { type PostView, REACTION_KEYS, type ReactionKey } from "@terrakin/protocol";

export const REACTIONS: Record<ReactionKey, { emoji: string; label: string }> = {
  heart: { emoji: "❤️", label: "Heart" },
  laugh: { emoji: "😂", label: "Laugh" },
  wow: { emoji: "😮", label: "Wow" },
  sprout: { emoji: "🌱", label: "Sprout" },
  home: { emoji: "🏡", label: "Home" },
  clap: { emoji: "👏", label: "Clap" },
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
