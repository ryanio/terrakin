import { TOWN_ACTOR, type WorldConfig } from "@terrakin/sim";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "./app";
import { MemoryMediaStore } from "./media";
import { nodeSql } from "./node-sql";
import { SocialService } from "./social-service";
import { MemoryStore } from "./store";
import { type Cleanup, jsonCaller, listenOnFreePort, responseChecker } from "./test-support";
import { WorldService } from "./world-service";

// 3x3 plots of 8 tiles. Everyone joins at (12, 12); the Town Hall stands on x 11 to 13, y 8 and 9.
const CONFIG: WorldConfig = {
  width: 24,
  height: 24,
  plotSize: 8,
  maxPlotsPerResident: 1,
  reach: 3,
};

const cleanups: Cleanup[] = [];
// Every REST response in these tests must match the route table's schemas.
const { problems, onResponse } = responseChecker();
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
  expect(problems.splice(0)).toEqual([]);
});

async function start(solidBuildings: boolean) {
  const now = () => Date.UTC(2026, 9, 6, 12);
  const store = new MemoryStore();
  const service = new WorldService({ store, config: CONFIG, now, days: true, solidBuildings });
  const sql = nodeSql();
  const social = new SocialService({
    sql,
    media: new MemoryMediaStore(),
    resident: (id) => service.state.residents[id],
    now,
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
  const join = async (name: string) => {
    const { body } = await call("POST", "/v1/session", { name, kind: "agent" });
    return body.token as string;
  };
  return { call, join, service, store };
}

describe("walking", () => {
  it("around solid buildings: the server switches them on once, and /v1/world says so", async () => {
    const off = await start(false);
    expect((await off.call("GET", "/v1/world")).body.solidBuildings).toBeUndefined();
    const t = await start(true);
    const switches = () =>
      t.store.log.filter((i) => i.command.type === "solid_buildings").map((i) => i.actor);
    expect(switches()).toEqual([TOWN_ACTOR]);
    t.service.tick();
    expect(switches()).toEqual([TOWN_ACTOR]);
    expect((await t.call("GET", "/v1/world")).body.solidBuildings).toBe(true);
  });

  it("turns away a step onto the Town Hall, while diagonal steps around it go through", async () => {
    const t = await start(true);
    const token = await t.join("Wren");
    const move = async (dir: string) =>
      (await t.call("POST", "/v1/actions", { type: "move", dir }, token)).body;
    expect((await move("n")).ok).toBe(true);
    expect((await move("n")).ok).toBe(true);
    expect(await move("n")).toMatchObject({
      ok: false,
      error: { code: "blocked", message: "The Town Hall is in the way." },
    });
    expect((await move("nw")).ok).toBe(false);
    expect(await move("sw")).toMatchObject({ ok: true, events: [{ type: "moved", x: 11, y: 11 }] });
    // `facing` stays one of the four it has always been: a diagonal shows its side.
    const world = (await t.call("GET", "/v1/world")).body;
    expect(world.residents.find((r: { name: string }) => r.name === "Wren")?.facing).toBe("w");
  });
});
