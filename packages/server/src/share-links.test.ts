import type { CheckinResponse } from "@terrakin/protocol";
import type { WorldConfig } from "@terrakin/sim";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "./app";
import { MemoryMediaStore } from "./media";
import { nodeSql } from "./node-sql";
import { checkinWithLinks } from "./share-links";
import { SocialService } from "./social-service";
import { MemoryStore } from "./store";
import { type Cleanup, jsonCaller, listenOnFreePort, responseChecker } from "./test-support";
import { WorldService } from "./world-service";

/** Links to share (decision 0161): absolute, on the request's origin, from ids and coordinates. */

const CONFIG: WorldConfig = {
  width: 40,
  height: 40,
  plotSize: 8,
  maxPlotsPerResident: 1,
  reach: 3,
};

const cleanups: Cleanup[] = [];
const { problems, onResponse } = responseChecker();
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
  expect(problems.splice(0)).toEqual([]);
});

// biome-ignore lint/suspicious/noExplicitAny: the response checker already holds every body to its schema.
type Json = Record<string, any>;

/** Every string under a `links` key anywhere in `value`. */
function linksIn(value: unknown, inLinks = false): string[] {
  if (typeof value === "string") return inLinks ? [value] : [];
  if (Array.isArray(value)) return value.flatMap((v) => linksIn(v, inLinks));
  if (value && typeof value === "object") {
    return Object.entries(value).flatMap(([k, v]) => linksIn(v, inLinks || k === "links"));
  }
  return [];
}

async function start() {
  const service = new WorldService({ store: new MemoryStore(), config: CONFIG });
  const sql = nodeSql();
  const media = new MemoryMediaStore();
  const social = new SocialService({
    sql,
    media,
    resident: (id: string) => service.state.residents[id],
    residentAgeDays: () => 30,
  });
  const server = createApp({
    service,
    social,
    media,
    actionsPerSecond: 1000,
    sessionsPerMinute: 1000,
    onResponse,
  });
  cleanups.push(() => sql.close());
  const base = await listenOnFreePort(server, cleanups);
  const call = jsonCaller(base);
  const join = (name: string) => {
    const made = service.createSession({ name, kind: "agent" });
    if (!made.ok || !made.residentId || !made.token) throw new Error(`Couldn't join ${name}`);
    return { id: made.residentId, token: made.token };
  };
  const act = async (token: string, action: Json) =>
    (await call("POST", "/v1/actions", action, token)).body as Json;
  return { base, call, join, act };
}

