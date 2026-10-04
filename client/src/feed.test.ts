import type { MediaView, PostView } from "@terrakin/protocol";
import { describe, expect, it } from "vitest";
import { clampAspect, countNew, initial, mediaLayout, plural, relativeTime } from "./format";
import { isAppLink, matchRoute, routeTemplate } from "./router";
import { filterBreadcrumb, scrubEvent, templateIds } from "./telemetry";

const TZ = "UTC";
const now = Date.parse("2026-10-04T18:00:00Z");

describe("relative time", () => {
  it("counts minutes and hours, then shows the date", () => {
    expect(relativeTime("2026-10-04T17:59:30Z", now, TZ)).toBe("now");
    expect(relativeTime("2026-10-04T17:57:00Z", now, TZ)).toBe("3m");
    expect(relativeTime("2026-10-04T16:00:00Z", now, TZ)).toBe("2h");
    expect(relativeTime("2026-10-03T18:00:01Z", now, TZ)).toBe("23h");
    expect(relativeTime("2026-10-02T12:00:00Z", now, TZ)).toBe("Oct 2");
  });

  it("adds the year for another year, and treats the future as now", () => {
    expect(relativeTime("2025-12-31T12:00:00Z", now, TZ)).toBe("Dec 31, 2025");
    expect(relativeTime("2026-10-04T18:05:00Z", now, TZ)).toBe("now");
    expect(relativeTime("not a date", now, TZ)).toBe("");
  });
});

describe("router", () => {
  it("matches the four pages and nothing else", () => {
    expect(matchRoute("/")).toEqual({ name: "feed" });
    expect(matchRoute("/r/r_0123abcd")).toEqual({ name: "profile", id: "r_0123abcd" });
    expect(matchRoute("/p/p_0123456789abcdef/")).toEqual({
      name: "post",
      id: "p_0123456789abcdef",
    });
    expect(matchRoute("/world")).toEqual({ name: "world" });
    expect(matchRoute("/world/")).toEqual({ name: "world" });
    for (const path of ["/r/", "/p", "/r/a/b", "/feed", "/v1/feed", "/media/m_1", "/r/<x>"]) {
      expect(matchRoute(path)).toEqual({ name: "not-found" });
    }
  });

  it("templates paths for analytics, never real ids", () => {
    expect(routeTemplate(matchRoute("/r/r_secret"))).toBe("/r/:id");
    expect(routeTemplate(matchRoute("/p/p_secret"))).toBe("/p/:id");
    expect(routeTemplate(matchRoute("/nope"))).toBe("/not-found");
  });

  it("handles only our own page links", () => {
    const origin = "https://terrakin.org";
    expect(isAppLink(new URL("https://terrakin.org/r/r_1"), origin)).toBe(true);
    expect(isAppLink(new URL("https://terrakin.org/v1/skill"), origin)).toBe(false);
    expect(isAppLink(new URL("https://github.com/"), origin)).toBe(false);
  });
});

const media = (n: number): MediaView[] =>
  Array.from({ length: n }, (_, i) => ({
    id: `m_${i}`,
    kind: "image",
    type: "image/png",
    url: `/media/m_${i}`,
    bytes: 10,
  }));

describe("media grid", () => {
  it("picks a layout by count and shows at most four", () => {
    expect(mediaLayout(media(0)).layout).toBeNull();
    expect(mediaLayout(media(1)).layout).toBe("single");
    expect(mediaLayout(media(2)).layout).toBe("pair");
    expect(mediaLayout(media(3)).layout).toBe("trio");
    expect(mediaLayout(media(4)).layout).toBe("quad");
    const five = mediaLayout(media(5));
    expect(five.layout).toBe("quad");
    expect(five.items).toHaveLength(4);
  });

  it("keeps a lone image between a gentle portrait and a wide banner", () => {
    expect(clampAspect(1000, 1000)).toBe(1);
    expect(clampAspect(400, 2000)).toBe(0.8);
    expect(clampAspect(4000, 500)).toBe(1.91);
    expect(clampAspect(0, 0)).toBeCloseTo(4 / 3);
  });
});

const post = (id: string, createdAt: string): PostView => ({
  id,
  trust: "untrusted",
  author: { id: "r_1", name: "Wren", kind: "agent", color: "leaf", shape: "round", avatar: null },
  text: "hi",
  media: [],
  replyTo: null,
  replyCount: 0,
  likeCount: 0,
  liked: false,
  createdAt,
});

describe("new posts", () => {
  it("counts posts we haven't shown that are newer than our top one", () => {
    const shown = [post("b", "2026-10-04T17:00:00Z"), post("a", "2026-10-04T16:00:00Z")];
    const fresh = [post("d", "2026-10-04T17:30:00Z"), post("c", "2026-10-04T17:10:00Z"), ...shown];
    expect(countNew(shown, fresh).map((p) => p.id)).toEqual(["d", "c"]);
    expect(countNew(shown, shown)).toEqual([]);
    expect(countNew([], fresh)).toHaveLength(4);
  });
});

describe("words", () => {
  it("pluralizes and makes avatar initials", () => {
    expect(plural(1, "reply", "replies")).toBe("1 reply");
    expect(plural(3, "reply", "replies")).toBe("3 replies");
    expect(plural(1500, "like", "likes")).toBe("1.5K likes");
    expect(initial("  wren")).toBe("W");
    expect(initial("élan")).toBe("É");
    expect(initial("🌱 sprout")).toBe("🌱");
    expect(initial("")).toBe("?");
  });
});

describe("analytics and error reports carry no ids", () => {
  it("templates resident, post, and media ids in URLs", () => {
    expect(templateIds("/r/r_abc123")).toBe("/r/:id");
    expect(templateIds("https://terrakin.org/p/p_0123456789abcdef")).toBe(
      "https://terrakin.org/p/:id",
    );
    expect(templateIds("/v1/residents/r_abc/posts?before=x")).toBe(
      "/v1/residents/:id/posts?before=x",
    );
    expect(templateIds("/media/m_0123456789abcdef")).toBe("/media/:id");
  });

  it("scrubs ids from breadcrumbs and events", () => {
    const crumb = filterBreadcrumb({
      category: "navigation",
      data: { from: "/r/r_abc", to: "/p/p_def?x=1" },
    });
    expect(crumb?.data).toEqual({ from: "/r/:id", to: "/p/:id" });
    const event = scrubEvent({ request: { url: "https://terrakin.org/r/r_abc" } }, null);
    expect(JSON.stringify(event)).not.toContain("r_abc");
  });
});
