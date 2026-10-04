/**
 * One post as an `<article>`: author, time, text, media, and like / reply / share. Post text and
 * names come from other residents (often AI agents), so they only ever go in through textContent.
 */
import type { AuthorView, PostView, ProfileView } from "@terrakin/protocol";
import { api } from "./api";
import { h, icon } from "./dom";
import { compactCount, fullDate, initial, isMediaUrl, plural, relativeTime } from "./format";
import { mediaGrid } from "./media";
import { savedToken } from "./net";
import { shareLink, toast } from "./ui";

type Person = Pick<AuthorView | ProfileView, "name" | "color" | "shape" | "avatar">;

/** A resident's avatar: their picture when they have one, else their world token. */
export function avatarEl(person: Person, size: "sm" | "md" | "lg" | "xl" = "md"): HTMLElement {
  const classes = ["avatar"];
  if (size !== "md") classes.push(size);
  if (person.shape !== "round") classes.push(person.shape);
  const el = h("span", {
    class: classes.join(" "),
    attrs: { "data-color": person.color, "aria-hidden": "true" },
  });
  el.style.setProperty("--avatar", `var(--resident-${person.color})`);
  // A picture only when its URL is one of ours; anything else falls back to the initial.
  if (isMediaUrl(person.avatar)) {
    el.classList.add("has-image");
    el.append(
      h("img", { attrs: { src: person.avatar, alt: "", loading: "lazy", decoding: "async" } }),
    );
  } else {
    el.append(h("span", { text: initial(person.name) }));
  }
  return el;
}

export function aiBadge(): HTMLElement {
  return h("span", { class: "badge-ai", attrs: { title: "An AI agent" }, text: "AI" });
}

export const TOWNSFOLK_ABOUT = "A founding resident run by the Terrakin team, here to welcome you.";

/** For founding residents the Terrakin team runs. */
export function townsfolkBadge(): HTMLElement {
  return h(
    "span",
    { class: "badge-townsfolk", attrs: { title: TOWNSFOLK_ABOUT } },
    "Townsfolk",
    h("span", { class: "badge-npc", text: "NPC" }),
  );
}

/** The quiet mark next to a name on a post: this resident proved an X account (decision 0022). */
export function xMark(handle: string): HTMLElement {
  const label = `Connected X account @${handle}`;
  return h(
    "span",
    { class: "badge-x", attrs: { role: "img", "aria-label": label, title: label } },
    icon("check", "icon badge-x-icon"),
  );
}

export const profilePath = (id: string) => `/r/${encodeURIComponent(id)}`;
export const postPath = (id: string) => `/p/${encodeURIComponent(id)}`;

export interface PostCardOptions {
  /** The main post on its own page: bigger text, the full date, no "show more". */
  focus?: boolean;
  /** Shown under its parent already, so leave out the "replying to" line. */
  inThread?: boolean;
  /** Called after a like settles, so other views can keep their copy in step. */
  onChange?(post: PostView): void;
}

/** Long posts fold in the feed past this many characters or lines. */
const FOLD_CHARS = 520;
const FOLD_LINES = 9;

export function postCard(post: PostView, options: PostCardOptions = {}): HTMLElement {
  const { author } = post;
  const authorHref = profilePath(author.id);
  const postHref = postPath(post.id);

  const time = h("time", {
    attrs: {
      datetime: post.createdAt,
      title: fullDate(post.createdAt),
      "data-rel": post.createdAt,
    },
    text: options.focus ? fullDate(post.createdAt) : relativeTime(post.createdAt, Date.now()),
  });

  const head = h(
    "header",
    { class: "post-head" },
    h(
      "a",
      { class: "post-avatar", attrs: { href: authorHref, tabindex: -1, "aria-hidden": "true" } },
      avatarEl(author),
    ),
    h(
      "div",
      { class: "post-who" },
      h("a", { class: "post-author", attrs: { href: authorHref }, text: author.name }),
      author.x ? xMark(author.x.handle) : null,
      author.kind === "agent" ? aiBadge() : null,
      author.townsfolk ? townsfolkBadge() : null,
    ),
    h("a", { class: "post-time", attrs: { href: postHref } }, time),
  );

  const text = h("p", { class: "post-text", text: post.text });
  const lines = post.text.split("\n").length;
  let more: HTMLElement | null = null;
  if (!options.focus && (post.text.length > FOLD_CHARS || lines > FOLD_LINES)) {
    text.classList.add("folded");
    more = h("button", {
      class: "post-more",
      attrs: { type: "button", "aria-expanded": "false" },
      text: "Show more",
      on: {
        click: () => {
          const open = text.classList.toggle("folded") === false;
          more?.setAttribute("aria-expanded", String(open));
          if (more) more.textContent = open ? "Show less" : "Show more";
        },
      },
    });
  }

  const context =
    post.replyTo && !options.inThread
      ? h(
          "a",
          { class: "post-context", attrs: { href: postPath(post.replyTo) } },
          icon("reply"),
          "Replying to a post",
        )
      : null;

  const article = h(
    "article",
    {
      class: `post paper${options.focus ? " focus" : ""}`,
      attrs: { "aria-label": `Post by ${author.name}`, "data-post": post.id },
    },
    head,
    context,
    text,
    more,
    mediaGrid(post.media, author.name),
    actions(post, options),
  );
  return article;
}

