/**
 * `/notifications`: what other residents did that involves you, and notices from Terrakin itself
 * (a takedown), newest first. Opening the page marks everything shown as read. Names and excerpts
 * are residents' words: textContent only.
 */

import { LINKS, type NotificationView, type TakedownView } from "@terrakin/protocol";
import { h, type IconName, icon } from "@terrakin/ui/dom";
import { plural } from "@terrakin/ui/format";
import { postPath, profilePath } from "@terrakin/ui/paths";
import { avatarEl } from "@terrakin/ui/people";
import { RULE_WORDS } from "@terrakin/ui/safety";
import { emptyNote, moreButton, stateCard } from "@terrakin/ui/ui";
import { timeAgo } from "@terrakin/ui/when";
import { api } from "./api";
import { setUnread } from "./bell";
import { levelsLine } from "./levels";
import { savedToken } from "./net";
import { aThing, petCalled } from "./pets";
import { REACTIONS } from "./reactions";
import { recipeWords, thingCount, thingName } from "./things";
import { gestureInfo } from "./together";
import { errorCard, type View, type ViewContext } from "./view";

const ICONS: Record<NotificationView["type"], IconName> = {
  mention: "at",
  reply: "reply",
  quote: "quote",
  repost: "repost",
  reaction: "heart",
  follow: "follow",
  letter: "mail",
  gesture: "sparkle",
  praise: "star",
  takedown: "town",
  pet_pat: "paw",
  pet_treat: "paw",
  plot_admired: "sparkle",
  trick_or_treat: "candy",
  recipe_taught: "kitchen",
  level_reached: "level",
};

/** "Moss and 2 others reacted 🌱 to your post". Pure, so tests pin it. */
export function notificationLine(
  n: Pick<
    NotificationView,
    "type" | "count" | "reaction" | "gesture" | "pet" | "treat" | "recipe"
  > & {
    actor: { name: string };
  },
): { who: string; what: string } {
  const others = n.count - 1;
  const who =
    others > 0 ? `${n.actor.name} and ${plural(others, "other", "others")}` : n.actor.name;
  const emoji = n.reaction ? ` ${REACTIONS[n.reaction].emoji}` : "";
  const sent = n.gesture
    ? `${gestureInfo(n.gesture).noun} ${gestureInfo(n.gesture).emoji}`
    : "a gesture";
  const what: Record<NotificationView["type"], string> = {
    mention: "mentioned you",
    reply: "replied to your post",
    quote: "quoted your post",
    repost: "reposted your post",
    reaction: `reacted${emoji} to your post`,
    follow: "followed you",
    letter: "sent you a letter",
    gesture: `sent you ${sent}`,
    praise: "praised you",
    takedown: "took something of yours down",
    pet_pat: `patted ${petCalled(n.pet)}`,
    pet_treat: `gave ${petCalled(n.pet)} ${n.treat ? aThing(n.treat) : "a treat"}`,
    plot_admired: "admired your plot",
    trick_or_treat: "came trick-or-treating at your door",
    recipe_taught: `taught you ${n.recipe ? recipeWords(n.recipe).toLowerCase() : "a recipe"}`,
    level_reached: "says you reached a level",
  };
  return { who, what: what[n.type] };
}

/**
 * A takedown notice in plain words (decision 0064): what came down and the rule it broke, then
 * what happens next. Built from the notice's fields only, never from a label or title, so no
 * resident's words are in it. Pure, so tests pin it.
 */
export function takedownLine(t: TakedownView): { line: string; next: string } {
  const rule = RULE_WORDS[t.rule];
  const held = t.outcome === "held";
  switch (t.what) {
    case "listing": {
      const lot = t.kind ? thingCount(t.kind, t.count ?? 1) : "things";
      return {
        line: `Your listing of ${lot} was taken down: it broke ${rule}.`,
        next: held
          ? "Your things were full, so the lot is held for you. Make room, then take it back from the market."
          : "The lot is back in your things.",
      };
    }
    case "display": {
      const thing = t.kind ? thingName(t.kind).toLowerCase() : "thing";
      return {
        line: `Your ${thing} was taken off display: it broke ${rule}.`,
        next: held
          ? "Your things were full, so it's held for you and comes back once you have room."
          : "It's back in your things.",
      };
    }
    case "piece":
      return {
        line: `The picture on your piece of art was deleted: it broke ${rule}.`,
        next: "Every piece made from that picture keeps its title and shows a plain canvas.",
      };
    case "post":
      return {
        line: `Your post was hidden: it broke ${rule}.`,
        next: "Nobody else can see it now.",
      };
    case "pictures":
      return {
        line: `Your profile picture and banner were deleted: they broke ${rule}.`,
        next: "You can upload new ones that keep to the rules.",
      };
    case "plot_name": {
      const which = t.plot ? `plot ${t.plot.px}, ${t.plot.py}` : "a plot";
      return {
        line: `The name you gave ${which} was taken down: it broke ${rule}.`,
        next: "The plot has no name now. Its residents can give it a new one that keeps to the rules.",
      };
    }
  }
}

/** Where a takedown's thing is now, when there's a page for it. */
function takedownPlace(t: TakedownView): { href: string; label: string } | null {
  if (t.what === "listing" && t.outcome === "held")
    return { href: "/market", label: "Open the market" };
  if (t.what === "listing" || t.what === "display") {
    return { href: "/inventory", label: "Open your things" };
  }
  return null;
}

/** What a notice from Terrakin itself says, and the links under it. */
interface SystemWords {
  icon: IconName;
  line: string;
  next: string | null;
  links: { href: string; label: string }[];
}

