import type { ServerMessage, WorldEvent } from "@terrakin/protocol";
import { marketFee, type WorldConfig } from "@terrakin/sim";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "./app";
import { MemoryMediaStore } from "./media";
import { nodeSql } from "./node-sql";
import { SocialService } from "./social-service";
import { MemoryStore } from "./store";
import { type Cleanup, jsonCaller, listenOnFreePort, responseChecker } from "./test-support";
import { DAY_MS, WorldService } from "./world-service";

/**
 * The market (RFC 0008, phase 4) end to end over HTTP: it opens after the shop, listing waits for
 * a resident's fourth day, listings are public, purses stay private, and blocks keep two
 * residents from trading.
 */

const CONFIG: WorldConfig = {
  width: 24,
  height: 24,
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

async function start() {
  let now = Date.UTC(2026, 9, 5, 9);
  const service = new WorldService({
    store: new MemoryStore(),
    config: CONFIG,
    now: () => now,
    days: true,
    economy: true,
    items: true,
    shop: true,
    market: true,
  });
  const sql = nodeSql();
  const social = new SocialService({
    sql,
    media: new MemoryMediaStore(),
    resident: (id: string) => service.state.residents[id],
    now: () => now,
    residentAgeDays: (id) => service.residentAgeDays(id),
  });
  const server = createApp({
    service,
    social,
    media: new MemoryMediaStore(),
    actionsPerSecond: 1000,
    sessionsPerMinute: 1000,
    onResponse,
  });
  cleanups.push(() => sql.close());
  const call = jsonCaller(await listenOnFreePort(server, cleanups));
  const act = async (token: string, action: Json) =>
    (await call("POST", "/v1/actions", action, token)).body;
  /** Join, settle a plot, and build a home, which brings the first pantry: sugar and jars. */
  async function settler(name: string, px: number, py: number) {
    const made = service.createSession({ name, kind: "agent" });
    if (!made.ok || !made.residentId || !made.token) throw new Error(`Couldn't join ${name}`);
    const r = { id: made.residentId, token: made.token };
    await act(r.token, { type: "settle", px, py });
    await act(r.token, { type: "build_starter_home" });
    return r;
  }
  const listen = (id: string) => {
    const got: ServerMessage[] = [];
    cleanups.push(service.subscribe(id, (m) => got.push(m)));
    return () => got.flatMap((m) => (m.type === "event" ? [m.event] : [])) as WorldEvent[];
  };
  const days = (n: number) => {
    now += n * DAY_MS;
    service.tick();
  };
  return { call, act, settler, listen, days, service, social, sql, now: () => now };
}

describe("the market", () => {
  it("opens once the shop has, and lists nothing at first", async () => {
    const t = await start();
    expect(t.service.state.market).toEqual({ nextId: 1, listings: {} });
    const res = await t.call("GET", "/v1/market");
    expect(res.body).toMatchObject({ market: { listings: [] }, you: null });
    expect(res.body.rules).toMatchObject({ listingFee: 1, feePercent: 5, minAgeDays: 3 });
  });

  it("lets a resident list from their fourth day, and shows the listing to everyone", async () => {
    const t = await start();
    const ada = await t.settler("Ada", 0, 0);
    const sugar = { type: "list_item", item: "sugar", count: 1, price: 5 };
    const early = await t.act(ada.token, sugar);
    expect(early).toMatchObject({ ok: false, error: { code: "not_eligible" } });
    expect(early.error.message).toContain("fourth day");
    const mine = (await t.call("GET", "/v1/market", undefined, ada.token)).body.you;
    expect(mine).toMatchObject({ canList: false, listings: 0 });
    t.days(3);
    expect((await t.call("GET", "/v1/market", undefined, ada.token)).body.you).toMatchObject({
      canList: true,
    });
    expect(await t.act(ada.token, sugar)).toMatchObject({ ok: true });
    const listings = (await t.call("GET", "/v1/market")).body.market.listings;
    expect(listings).toEqual([
      expect.objectContaining({
        id: "l_1",
        seller: expect.objectContaining({ id: ada.id, name: "Ada" }),
        kind: "sugar",
        name: "Bag of sugar",
        count: 1,
        price: 5,
        trust: "untrusted",
      }),
    ]);
    const stall = (await t.call("GET", `/v1/market?seller=${ada.id}`)).body.market.listings;
    expect(stall).toHaveLength(1);
    expect((await t.call("GET", "/v1/market?kind=jar")).body.market.listings).toEqual([]);
  });

  it("pays the seller less the fee, keeps purses private, and says who sold but not who bought", async () => {
    const t = await start();
    const ada = await t.settler("Ada", 0, 0);
    const bob = await t.settler("Bob", 2, 0);
    t.days(3);
    await t.act(ada.token, { type: "list_item", item: "jar", count: 1, price: 20 });
    const adaHeard = t.listen(ada.id);
    const bobHeard = t.listen(bob.id);
    const before = t.service.state.economy?.coins[ada.id] ?? 0;
    const bought = await t.act(bob.token, { type: "buy_listing", listing: "l_1" });
    expect(bought.ok).toBe(true);
    expect(t.service.state.economy?.coins[ada.id]).toBe(before + 20 - marketFee(20));
    // Each side hears only its own coins (Bob's buy also collects his allowance at home).
    const owners = (events: WorldEvent[]) => [
      ...new Set(events.flatMap((e) => (e.type === "coins" ? [e.residentId] : []))),
    ];
    expect(owners(bought.events)).toEqual([bob.id]);
    expect(owners(adaHeard())).toEqual([ada.id]);
    expect(owners(bobHeard())).toEqual([bob.id]);
    const sold = adaHeard().find((e) => e.type === "listing_sold");
    expect(sold).toEqual({
      type: "listing_sold",
      listing: "l_1",
      seller: ada.id,
      kind: "jar",
      count: 1,
      price: 20,
    });
    expect(JSON.stringify(sold)).not.toContain(bob.id);
    expect((await t.call("GET", "/v1/market")).body.market.listings).toEqual([]);
  });

  it("refuses trades across a block and hides a blocked seller's stall", async () => {
    const t = await start();
    const ada = await t.settler("Ada", 0, 0);
    const bob = await t.settler("Bob", 2, 0);
    t.days(3);
    await t.act(ada.token, { type: "list_item", item: "sugar", count: 1, price: 5 });
    const blocked = await t.call("PUT", `/v1/residents/${ada.id}/block`, undefined, bob.token);
    expect(blocked.status).toBeLessThan(300);
    expect(await t.act(bob.token, { type: "buy_listing", listing: "l_1" })).toMatchObject({
      ok: false,
      error: { code: "forbidden" },
    });
    expect((await t.call("GET", "/v1/market", undefined, bob.token)).body.market.listings).toEqual(
      [],
    );
    expect((await t.call("GET", "/v1/market")).body.market.listings).toHaveLength(1);
  });

  it("marks a made thing's label as its maker's words on the live socket", async () => {
    const t = await start();
    const ada = await t.settler("Ada", 0, 0);
    const bob = await t.settler("Bob", 2, 0);
    t.days(3);
    const items = t.service.state.items;
    if (!items) throw new Error("items closed");
    // A jar of jam Ada made earlier, straight into her things for the test.
    items.inventories[ada.id]?.goods.push({
      id: `i_${items.nextId++}`,
      kind: "lemon_jam",
      maker: ada.id,
      madeDay: 1,
      label: "Sunny",
    });
    const heard = t.listen(bob.id);
    await t.act(ada.token, { type: "list_item", item: "lemon_jam", price: 12 });
    expect(heard().find((e) => e.type === "listed")).toMatchObject({
      type: "listed",
      trust: "untrusted",
      listing: { goods: [expect.objectContaining({ label: "Sunny" })] },
    });
    const listing = (await t.call("GET", "/v1/market")).body.market.listings[0];
    expect(listing.goods[0]).toMatchObject({ label: "Sunny", maker: { id: ada.id } });
  });
  it("refuses a dry run too before a resident's fourth day", async () => {
    const t = await start();
    const ada = await t.settler("Ada", 0, 0);
    expect(
      await t.act(ada.token, { type: "list_item", item: "jar", price: 3, dry: true }),
    ).toMatchObject({ ok: false, dry: true, error: { code: "not_eligible" } });
  });

  it("closes a suspended seller's stall: hidden, and not for sale", async () => {
    const t = await start();
    const ada = await t.settler("Ada", 0, 0);
    const bob = await t.settler("Bob", 2, 0);
    t.days(3);
    await t.act(ada.token, { type: "list_item", item: "jar", price: 3 });
    t.sql.exec(
      "INSERT INTO suspensions (resident_id, until, reason, by, at) VALUES (?, ?, 'scam', 'staff', 0)",
      ada.id,
      t.now() + 7 * DAY_MS,
    );
    expect((await t.call("GET", "/v1/market")).body.market.listings).toEqual([]);
    expect(await t.act(bob.token, { type: "buy_listing", listing: "l_1" })).toMatchObject({
      ok: false,
      error: { code: "forbidden" },
    });
  });

  it("keeps the buyer off the seller's purse line", async () => {
    const t = await start();
    const ada = await t.settler("Ada", 0, 0);
    const bob = await t.settler("Bob", 2, 0);
    t.days(3);
    await t.act(ada.token, { type: "list_item", item: "jar", price: 9 });
    await t.act(bob.token, { type: "buy_listing", listing: "l_1" });
    const purse = (await t.call("GET", "/v1/purse", undefined, ada.token)).body.purse;
    const sale = purse.ledger.find((l: Json) => l.reason === "market_sale");
    expect(sale).toBeDefined();
    expect(sale.with).toBeUndefined();
    expect(JSON.stringify(purse)).not.toContain(bob.id);
  });
});
