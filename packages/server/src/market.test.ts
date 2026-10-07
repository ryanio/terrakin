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
  const maintainers = new Set<string>();
  const social = new SocialService({
    sql,
    media: new MemoryMediaStore(),
    resident: (id: string) => service.state.residents[id],
    now: () => now,
    residentAgeDays: (id) => service.residentAgeDays(id),
    maintainers,
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
  /** A maintainer, who works the staff routes with their token (no Access on this server). */
  function staff() {
    const made = service.createSession({ name: "Marlo", kind: "human" });
    if (!made.ok || !made.residentId || !made.token) throw new Error("Couldn't join Marlo");
    maintainers.add(made.residentId);
    return { id: made.residentId, token: made.token };
  }
  /** A made thing straight into someone's things, as crafting would. */
  function make(id: string, label: string) {
    const items = service.state.items;
    if (!items) throw new Error("items closed");
    const good = {
      id: `i_${items.nextId++}`,
      kind: "lemon_jam" as const,
      maker: id,
      madeDay: 1,
      label,
    };
    items.inventories[id]?.goods.push(good);
    return good;
  }
  return {
    call,
    act,
    settler,
    listen,
    days,
    staff,
    make,
    service,
    social,
    sql,
    now: () => now,
  };
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
    // A dry run meets the same check.
    expect(await t.act(ada.token, { ...sugar, dry: true })).toMatchObject({
      ok: false,
      dry: true,
      error: { code: "not_eligible" },
    });
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

  it("pages past 200 listings with `before`, newest first or cheapest first", async () => {
    const t = await start();
    const ada = await t.settler("Ada", 0, 0);
    const market = t.service.state.market;
    if (!market) throw new Error("market closed");
    // More listings than one page holds, straight into the market for the test.
    for (let n = 1; n <= 205; n++) {
      market.listings[`l_${n}`] = {
        id: `l_${n}`,
        seller: ada.id,
        kind: "sugar",
        count: 1 + (n % 2),
        price: 1 + (n % 7),
        day: 1,
      };
    }
    market.nextId = 206;
    const page = async (q: string) => (await t.call("GET", `/v1/market?${q}`)).body;

    const first = await page("");
    expect(first.market.listings).toHaveLength(200);
    expect(first.market.listings[0].id).toBe("l_205");
    expect(first.market.next).toBe("l_6");
    const second = await page("before=l_6");
    expect(second.market.listings.map((l: Json) => l.id)).toEqual([
      "l_5",
      "l_4",
      "l_3",
      "l_2",
      "l_1",
    ]);
    expect(second.market.next).toBeNull();
    // The cursor's own listing selling in between doesn't lose the place.
    delete market.listings.l_6;
    expect((await page("before=l_6")).market.listings).toHaveLength(5);

    const cheap = await page("sort=cheapest");
    expect(cheap.market.next).not.toBeNull();
    const rest = await page(`sort=cheapest&before=${cheap.market.next}`);
    expect(rest.market.next).toBeNull();
    const all: Json[] = [...cheap.market.listings, ...rest.market.listings];
    expect(new Set(all.map((l) => l.id)).size).toBe(204);
    const each = all.map((l) => l.price / l.count);
    expect(each).toEqual([...each].sort((a, b) => a - b));

    // Cheapest order can't place a listing that has gone, so it says to start again.
    delete market.listings[cheap.market.next];
    const gone = await t.call("GET", `/v1/market?sort=cheapest&before=${cheap.market.next}`);
    expect(gone.status).toBe(400);
    expect(gone.body.error.code).toBe("bad_request");
    expect((await t.call("GET", "/v1/market?before=nope")).status).toBe(400);
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

describe("taking a listing down", () => {
  it("lets residents report a listing, and staff take it down from the queue", async () => {
    const t = await start();
    const ada = await t.settler("Ada", 0, 0);
    const bob = await t.settler("Bob", 2, 0);
    const marlo = t.staff();
    t.days(3);
    const jam = t.make(ada.id, "Rude words");
    await t.act(ada.token, { type: "list_item", item: jam.id, price: 12 });

    // Bob reports it, once. Ada can't report her own, and nobody can report one that isn't there.
    const report = { kind: "listing", id: "l_1", reason: "hate", note: "The label" };
    expect((await t.call("POST", "/v1/reports", report, bob.token)).status).toBe(201);
    expect((await t.call("POST", "/v1/reports", report, ada.token)).status).toBe(400);
    const missing = { ...report, id: "l_9" };
    expect((await t.call("POST", "/v1/reports", missing, bob.token)).status).toBe(404);

    // It reaches the review queue like any report, with the lot, its label, and its seller.
    const queue = (await t.call("GET", "/v1/admin/reports", undefined, marlo.token)).body;
    expect(queue.items).toEqual([
      expect.objectContaining({
        kind: "listing",
        id: "l_1",
        target: expect.objectContaining({
          exists: true,
          trust: "untrusted",
          text: "Lemon jam for 12 coins\nRude words",
          author: expect.objectContaining({ id: ada.id }),
        }),
      }),
    ]);

    // Only staff may take it down.
    const why = { reason: "Slur in the label" };
    const path = "/v1/admin/listings/l_1/remove";
    expect((await t.call("POST", path, why)).status).toBe(401);
    expect((await t.call("POST", path, why, bob.token)).status).toBe(403);
    expect((await t.call("POST", path, why, ada.token)).status).toBe(403);
    expect(t.service.state.market?.listings.l_1).toBeDefined();

    const adaHeard = t.listen(ada.id);
    const bobHeard = t.listen(bob.id);
    const coins = t.service.state.economy?.coins[ada.id];
    const done = await t.call("POST", path, why, marlo.token);
    expect(done.status).toBe(200);
    expect(done.body.logged).toMatchObject({
      action: "remove_listing",
      kind: "listing",
      id: "l_1",
      reason: "Slur in the label",
    });
    // The lot is back with Ada, the fee stays spent, and she hears both; Bob only that it went.
    expect(t.service.state.items?.inventories[ada.id]?.goods).toContainEqual(jam);
    expect(t.service.state.economy?.coins[ada.id]).toBe(coins);
    const heard = adaHeard();
    expect(heard).toHaveLength(2);
    expect(heard).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "inventory", residentId: ada.id, reason: "taken_down" }),
        { type: "listing_removed", listing: "l_1", seller: ada.id },
      ]),
    );
    expect(bobHeard()).toEqual([{ type: "listing_removed", listing: "l_1", seller: ada.id }]);
    expect((await t.call("GET", "/v1/market")).body.market.listings).toEqual([]);

    // The report closed, the log has it, and it counts against Ada's karma like any upheld report.
    expect((await t.call("GET", "/v1/admin/reports", undefined, marlo.token)).body.items).toEqual(
      [],
    );
    const log = (await t.call("GET", "/v1/admin/log", undefined, marlo.token)).body.entries;
    expect(log[0]).toMatchObject({ action: "remove_listing", id: "l_1", actor: marlo.id });
    expect(t.social.safety.upheldAgainst(0, t.now() + 1)).toEqual([ada.id]);
    expect((await t.call("GET", "/v1/transparency")).body.actions.remove_listing).toBe(1);
    // Twice is not found.
    expect((await t.call("POST", path, why, marlo.token)).status).toBe(404);
  });

  it("holds the lot for a seller whose things are full, and the check-in says so", async () => {
    const t = await start();
    const ada = await t.settler("Ada", 0, 0);
    const marlo = t.staff();
    t.days(3);
    await t.act(ada.token, { type: "list_item", item: "jar", price: 3 });
    const inv = t.service.state.items?.inventories[ada.id];
    if (!inv) throw new Error("no things");
    const size = (inv.stacks.herb ?? 0) + 200;
    inv.stacks.herb = size;
    // Over the cap now, as far as the sim can tell: no room for the jar.
    const done = await t.call(
      "POST",
      "/v1/admin/listings/l_1/remove",
      { reason: "Spam" },
      marlo.token,
    );
    expect(done.status).toBe(200);
    expect(inv.stacks.herb).toBe(size);
    expect((await t.call("GET", "/v1/market")).body.market.listings).toEqual([]);
    const mine = (await t.call("GET", "/v1/market", undefined, ada.token)).body.you;
    expect(mine.listings).toBe(0);
    expect(mine.takenDown).toEqual([expect.objectContaining({ id: "l_1", kind: "jar" })]);
    expect((await t.call("GET", "/v1/market")).body.you).toBeNull();
    const checkin = (await t.call("GET", "/v1/checkin", undefined, ada.token)).body;
    expect(checkin.todo.join(" ")).toContain('{"type": "unlist_item", "listing": "l_1"}');
    // Made room, Ada takes it back, and the check-in lets it go.
    inv.stacks.herb = 1;
    expect(await t.act(ada.token, { type: "unlist_item", listing: "l_1" })).toMatchObject({
      ok: true,
    });
    expect((await t.call("GET", "/v1/market", undefined, ada.token)).body.you.takenDown).toBe(
      undefined,
    );
    const after = (await t.call("GET", "/v1/checkin", undefined, ada.token)).body;
    expect(after.todo.join(" ")).not.toContain("unlist_item");
  });
});
