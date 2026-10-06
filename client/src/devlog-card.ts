/**
 * "From the devlog" on the home wall (decision 0105): the newest post's title, day, and first
 * paragraph, the rest folded behind Show more, and a link to the post's page. Once someone opens
 * the rest or the page, or hides the card, this device keeps the post's day, and the card stays
 * away until a newer post. Posts are the Terrakin team's Markdown, drawn by `markdownNodes`.
 */
import { type DevlogPost, devlogLead } from "@terrakin/protocol";
import { h, icon } from "@terrakin/ui/dom";
import { announce, disclosure } from "@terrakin/ui/ui";
import { api } from "./api";
import { markdownNodes } from "./markdown";

/** The day of the newest post this device is done with. */
const SEEN_KEY = "terrakin.devlogSeen";

/** Whether to show the post of `date` to a device done with the post of `seen`. Pure. */
const showDevlog = (date: string, seen: string | null): boolean => seen === null || date > seen;

/** A post's day, short enough for the card's eyebrow on a phone: "Oct 6", with a year if not this one. */
function shortDay(date: string): string {
  const ms = Date.parse(`${date}T00:00:00Z`);
  const thisYear = new Date(ms).getUTCFullYear() === new Date().getUTCFullYear();
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    ...(thisYear ? {} : { year: "numeric" }),
    timeZone: "UTC",
  }).format(ms);
}

function seenDay(): string | null {
  try {
    return localStorage.getItem(SEEN_KEY);
  } catch {
    return null;
  }
}

function markSeen(date: string) {
  try {
    localStorage.setItem(SEEN_KEY, date);
  } catch {
    // Storage off: the card comes back next time, which is all that's lost.
  }
}

/**
 * The card for one post. `done` runs once, the first time someone opens the rest or the post's
 * page or hides the card.
 */
function devlogCard(post: DevlogPost, done: (date: string) => void): HTMLElement {
  const { lead, rest } = devlogLead(post.body);
  let finished = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    done(post.date);
  };
  const page = post.url.replace(/^https?:\/\/[^/]+/, "");
  const hide = h(
    "button",
    {
      class: "sheet-close devlog-hide",
      attrs: { type: "button", "aria-label": "Hide this devlog post" },
    },
    icon("close"),
  );
  const more = rest
    ? h("button", {
        class: "pill-button small devlog-more",
        attrs: { type: "button" },
        text: "Show more",
      })
    : null;
  const panel = rest
    ? h(
        "div",
        { class: "prose devlog-rest", attrs: { id: "devlog-rest", hidden: true } },
        ...markdownNodes(rest, 1),
      )
    : null;
  const card = h(
    "section",
    {
      class: "paper card stack devlog-card",
      attrs: { id: "devlog-card", "aria-labelledby": "devlog-title" },
    },
    h(
      "div",
      { class: "devlog-head" },
      h("p", { class: "eyebrow", text: `From the devlog · ${shortDay(post.date)}` }),
      hide,
    ),
    h(
      "h2",
      { class: "card-title", attrs: { id: "devlog-title" } },
      h("a", {
        class: "devlog-title-link",
        attrs: { href: page },
        text: post.title,
        on: { click: finish },
      }),
    ),
    h("div", { class: "prose devlog-lead" }, ...markdownNodes(lead, 1)),
    panel,
    h(
      "div",
      { class: "cluster devlog-actions" },
      more,
      h(
        "a",
        { class: "text-link", attrs: { href: page }, on: { click: finish } },
        h("span", { text: "Read it on its page" }),
        icon("arrow"),
      ),
    ),
  );
  if (more && panel) {
    disclosure(more, panel, undefined, (open) => {
      more.textContent = open ? "Show less" : "Show more";
      if (open) finish();
    });
  }
  hide.addEventListener("click", () => {
    finish();
    card.remove();
    announce("Hidden until the next devlog post.");
  });
  return card;
}

/** The newest post's card, unless this device is done with it. Null when there's none to show. */
export async function newestDevlogCard(): Promise<HTMLElement | null> {
  const list = await api.devlog();
  const newest = list.ok ? list.data.posts[0] : undefined;
  if (!newest || !showDevlog(newest.date, seenDay())) return null;
  const one = await api.devlogPost(newest.date);
  return one.ok ? devlogCard(one.data.post, markSeen) : null;
}
