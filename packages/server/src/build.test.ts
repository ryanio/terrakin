import { BUILD_LIMITS, type ServerMessage } from "@terrakin/protocol";
import type { WorldConfig } from "@terrakin/sim";
import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { createApp } from "./app";
import { MemoryMediaStore } from "./media";
import { nodeSql } from "./node-sql";
import { SocialService } from "./social-service";
import { MemoryStore } from "./store";
import { type Cleanup, jsonCaller, listenOnFreePort, responseChecker } from "./test-support";
import { WorldService } from "./world-service";

/**
 * Building with what you gather (RFC 0016) over HTTP and the socket: a plan priced with a dry run,
 * built, shown in the world and read back as a plan, and real builds spaced apart.
 */

// 3x3 plots of 8 tiles. Settling plot (0, 0) and building the starter home leaves you on the
// hearth at (3, 3), inside a hut from (1, 1) to (5, 5) with its doorway at (3, 5).
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

async function start() {
  let now = Date.UTC(2026, 9, 6, 9);
  const service = new WorldService({
    store: new MemoryStore(),
    config: CONFIG,
    now: () => now,
    days: true,
    items: true,
  });
  const sql = nodeSql();
  const social = new SocialService({
    sql,
    media: new MemoryMediaStore(),
    resident: (id) => service.state.residents[id],
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
  const base = await listenOnFreePort(server, cleanups);
  cleanups.push(() => sql.close());
  const call = jsonCaller(base);
  async function settler(name: string, px: number, py: number) {
    const { body } = await call("POST", "/v1/session", { name, kind: "agent" });
    const who = { id: body.residentId as string, token: body.token as string };
    await call("POST", "/v1/actions", { type: "settle", px, py }, who.token);
    await call("POST", "/v1/actions", { type: "build_starter_home" }, who.token);
    return who;
  }
  const act = async (who: { token: string }, action: Record<string, unknown>) =>
    (await call("POST", "/v1/actions", action, who.token)).body;
  /** Put stone in a resident's things without gathering it. Setup only. */
  const stone = (id: string, n: number) => {
    const items = service.state.items;
    if (!items) throw new Error("items aren't open");
    items.inventories[id] = { stacks: { stone: n }, goods: [] };
  };
  return {
    base,
    call,
    act,
    settler,
    stone,
    service,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

/** A path of cobblestones out of the hut's door, and a leaf bush, from the plot's corner. */
const PATH = {
  type: "build",
  px: 0,
  py: 0,
  blocks: [{ x: 6, y: 7, block: "leaf" }],
  ground: [
    { x: 3, y: 6, ground: "cobble" },
    { x: 3, y: 7, ground: "cobble" },
    { x: 3, y: 5, ground: "cobble" },
  ],
};

describe("build", () => {
  it("prices a plan with a dry run, builds it, and shows it in the world and as a plan", async () => {
    const t = await start();
    const ada = await t.settler("Ada", 0, 0);
    t.stone(ada.id, 3);
    const priced = await t.act(ada, { ...PATH, dry: true });
    expect(priced).toMatchObject({
      ok: true,
      dry: true,
      events: [],
      plan: {
        px: 0,
        py: 0,
        placed: 1,
        laid: 3,
        uses: [{ kind: "stone", count: 3 }],
        returns: [],
        skipped: [],
      },
    });
    // Nothing happened yet.
    expect(t.service.state.ground).toBeUndefined();
    const built = await t.act(ada, PATH);
    expect(built.ok).toBe(true);
    expect(built.plan).toEqual(priced.plan);
    expect(built.events).toContainEqual({
      type: "ground_laid",
      x: 3,
      y: 7,
      ground: "cobble",
      by: ada.id,
    });
    const world = (await t.call("GET", "/v1/world")).body;
    expect(world.ground).toEqual(
      expect.arrayContaining([
        { x: 3, y: 5, ground: "cobble" },
        { x: 3, y: 7, ground: "cobble" },
      ]),
    );
    const plan = (await t.call("GET", "/v1/plots/0/0/plan")).body.plan;
    expect(plan).toMatchObject({
      px: 0,
      py: 0,
      size: 8,
      ownerId: ada.id,
      hearths: [{ x: 3, y: 3 }],
    });
    expect(plan.ground).toHaveLength(3);
    expect(plan.blocks).toContainEqual({ x: 6, y: 7, block: "leaf" });
    expect((await t.call("GET", "/v1/plots/3/0/plan")).status).toBe(404);
    // A second try on the same tiles has nothing left to do, and says so.
    t.advance(BUILD_LIMITS.secondsBetween * 1000);
    expect(await t.act(ada, PATH)).toMatchObject({ ok: false, error: { code: "already_set" } });
  });

  it("shows what's upstairs with its storey, and nothing about storeys in a world without one (RFC 0028)", async () => {
    const t = await start();
    const ada = await t.settler("Ada", 0, 0);
    await t.act(ada, PATH);
    // Today's world: the same snapshot as before storeys, with no storey anywhere in it.
    const today = (await t.call("GET", "/v1/world")).body;
    expect(JSON.stringify(today)).not.toContain("storey");
    expect(JSON.stringify((await t.call("GET", "/v1/plots/0/0")).body)).not.toContain("storey");
    // Setup only, since no action adds a storey yet: a loft over the hut, with stairs up to it,
    // a window upstairs, and Ada standing on its floor.
    const state = t.service.state;
    const plot = state.plots["0,0"];
    const me = state.residents[ada.id];
    if (!plot || !me) throw new Error("Ada's plot");
    plot.storeys = 1;
    state.blocks["2,4"] = "stairs";
    state.storeys = { "1": { blocks: { "1,1": "glass" }, ground: { "3,3": "planks" } } };
    me.storey = 1;
    const world = (await t.call("GET", "/v1/world")).body;
    expect(world.blocks).toContainEqual({ x: 2, y: 4, block: "stairs" });
    expect(world.blocks).toContainEqual({ x: 1, y: 1, block: "wood" });
    expect(world.blocks).toContainEqual({ x: 1, y: 1, storey: 1, block: "glass" });
    expect(world.ground).toContainEqual({ x: 3, y: 3, storey: 1, ground: "planks" });
    expect(world.plots).toContainEqual(expect.objectContaining({ px: 0, py: 0, storeys: 1 }));
    expect(world.residents).toContainEqual(expect.objectContaining({ id: ada.id, storey: 1 }));
    // The plot's count takes in every storey.
    const before = today.blocks.length;
    const shown = (await t.call("GET", "/v1/plots/0/0")).body.plot;
    expect(shown).toMatchObject({ storeys: 1, blocks: before + 2 });
    expect((await t.call("GET", "/v1/plots")).body.plots).toEqual([
      expect.objectContaining({ px: 0, py: 0, storeys: 1, blocks: before + 2 }),
    ]);
  });

  it("spaces real builds apart, but never dry runs", async () => {
    const t = await start();
    const ada = await t.settler("Ada", 0, 0);
    const path = (y: number) => ({
      type: "build",
      px: 0,
      py: 0,
      ground: [{ x: 6, y, ground: "dirt" }],
    });
    expect((await t.act(ada, path(1))).ok).toBe(true);
    const again = await t.act(ada, path(2));
    // The world's answer, a 200 like any action's, with the seconds to wait.
    expect(again).toMatchObject({
      ok: false,
      error: { code: "rate_limited", retryAfter: BUILD_LIMITS.secondsBetween },
    });
    expect(again.error.message).toContain(`${BUILD_LIMITS.secondsBetween} seconds`);
    expect(t.service.state.ground?.["6,2"]).toBeUndefined();
    expect(await t.act(ada, { ...path(2), dry: true })).toMatchObject({ ok: true, dry: true });
    t.advance(BUILD_LIMITS.secondsBetween * 1000);
    expect((await t.act(ada, path(2))).ok).toBe(true);
  });

  it("answers a build on the socket with the plan in its ack, and one too soon with retryAfter", async () => {
    const t = await start();
    const ada = await t.settler("Ada", 0, 0);
    const ws = new WebSocket(`${t.base.replace("http", "ws")}/v1/live`);
    cleanups.push(() => ws.close());
    const build = (id: string, y: number) =>
      ws.send(
        JSON.stringify({
          type: "action",
          id,
          action: { type: "build", px: 0, py: 0, ground: [{ x: 0, y, ground: "moss" }] },
        }),
      );
    const answers: ServerMessage[] = [];
    const two = new Promise<void>((resolve) => {
      ws.on("message", (data) => {
        const m = JSON.parse(data.toString()) as ServerMessage;
        if (m.type === "welcome") {
          build("b1", 7);
          build("b2", 6);
        }
        if (m.type === "ack" || m.type === "error") answers.push(m);
        if (answers.length === 2) resolve();
      });
    });
    ws.once("open", () => ws.send(JSON.stringify({ type: "hello", v: 1, token: ada.token })));
    await two;
    expect(answers[0]).toMatchObject({ type: "ack", id: "b1", plan: { laid: 1, uses: [] } });
    expect(answers[1]).toMatchObject({
      type: "error",
      id: "b2",
      error: { code: "rate_limited", retryAfter: BUILD_LIMITS.secondsBetween },
    });
  });
});
