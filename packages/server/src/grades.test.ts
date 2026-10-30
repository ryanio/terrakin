import { GRADING, type Input, TOWN_ACTOR, type WorldConfig } from "@terrakin/sim";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "./app";
import { MemoryMediaStore } from "./media";
import { nodeSql } from "./node-sql";
import { SocialService } from "./social-service";
import { MemoryStore } from "./store";
import { type Cleanup, jsonCaller, listenOnFreePort, responseChecker } from "./test-support";
import { WorldService } from "./world-service";

/**
 * Material grades (RFC 0051) over HTTP: a world that never logged `open_grades` refuses every
 * grade and reads as it did; once it has, a fine craft is logged with the server's roll (a dry
 * one draws none and never says masterwork), and graded things read back from the inventory, a
 * plot, its plan and map, and the world.
 */

// Settling plot (0, 0) and building the starter home leaves you on the hearth at (3, 3), inside a
// hut from (1, 1) to (5, 5).
const CONFIG: WorldConfig = {
  width: 24,
  height: 24,
  plotSize: 8,
  maxPlotsPerResident: 1,
  reach: 3,
};
const BENCH = { x: 3, y: 2 };

const cleanups: Cleanup[] = [];
const { problems, onResponse } = responseChecker();
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
  expect(problems.splice(0)).toEqual([]);
});

// biome-ignore lint/suspicious/noExplicitAny: the response checker already holds every body to its schema.
type Json = Record<string, any>;

async function start(open: boolean) {
  const now = Date.UTC(2026, 9, 30, 9);
  const store = new MemoryStore();
  const service = new WorldService({
    store,
    config: CONFIG,
    now: () => now,
    days: true,
    economy: true,
    items: true,
  });
  const sql = nodeSql();
  cleanups.push(() => sql.close());
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
  const call = jsonCaller(base);
  service.tick();
  // No adapter logs `open_grades` yet: a test logs it as the town would.
  if (open) {
    const run = (service as unknown as { run(input: Input): { ok: boolean } }).run;
    expect(
      run.call(service, { actor: TOWN_ACTOR, command: { type: "open_grades" } }),
    ).toMatchObject({ ok: true });
  }
  const { body } = await call("POST", "/v1/session", { name: "Ada", kind: "agent" });
  const ada = { id: body.residentId as string, token: body.token as string };
  const act = async (action: Json) => (await call("POST", "/v1/actions", action, ada.token)).body;
  expect(await act({ type: "settle", px: 0, py: 0 })).toMatchObject({ ok: true });
  expect(await act({ type: "build_starter_home" })).toMatchObject({ ok: true });
  expect(await act({ type: "place", ...BENCH, block: "workbench" })).toMatchObject({ ok: true });
  /** Put things in Ada's things without gathering them. Setup only. */
  const stock = (stacks: Record<string, number>, graded?: Record<string, { fine?: number }>) => {
    const items = service.state.items;
    if (!items) throw new Error("items aren't open");
    items.inventories[ada.id] = { stacks, goods: [], ...(graded ? { graded } : {}) };
  };
  return { call, act, ada, service, store, stock };
}

