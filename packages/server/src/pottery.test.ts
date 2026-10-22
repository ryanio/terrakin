import { readFileSync } from "node:fs";
import type { ServerMessage, WorldEvent as WireEvent } from "@terrakin/protocol";
import { DAY_MS, POTTERY, POTTERY_JOB_EDITION, type WorldConfig } from "@terrakin/sim";
import { afterEach, describe, expect, it } from "vitest";
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
    // And where jobs are open, the board moves to pottery's edition on the next day, never mid-day.
    const both = await start(true, { levels: true, jobs: true });
    expect(both.service.state.jobs?.edition).toBe(1);
    both.later(DAY_MS);
    expect(both.service.state.jobs?.edition).toBe(POTTERY_JOB_EDITION);
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
    expect(checkin.todo).toContainEqual(expect.stringContaining(`Your kiln at (3, 2) is ready`));
    // A dry run draws nothing and logs nothing.
    const before = t.store.log.length;
    expect(await t.act(ada.token, { type: "harvest", ...KILN, dry: true })).toMatchObject({
      ok: true,
      dry: true,
      events: [],
    });
    expect(t.store.log.length).toBe(before);
    const out = await t.act(ada.token, { type: "harvest", ...KILN });
    expect(out).toMatchObject({ ok: true });
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
    expect(goods[0].finish).toMatch(/^(plain|speckled|crackle|iridescent)$/);
    // Pottery's pages in the book: the glaze it came in, and its finish unless it's plain.
    const book = (await t.call("GET", "/v1/collection", undefined, ada.token)).body.collection;
    const page = (family: string) => book.groups.find((g: Json) => g.family === family);
    expect(page("glazes")).toMatchObject({ count: 1, total: 8, done: false, badge: "Every glaze" });
    expect(page("glazes").kinds.find((k: Json) => k.kind === "moss").firstDay).toBeDefined();
    expect(page("finishes")).toMatchObject({
      count: goods[0].finish === "plain" ? 0 : 1,
      total: 3,
    });
    expect(book.badges.includes("An iridescent pot")).toBe(goods[0].finish === "iridescent");
  });
});
