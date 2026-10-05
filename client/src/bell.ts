/**
 * The bell in the site bar for residents, with a badge for unread notifications. `makeBell()`
 * builds it for the top bar; it asks the server on page changes (at most every 15 seconds) and
 * once a minute while the page is visible.
 */

import { h, icon } from "@terrakin/ui/dom";
import { badgeText } from "@terrakin/ui/format";
import { visiblePoll } from "@terrakin/ui/poll";
import { api } from "./api";
import { savedToken } from "./net";

let link: HTMLAnchorElement | undefined;
let badge: HTMLElement | undefined;
let label: HTMLElement | undefined;

export function setUnread(unread: number) {
  if (!badge) return;
  const text = badgeText(unread);
  badge.textContent = text;
  badge.hidden = text === "";
  if (label) label.textContent = unread > 0 ? `Notifications, ${unread} unread` : "Notifications";
}

/** A new bell link for the top bar. Only one is live at a time: the newest. */
export function makeBell(): HTMLAnchorElement {
  label = h("span", { class: "visually-hidden", text: "Notifications" });
  badge = h("span", { class: "count-badge", attrs: { "aria-hidden": "true", hidden: true } });
  link = h(
    "a",
    {
      class: "pill-button small site-bell",
      attrs: { id: "site-bell", href: "/notifications", "data-nav": "notifications" },
    },
    icon("bell"),
    label,
    badge,
  );
  refreshBell(true);
  return link;
}

const poll = visiblePoll(
  async () => {
    const target = badge;
    const r = await api.notifications({ limit: 1 });
    if (r.ok && target === badge) setUnread(r.data.unread);
  },
  {
    everyMs: 60_000,
    minGapMs: 15_000,
    ready: () => Boolean(link && savedToken()),
    when: () => document.documentElement.classList.contains("mode-site"),
  },
);

/** Ask for the unread count if there's a token and it's time. `force` skips the 15 second gap. */
export const refreshBell = (force = false) => poll.refresh(force);

export const initBell = poll.start;
