import {
  closeOverlay,
  interceptPop,
  leaveOverlay,
  openOverlay,
  overlayShowing,
} from "@terrakin/ui/ui";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createRouter, isAppLink, matchRoute, type Route, routeTemplate } from "./router";

/** Just enough of a browser for the router: a history with entries, and the current location. */
function fakeBrowser(entries: { path: string; state: unknown }[]) {
  let at = entries.length - 1;
  const here = () => entries[at] ?? { path: "/", state: null };
  const pathOf = (url: string | URL | null | undefined) =>
    url ? new URL(String(url), "https://terrakin.test").pathname : here().path;
  vi.stubGlobal("history", {
    get state() {
      return here().state;
    },
    pushState(state: unknown, _title: string, url?: string | URL | null) {
      entries.splice(at + 1);
      entries.push({ path: pathOf(url), state });
      at += 1;
    },
    replaceState(state: unknown, _title: string, url?: string | URL | null) {
      entries[at] = { path: pathOf(url), state };
    },
  });
  vi.stubGlobal("location", {
    get href() {
      return `https://terrakin.test${here().path}`;
    },
    get pathname() {
      return here().path;
    },
  });
  // The overlay code asks whether focus can go back to an element; none here can.
  vi.stubGlobal("HTMLElement", class {});
  // `back()` only asks: the browser steps back and fires popstate later, which `pop` does.
  let backs = 0;
  (history as { back?: () => void }).back = () => {
    backs += 1;
  };
  const popListeners: (() => void)[] = [];
  vi.stubGlobal("window", {
    addEventListener: (type: string, f: () => void) => {
      if (type === "popstate") popListeners.push(f);
    },
    scrollY: 0,
    matchMedia: () => ({ matches: true }),
  });
  vi.stubGlobal("document", {
    addEventListener: () => {},
    activeElement: null,
    body: { append: () => {} },
    documentElement: { classList: { add: () => {}, remove: () => {} } },
  });
  /** The browser steps back one entry, for the back gesture or a `back()` asked for. */
  const pop = () => {
    if (backs > 0) backs -= 1;
    at -= 1;
    for (const f of popListeners) f();
  };
  return { entries, at: () => at, pop, backsOwed: () => backs };
}

describe("leaving a page from an overlay", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const start = () => {
    const routes: Route["name"][] = [];
    const router = createRouter({
      onNavigate: (nav) => routes.push(nav.route.name),
      leaveOverlay,
    });
    return { router, routes };
  };

  it("replaces the overlay's history entry, so back returns to the page under it", () => {
    // The world, with a tile sheet open: its entry repeats the page's key and idx.
    const browser = fakeBrowser([
      { path: "/world", state: { key: "w", idx: 0 } },
      { path: "/world", state: { key: "w", idx: 0, overlay: true } },
    ]);
    const { router, routes } = start();
    router.navigate("/inventory");
    expect(browser.entries.map((e) => e.path)).toEqual(["/world", "/inventory"]);
    expect(browser.at()).toBe(1);
    expect(browser.entries[1]?.state).toMatchObject({ idx: 1 });
    expect(browser.entries[1]?.state).not.toHaveProperty("overlay");
    expect(routes).toEqual(["inventory"]);
    expect(router.canGoBack()).toBe(true);
  });

  it("pushes as usual when no overlay is open", () => {
    const browser = fakeBrowser([{ path: "/world", state: { key: "w", idx: 0 } }]);
    const { router, routes } = start();
    router.navigate("/inventory");
    expect(browser.entries.map((e) => e.path)).toEqual(["/world", "/inventory"]);
    expect(browser.entries[1]?.state).toMatchObject({ idx: 1 });
    expect(routes).toEqual(["inventory"]);
  });
});

