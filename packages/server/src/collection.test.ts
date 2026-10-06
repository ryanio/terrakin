import { type CollectionView, WEAR_GROUP } from "@terrakin/protocol";
import { ITEM_KINDS, replay, STARTER_SEEDS, type WorldConfig } from "@terrakin/sim";
import { afterEach, describe, expect, it } from "vitest";
import { FINDS_CONFIG, FINDS_LOG } from "../../sim/src/fixtures/finds-log";
import { createApp } from "./app";
import { COLLECTIBLE_WEAR, CollectionBook } from "./collection";
import { MemoryMediaStore } from "./media";
import { nodeSql } from "./node-sql";
import { SocialService } from "./social-service";
import { MemoryStore } from "./store";
import { jsonCaller, listenOnFreePort, responseChecker } from "./test-support";
import { DAY_MS, utcDay, WorldService } from "./world-service";

/**
 * The collection book (RFC 0021): what each resident has ever held and worn, filled in as the
 * world commits inputs, once from the world as it was, and read by anyone.
 */

const CONFIG: WorldConfig = {
  width: 24,
  height: 24,
  plotSize: 8,
  maxPlotsPerResident: 1,
  reach: 3,
};

const cleanups: (() => void | Promise<void>)[] = [];
const { problems, onResponse } = responseChecker();
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
  expect(problems.splice(0)).toEqual([]);
});

/** A PNG header padded out, the smallest picture the server takes. */
function png() {
  const bytes = new Uint8Array(64);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
  return bytes;
}

async function start() {
  let now = Date.UTC(2026, 9, 6, 9);
  const service = new WorldService({
    store: new MemoryStore(),
    config: CONFIG,
    now: () => now,
    days: true,
    economy: true,
    items: true,
    finds: true,
  });
  const sql = nodeSql();
  const media = new MemoryMediaStore();
  const social = new SocialService({
    sql,
    media,
    resident: (id: string) => service.state.residents[id],
    now: () => now,
  });
  const server = createApp({
    service,
    social,
    media,
    actionsPerSecond: 1000,
    sessionsPerMinute: 1000,
    onResponse,
  });
  const base = await listenOnFreePort(server, cleanups);
  cleanups.push(() => sql.close());
  const call = jsonCaller(base);
  const join = (name: string) => {
    const made = service.createSession({ name, kind: "agent" });
    if (!made.ok || !made.residentId || !made.token) throw new Error(`Couldn't join ${name}`);
    return { id: made.residentId, token: made.token };
  };
  const act = async (token: string, action: unknown) => {
    const res = await call("POST", "/v1/actions", action, token);
    expect(res.body?.ok, JSON.stringify(res.body)).toBe(true);
    return res.body;
  };
  const upload = async (token: string) => {
    const res = await fetch(`${base}/v1/media`, {
      method: "POST",
      headers: { "content-type": "image/png", authorization: `Bearer ${token}` },
      body: new Blob([png()]),
    });
    return ((await res.json()) as { media: { id: string } }).media.id;
  };
  const nextDay = () => {
    now += DAY_MS;
    service.tick();
  };
  return { call, join, act, upload, nextDay, service, now: () => now };
}

/** Every kind in a book, by its id, with the day it was first had. */
const firsts = (book: CollectionView) =>
  new Map(book.groups.flatMap((g) => g.kinds.map((k) => [k.kind, k.firstDay] as const)));

