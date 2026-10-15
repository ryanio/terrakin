import { DAY_MS, type WorldConfig } from "@terrakin/sim";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "./app";
import { pickTryNext } from "./checkin-suggest";
import { MemoryMediaStore } from "./media";
import { nodeSql } from "./node-sql";
import { SocialService } from "./social-service";
import { MemoryStore } from "./store";
import { type Cleanup, jsonCaller, listenOnFreePort, responseChecker } from "./test-support";
import { townCalendar } from "./town-events";
import { WorldService } from "./world-service";

/**
 * Christmas and New Year's (RFC 0034) over HTTP: a wrapped present shows in its recipient's things
 * without what's inside, the town leaves its present on December 25, the check-in suggests wrapping,
 * opening, and fireworks, and the town gathers in the Commons on New Year's Eve.
 */

// 3x3 plots of 8 tiles; the Commons is plot (1, 1).
const CONFIG: WorldConfig = {
  width: 24,
  height: 24,
  plotSize: 8,
  maxPlotsPerResident: 1,
  reach: 3,
};
const DEC_20 = Date.UTC(2026, 11, 20, 12);

const cleanups: Cleanup[] = [];
const { problems, onResponse } = responseChecker();
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
  expect(problems.splice(0)).toEqual([]);
});

// biome-ignore lint/suspicious/noExplicitAny: the response checker already holds every body to its schema.
type Json = Record<string, any>;

