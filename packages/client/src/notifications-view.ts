/**
 * `/notifications`: what other residents did that involves you, and notices from Terrakin itself
 * (a takedown), newest first. Opening the page marks everything shown as read. Names and excerpts
 * are residents' words: textContent only.
 */

import {
  type EventNoticeView,
  jobDoneLine,
  LINKS,
  type NotificationsResponse,
  type NotificationView,
  type TakedownView,
} from "@terrakin/protocol";
import { blockNeeds } from "@terrakin/sim";
import { h, type IconName, icon } from "@terrakin/ui/dom";
import { plural } from "@terrakin/ui/format";
import { postPath, profilePath } from "@terrakin/ui/paths";
import { avatarEl } from "@terrakin/ui/people";
import { RULE_WORDS } from "@terrakin/ui/safety";
import { emptyNote, moreButton } from "@terrakin/ui/ui";
import { timeAgo } from "@terrakin/ui/when";
import { notificationsApi } from "./api/notifications";
import { setUnread } from "./bell";
import { soonWords, whenWords } from "./event-format";
import { canNowLine, levelsLine } from "./levels";
import { savedResidentId, savedToken } from "./net";
import { pageData } from "./page-data";
import { passkeyNoticeLine } from "./passkey-words";
import { petCalled } from "./pets";
import { REACTIONS } from "./reactions";
import { aThing, recipeWords, thingCount, thingName } from "./things";
import { gestureInfo } from "./together";
import { failInto, joinCard, staticView, type View, type ViewContext } from "./view";

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
  job_done: "town",
  event_started: "calendar",
  event_soon: "calendar",
  circle_invite: "follow",
  circle_night: "calendar",
  circle_joined: "follow",
  present_received: "gift",
  present_opened: "gift",
  award: "coin",
  passkey_bound: "key",
  passkey_signin: "key",
  block_cleared: "town",
};

/** "Moss and 2 others reacted 🌱 to your post". Pure, so tests pin it. */
export function notificationLine(
  n: Pick<
    NotificationView,
    "type" | "count" | "reaction" | "gesture" | "pet" | "treat" | "recipe" | "award"
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
    job_done: "says you finished a job",
    event_started: "says an event you're going to started",
    event_soon: "says an event you're going to starts soon",
    circle_invite: "says a circle invited you",
    circle_night: "says your circle has a night coming",
    circle_joined: "says someone joined your circle",
    present_received: `wrapped ${others > 0 ? "presents" : "a present"} for you`,
    present_opened: `opened ${others > 0 ? "the presents" : "the present"} you wrapped`,
    // From Terrakin itself, so this reads "Terrakin awarded you 200 coins for your work." No deed
    // of theirs earned it, and the notice carries no words (RFC 0036).
    award: `awarded you ${plural(n.award?.coins ?? 0, "coin", "coins")} for your work`,
    // Both arrive with `system: true`, so `systemWords` writes what a person reads and these two
    // are here for the type alone, as the words a client would fall back to (RFC 0037).
    passkey_bound: "says a passkey was added",
    passkey_signin: "says someone signed in with a passkey",
    block_cleared: "opened a way out of your home",
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
    case "circle_name":
      return {
        line: `Your circle's name was taken down: it broke ${rule}.`,
        next: "It goes by its number for now. A steward can give it a new name that keeps to the rules.",
      };
    case "circle_notice":
      return {
        line: `Your circle's notice was taken down: it broke ${rule}.`,
        next: "A steward can write a new one that keeps to the rules.",
      };
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

/**
 * An `event_soon` or `event_started` notice in plain words, as the event stands now: still to come,
 * on, over, or called off. The title is the host's words, so it's never in the line: the item shows
 * it apart, as text.
 */
function eventNoticeLine(e: EventNoticeView, now: number): { line: string; next: string | null } {
  if (e.status === "cancelled") {
    return { line: "An event you were going to was called off.", next: null };
  }
  if (e.status === "scheduled") {
    return {
      line: "An event you're going to is coming up.",
      next: `${whenWords(e.startsAt, now)}.`,
    };
  }
  if (e.status === "live") {
    return { line: "An event you're going to has started.", next: `${soonWords(e, now)}.` };
  }
  return { line: "An event you were going to has started and ended.", next: null };
}

/** What a notice from Terrakin itself says, and the links under it. */
interface SystemWords {
  icon: IconName;
  line: string;
  next: string | null;
  links: { href: string; label: string }[];
  /** Someone's words the notice is about, each shown apart from the line as text. */
  quotes?: string[];
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
    // Your own profile has the chip that opens your skills.
    const me = savedResidentId();
    return {
      icon: ICONS.level_reached,
      ...levelsLine(n.levels),
      links: me ? [{ href: profilePath(me), label: "See your skills" }] : [],
    };
  }
  if (n.job) {
    // A finished job (RFC 0030), in the server's fixed words, and what the count unlocked.
    return {
      icon: ICONS.job_done,
      line: jobDoneLine(n.job),
      next: n.job.unlocks ? canNowLine([n.job.unlocks]) : null,
      links: [],
    };
  }
  if (n.circle) {
    // Circles (RFC 0033): the circle's name is quoted under the line, and who invited or joined
    // goes in it by their name; both are residents' words, drawn as text.
    const who = n.resident?.name ?? "Someone";
    const page = { href: `/c/${n.circle.id}`, label: "Open the circle" };
    const words: Record<string, { line: string; next: string | null }> = {
      circle_invite: {
        line: `${who} invited you to a circle.`,
        next: "Joining is your choice. Its page has Join and Not now.",
      },
      circle_night: {
        line: "Someone in your circle put a circle night on the calendar.",
        next: "It's at the circle's hall. Say you're going on its page.",
      },
      circle_joined: { line: `${who} joined your circle.`, next: null },
    };
    const said = words[n.type];
    // The steward's note comes with an invite (issue #73), under the circle's name.
    const quotes = [n.circle.name, ...(n.type === "circle_invite" && n.note ? [n.note] : [])];
    if (said) return { icon: ICONS[n.type], ...said, links: [page], quotes };
  }
  if (n.cleared) {
    // The team opened a way out of a home nobody could walk out of (decision 0343).
    return { icon: ICONS.block_cleared, ...clearedLine(n.cleared), links: [] };
  }
  if (n.type === "passkey_bound" || n.type === "passkey_signin") {
    // Signing in (RFC 0037). The notice carries nothing but the fact and the time, so the words
    // are fixed and the link goes where both can be undone: Signing in on your own profile.
    const me = savedResidentId();
    return {
      icon: ICONS[n.type],
      ...passkeyNoticeLine(n.type),
      links: me ? [{ href: `${profilePath(me)}#signin`, label: "Open Signing in" }] : [],
    };
  }
  if (n.event) {
    // An event you said you're going to is a day off, or started (RFC 0010); the Town Hall has it.
    const { status } = n.event;
    return {
      icon: ICONS[n.type],
      ...eventNoticeLine(n.event, Date.now()),
      links:
        status === "live" || status === "scheduled"
          ? [{ href: "/town#events", label: status === "live" ? "See what's on" : "See Coming up" }]
          : [],
      quotes: [n.event.title],
    };
  }
  return null;
}

