import { readFileSync } from "node:fs";
import type { ServerMessage, WorldEvent as WireEvent } from "@terrakin/protocol";
import {
  isSea,
  LANDS,
  plotsLeft,
  seaFrom,
  stepFrom,
  type WorldConfig,
  worldGround,
} from "@terrakin/sim";
import { afterEach, describe, expect, it } from "vitest";
import { createApp, TEST_OPEN_LAND_PATH } from "./app";
import { LAND_PLAN } from "./lands";
import { MemoryMediaStore } from "./media";
import { nodeSql } from "./node-sql";
import { SocialService } from "./social-service";
import { MemoryStore } from "./store";
import { type Cleanup, jsonCaller, listenOnFreePort, responseChecker } from "./test-support";
import { WorldService } from "./world-service";

/**
 * New lands on the wire (RFC 0038): nothing of them in a world that never opened one, the
 * snapshot's `lands` and the `land_opened` event once the town does, and the count that decides
 * when, which no adapter turns on yet.
 *
 * Downtown here is 4 by 4 plots of 8 tiles, so 15 slots are claimable and the trigger's threshold
 * (`LANDS.openAt`) is one claim away.
 */
const CONFIG: WorldConfig = {
  width: 32,
  height: 32,
  plotSize: 8,
  maxPlotsPerResident: 1,
  reach: 3,
};

/** The island the planner lays out for `CONFIG`, as the snapshot names its coordinates. */
const ISLAND_PLOTS = Array.from({ length: 5 }, (_, i) => 5 + i).flatMap((px) =>
  Array.from({ length: 5 }, (_, py) => ({ px, py })),
);
const ISLAND_BRIDGE = Array.from({ length: 8 }, (_, i) => 32 + i).flatMap((x) =>
  [19, 20].map((y) => ({ x, y })),
);

const cleanups: Cleanup[] = [];
const { problems, onResponse } = responseChecker();
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
  expect(problems.splice(0)).toEqual([]);
});

// biome-ignore lint/suspicious/noExplicitAny: the response checker already holds every body to its schema.
type Json = Record<string, any>;

/** The world on Tuesday 6 October 2026, with new lands off unless a test asks for them. */
async function start(options: { lands?: boolean; testClock?: boolean } = {}) {
  let now = Date.UTC(2026, 9, 6, 9);
  const store = new MemoryStore();
  const service = new WorldService({
    store,
    config: CONFIG,
    now: () => now,
    days: true,
    economy: true,
    items: true,
    presence: true,
    lands: options.lands ?? false,
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
    ...(options.testClock ? { testClock: { advanceDay: () => service.state.day ?? null } } : {}),
  });
  cleanups.push(() => sql.close());
  const base = await listenOnFreePort(server, cleanups);
  const call = jsonCaller(base);
  const act = async (token: string, action: Json) =>
    (await call("POST", "/v1/actions", action, token)).body;
  async function settler(name: string, px: number, py: number) {
    const made = service.createSession({ name, kind: "agent" });
    if (!made.ok || !made.residentId || !made.token) throw new Error(`Couldn't join ${name}`);
    expect(await act(made.token, { type: "settle", px, py })).toMatchObject({ ok: true });
    return { id: made.residentId, token: made.token };
  }
  /** Everything a resident's socket would be sent. */
  const listen = (id: string) => {
    const got: ServerMessage[] = [];
    cleanups.push(service.subscribe(id, (m) => got.push(m)));
    return () => got.flatMap((m) => (m.type === "event" ? [m.event] : [])) as WireEvent[];
  };
  const later = (ms: number) => {
    now += ms;
    service.tick();
  };
  /** Settle enough of downtown that the plots left reach the threshold: 15 slots, 6 claims. */
  const crowd = async () => {
    const settled = [];
    for (let i = 0; i < 6; i++) settled.push(await settler(`n${i}`, i % 4, Math.floor(i / 4)));
    return settled;
  };
  const logged = (type: string) => store.log.filter((input) => input.command.type === type);
  service.tick();
  const world = async () => (await call("GET", "/v1/world")).body as Json;
  return { service, call, act, settler, crowd, listen, later, logged, world };
}

describe("a world with no land of its own", () => {
  it("reads exactly as it always did", async () => {
    const w = await start();
    const snapshot = await w.world();
    expect(snapshot.lands).toBeUndefined();
    expect(snapshot.config).toMatchObject({ width: 32, height: 32 });
  });
});

