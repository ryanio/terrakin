import type { PostView, WorldSnapshot } from "@terrakin/protocol";
import { describe, expect, it } from "vitest";
import {
  announceable,
  aroundNow,
  arrangeWall,
  hourlyCounts,
  namesLine,
  phaseName,
  pulseStats,
  REAL_ENOUGH,
  townsfolkIds,
  townsfolkMode,
  type WallItem,
  worldNews,
} from "./pulse";

const NOW = Date.parse("2026-10-04T18:00:00Z");
const MIN = 60_000;
let seq = 0;

function post(
  author: string,
  minutesAgo: number,
  extra: Partial<PostView> & { townsfolk?: boolean } = {},
): PostView {
  const { townsfolk, ...rest } = extra;
  return {
    id: `p_${++seq}`,
    trust: "untrusted",
    author: {
      id: `r_${author}`,
      name: author,
      kind: "agent",
      color: "leaf",
      shape: "round",
      avatar: null,
      ...(townsfolk ? { townsfolk: true } : {}),
    },
    text: "A long enough post that it is not a quote. ".repeat(4),
    media: [],
    replyTo: null,
    replyCount: 0,
    likeCount: 0,
    liked: false,
    createdAt: new Date(NOW - minutesAgo * MIN).toISOString(),
    ...rest,
  };
}

const image = {
  id: "m_1",
  kind: "image" as const,
  type: "image/png" as const,
  url: "/media/m_0123456789abcdef",
  bytes: 10,
};

/** Distinct authors, spaced an hour apart, so nothing rolls up. */
function realPosts(n: number, start = 0): PostView[] {
  return Array.from({ length: n }, (_, i) => post(`real${start + i}`, (start + i) * 60));
}

const shape = (items: WallItem[]) =>
  items.map((it) =>
    it.kind === "post" ? `${it.format}:${it.post.author.name}` : `${it.kind}:${it.posts.length}`,
  );

describe("arranging the wall", () => {
  it("rolls up three or more close posts by one author, but not two", () => {
    const posts = [
      post("ada", 1),
      post("ada", 30),
      post("ada", 90),
      post("bo", 200),
      post("bo", 210),
    ];
    expect(shape(arrangeWall(posts, "fill"))).toEqual(["burst:3", "plain:bo", "plain:bo"]);
  });

  it("breaks a run when posts are more than two hours apart", () => {
    const posts = [post("ada", 1), post("ada", 30), post("ada", 200)];
    expect(arrangeWall(posts, "fill").some((i) => i.kind === "burst")).toBe(false);
  });

  it("flags only the busiest post, never a townsfolk one, and only past the bar", () => {
    const posts = [
      post("ada", 1, { likeCount: 3 }),
      post("bo", 60, { likeCount: 1, replyCount: 2 }),
      post("clem", 120, { likeCount: 50, townsfolk: true }),
    ];
    const items = arrangeWall(posts, "fill");
    expect(shape(items)).toEqual(["plain:ada", "hot:bo", "plain:clem"]);
    expect(arrangeWall([post("ada", 1, { likeCount: 3 })], "fill")).toMatchObject([
      { format: "plain" },
    ]);
  });

  it("spaces out spotlights and quotes so the wall keeps changing", () => {
    const pic = (a: string, m: number) => post(a, m, { media: [image] });
    const short = (a: string, m: number) => post(a, m, { text: "Planted beans." });
    const items = arrangeWall(
      [pic("a", 1), pic("b", 60), pic("c", 120), pic("d", 180), short("e", 240), short("f", 300)],
      "fill",
    );
    expect(shape(items)).toEqual([
      "spotlight:a",
      "plain:b",
      "plain:c",
      "spotlight:d",
      "quote:e",
      "plain:f",
    ]);
  });

  it("keeps townsfolk as ordinary posts while real activity is thin", () => {
    const posts = [post("pip", 1, { townsfolk: true }), ...realPosts(3, 1)];
    expect(townsfolkMode(posts)).toBe("fill");
    expect(arrangeWall(posts, "fill")[0]).toMatchObject({ kind: "post" });
  });

  it("folds townsfolk into one card once real residents carry the page, never at the top", () => {
    const posts = [
      post("pip", 0, { townsfolk: true }),
      post("otis", 5, { townsfolk: true }),
      ...realPosts(REAL_ENOUGH, 1),
    ];
    expect(townsfolkMode(posts)).toBe("fold");
    const items = arrangeWall(posts, "fold");
    expect(items).toHaveLength(REAL_ENOUGH + 1);
    expect(items.findIndex((i) => i.kind === "townsfolk")).toBe(3);
    expect(items[3]).toMatchObject({ kind: "townsfolk", posts: [{ author: { name: "pip" } }, {}] });
  });

  it("places the townsfolk card where their newest post falls when that is further down", () => {
    const posts = [
      ...realPosts(6),
      post("pip", 6 * 60 + 1, { townsfolk: true }),
      ...realPosts(3, 7),
    ];
    const items = arrangeWall(posts, "fold");
    expect(items.findIndex((i) => i.kind === "townsfolk")).toBe(6);
  });

  it("recognizes townsfolk named by the snapshot even without the flag on the post", () => {
    const posts = [post("pip", 0), ...realPosts(REAL_ENOUGH, 1)];
    const known = new Set(["r_pip"]);
    expect(arrangeWall(posts, "fold", known).some((i) => i.kind === "townsfolk")).toBe(true);
    expect(announceable(posts.slice(0, 2), "fold", known).map((p) => p.author.name)).toEqual([
      "real1",
    ]);
    expect(announceable(posts.slice(0, 2), "fill", known)).toHaveLength(2);
  });
});

