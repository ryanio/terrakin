import { type Input, TOWN_ACTOR, type WorldConfig } from "@terrakin/sim";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "./app";
import { MemoryMediaStore } from "./media";
import { nodeSql } from "./node-sql";
import { SocialService } from "./social-service";
import { MemoryStore } from "./store";
import { jsonCaller, listenOnFreePort, responseChecker } from "./test-support";
import { WorldService } from "./world-service";

/**
 * Clearing the old repeat joins (issue #46, decision 0230). On a world whose log holds repeat
 * records from before names were unique, the server logs `retire_repeat_joins` once, with only
 * the records nobody used in the world or out of it, then turns their credentials off and drops
 * them from every read. This deletes residents, so each way a record counts as used is a case
 * here that keeps it.
 */

const CONFIG: WorldConfig = {
  width: 12,
  height: 12,
  plotSize: 4,
  maxPlotsPerResident: 1,
  reach: 2,
};
const DAY = 20_000;

const cleanups: (() => void | Promise<void>)[] = [];
const { problems, onResponse } = responseChecker();
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
  expect(problems.splice(0)).toEqual([]);
});

const town = (command: Input["command"]): Input => ({ actor: TOWN_ACTOR, command });
/** A record joined and left again, never used in the world. */
const unused = (actor: string, name: string): Input[] => [
  { actor, command: { type: "join", name, kind: "agent" } },
  { actor, command: { type: "leave" } },
];
/** A record someone walked with. */
const used = (actor: string, name: string): Input[] => [
  { actor, command: { type: "join", name, kind: "agent" } },
  { actor, command: { type: "move", dir: "e" } },
  { actor, command: { type: "leave" } },
];

/** A log written before names were unique. */
const LOG: Input[] = [
  town({ type: "new_day", day: DAY }),
  town({ type: "open_economy" }),
  town({ type: "open_items" }),
  ...used("r_ada", "Ada"),
  // Pip used the first record. Of the six after it, three were used out of the world (a follow, a
  // post, a block), two hold something, and one nobody touched.
  ...used("r_pip", "Pip"),
  ...unused("r_pip_follows", "Pip"),
  ...unused("r_pip_posted", "Pip"),
  ...unused("r_pip_coins", "pip"),
  ...unused("r_pip_things", "Pip"),
  ...unused("r_pip_blocks", "Pip"),
  ...unused("r_pip_unused", "Pip"),
  town({ type: "test_grant", to: "r_pip_coins", coins: 5 }),
  town({ type: "test_grant", to: "r_pip_things", stacks: { lemon: 1 } }),
  // Nobody used either Blaze: the first stays.
  ...unused("r_blaze", "Blaze"),
  ...unused("r_blaze2", "Blaze"),
  // A name nobody else has stays, used or not.
  ...unused("r_wren", "Wren"),
];

async function start(options: { retire?: boolean } = {}) {
  const now = () => DAY * 86_400_000 + 3_600_000;
  const store = new MemoryStore();
  for (const input of LOG) store.appendInput(input);
  const service = new WorldService({
    store,
    config: CONFIG,
    now,
    retireRepeatJoins: options.retire ?? true,
  });
  const sql = nodeSql();
  cleanups.push(() => sql.close());
  const media = new MemoryMediaStore();
  const social = new SocialService({
    sql,
    media,
    now,
    resident: (id) => service.state.residents[id],
  });
  // Out of the world, before anything asks the server: one record follows someone, one posts,
  // one blocks someone, and Ada follows every record, as the welcome routine did.
  expect(social.setFollow("r_pip_follows", "r_ada", true).ok).toBe(true);
  expect(social.setBlock("r_pip_blocks", "r_wren", true).ok).toBe(true);
  expect(social.createPost("r_pip_posted", { text: "Hello from the garden" }).ok).toBe(true);
  for (const id of ["r_pip_unused", "r_blaze2", "r_blaze", "r_pip"]) {
    expect(social.setFollow("r_ada", id, true).ok).toBe(true);
  }
  const server = createApp({
    service,
    social,
    media,
    actionsPerSecond: 1000,
    sessionsPerMinute: 1000,
    onResponse,
  });
  const call = jsonCaller(await listenOnFreePort(server, cleanups));
  return { call, service, social, sql, store };
}