describe("links to share", () => {
  it("puts absolute links on the request's origin on profiles, plots, posts, and the check-in, from ids and coordinates alone", async () => {
    const t = await start();
    const ivy = t.join("Zephyrine");
    const wren = t.join("Quillon");
    await t.act(ivy.token, { type: "settle", px: 1, py: 0 });
    await t.act(ivy.token, { type: "build_starter_home" });
    await t.act(ivy.token, { type: "name_plot", px: 1, py: 0, name: "Marigold Hollow" });
    const r = (id: string) => ({
      profile: `${t.base}/r/${id}`,
      world: `${t.base}/world?at=${id}`,
      world3d: `${t.base}/world?at=${id}&view=3d`,
      look: `${t.base}/og/look/${id}.png`,
      near: `${t.base}/og/near/${id}.png`,
    });
    const plot = {
      world: `${t.base}/world?at=1,0`,
      world3d: `${t.base}/world?at=1,0&view=3d`,
      picture: `${t.base}/og/plot/1-0.png`,
    };

    // Profiles: the reads, and an answer that is a profile after a change.
    const me = (await t.call("GET", "/v1/me", undefined, ivy.token)).body.resident;
    expect(me.links).toEqual(r(ivy.id));
    expect(me.home).toMatchObject({ px: 1, py: 0, links: plot });
    const seen = (await t.call("GET", `/v1/residents/${ivy.id}`)).body.resident;
    expect(seen.links).toEqual(r(ivy.id));
    expect(seen.home.links).toEqual(plot);
    const changed = await t.call("PUT", "/v1/profile", { bio: "Gardens." }, wren.token);
    expect(changed.body.resident.links).toEqual(r(wren.id));
    expect(changed.body.resident.home).toBeUndefined();

    // Plots: the list, one plot, and admiring one.
    const plots = (await t.call("GET", "/v1/plots")).body.plots as Json[];
    expect(plots.map((p) => p.links)).toEqual([plot]);
    expect((await t.call("GET", "/v1/plots/1/0")).body.plot.links).toEqual(plot);
    await t.act(wren.token, { type: "visit", px: 1, py: 0 });
    const admired = await t.call("POST", "/v1/plots/1/0/admire", undefined, wren.token);
    expect(admired.body.plot.links).toEqual(plot);

    // Posts: a new one and its page.
    const posted = await t.call("POST", "/v1/posts", { text: "Hello from Quillon." }, wren.token);
    const postId = posted.body.post.id as string;
    const post = { page: `${t.base}/p/${postId}`, picture: `${t.base}/og/post/${postId}.png` };
    expect(posted.body.post.links).toEqual(post);
    expect((await t.call("GET", `/v1/posts/${postId}`)).body.post.links).toEqual(post);

    // The check-in: Wren followed, admired, waved, and posted; Ivy follows Wren.
    await t.call("PUT", `/v1/residents/${wren.id}/follow`, undefined, ivy.token);
    await t.call("PUT", `/v1/residents/${ivy.id}/follow`, undefined, wren.token);
    await t.call("POST", `/v1/residents/${ivy.id}/gesture`, { kind: "wave" }, wren.token);
    await t.call("POST", "/v1/posts", { text: "Lovely, @nobody." }, wren.token);
    const checkin = (await t.call("GET", "/v1/checkin", undefined, ivy.token)).body as Json;
    expect(checkin.links).toEqual({ you: r(ivy.id), home: plot });
    const notes = checkin.notifications.items as Json[];
    expect(notes.find((n) => n.type === "follow")?.actor.links).toEqual(r(wren.id));
    expect(notes.find((n) => n.type === "plot_admired")?.plot.links).toEqual(plot);
    expect((checkin.gestures as Json[])[0]?.from.links).toEqual(r(wren.id));
    const followed = checkin.following as Json[];
    expect(followed.length).toBeGreaterThan(0);
    for (const p of followed) expect(p.links.page).toBe(`${t.base}/p/${p.id}`);

    // Someone who lives on no plot gets their own links and no `home`.
    const homeless = await t.call("GET", "/v1/checkin", undefined, wren.token);
    expect(homeless.body.links).toEqual({ you: r(wren.id) });

    // Every link is an absolute URL on this server, made of ids and coordinates: names, a plot's
    // name, and a post's words never reach one.
    const all = [me, seen, plots, admired.body, posted.body, checkin].flatMap((v) => linksIn(v));
    expect(all.length).toBeGreaterThan(30);
    for (const url of all) {
      expect(url.startsWith(`${t.base}/`), url).toBe(true);
      expect(url.slice(t.base.length), url).toMatch(/^\/[A-Za-z0-9_/.?=&,-]+$/);
      expect(url, url).not.toMatch(/zephyrine|quillon|marigold|hollow|hello|lovely/i);
    }
  });

  it("links an event's place, a game's table, and whoever a purse line is with", () => {
    const author = { id: "r_0123456789abcdef", name: "Bo", kind: "human" } as const;
    const base = {
      notifications: { unread: 1, items: [] },
      gestures: [],
      following: [],
      coins: {
        balance: 9,
        allowanceToday: true,
        today: [
          { seq: 4, day: 1, amount: 5, reason: "market_sale", with: author, trust: "untrusted" },
          { seq: 3, day: 1, amount: 2, reason: "allowance", trust: "untrusted" },
        ],
      },
      events: {
        soon: [{ id: "e_1", place: { px: 2, py: 3, commons: false } }],
        live: [{ id: "e_2", place: { px: 2, py: 2, commons: true } }],
      },
      games: {
        yourMove: [{ table: "t_1", round: 1 }],
        canStart: [],
        ended: [{ table: "t_2", place: 1, seats: 4 }],
      },
    } as unknown as Omit<CheckinResponse, "links">;
    const c = checkinWithLinks("https://example.test", "r_fedcba9876543210", undefined, base);
    expect(c.coins?.today[0]?.with?.links?.profile).toBe(
      "https://example.test/r/r_0123456789abcdef",
    );
    expect(c.coins?.today[1]?.with).toBeUndefined();
    expect(c.events.soon[0]?.place.links?.picture).toBe("https://example.test/og/plot/2-3.png");
    expect(c.events.live[0]?.place.links?.world).toBe("https://example.test/world?at=2,2");
    expect(c.games?.yourMove[0]?.links).toEqual({ page: "https://example.test/games/t_1" });
    expect(c.games?.ended[0]?.links).toEqual({ page: "https://example.test/games/t_2" });
    expect(c.links).toEqual({
      you: expect.objectContaining({ near: "https://example.test/og/near/r_fedcba9876543210.png" }),
    });
  });
});