function snapshot(over: Partial<WorldSnapshot> = {}): WorldSnapshot {
  const resident = (id: string, online: boolean, hearth = false) => ({
    id,
    name: id,
    kind: "agent" as const,
    color: "sun" as const,
    shape: "round" as const,
    note: "",
    x: 0,
    y: 0,
    online,
    hearth: hearth ? { x: 1, y: 1 } : null,
  });
  return {
    v: 1,
    seq: 1,
    hash: "0",
    config: { width: 8, height: 8, plotSize: 8, maxPlotsPerResident: 1, reach: 3 },
    commons: { px: 0, py: 0 },
    residents: [resident("ada", true, true), resident("bo", false), resident("cy", true)],
    plots: [
      { px: 0, py: 1, ownerId: "pip" },
      { px: 1, py: 1, ownerId: "ada" },
    ],
    blocks: [{ x: 1, y: 1, block: "wall" }],
    townsfolk: ["pip", "otis"],
    townsfolkResidents: [resident("pip", true, true), resident("otis", true, true)],
    ...over,
  } as WorldSnapshot;
}

describe("pulse numbers", () => {
  it("counts real residents apart from townsfolk", () => {
    const s = snapshot();
    expect(pulseStats(s, townsfolkIds(s))).toEqual({
      residents: 3,
      online: 2,
      homes: 1,
      plots: 1,
      blocks: 1,
      townsfolk: 2,
    });
  });

  it("learns townsfolk from post authors too", () => {
    const ids = townsfolkIds(undefined, [post("clem", 1, { townsfolk: true }), post("ada", 2)]);
    expect([...ids]).toEqual(["r_clem"]);
  });

  it("shows real residents first and pads with townsfolk only while few are online", () => {
    const s = snapshot();
    const few = aroundNow(s, townsfolkIds(s));
    expect(few.shown.map((r) => r.id)).toEqual(["cy", "ada", "pip", "otis"]);
    const many = snapshot({
      residents: Array.from({ length: 7 }, (_, i) => ({
        ...snapshot().residents[0],
        id: `r${i}`,
      })) as WorldSnapshot["residents"],
    });
    const full = aroundNow(
      { ...many, residents: [...s.residents, ...many.residents] },
      townsfolkIds(s),
      5,
    );
    expect(full.shown.every((r) => r.id.startsWith("r"))).toBe(true);
    expect(full.more).toBe(4);
  });

  it("buckets posts per hour and marks hours we haven't loaded as unknown", () => {
    const posts = [post("a", 5), post("b", 10), post("c", 70), post("d", 60 * 5 + 1)];
    expect(hourlyCounts(posts, NOW, 4, null)).toEqual([0, 0, 1, 2]);
    expect(hourlyCounts(posts, NOW, 4, NOW - 181 * MIN)).toEqual([0, 0, 1, 2]);
    expect(hourlyCounts(posts, NOW, 4, NOW - 180 * MIN)).toEqual([null, 0, 1, 2]);
    expect(hourlyCounts(posts, NOW, 4, NOW - 30 * MIN)).toEqual([null, null, null, 2]);
  });
});

describe("world news", () => {
  it("reports who moved in, claimed a plot, or built a home, skipping townsfolk", () => {
    const before = snapshot();
    const after = snapshot();
    after.residents = after.residents.map((r) =>
      r.id === "cy" ? { ...r, hearth: { x: 2, y: 2 } } : r,
    );
    const like = (id: string) =>
      ({ ...after.residents[1], id, name: id }) as WorldSnapshot["residents"][number];
    after.residents.push(like("dee"));
    after.townsfolk = [...(after.townsfolk ?? []), "tf"];
    after.townsfolkResidents = [...(after.townsfolkResidents ?? []), like("tf")];
    after.plots = [...after.plots, { px: 2, py: 2, ownerId: "bo" }];
    const news = worldNews(before, after, townsfolkIds(after));
    expect(news.map((n) => `${n.kind}:${n.resident.id}`)).toEqual([
      "claimed:bo",
      "home:cy",
      "joined:dee",
    ]);
  });
});

describe("words", () => {
  it("names the time of day", () => {
    expect([0, 0.1, 0.25, 0.4, 0.5, 0.6, 0.75, 0.9, 0.97].map(phaseName)).toEqual([
      "Dawn",
      "Morning",
      "Noon",
      "Afternoon",
      "Dusk",
      "Evening",
      "Midnight",
      "Small hours",
      "Dawn",
    ]);
  });

  it("lists names in plain English", () => {
    expect(namesLine([])).toBe("");
    expect(namesLine(["Ada"])).toBe("Ada");
    expect(namesLine(["Ada", "Bo", "Ada"])).toBe("Ada and Bo");
    expect(namesLine(["Ada", "Bo", "Cy"])).toBe("Ada, Bo, and 1 other");
    expect(namesLine(["Ada", "Bo", "Cy", "Dee"])).toBe("Ada, Bo, and 2 others");
  });
});
