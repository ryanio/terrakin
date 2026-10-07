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
import { api, MY_PROFILE_EVENT, myProfile, SUSPENDED_EVENT, UNREAD_EVENT } from "./api";
import { initBell, makeBell, refreshBell } from "./bell";
import { initBrandMarks } from "./chrome";
import { feedView } from "./feed-view";
import { lazyView } from "./lazy-view";
import { SESSION_EVENT, savedResidentId, savedToken } from "./net";
import { initPurse, makePurse, refreshPurse } from "./purse";
import { createRouter, matchRoute, type Navigation, type Route, routeTemplate } from "./router";
import { initErrorReporting, pageView, startAnalytics } from "./telemetry";
import { notFoundView, type View, type ViewContext } from "./view";
import { readWorldLink, type WorldLink } from "./world-link";
import { createWorldLoader } from "./world-loader";
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
const worldLoader = createWorldLoader($("world-loader"));
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
      worldLoader.hide();
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
    const link = takeWorldLink();
    // Coming back with a saved character skips the landing, and so does a link to a place: the
    // loader shows on the tap, while the world's code is still on its way.
    if (savedToken() || link?.at) worldLoader.show();
    loadWorld().then(
      (w) => {
        // Still here? Someone may have tapped away while it loaded.
        if (root.classList.contains("mode-world"))
          w.startWorld({
            navigate: (p) => router.navigate(p),
            loader: worldLoader,
            ...(link ? { link } : {}),
          });
      },
      () => {
        // showWorldReload already put up the notice.
      },
    );
    return;
  }

  worldLoader.hide();
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
  const next = pageFor(route, ctx);
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

/**
 * A link into the world (`/world?at=...&view=3d`, decision 0162), read once and taken out of the
 * address bar, so a reload opens the world as usual and the place's id goes no further.
 */
function takeWorldLink(): WorldLink | undefined {
  const link = readWorldLink(location.search);
  if (location.search) history.replaceState(history.state, "", location.pathname + location.hash);
  return link;
}

/**
 * The page for a route. The feed is the home page, so its code comes with the first load; every
 * other page loads its own when it's opened (decision 0110).
 */
function pageFor(route: Route, ctx: ViewContext): View {
  switch (route.name) {
    case "feed":
      return feedView(ctx);
    case "profile":
      return lazyView(import("./profile-view"), (m) => m.profileView({ id: route.id }, ctx));
    case "handle":
      return lazyView(import("./profile-view"), (m) =>
        m.profileView({ handle: route.handle }, ctx),
      );
    case "notifications":
      return lazyView(import("./notifications-view"), (m) => m.notificationsView(ctx));
    case "purse":
      return lazyView(import("./purse-view"), (m) => m.purseView(ctx));
    case "inventory":
      return lazyView(import("./inventory-view"), (m) => m.inventoryView(ctx));
    case "post":
      return lazyView(import("./post-view"), (m) => m.postView(route.id, ctx));
    case "letters":
      return lazyView(import("./letters-view"), (m) => m.lettersView(ctx));
    case "letters-with":
      return lazyView(import("./letters-view"), (m) => m.letterThreadView(route.id, ctx));
    case "invite":
      return lazyView(import("./invite-view"), (m) => m.inviteView(route.code, ctx));
    case "town":
      return lazyView(import("./town-view"), (m) => m.townView(ctx));
    case "shop":
      return lazyView(import("./shop-view"), (m) => m.shopView(ctx));
    case "market":
      return lazyView(import("./market-view"), (m) => m.marketView(ctx));
    case "bounties":
      return lazyView(import("./bounties-view"), (m) => m.bountiesView(ctx));
    case "galleries":
      return lazyView(import("./galleries-view"), (m) => m.galleriesView(ctx));
    case "visit":
      return lazyView(import("./visit-view"), (m) => m.visitView(ctx));
    case "games":
      return lazyView(import("./games-view"), (m) => m.gamesView(ctx));
    case "game":
      return lazyView(import("./games-view"), (m) => m.tableView(route.id, ctx));
    case "people":
      return lazyView(import("./people-view"), (m) => m.peopleView(route.id, route.tab, ctx));
    case "collection":
      return lazyView(import("./collection-view"), (m) => m.collectionView(route.id, ctx));
    case "plot3d":
    case "gallery3d":
      return lazyView(import("./view-3d"), (m) => m.view3d(route, ctx));
    case "claim":
      return lazyView(import("./claim-view"), (m) => m.claimView(route.code, ctx));
    default:
      return notFoundView(ctx);
  }
}

let firstRun = true;

const router = createRouter({ onNavigate, interceptPop, leaveOverlay });
router.start();
