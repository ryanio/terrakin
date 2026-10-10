/**
 * `/p/:id` one post, its replies (oldest first), and a reply box for residents, with who wrote it
 * and more of their posts beside them.
 */
import type { AuthorView, PostResponse, PostView } from "@terrakin/protocol";
import { h, icon } from "@terrakin/ui/dom";
import { plural } from "@terrakin/ui/format";
import { postPath, profilePath } from "@terrakin/ui/paths";
import { personLink } from "@terrakin/ui/people";
import { skeletonPosts } from "@terrakin/ui/skeleton";
import { pageLayout, toast } from "@terrakin/ui/ui";
import { timeAgo } from "@terrakin/ui/when";
import { api, myProfile } from "./api";
import { type Composer, composer } from "./composer";
import { syncPost } from "./feed-view";
import { pageData } from "./page-data";
import { postCard } from "./post-card";
import { pulseShell } from "./pulse-cards";
import { failInto, notFoundCard, type View, type ViewContext } from "./view";

/** How many more of the author's posts the sidebar lists. */
const MORE_POSTS = 3;

export function postView(id: string, ctx: ViewContext): View {
  ctx.setTitle("Post · Terrakin");
  const { el, head, main, side } = pageLayout("post-page", "About who wrote it", {
    sideLast: true,
  });
  let writer: Composer | undefined;
  main.append(...skeletonPosts(1));

  const back = h(
    "button",
    {
      class: "back-link",
      attrs: { type: "button" },
      on: {
        click: () => {
          if (ctx.canGoBack()) history.back();
          else ctx.navigate("/");
        },
      },
    },
    icon("back"),
    h("span", { text: "Back" }),
  );

  head.append(back);

  /** Who wrote it, and a few more of their posts, in the home wall's card style. */
  async function aboutAuthor(author: AuthorView, shown: string): Promise<void> {
    const [profile, posts] = await Promise.all([
      api.profile(author.id),
      api.residentPosts(author.id),
    ]);
    if (loader.gone()) return;
    const r = profile.ok ? profile.data.resident : undefined;
    const card = pulseShell(
      "post-about",
      `About ${author.name}`,
      h("p", { class: "eyebrow pulse-eyebrow", text: "Written by" }),
      personLink(author, { size: "lg" }),
      r?.bio ? h("p", { class: "post-about-bio", text: r.bio }) : null,
      r
        ? h("p", {
            class: "pulse-foot",
            text: `${plural(r.posts, "post", "posts")} · ${plural(r.followers, "follower", "followers")}`,
          })
        : null,
      h("a", {
        class: "pill-button small",
        attrs: { href: profilePath(author.id) },
        text: "See their profile",
      }),
    );
    const others = posts.ok
      ? posts.data.posts.filter((p) => p.id !== shown && !p.replyTo).slice(0, MORE_POSTS)
      : [];
    const more =
      others.length > 0
        ? pulseShell(
            "post-more-from",
            `More from ${author.name}`,
            h("p", { class: "eyebrow pulse-eyebrow", text: `More from ${author.name}` }),
            h(
              "ul",
              { class: "stack plain-list post-others" },
              ...others.map((p) =>
                h(
                  "li",
                  {},
                  h("a", {
                    class: "post-others-text",
                    attrs: { href: postPath(p.id) },
                    text: p.text,
                  }),
                  timeAgo(p.createdAt, { className: "pulse-foot" }),
                ),
              ),
            ),
          )
        : null;
    for (const c of [card, more]) if (c) c.hidden = false;
    side.replaceChildren(...[card, more].filter((c): c is HTMLElement => c !== null));
  }

  function paint({ post, replies }: PostResponse) {
    ctx.setTitle(`Post by ${post.author.name} on Terrakin`);
    // The reply box is right here, so Reply takes you to it instead of reloading this page.
    const card = postCard(post, {
      focus: true,
      onChange: syncPost,
      onReply: () =>
        void myProfile().then((me) => {
          if (loader.gone()) return;
          if (me) writer?.focus();
          else toast("Join the world to reply.", { href: "/world", label: "Join" });
        }),
    });

    const heading = h("h2", { class: "section-title", attrs: { id: "replies-title" } });
    const paintHeading = () => {
      heading.textContent =
        post.replyCount > 0 ? plural(post.replyCount, "reply", "replies") : "Replies";
    };
    paintHeading();
    const list = h("ol", { class: "replies", attrs: { "aria-labelledby": "replies-title" } });
    const addReply = (reply: PostView) =>
      list.append(h("li", {}, postCard(reply, { inThread: true, onChange: syncPost })));
    // Oldest first, like a conversation.
    const sorted = [...replies].sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
    for (const reply of sorted) addReply(reply);
    const empty = h("p", { class: "replies-empty", text: "No replies yet." });
    empty.hidden = replies.length > 0;

    main.replaceChildren(card, heading, list, empty);
    void aboutAuthor(post.author, post.id);

    void myProfile().then((me) => {
      if (loader.gone() || !me) return;
      writer?.destroy();
      writer = composer({
        me,
        replyTo: post.id,
        onPosted(reply) {
          addReply(reply);
          empty.hidden = true;
          post.replyCount++;
          paintHeading();
          const count = card.querySelector(".post-action.reply .count");
          if (count) count.textContent = String(post.replyCount);
          syncPost(post);
          list.lastElementChild?.scrollIntoView({ behavior: "smooth", block: "nearest" });
        },
      });
      main.append(writer.el);
    });
  }

  const loader = pageData({
    ask: () => api.post(id),
    paint,
    fail: failInto(main, () => {
      ctx.setTitle("Not found · Terrakin");
      return notFoundCard(
        "We couldn't find that post",
        "It may have been deleted by the person who wrote it, or the link has a typo.",
      );
    }),
  });
  return {
    el,
    ready: loader.ready,
    destroy() {
      loader.leave();
      writer?.destroy();
    },
  };
}
