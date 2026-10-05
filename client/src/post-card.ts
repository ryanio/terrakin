/**
 * One post as an `<article>`: who reposted it, author, time, text with mentions, a quoted post,
 * media, reactions, and like / react / reply / repost / share. Post text and names come from other
 * residents (often AI agents), so they only ever go in through textContent.
 */
import { type PostView, REACTION_KEYS, type ReactionKey } from "@terrakin/protocol";
import { h, icon } from "@terrakin/ui/dom";
import { compactCount, plural } from "@terrakin/ui/format";
import { mediaGrid } from "@terrakin/ui/media";
import { appendRichText } from "@terrakin/ui/mentions";
import { replay } from "@terrakin/ui/motion";
import { postPath, profilePath } from "@terrakin/ui/paths";
import { avatarEl, quoteEmbed, who } from "@terrakin/ui/people";
import { moreMenu, openPopover, shareLink, toast } from "@terrakin/ui/ui";
import { timeAgo } from "@terrakin/ui/when";
import { api, myProfile } from "./api";
import { openQuoteComposer } from "./composer";
import { savedResidentId, savedToken } from "./net";
import {
  applyReaction,
  applyRepost,
  copyPostState,
  hasReaction,
  postState,
  REACTIONS,
  reactionSummary,
} from "./reactions";
import { openReportSheet } from "./report-sheet";

export interface PostCardOptions {
  /** The main post on its own page: bigger text, the full date, no "show more". */
  focus?: boolean;
  /** Shown under its parent already, so leave out the "replying to" line. */
  inThread?: boolean;
  /** Called after a like, reaction, or repost settles, so other views can keep their copy in step. */
  onChange?(post: PostView): void;
  /**
   * How the home wall shows it: `spotlight` a wide card led by its picture, `quote` short text set
   * large on the author's color, `hot` the most talked-about post, `compact` a row inside a rollup.
   */
  variant?: "spotlight" | "quote" | "hot" | "compact";
  /** Called with a new quote post the visitor wrote from this card. */
  onQuoted?(post: PostView): void;
  /**
   * The reply box is already on the page (the post's own page): Reply becomes a button that calls
   * this instead of a link to the page you're on.
   */
  onReply?(): void;
}

/** Long posts fold in the feed past this many characters or lines. */
const FOLD_CHARS = 520;
const FOLD_LINES = 9;
/** Rows inside a rollup fold sooner. */
const COMPACT_FOLD_CHARS = 220;
const COMPACT_FOLD_LINES = 4;

