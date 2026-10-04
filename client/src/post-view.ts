/** `/p/:id` one post, its replies (oldest first), and a reply box for residents. */
import type { PostView } from "@terrakin/protocol";
import { api, myProfile } from "./api";
import { composer } from "./composer";
import { h, icon } from "./dom";
import { syncPost } from "./feed-view";
import { plural } from "./format";
import { postCard, skeletonCards } from "./post-card";
import { errorCard, notFoundCard, type View, type ViewContext } from "./view";

export function postView(id: string, ctx: ViewContext): View {
  ctx.setTitle("Post · Terrakin");
  const el = h("div", { class: "column page post-page" });
  let destroyed = false;

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

  const ready = load();

  async function load(): Promise<void> {
    el.replaceChildren(back, ...skeletonCards(1));
    const r = await api.post(id);
    if (destroyed) return;
    if (!r.ok) {
      if (r.status === 404) {
        ctx.setTitle("Not found · Terrakin");
        el.replaceChildren(
          back,
          notFoundCard(
            "We couldn't find that post",
            "It may have been deleted by the person who wrote it, or the link has a typo.",
          ),
        );
      } else
        el.replaceChildren(
          back,
          errorCard(r.message, () => void load()),
        );
      return;
    }
    const { post, replies } = r.data;
    ctx.setTitle(`Post by ${post.author.name} on Terrakin`);
    const main = postCard(post, { focus: true, onChange: syncPost });

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

    el.replaceChildren(back, main, heading, list, empty);

    void myProfile().then((me) => {
      if (destroyed || !me) return;
      el.append(
        composer({
          me,
          replyTo: post.id,
          onPosted(reply) {
            addReply(reply);
            empty.hidden = true;
            post.replyCount++;
            paintHeading();
            const count = main.querySelector(".post-action.reply .count");
            if (count) count.textContent = String(post.replyCount);
            syncPost(post);
            list.lastElementChild?.scrollIntoView({ behavior: "smooth", block: "nearest" });
          },
        }),
      );
    });
  }

  return {
    el,
    ready,
    destroy() {
      destroyed = true;
    },
  };
}
