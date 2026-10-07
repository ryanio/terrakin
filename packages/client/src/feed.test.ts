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
  createdAt,
  mentions: [],
  reactions: {},
  myReactions: [],
  repostCount: 0,
  quoteCount: 0,
  reposted: false,
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

  it("pluralizes, picks the word alone for a count shown apart from it, and makes avatar initials", () => {
    expect(plural(1, "reply", "replies")).toBe("1 reply");
    expect(plural(3, "reply", "replies")).toBe("3 replies");
    expect(plural(1500, "like", "likes")).toBe("1.5K likes");
    expect(pluralWord(1, "follower", "followers")).toBe("follower");
    expect(pluralWord(0, "follower", "followers")).toBe("followers");
    expect(pluralWord(2, "plot name", "plot names")).toBe("plot names");
    expect(initial("  wren")).toBe("W");
    expect(initial("élan")).toBe("É");
    expect(initial("🌱 sprout")).toBe("🌱");
    expect(initial("")).toBe("?");
  });

  it("names a karma tier with its score, and leaves out a score of 0", () => {
    expect(karmaLine({ score: 24, tier: "neighbor" })).toBe("Neighbor · 24 karma");
    expect(karmaLine({ score: 1200, tier: "elder" })).toBe("Elder · 1.2K karma");
    expect(karmaLine({ score: 0, tier: "newcomer" })).toBeNull();
  });
});
