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
 * Hanukkah (RFC 0034) over HTTP: the world and the shop say it's on beside Midwinter when the
 * calendar puts them together, and the check-in suggests a menorah until there's one at home.
 */

// 3x3 plots of 8 tiles; the Commons is plot (1, 1).
const CONFIG: WorldConfig = {
  width: 24,
  height: 24,
  plotSize: 8,
  maxPlotsPerResident: 1,
  reach: 3,
};
const SECOND_NIGHT = Date.UTC(2026, 11, 5, 12);

const cleanups: Cleanup[] = [];
const { problems, onResponse } = responseChecker();
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
  expect(problems.splice(0)).toEqual([]);
});

// biome-ignore lint/suspicious/noExplicitAny: the response checker already holds every body to its schema.
type Json = Record<string, any>;

async function start(from = SECOND_NIGHT) {
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

describe("Hanukkah", () => {
  it("is on in the world and the shop, beside Midwinter when they meet", async () => {
    const t = await start();
    expect((await t.call("GET", "/v1/world")).body.holidays).toEqual(["hanukkah"]);
    const { shop } = (await t.call("GET", "/v1/shop")).body;
    expect(
      shop.items.filter((i: Json) => i.holiday === "hanukkah").map((i: Json) => i.sku),
    ).toEqual(["menorah", "dreidel", "gelt"]);
    const together = await start(Date.UTC(2027, 11, 27, 12));
    expect((await together.call("GET", "/v1/world")).body.holidays).toEqual([
      "midwinter",
      "hanukkah",
    ]);
    const both = (await together.call("GET", "/v1/shop")).body.shop.holidays;
    expect(both.map((h: Json) => h.id)).toEqual(["midwinter", "hanukkah"]);
  });

  it("suggests a menorah to a resident with a home until there's one in their things", async () => {
    const t = await start();
    const ada = t.join("Ada");
    await t.act(ada.token, { type: "settle", px: 0, py: 0 });
    await t.act(ada.token, { type: "build_starter_home" });
    const pick = pickTryNext(t.service.state, ada.id, new Set(), new Set());
    expect(pick?.id).toBe("menorah");
    expect(pick?.line).toContain("night 2 of 8");
    const bought = await t.act(ada.token, { type: "shop_buy", sku: "menorah" });
    expect(bought).toMatchObject({ ok: true });
    expect(pickTryNext(t.service.state, ada.id, new Set(), new Set())?.id).not.toBe("menorah");
    // Placed on her plot, it still counts.
    const hearth = t.service.state.residents[ada.id]?.hearth;
    const placed = await t.act(ada.token, {
      type: "place",
      x: (hearth?.x ?? 0) - 1,
      y: (hearth?.y ?? 0) + 3,
      block: "menorah",
    });
    expect(placed).toMatchObject({ ok: true });
    expect(t.service.state.items?.inventories[ada.id]?.stacks.menorah ?? 0).toBe(0);
    expect(pickTryNext(t.service.state, ada.id, new Set(), new Set())?.id).not.toBe("menorah");
  });
});
