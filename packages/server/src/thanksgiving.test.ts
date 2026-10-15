import { DAY_MS, MINUTE_MS, type WorldConfig } from "@terrakin/sim";
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
 * Thanksgiving (RFC 0034) over HTTP: the shop and the world say it's on, the town books its feast
 * on the Thursday, and a resident at the feast brings a dish that the event's view then lists,
 * with the check-in pointing the way while it's on.
 */

// 3x3 plots of 8 tiles; the Commons is plot (1, 1).
const CONFIG: WorldConfig = {
  width: 24,
  height: 24,
  plotSize: 8,
  maxPlotsPerResident: 1,
  reach: 3,
};
const MONDAY = Date.UTC(2026, 10, 23, 9);
const FEAST = Date.UTC(2026, 10, 26, 18);

const cleanups: Cleanup[] = [];
const { problems, onResponse } = responseChecker();
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
  expect(problems.splice(0)).toEqual([]);
});

// biome-ignore lint/suspicious/noExplicitAny: the response checker already holds every body to its schema.
type Json = Record<string, any>;

async function start() {
  let now = MONDAY;
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

describe("Thanksgiving", () => {
  it("is on in the world and the shop all week, with its decor on a shelf of its own", async () => {
    const t = await start();
    expect((await t.call("GET", "/v1/world")).body.holidays).toEqual(["thanksgiving"]);
    const { shop } = (await t.call("GET", "/v1/shop")).body;
    expect(shop.holidays).toEqual([
      { id: "thanksgiving", lastDay: Math.floor(Date.UTC(2026, 10, 29) / DAY_MS) },
    ]);
    expect(shop.items.filter((i: Json) => i.holiday).map((i: Json) => i.sku)).toEqual([
      "cornucopia",
      "leaf_garland",
    ]);
  });

  it("books the feast for Thursday evening, and takes one dish from each resident there", async () => {
    const t = await start();
    const ada = t.join("Ada");
    // On the morning of the feast, a resident holding a dish is told when it starts.
    t.at(FEAST - 9 * 60 * MINUTE_MS);
    const inv = t.service.state.items?.inventories;
    if (inv) inv[ada.id] = { stacks: { candy: 2 }, goods: [] };
    const morning = pickTryNext(t.service.state, ada.id, new Set(), new Set());
    expect(morning?.id).toBe("feast");
    expect(morning?.line).toContain("today from 18:00 UTC");
    if (inv) inv[ada.id] = { stacks: {}, goods: [] };
    t.at(FEAST + 5 * MINUTE_MS);
    const { live } = (await t.call("GET", "/v1/events", undefined, ada.token)).body;
    const feast = live.find((e: Json) => e.title === "Thanksgiving feast");
    expect(feast).toMatchObject({ town: true, status: "live", moves: ["bring_dish"] });
    // Ada holds no dish yet: the world says so in its own words.
    expect(await t.act(ada.token, { type: "bring_dish", item: "candy" })).toMatchObject({
      ok: false,
      error: { code: "not_enough_items" },
    });
    if (inv) inv[ada.id] = { stacks: { candy: 2 }, goods: [] };
    const pick = pickTryNext(t.service.state, ada.id, new Set(), new Set());
    expect(pick?.id).toBe("feast");
    expect(pick?.line).toContain(`"event": "${feast.id}"`);
    expect(await t.act(ada.token, { type: "bring_dish", item: "candy" })).toMatchObject({
      ok: true,
    });
    const after = (await t.call("GET", `/v1/events/${feast.id}`, undefined, ada.token)).body.event;
    expect(after.dishes).toMatchObject([{ by: { id: ada.id }, kind: "candy" }]);
    expect(after.moves).toEqual([]);
    expect(await t.act(ada.token, { type: "bring_dish", item: "candy" })).toMatchObject({
      ok: false,
      error: { code: "already_brought" },
    });
  });
});
