import {
  apply,
  createWorld,
  type Input,
  landlocked,
  TOWN_ACTOR,
  tileKey,
  type WorldConfig,
  walkTree,
  worldGround,
} from "@terrakin/sim";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "./app";
import { MemoryMediaStore } from "./media";
import { nodeSql } from "./node-sql";
import { SocialService } from "./social-service";
import { MemoryStore } from "./store";
import { jsonCaller, listenOnFreePort, responseChecker } from "./test-support";
import { planWays } from "./way-plan";
import { wayConflicts, wayFactsFrom, wayInputs } from "./ways";
import { WorldService } from "./world-service";

/**
 * Downtown's public ways (RFC 0046, Option 1, by town rule): the planner joins every plot to the
 * Commons, the staff route checks the whole plan with the sim before it lays anything, and each
 * owner whose plot changed hears it from Terrakin.
 */

const CONFIG: WorldConfig = {
  width: 32,
  height: 32,
  plotSize: 8,
  maxPlotsPerResident: 1,
  reach: 3,
};
const DAY = 20_000;
const town = (command: Input["command"]): Input => ({ actor: TOWN_ACTOR, command });

const cleanups: (() => void | Promise<void>)[] = [];
const { problems, onResponse } = responseChecker();
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
  expect(problems.splice(0)).toEqual([]);
});

interface Who {
  residentId: string;
  token: string;
}

/**
 * Downtown 4 by 4 with the Commons at (2, 2). Ada, Bo, Cy and Dee each build a starter hut on the
 * four plots in the north-west corner, so Ada's, at (0, 0), has a claimed plot on every side.
 */
async function start() {
  const now = () => DAY * 86_400_000 + 3_600_000;
  const store = new MemoryStore();
  for (const command of [
    { type: "new_day", day: DAY },
    { type: "open_economy" },
    { type: "open_items" },
    { type: "open_shop" },
    { type: "solid_buildings" },
  ] as Input["command"][]) {
    store.appendInput(town(command));
  }
  const service = new WorldService({ store, config: CONFIG, now });
  const sql = nodeSql();
  cleanups.push(() => sql.close());
  const maintainers = new Set<string>();
  const moderators = new Set<string>();
  const media = new MemoryMediaStore();
  const social = new SocialService({
    sql,
    media,
    maintainers,
    moderators,
    now,
    resident: (id) => service.state.residents[id],
  });
  const server = createApp({
    service,
    social,
    media,
    actionsPerSecond: 1000,
    sessionsPerMinute: 1000,
    onResponse,
  });
  const call = jsonCaller(await listenOnFreePort(server, cleanups));
  const join = async (name: string): Promise<Who> =>
    (await call("POST", "/v1/session", { name, kind: "human" })).body as Who;
  const mira = await join("Mira");
  maintainers.add(mira.residentId);
  const otto = await join("Otto");
  moderators.add(otto.residentId);
  const homes: Who[] = [];
  for (const [name, px, py] of [
    ["Ada", 0, 0],
    ["Bo", 1, 0],
    ["Cy", 0, 1],
    ["Dee", 1, 1],
  ] as const) {
    const who = await join(name);
    const act = (command: Record<string, unknown>) =>
      call("POST", "/v1/actions", command, who.token);
    expect((await act({ type: "settle", px, py })).status).toBe(200);
    expect((await act({ type: "build_starter_home" })).status).toBe(200);
    homes.push(who);
  }
  const lay = (body: Record<string, unknown>, who: Who = mira) =>
    call("POST", "/v1/admin/ways", { reason: "Streets for downtown", ...body }, who.token);
  return { call, service, sql, store, mira, otto, homes, lay };
}

