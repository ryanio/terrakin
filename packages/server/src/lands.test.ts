import { readFileSync } from "node:fs";
import type { ServerMessage, WorldEvent as WireEvent } from "@terrakin/protocol";
import {
  apply,
  type Command,
  createWorld,
  isSea,
  isStreet,
  LANDS,
  plotsLeft,
  SEA_LOOK,
  seaFrom,
  spawnTile,
  stepFrom,
  TOWN_ACTOR,
  tileKey,
  townHallTile,
  type WorldConfig,
  walkTree,
  worldGround,
} from "@terrakin/sim";
import { afterEach, describe, expect, it } from "vitest";
import { createApp, TEST_OPEN_LAND_PATH } from "./app";
import { planLand, planProblem } from "./lands";
import { MemoryMediaStore } from "./media";
import { nodeSql } from "./node-sql";
import { plotPhotoSpec } from "./plot-photo";
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

/**
 * The island the planner lays out for `CONFIG`, as the snapshot names its coordinates: a long cross
 * (RFC 0046) from plot column 5, its square on the Commons' row. `P` is a plot, `S` a street, `Q`
 * the square, `.` water. Drawn rather than worked out, so a planner that lays something else fails.
 */
const ISLAND_MAP = ["..PSP..", "PPPSPPP", "SSSQSSS", "PPPSPPP", "..PSP..", "..PSP..", "..PSP.."];
const slotsOf = (mark: string) =>
  ISLAND_MAP.flatMap((row, py) =>
    [...row].flatMap((c, i) => (c === mark ? [{ px: 5 + i, py }] : [])),
  ).sort((a, b) => a.px - b.px || a.py - b.py);
