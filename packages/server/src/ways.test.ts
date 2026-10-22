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
import { wayFactsFrom, wayInputs, wayRefusal } from "./ways";
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
  return { call, service, sql, mira, otto, homes, lay };
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
    expect(dry.body).toMatchObject({ laid: false, refused: null, unjoined: [] });
    expect(dry.body.tiles.length).toBeGreaterThan(0);
    expect(service.state.seq).toBe(seq);
    expect(service.state.ways).toBeUndefined();
  });

  it("lays it, so every plot has a way out, and tells each owner whose plot it crosses", async () => {
    const { call, service, sql, mira, homes, lay } = await start();
    const res = await lay({});
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ laid: true, refused: null });
    expect(landlocked(service.state)).toEqual([]);
    const world = (await call("GET", "/v1/world")).body;
    expect(world.ways).toHaveLength(res.body.tiles.length);

    // Each owner whose plot it crosses hears it from Terrakin, with the count of tiles.
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
});

describe("a home the way cuts through", () => {
  it("comes down where the way runs and goes back up beside it, closed, with a door onto it", () => {
    // Downtown 4 plots by 1, the Commons at (2, 0). Ada's plot (0, 0) reaches the Commons only
    // across Bo's (1, 0), whose home's walls run the whole height of his plot at x 10 and x 14,
    // and whose top and bottom rows are planted, so the way has to go through his home.
    const state = createWorld({
      width: 32,
      height: 8,
      plotSize: 8,
      maxPlotsPerResident: 1,
      reach: 3,
    });
    for (const [id, px] of [
      ["ada", 0],
      ["bo", 1],
    ] as const) {
      expect(
        apply(state, { actor: id, command: { type: "join", name: id, kind: "agent" } }).ok,
      ).toBe(true);
      expect(apply(state, { actor: id, command: { type: "settle", px, py: 0 } }).ok).toBe(true);
    }
    const ada = state.residents.ada;
    const bo = state.residents.bo;
    if (!ada || !bo) throw new Error("nobody here");
    ada.hearth = { x: 3, y: 3 };
    bo.hearth = { x: 12, y: 3 };
    for (let y = 0; y < 8; y++) {
      state.blocks[tileKey(10, y)] = "stone";
      state.blocks[tileKey(14, y)] = "stone";
    }
    const planted = [11, 12, 13].flatMap((x) => [tileKey(x, 0), tileKey(x, 7)]);
    for (const key of planted) state.blocks[key] = "planter";
    const facts = wayFactsFrom(state);
    const plan = planWays({ ...facts, fixed: new Set([...facts.fixed, ...planted]) });
    expect(plan.unjoined).toEqual([]);
    const [home] = plan.homes;
    expect(home).toMatchObject({ px: 1, py: 0, ownerId: "bo", left: [] });
    expect(home?.rebuild.filter((b) => b.block === "door")).toHaveLength(1);

    const inputs = wayInputs(plan, 8);
    expect(inputs.map((c) => c.type)).toEqual([
      "clear_block",
      "clear_block",
      "open_way",
      "rebuild_home",
    ]);
    expect(wayRefusal(state, inputs)).toBeNull();
    for (const command of inputs)
      expect(apply(state, { actor: TOWN_ACTOR, command }).ok).toBe(true);

    // Bo's home is closed again: with the door shut, his hearth's walk on his plot reaches no way
    // tile, and through the door it steps straight onto one.
    const ground = worldGround(state);
    const shut = {
      config: ground.config,
      obstacle: (x: number, y: number) =>
        state.blocks[tileKey(x, y)] === "door" ? ("block" as const) : ground.obstacle(x, y),
    };
    const inside = walkTree(shut, bo.hearth, 8).map((n) => tileKey(n.x, n.y));
    expect(inside.some((key) => state.ways?.[key])).toBe(false);
    const door = home?.rebuild.find((b) => b.block === "door");
    if (!door) throw new Error("no door");
    const out = walkTree(ground, bo.hearth, 8).map((n) => tileKey(n.x, n.y));
    expect(out).toContain(tileKey(door.x, door.y));
    expect(landlocked(state).map((p) => `${p.px},${p.py}`)).not.toContain("0,0");
  });
});
