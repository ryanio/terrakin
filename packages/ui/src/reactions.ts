/**
 * How each reaction looks: its emoji and its name. The server only sends keys; the client and the
 * staff app draw them from here.
 */
import type { ReactionKey } from "@terrakin/protocol";

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