const ISLAND_PLOTS = slotsOf("P");
const ISLAND_STREETS = slotsOf("S");
/** The island's own square, where its hall and its counter stand: nobody claims it. */
const ISLAND_SQUARE = slotsOf("Q")[0];
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
async function start(
  options: { lands?: boolean; testClock?: boolean; proposeInPerson?: boolean } = {},
) {
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
    proposeInPerson: options.proposeInPerson ?? false,
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
          square: ISLAND_SQUARE,
          streets: ISLAND_STREETS,
        },
      ],
    });
    expect(snapshot.config).toMatchObject({ width: 96, height: 56 });
    // `land_opened` is on the wire now, with coordinates named as the snapshot names them.
    const opened = events().filter((e) => e.type === "land_opened");
    expect(opened).toHaveLength(1);
    expect(opened[0]).toMatchObject({
      land: "willowmere",
      name: "Willowmere",
      width: 96,
      height: 56,
      plots: ISLAND_PLOTS,
      bridge: ISLAND_BRIDGE,
      square: ISLAND_SQUARE,
      streets: ISLAND_STREETS,
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
      list: {
        plots: { px: number; py: number }[];
        bridge: { x: number; y: number }[];
        square: { px: number; py: number };
        streets?: { px: number; py: number }[];
      }[];
    };
    const sea = seaFrom(w.service.state.config, {
      home: lands.home,
      list: lands.list.map((l) => ({
        plots: l.plots.map((p) => [p.px, p.py] as const),
        bridge: l.bridge.map((t) => [t.x, t.y] as const),
        square: [l.square.px, l.square.py] as const,
        streets: (l.streets ?? []).map((p) => [p.px, p.py] as const),
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
    // And every slot the land brought is walkable to from downtown, not just the crossing. A
    // plot joined to its island only at a corner is unreachable (a diagonal past two corners of
    // water is refused) and would strand whoever settled it, so the planner's guard walks the
    // whole land rather than the bridge's two ends.
    const state = w.service.state;
    const size = state.config.plotSize;
    const arrived = new Set(
      walkTree(ground, spawnTile(state), Math.max(state.config.width, state.config.height)).map(
        (n) => `${n.x},${n.y}`,
      ),
    );
    const slots = [...island.plots, island.square, ...(island.streets ?? [])];
    for (const [sx, sy] of slots) {
      let any = false;
      for (let y = sy * size; y < (sy + 1) * size && !any; y++) {
        for (let x = sx * size; x < (sx + 1) * size && !any; x++) {
          if (arrived.has(`${x},${y}`)) any = true;
        }
      }
      expect(any, `no walk from downtown to the slot at ${sx},${sy}`).toBe(true);
    }

    // And a photo of the shore plot draws the channel as water, not as meadow with flowers on
    // it. The map and the 3D view both draw it; a cached public PNG that disagrees with the
    // live client is the one a link preview shows.
    const photo = plotPhotoSpec(w.service.state, isla.id, { now: Date.now() });
    expect(photo, "no photo spec for the island settler").toBeTruthy();
    const fills = new Set((photo?.ground ?? []).map((g) => g.fill));
    expect([...fills], `the photo's ground fills`).toContain(SEA_LOOK.water);
  });
});

describe("the Town Hall once a land is open", () => {
  it("sends a resident on the island downtown to file", async () => {
    const w = await start({ lands: true, proposeInPerson: true });
    await w.crowd();
    w.later(60_000);
    const island = w.service.state.lands?.list[0];
    if (!island) throw new Error("no land opened");
    const [px, py] = island.plots[0] as [number, number];
    const isla = await w.settler("isla", px, py);
    // `you.hall` is downtown's door, never the hall building on the island's square, and `away`
    // names the walk back over the bridge (decision 0352).
    const town = (await w.call("GET", "/v1/town", undefined, isla.token)).body as Json;
    expect(town.you.hall).toEqual(townHallTile(w.service.state));
    expect(town.you.away).toContain("Proposals are filed at the Town Hall downtown.");
    expect(town.you.away).toContain("Walk there:");
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
    // Its square and its streets are not among them: a land brings only its plots to claim.
    expect(plotsLeft(w.service.state)).toBe(LANDS.openAt + ISLAND_PLOTS.length);
  });

  it("still opens one when the town has built on the middle of the Commons", async () => {
    const w = await start({ lands: true });
    await w.crowd();
    // The Commons is exactly where the town builds: a passed `commons_build` puts blocks on it,
    // and nothing keeps the centre clear (the game tables' spots are the only protected ones,
    // and they skip the spawn tile). Hanging the plan's reachability check on that one tile
    // would let a Town Hall vote stop any land from ever opening, silently.
    const state = w.service.state;
    const centre = spawnTile(state);
    state.blocks[tileKey(centre.x, centre.y)] = "lantern";
    expect(worldGround(state).obstacle(centre.x, centre.y)).toBe("block");
    w.later(60_000);
    expect(w.logged("open_land")).toHaveLength(1);
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

type OpenLand = Extract<Command, { type: "open_land" }>;

describe("the planner", () => {
  /** terrakin.org's shape: downtown 9 by 9 plots of 8 tiles, the Commons at (4, 4). */
  const TOWN: WorldConfig = {
    width: 72,
    height: 72,
    plotSize: 8,
    maxPlotsPerResident: 1,
    reach: 3,
  };
  const town = () => createWorld(TOWN);
  const sorted = (list: [number, number][]) => [...list].sort((a, b) => a[0] - b[0] || a[1] - b[1]);

  it("lays the first island as the long cross: 24 plots and 14 street slots", () => {
    const plan = planLand(town());
    // RFC 0046's drawing, columns 9 (the channel) to 16, rows 0 to 8.
    const drawn = [
      "~~~PSP~~",
      "~~~PSP~~",
      "~~~PSP~~",
      "~PPPSPPP",
      "=SSSQSSS",
      "~PPPSPPP",
      "~~~PSP~~",
      "~~~PSP~~",
      "~~~PSP~~",
    ];
    const has = (
      list: readonly (readonly [number, number])[] | undefined,
      px: number,
      py: number,
    ) => (list ?? []).some(([x, y]) => x === px && y === py);
    const mark = (px: number, py: number) => {
      if (has(plan?.plots, px, py)) return "P";
      if (has(plan?.streets, px, py)) return "S";
      if (plan?.square[0] === px && plan.square[1] === py) return "Q";
      const slots = (plan?.bridge ?? []).map(
        ([x, y]) => [Math.floor(x / 8), Math.floor(y / 8)] as const,
      );
      return has(slots, px, py) ? "=" : "~";
    };
    const seen = drawn.map((_, py) =>
      Array.from({ length: 8 }, (_, i) => mark(9 + i, py)).join(""),
    );
    expect(seen).toEqual(drawn);
    expect(plan).toMatchObject({ width: 17 * 8, height: 72 });
  });

  it("never opens a land without streets, for every name the town has", () => {
    const state = town();
    for (let i = 0; i < 4; i++) {
      const plan = planLand(state);
      expect(plan?.streets?.length, `land ${i + 1}`).toBeGreaterThan(0);
      if (!plan) return;
      expect(apply(state, { actor: TOWN_ACTOR, command: plan }).ok).toBe(true);
      // The bridge lands on a street, so nobody can claim the way onto the island.
      const [x, y] = plan.bridge[plan.bridge.length - 1] as [number, number];
      expect(isStreet(state, Math.floor(x / 8) + 1, Math.floor(y / 8))).toBe(true);
    }
    expect(planLand(state)).toBeUndefined();
  });

  /** The plan RFC 0038 laid: 5 by 5 plots, the square in the middle, no streets. */
  function fiveByFive(plan: OpenLand): OpenLand {
    const plots: [number, number][] = [];
    for (let px = 10; px < 15; px++) {
      for (let py = 2; py < 7; py++) if (px !== 12 || py !== 4) plots.push([px, py]);
    }
    const { streets, ...rest } = plan;
    expect(streets).toBeDefined();
    return { ...rest, width: 15 * 8, plots, square: [12, 4] };
  }

  it.each<[string, (plan: OpenLand) => OpenLand, string]>([
    ["the 5 by 5 RFC 0038 laid, with no streets", fiveByFive, "it has no streets"],
    [
      "a middle row of streets that starts past a plot at the bridge",
      (plan) => {
        const five = fiveByFive(plan);
        const streets: [number, number][] = [
          [11, 4],
          [13, 4],
          [14, 4],
        ];
        const plots = five.plots.filter(([px, py]) => py !== 4 || px === 10);
        return { ...five, plots, streets };
      },
      "no public walk joins the bridge and the counter",
    ],
    [
      "a plot behind another plot, with no side on a street",
      (plan) => ({ ...plan, plots: sorted([...plan.plots, [10, 2]]) }),
      "plot 10,2 has no way out onto a street once the land fills",
    ],
  ])("refuses %s", (_, change, why) => {
    const state = town();
    const plan = planLand(state);
    if (!plan) throw new Error("no plan");
    expect(planProblem(state, change(plan))).toBe(why);
    expect(planProblem(state, plan)).toBeUndefined();
  });
});
