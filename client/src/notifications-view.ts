/**
 * `/notifications`: what other residents did that involves you, newest first. Opening the page
 * marks everything shown as read. Names and excerpts are other residents' words: textContent only.
 */

import type { NotificationView } from "@terrakin/protocol";
import { h, type IconName, icon } from "@terrakin/ui/dom";
import { plural } from "@terrakin/ui/format";
import { postPath, profilePath } from "@terrakin/ui/paths";
import { avatarEl } from "@terrakin/ui/people";
import { emptyNote, moreButton, stateCard } from "@terrakin/ui/ui";
import { timeAgo } from "@terrakin/ui/when";
import { api } from "./api";
import { setUnread } from "./bell";
import { savedToken } from "./net";
import { REACTIONS } from "./reactions";
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
};

/** "Moss and 2 others reacted 🌱 to your post". Pure, so tests pin it. */
export function notificationLine(
  n: Pick<NotificationView, "type" | "count" | "reaction" | "gesture"> & {
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
  };
  return { who, what: what[n.type] };
}

function item(n: NotificationView): HTMLElement {
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
    list.append(...r.data.notifications.map(item));
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
    list.replaceChildren(...notifications.map(item));
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
