import type { Input, WorldConfig } from "@terrakin/sim";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "./app";
import { MemoryMediaStore } from "./media";
import { weekStart } from "./newcomers";
import { nodeSql } from "./node-sql";
import { SocialService } from "./social-service";
import { MemoryStore } from "./store";
import { jsonCaller, listenOnFreePort, responseChecker } from "./test-support";
import { WorldService } from "./world-service";

/** The newcomer funnel (decision 0141), over HTTP from a world residents played in. */

const CONFIG: WorldConfig = {
  width: 40,
  height: 40,
  plotSize: 4,
  maxPlotsPerResident: 1,
  reach: 2,
};
const DAY = 24 * 60 * 60_000;

const cleanups: (() => void | Promise<void>)[] = [];
const { problems, onResponse } = responseChecker();
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
  expect(problems.splice(0)).toEqual([]);
});

async function start() {
  // A Tuesday, 2023-11-14.
  let now = 1_700_000_000_000;
  const service = new WorldService({
    store: new MemoryStore(),
    config: CONFIG,
    now: () => now,
    days: true,
    economy: true,
    items: true,
    gifts: true,
  });
  const sql = nodeSql();
  const maintainers = new Set<string>();
  const social = new SocialService({
    sql,
    media: new MemoryMediaStore(),
    resident: (id: string) => service.state.residents[id],
    maintainers,
    now: () => now,
  });
  const server = createApp({
    service,
    social,
    media: new MemoryMediaStore(),
    actionsPerSecond: 1000,
    sessionsPerMinute: 1000,
    onResponse,
  });
  const base = await listenOnFreePort(server, cleanups);
  cleanups.push(() => sql.close());
  const call = jsonCaller(base);
  const join = (name: string, kind: "human" | "agent") => {
    const made = service.createSession({ name, kind });
    if (!made.ok || !made.residentId || !made.token) throw new Error(`Couldn't join ${name}`);
    return { id: made.residentId, token: made.token };
  };
  const ok = async (method: string, path: string, body: unknown, token: string) => {
    const res = await call(method, path, body, token);
    expect(res.status, JSON.stringify(res.body)).toBeLessThan(300);
    return res.body;
  };
  const act = (token: string, action: unknown) => ok("POST", "/v1/actions", action, token);
  /**
   * A second resident with a name someone already has, logged as worlds from before names were
   * unique hold them (decision 0148): no join route makes one now.
   */
  const joinAgain = (name: string, kind: "human" | "agent") => {
    const id = `r_${name.toLowerCase().padEnd(16, "0").slice(0, 16)}`;
    const logged = (service as unknown as { run(input: Input): { ok: boolean } }).run({
      actor: id,
      command: { type: "join", name, kind },
    });
    if (!logged.ok) throw new Error(`Couldn't log a join for ${name}`);
    return { id, token: service.issueToken(id) };
  };
  return {
    service,
    social,
    maintainers,
    call,
    join,
    joinAgain,
    ok,
    act,
    later: (days: number) => {
      now += days * DAY;
      service.tick();
    },
  };
}

describe("weekStart", () => {
  it("is the Monday of the UTC week", () => {
    // 1970-01-01 was a Thursday; Monday 1970-01-05 is day 4.
    expect(weekStart(0)).toBe(-3);
    expect(weekStart(4)).toBe(4);
    expect(weekStart(10)).toBe(4);
    expect(weekStart(11)).toBe(11);
  });
});