const retireInputs = (store: MemoryStore) =>
  store.loadLog().filter((i) => i.command.type === "retire_repeat_joins");

describe("clearing the old repeat joins", () => {
  it("retires only the records nobody used, once, and keeps one of every name", async () => {
    const { call, service, store } = await start();
    // Nothing is logged before the social layer can say who used their record.
    expect(retireInputs(store)).toEqual([]);

    const world = await call("GET", "/v1/world");
    expect(world.status).toBe(200);
    expect(retireInputs(store)).toEqual([
      town({ type: "retire_repeat_joins", ids: ["r_blaze2", "r_pip_unused"] }),
    ]);
    const ids = world.body.residents.map((r: { id: string }) => r.id);
    expect(ids).not.toContain("r_pip_unused");
    expect(ids).not.toContain("r_blaze2");
    for (const kept of [
      "r_ada",
      "r_pip",
      "r_pip_follows",
      "r_pip_posted",
      "r_pip_coins",
      "r_pip_things",
      "r_pip_blocks",
      "r_blaze",
      "r_wren",
    ]) {
      expect(ids).toContain(kept);
    }
    // The ones kept still leave the count, as before.
    expect(world.body.repeatJoins).toEqual([
      "r_pip_follows",
      "r_pip_posted",
      "r_pip_coins",
      "r_pip_things",
      "r_pip_blocks",
    ]);

    // Once: another request, and a restart on the same log, log nothing more.
    const seq = service.state.seq;
    await call("GET", "/v1/world");
    expect(service.state.seq).toBe(seq);
    const again = new WorldService({ store, config: CONFIG, retireRepeatJoins: true });
    again.socialUsers = () => new Set();
    again.tick();
    expect(retireInputs(store)).toHaveLength(1);
  });

  it("turns a retired record's token and link key off and drops it from profiles and lists", async () => {
    const { call, service, sql } = await start();
    const token = service.issueToken("r_pip_unused");
    const key = service.mintLinkKey("r_pip_unused");
    const ada = service.issueToken("r_ada");

    const profile = await call("GET", "/v1/residents/r_pip_unused");
    expect(profile.status).toBe(404);
    expect((await call("GET", "/v1/residents/r_blaze2")).status).toBe(404);

    const checkin = await call("GET", "/v1/checkin", undefined, token);
    expect(checkin.status).toBe(401);
    expect(checkin.body.error.code).toBe("revoked");
    expect(checkin.body.error.message).toContain("repeat record");
    const link = await call("GET", `/v1/act/${key}/checkin`);
    expect(link.status).toBe(401);
    expect(JSON.stringify(link.body)).toContain("repeat record");

    // Ada followed four records; the two retired ones leave her list and her count.
    const following = await call("GET", "/v1/residents/r_ada/following", undefined, ada);
    expect(following.body.residents.map((r: { id: string }) => r.id).sort()).toEqual([
      "r_blaze",
      "r_pip",
    ]);
    expect((await call("GET", "/v1/residents/r_ada", undefined, ada)).body.resident).toMatchObject({
      following: 2,
    });
    const left = [
      ...sql.exec(
        "SELECT follower FROM follows WHERE followee IN ('r_pip_unused', 'r_blaze2') UNION SELECT resident_id FROM profiles WHERE resident_id IN ('r_pip_unused', 'r_blaze2')",
      ),
    ];
    expect(left).toEqual([]);
  });

  it("never runs in a world that doesn't turn it on", async () => {
    const { call, service, store } = await start({ retire: false });
    await call("GET", "/v1/world");
    expect(retireInputs(store)).toEqual([]);
    expect(service.state.residents.r_pip_unused).toBeDefined();
  });
});
