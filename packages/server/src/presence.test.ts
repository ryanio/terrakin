import { type Input, TOWN_ACTOR, type WorldConfig } from "@terrakin/sim";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "./app";
import { MemoryStore } from "./store";
import { jsonCaller, listenOnFreePort, responseChecker } from "./test-support";
import { WorldService } from "./world-service";

/**
 * Presence that comes with acting (RFC 0014, step 4): once the world has `implicit_presence`, a
 * REST or link check-in logs one input, not `join`, the action, and `leave`.
 */

// 3x3 plots of 4 tiles. Spawn (6,6) is in the Commons, plot (1,1).
const CONFIG: WorldConfig = {
  width: 12,
  height: 12,
  plotSize: 4,
  maxPlotsPerResident: 1,
  reach: 2,
};
const IDLE = 60 * 60_000;

const cleanups: (() => void | Promise<void>)[] = [];
const { problems, onResponse } = responseChecker();
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
  expect(problems.splice(0)).toEqual([]);
});

async function start(store = new MemoryStore()) {
  const clock = { now: 0 };
  const service = new WorldService({ store, config: CONFIG, now: () => clock.now, presence: true });
  const server = createApp({ service, actionsPerSecond: 1000, onResponse });
  const call = jsonCaller(await listenOnFreePort(server, cleanups));
  const join = async (name: string) =>
    (await call("POST", "/v1/session", { name, kind: "agent" })).body as {
      residentId: string;
      token: string;
    };
  /** Let everyone go idle and run the sweep. */
  const idle = () => {
    clock.now += IDLE;
    service.sweepIdle();
  };
  return { store, service, call, join, idle };
}

const types = (log: readonly Input[]) => log.map((i) => i.command.type);

describe("implicit presence", () => {
  it("is logged once, when the world first boots with it", async () => {
    const { store, service } = await start();
    expect(types(store.log)).toEqual(["implicit_presence"]);
    expect(service.state.implicitPresence).toBe(true);
    new WorldService({ store, config: CONFIG, presence: true });
    expect(types(store.log)).toEqual(["implicit_presence"]);
  });

  it("lets a REST check-in log one input, with its resident joined first", async () => {
    const { store, service, call, join, idle } = await start();
    const { residentId, token } = await join("Wren");
    idle();
    expect(service.state.residents[residentId]?.online).toBe(false);
    const before = store.log.length;
    const res = await call("POST", "/v1/actions", { type: "putter" }, token);
    expect(res.body.ok).toBe(true);
    const events: { type: string }[] = res.body.events;
    expect(events.map((e) => e.type)).toEqual(["joined", ...events.slice(1).map(() => "moved")]);
    expect(events.length).toBeGreaterThan(1);
    expect(store.log.slice(before)).toEqual([
      { actor: residentId, command: { type: "putter", steps: expect.any(Array) } },
    ]);
    expect(service.state.residents[residentId]?.online).toBe(true);
  });

  it("lets a link check-in log one input", async () => {
    const { store, service, call, join, idle } = await start();
    const { residentId } = await join("Wren");
    const key = service.mintLinkKey(residentId);
    idle();
    const before = store.log.length;
    const res = await call("GET", `/v1/act/${key}/move?dir=n`);
    expect(res.status).toBe(200);
    expect(types(store.log.slice(before))).toEqual(["move"]);
    expect(service.state.residents[residentId]).toMatchObject({ online: true, x: 6, y: 5 });
  });

  it("faces the way the step went from where coming back put them", async () => {
    const { service, call, join, idle } = await start();
    const { residentId, token } = await join("Wren");
    await call("POST", "/v1/actions", { type: "move", dir: "e" }, token);
    idle();
    // Someone built where Wren stood (set up directly), so coming back moves them to spawn.
    service.state.blocks["7,6"] = "stone";
    const res = await call("POST", "/v1/actions", { type: "move", dir: "n" }, token);
    expect(res.body).toMatchObject({ ok: true, events: [{ type: "joined" }, { type: "moved" }] });
    expect(service.state.residents[residentId]).toMatchObject({ x: 6, y: 5 });
    const world = await call("GET", "/v1/world");
    const me = world.body.residents.find((r: { id: string }) => r.id === residentId);
    expect(me.facing).toBe("n");
  });

  it("logs nothing for an action the world refuses, and leaves them offline", async () => {
    const { store, service, call, join, idle } = await start();
    const { residentId, token } = await join("Wren");
    idle();
    const before = store.log.length;
    const res = await call("POST", "/v1/actions", { type: "home" }, token);
    expect(res.body).toMatchObject({ ok: false, error: { code: "no_hearth" } });
    expect(store.log.length).toBe(before);
    expect(service.state.residents[residentId]?.online).toBe(false);
  });

  it("still brings a resident online with a join to chat", async () => {
    const { store, call, join, idle } = await start();
    const { token } = await join("Wren");
    idle();
    const before = store.log.length;
    const res = await call("POST", "/v1/actions", { type: "chat", text: "hello" }, token);
    expect(res.body).toMatchObject({ ok: true });
    expect(types(store.log.slice(before))).toEqual(["join"]);
  });

  it("takes everyone idle offline with one leave_idle, ids sorted", async () => {
    const { store, service, join, idle } = await start();
    const ids = [await join("Wren"), await join("Ada"), await join("Bo")].map((r) => r.residentId);
    const before = store.log.length;
    idle();
    expect(store.log.slice(before)).toEqual([
      { actor: TOWN_ACTOR, command: { type: "leave_idle", ids: [...ids].sort() } },
    ]);
    expect(service.onlineCount()).toBe(0);
    // Nobody left to take: the next sweep logs nothing.
    idle();
    expect(store.log.length).toBe(before + 1);
  });

  it("marks everyone offline at boot with one leave_idle", async () => {
    const { store, join } = await start();
    const ids = [await join("Wren"), await join("Ada")].map((r) => r.residentId);
    const before = store.log.length;
    const reborn = new WorldService({ store, config: CONFIG, presence: true });
    expect(store.log.slice(before)).toEqual([
      { actor: TOWN_ACTOR, command: { type: "leave_idle", ids: [...ids].sort() } },
    ]);
    expect(reborn.onlineCount()).toBe(0);
  });
});