describe("material grades over HTTP", () => {
  it("refuses every grade, and says nothing of grades, in a world that never opened them", async () => {
    const t = await start(false);
    t.stock({ stone: 4, seashell: 2 });
    const seq = t.service.state.seq;
    const craft = { type: "craft", recipe: "plaster", ...BENCH, grade: "fine" };
    expect((await t.act(craft)).error.code).toBe("grades_closed");
    expect((await t.act({ ...craft, dry: true })).error.code).toBe("grades_closed");
    expect(t.service.state.seq).toBe(seq);
    expect((await t.call("GET", "/v1/world")).body).not.toHaveProperty("gradesOpen");
    // A plot with no graded wall has no `walls` at all.
    expect((await t.call("GET", "/v1/plots/0/0")).body.plot).not.toHaveProperty("walls");
  });

  it("logs a fine craft with the server's roll, and a dry one draws none and never says masterwork", async () => {
    const t = await start(true);
    expect((await t.call("GET", "/v1/world")).body.gradesOpen).toBe(true);
    t.stock({ stone: 4, seashell: 2 });
    // The floor is due: the next fine craft is masterwork whatever its roll. A dry run says only
    // that it makes fine, so it can't be asked when the floor comes.
    const items = t.service.state.items;
    if (items) items.fineRun = { [t.ada.id]: GRADING.floor };
    const craft = { type: "craft", recipe: "plaster", ...BENCH, grade: "fine" };
    const logged = t.store.log.length;
    const dry = await t.act({ ...craft, dry: true });
    expect(dry.cost.gets).toEqual([{ kind: "plaster", grade: "fine", count: 2 }]);
    expect(dry.cost.uses).toEqual([
      { kind: "seashell", count: 1 },
      { kind: "stone", count: 2 },
    ]);
    expect(t.store.log.length).toBe(logged);
    // A caller's own roll never reaches the log: the action has no such field, so the server's
    // stands. This one isn't a whole number, so the sim would refuse it if it got through.
    expect(await t.act({ ...craft, roll: 0.5 })).toMatchObject({ ok: true });
    const input = t.store.log.at(-1)?.command as { type: string; grade?: string; roll?: number };
    expect(input).toMatchObject({ type: "craft", grade: "fine" });
    expect(Number.isInteger(input.roll)).toBe(true);
    expect(input.roll).toBeGreaterThanOrEqual(0);
    expect(input.roll).toBeLessThan(GRADING.outOf);
    // A plain craft carries no roll.
    await t.act({ type: "craft", recipe: "plaster", ...BENCH });
    expect(t.store.log.at(-1)?.command).not.toHaveProperty("roll");
  });

  it("reads graded things back: the inventory, a plot, its plan and map, and the world", async () => {
    const t = await start(true);
    t.stock({ plaster: 3 }, { plaster: { fine: 4 } });
    const inv = (await t.call("GET", "/v1/inventory", undefined, t.ada.token)).body;
    expect(inv.inventory.stacks).toEqual([
      { kind: "plaster", count: 3 },
      { kind: "plaster", grade: "fine", count: 4 },
    ]);
    // A wall swapped for fine plaster in one plan, with the map's grades record, and a line.
    const map = {
      legend: { "0": "plaster" },
      grades: { "0": "fine" },
      floors: [
        {
          blocks: [
            "........",
            "..0.....",
            "........",
            "........",
            "........",
            "........",
            "........",
            "........",
          ],
        },
      ],
    };
    const built = await t.act({ type: "build", px: 0, py: 0, map, replace: true });
    expect(built.ok).toBe(true);
    expect(built.plan.uses).toEqual([{ kind: "plaster", grade: "fine", count: 1 }]);
    expect(
      await t.act({ type: "place", x: 3, y: 3, side: "s", block: "plaster", grade: "fine" }),
    ).toMatchObject({
      ok: true,
    });
    const plot = (await t.call("GET", "/v1/plots/0/0")).body;
    expect(plot.plot.walls).toEqual({ fine: 2, masterwork: 0 });
    const plan = (await t.call("GET", "/v1/plots/0/0/plan")).body.plan;
    expect(plan.blocks).toContainEqual({ x: 2, y: 1, block: "plaster", grade: "fine" });
    expect(plan.edges).toContainEqual({ x: 3, y: 4, side: "n", block: "plaster", grade: "fine" });
    const digit = Object.entries(plan.map.legend).find(([, kind]) => kind === "plaster")?.[0];
    expect(plan.map.grades).toEqual({ [digit as string]: "fine" });
    const world = (await t.call("GET", "/v1/world")).body;
    expect(world.blocks).toContainEqual({ x: 2, y: 1, block: "plaster", grade: "fine" });
    expect(world.blocks).toContainEqual({ x: 1, y: 1, block: "wood" });
  });
});