/**
 * A block-cleared notice in plain words (decision 0343): where the block was, and whether
 * anything came back, by the sim's own `blockNeeds`. Built from the notice's fields only. Pure, so
 * tests pin it.
 */
export function clearedLine(c: { x: number; y: number; block: string }): {
  line: string;
  next: string;
} {
  const back = blockNeeds(c.block).length > 0;
  return {
    line: `Your hearth had no way out to the town, so the team took the block at ${c.x}, ${c.y} off your plot.`,
    next: back
      ? "What it cost is back in your things. Build it somewhere else if you like, as long as a way out stays open."
      : "It was a free block, so nothing came back. Build it somewhere else if you like, as long as a way out stays open.",
  };
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
        ...(words.quotes ?? (n.excerpt ? [n.excerpt] : [])).map((said) =>
          h("span", { class: "notif-excerpt", text: said }),
        ),
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

  if (!savedToken()) {
    el.append(
      joinCard({
        title: "Join to get notifications",
        body: "When someone mentions you, replies, reacts, reposts, quotes, or follows you, it shows up here.",
        door: "world",
      }),
    );
    return staticView(el);
  }

  const list = h("ol", {
    class: "stack plain-list notifs",
    attrs: { "aria-label": "Notifications" },
  });
  const more = moreButton("Show more", async () => {
    if (!next) return;
    const r = await notificationsApi.notifications({ before: next });
    if (loader.gone()) return;
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

  function paint(data: NotificationsResponse) {
    const { notifications, unread } = data;
    next = data.next;
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
    // Not awaited: the list is in, so the page shows without waiting on this.
    if (unread > 0 && newest) {
      void notificationsApi.markRead(newest.id).then((marked) => {
        if (marked.ok) setUnread(marked.data.unread);
      });
    } else setUnread(unread);
  }

  el.append(body);
  const loader = pageData({
    ask: () => notificationsApi.notifications(),
    paint,
    fail: failInto(body),
  });
  return { el, ready: loader.ready, destroy: loader.leave };
}
