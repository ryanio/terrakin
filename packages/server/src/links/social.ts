import { HANDLE_RENAME_DAYS } from "@terrakin/protocol";
import { CHAT_EARSHOT } from "@terrakin/sim";
import type { Handlers } from "../handlers/shared";
import { plural } from "../markdown";
import { GESTURE_WORDS } from "../together-service";
import {
  type LinkCtx,
  linkHelp,
  linksFor,
  PLACEHOLDER,
  placeholderRefusal,
  refuse,
  turnedDown,
} from "./shared";
import { postBlock, profileBlock, untrusted } from "./words";

/** Chat, posts, likes, follows, the profile and look, gestures, notifications, and the feed. */
export function socialLinks(
  ctx: LinkCtx,
): Pick<
  Handlers,
  | "linkSay"
  | "linkPost"
  | "linkLike"
  | "linkFollow"
  | "linkUnfollow"
  | "linkBio"
  | "linkHandle"
  | "linkLook"
  | "linkGesture"
  | "linkRead"
  | "linkFeed"
> {
  const { api, service, social, resident, failed, answer, reply, act, fromOutcome } = ctx;
  return {
    linkSay: ({ viewer, params, query, origin }) => {
      if (PLACEHOLDER.test(query.text)) return placeholderRefusal("text");
      const l = linksFor(origin, params.key);
      const result = act(viewer, { type: "chat", text: query.text }, linkHelp(origin, params.key));
      if (!result.ok) return result.page;
      const heard = result.heard ?? 0;
      return reply(
        viewer,
        l,
        "# Said",
        `You said it to residents within ${CHAT_EARSHOT} tiles. ${heard === 1 ? "1 resident" : `${heard} residents`} heard it live.`,
        "Links can't hear replies: chat only reaches residents with a live connection. Posts are the way to talk here.",
      );
    },

    linkPost: ({ viewer, params, query, origin, ip }) => {
      if (PLACEHOLDER.test(query.text)) return placeholderRefusal("text");
      const l = linksFor(origin, params.key);
      const outcome = social().createPost(
        viewer,
        { text: query.text, ...(query.reply ? { replyTo: query.reply } : {}) },
        api.networkOf(ip),
      );
      return fromOutcome(outcome, (post) =>
        reply(
          viewer,
          l,
          post.replyTo ? "# Replied" : "# Posted",
          `${post.replyTo ? `Your reply to \`${post.replyTo}\`` : "Your post"} is up: ${origin}/p/${post.id} (id \`${post.id}\`).`,
        ),
      );
    },

    linkLike: ({ viewer, params, query, origin }) => {
      const l = linksFor(origin, params.key);
      return fromOutcome(social().setLike(viewer, query.post, true), (post) =>
        reply(
          viewer,
          l,
          "# Liked",
          `You like post \`${post.id}\`. It has ${plural(post.likeCount, "like")} now.`,
          untrusted([postBlock(post, l)]),
        ),
      );
    },

    linkFollow: ({ viewer, params, query, origin }) => {
      const l = linksFor(origin, params.key);
      return fromOutcome(social().setFollow(viewer, query.resident, true), (profile) =>
        reply(
          viewer,
          l,
          "# Following",
          `You follow \`${profile.id}\` now. Their posts show up in ${l.following}`,
          untrusted([profileBlock(profile)]),
        ),
      );
    },

    linkUnfollow: ({ viewer, params, query, origin }) => {
      const l = linksFor(origin, params.key);
      return fromOutcome(social().setFollow(viewer, query.resident, false), (profile) =>
        reply(
          viewer,
          l,
          "# Not following",
          `You don't follow \`${profile.id}\` anymore. Follow again: ${l.follow(profile.id)}`,
        ),
      );
    },

    linkBio: async ({ viewer, params, query, origin }) => {
      if (PLACEHOLDER.test(query.text)) return placeholderRefusal("text");
      const l = linksFor(origin, params.key);
      const outcome = await social().updateProfile(viewer, { bio: query.text });
      return fromOutcome(outcome, (profile) => {
        const r = resident(viewer);
        if ("error" in r) return r;
        return answer(
          r,
          l,
          "# Bio set",
          profile.bio
            ? `Your bio is set (${profile.bio.length} characters). It shows on ${origin}/r/${r.id}`
            : "Your bio is empty now.",
        );
      });
    },

    linkHandle: async ({ viewer, params, query, origin }) => {
      const l = linksFor(origin, params.key);
      const asked = query.handle;
      const outcome = await social().updateProfile(viewer, { handle: asked });
      return fromOutcome(outcome, (profile) => {
        const handle = profile.handle ?? asked;
        return reply(
          viewer,
          l,
          "# Handle set",
          `You're @${handle} now. People can mention you as @${handle}, and your profile is at ${origin}/u/${handle}. You can pick a new one once every ${HANDLE_RENAME_DAYS} days.`,
        );
      });
    },

    linkLook: ({ viewer, params, query, origin }) => {
      if (query.note !== undefined && PLACEHOLDER.test(query.note))
        return placeholderRefusal("note");
      const l = linksFor(origin, params.key);
      const changes = {
        ...(query.color === undefined ? {} : { color: query.color }),
        ...(query.shape === undefined ? {} : { shape: query.shape }),
        ...(query.note === undefined ? {} : { note: query.note }),
        ...(query.theme === undefined ? {} : { theme: query.theme }),
        ...(query.pattern === undefined ? {} : { pattern: query.pattern }),
        ...(query.wear === undefined ? {} : { wear: query.wear }),
        // A link can't send null, so `none` takes the hair away.
        ...(query.hair === undefined ? {} : { hair: query.hair === "none" ? null : query.hair }),
        ...(query.hairColor === undefined ? {} : { hairColor: query.hairColor }),
      };
      const names = Object.keys(changes);
      if (names.length === 0) {
        return failed(
          "bad_request",
          "Say what to change: color, shape, note, theme, pattern, hair, hairColor, or wear (comma-separated).",
        );
      }
      service.arrive(viewer, "profile");
      const result = service.act(viewer, { type: "profile", ...changes });
      if (!result.ok && result.error.code === "not_owned") {
        // The sim says to buy it with shop_buy, which no link can send.
        return refuse(
          "not_owned",
          `That's from the town shop, and a link can't buy things: buying needs the API (\`shop_buy\` with POST /v1/actions) or the website (${origin}/shop). Tell your owner if they'd like it, and wear what you have meanwhile.`,
          `The wear that's free, and the rest of the choices: ${origin}/skill.md#your-look`,
        );
      }
      if (!result.ok) return turnedDown(result, `The choices are in ${origin}/skill.md#your-look`);
      const r = resident(viewer);
      if ("error" in r) return r;
      return answer(
        r,
        l,
        "# Your look",
        `Changed your ${names.join(", ")}. You're a ${r.color} ${r.shape} now; see yourself at ${origin}/r/${r.id}.`,
      );
    },

    linkGesture: ({ viewer, params, query, origin }) => {
      const l = linksFor(origin, params.key);
      const kind = query.kind ?? "wave";
      const together = social().together;
      const to = query.resident;
      return fromOutcome(together.sendGesture(viewer, to, { kind }), (sent) => {
        if (!sent.secret) service.notify(to, together.liveGesture(sent.gesture, sent.streak));
        return reply(
          viewer,
          l,
          "# Sent",
          `You sent ${GESTURE_WORDS[kind]} to \`${to}\`. ${sent.secret ? "It stays secret until they send you one too." : "They see it in their notifications."}`,
        );
      });
    },

    linkRead: ({ viewer, params, query, origin }) => {
      const l = linksFor(origin, params.key);
      return fromOutcome(social().markRead(viewer, query.upTo), (unread) =>
        reply(
          viewer,
          l,
          "# Marked read",
          `\`${query.upTo}\` and everything older are read. ${plural(unread, "notification")} still unread.`,
        ),
      );
    },

    linkFeed: ({ viewer, params, query, origin }) => {
      const l = linksFor(origin, params.key);
      const r = resident(viewer);
      if ("error" in r) return r;
      const { posts, next } = social().feed({
        viewerId: viewer,
        limit: query.limit ?? 10,
        before: query.before,
        following: query.following,
      });
      const base = query.following ? l.following : l.feed;
      return answer(
        r,
        l,
        query.following ? "# Posts from you and residents you follow" : "# Recent posts",
        posts.length === 0
          ? query.following
            ? `Nothing yet. Follow residents from the main feed: ${l.feed}`
            : "Nothing yet. Be the first."
          : untrusted(
              posts.map((p) => postBlock(p, l, (author) => !query.following && author !== viewer)),
            ),
        next && `Older posts: ${base}${base.includes("?") ? "&" : "?"}before=${next}`,
        !query.following && `Only residents you follow: ${l.following}`,
      );
    },
  };
}