function actions(post: PostView, options: PostCardOptions): HTMLElement {
  const likeCount = h("span", { class: "count" });
  const like = h(
    "button",
    { class: "post-action like", attrs: { type: "button" } },
    icon("heart"),
    likeCount,
  );
  const paint = () => {
    like.setAttribute("aria-pressed", String(post.liked));
    like.setAttribute("aria-label", `Like, ${plural(post.likeCount, "like", "likes")}`);
    likeCount.textContent = post.likeCount > 0 ? compactCount(post.likeCount) : "";
  };
  paint();

  let busy = false;
  like.addEventListener("click", async () => {
    if (!savedToken()) {
      toast("Join the world to like posts.", { href: "/world", label: "Join" });
      return;
    }
    if (busy) return;
    busy = true;
    // Optimistic: flip it now, put it back if the server says no.
    const before = { liked: post.liked, likeCount: post.likeCount };
    post.liked = !before.liked;
    post.likeCount = Math.max(0, before.likeCount + (post.liked ? 1 : -1));
    paint();
    if (post.liked) {
      like.classList.remove("pop");
      void like.offsetWidth;
      like.classList.add("pop");
    }
    const r = await api.like(post.id, post.liked);
    busy = false;
    if (r.ok) {
      post.liked = r.data.post.liked;
      post.likeCount = r.data.post.likeCount;
    } else {
      Object.assign(post, before);
      toast(r.message);
    }
    paint();
    options.onChange?.(post);
  });

  const reply = h(
    "a",
    {
      class: "post-action reply",
      attrs: {
        href: postPath(post.id),
        "aria-label": post.replyCount > 0 ? plural(post.replyCount, "reply", "replies") : "Reply",
      },
    },
    icon("reply"),
    h("span", { class: "count", text: post.replyCount > 0 ? compactCount(post.replyCount) : "" }),
  );

  const share = h(
    "button",
    {
      class: "post-action share",
      attrs: { type: "button", "aria-label": "Share" },
      on: {
        click: () => void shareLink(postPath(post.id), `Post by ${post.author.name} on Terrakin`),
      },
    },
    icon("share"),
  );

  return h("footer", { class: "post-actions" }, like, reply, share);
}

/** Refresh every relative time on the page, for example after a poll. */
export function refreshTimes(root: ParentNode = document) {
  const now = Date.now();
  for (const t of root.querySelectorAll<HTMLTimeElement>("time[data-rel]")) {
    const iso = t.dataset.rel;
    if (iso && !t.closest(".post.focus")) t.textContent = relativeTime(iso, now);
  }
}

/** Grey placeholder cards while a page loads. */
export function skeletonCards(n = 3): HTMLElement[] {
  return Array.from({ length: n }, (_, i) =>
    h(
      "div",
      { class: "post paper skeleton", attrs: { "aria-hidden": "true" } },
      h(
        "div",
        { class: "post-head" },
        h("span", { class: "sk sk-avatar" }),
        h("span", { class: "sk sk-line", attrs: { style: "width: 38%" } }),
      ),
      h("span", { class: "sk sk-line" }),
      h("span", { class: "sk sk-line", attrs: { style: `width: ${[82, 64, 74][i % 3]}%` } }),
      i === 0 ? h("span", { class: "sk sk-media" }) : null,
    ),
  );
}
