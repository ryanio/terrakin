// Must stay first: turns off zod's eval probe before any schema is built (see jitless.ts).
import "./jitless";
import "@fontsource-variable/fraunces/full.css";
import "@fontsource-variable/fraunces/wonk-italic.css";
import "@fontsource-variable/figtree";
import "@fontsource-variable/figtree/wght-italic.css";
import { markdownTwin } from "@terrakin/protocol";
import { h, icon } from "@terrakin/ui/dom";
import { badgeText } from "@terrakin/ui/format";
import { useModelViewer } from "@terrakin/ui/media";
import { profilePath } from "@terrakin/ui/paths";
import { avatarEl, avatarPlaceholder } from "@terrakin/ui/people";
import { interceptPop, leaveOverlay } from "@terrakin/ui/ui";
import { api, MY_PROFILE_EVENT, myProfile, SUSPENDED_EVENT } from "./api";
import { initBell, makeBell, refreshBell } from "./bell";
import { bountiesView } from "./bounties-view";
import { initBrandMarks } from "./chrome";
import { claimView } from "./claim-view";
import { feedView } from "./feed-view";
import { inventoryView } from "./inventory-view";
import { inviteView } from "./invite-view";
import { lettersView, letterThreadView, UNREAD_EVENT } from "./letters-view";
import { marketView } from "./market-view";
import { SESSION_EVENT, savedResidentId, savedToken } from "./net";
import { notificationsView } from "./notifications-view";
import { peopleView } from "./people-view";
import { postView } from "./post-view";
import { profileView } from "./profile-view";
import { initPurse, makePurse, refreshPurse } from "./purse";
import { purseView } from "./purse-view";
import { createRouter, matchRoute, type Navigation, type Route, routeTemplate } from "./router";
import { shopView } from "./shop-view";
import { initErrorReporting, pageView, startAnalytics } from "./telemetry";
import { townView } from "./town-view";
import { notFoundView, type View, type ViewContext } from "./view";
import { view3d } from "./view-3d";
import "./style.css";

// Models open in the three.js viewer, its own chunk, loaded only when someone opens one.
useModelViewer(() => import("./model-viewer"));

// Analytics first, with the page set as a template before gtag.js can send anything.
startAnalytics(routeTemplate(matchRoute(location.pathname)));
void initErrorReporting();

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const site = $("site");
const page = $("page");

// "Skip to content" moves focus past the top bar. Handled here, so the router doesn't treat it
// as a navigation to the same page.
document.querySelector(".skip-link")?.addEventListener("click", (e) => {
  e.preventDefault();
  page.focus();
});
const worldView = $("world-view");
const root = document.documentElement;

initBrandMarks(site);
const you = $("site-you");
initBell();
initPurse();

let view: View | undefined;
let world: Promise<typeof import("./world")> | undefined;

/**
 * The world is its own chunk: fetched the first time someone goes to /world. The landing form's
 * controls start disabled in the HTML, so Enter can't submit it natively (with the key in the URL)
 * before the world's handlers are attached; they come on once the chunk has run.
 */
const loadWorld = () => {
  world ??= import("./world").then(
    (w) => {
      for (const el of document.querySelectorAll<HTMLInputElement | HTMLButtonElement>(
        "[data-until-ready]",
      ))
        el.disabled = false;
      return w;
    },
    (err: unknown) => {
      showWorldReload();
      throw err;
    },
  );
  return world;
};

/** The world's chunk didn't load, usually because a new version went out since this page opened. */
function showWorldReload() {
  const form = document.getElementById("world-join");
  if (!form || form.querySelector(".world-reload")) return;
  form.prepend(
    h(
      "div",
      { class: "world-reload", attrs: { role: "alert" } },
      h("p", { text: "Terrakin was updated. Reload to continue." }),
      h("button", {
        class: "pill-button small",
        attrs: { type: "button" },
        text: "Reload",
        on: { click: () => location.reload() },
      }),
    ),
  );
}

