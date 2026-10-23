import { readFileSync } from "node:fs";
import type { ServerMessage, WorldEvent as WireEvent } from "@terrakin/protocol";
import { DAY_MS, POTTERY, POTTERY_JOB_EDITION, type WorldConfig } from "@terrakin/sim";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp, TEST_OPEN_CLAY_PATH } from "./app";
import { eventWords } from "./events";
import { MemoryMediaStore } from "./media";
import { nodeSql } from "./node-sql";
import { SocialService } from "./social-service";
import { MemoryStore } from "./store";
import { type Cleanup, jsonCaller, listenOnFreePort, responseChecker } from "./test-support";
import { WorldService } from "./world-service";

/**
 * Pottery (RFC 0047) over HTTP: a world without `open_clay` reads exactly as it did, no adapter
 * sets the switch, and once the test route opens it a kiln loads, glows on the wire without saying
 * what's in it, tells its loader in the check-in when it's ready, and opens at a roll the server
 * draws and logs.
 */

// Settling plot (0, 0) and building the starter home leaves you on the hearth at (3, 3).
const CONFIG: WorldConfig = {
  width: 24,
  height: 24,
  plotSize: 8,
  maxPlotsPerResident: 1,
  reach: 3,
};
const KILN = { x: 3, y: 2 };

const cleanups: Cleanup[] = [];
const { problems, onResponse } = responseChecker();
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
  expect(problems.splice(0)).toEqual([]);
});

// biome-ignore lint/suspicious/noExplicitAny: the response checker already holds every body to its schema.
type Json = Record<string, any>;

async function start(
  clay = false,
  more: Partial<ConstructorParameters<typeof WorldService>[0]> = {},
) {
  let now = Date.UTC(2026, 9, 26, 9);
  const store = new MemoryStore();
  const service = new WorldService({
    store,
    config: CONFIG,
    now: () => now,
    days: true,
    economy: true,
    items: true,
    finds: true,
    shop: true,
    recipes: true,
    presence: true,
    clay,
    ...more,
  });
  const sql = nodeSql();
  cleanups.push(() => sql.close());
  const social = new SocialService({
    sql,
    media: new MemoryMediaStore(),
    resident: (id: string) => service.state.residents[id],
    now: () => now,
    residentAgeDays: (id) => service.residentAgeDays(id),
    credits: (since) => service.credits(since),
    event: (id) => eventWords(service.state, id),
  });
  const server = createApp({
    service,
    social,
    media: new MemoryMediaStore(),
    actionsPerSecond: 1000,
    sessionsPerMinute: 1000,
    onResponse,
    now: () => now,
    testClock: { advanceDay: () => service.state.day ?? null },
  });
  const base = await listenOnFreePort(server, cleanups);
  const call = jsonCaller(base);
  const act = async (token: string, action: Json) =>
    (await call("POST", "/v1/actions", action, token)).body;
  async function settler(name: string, px: number) {
    const made = service.createSession({ name, kind: "agent" });
    if (!made.ok || !made.residentId || !made.token) throw new Error(`Couldn't join ${name}`);
    expect(await act(made.token, { type: "settle", px, py: 0 })).toMatchObject({ ok: true });
    expect(await act(made.token, { type: "build_starter_home" })).toMatchObject({ ok: true });
    return { id: made.residentId, token: made.token };
  }
  const later = (ms: number) => {
    now += ms;
    service.tick();
  };
  const listen = (id: string) => {
    const got: ServerMessage[] = [];
    cleanups.push(service.subscribe(id, (m) => got.push(m)));
    return () => got.flatMap((m) => (m.type === "event" ? [m.event] : [])) as WireEvent[];
  };
  service.tick();
  return { base, call, act, settler, later, listen, service, store };
}

