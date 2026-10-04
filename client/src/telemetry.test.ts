import { afterEach, describe, expect, it, vi } from "vitest";
import { populationLine } from "./landing";
import { filterBreadcrumb, pageView, scrubEvent, startAnalytics } from "./telemetry";

describe("error reports carry nothing private", () => {
  it("removes the saved token wherever it appears, and token-like keys", () => {
    const token = "tk_abc123secretvalue";
    const event = {
      message: `socket closed for ${token}`,
      extra: { hello: { type: "hello", token }, authorization: "Bearer xyz" },
      breadcrumbs: [{ message: `{"token":"${token}"}` }],
    };
    const out = scrubEvent(event, token);
    expect(JSON.stringify(out)).not.toContain(token);
    expect(out.extra.hello.token).toBe("[redacted]");
    expect(out.extra.authorization).toBe("[redacted]");
    expect(out.message).toBe("socket closed for [redacted]");
  });

  it("redacts token values in text even when no token is saved", () => {
    const out = scrubEvent({ message: 'bad hello {"token":"zzz999yyy"}' }, null);
    expect(out.message).not.toContain("zzz999yyy");
  });

  it("drops console and input breadcrumbs, which can hold chat text", () => {
    expect(filterBreadcrumb({ category: "console", message: "chat: hi" })).toBeNull();
    expect(filterBreadcrumb({ category: "ui.input", message: "input#chat-input" })).toBeNull();
    expect(filterBreadcrumb({ message: "no category" })).toBeNull();
  });

  it("keeps navigation and request breadcrumbs, without query strings", () => {
    const crumb = filterBreadcrumb({
      category: "fetch",
      data: { url: "/v1/world?x=1", method: "GET" },
    });
    expect(crumb?.data).toEqual({ url: "/v1/world", method: "GET" });
  });

  it("reduces a click to tag, id, and classes, never its labels", () => {
    // What Sentry builds on its own for a click on an image in Juniper's post.
    const crumb = {
      category: "ui.click",
      message: 'button.media-open[aria-label="Open image by Juniper"]',
      data: { "ui.component_name": "Juniper" },
    };
    const target = {
      tagName: "BUTTON",
      id: "",
      className: "media-open  big",
      getAttribute: () => "Open image by Juniper",
    };
    const out = filterBreadcrumb(crumb, { event: { target } });
    expect(out?.message).toBe("button.media-open.big");
    expect(JSON.stringify(out)).not.toContain("Juniper");

    const withId = filterBreadcrumb(
      { category: "ui.click", message: 'button#claim[title="Ada"]' },
      { event: { target: { tagName: "BUTTON", id: "claim", className: "" } } },
    );
    expect(withId?.message).toBe("button#claim");
  });

  it("drops a click it can't describe, rather than keep Sentry's message", () => {
    const crumb = { category: "ui.click", message: 'a[title="photo of Wren.png"]' };
    expect(filterBreadcrumb(crumb)).toBeNull();
    expect(filterBreadcrumb(crumb, { event: { target: null } })).toBeNull();
  });
});

describe("analytics hits carry templates, never real pages", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const fakeWindow = (pathname: string, hostname = "terrakin.org") => ({
    location: { origin: `https://${hostname}`, hostname, pathname },
    dataLayer: undefined as unknown[] | undefined,
    gtag: undefined as ((...args: unknown[]) => void) | undefined,
  });

  it("sets the template, a fixed title, and no referrer before the page view", () => {
    const calls: unknown[][] = [];
    const win = { ...fakeWindow("/r/r_secret"), gtag: (...args: unknown[]) => calls.push(args) };
    vi.stubGlobal("window", win);
    pageView("/r/:id");
    const fields = {
      page_location: "https://terrakin.org/r/:id",
      page_title: "Profile",
      page_referrer: "",
    };
    expect(calls).toEqual([
      ["set", fields],
      ["event", "page_view", fields],
    ]);
  });

  it("sets the page fields on load, before config and before any event", () => {
    const appended: { src?: string }[] = [];
    const win = fakeWindow("/p/p_secret");
    vi.stubGlobal("window", win);
    vi.stubGlobal("document", {
      createElement: () => ({}),
      head: { append: (s: { src?: string }) => appended.push(s) },
    });
    startAnalytics("/p/:id");
    const layer = (win.dataLayer ?? []).map((a) => Array.from(a as ArrayLike<unknown>));
    expect(layer.map((a) => a[0])).toEqual(["js", "set", "config"]);
    expect(layer[1]?.[1]).toEqual({
      page_location: "https://terrakin.org/p/:id",
      page_title: "Post",
      page_referrer: "",
    });
    expect(JSON.stringify(layer)).not.toContain("p_secret");
    expect(appended[0]?.src).toContain("googletagmanager.com/gtag/js");
  });

  it("never loads on local hosts", () => {
    const win = fakeWindow("/", "localhost");
    vi.stubGlobal("window", win);
    startAnalytics("/");
    expect(win.dataLayer).toBeUndefined();
    expect(win.gtag).toBeUndefined();
  });
});

describe("landing live line", () => {
  it("counts residents and who is online", () => {
    expect(populationLine(12, 3)).toBe("12 residents, 3 online now");
    expect(populationLine(1, 1)).toBe("1 resident, 1 online now");
    expect(populationLine(5, 0)).toBe("5 residents, quiet right now");
    expect(populationLine(0, 0)).toBe("Nobody here yet. Be the first");
  });
});
