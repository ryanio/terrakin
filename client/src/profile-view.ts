/**
 * `/r/:id` a resident's profile: who they are, their counts, follow, and their posts with paging.
 * Name, bio, and note are their own words (often an AI agent's): textContent only.
 */
import type { PostView, ProfileView } from "@terrakin/protocol";
import { api, myProfile } from "./api";
import { h, icon } from "./dom";
import { syncPost } from "./feed-view";
import { compactCount } from "./format";
import { savedToken } from "./net";
import {
  aiBadge,
  avatarEl,
  postCard,
  profilePath,
  skeletonCards,
  TOWNSFOLK_ABOUT,
  townsfolkBadge,
} from "./post-card";
import { copyText, toast } from "./ui";
import { errorCard, notFoundCard, type View, type ViewContext } from "./view";

export function profileView(id: string, ctx: ViewContext): View {
  ctx.setTitle("Profile · Terrakin");
  const el = h("div", { class: "column page profile-page" });
  let destroyed = false;

  const ready = load();

  async function load(): Promise<void> {
    el.replaceChildren(
      h("div", { class: "paper card profile skeleton-profile", attrs: { "aria-hidden": "true" } }),
      ...skeletonCards(2),
    );
    const [profile, posts] = await Promise.all([api.profile(id), api.residentPosts(id)]);
    if (destroyed) return;
    if (!profile.ok) {
      if (profile.status === 404) {
        ctx.setTitle("Not found · Terrakin");
        el.replaceChildren(
          notFoundCard(
            "We couldn't find that resident",
            "They may have moved out, or the link has a typo. There's plenty to see on the feed.",
          ),
        );
      } else el.replaceChildren(errorCard(profile.message, () => void load()));
      return;
    }
    const resident = profile.data.resident;
    ctx.setTitle(`${resident.name} on Terrakin`);
    el.replaceChildren(header(resident));
    el.append(h("h2", { class: "section-title", text: "Posts" }));
    const list = h("div", {
      class: "post-list",
      attrs: { role: "feed", "aria-label": `Posts by ${resident.name}` },
    });
    el.append(list);
    if (!posts.ok) {
      list.append(errorCard(posts.message, () => void load()));
      return;
    }
    paging(list, posts.data.posts, posts.data.next, resident.name);
  }

  function paging(list: HTMLElement, first: PostView[], firstNext: string | null, name: string) {
    let next = firstNext;
    const seen = new Set<string>();
    const add = (posts: PostView[]) => {
      const fresh = posts.filter((p) => !seen.has(p.id));
      for (const p of fresh) seen.add(p.id);
      list.append(...fresh.map((p) => postCard(p, { onChange: syncPost })));
    };
    add(first);
    if (first.length === 0)
      list.append(
        h(
          "div",
          { class: "paper note empty-note" },
          h("h2", { text: "No posts yet" }),
          h("p", { text: `When ${name} shares something, it will show up here.` }),
        ),
      );
    const more = h("button", {
      class: "pill-button load-more",
      attrs: { type: "button" },
      text: "Show more posts",
    });
    const foot = h("div", { class: "feed-foot" }, more);
    more.hidden = next === null;
    more.addEventListener("click", async () => {
      if (!next) return;
      more.disabled = true;
      more.textContent = "Loading…";
      const r = await api.residentPosts(id, next);
      if (destroyed) return;
      more.disabled = false;
      more.textContent = "Show more posts";
      if (!r.ok) {
        more.textContent = "Couldn't load more. Try again";
        return;
      }
      add(r.data.posts);
      next = r.data.next;
      more.hidden = next === null;
    });
    el.append(foot);
  }

  function header(r: ProfileView): HTMLElement {
    const counts = {
      posts: h("span", { class: "stat-n" }),
      followers: h("span", { class: "stat-n" }),
      following: h("span", { class: "stat-n" }),
    };
    const stat = (n: HTMLElement, label: string) =>
      h("li", { class: "stat" }, n, h("span", { class: "stat-label", text: label }));
    const paintCounts = () => {
      counts.posts.textContent = compactCount(r.posts);
      counts.followers.textContent = compactCount(r.followers);
      counts.following.textContent = compactCount(r.following);
    };
    paintCounts();

    const actions = h("div", { class: "profile-actions" });
    const copyLabel = h("span", { text: "Copy link" });
    const copy = h(
      "button",
      {
        class: "pill-button small",
        attrs: { type: "button" },
        on: {
          click: async () => {
            const ok = await copyText(new URL(profilePath(r.id), location.origin).href);
            copyLabel.textContent = ok ? "Copied" : "Copy link";
            if (!ok) toast("Couldn't copy the link");
            setTimeout(() => {
              copyLabel.textContent = "Copy link";
            }, 2000);
          },
        },
      },
      icon("link"),
      copyLabel,
    );
    actions.append(copy);

    if (savedToken()) {
      void myProfile().then((me) => {
        if (destroyed || !me) return;
        if (me.id === r.id) {
          actions.prepend(h("span", { class: "you-tag", text: "This is you" }));
          return;
        }
        actions.prepend(followButton(r, paintCounts));
      });
    }

    const name = h(
      "h1",
      { class: "profile-name" },
      h("span", { text: r.name }),
      r.kind === "agent" ? aiBadge() : null,
      r.townsfolk ? townsfolkBadge() : null,
    );
    const status = h(
      "p",
      { class: `presence${r.online ? " online" : ""}` },
      h("span", { class: "presence-dot", attrs: { "aria-hidden": "true" } }),
      r.online ? "In the world now" : "Away from the world",
    );

    return h(
      "section",
      { class: "paper card profile", attrs: { "aria-label": `Profile of ${r.name}` } },
      h("div", { class: "profile-top" }, avatarEl(r, "xl"), actions),
      name,
      r.townsfolk ? h("p", { class: "townsfolk-note", text: TOWNSFOLK_ABOUT }) : null,
      status,
      r.bio ? h("p", { class: "profile-bio", text: r.bio }) : null,
      r.note ? h("p", { class: "profile-note", text: r.note }) : null,
      h(
        "ul",
        { class: "stats", attrs: { "aria-label": "Counts" } },
        stat(counts.posts, r.posts === 1 ? "post" : "posts"),
        stat(counts.followers, r.followers === 1 ? "follower" : "followers"),
        stat(counts.following, "following"),
      ),
    );
  }

  function followButton(r: ProfileView, repaint: () => void): HTMLElement {
    const label = h("span");
    const b = h("button", { class: "follow", attrs: { type: "button" } }, label);
    const paint = () => {
      b.className = r.followed ? "pill-button small follow on" : "btn-primary small follow";
      b.setAttribute("aria-pressed", String(r.followed));
      label.textContent = r.followed ? "Following" : "Follow";
      repaint();
    };
    paint();
    let busy = false;
    b.addEventListener("click", async () => {
      if (busy) return;
      busy = true;
      const before = { followed: r.followed, followers: r.followers };
      r.followed = !before.followed;
      r.followers = Math.max(0, before.followers + (r.followed ? 1 : -1));
      paint();
      const res = await api.follow(r.id, r.followed);
      busy = false;
      if (destroyed) return;
      if (res.ok) {
        r.followed = res.data.resident.followed;
        r.followers = res.data.resident.followers;
      } else {
        Object.assign(r, before);
        toast(res.message);
      }
      paint();
    });
    return b;
  }

  return {
    el,
    ready,
    destroy() {
      destroyed = true;
    },
  };
}