describe("a world that never opened clay", () => {
  it("is switched on by no adapter, and only through the test route on a test world", () => {
    const worker = readFileSync(new URL("../cloudflare/worker.ts", import.meta.url), "utf8");
    const node = readFileSync(new URL("./main.ts", import.meta.url), "utf8");
    expect(worker).not.toMatch(/\bclay\s*:/);
    expect(node).not.toMatch(/\bclay\s*:/);
    expect(worker).not.toMatch(/open-clay|testOpenClay|open_clay/);
  });

  it("reads as it always did: no clay, kiln, pot, card, or book group anywhere on the wire", async () => {
    const t = await start();
    const ada = await t.settler("Ada", 0);
    const world = (await t.call("GET", "/v1/world")).body;
    expect(world).not.toHaveProperty("clayOpen");
    expect(world).not.toHaveProperty("clayByWater");
    expect(world).not.toHaveProperty("kilns");
    expect(world.pickups.filter((p: Json) => p.kind === "clay")).toEqual([]);
    const inventory = (await t.call("GET", "/v1/inventory", undefined, ada.token)).body.inventory;
    expect(inventory).not.toHaveProperty("kilns");
    expect(inventory.recipes).not.toContain("bowl");
    const shop = (await t.call("GET", "/v1/shop", undefined, ada.token)).body.shop;
    expect(shop.recipes.map((c: Json) => c.sku)).not.toContain("recipe:vase");
    const book = (await t.call("GET", "/v1/collection", undefined, ada.token)).body.collection;
    expect(book.groups.map((g: Json) => g.family)).not.toEqual(
      expect.arrayContaining([expect.stringMatching(/^(pottery|glazes|finishes)$/)]),
    );
    // A kiln can't go down, so no pot can be made.
    expect(t.service.testGrant(ada.id, undefined, { stone: 4 })).toMatchObject({ ok: true });
    expect(await t.act(ada.token, { type: "place", ...KILN, block: "kiln" })).toMatchObject({
      ok: false,
      error: { code: "pottery_closed" },
    });
    // With the option a tick logs the switch once.
    const on = await start(true);
    // With `water`, so clay lies beside ponds and the sea.
    expect(on.store.log.filter((i) => i.command.type === "open_clay")).toEqual([
      expect.objectContaining({ command: { type: "open_clay", water: true } }),
    ]);
    // And where jobs are open, the board moves on to pottery's edition one edition a new day,
    // never mid-day and never skipping one.
    const both = await start(true, { levels: true, jobs: true });
    expect(both.service.state.jobs?.edition).toBe(1);
    both.later(DAY_MS);
    expect(both.service.state.jobs?.edition).toBe(2);
    both.later(DAY_MS);
    expect(both.service.state.jobs?.edition).toBe(POTTERY_JOB_EDITION);
    both.later(DAY_MS);
    const editions = both.store.log.flatMap((i) =>
      i.command.type === "set_job_edition" ? [i.command.edition] : [],
    );
    expect(editions).toEqual([2, POTTERY_JOB_EDITION]);
  });
});