function setMode(mode: "site" | "world") {
  root.classList.toggle("mode-world", mode === "world");
  root.classList.toggle("mode-site", mode === "site");
  site.hidden = mode !== "site";
  worldView.hidden = mode !== "world";
}

function paintNav(route: Route) {
  for (const a of document.querySelectorAll<HTMLAnchorElement>("[data-nav]")) {
    const current =
      (a.dataset.nav === "feed" && route.name === "feed") ||
      (a.dataset.nav === "world" && route.name === "world") ||
      (a.dataset.nav === "letters" &&
        (route.name === "letters" || route.name === "letters-with")) ||
      (a.dataset.nav === "town" && route.name === "town") ||
      (a.dataset.nav === "notifications" && route.name === "notifications") ||
      (a.dataset.nav === "purse" && route.name === "purse");
    if (current) a.setAttribute("aria-current", "page");
    else a.removeAttribute("aria-current");
  }
}

/**
 * The right end of the top bar. Residents get their letters (with an unread count) and their own
 * avatar, which opens their profile, picture, key, and look. Visitors get a Join pill that leads to
 * the get-started cards, except on the home page, which already shows them.
 */
let unreadCount: HTMLElement | undefined;
let lettersLink: HTMLAnchorElement | undefined;
let youLink: HTMLAnchorElement | undefined;
let headerFor: string | null | undefined;

function paintHeader(route: Route) {
  const token = savedToken();
  if (!token) {
    headerFor = null;
    unreadCount = undefined;
    lettersLink = undefined;
    youLink = undefined;
    you.replaceChildren(
      route.name === "feed"
        ? ""
        : h(
            "a",
            { class: "pill-button small join-pill", attrs: { href: "/#join" } },
            h("span", { text: "Join" }),
          ),
    );
    return;
  }
  if (headerFor === token) {
    void refreshUnread();
    return;
  }
  headerFor = token;
  unreadCount = h("span", { class: "count-badge", attrs: { "aria-hidden": "true", hidden: true } });
  lettersLink = h(
    "a",
    {
      class: "pill-button small letters-link",
      attrs: { href: "/letters", "aria-label": "Letters", "data-nav": "letters" },
    },
    icon("mail"),
    unreadCount,
  );
  const savedId = savedResidentId();
  const me = h(
    "a",
    {
      class: "you-link",
      attrs: { href: savedId ? profilePath(savedId) : "/letters", "aria-label": "You" },
    },
    avatarPlaceholder("sm", "you-placeholder"),
  );
  youLink = me;
  you.replaceChildren(makePurse(), makeBell(), lettersLink, me);
  paintYou();
  void refreshUnread();
}

/** Your avatar in the top bar, from your profile. Painted again when you change your picture or look. */
function paintYou() {
  const link = youLink;
  if (!link) return;
  void myProfile().then((profile) => {
    if (!profile || link !== youLink) return;
    link.setAttribute("href", profilePath(profile.id));
    link.setAttribute("aria-label", "You: your profile, picture, key, and look");
    link.replaceChildren(avatarEl(profile, "sm"));
  });
}

window.addEventListener(MY_PROFILE_EVENT, paintYou);

async function refreshUnread() {
  const badge = unreadCount;
  const link = lettersLink;
  if (!badge || !link) return;
  const r = await api.letters({ limit: 1 });
  if (!r.ok || badge !== unreadCount) return;
  const text = badgeText(r.data.unread);
  badge.textContent = text;
  badge.hidden = text === "";
  link.setAttribute("aria-label", text ? `Letters, ${r.data.unread} unread` : "Letters");
}

window.addEventListener(UNREAD_EVENT, () => void refreshUnread());

/**
 * A maintainer suspended this resident: say so once, at the top of the page, in the server's words.
 * Reading still works, so nothing else changes.
 */
