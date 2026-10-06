import { COSTUMES, dayOfDate, HOLIDAY_STOCK, type WorldConfig } from "@terrakin/sim";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "./app";
import { pickTryNext } from "./checkin";
import { MemoryMediaStore } from "./media";
import { nodeSql } from "./node-sql";
import { SocialService } from "./social-service";
import { MemoryStore } from "./store";
import { type Cleanup, jsonCaller, listenOnFreePort, responseChecker } from "./test-support";
import { DAY_MS, utcDay, WorldService } from "./world-service";

/**
 * Halloween (RFC 0022) over HTTP: the shop and the world say it's on, a knock at a neighbor's
 * door moves a candy and tells everyone who lives there once a day, the server keeps knocks off a
 * blocked or closed door, and the check-in suggests a costume and a night of trick-or-treating.
 */

// 3x3 plots of 8 tiles; the Commons is plot (1, 1).
const CONFIG: WorldConfig = {
  width: 24,
  height: 24,
  plotSize: 8,
  maxPlotsPerResident: 1,
  reach: 3,
};
const NIGHT = Date.UTC(2026, 9, 31, 12);

const cleanups: Cleanup[] = [];
const { problems, onResponse } = responseChecker();
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
  expect(problems.splice(0)).toEqual([]);
});

// biome-ignore lint/suspicious/noExplicitAny: the response checker already holds every body to its schema.
type Json = Record<string, any>;

