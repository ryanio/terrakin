/**
 * A tiny History API router. `/` the feed, `/r/:id` a profile (also at `/u/handle`), `/r/:id/3d`
 * their plot in 3D, `/p/:id` a post, `/notifications`, `/purse` your coins, `/inventory` your things, `/letters` and `/letters/:id` your letters,
 * `/i/:code` an invite, `/town` the Town Hall, `/shop` the town shop, `/claim/:code` where a person confirms an AI's
 * invite, `/world` the canvas world, and `/gallery/3d`
 * the 3D gallery (not linked from anywhere public yet). Anything else is a friendly not-found
 * page. The server sends index.html for every deep link, so a reload lands on the same page.
 */

export type Route =
  | { name: "feed" }
  | { name: "profile"; id: string }
  | { name: "plot3d"; id: string }
  | { name: "people"; id: string; tab: "followers" | "following" | "friends" }
  | { name: "gallery3d" }
  | { name: "post"; id: string }
  | { name: "claim"; code: string }
  | { name: "handle"; handle: string }
  | { name: "notifications" }
  | { name: "purse" }
  | { name: "inventory" }
  | { name: "world" }
  | { name: "letters" }
  | { name: "letters-with"; id: string }
  | { name: "invite"; code: string }
  | { name: "town" }
  | { name: "shop" }
  | { name: "not-found" };

const ID = "([A-Za-z0-9_-]{1,64})";
const PATTERNS: [RegExp, (m: RegExpExecArray) => Route][] = [
  [/^\/$/, () => ({ name: "feed" })],
  [new RegExp(`^/r/${ID}$`), (m) => ({ name: "profile", id: m[1] ?? "" })],
  [new RegExp(`^/r/${ID}/3d$`), (m) => ({ name: "plot3d", id: m[1] ?? "" })],
  [
    new RegExp(`^/r/${ID}/(followers|following|friends)$`),
    (m) => ({
      name: "people",
      id: m[1] ?? "",
      tab: (m[2] ?? "followers") as "followers" | "following" | "friends",
    }),
  ],
  [/^\/gallery\/3d$/, () => ({ name: "gallery3d" })],
  [/^\/u\/([A-Za-z][A-Za-z0-9_]{2,19})$/, (m) => ({ name: "handle", handle: m[1] ?? "" })],
  [new RegExp(`^/p/${ID}$`), (m) => ({ name: "post", id: m[1] ?? "" })],
  [new RegExp(`^/claim/${ID}$`), (m) => ({ name: "claim", code: m[1] ?? "" })],
  [/^\/notifications$/, () => ({ name: "notifications" })],
  [/^\/purse$/, () => ({ name: "purse" })],
  [/^\/inventory$/, () => ({ name: "inventory" })],
  [/^\/world$/, () => ({ name: "world" })],
  [/^\/letters$/, () => ({ name: "letters" })],
  [new RegExp(`^/letters/${ID}$`), (m) => ({ name: "letters-with", id: m[1] ?? "" })],
  [new RegExp(`^/i/${ID}$`), (m) => ({ name: "invite", code: m[1] ?? "" })],
  [/^\/town$/, () => ({ name: "town" })],
  [/^\/shop$/, () => ({ name: "shop" })],
];

/** Which page a path is. Trailing slashes are ignored. Pure, so tests pin it. */
export function matchRoute(pathname: string): Route {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, "") || "/" : pathname;
  for (const [pattern, make] of PATTERNS) {
    const m = pattern.exec(path);
    if (m) return make(m);
  }
  return { name: "not-found" };
}

/**
 * The path with ids swapped for placeholders, for analytics. Never carries a resident or post id,
 * or a claim code.
 */
export function routeTemplate(route: Route): string {
  switch (route.name) {
    case "feed":
      return "/";
    case "profile":
      return "/r/:id";
    case "plot3d":
      return "/r/:id/3d";
    case "people":
      return `/r/:id/${route.tab}`;
    case "gallery3d":
      return "/gallery/3d";
    case "handle":
      return "/u/:handle";
    case "post":
      return "/p/:id";
    case "town":
      return "/town";
    case "shop":
      return "/shop";
    case "claim":
      return "/claim/:code";
    case "notifications":
      return "/notifications";
    case "purse":
      return "/purse";
    case "inventory":
      return "/inventory";
    case "world":
      return "/world";
    case "letters":
      return "/letters";
    case "letters-with":
      return "/letters/:id";
    case "invite":
      return "/i/:code";
    case "not-found":
      return "/not-found";
  }
}