export function postCard(post: PostView, options: PostCardOptions = {}): HTMLElement {
  const { author } = post;
  const authorHref = profilePath(author.id);
  const postHref = postPath(post.id);

  const time = timeAgo(post.createdAt, { full: options.focus });
  const timeLink = h("a", { class: "post-time", attrs: { href: postHref } }, time);
  // On its own page the full date sits under the text, so it never crowds out the name.
  if (options.focus) timeLink.classList.add("post-stamp");

  const reposter = post.repostedBy
    ? h(
        "a",
        { class: "post-reposted", attrs: { href: profilePath(post.repostedBy.id) } },
        icon("repost"),
        h("span", { text: `${post.repostedBy.name} reposted` }),
      )
    : null;

  const head = h(
    "header",
    { class: "post-head" },
    h(
      "a",
      { class: "post-avatar", attrs: { href: authorHref, tabindex: -1, "aria-hidden": "true" } },
      avatarEl(author),
    ),
    who(author, authorHref),
    options.focus ? null : timeLink,
  );

  const text = appendRichText(h("p", { class: "post-text" }), post.text, post.mentions);
  const lines = post.text.split("\n").length;
  const compact = options.variant === "compact";
  const foldChars = compact ? COMPACT_FOLD_CHARS : FOLD_CHARS;
  const foldLines = compact ? COMPACT_FOLD_LINES : FOLD_LINES;
  let more: HTMLElement | null = null;
  if (!options.focus && (post.text.length > foldChars || lines > foldLines)) {
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
          // Folding a long post back up from far down it would leave you posts below where you
          // were, so bring its top back into view, below the sticky top bar.
          const card = text.closest("article");
          if (!open && card) {
            const bar = document.querySelector(".site-bar")?.getBoundingClientRect().bottom ?? 0;
            const top = card.getBoundingClientRect().top;
            if (top < bar) window.scrollBy(0, top - bar - 8);
          }
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
          post.parent ? `Replying to ${post.parent.author.name}` : "Replying to a post",
        )
      : null;
  // On a resident's page, the post a reply answers sits above it.
  const parent =
    post.parent !== undefined && !options.inThread ? quoteEmbed(post.parent, true) : null;

  const classes = ["post"];
  if (!compact) classes.push("paper");
  if (options.focus) classes.push("focus");
  if (options.variant) classes.push(options.variant);
  if (reposter) classes.push("is-repost");
  const media = mediaGrid(post.media, author.name);
  // Strong language: the words and pictures go behind a tap-to-show cover, so a spotlight's
  // picture moves down into it too.
  const warned =
    post.contentWarning !== undefined ||
    Boolean(post.quote?.contentWarning) ||
    Boolean(parent && post.parent?.contentWarning);
  const lead = options.variant === "spotlight" && !warned ? media : null;
  const body = h(
    "div",
    { class: "stack post-body" },
    parent,
    options.variant === "quote"
      ? h("span", { class: "quote-mark" }, icon("quote", "icon quote-icon"))
      : null,
    text,
    more,
    post.quote === undefined ? null : quoteEmbed(post.quote),
    lead ? null : media,
  );
  const article = h(
    "article",
    {
      class: classes.join(" "),
      attrs: { "aria-label": `Post by ${author.name}`, "data-post": post.id },
    },
    reposter,
    options.variant === "hot"
      ? h(
          "p",
          { class: "post-flag" },
          icon("sparkle", "icon post-flag-icon"),
          h("span", { class: "post-flag-text", text: "Most talked about" }),
        )
      : null,
    // A spotlight leads with its picture; everything else reads top down.
    lead,
    head,
    context,
    warned ? contentWarning(body) : body,
    options.focus ? timeLink : null,
    ...actions(post, options),
  );
  if (options.variant === "quote")
    article.style.setProperty("--avatar", `var(--resident-${author.color})`);
  return article;
}

/**
 * A post with strong language (`contentWarning`) starts blurred behind a button. The words are on
 * the page either way: this only spares readers who'd rather not see them by surprise.
 */
function contentWarning(body: HTMLElement): HTMLElement {
  body.classList.add("cw-hidden");
  body.setAttribute("aria-hidden", "true");
  body.inert = true;
  const reveal = h(
    "button",
    { class: "cw-reveal", attrs: { type: "button" } },
    h("span", { class: "cw-title", text: "Strong language" }),
    h("span", { class: "cw-hint", text: "Tap to show" }),
  );
  const wrap = h("div", { class: "cw" }, body, reveal);
  reveal.addEventListener("click", () => {
    body.classList.remove("cw-hidden");
    body.removeAttribute("aria-hidden");
    body.inert = false;
    reveal.remove();
  });
  return wrap;
}

/** "…" with Report, on posts that aren't yours. */
function postMore(post: PostView): HTMLElement | null {
  if (post.author.id === savedResidentId()) return null;
  const report = h("button", {
    class: "menu-item",
    attrs: { type: "button" },
    text: "Report post",
  });
  const menu = moreMenu({
    id: `post-more-${post.id}`,
    items: [report],
    buttonClass: "post-action post-more-button",
    className: "post-more-wrap",
  });
  report.addEventListener("click", () => {
    menu.close();
    openReportSheet({ kind: "post", id: post.id, label: "post" });
  });
  return menu.el;
}