window.addEventListener(SUSPENDED_EVENT, (e) => {
  const message = (e as CustomEvent<unknown>).detail;
  if (typeof message !== "string" || document.getElementById("suspended-banner")) return;
  const banner = h(
    "div",
    { class: "suspended-banner", attrs: { id: "suspended-banner", role: "alert" } },
    h("p", { text: message }),
    h("button", {
      class: "pill-button small",
      attrs: { type: "button" },
      text: "OK",
      on: { click: () => banner.remove() },
    }),
  );
  site.prepend(banner);
});
// Joining from a page (an invite, or Join and follow) changes who you are without navigating.
let lastRoute: Route | undefined;
window.addEventListener(SESSION_EVENT, () => {
  if (lastRoute) {
    paintHeader(lastRoute);
    paintNav(lastRoute);
  }
});

function onNavigate(nav: Navigation) {
  const { route } = nav;
  view?.destroy();
  view = undefined;
  lastRoute = route;
  paintHeader(route);
  paintNav(route);
  pageView(routeTemplate(route));
  // Agents reading the page find its Markdown twin (the server also sends it as a Link header).
  $("md-alternate").setAttribute("href", markdownTwin(location.pathname) ?? "/index.md");

  if (route.name === "world") {
    document.title = "World · Terrakin";
    setMode("world");
    page.replaceChildren();
    loadWorld().then(
      (w) => {
        // Still here? Someone may have tapped away while it loaded.
        if (root.classList.contains("mode-world"))
          w.startWorld({ navigate: (p) => router.navigate(p) });
      },
      () => {
        // showWorldReload already put up the notice.
      },
    );
    return;
  }

  void world?.then(
    (w) => w.stopWorld(),
    () => {},
  );
  refreshBell();
  refreshPurse();
  setMode("site");
  const ctx: ViewContext = {
    restoring: nav.restoring,
    key: nav.key,
    setTitle: (t) => {
      document.title = t;
    },
    canGoBack: () => router.canGoBack(),
    navigate: (path, options) => router.navigate(path, options),
  };
  const next =
    route.name === "feed"
      ? feedView(ctx)
      : route.name === "profile"
        ? profileView({ id: route.id }, ctx)
        : route.name === "handle"
          ? profileView({ handle: route.handle }, ctx)
          : route.name === "notifications"
            ? notificationsView(ctx)
            : route.name === "purse"
              ? purseView(ctx)
              : route.name === "inventory"
                ? inventoryView(ctx)
                : route.name === "post"
                  ? postView(route.id, ctx)
                  : route.name === "letters"
                    ? lettersView(ctx)
                    : route.name === "letters-with"
                      ? letterThreadView(route.id, ctx)
                      : route.name === "invite"
                        ? inviteView(route.code, ctx)
                        : route.name === "town"
                          ? townView(ctx)
                          : route.name === "shop"
                            ? shopView(ctx)
                            : route.name === "market"
                              ? marketView(ctx)
                              : route.name === "bounties"
                                ? bountiesView(ctx)
                                : route.name === "people"
                                  ? peopleView(route.id, route.tab, ctx)
                                  : route.name === "plot3d" || route.name === "gallery3d"
                                    ? view3d(route, ctx)
                                    : route.name === "claim"
                                      ? claimView(route.code, ctx)
                                      : notFoundView(ctx);
  view = next;
  page.replaceChildren(next.el);

  if (nav.restoring && nav.scroll !== undefined) {
    const y = nav.scroll;
    void next.ready.then(() => {
      if (view === next) requestAnimationFrame(() => window.scrollTo(0, y));
    });
  } else {
    window.scrollTo(0, 0);
    // Screen readers start reading the new page, not the link that was tapped.
    if (!firstRun) page.focus({ preventScroll: true });
  }
  firstRun = false;
}

let firstRun = true;

const router = createRouter({ onNavigate, interceptPop, leaveOverlay });
router.start();
