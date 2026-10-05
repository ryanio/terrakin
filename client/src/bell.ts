/**
 * The bell in the site bar for residents, with a badge for unread notifications. `makeBell()`
 * builds it for the top bar; it asks the server on page changes (at most every 15 seconds) and
 * once a minute while the page is visible.
 */

import { h, icon } from "@terrakin/ui/dom";
import { api } from "./api";
import { savedToken } from "./net";

const POLL_MS = 60_000;
const MIN_GAP_MS = 15_000;

let link: HTMLAnchorElement | undefined;
let badge: HTMLElement | undefined;
let label: HTMLElement | undefined;
let lastAsked = 0;
let asking = false;

/** "3", or "99+" past 99. Empty for none. */
export function badgeText(unread: number): string {
  if (unread <= 0) return "";
  return unread > 99 ? "99+" : String(unread);
}

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
  badge = h("span", { class: "bell-badge", attrs: { "aria-hidden": "true", hidden: true } });
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

/** Ask for the unread count if there's a token and it's time. */
export function refreshBell(force = false) {
  if (!link || !savedToken() || asking) return;
  if (!force && Date.now() - lastAsked < MIN_GAP_MS) return;
  lastAsked = Date.now();
  asking = true;
  const target = badge;
  void api.notifications({ limit: 1 }).then((r) => {
    asking = false;
    if (r.ok && target === badge) setUnread(r.data.unread);
  });
}

export function initBell() {
  setInterval(() => {
    if (
      document.visibilityState === "visible" &&
      document.documentElement.classList.contains("mode-site")
    ) {
      refreshBell(true);
    }
  }, POLL_MS);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") refreshBell();
  });
}