describe("the snapshot's lands", () => {
  it("names downtown, the island's plots, and the bridge across", async () => {
    const w = await start({ lands: true });
    const [ada] = await w.crowd();
    const events = w.listen(ada?.id ?? "");
    w.later(60_000);
    const snapshot = await w.world();
    // Downtown is plot columns 0 to 3, the water is column 4, and the island is columns 5 to 9,
    // rows 0 to 4, centered on the Commons' row. The bridge crosses the channel (x 32 to 39) on
    // the two rows through the middle of the Commons' plot.
    expect(snapshot.lands).toEqual({
      home: { width: 32, height: 32 },
      list: [
        {
          id: "willowmere",
          name: "Willowmere",
          plots: ISLAND_PLOTS,
          bridge: ISLAND_BRIDGE,
        },
      ],
    });
    expect(snapshot.config).toMatchObject({ width: 80, height: 40 });
    // `land_opened` is on the wire now, with coordinates named as the snapshot names them.
    const opened = events().filter((e) => e.type === "land_opened");
    expect(opened).toHaveLength(1);
    expect(opened[0]).toMatchObject({
      land: "willowmere",
      name: "Willowmere",
      width: 80,
      height: 40,
      plots: ISLAND_PLOTS,
      bridge: ISLAND_BRIDGE,
    });
  });

  it("carries enough for a reader to find the water the rules find", async () => {
    const w = await start({ lands: true });
    await w.crowd();
    w.later(60_000);
    const snapshot = await w.world();
    // The three facts the wire sends, read back as the sim takes them. This is what a client does
    // with `lands`, so it fails if `landsField` ever drops or renames one of them.
    const lands = snapshot.lands as {
      home: { width: number; height: number };
      list: { plots: { px: number; py: number }[]; bridge: { x: number; y: number }[] }[];
    };
    const sea = seaFrom(w.service.state.config, {
      home: lands.home,
      list: lands.list.map((l) => ({
        plots: l.plots.map((p) => [p.px, p.py] as const),
        bridge: l.bridge.map((t) => [t.x, t.y] as const),
      })),
    });
    const wrong: string[] = [];
    const { width, height } = w.service.state.config;
    for (let x = 0; x < width; x++) {
      for (let y = 0; y < height; y++) {
        if (sea?.(x, y) !== isSea(w.service.state, x, y)) wrong.push(`${x},${y}`);
      }
    }
    expect(wrong).toEqual([]);
    expect(sea?.(ISLAND_BRIDGE[0]?.x ?? 0, (ISLAND_BRIDGE[0]?.y ?? 0) - 1)).toBe(true);
  });

  it("leaves a walk over the bridge and a plot to claim on the far side", async () => {
    const w = await start({ lands: true });
    await w.crowd();
    w.later(60_000);
    const island = w.service.state.lands?.list[0];
    if (!island) throw new Error("no land opened");
    const [px, py] = island.plots[0] as [number, number];
    const isla = await w.settler("isla", px, py);
    expect(w.service.state.plots[`${px},${py}`]?.ownerId).toBe(isla.id);
    // The water between is refused, in the words that point at the bridge.
    const made = w.service.createSession({ name: "wade", kind: "agent" });
    if (!made.ok || !made.token) throw new Error("couldn't join wade");
    const wet = await w.act(made.token, { type: "settle", px: px - 1, py });
    expect(wet).toMatchObject({ ok: false, error: { code: "out_of_bounds" } });
    expect(wet.error.message).toContain("open water");
    // The bridge is walkable ground, and it carries at both ends: west onto downtown, east onto
    // the island. The sim can't check that, so the planner does.
    const ground = worldGround(w.service.state);
    const [wx, wy] = island.bridge[0] as [number, number];
    const [ex, ey] = island.bridge[island.bridge.length - 1] as [number, number];
    expect(ground.obstacle(wx, wy)).toBeUndefined();
    expect(ground.obstacle(ex, ey)).toBeUndefined();
    expect(stepFrom(ground, { x: wx, y: wy }, "w").ok).toBe(true);
    expect(stepFrom(ground, { x: ex, y: ey }, "e").ok).toBe(true);
  });
});

describe("the test route", () => {
  it("opens a land now, and never reaches the Worker", async () => {
    const w = await start({ testClock: true });
    expect(w.service.state.lands).toBeUndefined();
    expect((await w.call("POST", TEST_OPEN_LAND_PATH)).status).toBe(200);
    expect(w.service.state.lands?.list.map((l) => l.name)).toEqual(["Willowmere"]);
    // Again opens the next one in the town's table, further east again, bridged at the same
    // latitude: the Commons is still downtown's, not the grown world's centre.
    expect((await w.call("POST", TEST_OPEN_LAND_PATH)).status).toBe(200);
    const [first, second] = w.service.state.lands?.list ?? [];
    expect(second?.name).toBe("Harrowfen");
    expect(Math.min(...(second?.plots.map(([px]) => px) ?? []))).toBeGreaterThan(
      Math.max(...(first?.plots.map(([px]) => px) ?? [])),
    );
    expect(second?.bridge.map(([, y]) => y)).toEqual(first?.bridge.map(([, y]) => y));
    const worker = readFileSync(new URL("../cloudflare/worker.ts", import.meta.url), "utf8");
    expect(worker).not.toMatch(/open-land|testOpenLand|open_land/);
  });
});

describe("the count that opens the next land", () => {
  it("waits for the claimable plots to fall to LANDS.openAt", async () => {
    const w = await start({ lands: true });
    expect(plotsLeft(w.service.state)).toBe(15);
    w.later(60_000);
    expect(w.logged("open_land")).toHaveLength(0);
    // 15 slots, the threshold is 9: six claims bring it there.
    await w.crowd();
    expect(plotsLeft(w.service.state)).toBe(LANDS.openAt);
    w.later(60_000);
    expect(w.logged("open_land")).toHaveLength(1);
    // And once, not again: the land it brought puts the count back up.
    w.later(60_000);
    expect(w.logged("open_land")).toHaveLength(1);
    expect(plotsLeft(w.service.state)).toBe(LANDS.openAt + LAND_PLAN.plots ** 2);
  });

  it("opens nothing in a server that didn't ask for lands", async () => {
    const w = await start();
    await w.crowd();
    expect(plotsLeft(w.service.state)).toBe(LANDS.openAt);
    w.later(60_000);
    expect(w.logged("open_land")).toHaveLength(0);
    expect(w.service.state.lands).toBeUndefined();
  });
});
