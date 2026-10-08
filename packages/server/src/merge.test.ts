import { type Input, TOWN_ACTOR, type WorldConfig, type WorldState } from "@terrakin/sim";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "./app";
import { MemoryMediaStore } from "./media";
import { nodeSql } from "./node-sql";
import { SocialService } from "./social-service";
import { MemoryStore } from "./store";
import { jsonCaller, listenOnFreePort, responseChecker } from "./test-support";
import { WorldService } from "./world-service";

/**
 * Merging a duplicate record into the one that stays (issue #46, decision 0239), through the staff
 * route. It takes a resident out of the world and moves their coins, so the route's guards each
 * have a case that leaves the world as it was, and the coins are counted across the merge.
 */

const CONFIG: WorldConfig = {
  width: 12,
  height: 12,
  plotSize: 4,
  maxPlotsPerResident: 1,
  reach: 2,
};
const DAY = 20_000;
const town = (command: Input["command"]): Input => ({ actor: TOWN_ACTOR, command });

const cleanups: (() => void | Promise<void>)[] = [];
const { problems, onResponse } = responseChecker();
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
  expect(problems.splice(0)).toEqual([]);
});

interface Who {
  residentId: string;
  token: string;
}

/** Every coin in a purse, the treasury, and what was ever minted and burned. */
function money(state: WorldState) {
  const econ = state.economy;
  if (!econ) throw new Error("no economy");
  const purses = Object.values(econ.coins).reduce((sum, n) => sum + n, 0);
  return { purses, treasury: econ.treasury, minted: econ.minted, burned: econ.burned };
}

async function start() {
  const now = () => DAY * 86_400_000 + 3_600_000;
  const store = new MemoryStore();
  for (const input of [
    town({ type: "new_day", day: DAY }),
    town({ type: "open_economy" }),
    town({ type: "open_items" }),
  ]) {
    store.appendInput(input);
  }
  const service = new WorldService({ store, config: CONFIG, now });
  const sql = nodeSql();
  cleanups.push(() => sql.close());
  const maintainers = new Set<string>();
  const moderators = new Set<string>();
  const media = new MemoryMediaStore();
  const social = new SocialService({
    sql,
    media,
    maintainers,
    moderators,
    now,
    resident: (id) => service.state.residents[id],
  });
  const server = createApp({
    service,
    social,
    media,
    actionsPerSecond: 1000,
    sessionsPerMinute: 1000,
    onResponse,
  });
  const call = jsonCaller(await listenOnFreePort(server, cleanups));
  const join = async (name: string, kind: "human" | "agent"): Promise<Who> =>
    (await call("POST", "/v1/session", { name, kind })).body as Who;

  const mira = await join("Mira", "human");
  maintainers.add(mira.residentId);
  const hazel = await join("Hazel", "human");
  const otto = await join("Otto", "human");
  moderators.add(otto.residentId);
  const kept = await join("Maypole", "agent");
  const dup = await join("Maypole #532", "agent");
  // The duplicate settles a plot (and gets the welcome gift), posts, and follows Hazel, who
  // follows it back.
  expect(
    (await call("POST", "/v1/actions", { type: "settle", px: 2, py: 0 }, dup.token)).status,
  ).toBe(200);
  expect((await call("POST", "/v1/posts", { text: "Ribbons up" }, dup.token)).status).toBe(201);
  expect(social.setFollow(dup.residentId, hazel.residentId, true).ok).toBe(true);
  expect(social.setFollow(hazel.residentId, dup.residentId, true).ok).toBe(true);
  // Hazel blocks it too; it took a handle and holds an agent link.
  expect(social.setBlock(hazel.residentId, dup.residentId, true).ok).toBe(true);
  expect((await call("PUT", "/v1/profile", { handle: "maypole532" }, dup.token)).status).toBe(200);
  sql.exec(
    `INSERT INTO agent_links (resident_id, chain_id, registry, agent_id, name, linked_at, checked_at, due_at)
      VALUES (?, 1, '0xregistry', '532', 'Maypole', 0, 0, 0)`,
    dup.residentId,
  );

  const merge = (
    from: string,
    body: { into: string; reason?: string; dry?: boolean },
    who: Who = mira,
  ) =>
    call(
      "POST",
      `/v1/admin/residents/${from}/merge`,
      { reason: "Same agent, joined twice", ...body },
      who.token,
    );
  return { call, service, sql, mira, hazel, otto, kept, dup, merge };
}