describe("laying downtown's ways", () => {
  it("is for maintainers, and a dry run plans the network and lays nothing", async () => {
    const { service, otto, homes, lay } = await start();
    expect((await lay({}, homes[0])).status).toBe(403);
    expect((await lay({}, otto)).status).toBe(403);
    expect(landlocked(service.state).map((p) => `${p.px},${p.py}`)).toEqual(["0,0"]);
    const seq = service.state.seq;
    const dry = await lay({ dry: true });
    expect(dry.status).toBe(200);
    expect(dry.body).toMatchObject({ laid: false, conflicts: [], unjoined: [] });
    // Free slots the network runs over are laid too, so a later claim can't cut it.
    expect(dry.body.free.length).toBeGreaterThan(0);
    expect(service.state.seq).toBe(seq);
    expect(service.state.ways).toBeUndefined();
  });

  it("lays it, so every plot has a way out, and tells each owner whose plot it crosses", async () => {
    const { call, service, sql, mira, homes, lay } = await start();
    const res = await lay({});
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ laid: true, conflicts: [] });
    expect(landlocked(service.state)).toEqual([]);
    const world = (await call("GET", "/v1/world")).body;
    expect(world.ways).toHaveLength(res.body.tiles.length);

    // Each owner whose plot it crosses hears it from Terrakin, once, with the count of tiles.
    for (const plot of res.body.plots as { ownerId: string; tiles: unknown[] }[]) {
      const who = homes.find((h) => h.residentId === plot.ownerId);
      if (!who) throw new Error("a plot nobody here owns");
      const notices = (await call("GET", "/v1/notifications", undefined, who.token)).body
        .notifications as { type: string; system?: boolean; way?: { tiles: number } }[];
      expect(notices.filter((n) => n.type === "way_laid")).toEqual([
        expect.objectContaining({
          system: true,
          way: expect.objectContaining({ tiles: plot.tiles.length }),
        }),
      ]);
    }
    const logged = [...sql.exec("SELECT * FROM moderation_log WHERE action = 'open_way'")];
    expect(logged).toHaveLength(res.body.plots.length);
    expect(logged[0]).toMatchObject({ actor: mira.residentId });

    // Laid again, there is nothing left to do.
    expect((await lay({})).body).toMatchObject({ inputs: 0, laid: false });

    // And a block on a way is refused on the wire, in the words that say why.
    const [first] = res.body.plots as { ownerId: string; tiles: { x: number; y: number }[] }[];
    const owner = homes.find((h) => h.residentId === first?.ownerId);
    const [stand, tile] = first?.tiles ?? [];
    if (!owner || !stand || !tile) throw new Error("nothing laid");
    const me = service.state.residents[owner.residentId];
    if (!me) throw new Error("no owner");
    me.x = stand.x;
    me.y = stand.y;
    const placed = await call(
      "POST",
      "/v1/actions",
      { type: "place", x: tile.x, y: tile.y, block: "wood", dry: true },
      owner.token,
    );
    expect(placed.body.error.code).toBe("public_way");
  });

  it("says where it stopped when a save fails, and run again finishes it", async () => {
    const { service, store, lay } = await start();
    const append = store.appendInput.bind(store);
    let failed = false;
    store.appendInput = (input) => {
      if (input.command.type === "open_way" && !failed) {
        failed = true;
        throw new Error("disk full");
      }
      return append(input);
    };
    const stopped = await lay({});
    expect(stopped.status).toBe(500);
    expect(stopped.body.error.message).toMatch(/^Stopped at input \d+ of \d+ \(open_way\)/);
    expect(service.state.ways).toBeUndefined();
    expect((await lay({})).body).toMatchObject({ laid: true, conflicts: [] });
    expect(landlocked(service.state)).toEqual([]);
    expect(store.log.filter((i) => i.command.type === "open_way")).toHaveLength(1);
  });
});

type World = ReturnType<typeof createWorld>;
const PLANTED = [11, 12, 13].flatMap((x) => [tileKey(x, 0), tileKey(x, 7)]);
/** Bo's walls the town can't clear (a crop, a display), all but the rows in `open`. */
const shutBut = (open: readonly number[]) =>
  [0, 1, 2, 3, 4, 5, 6, 7]
    .filter((y) => !open.includes(y))
    .flatMap((y) => [tileKey(10, y), tileKey(14, y)]);

