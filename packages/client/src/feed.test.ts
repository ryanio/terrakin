import type { MediaView, PostView } from "@terrakin/protocol";
import {
  clampAspect,
  countNew,
  firstParagraphs,
  formatCount,
  initial,
  isMediaUrl,
  isModelResource,
  karmaLine,
  mediaLayout,
  plural,
  pluralWord,
  relativeTime,
  shortDate,
} from "@terrakin/ui/format";
import { describe, expect, it } from "vitest";
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

describe("short date", () => {
  it("adds the year only when it isn't now's year", () => {
    // The devlog card's eyebrow and a collection book's first-found day.
    const oct6 = Date.parse("2026-10-06T00:00:00Z");
    expect(shortDate(oct6, now, TZ)).toBe("Oct 6");
    expect(shortDate(oct6, Date.parse("2027-01-01T00:30:00Z"), TZ)).toBe("Oct 6, 2026");
    expect(shortDate(Date.parse("2025-10-06T00:00:00Z"), now, TZ)).toBe("Oct 6, 2025");
  });

  it("never adds the year without now, as a bounty's closing day", () => {
    expect(shortDate(Date.parse("2026-11-04T12:00:00Z"), undefined, TZ)).toBe("Nov 4");
    expect(shortDate(Date.parse("2027-01-04T12:00:00Z"), undefined, TZ)).toBe("Jan 4");
  });

  it("reads the day in the time zone it's given", () => {
    const late = Date.parse("2026-12-31T23:30:00Z");
    expect(shortDate(late, now, TZ)).toBe("Dec 31");
    expect(shortDate(late, now, "Asia/Tokyo")).toBe("Jan 1, 2027");
  });
});

describe("counts in words", () => {
  it("groups thousands for ratings, coins, and staff numbers", () => {
    expect(formatCount(7)).toBe("7");
    expect(formatCount(1200)).toBe("1,200");
    expect(formatCount(1234567)).toBe("1,234,567");
  });

  it("picks the word alone for a count shown apart from it", () => {
    expect(pluralWord(1, "follower", "followers")).toBe("follower");
    expect(pluralWord(0, "follower", "followers")).toBe("followers");
    expect(pluralWord(2, "plot name", "plot names")).toBe("plot names");
    expect(plural(1, "post", "posts")).toBe("1 post");
  });
});

describe("router", () => {
  it("matches the five pages and nothing else", () => {
    expect(matchRoute("/town")).toEqual({ name: "town" });
    expect(routeTemplate(matchRoute("/town/"))).toBe("/town");
    expect(matchRoute("/")).toEqual({ name: "feed" });
    expect(matchRoute("/r/r_0123abcd")).toEqual({ name: "profile", id: "r_0123abcd" });
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

  it("matches handle profiles and notifications", () => {
    expect(matchRoute("/u/Wren_2")).toEqual({ name: "handle", handle: "Wren_2" });
    expect(matchRoute("/notifications/")).toEqual({ name: "notifications" });
    const bad = ["/u/", "/u/ab", "/u/1wren", "/u/wren/x", `/u/${"a".repeat(21)}`, "/@Wren_2"];
    for (const path of bad) {
      expect(matchRoute(path)).toEqual({ name: "not-found" });
    }
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

  it("accepts only media URLs shaped exactly like the server's", () => {
    expect(isMediaUrl("/media/m_0123456789abcdef")).toBe(true);
    for (const bad of [
      "javascript:alert(1)",
      "//evil.example/media/m_0123456789abcdef",
      "https://evil.example/media/m_0123456789abcdef",
      "/media/../x",
      "/media/m_0123456789abcdef/../../x",
      "/media/m_0123456789ABCDEF",
      "/media/m_0123456789abcdef?x=1",
      "data:image/png;base64,AAAA",
      "",
      null,
      undefined,
    ]) {
      expect(isMediaUrl(bad)).toBe(false);
    }
  });

  it("lets the model loader fetch only inline data, blobs, and our own media", () => {
    const origin = "https://terrakin.org";
    expect(isModelResource("/media/m_0123456789abcdef", origin)).toBe(true);
    expect(isModelResource("https://terrakin.org/media/m_0123456789abcdef", origin)).toBe(true);
    expect(isModelResource("data:application/octet-stream;base64,AAAA", origin)).toBe(true);
    expect(isModelResource("blob:https://terrakin.org/3f2a", origin)).toBe(true);
    for (const bad of [
      "https://evil.example/media/m_0123456789abcdef",
      "//evil.example/texture.png",
      "https://terrakin.org/media/texture.png",
      "https://terrakin.org/v1/feed",
      "https://terrakin.org/media/m_0123456789abcdef?track=1",
      "javascript:alert(1)",
    ]) {
      expect(isModelResource(bad, origin)).toBe(false);
    }
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
  it("cuts text to its first paragraphs", () => {
    expect(firstParagraphs("one line", 2)).toBe("one line");
    expect(firstParagraphs("one\n\ntwo\n", 2)).toBe("one\n\ntwo");
    expect(firstParagraphs("one\n\ntwo\n\n\nthree", 2)).toBe("one\n\ntwo…");
    expect(firstParagraphs("one\ntwo\nthree", 2)).toBe("one\ntwo…");
    expect(firstParagraphs("One.\nTwo, really.\nThree", 2)).toBe("One.\nTwo, really…");
  });

  it("pluralizes and makes avatar initials", () => {
    expect(plural(1, "reply", "replies")).toBe("1 reply");
    expect(plural(3, "reply", "replies")).toBe("3 replies");
    expect(plural(1500, "like", "likes")).toBe("1.5K likes");
    expect(initial("  wren")).toBe("W");
    expect(initial("élan")).toBe("É");
    expect(initial("🌱 sprout")).toBe("🌱");
    expect(initial("")).toBe("?");
  });

  it("names a karma tier with its score, and leaves out a score of 0", () => {
    expect(karmaLine({ score: 24, tier: "neighbor" })).toBe("Neighbor · 24 karma");
    expect(karmaLine({ score: 1200, tier: "elder" })).toBe("Elder · 1.2K karma");
    expect(karmaLine({ score: 0, tier: "newcomer" })).toBeNull();
    expect(karmaLine(undefined)).toBeNull();
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

  it("templates handles and notification ids too", () => {
    expect(templateIds("https://terrakin.org/u/wren_bot")).toBe("https://terrakin.org/u/:handle");
    expect(templateIds("/v1/residents/by-handle/wren")).toBe("/v1/residents/by-handle/:handle");
    expect(templateIds('{"upTo":"n_0123456789abcdef"}')).toBe('{"upTo":":id"}');
    expect(templateIds("/v1/residents/r_abc/following")).toBe("/v1/residents/:id/following");
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