async function start(from = DEC_20) {
  let now = from;
  const service = new WorldService({
    store: new MemoryStore(),
    config: CONFIG,
    now: () => now,
    days: true,
    economy: true,
    items: true,
    shop: true,
    presence: true,
    townEvents: townCalendar,
  });
  service.tick();
  const sql = nodeSql();
  const media = new MemoryMediaStore();
  const social = new SocialService({
    sql,
    media,
    resident: (id: string) => service.state.residents[id],
    now: () => now,
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
  const call = jsonCaller(await listenOnFreePort(server, cleanups));
  const join = (name: string) => {
    const made = service.createSession({ name, kind: "human" });
    if (!made.ok || !made.residentId || !made.token) throw new Error(`Couldn't join ${name}`);
    return { id: made.residentId, token: made.token };
  };
  const act = async (token: string, action: Json) =>
    (await call("POST", "/v1/actions", action, token)).body as Json;
  /** Move the clock to `at`, then do what the minute sweep does. */
  const at = (when: number) => {
    while (now < when) {
      now = Math.min(when, now + DAY_MS);
      service.tick();
      service.sweepEvents();
    }
  };
  return { call, join, act, at, service };
}

const tryFor = (t: { service: WorldService }, id: string) =>
  pickTryNext(t.service.state, id, new Set(), new Set());

describe("Christmas", () => {
  it("holds a wrapped present out of sight until December 25, and the town leaves its own", async () => {
    const t = await start();
    const ada = t.join("Ada");
    const bob = t.join("Bob");
    const cy = t.join("Cy");
    for (const [who, px] of [
      [ada, 0],
      [bob, 2],
    ] as const) {
      await t.act(who.token, { type: "settle", px, py: 0 });
      await t.act(who.token, { type: "build_starter_home" });
    }
    expect(tryFor(t, ada.id)?.id).toBe("wrap_presents");
    expect(tryFor(t, ada.id)?.line).toMatch(/^It's December/);
    const give = { type: "give", item: "lemon_seed", to: bob.id, wrapped: true };
    const noted = await t.act(ada.token, { ...give, note: "for you" });
    expect(noted).toMatchObject({ ok: false, error: { code: "invalid_gift" } });
    expect(await t.act(ada.token, give)).toMatchObject({ ok: true });
    const things = async (token: string) =>
      (await t.call("GET", "/v1/inventory", undefined, token)).body.inventory as Json;
    const count = async (token: string, kind: string) =>
      (await things(token)).stacks.find((s: Json) => s.kind === kind)?.count ?? 0;
    const [present] = (await things(bob.token)).presents;
    expect(Object.keys(present).sort()).toEqual(["day", "from", "fromId", "id", "opensDay"]);
    expect(present).toMatchObject({ id: "present_1", fromId: ada.id, from: { id: ada.id } });
    expect(tryFor(t, bob.id)?.id).not.toBe("open_presents");
    // The map learns how many wait for Bob, never from whom or what.
    expect((await t.call("GET", "/v1/world")).body.presents).toEqual([
      { residentId: bob.id, count: 1 },
    ]);
    // Bob hears who wrapped it, never what, and his check-in says so.
    const notices = async (token: string) =>
      (await t.call("GET", "/v1/notifications", undefined, token)).body.notifications as Json[];
    expect(await notices(bob.token)).toEqual([
      expect.objectContaining({
        type: "present_received",
        actor: expect.objectContaining({ id: ada.id }),
      }),
    ]);
    const checkin = (await t.call("GET", "/v1/checkin", undefined, bob.token)).body;
    expect(checkin.todo.join("\n")).toContain("1 neighbor wrapped a present for you");
    const early = await t.act(bob.token, { type: "open_present", present: "present_1" });
    expect(early).toMatchObject({ ok: false, error: { code: "not_yet" } });

    t.at(Date.UTC(2026, 11, 24, 12));
    expect(tryFor(t, ada.id)?.line).toMatch(
      /^It's Christmas Eve: a present wrapped today opens tomorrow\./,
    );
    t.at(Date.UTC(2026, 11, 25, 12));
    // Ada has a home and nothing waiting; Bob has Ada's present waiting, and Cy has no home.
    expect((await things(ada.token)).presents).toEqual([
      expect.objectContaining({ id: "present_2", fromId: "town" }),
    ]);
    expect((await things(ada.token)).presents[0].from).toBeUndefined();
    expect((await things(bob.token)).presents).toHaveLength(1);
    expect((await things(cy.token)).presents).toBeUndefined();
    const open = tryFor(t, bob.id);
    expect(open?.id).toBe("open_presents");
    expect(open?.line).toContain('"present": "present_1"');
    expect(open?.line).toMatch(/^It's Christmas Day\. /);
    const seeds = await count(bob.token, "lemon_seed");
    expect(await t.act(bob.token, { type: "open_present", present: "present_1" })).toMatchObject({
      ok: true,
    });
    expect(await count(bob.token, "lemon_seed")).toBe(seeds + 1);
    expect((await notices(ada.token)).map((n) => n.type)).toEqual(["present_opened"]);
    expect(await t.act(ada.token, { type: "open_present", present: "present_2" })).toMatchObject({
      ok: true,
    });
    expect(await count(ada.token, "candy_cane")).toBe(3);
    // The town's present names nobody, so opening it tells no one.
    expect((await notices(ada.token)).map((n) => n.type)).toEqual(["present_opened"]);
    // A present the new year opens was opened by nobody, so its giver hears nothing.
    expect(await t.act(ada.token, { ...give, item: "herb_seed" })).toMatchObject({ ok: true });
    t.at(Date.UTC(2027, 0, 1, 12));
    expect((await things(bob.token)).presents).toBeUndefined();
    expect((await notices(ada.token)).map((n) => n.type)).toEqual(["present_opened"]);
  });
});

describe("New Year's", () => {
  it("sells fireworks, suggests them on its nights, and gathers the town on New Year's Eve", async () => {
    const t = await start(Date.UTC(2026, 11, 30, 12));
    const ada = t.join("Ada");
    await t.act(ada.token, { type: "settle", px: 0, py: 0 });
    await t.act(ada.token, { type: "build_starter_home" });
    const { shop } = (await t.call("GET", "/v1/shop")).body;
    expect(shop.items.find((i: Json) => i.sku === "firework")).toMatchObject({
      price: 2,
      holiday: "new_year",
    });
    expect(await t.act(ada.token, { type: "shop_buy", sku: "firework", count: 2 })).toMatchObject({
      ok: true,
    });
    expect(tryFor(t, ada.id)?.id).not.toBe("fireworks");
    t.at(Date.UTC(2026, 11, 31, 12));
    const { upcoming } = (await t.call("GET", "/v1/events")).body;
    expect(upcoming).toContainEqual(
      expect.objectContaining({
        title: "New Year's Eve",
        startsAt: new Date(Date.UTC(2026, 11, 31, 23)).toISOString(),
        minutes: 120,
      }),
    );
    expect(tryFor(t, ada.id)?.id).toBe("fireworks");
    const hearth = t.service.state.residents[ada.id]?.hearth;
    const lit = await t.act(ada.token, {
      type: "set_off_firework",
      x: hearth?.x ?? 0,
      y: (hearth?.y ?? 0) + 1,
      color: "red",
    });
    expect(lit).toMatchObject({ ok: true });
  });
});
