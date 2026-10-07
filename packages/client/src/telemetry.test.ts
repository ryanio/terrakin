import { afterEach, describe, expect, it, vi } from "vitest";
import { populationLine } from "./landing";
import {
  filterBreadcrumb,
  isProductionSite,
  pageView,
  scrubEvent,
  scrubSpan,
  startAnalytics,
  templateIds,
} from "./telemetry";

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

  it("keeps our api and live crumbs as a templated message with no data", () => {
    const crumb = filterBreadcrumb({
      category: "api",
      message: "POST /v1/posts/p_0123456789abcdef/like?q=secret 429 rate_limited",
      data: { text: "hi" },
    });
    expect(crumb).toEqual({
      category: "api",
      message: "POST /v1/posts/:id/like 429 rate_limited",
    });
  });

  it("templates claim codes and invite codes in paths", () => {
    expect(templateIds("/claim/abcd-efgh-jkmn-pqrs")).toBe("/claim/:id");
    expect(templateIds("/i/x7y8z9")).toBe("/i/:id");
  });

  it("templates the place a link into the world names", () => {
    expect(templateIds("/world?at=t_ivy&view=3d")).toBe("/world?at=:at&view=3d");
    expect(templateIds("/world?view=3d&at=12,4")).toBe("/world?view=3d&at=:at");
  });

  it("names spans by template and drops query strings from them", () => {
    const span = {
      name: "GET /v1/residents/r_0123456789abcdef?with=r_fedcba9876543210",
      attributes: {
        "url.full": "https://terrakin.org/r/r_0123456789abcdef?ref=x",
        "url.query": "ref=x",
        "http.request.header.authorization": "Bearer abc",
      },
    };
    const out = scrubSpan(span, null);
    expect(out.name).toBe("GET /v1/residents/:id");
    expect(out.attributes).toEqual({
      "url.full": "https://terrakin.org/r/:id",
      "http.request.header.authorization": "[redacted]",
    });
  });

  it("never lets an element's labels or a resident id into a span", () => {
    const span = {
      name: 'click div.home > img[alt="Wren Ashby\'s home"]',
      attributes: {
        "browser.web_vital.lcp.element": 'div.home > img[alt="Wren Ashby\'s home"]',
        "browser.web_vital.inp.target": 'article[aria-label="Post by Wren"]',
        "browser.web_vital.cls.source.1": 'button[title="Remove photo.png"]',
        "sentry.op": "ui.interaction.click",
        "url.full": "https://terrakin.org/v1/owner/link/r_0123456789abcdef",
      },
    };
    const out = scrubSpan(span, null);
    const json = JSON.stringify(out);
    for (const secret of ["Wren", "photo.png", "r_0123456789abcdef"]) {
      expect(json).not.toContain(secret);
    }
    expect(out.name).toBe("click div.home > img");
    expect(out.attributes).toEqual({
      "sentry.op": "ui.interaction.click",
      "url.full": "https://terrakin.org/v1/owner/link/:id",
    });
  });

  it("templates a server id wherever it appears", () => {
    expect(templateIds("DELETE /v1/owner/link/r_0123456789abcdef 500 internal")).toBe(
      "DELETE /v1/owner/link/:id 500 internal",
    );
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
    vi.unstubAllEnvs();
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
    vi.stubEnv("PROD", true);
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

  it("never loads anywhere but the production site", () => {
    vi.stubEnv("PROD", true);
    for (const host of [
      "localhost",
      "192.168.4.20",
      "100.101.102.103",
      "terrakin.test",
      "preview.terrakin.org",
    ]) {
      const win = fakeWindow("/", host);
      vi.stubGlobal("window", win);
      startAnalytics("/");
      expect(win.dataLayer, host).toBeUndefined();
      expect(win.gtag, host).toBeUndefined();
    }
  });

  it("treats only a production build on terrakin.org as production", () => {
    expect(isProductionSite("terrakin.org", true)).toBe(true);
    expect(isProductionSite("terrakin.org", false)).toBe(false);
    expect(isProductionSite("www.terrakin.org", true)).toBe(false);
    expect(isProductionSite("localhost", true)).toBe(false);
    expect(isProductionSite("192.168.1.10", true)).toBe(false);
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
