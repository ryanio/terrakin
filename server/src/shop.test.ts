import type { ServerMessage, WorldEvent } from "@terrakin/protocol";
import { BUY_ORDERS, ITEMS, townBuys, type WorldConfig } from "@terrakin/sim";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "./app";
import { MemoryMediaStore } from "./media";
import { nodeSql } from "./node-sql";
import { SocialService } from "./social-service";
import { MemoryStore } from "./store";
import { type Cleanup, jsonCaller, listenOnFreePort, responseChecker } from "./test-support";
import { DAY_MS, utcDay, WorldService } from "./world-service";

/**
 * The town shop (RFC 0008, phase 2) end to end over HTTP: it opens on its own once coins and items
 * are open, the catalog and today's buying are public, purchases stay private, and Clem keeps it.
 */

// 3x3 plots of 8 tiles. Settling plot (0, 0) and building the starter home leaves you on the
// hearth at (3, 3), inside a hut from (1, 1) to (5, 5).
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

async function start({ shop = true } = {}) {
  let now = Date.UTC(2026, 9, 5, 9);
  const service = new WorldService({
    store: new MemoryStore(),
    config: CONFIG,
    now: () => now,
    days: true,
    economy: true,
    items: true,
    shop,
  });
  const sql = nodeSql();
  const social = new SocialService({
    sql,
    media: new MemoryMediaStore(),
    resident: (id: string) => service.state.residents[id],
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
  cleanups.push(() => sql.close());
  const call = jsonCaller(await listenOnFreePort(server, cleanups));
  function join(name: string) {
    const made = service.createSession({ name, kind: "agent" });
    if (!made.ok || !made.residentId || !made.token) throw new Error(`Couldn't join ${name}`);
    return { id: made.residentId, token: made.token };
  }
  const act = async (token: string, action: Json) =>
    (await call("POST", "/v1/actions", action, token)).body;
  const listen = (id: string) => {
    const got: ServerMessage[] = [];
    cleanups.push(service.subscribe(id, (m) => got.push(m)));
    return () => got.flatMap((m) => (m.type === "event" ? [m.event] : [])) as WorldEvent[];
  };
  /** Join, settle a plot, and build a home: the welcome gift and the first allowance. */
  async function settler(name: string, px: number, py: number) {
    const r = join(name);
    await act(r.token, { type: "settle", px, py });
    await act(r.token, { type: "build_starter_home" });
    return r;
  }
  const nextDay = () => {
    now += DAY_MS;
    service.tick();
  };
  const today = () => utcDay(now);
  return { call, join, act, listen, settler, nextDay, today, service, social };
}

describe("the town shop", () => {
  it("opens on its own once coins and items are open, and shows its catalog to anyone", async () => {
    const w = await start();
    w.service.tick();
    expect(w.service.state.shop).toBeDefined();
    const { status, body } = await w.call("GET", "/v1/shop");
    expect(status).toBe(200);
    expect(body.you).toBeNull();
    expect(body.shop.day).toBe(w.today());
    expect(body.shop.items.find((i: Json) => i.sku === "lantern")).toEqual({
      sku: "lantern",
      name: "Paper lantern",
      price: 40,
      section: "decor",
    });
    expect(body.shop.items.find((i: Json) => i.sku === "top_hat")).toMatchObject({
      section: "wear",
      slot: "hat",
    });
    expect(body.shop.buying.map((b: Json) => b.kind)).toEqual(townBuys(w.today()));
    // Without a token there's no `left`: what you sold is yours.
    for (const b of body.shop.buying) expect(b.left).toBeUndefined();
    expect(body.shop.tiles).toHaveLength(6);
    // The world and the Town Hall show it too.
    expect((await w.call("GET", "/v1/world")).body.shop).toEqual(body.shop.tiles);
    const town = (await w.call("GET", "/v1/town")).body;
    expect(town.shop.tiles).toEqual(body.shop.tiles);
    expect(town.shop.buying.map((b: Json) => b.kind)).toEqual(townBuys(w.today()));
  });

  it("stays shut where the adapter leaves it off", async () => {
    const w = await start({ shop: false });
    w.service.tick();
    const { body } = await w.call("GET", "/v1/shop");
    expect(body.shop).toBeNull();
    expect((await w.call("GET", "/v1/town")).body.shop).toBeNull();
    const ada = await w.settler("Ada", 0, 0);
    const res = await w.act(ada.token, { type: "shop_buy", sku: "fence" });
    expect(res.error.code).toBe("shop_closed");
  });

  it("sells to a resident, privately, and shows them their purse and wear", async () => {
    const w = await start();
    const ada = await w.settler("Ada", 0, 0);
    const bob = await w.settler("Bob", 2, 0);
    const adaHears = w.listen(ada.id);
    const bobHears = w.listen(bob.id);
    const before = (await w.call("GET", "/v1/shop", undefined, ada.token)).body.you.balance;
    const bought = await w.act(ada.token, { type: "shop_buy", sku: "umbrella" });
    expect(bought.ok).toBe(true);
    const mine = (await w.call("GET", "/v1/shop", undefined, ada.token)).body;
    expect(mine.you).toEqual({ balance: before - 60, wardrobe: ["umbrella"] });
    // Ada hears her purse and her new wear; Bob hears neither, only the treasury's half.
    expect(adaHears().map((e) => e.type)).toEqual(
      expect.arrayContaining(["coins", "treasury", "wear_bought"]),
    );
    const bobGot = bobHears();
    expect(bobGot.some((e) => e.type === "coins" || e.type === "wear_bought")).toBe(false);
    expect(bobGot).toContainEqual(
      expect.objectContaining({ type: "treasury", amount: 30, reason: "shop" }),
    );
    expect(JSON.stringify(bobGot)).not.toContain(ada.id);
    // Wearing it is the profile action; Bob hasn't bought one.
    expect((await w.act(ada.token, { type: "profile", wear: ["umbrella"] })).ok).toBe(true);
    const refused = await w.act(bob.token, { type: "profile", wear: ["umbrella"] });
    expect(refused.error.code).toBe("not_owned");
  });

  it("buys from residents what the town wants today, counting down what's left", async () => {
    const w = await start();
    const ada = await w.settler("Ada", 0, 0);
    // Wait for a day the town buys herbs, and hand Ada some.
    for (let i = 0; i < 6 && !townBuys(w.today()).includes("herb"); i++) w.nextDay();
    const inv = w.service.state.items?.inventories[ada.id];
    if (!inv) throw new Error("no inventory");
    inv.stacks.herb = 5;
    const sold = await w.act(ada.token, { type: "sell_to_town", item: "herb", count: 2 });
    expect(sold.ok).toBe(true);
    const shop = (await w.call("GET", "/v1/shop", undefined, ada.token)).body.shop;
    const herb = shop.buying.find((b: Json) => b.kind === "herb");
    expect(herb).toEqual({
      kind: "herb",
      name: "Bunches of herbs",
      price: BUY_ORDERS.herb.price,
      perDay: BUY_ORDERS.herb.perDay,
      left: BUY_ORDERS.herb.perDay - 2,
    });
    const over = await w.act(ada.token, { type: "sell_to_town", item: "herb", count: 2 });
    expect(over.error.code).toBe("sell_limit");
    // A dry run says what would happen and changes nothing.
    const dry = await w.act(ada.token, { type: "sell_to_town", item: "herb", dry: true });
    expect(dry.ok).toBe(true);
    expect(w.service.state.items?.inventories[ada.id]?.stacks.herb).toBe(3);
  });

  it("names Clem as the shopkeeper while Clem is townsfolk", async () => {
    const w = await start();
    const clem = w.join("Clem");
    w.service.tick();
    expect((await w.call("PUT", "/v1/profile", { handle: "clem" }, clem.token)).status).toBe(200);
    // Holding the handle isn't enough: the keeper is townsfolk.
    expect((await w.call("GET", "/v1/shop")).body.shop.keeper).toBeNull();
    w.service.syncTownsfolk(new Set([clem.id]));
    const keeper = (await w.call("GET", "/v1/shop")).body.shop.keeper;
    expect(keeper).toMatchObject({ id: clem.id, name: "Clem", handle: "clem" });
    // Townsfolk keep the shop; they don't shop in it.
    const refused = await w.act(clem.token, { type: "shop_buy", sku: "fence" });
    expect(refused.error.code).toBe("not_eligible");
  });

  it("gives the smaller pantry once the shop is open", async () => {
    const w = await start();
    const ada = await w.settler("Ada", 0, 0);
    const inv = (await w.call("GET", "/v1/inventory", undefined, ada.token)).body;
    expect(inv.rules.pantrySugar).toBe(ITEMS.shopPantry.sugar);
    expect(inv.rules.pantryJars).toBe(ITEMS.shopPantry.jar);
    expect(inv.rules.stapleMax).toBe(ITEMS.shopStapleMax);
  });
});
