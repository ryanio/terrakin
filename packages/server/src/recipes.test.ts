import type { ServerMessage, WorldEvent } from "@terrakin/protocol";
import {
  BASE_RECIPES,
  CARD_RECIPES,
  dayOfDate,
  HOLIDAY_RECIPES,
  RECIPE_NAMES,
  recipeCardPrice,
  type WorldConfig,
} from "@terrakin/sim";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "./app";
import { MemoryMediaStore } from "./media";
import { nodeSql } from "./node-sql";
import { SocialService } from "./social-service";
import { MemoryStore } from "./store";
import { type Cleanup, jsonCaller, listenOnFreePort, responseChecker } from "./test-support";
import { WorldService } from "./world-service";

/**
 * Recipes you learn (RFC 0024) over HTTP: what `GET /v1/inventory` and `GET /v1/shop` show before
 * and after `open_recipes`, free picks, cards, and the refusal for a recipe you don't know.
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

/** A world with the shop open, on October 5, 2026 (autumn), with recipes learned or not. */
async function start({ recipes = true } = {}) {
  const now = Date.UTC(2026, 9, 5, 9);
  const service = new WorldService({
    store: new MemoryStore(),
    config: CONFIG,
    now: () => now,
    days: true,
    economy: true,
    items: true,
    shop: true,
    recipes,
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
  const act = async (token: string, action: Json) =>
    (await call("POST", "/v1/actions", action, token)).body;
  /** Join, settle a plot, and build a home: the welcome gift and the first allowance. */
  async function settler(name: string, px: number, py: number) {
    const made = service.createSession({ name, kind: "agent" });
    if (!made.ok || !made.residentId || !made.token) throw new Error(`Couldn't join ${name}`);
    await act(made.token, { type: "settle", px, py });
    await act(made.token, { type: "build_starter_home" });
    return { id: made.residentId, token: made.token };
  }
  const listen = (id: string) => {
    const got: ServerMessage[] = [];
    cleanups.push(service.subscribe(id, (m) => got.push(m)));
    return () => got.flatMap((m) => (m.type === "event" ? [m.event] : [])) as WorldEvent[];
  };
  const inventory = async (token: string) =>
    (await call("GET", "/v1/inventory", undefined, token)).body.inventory;
  const shop = async (token?: string) => (await call("GET", "/v1/shop", undefined, token)).body;
  service.tick();
  return { call, act, settler, listen, inventory, shop, service };
}

describe("before recipes are learned", () => {
  it("lists every recipe as known, no picks, and no Recipes shelf", async () => {
    const w = await start({ recipes: false });
    expect(w.service.state.recipes).toBeUndefined();
    const ada = await w.settler("Ada", 0, 0);
    const inv = await w.inventory(ada.token);
    expect(inv.recipes).toEqual([...RECIPE_NAMES].sort());
    expect(inv.recipePicks).toBe(0);
    const { shop } = await w.shop(ada.token);
    expect(shop.recipes).toBeUndefined();
    expect(shop.items.some((i: Json) => i.sku.startsWith("recipe:"))).toBe(false);
  });

  it("sells no cards and has nothing to pick", async () => {
    const w = await start({ recipes: false });
    const ada = await w.settler("Ada", 0, 0);
    const card = await w.act(ada.token, { type: "shop_buy", sku: "recipe:lemonade" });
    expect(card.error.code).toBe("unknown_item");
    const pick = await w.act(ada.token, { type: "pick_recipe", recipe: "lemonade" });
    expect(pick.error.code).toBe("already_known");
  });
});

describe("once recipes are learned", () => {
  it("opens after the shop, from the server's switch", async () => {
    const w = await start();
    expect(w.service.state.shop).toBeDefined();
    expect(w.service.state.recipes).toEqual({
      everything: [],
      learned: {},
      picks: {},
      townsfolkTaught: {},
    });
  });

  it("gives a newcomer the base, the holiday recipes, and 3 picks", async () => {
    const w = await start();
    const ada = await w.settler("Ada", 0, 0);
    const inv = await w.inventory(ada.token);
    expect(inv.recipes).toEqual([...BASE_RECIPES, ...HOLIDAY_RECIPES].sort());
    expect(inv.recipePicks).toBe(3);
  });

  it("shows the Recipes shelf, with what you know once you're signed in", async () => {
    const w = await start();
    const anyone = (await w.shop()).shop;
    // October: every card but winter's hot punch, each with its price and recipe.
    expect(anyone.recipes.map((c: Json) => c.sku).sort()).toEqual(
      CARD_RECIPES.filter((r) => r !== "cranberry_punch")
        .map((r) => `recipe:${r}`)
        .sort(),
    );
    expect(anyone.recipes.find((c: Json) => c.sku === "recipe:lemonade")).toEqual({
      sku: "recipe:lemonade",
      name: "Lemonade recipe",
      price: 20,
      section: "recipes",
      recipe: {
        station: "kitchen",
        makes: "lemonade",
        needs: [
          { kind: "lemon", count: 2 },
          { kind: "sugar", count: 1 },
          { kind: "jar", count: 1 },
        ],
      },
    });
    expect(anyone.recipes.find((c: Json) => c.sku === "recipe:pumpkin_pie")).toMatchObject({
      price: recipeCardPrice("pumpkin_pie"),
      season: "autumn",
      lastDay: dayOfDate(2026, 11, 30),
    });
    // The shelf is its own list: the items list holds only what the shop always sold.
    expect(anyone.items.some((i: Json) => i.sku.startsWith("recipe:"))).toBe(false);
    const ada = await w.settler("Ada", 0, 0);
    expect((await w.act(ada.token, { type: "pick_recipe", recipe: "lemonade" })).ok).toBe(true);
    const mine = (await w.shop(ada.token)).shop.recipes;
    expect(mine.find((c: Json) => c.sku === "recipe:lemonade").known).toBe(true);
    expect(mine.find((c: Json) => c.sku === "recipe:well").known).toBe(false);
    const inv = await w.inventory(ada.token);
    expect(inv.recipes).toContain("lemonade");
    expect(inv.recipePicks).toBe(2);
  });

  it("sells a card privately, and refuses it twice", async () => {
    const w = await start();
    const ada = await w.settler("Ada", 0, 0);
    const bob = await w.settler("Bob", 2, 0);
    const adaHears = w.listen(ada.id);
    const bobHears = w.listen(bob.id);
    const before = (await w.shop(ada.token)).you.balance;
    expect((await w.act(ada.token, { type: "shop_buy", sku: "recipe:well" })).ok).toBe(true);
    expect((await w.shop(ada.token)).you.balance).toBe(before - 35);
    expect(adaHears()).toContainEqual({
      type: "recipe_learned",
      residentId: ada.id,
      recipe: "well",
      how: "bought",
      price: 35,
    });
    expect(bobHears().some((e) => e.type === "recipe_learned" || e.type === "coins")).toBe(false);
    const again = await w.act(ada.token, { type: "shop_buy", sku: "recipe:well" });
    expect(again.error.code).toBe("already_known");
    expect((await w.shop(ada.token)).you.balance).toBe(before - 35);
  });

  it("refuses a craft you don't know, naming the card's price and sku", async () => {
    const w = await start();
    const ada = await w.settler("Ada", 0, 0);
    expect((await w.act(ada.token, { type: "place", x: 4, y: 3, block: "workbench" })).ok).toBe(
      true,
    );
    const inv = w.service.state.items?.inventories[ada.id];
    if (!inv) throw new Error("no inventory");
    inv.stacks.wood = 3;
    const refused = await w.act(ada.token, { type: "craft", recipe: "barrel", x: 4, y: 3 });
    expect(refused.error.code).toBe("recipe_unknown");
    expect(refused.error.message).toContain("shop_buy with sku recipe:barrel");
    expect(refused.error.message).toContain("20 coins");
    expect(inv.stacks.wood).toBe(3);
    // The table is in the base, so the same wood makes one.
    expect((await w.act(ada.token, { type: "craft", recipe: "table", x: 4, y: 3 })).ok).toBe(true);
  });
});