/**
 * Downtown 4 plots by 1, the Commons at (2, 0). Ada's plot (0, 0) reaches the Commons only across
 * Bo's (1, 0), whose home's walls run the whole height of his plot at x 10 and x 14, with planters
 * along its top and bottom rows, so the way has to go through his home.
 */
function stripWorld(hearth: { x: number; y: number }): World {
  const state = createWorld({
    width: 32,
    height: 8,
    plotSize: 8,
    maxPlotsPerResident: 1,
    reach: 3,
  });
  for (const command of [
    { type: "new_day", day: 20_000 },
    { type: "open_economy" },
    { type: "open_items" },
  ] as const) {
    expect(apply(state, { actor: TOWN_ACTOR, command }).ok).toBe(true);
  }
  for (const [id, px] of [
    ["ada", 0],
    ["bo", 1],
  ] as const) {
    expect(apply(state, { actor: id, command: { type: "join", name: id, kind: "agent" } }).ok).toBe(
      true,
    );
    expect(apply(state, { actor: id, command: { type: "settle", px, py: 0 } }).ok).toBe(true);
  }
  const ada = state.residents.ada;
  const bo = state.residents.bo;
  if (!ada || !bo) throw new Error("nobody here");
  ada.hearth = { x: 3, y: 3 };
  bo.hearth = hearth;
  for (let y = 0; y < 8; y++) {
    state.blocks[tileKey(10, y)] = "stone";
    state.blocks[tileKey(14, y)] = "stone";
  }
  for (const key of PLANTED) state.blocks[key] = "planter";
  return state;
}

/** The plan for the strip, with the walls but the rows in `open` held where they stand. */
function stripPlan(state: World, open: readonly number[]) {
  const facts = wayFactsFrom(state);
  return planWays({ ...facts, fixed: new Set([...facts.fixed, ...PLANTED, ...shutBut(open)]) });
}

/** Whether a hearth walks to the Commons, plot (2, 0). */
const walksToCommons = (state: World, from: { x: number; y: number }) =>
  walkTree(worldGround(state), from, 32).some((n) => n.x >= 16 && n.x < 24);