describe("the collection book", () => {
  it("fills in as things arrive, keeps the first day, and anyone can read it", async () => {
    const t = await start();
    const today = utcDay(t.now());
    const wren = t.join("Wren");
    await t.act(wren.token, { type: "settle", px: 0, py: 0 });
    // Home brings the first pantry: the starter seeds, sugar, and a jar.
    await t.act(wren.token, { type: "build_starter_home" });
    await t.act(wren.token, { type: "profile", wear: ["straw_hat"] });
    await t.act(wren.token, { type: "make_piece", media: await t.upload(wren.token), title: "Hi" });
    const mine = async () =>
      (await t.call("GET", "/v1/collection", undefined, wren.token)).body.collection;
    const book: CollectionView = await mine();
    const got = firsts(book);
    for (const seed of STARTER_SEEDS) expect(got.get(seed), seed).toBe(today);
    expect(got.get("sugar")).toBe(today);
    expect(got.get("piece")).toBe(today);
    expect(got.get("straw_hat")).toBe(today);
    expect(got.get("geode")).toBeUndefined();
    expect(book.count).toBe(STARTER_SEEDS.length + 2 + 1 + 1);
    expect(book.total).toBe(ITEM_KINDS.length + COLLECTIBLE_WEAR.length);
    // Sugar and jars are the whole pantry: a family finished earns its badge.
    expect(book.groups.find((g) => g.family === "pantry")).toMatchObject({
      count: 2,
      total: 2,
      done: true,
      badge: "Every staple",
    });
    expect(book.badges).toEqual(["Every staple"]);
    expect(book.groups.find((g) => g.family === "shore_find")).toMatchObject({
      path: ["find", "shore_find"],
      hint: "Found on the sand",
      count: 0,
      done: false,
    });
    expect(book.groups.at(-1)?.family).toBe(WEAR_GROUP);

    // The next day's pantry brings sugar again: it stays in the book from the day it first came.
    t.nextDay();
    await t.act(wren.token, { type: "home" });
    expect(firsts(await mine()).get("sugar")).toBe(today);

    // The book is public, and the profile says how far along it is.
    const seen = await t.call("GET", `/v1/residents/${wren.id}/collection`);
    expect(seen.body.collection).toEqual(await mine());
    const profile = (await t.call("GET", `/v1/residents/${wren.id}`)).body.resident;
    expect(profile.collected).toEqual({ count: book.count, total: book.total });
    expect((await t.call("GET", "/v1/residents/r_nobody/collection")).status).toBe(404);
    expect((await t.call("GET", "/v1/collection")).status).toBe(401);
  });

  it("fills in once from what the world already holds", () => {
    const sql = nodeSql();
    cleanups.push(() => sql.close());
    const book = new CollectionBook({ sql, now: () => 0 });
    const state = replay(FINDS_CONFIG, FINDS_LOG);
    const day = state.day as number;
    // Before the book: a seed Cy planted on day 20030, and a jam she made on day 20012.
    const items = state.items;
    if (!items) throw new Error("items");
    items.crops["2,2"] = { crop: "pumpkin", by: "cy", plantedDay: 20030, readyDay: 20035 };
    items.inventories.cy?.goods.push({
      id: "i_9",
      kind: "lemon_jam",
      maker: "cy",
      madeDay: 20012,
    });
    book.backfill(state);
    const ada = firsts(book.view("ada"));
    const bob = firsts(book.view("bob"));
    const cy = firsts(book.view("cy"));
    // Ada's geode is on display; the fossil she sold before the book is nowhere to be counted.
    expect(ada.get("geode")).toBe(day);
    expect(ada.get("fossil")).toBeUndefined();
    expect(ada.get("dress")).toBe(day);
    // Partner wear is hers, but the book counts only what everyone can wear.
    expect([...ada.keys()]).not.toContain("muse_halo");
    expect(bob.get("fossil")).toBe(day);
    expect(bob.get("umbrella")).toBe(day);
    // Bob was given Ada's tea: it counts from today. What Cy made or planted counts from then.
    expect(bob.get("herb_tea")).toBe(day);
    expect(cy.get("lemon_jam")).toBe(20012);
    expect(cy.get("pumpkin_seed")).toBe(20030);
    expect(cy.get("bouquet")).toBe(day);

    // Once: a world met again later adds nothing, whatever it holds by then.
    const before = book.view("dee");
    items.inventories.dee = { stacks: { acorn: 1 }, goods: [] };
    book.backfill(state);
    expect(new CollectionBook({ sql, now: () => 0 }).view("dee")).toEqual(before);
  });
});
