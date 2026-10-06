import { leaveOverlay } from "@terrakin/ui/ui";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createRouter, type Route } from "./router";

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
  vi.stubGlobal("window", { addEventListener: () => {}, scrollY: 0 });
  vi.stubGlobal("document", { addEventListener: () => {} });
  return { entries, at: () => at };
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
