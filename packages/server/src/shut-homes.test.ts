import { type Input, TOWN_ACTOR, tileKey, type WorldConfig } from "@terrakin/sim";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "./app";
import { MemoryMediaStore } from "./media";
import { nodeSql } from "./node-sql";
import { SocialService } from "./social-service";
import { MemoryStore } from "./store";
import { jsonCaller, listenOnFreePort, responseChecker } from "./test-support";
import { WorldService } from "./world-service";

/**
 * Homes nobody can walk out of (decision 0343): staff find them with the sim's own walk, and a
 * maintainer opens one by taking a block off a plot, which tells the plot's owner. The cases that
 * matter are that the finder and the walk agree, that a dry run changes nothing, and that only a
 * maintainer can clear.
 */

const CONFIG: WorldConfig = {
  width: 24,
  height: 24,
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
  // Vee builds the starter hut on plot (0, 0), walls (1, 1) to (5, 5) and her hearth at (3, 3),
  // then fills its doorway at (3, 5), which shuts her in.
  const vee = await join("Vee");
  const act = (command: Record<string, unknown>) => call("POST", "/v1/actions", command, vee.token);
  expect((await act({ type: "settle", px: 0, py: 0 })).status).toBe(200);
  expect((await act({ type: "build_starter_home" })).status).toBe(200);
  expect((await act({ type: "place", x: 3, y: 5, block: "wood" })).status).toBe(200);
  const clear = (body: Record<string, unknown>, who: Who = mira) =>
    call("POST", "/v1/admin/clear-block", { reason: "Shut in", ...body }, who.token);
  return { call, service, sql, mira, otto, vee, clear };
}

describe("homes nobody can walk out of", () => {
  it("lists a shut-in hearth with the blocks that would each free it", async () => {
    const { call, mira, vee } = await start();
    const res = await call("GET", "/v1/admin/shut-homes", undefined, mira.token);
    expect(res.status).toBe(200);
    const homes = res.body.homes as {
      resident: { id: string };
      hearth: { x: number; y: number };
      frees: { x: number; y: number; block: string; owner: { id: string } }[];
    }[];
    expect(homes.map((h) => h.resident.id)).toEqual([vee.residentId]);
    expect(homes[0]?.hearth).toEqual({ x: 3, y: 3 });
    expect(homes[0]?.frees).toContainEqual(
      expect.objectContaining({
        x: 3,
        y: 5,
        block: "wood",
        owner: expect.objectContaining({ id: vee.residentId }),
      }),
    );
  });

  it("walks a slimmed home's walls between tiles: a block outside them frees nobody", async () => {
    const { call, mira, vee, clear } = await start();
    const act = (command: Record<string, unknown>) =>
      call("POST", "/v1/actions", command, vee.token);
    // Her walls go up on the lines round the same 25 tiles, the wood in the doorway with them, so
    // she is still shut in, and a block just outside them is no way out.
    expect((await act({ type: "slim_walls", px: 0, py: 0 })).status).toBe(200);
    expect((await act({ type: "place", x: 3, y: 6, block: "wood" })).status).toBe(200);
    const res = await call("GET", "/v1/admin/shut-homes", undefined, mira.token);
    expect(res.body.homes).toMatchObject([{ resident: { id: vee.residentId }, frees: [] }]);
    expect((await clear({ x: 3, y: 6, dry: true })).body).toMatchObject({ walksOut: false });
  });

  it("refuses anyone but a maintainer, and a dry run says it would free her and changes nothing", async () => {
    const { service, otto, vee, clear } = await start();
    expect((await clear({ x: 3, y: 5 }, vee)).status).toBe(403);
    // A moderator is staff, but this changes a resident's home: maintainers only.
    expect((await clear({ x: 3, y: 5 }, otto)).status).toBe(403);
    const seq = service.state.seq;
    const dry = await clear({ x: 3, y: 5, dry: true });
    expect(dry.status).toBe(200);
    expect(dry.body).toMatchObject({ x: 3, y: 5, block: "wood", walksOut: true, cleared: false });
    expect(service.state.seq).toBe(seq);
    expect(service.state.blocks[tileKey(3, 5)]).toBe("wood");
    // A tile with nothing on it is the sim's refusal, and nothing is logged.
    expect((await clear({ x: 3, y: 3 })).body.error.code).toBe("no_block");
    expect(service.state.seq).toBe(seq);
  });

  it("clears the block, tells its owner from Terrakin, and logs who and why", async () => {
    const { call, service, sql, mira, vee, clear } = await start();
    const res = await clear({ x: 3, y: 5 });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ block: "wood", walksOut: true, cleared: true });
    expect(service.state.blocks[tileKey(3, 5)]).toBeUndefined();
    expect((await call("GET", "/v1/admin/shut-homes", undefined, mira.token)).body.homes).toEqual(
      [],
    );

    const notices = (await call("GET", "/v1/notifications", undefined, vee.token)).body
      .notifications as { type: string; system?: boolean; cleared?: unknown }[];
    expect(notices.filter((n) => n.type === "block_cleared")).toEqual([
      expect.objectContaining({ system: true, cleared: { x: 3, y: 5, block: "wood" } }),
    ]);
    const logged = [...sql.exec("SELECT * FROM moderation_log WHERE action = 'clear_block'")];
    expect(logged).toEqual([
      expect.objectContaining({
        actor: mira.residentId,
        target: vee.residentId,
        reason: "At 3,5: Shut in",
      }),
    ]);
  });
});