describe("a world with clay", () => {
  it("fires a pot overnight, shows the kiln without its pot, and opens it at the server's roll", async () => {
    const t = await start();
    const ada = await t.settler("Ada", 0);
    const bob = await t.settler("Bob", 2);
    const tomorrow = () => (t.service.state.day ?? 0) + 1;
    expect((await t.call("POST", TEST_OPEN_CLAY_PATH)).body).toEqual({ ok: true });
    expect((await t.call("GET", "/v1/world")).body).toMatchObject({
      clayOpen: true,
      clayByWater: true,
    });
    expect(t.service.testGrant(ada.id, undefined, { stone: 4, clay: 2, herb: 1 })).toMatchObject({
      ok: true,
    });
    const heard = t.listen(bob.id);
    expect(await t.act(ada.token, { type: "place", ...KILN, block: "kiln" })).toMatchObject({
      ok: true,
    });
    const loaded = await t.act(ada.token, {
      type: "craft",
      recipe: "bowl",
      ...KILN,
      glaze: "moss",
      label: "For tea",
    });
    expect(loaded).toMatchObject({ ok: true });
    // Bob sees the kiln glow and nothing of what's in it.
    expect(heard().find((e) => e.type === "kiln_loaded")).toEqual({
      type: "kiln_loaded",
      ...KILN,
      by: ada.id,
      readyDay: tomorrow(),
    });
    expect(JSON.stringify(heard())).not.toMatch(/moss|For tea|bowl/);
    const world = (await t.call("GET", "/v1/world")).body;
    expect(world.kilns).toEqual([{ ...KILN, by: ada.id, readyDay: tomorrow() }]);
    const kilns = async (token: string) =>
      (await t.call("GET", "/v1/inventory", undefined, token)).body.inventory.kilns;
    expect(await kilns(ada.token)).toEqual([
      {
        ...KILN,
        readyDay: tomorrow(),
        ready: false,
        yours: true,
        pot: { kind: "bowl", glaze: "moss", label: "For tea", trust: "untrusted" },
      },
    ]);
    expect(await kilns(bob.token)).toBeUndefined();

    t.later(DAY_MS);
    const checkin = (await t.call("GET", "/v1/checkin", undefined, ada.token)).body;
    // The check-in names the pot as the harvest's answer will, less the finish it hasn't got yet.
    expect(checkin.todo).toContainEqual(
      expect.stringContaining("Your moss bowl is ready in the kiln at (3, 2)"),
    );
    // A dry run draws nothing and logs nothing.
    const before = t.store.log.length;
    expect(await t.act(ada.token, { type: "harvest", ...KILN, dry: true })).toMatchObject({
      ok: true,
      dry: true,
      events: [],
    });
    expect(t.store.log.length).toBe(before);
    // The server's roll, held to one that comes out crackle so the rare pot's news is seen.
    const draw = vi.spyOn(crypto, "getRandomValues").mockImplementation((a) => {
      (a as Uint32Array)[0] = 1600;
      return a;
    });
    const out = await t.act(ada.token, { type: "harvest", ...KILN });
    draw.mockRestore();
    expect(out).toMatchObject({ ok: true, fired: { finish: "crackle" } });
    // The pot is public by its codes once it's out (decision 0368): Bob hears what came out, and
    // the world's live activity lists a crackle pot, never its label.
    const emptied = heard().find((e) => e.type === "kiln_emptied");
    expect(emptied).toEqual({
      type: "kiln_emptied",
      ...KILN,
      by: ada.id,
      pot: { kind: "bowl", glaze: "moss", finish: "crackle", maker: ada.id },
    });
    const rare = (await t.call("GET", "/v1/world")).body.rarePots;
    expect(rare).toEqual([
      { seq: expect.any(Number), maker: ada.id, kind: "bowl", glaze: "moss", finish: "crackle" },
    ]);
    expect(JSON.stringify(heard())).not.toContain("For tea");
    // The answer names what came out, in the words the web and the check-in use.
    const finish = (out as { fired: { finish: string } }).fired.finish;
    expect(out).toMatchObject({
      fired: {
        kind: "bowl",
        glaze: "moss",
        name: `${finish.charAt(0).toUpperCase()}${finish.slice(1)} moss bowl`,
      },
    });
    const logged = t.store.log.at(-1)?.command as { type: string; roll?: number };
    expect(logged.type).toBe("harvest");
    expect(Number.isInteger(logged.roll)).toBe(true);
    expect(logged.roll).toBeGreaterThanOrEqual(0);
    expect(logged.roll).toBeLessThan(POTTERY.outOf);
    const goods = (await t.call("GET", "/v1/inventory", undefined, ada.token)).body.inventory.goods;
    expect(goods).toEqual([
      expect.objectContaining({
        kind: "bowl",
        glaze: "moss",
        label: "For tea",
        trust: "untrusted",
      }),
    ]);
    expect(goods[0].finish).toMatch(/^(smooth|speckled|crackle|iridescent)$/);
    // Pottery's pages in the book: the glaze it came in, and its finish unless it's plain.
    const book = (await t.call("GET", "/v1/collection", undefined, ada.token)).body.collection;
    const page = (family: string) => book.groups.find((g: Json) => g.family === family);
    expect(page("glazes")).toMatchObject({ count: 1, total: 8, done: false, badge: "Every glaze" });
    expect(page("glazes").kinds.find((k: Json) => k.kind === "moss").firstDay).toBeDefined();
    expect(page("finishes")).toMatchObject({
      count: goods[0].finish === "smooth" ? 0 : 1,
      total: 3,
    });
    expect(book.badges.includes("An iridescent pot")).toBe(goods[0].finish === "iridescent");
    // Set down at home, the pot goes out on the wire with its label marked as its maker's words.
    const heardBefore = heard().length;
    expect(
      await t.act(ada.token, { type: "place", x: 2, y: 4, block: "pot", item: goods[0].id }),
    ).toMatchObject({ ok: true });
    expect(
      heard()
        .slice(heardBefore)
        .find((e) => e.type === "block_placed"),
    ).toMatchObject({
      block: "pot",
      pot: { kind: "bowl", label: "For tea" },
      trust: "untrusted",
    });
    expect((await t.call("GET", "/v1/world")).body.pots).toEqual([
      expect.objectContaining({ x: 2, y: 4, by: ada.id, trust: "untrusted" }),
    ]);
    // A pot set down is news on the Visit page, named by its codes, never its label.
    // Its finish only when it isn't smooth: "A speckled moss bowl", "An iridescent moss bowl".
    const pot = goods[0].finish === "smooth" ? "moss bowl" : `${goods[0].finish} moss bowl`;
    expect((await t.call("GET", "/v1/plots/0/0")).body.plot.news).toBe(
      `${pot.startsWith("i") ? "An" : "A"} ${pot} set down today`,
    );
  });

  it("lists a pot in the market with its glaze and finish, named as it came out", async () => {
    const t = await start(true, { market: true });
    const ada = await t.settler("Ada", 0);
    const bob = await t.settler("Bob", 2);
    expect(t.service.testGrant(ada.id, undefined, { stone: 4, clay: 2 })).toMatchObject({
      ok: true,
    });
    expect(await t.act(ada.token, { type: "place", ...KILN, block: "kiln" })).toMatchObject({
      ok: true,
    });
    expect(await t.act(ada.token, { type: "craft", recipe: "bowl", ...KILN })).toMatchObject({
      ok: true,
    });
    t.later(DAY_MS);
    const out = (await t.act(ada.token, { type: "harvest", ...KILN })) as Json;
    // Old enough to list (three days in Terrakin).
    t.later(3 * DAY_MS);
    expect(
      await t.act(ada.token, { type: "list_item", item: out.fired.item, price: 12 }),
    ).toMatchObject({ ok: true });
    const listing = (await t.call("GET", "/v1/market")).body.market.listings[0];
    expect(listing).toMatchObject({
      name: out.fired.name,
      goods: [{ id: out.fired.item, glaze: "bare", finish: out.fired.finish }],
    });
    expect(listing.name).toMatch(/^(Smooth|Speckled|Crackle|Iridescent) clay bowl$/);
    // Bob buys it, and Ada hears what sold from Terrakin: the pot by its codes, never its buyer.
    expect(await t.act(bob.token, { type: "buy_listing", listing: listing.id })).toMatchObject({
      ok: true,
    });
    const notices = (await t.call("GET", "/v1/notifications", undefined, ada.token)).body
      .notifications as Json[];
    expect(notices.find((n) => n.type === "pot_sold")).toMatchObject({
      system: true,
      potSold: { kind: "bowl", glaze: "bare", finish: out.fired.finish, price: 12, coins: 11 },
    });
    expect(JSON.stringify(notices)).not.toContain(bob.id);
  });

  it("says who tea would reach, refuses it when nobody would be counted, and tells host and guest", async () => {
    const t = await start(true, { levels: true });
    const ada = await t.settler("Ada", 0);
    const bob = await t.settler("Bob", 2);
    expect(
      t.service.testGrant(ada.id, undefined, { stone: 4, clay: 4, wood: 1, herb: 2 }),
    ).toMatchObject({ ok: true });
    for (const action of [
      { type: "pick_recipe", recipe: "teapot" },
      { type: "place", ...KILN, block: "kiln" },
      { type: "craft", recipe: "teapot", ...KILN },
    ]) {
      expect(await t.act(ada.token, action)).toMatchObject({ ok: true });
    }
    t.later(DAY_MS);
    const kitchen = { x: 4, y: 2 };
    for (const action of [
      { type: "harvest", ...KILN },
      { type: "place", ...kitchen, block: "kitchen" },
      { type: "craft", recipe: "pot_of_tea", ...kitchen },
    ]) {
      expect(await t.act(ada.token, action)).toMatchObject({ ok: true });
    }
    // Both three days in Terrakin, so Bob counts as a guest, and the event an hour from noon.
    t.later(3 * DAY_MS);
    const noon = Math.floor(t.service.now() / DAY_MS) * DAY_MS + DAY_MS + 12 * 3_600_000;
    expect(
      await t.act(ada.token, {
        type: "schedule_event",
        kind: "gathering",
        title: "Tea in the garden",
        px: 0,
        py: 0,
        startsAt: new Date(noon).toISOString(),
        minutes: 60,
      }),
    ).toMatchObject({ ok: true });
    t.later(noon + 60_000 - t.service.now());
    const tea = (
      await t.call("GET", "/v1/inventory", undefined, ada.token)
    ).body.inventory.goods.find((g: Json) => g.kind === "pot_of_tea");
    // Cy joined today, so a cup wouldn't reach them: with only Cy there, serving is refused and
    // says why, and the pot of tea stays Ada's.
    const cy = t.service.createSession({ name: "Cy", kind: "agent" });
    if (!cy.ok || !cy.token || !cy.residentId) throw new Error("Couldn't join Cy");
    for (const [token, action] of [
      [ada.token, { type: "join_event", event: "e_1" }],
      [cy.token, { type: "join_event", event: "e_1" }],
    ] as const) {
      expect(await t.act(token, action)).toMatchObject({ ok: true });
    }
    const serve = { type: "bring_dish", item: tea.id };
    const refused = await t.act(ada.token, serve);
    expect(refused).toMatchObject({ ok: false, error: { code: "not_eligible" } });
    expect(refused.error.message).toContain(`${cy.residentId} joined too recently to count`);
    expect(await t.act(ada.token, { ...serve, dry: true })).toMatchObject({ ok: false });
    // Once Bob is there, the host's own view of the event says who a cup would reach, and why not.
    expect(await t.act(bob.token, { type: "join_event", event: "e_1" })).toMatchObject({
      ok: true,
    });
    const before = (await t.call("GET", "/v1/events/e_1", undefined, ada.token)).body.event;
    expect(before.tea).toMatchObject({ served: false, stay: 4 });
    expect(before.tea.guests).toEqual([
      expect.objectContaining({ resident: expect.objectContaining({ id: bob.id }), counted: true }),
      expect.objectContaining({
        resident: expect.objectContaining({ id: cy.residentId }),
        counted: false,
        why: expect.stringContaining("joined too recently to count"),
      }),
    ]);
    // Nobody else's view of it carries the tea.
    expect(
      (await t.call("GET", "/v1/events/e_1", undefined, bob.token)).body.event,
    ).not.toHaveProperty("tea");
    expect(await t.act(ada.token, serve)).toMatchObject({ ok: true });
    // The minute sweep samples who's there, and the next tick after the hour ends and credits it.
    for (let i = 0; i < 13; i++) {
      t.later(5 * 60_000);
      t.service.sweepEvents();
      await t.act(bob.token, { type: "join_event", event: "e_1" });
    }
    const notices = (await t.call("GET", "/v1/notifications", undefined, bob.token)).body
      .notifications as Json[];
    expect(notices.find((n) => n.type === "tea_poured")).toMatchObject({
      actor: { id: ada.id },
    });
    // And the host hears from Terrakin how many cups went home.
    const hers = (await t.call("GET", "/v1/notifications", undefined, ada.token)).body
      .notifications as Json[];
    expect(hers.find((n) => n.type === "tea_served")).toMatchObject({
      system: true,
      teaServed: { cups: 1 },
    });
  });
});
