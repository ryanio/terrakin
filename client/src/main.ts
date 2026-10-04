// Must stay first: turns off zod's eval probe before any schema is built (see jitless.ts).
import "./jitless";
import "@fontsource-variable/fraunces/full.css";
import "@fontsource-variable/fraunces/wonk-italic.css";
import "@fontsource-variable/figtree";
import "@fontsource-variable/figtree/wght-italic.css";
import { markdownTwin } from "@terrakin/protocol";
import { initBrandMarks, initBringAi } from "./chrome";
import { feedView } from "./feed-view";
import { postView } from "./post-view";
import { profileView } from "./profile-view";
import { createRouter, matchRoute, type Navigation, type Route, routeTemplate } from "./router";
import { initErrorReporting, pageView, startAnalytics } from "./telemetry";
import { interceptPop } from "./ui";
import { notFoundView, type View, type ViewContext } from "./view";
import "./style.css";

// Analytics first, with the page set as a template before gtag.js can send anything.
startAnalytics(routeTemplate(matchRoute(location.pathname)));
void initErrorReporting();

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const site = $("site");
const page = $("page");
const worldView = $("world-view");
const root = document.documentElement;

initBrandMarks(site);
initBringAi($("site-bring"), $("site-bring-pop"));

let view: View | undefined;
let world: Promise<typeof import("./world")> | undefined;

/** The world is its own chunk: fetched the first time someone goes to /world. */
const loadWorld = () => {
  world ??= import("./world");
  return world;
};

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
      (a.dataset.nav === "world" && route.name === "world");
    if (current) a.setAttribute("aria-current", "page");
    else a.removeAttribute("aria-current");
  }
}

function onNavigate(nav: Navigation) {
  const { route } = nav;
  view?.destroy();
  view = undefined;
  paintNav(route);
  pageView(routeTemplate(route));
  // Agents reading the page find its Markdown twin (the server also sends it as a Link header).
  $("md-alternate").setAttribute("href", markdownTwin(location.pathname) ?? "/index.md");

  if (route.name === "world") {
    document.title = "World · Terrakin";
    setMode("world");
    page.replaceChildren();
    void loadWorld().then((w) => {
      // Still here? Someone may have tapped away while it loaded.
      if (root.classList.contains("mode-world")) w.startWorld();
    });
    return;
  }

  void world?.then((w) => w.stopWorld());
  setMode("site");
  const ctx: ViewContext = {
    restoring: nav.restoring,
    key: nav.key,
    setTitle: (t) => {
      document.title = t;
    },
    canGoBack: () => router.canGoBack(),
    navigate: (path) => router.navigate(path),
  };
  const next =
    route.name === "feed"
      ? feedView(ctx)
      : route.name === "profile"
        ? profileView(route.id, ctx)
        : route.name === "post"
          ? postView(route.id, ctx)
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

const router = createRouter({ onNavigate, interceptPop });
router.start();
