import { readFileSync } from "node:fs";
import { DAY_MS, type Input, PLOTS, plotKey, TOWN_ACTOR } from "@terrakin/sim";
import { afterEach, describe, expect, it } from "vitest";
import {
  PLOT_MARKET_CONFIG,
  PLOT_MARKET_DAY,
  PLOT_MARKET_SETUP,
} from "../../sim/src/fixtures/plot-market-log";
import { createApp, TEST_OPEN_PLOT_MARKET_PATH } from "./app";
import { MemoryMediaStore } from "./media";
import { nodeSql } from "./node-sql";
import { SocialService } from "./social-service";
import { MemoryStore } from "./store";
import { type Cleanup, jsonCaller, listenOnFreePort, responseChecker } from "./test-support";
import { WorldService, type WorldServiceOptions } from "./world-service";

/**
 * Plots for sale on the API (RFC 0039), started from a world log the way terrakin.org's world
 * boots: the sim's own fixture, where the plot market is open, Ada has had her plot for two weeks
 * with Eve sharing it, Bob has coins and no plot, and Dee lives on the island.
 * Nothing at terrakin.org sends `open_plot_market` yet, so a log is the only way to a world with
 * the market open.
 */

const cleanups: Cleanup[] = [];
const { problems, onResponse } = responseChecker();
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
  expect(problems.splice(0)).toEqual([]);
});

// biome-ignore lint/suspicious/noExplicitAny: the response checker already holds every body to its schema.
type Json = Record<string, any>;

async function start(
  log: Input[] = PLOT_MARKET_SETUP,
  options: Partial<WorldServiceOptions> = {},
  testClock = false,
) {
  const store = new MemoryStore();
  for (const input of log) store.appendInput(input);
  const service = new WorldService({ store, config: PLOT_MARKET_CONFIG, ...options });
  const sql = nodeSql();
  const maintainers = new Set<string>();
  const social = new SocialService({
    sql,
    media: new MemoryMediaStore(),
    resident: (id: string) => service.state.residents[id],
    maintainers,
  });
  const server = createApp({
    service,
    social,
    media: new MemoryMediaStore(),
    actionsPerSecond: 1000,
    sessionsPerMinute: 1000,
    onResponse,
    ...(testClock ? { testClock: { advanceDay: () => service.state.day ?? null } } : {}),
  });
  cleanups.push(() => sql.close());
  const call = jsonCaller(await listenOnFreePort(server, cleanups));
  const token = (id: string) => service.issueToken(id);
  const act = async (who: string, action: Json) =>
    (await call("POST", "/v1/actions", action, who)).body;
  /** A maintainer, who works the staff routes with their token (no Access on this server). */
  function staff() {
    const made = service.createSession({ name: "Marlo", kind: "human" });
    if (!made.ok || !made.residentId || !made.token) throw new Error("Couldn't join Marlo");
    maintainers.add(made.residentId);
    return made.token;
  }
  return { call, act, token, staff, service, sql, store };
}

const coins = (t: { service: WorldService }, id: string) => t.service.state.economy?.coins[id];

/** The fixture's world on the day Ada may list, with everything open but the plot market. */
const UNOPENED = PLOT_MARKET_SETUP.filter((i) => i.command.type !== "open_plot_market");

describe("the switch that puts plots on sale", () => {
  it("has no test route in the Worker, and once set logs the market with the cap of 3, once", async () => {
    // No adapter sets plotMarket (world-switches.test.ts).
    const worker = readFileSync(new URL("../cloudflare/worker.ts", import.meta.url), "utf8");
    expect(worker).not.toMatch(/open-plot-market|testOpenPlotMarket|open_plot_market/);
    const now = () => (PLOT_MARKET_DAY + 14) * DAY_MS;
    const opened = async (plotMarket: boolean) => {
      const t = await start(UNOPENED, { days: true, now, plotMarket });
      t.service.tick();
      t.service.tick();
      return t.store.log.filter((i) => i.command.type === "open_plot_market");
    };
    expect(await opened(false)).toEqual([]);
    expect(await opened(true)).toEqual([
      {
        actor: TOWN_ACTOR,
        command: { type: "open_plot_market", maxPlotsPerResident: PLOTS.capMax },
      },
    ]);
  });

  it("opens on a test world's route, raising the cap the snapshot carries", async () => {
    const t = await start(UNOPENED, {}, true);
    expect((await t.call("GET", "/v1/world")).body.config.maxPlotsPerResident).toBe(1);
    const open = await t.call("POST", TEST_OPEN_PLOT_MARKET_PATH);
    expect(open).toMatchObject({ status: 200, body: { ok: true } });
    const world = (await t.call("GET", "/v1/world")).body;
    expect(world.plotMarketOpen).toBe(true);
    expect(world.config.maxPlotsPerResident).toBe(PLOTS.capMax);
    const again = await t.call("POST", TEST_OPEN_PLOT_MARKET_PATH);
    expect(again).toMatchObject({ status: 400, body: { error: { code: "already_open" } } });
  });
});

