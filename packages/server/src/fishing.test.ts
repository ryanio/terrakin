import {
  FISHING,
  type Input,
  POND,
  skyAt,
  type TimeOfDay,
  timeOfDayAt,
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
 * Fishing (RFC 0023) over HTTP: a cast is logged with the server's own roll, weather, and time of
 * day, whatever the resident sends, the world says the time of day a cast would log, and the
 * server keeps a cast out of the pond of anyone blocked either way, and out of a suspended owner's.
 */

// 3x3 plots of 8 tiles; the Commons is plot (1, 1).
const CONFIG: WorldConfig = {
  width: 24,
  height: 24,
  plotSize: 8,
  maxPlotsPerResident: 1,
  reach: 3,
};

/** The first minute of 2026-10-10 (UTC) whose sky is dry and whose map shows `time`. */
function momentWith(time: TimeOfDay): number {
  for (let at = Date.UTC(2026, 9, 10); ; at += 60_000) {
    if (skyAt(at).weather !== "rain" && timeOfDayAt(at) === time) return at;
  }
}

const cleanups: Cleanup[] = [];
const { problems, onResponse } = responseChecker();
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
  expect(problems.splice(0)).toEqual([]);
});

// biome-ignore lint/suspicious/noExplicitAny: the response checker already holds every body to its schema.
type Json = Record<string, any>;

async function start(now: number) {
  const store = new MemoryStore();
  const service = new WorldService({
    store,
    config: CONFIG,
    now: () => now,
    days: true,
    economy: true,
    items: true,
  });
  service.tick();
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
  cleanups.push(() => sql.close());
  const call = jsonCaller(await listenOnFreePort(server, cleanups));
  const act = async (token: string, action: Json) =>
    (await call("POST", "/v1/actions", action, token)).body as Json;
  /** Join, settle plot (px, py), build a home, and hold what a rod and a pond take. */
  const angler = async (name: string, px: number, py: number) => {
    const made = service.createSession({ name, kind: "human" });
    if (!made.ok || !made.residentId || !made.token) throw new Error(`Couldn't join ${name}`);
    const r = { id: made.residentId, token: made.token };
    await act(r.token, { type: "settle", px, py });
    await act(r.token, { type: "build_starter_home" });
    const items = service.state.items;
    if (!items) throw new Error("items closed");
    items.inventories[r.id] = { stacks: { wood: 3, stone: POND.stone }, goods: [] };
    return r;
  };
  return { call, act, angler, service, social, store };
}

describe("a cast over HTTP", () => {
  it("is logged with the server's roll, weather, and time of day, never the resident's", async () => {
    const now = momentWith("day");
    const w = await start(now);
    const ivy = await w.angler("Ivy", 0, 0);
    // Her hearth is (3, 3): a workbench and a rod, and a tile of pond just north of it.
    expect((await w.act(ivy.token, { type: "place", x: 2, y: 2, block: "workbench" })).ok).toBe(
      true,
    );
    const rod = { type: "craft", recipe: "fishing_rod", x: 2, y: 2 };
    expect((await w.act(ivy.token, rod)).ok).toBe(true);
    expect((await w.act(ivy.token, { type: "place", x: 3, y: 2, block: "pond" })).ok).toBe(true);
    expect(w.service.state.items?.inventories[ivy.id]?.stacks.stone).toBeUndefined();

    // A roll no cast takes, and a rainy night it isn't: had they reached the sim, it would refuse.
    const sent = { type: "fish", roll: FISHING.outOf, weather: "rain", timeOfDay: "night" };
    const cast = await w.act(ivy.token, sent);
    expect(cast.ok).toBe(true);
    expect(cast.events[0]).toMatchObject({ type: "fished", by: ivy.id, x: 3, y: 2 });
    const logged = w.store.log.at(-1) as Input;
    expect(logged).toMatchObject({
      actor: ivy.id,
      command: { type: "fish", weather: skyAt(now).weather, timeOfDay: "day" },
    });
    const { roll } = logged.command as Extract<Input["command"], { type: "fish" }>;
    expect(Number.isInteger(roll) && roll >= 0 && roll < FISHING.outOf).toBe(true);

    // The world shows the time of day a cast logs, and the cast is counted.
    expect((await w.call("GET", "/v1/world")).body.timeOfDay).toBe("day");
    const things = (await w.call("GET", "/v1/inventory", undefined, ivy.token)).body;
    expect(things.inventory.castToday).toBe(1);
    expect(things.rules).toMatchObject({ castsPerDay: FISHING.castsPerDay, pondStone: POND.stone });
  });

  it("stays out of the pond of anyone blocked either way, and of a suspended owner, dry runs too", async () => {
    const w = await start(momentWith("night"));
    const ivy = await w.angler("Ivy", 0, 0);
    // Out past her door, beside the path to it, so a visitor still lands in front of the door.
    expect((await w.act(ivy.token, { type: "place", x: 4, y: 6, block: "pond" })).ok).toBe(true);
    const wren = await w.angler("Wren", 2, 0);
    await w.act(wren.token, { type: "place", x: 18, y: 2, block: "workbench" });
    await w.act(wren.token, { type: "craft", recipe: "fishing_rod", x: 18, y: 2 });
    // Wren comes to Ivy's door, right beside the pond.
    expect((await w.act(wren.token, { type: "visit", px: 0, py: 0 })).ok).toBe(true);
    expect(w.service.state.residents[wren.id]).toMatchObject({ x: 3, y: 7 });
    const fish = (dry: boolean) => w.act(wren.token, { type: "fish", dry });
    const refused = {
      ok: false,
      error: { code: "forbidden", message: "You can't fish in this resident's pond." },
    };
    await w.call("PUT", `/v1/residents/${ivy.id}/block`, undefined, wren.token);
    expect(await fish(false)).toMatchObject(refused);
    expect(await fish(true)).toMatchObject({ ...refused, dry: true });
    await w.call("DELETE", `/v1/residents/${ivy.id}/block`, undefined, wren.token);
    await w.call("PUT", `/v1/residents/${wren.id}/block`, undefined, ivy.token);
    expect(await fish(false)).toMatchObject(refused);
    await w.call("DELETE", `/v1/residents/${wren.id}/block`, undefined, ivy.token);
    expect(w.social.safety.suspend("staff", ivy.id, 3, "test").ok).toBe(true);
    expect(await fish(false)).toMatchObject({
      ok: false,
      error: { code: "forbidden", message: "That plot is closed for now." },
    });
    expect(w.service.state.items?.today.casts).toBeUndefined();
    // Nothing between them now but Ivy's pond, which takes nothing from her.
    w.social.safety.unsuspend("staff", ivy.id, "test");
    expect((await fish(false)).ok).toBe(true);
  });
});