describe("a home the way cuts through", () => {
  it.each<[string, { x: number; y: number }, number[], boolean]>([
    ["the hearth north of the way", { x: 12, y: 2 }, [5], false],
    ["the hearth south of the way", { x: 12, y: 5 }, [3], false],
    // The review's repro: the door went up on the far side of the way from the hearth, and the
    // home behind its new wall had no way out at all.
    ["the hearth south of the way, its own door north of it", { x: 12, y: 5 }, [3], true],
  ])(
    "goes back up on the hearth's side, closed, with a door onto it: %s",
    (_, hearth, open, door) => {
      const state = stripWorld(hearth);
      if (door) state.blocks[tileKey(14, 1)] = "door";
      const plan = stripPlan(state, open);
      expect(plan.unjoined).toEqual([]);
      const [home] = plan.homes;
      expect(home).toMatchObject({ px: 1, py: 0, ownerId: "bo", left: [] });
      expect(home?.rebuild.filter((b) => b.block === "door")).toHaveLength(1);
      const inputs = wayInputs(plan, 8);
      expect(wayConflicts(state, inputs)).toEqual([]);
      for (const command of inputs)
        expect(apply(state, { actor: TOWN_ACTOR, command }).ok).toBe(true);

      // With the door shut his hearth's walk on his plot reaches no way tile; through the door it
      // steps onto one, and on to the Commons.
      const ground = worldGround(state);
      const shut = {
        config: ground.config,
        obstacle: (x: number, y: number) =>
          state.blocks[tileKey(x, y)] === "door" ? ("block" as const) : ground.obstacle(x, y),
      };
      const inside = walkTree(shut, hearth, 8).map((n) => tileKey(n.x, n.y));
      expect(inside.some((key) => state.ways?.[key])).toBe(false);
      expect(walksToCommons(state, hearth)).toBe(true);
      expect(landlocked(state)).toEqual([]);
    },
  );

  it("planned again after a run that stopped anywhere, finishes without doing anything twice", () => {
    const first = wayInputs(stripPlan(stripWorld({ x: 12, y: 5 }), [3]), 8);
    expect(first.map((c) => c.type)).toEqual([
      "clear_block",
      "clear_block",
      "open_way",
      "rebuild_home",
    ]);
    for (let stop = 1; stop < first.length; stop++) {
      const state = stripWorld({ x: 12, y: 5 });
      for (const command of first.slice(0, stop)) {
        expect(apply(state, { actor: TOWN_ACTOR, command }).ok).toBe(true);
      }
      const rest = wayInputs(stripPlan(state, [3]), 8);
      // Nothing that went in goes in again: no block cleared twice, no tile laid twice.
      const done = new Set(first.slice(0, stop).map((c) => JSON.stringify(c)));
      expect(rest.filter((c) => done.has(JSON.stringify(c)))).toEqual([]);
      const laid = new Set(Object.keys(state.ways ?? {}));
      const again = rest.flatMap((c) => (c.type === "open_way" ? c.tiles : []));
      expect(again.filter(([x, y]) => laid.has(tileKey(x, y)))).toEqual([]);
      expect(wayConflicts(state, rest)).toEqual([]);
      for (const command of rest)
        expect(apply(state, { actor: TOWN_ACTOR, command }).ok).toBe(true);
      expect(wayInputs(stripPlan(state, [3]), 8)).toEqual([]);
      expect(walksToCommons(state, { x: 12, y: 5 })).toBe(true);
      expect(landlocked(state)).toEqual([]);
    }
  });

  it("refuses a plan that would wall a hearth in", () => {
    const state = stripWorld({ x: 12, y: 5 });
    state.blocks[tileKey(14, 5)] = "door";
    expect(walksToCommons(state, { x: 12, y: 5 })).toBe(true);
    // A wall across Bo's room between his hearth and his door, which no plan of ours lays.
    const walls = [11, 12, 13].map((x) => ({ x: x - 8, y: 4, block: "stone" as const }));
    const walls2 = [
      { x: 5, y: 5, block: "stone" as const },
      { x: 5, y: 6, block: "stone" as const },
    ];
    const conflicts = wayConflicts(state, [
      { type: "rebuild_home", px: 1, py: 0, blocks: [...walls, ...walls2], remove: [] },
    ]);
    expect(conflicts.map((c) => c.code)).toContain("walled_in");
  });

  it("lists every owner a returned block wouldn't fit, before anything is laid", () => {
    const state = stripWorld({ x: 12, y: 5 });
    state.blocks[tileKey(14, 3)] = "fence";
    const items = state.items;
    if (!items) throw new Error("no items");
    items.inventories.bo = { stacks: { wood: 200 }, goods: [] };
    const conflicts = wayConflicts(state, wayInputs(stripPlan(state, [3]), 8));
    expect(conflicts).toContainEqual(
      expect.objectContaining({ code: "inventory_full", ownerId: "bo", x: 14, y: 3 }),
    );
  });

  it.each<[string, (s: World) => void]>([
    [
      "stairs",
      (s) => {
        s.blocks[tileKey(14, 3)] = "stairs";
      },
    ],
    [
      "an upstairs over the way",
      (s) => {
        s.floors = { "1": { blocks: {}, ground: { [tileKey(14, 3)]: "planks" } } };
      },
    ],
    [
      "a plot for sale",
      (s) => {
        s.plotMarket = {
          listings: { "1,0": { px: 1, py: 0, seller: "bo", price: 100, day: 0 } },
        };
      },
    ],
  ])("never crosses %s", (_, change) => {
    const state = stripWorld({ x: 12, y: 5 });
    change(state);
    const plan = stripPlan(state, [3]);
    expect(plan.tiles.some((t) => t.x === 14 && t.y === 3)).toBe(false);
    expect(plan.unjoined.map((u) => u.target)).toContain("plot 0,0");
  });
});