describe("GET /v1/admin/newcomers", () => {
  it("counts each step once per resident, people and AIs apart, townsfolk left out", async () => {
    const t = await start();

    // Two weeks back: Wren does every step; Moss only joins; Juniper is townsfolk.
    const wren = t.join("Wren", "human");
    const moss = t.join("Moss", "human");
    const juniper = t.join("Juniper", "agent");
    await t.act(wren.token, { type: "settle", px: 1, py: 1 });
    await t.act(wren.token, { type: "build_starter_home" });
    await t.act(wren.token, { type: "place", x: 6, y: 6, block: "planter" });
    await t.act(wren.token, { type: "plant", x: 6, y: 6, seed: "flower" });
    await t.act(wren.token, { type: "profile", theme: "meadow" });
    await t.ok("POST", "/v1/posts", { text: "Hello" }, wren.token);
    await t.act(wren.token, { type: "adopt_pet", kind: "dog", coat: "golden", name: "Rex" });
    await t.act(juniper.token, { type: "settle", px: 3, py: 1 });
    await t.ok("POST", "/v1/posts", { text: "Welcome" }, juniper.token);
    t.service.syncTownsfolk(new Set([juniper.id]));
    // A wave a putter sent by itself isn't something Moss chose to do.
    const putterWave = t.social.together.sendGesture(
      moss.id,
      wren.id,
      { kind: "wave" },
      { putter: true },
    );
    expect(putterWave.ok).toBe(true);

    t.later(14);
    // This week: Fern settles in and is given a flower; Bolt only claims; an AI called wren
    // follows Moss; Ryan, staff, only joins.
    const fern = t.join("Fern", "human");
    const bolt = t.join("Bolt", "agent");
    const wren2 = t.joinAgain("wren", "agent");
    const ryan = t.join("Ryan", "agent");
    t.maintainers.add(ryan.id);
    await t.act(fern.token, { type: "settle", px: 1, py: 3 });
    await t.act(fern.token, { type: "build_starter_home" });
    await t.act(bolt.token, { type: "settle", px: 3, py: 3 });
    await t.ok("PUT", `/v1/residents/${moss.id}/follow`, undefined, wren2.token);
    // The pantry handed Fern starter seeds, which don't count as a first thing.
    expect(t.social.collection.collected(fern.id).count).toBeGreaterThan(0);
    const before = await t.call("GET", "/v1/admin/newcomers", undefined, ryan.token);
    expect(before.body.weeks[0].people.thing).toBe(0);
    await t.act(wren.token, { type: "harvest", x: 6, y: 6 });
    await t.act(wren.token, { type: "give", item: "flower", to: fern.id });

    const res = await t.call("GET", "/v1/admin/newcomers", undefined, ryan.token);
    expect(res.status).toBe(200);
    const body = res.body;
    expect(body.today).toBe("2023-11-28");
    expect(body.weeks.map((w: { week: string }) => w.week)).toEqual([
      "2023-11-27",
      "2023-11-20",
      "2023-11-13",
      "2023-11-06",
      "2023-10-30",
      "2023-10-23",
      "2023-10-16",
      "2023-10-09",
    ]);
    const none = { joined: 0, claimed: 0, hearth: 0, thing: 0, look: 0, social: 0, pet: 0 };
    const thisWeek = {
      people: { ...none, joined: 1, claimed: 1, hearth: 1, thing: 1 },
      agents: { ...none, joined: 3, claimed: 1, social: 1 },
      sameName: 1,
    };
    const twoBack = {
      people: { joined: 2, claimed: 1, hearth: 1, thing: 1, look: 1, social: 1, pet: 1 },
      agents: none,
      sameName: 0,
    };
    expect(body.weeks[0]).toEqual({ week: "2023-11-27", ...thisWeek });
    expect(body.weeks[1]).toEqual({ week: "2023-11-20", people: none, agents: none, sameName: 0 });
    expect(body.weeks[2]).toEqual({ week: "2023-11-13", ...twoBack });
    expect(body.allTime).toEqual({
      week: null,
      people: { joined: 3, claimed: 2, hearth: 2, thing: 2, look: 1, social: 1, pet: 1 },
      agents: thisWeek.agents,
      sameName: 1,
    });
    expect(body.undated).toBe(0);
    // Counts only: no resident's id or name.
    const text = JSON.stringify(body);
    for (const r of [wren, moss, juniper, fern, bolt, wren2, ryan])
      expect(text).not.toContain(r.id);
    expect(text).not.toMatch(/Wren|Moss|Fern|Bolt|Juniper|Ryan/i);

    // Staff only.
    expect((await t.call("GET", "/v1/admin/newcomers", undefined, moss.token)).status).toBe(403);
    expect((await t.call("GET", "/v1/admin/newcomers")).status).toBe(401);
  });
});