/** The words for a notice from Terrakin itself, or null for a kind this client doesn't know. */
function systemWords(n: NotificationView): SystemWords | null {
  if (n.takedown) {
    const place = takedownPlace(n.takedown);
    return {
      icon: ICONS.takedown,
      ...takedownLine(n.takedown),
      links: [...(place ? [place] : []), { href: LINKS.contact, label: "How to appeal" }],
    };
  }
  if (n.levels && n.levels.length > 0) {
    return { icon: ICONS.level_reached, ...levelsLine(n.levels), links: [] };
  }
  return null;
}

/**
 * A notice from Terrakin itself: no resident, no avatar, no profile to open. The excerpt (a hidden
 * post's start) is the resident's own words: text only.
 */
function systemItem(n: NotificationView, words: SystemWords): HTMLElement {
  const { line, next } = words;
  return h(
    "li",
    {},
    h(
      "div",
      {
        class: `notif notif-system paper${n.read ? "" : " unread"}`,
        attrs: { "data-type": n.type },
      },
      h("span", { class: "notif-icon system", attrs: { "aria-hidden": "true" } }, icon(words.icon)),
      h(
        "span",
        { class: "notif-body" },
        h(
          "span",
          { class: "notif-top" },
          h("strong", { class: "notif-who", text: "Terrakin" }),
          timeAgo(n.createdAt, { className: "notif-time" }),
        ),
        h(
          "span",
          { class: "notif-line" },
          line,
          n.read ? null : h("span", { class: "visually-hidden", text: " (new)" }),
        ),
        n.excerpt ? h("span", { class: "notif-excerpt", text: n.excerpt }) : null,
        next ? h("span", { class: "notif-next", text: next }) : null,
        words.links.length > 0
          ? h(
              "span",
              { class: "cluster notif-links" },
              ...words.links.map((link) =>
                h(
                  "a",
                  { class: "text-link", attrs: { href: link.href } },
                  h("span", { text: link.label }),
                ),
              ),
            )
          : null,
      ),
    ),
  );
}

/** One notification as a list item. */
export function notificationItem(n: NotificationView): HTMLElement {
  const fromTerrakin = n.system ? systemWords(n) : null;
  if (fromTerrakin) return systemItem(n, fromTerrakin);
  // Letters and gestures are private: they open your letters with that resident.
  const href = n.postId
    ? postPath(n.postId)
    : n.type === "letter" || n.type === "gesture"
      ? `/letters/${encodeURIComponent(n.actor.id)}`
      : profilePath(n.actor.id);
  const { who, what } = notificationLine(n);
  return h(
    "li",
    {},
    h(
      "a",
      {
        class: `notif paper${n.read ? "" : " unread"}`,
        attrs: { href, "data-type": n.type },
      },
      h(
        "span",
        { class: `notif-icon ${n.type}`, attrs: { "aria-hidden": "true" } },
        icon(ICONS[n.type]),
      ),
      h(
        "span",
        { class: "notif-body" },
        h(
          "span",
          { class: "notif-top" },
          avatarEl(n.actor, "sm"),
          timeAgo(n.createdAt, { className: "notif-time" }),
        ),
        h(
          "span",
          { class: "notif-line" },
          h("strong", { class: "notif-who", text: who }),
          ` ${what}`,
          n.read ? null : h("span", { class: "visually-hidden", text: " (new)" }),
        ),
        n.excerpt ? h("span", { class: "notif-excerpt", text: n.excerpt }) : null,
      ),
    ),
  );
}

export function notificationsView(ctx: ViewContext): View {
  ctx.setTitle("Notifications · Terrakin");
  const el = h(
    "div",
    { class: "column stack cards page notifications-page" },
    h("h1", { class: "page-title", text: "Notifications" }),
  );
  let destroyed = false;

  if (!savedToken()) {
    el.append(
      stateCard({
        title: "Join to get notifications",
        body: "When someone mentions you, replies, reacts, reposts, quotes, or follows you, it shows up here.",
        actions: [
          h(
            "a",
            { class: "btn-primary", attrs: { href: "/world" } },
            h("span", { text: "Step into the world" }),
            icon("arrow"),
          ),
        ],
      }),
    );
    return { el, ready: Promise.resolve(), destroy() {} };
  }

  const list = h("ol", {
    class: "stack plain-list notifs",
    attrs: { "aria-label": "Notifications" },
  });
  const more = moreButton("Show more", async () => {
    if (!next) return;
    const r = await api.notifications({ before: next });
    if (destroyed) return;
    if (!r.ok) return r.message;
    list.append(...r.data.notifications.map(notificationItem));
    next = r.data.next;
    more.el.hidden = next === null;
  });
  let next: string | null = null;
  const foot = h("div", { class: "feed-foot" }, more.el);
  // The list, its foot, and the empty and error states take turns in here, so a retry after an
  // error puts the list back on the page before anything is marked read.
  const body = h("div", {});

  async function load(): Promise<void> {
    const r = await api.notifications();
    if (destroyed) return;
    if (!r.ok) {
      body.replaceChildren(errorCard(r.message, () => void load()));
      return;
    }
    const { notifications, unread } = r.data;
    next = r.data.next;
    if (notifications.length === 0) {
      body.replaceChildren(
        emptyNote(
          "Nothing yet",
          "Post something, follow a few neighbors, or mention someone with @ and their handle. Replies and reactions will show up here.",
        ),
      );
      setUnread(0);
      return;
    }
    list.replaceChildren(...notifications.map(notificationItem));
    more.el.hidden = next === null;
    body.replaceChildren(list, foot);
    const newest = notifications[0];
    if (unread > 0 && newest) {
      const marked = await api.markRead(newest.id);
      if (marked.ok) setUnread(marked.data.unread);
    } else setUnread(unread);
  }

  el.append(body);
  return {
    el,
    ready: load(),
    destroy() {
      destroyed = true;
    },
  };
}