async function start(at = NIGHT) {
  let now = at;
  const service = new WorldService({
    store: new MemoryStore(),
    config: CONFIG,
    now: () => now,
    days: true,
    economy: true,
    items: true,
    shop: true,
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
  /** Join, settle plot (px, py), and build a home with a hearth. */
  const settler = async (name: string, px: number, py: number) => {
    const r = join(name);
    await act(r.token, { type: "settle", px, py });
    await act(r.token, { type: "build_starter_home" });
    return r;
  };
  const toDay = (day: number) => {
    while (utcDay(now) < day) {
      now += DAY_MS;
      service.tick();
    }
  };
  return { call, join, act, settler, toDay, service, social };
}

describe("Halloween in the shop and the world", () => {
  it("lists its stock with the holiday and its last day while it runs, and not before or after", async () => {
    const w = await start(Date.UTC(2026, 9, 20, 12));
    const shop = async () => (await w.call("GET", "/v1/shop")).body.shop as Json;
    const world = async () => (await w.call("GET", "/v1/world")).body as Json;
    const before = await shop();
    expect(before.holiday).toBeUndefined();
    expect(before.items.some((i: Json) => i.holiday)).toBe(false);
    expect((await world()).holiday).toBeUndefined();

    w.toDay(dayOfDate(2026, 10, 24));
    const during = await shop();
    const lastDay = dayOfDate(2026, 11, 1);
    expect(during.holiday).toEqual({ id: "halloween", lastDay });
    const stock = during.items.filter((i: Json) => i.holiday);
    expect(stock.map((i: Json) => i.sku).sort()).toEqual([...HOLIDAY_STOCK.halloween].sort());
    for (const item of stock) expect(item).toMatchObject({ holiday: "halloween", lastDay });
    expect(stock.find((i: Json) => i.sku === "witch_hat")).toMatchObject({ slot: "hat" });
    expect((await world()).holiday).toBe("halloween");

    w.toDay(dayOfDate(2026, 11, 2));
    const after = await shop();
    expect(after.holiday).toBeUndefined();
    expect(after.items).toHaveLength(during.items.length - HOLIDAY_STOCK.halloween.length);
    expect((await world()).holiday).toBeUndefined();
  });
});

describe("trick-or-treating over HTTP", () => {
  it("moves a candy, keeps the giver's things private, and tells the door once a day with a count", async () => {
    const w = await start();
    const ivy = await w.settler("Ivy", 0, 0);
    const wren = await w.settler("Wren", 2, 0);
    const ash = await w.settler("Ash", 0, 2);
    // Ivy is home with candy.
    expect((await w.act(ivy.token, { type: "shop_buy", sku: "candy", count: 3 })).ok).toBe(true);

    await w.act(wren.token, { type: "visit", px: 0, py: 0 });
    const knock = await w.act(wren.token, { type: "trick_or_treat", px: 0, py: 0 });
    expect(knock.ok).toBe(true);
    // Wren hears the knock and her own candy, never Ivy's things.
    expect(knock.events).toEqual([
      { type: "trick_or_treated", by: wren.id, px: 0, py: 0, from: "resident", giver: ivy.id },
      {
        type: "inventory",
        residentId: wren.id,
        reason: "trick_or_treat",
        changes: [{ kind: "candy", amount: 1, count: 1 }],
        with: ivy.id,
      },
    ]);
    expect(await w.act(wren.token, { type: "trick_or_treat", px: 0, py: 0 })).toMatchObject({
      ok: false,
      error: { code: "already_knocked" },
    });
    // The door's view says so, for Wren alone, so a reloaded card still reads "Knocked".
    const door = async (token?: string) =>
      (await w.call("GET", "/v1/plots/0/0", undefined, token)).body.plot as Json;
    expect((await door(wren.token)).knockedToday).toBe(true);
    expect((await door(ash.token)).knockedToday).toBe(false);
    expect((await door()).knockedToday).toBeUndefined();
    await w.act(ash.token, { type: "visit", px: 0, py: 0 });
    expect((await w.act(ash.token, { type: "trick_or_treat", px: 0, py: 0 })).ok).toBe(true);

    // One notification for the door, with both trick-or-treaters in it.
    const notes = (await w.call("GET", "/v1/notifications", undefined, ivy.token)).body
      .notifications as Json[];
    const knocks = notes.filter((n) => n.type === "trick_or_treat");
    expect(knocks).toHaveLength(1);
    expect(knocks[0]).toMatchObject({ count: 2, plot: { px: 0, py: 0 }, actor: { id: ash.id } });
    const checkin = (await w.call("GET", "/v1/checkin", undefined, ivy.token)).body as Json;
    expect(checkin.holiday).toBe("halloween");
    expect(checkin.todo).toContain(
      "2 trick-or-treaters came by your door (`trick_or_treat` notifications). Tell your owner.",
    );
  });

  it("refuses a knock across a block either way, and at a suspended owner's door, dry runs too", async () => {
    const w = await start();
    const ivy = await w.settler("Ivy", 0, 0);
    const dot = w.join("Dot");
    await w.act(ivy.token, { type: "share_plot", with: dot.id });
    const wren = await w.settler("Wren", 2, 0);
    await w.act(wren.token, { type: "visit", px: 0, py: 0 });
    const knock = (dry: boolean) =>
      w.act(wren.token, { type: "trick_or_treat", px: 0, py: 0, dry });
    const refused = {
      ok: false,
      error: { code: "forbidden", message: "You can't knock at this door." },
    };
    await w.call("PUT", `/v1/residents/${ivy.id}/block`, undefined, wren.token);
    expect(await knock(false)).toMatchObject(refused);
    expect(await knock(true)).toMatchObject({ ...refused, dry: true });
    await w.call("DELETE", `/v1/residents/${ivy.id}/block`, undefined, wren.token);
    // The plot's co-owner blocks Wren.
    await w.call("PUT", `/v1/residents/${wren.id}/block`, undefined, dot.token);
    expect(await knock(false)).toMatchObject(refused);
    await w.call("DELETE", `/v1/residents/${wren.id}/block`, undefined, dot.token);
    expect(w.social.safety.suspend("staff", ivy.id, 3, "test").ok).toBe(true);
    expect(await knock(false)).toMatchObject({
      ok: false,
      error: { code: "forbidden", message: "That plot is closed for now." },
    });
    expect(w.service.state.knocks).toBeUndefined();
  });
});

describe("Halloween's suggestions", () => {
  it("suggest a costume to someone with none during Halloween, and trick-or-treating on October 31 and November 1", async () => {
    const w = await start(Date.UTC(2026, 9, 23, 12));
    const ivy = await w.settler("Ivy", 0, 0);
    const wren = await w.settler("Wren", 2, 0);
    const pick = (id: string) => pickTryNext(w.service.state, id, new Set(), new Set())?.id ?? null;
    // The day before Halloween: neither.
    expect(pick(wren.id)).not.toBe("costume");
    w.toDay(dayOfDate(2026, 10, 24));
    expect(pick(wren.id)).toBe("costume");
    expect(pickTryNext(w.service.state, wren.id, new Set(), new Set())?.line).toContain(
      "40 to 70 coins",
    );
    expect((await w.act(wren.token, { type: "shop_buy", sku: COSTUMES[1] })).ok).toBe(true);
    expect(pick(wren.id)).not.toBe("costume");
    // October 31: a night to knock on doors, until the first knock.
    w.toDay(dayOfDate(2026, 10, 31));
    expect(pick(wren.id)).toBe("trick_or_treat");
    expect(pick(ivy.id)).toBe("trick_or_treat");
    await w.act(wren.token, { type: "visit", px: 0, py: 0 });
    expect((await w.act(wren.token, { type: "trick_or_treat", px: 0, py: 0 })).ok).toBe(true);
    expect(pick(wren.id)).not.toBe("trick_or_treat");
    // November 1 is a night of its own: tonight's knocks start over.
    w.toDay(dayOfDate(2026, 11, 1));
    expect(pick(wren.id)).toBe("trick_or_treat");
    expect(pickTryNext(w.service.state, wren.id, new Set(), new Set())?.line).toContain(
      "October 31 and November 1, UTC",
    );
    // The day after, it's over.
    w.toDay(dayOfDate(2026, 11, 2));
    expect(pick(ivy.id)).not.toBe("trick_or_treat");
  });
});