describe("merging a duplicate record", () => {
  it("refuses anyone but a maintainer, and a merge the sim turns down, changing nothing", async () => {
    const { service, hazel, otto, kept, dup, merge } = await start();
    const seq = service.state.seq;
    const into = { into: kept.residentId };

    expect((await merge(dup.residentId, into, hazel)).status).toBe(403);
    // A moderator is staff, but merging moves coins: maintainers only.
    expect((await merge(dup.residentId, into, otto)).status).toBe(403);
    // Still in the world from settling.
    expect((await merge(dup.residentId, into)).body.error.code).toBe("not_eligible");
    service.leave(dup.residentId);
    const after = service.state.seq;
    expect((await merge(dup.residentId, { into: dup.residentId })).body.error.code).toBe(
      "not_eligible",
    );
    // A person and an AI are never the same resident.
    expect((await merge(dup.residentId, { into: hazel.residentId })).body.error.code).toBe(
      "not_eligible",
    );
    expect((await merge(dup.residentId, { into: "@nobody-here" })).status).toBe(404);
    expect((await merge(dup.residentId, { into: kept.residentId, reason: "" })).status).toBe(400);
    expect(service.state.seq).toBe(after);
    expect(after).toBe(seq + 1);
    expect(service.state.residents[dup.residentId]).toBeDefined();
  });

  it("moves every coin to the record that stays, and the duplicate's posts, follows, and key", async () => {
    const { call, service, sql, mira, hazel, kept, dup, merge } = await start();
    service.leave(dup.residentId);
    const coins = service.state.economy?.coins[dup.residentId] ?? 0;
    expect(coins).toBeGreaterThan(0);
    const before = money(service.state);

    // A dry run says what would move and changes nothing.
    const seq = service.state.seq;
    const dry = await merge(dup.residentId, { into: kept.residentId, dry: true });
    expect(dry.status).toBe(200);
    expect(dry.body).toMatchObject({
      from: { id: dup.residentId, name: "Maypole #532" },
      into: { id: kept.residentId, name: "Maypole" },
      coins,
      things: 0,
      plots: [{ px: 2, py: 0 }],
      merged: false,
    });
    expect(service.state.seq).toBe(seq);

    const done = await merge(dup.residentId, { into: kept.residentId });
    expect(done.status).toBe(200);
    expect(done.body).toMatchObject({ coins, merged: true });
    expect(service.state.residents[dup.residentId]).toBeUndefined();
    expect(service.state.plots["2,0"]).toBeUndefined();
    expect(service.state.economy?.coins[kept.residentId]).toBe(coins);
    expect(money(service.state)).toEqual(before);

    // Its post and follows are the kept record's now.
    const posts = [...sql.exec("SELECT author FROM posts")].map((r) => r.author);
    expect(posts).toEqual([kept.residentId]);
    const follows = [...sql.exec("SELECT follower, followee FROM follows ORDER BY follower")];
    expect(follows).toEqual(
      expect.arrayContaining([
        { follower: kept.residentId, followee: hazel.residentId },
        { follower: hazel.residentId, followee: kept.residentId },
      ]),
    );
    expect(JSON.stringify(follows)).not.toContain(dup.residentId);
    // Hazel's block, its handle, and its agent link carry over.
    expect([
      ...sql.exec("SELECT blocker, blocked FROM blocks WHERE blocked = ?", kept.residentId),
    ]).toEqual([{ blocker: hazel.residentId, blocked: kept.residentId }]);
    const byHandle = await call("GET", "/v1/residents/by-handle/maypole532");
    expect(byHandle.body.resident?.id).toBe(kept.residentId);
    const links = [...sql.exec("SELECT resident_id FROM agent_links")].map((r) => r.resident_id);
    expect(links).toEqual([kept.residentId]);

    // Its token says where things went; its profile is gone; it can't be merged again.
    const old = await call("GET", "/v1/checkin", undefined, dup.token);
    expect(old.body.error).toMatchObject({ code: "revoked" });
    expect(old.body.error.message).toContain(kept.residentId);
    expect((await call("GET", `/v1/residents/${dup.residentId}`)).status).toBe(404);
    expect((await merge(dup.residentId, { into: kept.residentId })).status).toBe(404);

    // The moderation log names the maintainer, both records, and why.
    const logged = [...sql.exec("SELECT * FROM moderation_log WHERE action = 'merge_resident'")];
    expect(logged).toEqual([
      expect.objectContaining({
        actor: mira.residentId,
        target: dup.residentId,
        reason: `Into ${kept.residentId}: Same agent, joined twice`,
      }),
    ]);
  });
});