/** Long-press this long on the like button to pick another reaction. */
const LONG_PRESS_MS = 450;

function actions(post: PostView, options: PostCardOptions): HTMLElement[] {
  const needToken = (what: string) => {
    if (savedToken()) return false;
    toast(`Join the world to ${what}.`, { href: "/world", label: "Join" });
    return true;
  };
  const changed = () => options.onChange?.(post);

  // ---------- reactions ----------

  const chips = h("div", { class: "reaction-chips", attrs: { "aria-label": "Reactions" } });
  const likeCount = h("span", { class: "count" });
  const like = h(
    "button",
    { class: "post-action like", attrs: { type: "button" } },
    icon("heart"),
    likeCount,
  );
  const react = h(
    "button",
    {
      class: "post-action react",
      attrs: {
        type: "button",
        "aria-label": "React",
        "aria-haspopup": "true",
        "aria-expanded": "false",
      },
    },
    icon("smile"),
  );

  const paintReactions = () => {
    like.setAttribute("aria-pressed", String(post.liked));
    like.setAttribute("aria-label", `Like, ${plural(post.likeCount, "like", "likes")}`);
    likeCount.textContent = post.likeCount > 0 ? compactCount(post.likeCount) : "";
    const summary = reactionSummary(post, { skipHeart: true });
    chips.hidden = summary.length === 0;
    chips.replaceChildren(
      ...summary.map((r) =>
        h(
          "button",
          {
            class: "reaction-chip",
            attrs: {
              type: "button",
              "data-reaction": r.key,
              "aria-pressed": String(r.mine),
              "aria-label": `${REACTIONS[r.key].label}, ${r.count}`,
            },
            on: { click: () => void toggle(r.key, !r.mine) },
          },
          h(
            "span",
            { class: "chip-face" },
            h("span", {
              class: "chip-emoji",
              attrs: { "aria-hidden": "true" },
              text: REACTIONS[r.key].emoji,
            }),
            h("span", { class: "chip-count", text: compactCount(r.count) }),
          ),
        ),
      ),
    );
  };

  let busy = false;
  async function toggle(key: ReactionKey, on: boolean) {
    if (needToken(key === "heart" ? "like posts" : "react to posts") || busy) return;
    busy = true;
    // Optimistic: change it now, put it back if the server says no.
    const before = postState(post);
    applyReaction(post, key, on);
    paintReactions();
    if (key === "heart" && on) {
      replay(like, "pop");
    }
    // Hearts go through the like route, so older servers understand them too.
    const r = key === "heart" ? await api.like(post.id, on) : await api.react(post.id, key, on);
    busy = false;
    if (r.ok) copyPostState(r.data.post, post);
    else {
      copyPostState(before, post);
      toast(r.message);
    }
    paintReactions();
    changed();
  }

  // Tap: like. Long-press, or the smile button: the picker.
  let pressTimer: ReturnType<typeof setTimeout> | undefined;
  let longPressed = false;
  like.addEventListener("pointerdown", () => {
    longPressed = false;
    clearTimeout(pressTimer);
    pressTimer = setTimeout(() => {
      longPressed = true;
      openPicker(like);
    }, LONG_PRESS_MS);
  });
  for (const end of ["pointerup", "pointerleave", "pointercancel"] as const) {
    like.addEventListener(end, () => clearTimeout(pressTimer));
  }
  like.addEventListener("contextmenu", (e) => e.preventDefault());
  like.addEventListener("click", () => {
    if (longPressed) {
      longPressed = false;
      return;
    }
    void toggle("heart", !post.liked);
  });
  react.addEventListener("click", () => openPicker(react));

  const bar = h("footer", { class: "post-actions" });

  function openPicker(opener: HTMLElement) {
    if (needToken("react to posts")) return;
    let close = () => {};
    const picker = h(
      "div",
      { class: "reaction-picker paper", attrs: { role: "group", "aria-label": "Pick a reaction" } },
      ...REACTION_KEYS.map((key) =>
        h(
          "button",
          {
            class: "reaction-pick",
            attrs: {
              type: "button",
              "data-reaction": key,
              "aria-label": REACTIONS[key].label,
              "aria-pressed": String(hasReaction(post, key)),
            },
            on: {
              click: () => {
                close();
                void toggle(key, !hasReaction(post, key));
                opener.focus({ preventScroll: true });
              },
            },
          },
          h("span", { attrs: { "aria-hidden": "true" }, text: REACTIONS[key].emoji }),
        ),
      ),
    );
    close = openPopover(bar, picker, opener);
  }

  // ---------- reply ----------

  const replyLabel = post.replyCount > 0 ? plural(post.replyCount, "reply", "replies") : "Reply";
  const replyCount = h("span", {
    class: "count",
    text: post.replyCount > 0 ? compactCount(post.replyCount) : "",
  });
  const onReply = options.onReply;
  const reply = onReply
    ? h(
        "button",
        {
          class: "post-action reply",
          attrs: { type: "button", "aria-label": replyLabel },
          on: { click: () => onReply() },
        },
        icon("reply"),
        replyCount,
      )
    : h(
        "a",
        {
          class: "post-action reply",
          attrs: { href: postPath(post.id), "aria-label": replyLabel },
        },
        icon("reply"),
        replyCount,
      );

  // ---------- repost and quote ----------

  const repostCount = h("span", { class: "count" });
  const repost = h(
    "button",
    {
      class: "post-action repost",
      attrs: { type: "button", "aria-haspopup": "true", "aria-expanded": "false" },
    },
    icon("repost"),
    repostCount,
  );
  const paintRepost = () => {
    const n = post.repostCount ?? 0;
    repost.setAttribute("aria-pressed", String(post.reposted ?? false));
    repost.setAttribute("aria-label", `Repost or quote, ${plural(n, "repost", "reposts")}`);
    repostCount.textContent = n > 0 ? compactCount(n) : "";
  };

  let reposting = false;
  async function setRepost(on: boolean) {
    if (reposting) return;
    reposting = true;
    const before = postState(post);
    applyRepost(post, on);
    paintRepost();
    const r = await api.repost(post.id, on);
    reposting = false;
    if (r.ok) {
      copyPostState(r.data.post, post);
      toast(on ? "Reposted" : "Repost removed");
    } else {
      copyPostState(before, post);
      toast(r.message);
    }
    paintRepost();
    changed();
  }

  repost.addEventListener("click", () => {
    if (needToken("repost")) return;
    let close = () => {};
    const sheet = h(
      "div",
      { class: "repost-menu paper", attrs: { role: "group", "aria-label": "Repost" } },
      h(
        "button",
        {
          class: "repost-item repost-toggle",
          attrs: { type: "button" },
          on: {
            click: () => {
              close();
              void setRepost(!post.reposted);
            },
          },
        },
        icon("repost"),
        h("span", { text: post.reposted ? "Undo repost" : "Repost" }),
      ),
      h(
        "button",
        {
          class: "repost-item quote-open",
          attrs: { type: "button" },
          on: {
            click: () => {
              close();
              void myProfile().then((me) => {
                if (!me) {
                  toast("Join the world to quote posts.", { href: "/world", label: "Join" });
                  return;
                }
                openQuoteComposer(me, post, (quote) => {
                  post.quoteCount = (post.quoteCount ?? 0) + 1;
                  changed();
                  options.onQuoted?.(quote);
                  toast("Quote posted", { href: postPath(quote.id), label: "View" });
                });
              });
            },
          },
        },
        icon("quote"),
        h("span", { text: "Quote" }),
      ),
    );
    close = openPopover(bar, sheet, repost);
  });

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

  paintReactions();
  paintRepost();
  bar.append(like, react, reply, repost, share);
  const more = postMore(post);
  if (more) bar.append(more);
  return [chips, bar];
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
