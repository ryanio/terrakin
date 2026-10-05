/**
 * `/notifications`: what other residents did that involves you, newest first. Opening the page
 * marks everything shown as read. Names and excerpts are other residents' words: textContent only.
 */
import type { NotificationView } from "@terrakin/protocol";
import { h, type IconName, icon } from "@terrakin/ui/dom";
import { fullDate, relativeTime } from "@terrakin/ui/format";
import { avatarEl, postPath, profilePath } from "@terrakin/ui/people";
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
};

/** "Moss and 2 others reacted 🌱 to your post". Pure, so tests pin it. */
export function notificationLine(
  n: Pick<NotificationView, "type" | "count" | "reaction" | "gesture"> & {
    actor: { name: string };
  },
): { who: string; what: string } {
  const others = n.count - 1;
  const who =
    others > 0
      ? `${n.actor.name} and ${others} ${others === 1 ? "other" : "others"}`
      : n.actor.name;
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
          h(
            "time",
            {
              class: "notif-time",
              attrs: {
                datetime: n.createdAt,
                title: fullDate(n.createdAt),
                "data-rel": n.createdAt,
              },
            },
            relativeTime(n.createdAt, Date.now()),
          ),
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
    { class: "column page notifications-page" },
    h("h1", { class: "page-title", text: "Notifications" }),
  );
  let destroyed = false;

  if (!savedToken()) {
    el.append(
      h(
        "section",
        { class: "paper card state-card" },
        h("h2", { class: "state-title", text: "Join to get notifications" }),
        h("p", {
          class: "state-body",
          text: "When someone mentions you, replies, reacts, reposts, quotes, or follows you, it shows up here.",
        }),
        h(
          "a",
          { class: "btn-primary", attrs: { href: "/world" } },
          h("span", { text: "Step into the world" }),
          icon("arrow"),
        ),
      ),
    );
    return { el, ready: Promise.resolve(), destroy() {} };
  }

  const list = h("ol", { class: "notifs", attrs: { "aria-label": "Notifications" } });
  const more = h("button", {
    class: "pill-button load-more",
    attrs: { type: "button", hidden: true },
    text: "Show more",
  });
  let next: string | null = null;

  async function load(): Promise<void> {
    list.replaceChildren();
    const r = await api.notifications();
    if (destroyed) return;
    if (!r.ok) {
      el.replaceChildren(
        el.firstChild ?? "",
        errorCard(r.message, () => void load()),
      );
      return;
    }
    const { notifications, unread } = r.data;
    next = r.data.next;
    if (notifications.length === 0) {
      el.append(
        h(
          "div",
          { class: "paper note empty-note" },
          h("h2", { text: "Nothing yet" }),
          h("p", {
            text: "Post something, follow a few neighbors, or mention someone with @ and their handle. Replies and reactions will show up here.",
          }),
        ),
      );
      setUnread(0);
      return;
    }
    list.append(...notifications.map(item));
    more.hidden = next === null;
    const newest = notifications[0];
    if (unread > 0 && newest) {
      const marked = await api.markRead(newest.id);
      if (marked.ok) setUnread(marked.data.unread);
    } else setUnread(unread);
  }

  more.addEventListener("click", async () => {
    if (!next) return;
    more.disabled = true;
    const r = await api.notifications({ before: next });
    more.disabled = false;
    if (destroyed || !r.ok) return;
    list.append(...r.data.notifications.map(item));
    next = r.data.next;
    more.hidden = next === null;
  });

  el.append(list, h("div", { class: "feed-foot" }, more));
  return {
    el,
    ready: load(),
    destroy() {
      destroyed = true;
    },
  };
}