describe("an overlay's history entry", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /** A dialog with only what opening and closing one touches. */
  const dialog = () => {
    const d = {
      open: false,
      classList: { add: () => {}, remove: () => {} },
      showModal: () => {
        d.open = true;
      },
      close: () => {
        d.open = false;
      },
      remove: () => {},
      addEventListener: () => {},
      getAnimations: () => [],
    };
    return d as unknown as HTMLDialogElement;
  };

  const start = () => {
    const browser = fakeBrowser([{ path: "/world", state: { key: "w", idx: 0 } }]);
    const routes: Route["name"][] = [];
    createRouter({ onNavigate: (nav) => routes.push(nav.route.name), interceptPop, leaveOverlay });
    return { browser, routes };
  };

  it("closes on back and leaves the page where it is", () => {
    const { browser, routes } = start();
    const sheet = dialog();
    const closed = vi.fn();
    openOverlay(sheet, closed);
    expect(browser.entries).toEqual([
      { path: "/world", state: { key: "w", idx: 0 } },
      { path: "/world", state: { key: "w", idx: 0, overlay: true } },
    ]);
    browser.pop();
    expect(closed).toHaveBeenCalledOnce();
    expect(sheet.open).toBe(false);
    expect(overlayShowing(sheet)).toBe(false);
    expect(browser.at()).toBe(0);
    // The popstate was the overlay's: the router drew no page for it.
    expect(routes).toEqual([]);
  });

  it("closed by hand, steps back off its entry and swallows that popstate", () => {
    const { browser, routes } = start();
    const sheet = dialog();
    openOverlay(sheet);
    closeOverlay(sheet);
    expect(browser.backsOwed()).toBe(1);
    browser.pop();
    expect(browser.at()).toBe(0);
    expect(routes).toEqual([]);
  });

  it("replaced by another, shares one entry, and back closes the one on top", () => {
    const { browser, routes } = start();
    const first = dialog();
    const second = dialog();
    const firstClosed = vi.fn();
    const secondClosed = vi.fn();
    openOverlay(first, firstClosed);
    openOverlay(second, secondClosed);
    expect(firstClosed).toHaveBeenCalledOnce();
    expect(browser.entries).toHaveLength(2);
    expect(browser.backsOwed()).toBe(0);
    browser.pop();
    expect(secondClosed).toHaveBeenCalledOnce();
    expect(browser.at()).toBe(0);
    expect(routes).toEqual([]);
  });

  it("opened while a step back is on its way, takes an entry once it lands", () => {
    const { browser, routes } = start();
    const first = dialog();
    const second = dialog();
    openOverlay(first);
    closeOverlay(first);
    openOverlay(second);
    // Nothing pushed in the same tick as the step back.
    expect(browser.entries).toHaveLength(2);
    browser.pop();
    expect(browser.entries).toEqual([
      { path: "/world", state: { key: "w", idx: 0 } },
      { path: "/world", state: { key: "w", idx: 0, overlay: true } },
    ]);
    expect(browser.at()).toBe(1);
    expect(overlayShowing(second)).toBe(true);
    // And back closes it, still on the same page.
    browser.pop();
    expect(overlayShowing(second)).toBe(false);
    expect(browser.at()).toBe(0);
    expect(routes).toEqual([]);
  });
});

describe("matching pages", () => {
  it("matches each page, its parameters, and nothing else", () => {
    expect(matchRoute("/town")).toEqual({ name: "town" });
    expect(routeTemplate(matchRoute("/town/"))).toBe("/town");
    expect(matchRoute("/away")).toEqual({ name: "away" });
    expect(matchRoute("/")).toEqual({ name: "feed" });
    expect(matchRoute("/r/r_0123abcd")).toEqual({ name: "profile", id: "r_0123abcd" });
    expect(matchRoute("/c/c_1")).toEqual({ name: "circle", id: "c_1" });
    expect(matchRoute("/c/k_1")).toEqual({ name: "not-found" });
    expect(matchRoute("/p/p_0123456789abcdef/")).toEqual({
      name: "post",
      id: "p_0123456789abcdef",
    });
    expect(matchRoute("/claim/abcd-efgh-jkmn-pqrs")).toEqual({
      name: "claim",
      code: "abcd-efgh-jkmn-pqrs",
    });
    expect(matchRoute("/world")).toEqual({ name: "world" });
    expect(matchRoute("/world/")).toEqual({ name: "world" });
    expect(matchRoute("/u/Wren_2")).toEqual({ name: "handle", handle: "Wren_2" });
    expect(matchRoute("/notifications/")).toEqual({ name: "notifications" });
    for (const path of [
      "/r/",
      "/p",
      "/r/a/b",
      "/feed",
      "/v1/feed",
      "/media/m_1",
      "/r/<x>",
      "/claim",
      "/claim/a/b",
      "/u/",
      "/u/ab",
      "/u/1wren",
      "/u/wren/x",
      `/u/${"a".repeat(21)}`,
      "/@Wren_2",
    ]) {
      expect(matchRoute(path)).toEqual({ name: "not-found" });
    }
  });

  it("templates paths for analytics, never real ids", () => {
    expect(routeTemplate(matchRoute("/r/r_secret"))).toBe("/r/:id");
    expect(routeTemplate(matchRoute("/p/p_secret"))).toBe("/p/:id");
    expect(routeTemplate(matchRoute("/claim/abcd-efgh-jkmn-pqrs"))).toBe("/claim/:code");
    expect(routeTemplate(matchRoute("/nope"))).toBe("/not-found");
    expect(matchRoute("/r/r_secret/3d")).toEqual({ name: "plot3d", id: "r_secret" });
    expect(routeTemplate(matchRoute("/r/r_secret/3d"))).toBe("/r/:id/3d");
    expect(matchRoute("/r/r_secret/collection")).toEqual({ name: "collection", id: "r_secret" });
    expect(routeTemplate(matchRoute("/r/r_secret/collection"))).toBe("/r/:id/collection");
    expect(matchRoute("/gallery/3d")).toEqual({ name: "gallery3d" });
    expect(routeTemplate(matchRoute("/gallery/3d"))).toBe("/gallery/3d");
    expect(matchRoute("/gallery")).toEqual({ name: "not-found" });
    expect(routeTemplate(matchRoute("/u/secret_handle"))).toBe("/u/:handle");
  });

  it("handles only our own page links", () => {
    const origin = "https://terrakin.org";
    expect(isAppLink(new URL("https://terrakin.org/r/r_1"), origin)).toBe(true);
    expect(isAppLink(new URL("https://terrakin.org/v1/skill"), origin)).toBe(false);
    // The docs are their own page (docs.html), so a link there is a full page load.
    expect(isAppLink(new URL("https://terrakin.org/docs#tag/social"), origin)).toBe(false);
    expect(isAppLink(new URL("https://github.com/"), origin)).toBe(false);
  });
});