describe("plots for sale on the API (RFC 0039)", () => {
  it("is absent from a world that never opened it, and the actions are refused", async () => {
    const t = await start([]);
    const market = await t.call("GET", "/v1/plot-market");
    expect(market.body).toEqual({
      plotMarket: null,
      you: null,
      rules: { listingFee: 25, settleDays: 14, priceMax: 100_000, feePercent: 5 },
    });
    expect((await t.call("GET", "/v1/world")).body).not.toHaveProperty("plotMarketOpen");
    const made = t.service.createSession({ name: "Wren", kind: "agent" });
    if (!made.ok || !made.token) throw new Error("Couldn't join Wren");
    const buy = await t.act(made.token, { type: "buy_plot", px: 0, py: 0, price: 300, dry: true });
    expect(buy.error.code).toBe("market_closed");
  });

  it("says who can list what, with the sim's own reasons", async () => {
    const t = await start();
    expect((await t.call("GET", "/v1/world")).body.plotMarketOpen).toBe(true);
    const read = async (id: string) =>
      (await t.call("GET", "/v1/plot-market", undefined, t.token(id))).body;

    const ada = await read("ada");
    expect(ada.plotMarket).toEqual({ listings: [] });
    expect(ada.you).toEqual({
      balance: coins(t, "ada"),
      listings: [],
      canList: true,
      plots: [{ px: 0, py: 0, canList: true, listed: false }],
    });
    // No plot, and an island plot: each says why in the world's words.
    expect((await read("bob")).you).toMatchObject({
      canList: false,
      why: "You don't own a plot to sell.",
      plots: [],
    });
    const dee = (await read("dee")).you;
    expect(dee.canList).toBe(false);
    expect(dee.plots[0].why).toMatch(/^Only downtown plots are for sale/);
  });

  it("prices a listing and a sale before anything moves, then sells the plot as it stands", async () => {
    const t = await start();
    const ada = t.token("ada");
    const bob = t.token("bob");
    // Today's allowance first, so it can't land in the middle of what the sale moves.
    await t.act(ada, { type: "home" });
    const adaHad = coins(t, "ada") ?? 0;
    const seq = t.service.state.seq;

    // A dry listing says what it costs, what a sale would bring, and that it clears her hearth.
    const dryList = await t.act(ada, { type: "list_plot", px: 0, py: 0, price: 300, dry: true });
    expect(dryList).toMatchObject({ ok: true, dry: true });
    expect(dryList.plotSale).toMatchObject({
      price: 300,
      fee: 15,
      sellerGets: 285,
      listingFee: PLOTS.listingFee,
      balanceAfter: adaHad - PLOTS.listingFee,
      clearsHearth: true,
    });
    expect(dryList.plotSale.note).toMatch(/Your hearth there is cleared/);
    // And that Eve, who shares it, loses her share and hears it.
    expect(dryList.plotSale.shared).toBe(1);
    expect(dryList.plotSale.note).toMatch(
      /The resident you share it with loses their share\. They're told/,
    );
    expect(t.service.state.seq).toBe(seq);

    // One of her walls fine (RFC 0051), as a graded build leaves it, for the listing to count.
    const size = PLOT_MARKET_CONFIG.plotSize;
    const wall = Object.keys(t.service.state.blocks).find((key) =>
      key.split(",").every((n) => Number(n) < size),
    );
    t.service.state.grades = { [wall as string]: "fine" };
    // And a door on a line between tiles (RFC 0050), which a home of such walls is mostly made of.
    t.service.state.edges = { "2,6,n": "door" };

    const listed = await t.act(ada, { type: "list_plot", px: 0, py: 0, price: 300 });
    expect(listed.ok).toBe(true);
    expect(coins(t, "ada")).toBe(adaHad - PLOTS.listingFee);

    // Anyone sees it, with what stands there counted, and its plot view carries the listing.
    const market = (await t.call("GET", "/v1/plot-market")).body;
    expect(market.you).toBeNull();
    expect(market.plotMarket.listings).toEqual([
      expect.objectContaining({
        px: 0,
        py: 0,
        price: 300,
        seller: expect.objectContaining({ id: "ada" }),
        trust: "untrusted",
        links: expect.objectContaining({ world: expect.stringContaining("at=0,0") }),
      }),
    ]);
    expect(market.plotMarket.listings[0].blocks).toBeGreaterThan(0);
    const plot = (await t.call("GET", "/v1/plots/0/0")).body.plot;
    expect(plot.listing).toEqual({ price: 300, day: t.service.state.day });
    expect(plot.blocks).toBe(market.plotMarket.listings[0].blocks);
    expect(market.plotMarket.listings[0].edges).toBe(1);
    expect(plot.edges).toBe(1);
    // Its graded walls, counted as the plot read counts them, so a buyer sees what it's made of.
    expect(market.plotMarket.listings[0].walls).toEqual({ fine: 1, masterwork: 0 });
    expect(plot.walls).toEqual(market.plotMarket.listings[0].walls);
    const yours = (await t.call("GET", "/v1/plot-market", undefined, ada)).body.you;
    expect(yours.listings).toHaveLength(1);
    expect(yours.plots).toEqual([
      {
        px: 0,
        py: 0,
        canList: false,
        why: expect.stringMatching(/already for sale/),
        listed: true,
      },
    ]);

    // Bob's dry run says the price, the fee, his balance after, and that the seller's hearth goes.
    const bobHad = coins(t, "bob") ?? 0;
    const dryBuy = await t.act(bob, { type: "buy_plot", px: 0, py: 0, price: 300, dry: true });
    expect(dryBuy.plotSale).toMatchObject({
      price: 300,
      fee: 15,
      sellerGets: 285,
      balanceAfter: bobHad - 300,
      clearsHearth: true,
    });
    expect(dryBuy.plotSale).not.toHaveProperty("listingFee");
    // Eve shares the plot: the dry run counts her, and says she loses her share.
    expect(dryBuy.plotSale.shared).toBe(1);
    expect(dryBuy.plotSale.note).toMatch(/clears the hearth of whoever lives there/);
    expect(dryBuy.plotSale.note).toMatch(/loses their share/);
    expect(t.service.state.plots[plotKey(0, 0)]?.ownerId).toBe("ada");

    const bought = await t.act(bob, { type: "buy_plot", px: 0, py: 0, price: 300 });
    expect(bought).toMatchObject({
      ok: true,
      plotSale: { price: 300, balanceAfter: bobHad - 300 },
    });
    expect(coins(t, "bob")).toBe(bobHad - 300);
    expect(coins(t, "ada")).toBe(adaHad - PLOTS.listingFee + 285);

    // Ada is told what reached her, from Terrakin itself, wherever she was.
    const notices = (await t.call("GET", "/v1/notifications", undefined, ada)).body.notifications;
    expect(notices).toContainEqual(
      expect.objectContaining({
        type: "plot_sold",
        system: true,
        sold: { px: 0, py: 0, price: 300, coins: 285 },
      }),
    );
    // Eve, whose share ended with the sale, is told too, and the buyer never is.
    const eves = (await t.call("GET", "/v1/notifications", undefined, t.token("eve"))).body;
    expect(eves.notifications).toContainEqual(
      expect.objectContaining({
        type: "share_ended",
        system: true,
        shareEnded: { px: 0, py: 0, hearthCleared: false },
      }),
    );
    const bobs = (await t.call("GET", "/v1/notifications", undefined, bob)).body.notifications;
    expect(bobs.map((n: Json) => n.type)).not.toContain("share_ended");

    // The plot is Bob's, off the market, and its card says it changed hands.
    const after = (await t.call("GET", "/v1/plots/0/0")).body.plot;
    expect(after.owner.id).toBe("bob");
    expect(after).not.toHaveProperty("listing");
    expect(after.news).toBe("A new owner moved in today");
    expect((await t.call("GET", "/v1/plot-market")).body.plotMarket.listings).toEqual([]);
  });

  it("leaves out a suspended seller's plot, and refuses to sell it to anyone who names it", async () => {
    const t = await start();
    await t.act(t.token("ada"), { type: "list_plot", px: 0, py: 0, price: 300 });
    t.sql.exec(
      "INSERT INTO suspensions (resident_id, until, reason, by, at) VALUES (?, ?, 'scam', 'staff', 0)",
      "ada",
      Number.MAX_SAFE_INTEGER,
    );
    expect((await t.call("GET", "/v1/plot-market")).body.plotMarket.listings).toEqual([]);
    const bobHad = coins(t, "bob");
    for (const dry of [true, false]) {
      const buy = await t.call(
        "POST",
        "/v1/actions",
        { type: "buy_plot", px: 0, py: 0, price: 300, dry },
        t.token("bob"),
      );
      expect(buy.body).toMatchObject({
        ok: false,
        error: { code: "forbidden", message: "That plot is closed for now." },
      });
    }
    expect(t.service.state.plots[plotKey(0, 0)]?.ownerId).toBe("ada");
    expect(coins(t, "bob")).toBe(bobHad);
  });

  it("takes a reported plot off the market, in the moderation log, and tells the seller", async () => {
    const t = await start();
    const ada = t.token("ada");
    const bob = t.token("bob");
    const marlo = t.staff();
    await t.act(ada, { type: "list_plot", px: 0, py: 0, price: 300 });

    // Bob reports it by its plot; nobody reports a plot that isn't for sale.
    const report = { kind: "plot_listing", id: "0,0", reason: "scam" };
    expect((await t.call("POST", "/v1/reports", report, bob)).status).toBe(201);
    const missing = { ...report, id: "1,1" };
    expect((await t.call("POST", "/v1/reports", missing, bob)).status).toBe(404);
    const queue = (await t.call("GET", "/v1/admin/reports", undefined, marlo)).body;
    expect(queue.items).toEqual([
      expect.objectContaining({
        kind: "plot_listing",
        id: "0,0",
        target: expect.objectContaining({
          exists: true,
          text: "Plot (0, 0) for 300 coins",
          author: expect.objectContaining({ id: "ada" }),
        }),
      }),
    ]);

    // Only staff take it down.
    const path = "/v1/admin/plot-listings/0/0/remove";
    const why = { reason: "Asks for coins in its name" };
    expect((await t.call("POST", path, why)).status).toBe(401);
    expect((await t.call("POST", path, why, bob)).status).toBe(403);
    expect(t.service.state.plotMarket?.listings[plotKey(0, 0)]).toBeDefined();

    const had = coins(t, "ada");
    const done = await t.call("POST", path, why, marlo);
    expect(done.status).toBe(200);
    expect(done.body.logged).toMatchObject({
      action: "remove_plot_listing",
      kind: "plot_listing",
      id: "0,0",
      reason: "Asks for coins in its name",
    });
    // Hers again as it stood, the fee stays spent, and she hears what came down and why.
    expect(t.service.state.plotMarket?.listings).toEqual({});
    expect(t.service.state.plots[plotKey(0, 0)]?.ownerId).toBe("ada");
    expect(coins(t, "ada")).toBe(had);
    const notices = (await t.call("GET", "/v1/notifications", undefined, ada)).body.notifications;
    expect(notices).toContainEqual(
      expect.objectContaining({
        type: "takedown",
        takedown: expect.objectContaining({
          what: "plot_listing",
          rule: "scam",
          outcome: "returned",
          plot: { px: 0, py: 0 },
        }),
      }),
    );
    expect((await t.call("GET", "/v1/admin/reports", undefined, marlo)).body.items).toEqual([]);
    expect((await t.call("POST", path, why, marlo)).status).toBe(404);
  });
});