/** True for a same-origin link the router should handle itself instead of a full page load. */
export function isAppLink(url: URL, origin: string): boolean {
  return url.origin === origin && matchRoute(url.pathname).name !== "not-found";
}

interface HistoryState {
  key: string;
  /** How many entries of this site sit before this one. */
  idx: number;
  scroll?: number;
}

export interface Navigation {
  route: Route;
  /** True when we got here with back or forward, so the page may restore its scroll and data. */
  restoring: boolean;
  /** Saved scroll position for this history entry, if we have one. */
  scroll: number | undefined;
  /** Unique per history entry; stable across back and forward. */
  key: string;
}

export interface RouterOptions {
  onNavigate(nav: Navigation): void;
  /** Called first on every popstate. Return true to swallow it (for example to close a viewer). */
  interceptPop?(): boolean;
  /**
   * Called before every navigation, to close an open overlay. Returns true when the current
   * history entry is the overlay's own: the new page then replaces it instead of going after it.
   */
  leaveOverlay?(): boolean;
}

export interface Router {
  navigate(path: string, options?: { replace?: boolean }): void;
  /** Run the current location once, at startup. */
  start(): void;
  /** True when there is an earlier page of this site to go back to. */
  canGoBack(): boolean;
}

const newKey = () => Math.random().toString(36).slice(2, 10);

export function createRouter({ onNavigate, interceptPop, leaveOverlay }: RouterOptions): Router {
  if ("scrollRestoration" in history) history.scrollRestoration = "manual";

  const state = (): HistoryState | undefined => {
    const s = history.state as Partial<HistoryState> | null;
    return s && typeof s.key === "string" && typeof s.idx === "number"
      ? (s as HistoryState)
      : undefined;
  };

  /**
   * Where each history entry was last scrolled, by key. Back and forward change the entry before
   * we hear about it, so we can't read the old page's scroll then: a scroll listener keeps this
   * current instead.
   */
  const positions = new Map<string, number>();
  let currentKey: string | undefined;
  window.addEventListener(
    "scroll",
    () => {
      if (currentKey !== undefined) positions.set(currentKey, window.scrollY);
    },
    { passive: true },
  );

  /** Remember where this page was scrolled in the history entry itself, so reloads keep it too. */
  const saveScroll = () => {
    const s = state();
    if (s) history.replaceState({ ...s, scroll: window.scrollY }, "");
  };

  const run = (restoring: boolean) => {
    let s = state();
    if (!s) {
      s = { key: newKey(), idx: 0 };
      history.replaceState(s, "");
    }
    currentKey = s.key;
    onNavigate({
      route: matchRoute(location.pathname),
      restoring,
      scroll: positions.get(s.key) ?? s.scroll,
      key: s.key,
    });
  };

  const router: Router = {
    navigate(path, { replace = false } = {}) {
      const target = new URL(path, location.href);
      // An overlay's entry sits one after its page's and carries the page's idx.
      const overlay = leaveOverlay?.() ?? false;
      saveScroll();
      const idx = (state()?.idx ?? 0) + (overlay ? 1 : 0);
      if (replace || overlay) history.replaceState({ key: newKey(), idx }, "", target);
      else history.pushState({ key: newKey(), idx: idx + 1 }, "", target);
      run(false);
    },
    start: () => run(state()?.scroll !== undefined),
    canGoBack: () => (state()?.idx ?? 0) > 0,
  };

  window.addEventListener("popstate", () => {
    if (interceptPop?.()) return;
    run(true);
  });

  // Reloads keep their place too.
  window.addEventListener("pagehide", saveScroll);

  document.addEventListener("click", (e) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey)
      return;
    const a = e.target instanceof Element ? e.target.closest("a[href]") : null;
    if (!(a instanceof HTMLAnchorElement) || a.target || a.hasAttribute("download")) return;
    const url = new URL(a.href);
    if (!isAppLink(url, location.origin)) return;
    e.preventDefault();
    // Keep the hash: "/#join" lands on the get-started cards.
    router.navigate(url.pathname + url.search + url.hash);
  });

  return router;
}
