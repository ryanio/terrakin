import { PAT_LIMITS, type ServerMessage, type WorldEvent } from "@terrakin/protocol";
import type { WorldConfig } from "@terrakin/sim";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "./app";
import { pickTryNext } from "./checkin-suggest";
import { MemoryMediaStore } from "./media";
import { nodeSql } from "./node-sql";
import { SocialService } from "./social-service";
import { MemoryStore } from "./store";
import { type Cleanup, jsonCaller, listenOnFreePort, responseChecker } from "./test-support";
import { DAY_MS, WorldService } from "./world-service";

/**
 * Pets (RFC 0019) over HTTP: patting (a social row, like praise), the pet on profiles and in the
 * world, names through the edge filters and held back by a quarantine, treats across a block, and
 * the notifications and check-in lines an owner gets.
 */

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

// biome-ignore lint/suspicious/noExplicitAny: the response checker already holds every body to its schema.
type Json = Record<string, any>;

async function start() {
  // Noon UTC, so "the next UTC day" is half a day away.
  let now = Date.UTC(2026, 9, 6, 12);
  const service = new WorldService({
    store: new MemoryStore(),
    config: CONFIG,
    now: () => now,
    days: true,
    economy: true,
    items: true,
  });
  const sql = nodeSql();
  const media = new MemoryMediaStore();
  const social = new SocialService({
    sql,
    media,
    resident: (id: string) => service.state.residents[id],
    now: () => now,
  });
  const server = createApp({
    service,
    social,
    media,
    actionsPerSecond: 1000,
    sessionsPerMinute: 1000,
    onResponse,
  });
  cleanups.push(() => sql.close());
  const call = jsonCaller(await listenOnFreePort(server, cleanups));
  const act = async (token: string, action: Json) =>
    (await call("POST", "/v1/actions", action, token)).body as Json;
  function join(name: string) {
    const made = service.createSession({ name, kind: "agent" });
    if (!made.ok || !made.residentId || !made.token) throw new Error(`Couldn't join ${name}`);
    return { id: made.residentId, token: made.token };
  }
  /** Join, settle plot (px, py), and build a home, which sets a hearth. */
  async function settler(name: string, px: number, py = 0) {
    const r = join(name);
    expect((await act(r.token, { type: "settle", px, py })).ok).toBe(true);
    expect((await act(r.token, { type: "build_starter_home" })).ok).toBe(true);
    return r;
  }
  const adopt = (token: string, name = "Biscuit") =>
    act(token, { type: "adopt_pet", kind: "cat", coat: "ginger", name });
  const pat = (from: { token: string }, owner: { id: string }) =>
    call("POST", `/v1/residents/${owner.id}/pet/pat`, undefined, from.token);
  return {
    service,
    social,
    call,
    act,
    join,
    settler,
    adopt,
    pat,
    advance: (ms: number) => (now += ms),
  };
}

describe("patting a pet", () => {
  it("counts the patter once on the profile, tells the owner and every screen, and never says who", async () => {
    const t = await start();
    const ivy = await t.settler("Ivy", 0);
    const tam = await t.settler("Tam", 2);
    expect((await t.adopt(tam.token)).ok).toBe(true);
    const heard: ServerMessage[] = [];
    cleanups.push(t.service.subscribe(ivy.id, (m) => heard.push(m)));

    const res = await t.pat(ivy, tam);
    expect(res.status).toBe(201);
    expect(res.body.resident.pet).toMatchObject({ kind: "cat", name: "Biscuit", pats: 1 });
    expect(res.body.resident.pet.pattedToday).toBe(true);
    expect(heard).toContainEqual({ type: "pet_patted", owner: tam.id });
    // Anyone can see the count; only the patter sees pattedToday.
    const anon = (await t.call("GET", `/v1/residents/${tam.id}`)).body.resident.pet;
    expect(anon.pats).toBe(1);
    expect(anon.pattedToday).toBeUndefined();

    const notes = (await t.call("GET", "/v1/notifications", undefined, tam.token)).body;
    expect(notes.notifications[0]).toMatchObject({
      type: "pet_pat",
      actor: { id: ivy.id },
      count: 1,
      postId: null,
      pet: { kind: "cat", name: "Biscuit" },
    });
  });

  it("shares one notification a day for a pet, and counts each patter once ever", async () => {
    const t = await start();
    const tam = await t.settler("Tam", 2);
    await t.adopt(tam.token);
    const ivy = t.join("Ivy");
    const bo = t.join("Bo");
    expect((await t.pat(ivy, tam)).status).toBe(201);
    expect((await t.pat(bo, tam)).status).toBe(201);
    let notes = (await t.call("GET", "/v1/notifications", undefined, tam.token)).body;
    expect(notes.notifications).toHaveLength(1);
    expect(notes.notifications[0]).toMatchObject({
      type: "pet_pat",
      count: 2,
      actor: { id: bo.id },
    });

    t.advance(DAY_MS / 2);
    const again = await t.pat(ivy, tam);
    expect(again.status).toBe(201);
    expect(again.body.resident.pet.pats).toBe(2);
    notes = (await t.call("GET", "/v1/notifications", undefined, tam.token)).body;
    expect(notes.notifications.map((n: Json) => n.count)).toEqual([1, 2]);
  });

  it("refuses your own pet, no pet, no token, across a block either way, and a suspended patter", async () => {
    const t = await start();
    const ivy = await t.settler("Ivy", 0);
    const tam = await t.settler("Tam", 2);
    expect((await t.pat(ivy, tam)).status).toBe(404);
    await t.adopt(tam.token);
    const own = await t.pat(tam, tam);
    expect(own.status).toBe(400);
    expect(own.body.error.code).toBe("bad_request");
    expect((await t.call("POST", `/v1/residents/${tam.id}/pet/pat`)).status).toBe(401);
    expect((await t.pat(ivy, { id: "r_0000000000000000" })).status).toBe(404);
    await t.call("PUT", `/v1/residents/${ivy.id}/block`, undefined, tam.token);
    expect((await t.pat(ivy, tam)).status).toBe(403);
    const ivysPet = await t.adopt(ivy.token, "Pip");
    expect(ivysPet.ok).toBe(true);
    expect((await t.pat(tam, ivy)).status).toBe(403);
    const bo = t.join("Bo");
    expect(t.social.safety.suspend("staff", bo.id, 1, "test").ok).toBe(true);
    const suspended = await t.pat(bo, tam);
    expect(suspended.status).toBe(403);
    expect(suspended.body.error.code).toBe("suspended");
    expect((await t.call("GET", `/v1/residents/${tam.id}`)).body.resident.pet.pats).toBe(0);
  });

  it("refuses a second pat of one pet in a UTC day until midnight", async () => {
    const t = await start();
    const ivy = t.join("Ivy");
    const tam = await t.settler("Tam", 2);
    await t.adopt(tam.token);
    expect((await t.pat(ivy, tam)).status).toBe(201);
    const again = await t.pat(ivy, tam);
    expect(again.status).toBe(429);
    expect(again.body.error.code).toBe("rate_limited");
    expect(Number(again.headers.get("retry-after"))).toBe(DAY_MS / 2 / 1000);
  });

  it(`stops one patter at ${PAT_LIMITS.perPatterPerDay} pets a day`, async () => {
    const t = await start();
    const ivy = t.join("Ivy");
    const owners = [];
    for (let i = 0; i <= PAT_LIMITS.perPatterPerDay; i++) {
      const o = t.join(`Owner ${i}`);
      // This world has no room for that many homes, so these pets go straight onto it.
      const r = t.service.state.residents[o.id];
      if (r) r.pet = { kind: "duck", coat: "white", name: `Duck ${i}` };
      owners.push(o);
    }
    for (const o of owners.slice(0, PAT_LIMITS.perPatterPerDay)) {
      expect((await t.pat(ivy, o)).status).toBe(201);
    }
    const over = await t.pat(ivy, owners[PAT_LIMITS.perPatterPerDay] as { id: string });
    expect(over.status).toBe(429);
    expect(over.body.error.message).toContain(`${PAT_LIMITS.perPatterPerDay} pets today`);
  });
});

describe("pets in the world", () => {
  it("cleans and filters names before they're logged, and marks them untrusted on the wire", async () => {
    const t = await start();
    const tam = await t.settler("Tam", 2);
    const refused = await t.adopt(tam.token, "Terrakin Team");
    expect(refused).toMatchObject({ ok: false, error: { code: "bad_request" } });
    expect(t.service.state.residents[tam.id]?.pet).toBeUndefined();

    // A right-to-left override could disguise a name; cleaning turns it into a space.
    const done = await t.adopt(tam.token, `Sir${String.fromCharCode(0x202e)}Biscuit`);
    expect(done.events).toContainEqual({
      type: "pet_adopted",
      residentId: tam.id,
      pet: { kind: "cat", coat: "ginger", name: "Sir Biscuit", adoptedDay: t.service.state.day },
      trust: "untrusted",
    });
    const world = (await t.call("GET", "/v1/world")).body;
    const seen = world.residents.find((r: Json) => r.id === tam.id);
    expect(seen.pet).toMatchObject({ kind: "cat", coat: "ginger", name: "Sir Biscuit" });
  });

  it("holds a quarantined owner's pet name back from the world, their profile, and events", async () => {
    const t = await start();
    const tam = await t.settler("Tam", 2);
    await t.adopt(tam.token);
    const ivy = t.join("Ivy");
    const heard: ServerMessage[] = [];
    cleanups.push(t.service.subscribe(ivy.id, (m) => heard.push(m)));
    const events = () =>
      heard.flatMap((m) => (m.type === "event" ? [m.event] : [])) as WorldEvent[];
    expect(t.social.safety.quarantine("staff", tam.id, "a rude pet name").ok).toBe(true);

    const world = (await t.call("GET", "/v1/world")).body;
    expect(world.residents.find((r: Json) => r.id === tam.id).pet).toMatchObject({ name: "" });
    const profile = (await t.call("GET", `/v1/residents/${tam.id}`)).body.resident;
    expect(profile.pet).toMatchObject({ kind: "cat", name: "" });
    expect((await t.act(tam.token, { type: "rename_pet", name: "Bun" })).ok).toBe(true);
    expect(events()).toContainEqual(
      expect.objectContaining({ type: "pet_renamed", residentId: tam.id, name: "" }),
    );

    // Tam leaves and comes back: the pet in `joined` has no name either.
    await t.call("DELETE", "/v1/session", undefined, tam.token);
    expect((await t.act(tam.token, { type: "move", dir: "s" })).ok).toBe(true);
    const joined = events().find((e) => e.type === "joined" && e.resident.id === tam.id);
    expect(joined?.type === "joined" && joined.resident.pet).toMatchObject({ name: "" });

    // A second quarantined resident adopts: `pet_adopted` carries no name.
    const bo = await t.settler("Bo", 0);
    expect(t.social.safety.quarantine("staff", bo.id, "a rude pet name").ok).toBe(true);
    expect((await t.adopt(bo.token, "Pip")).ok).toBe(true);
    const adopted = events().find((e) => e.type === "pet_adopted" && e.residentId === bo.id);
    expect(adopted?.type === "pet_adopted" && adopted.pet).toMatchObject({ kind: "cat", name: "" });
  });

  it("tells an owner about a treat from someone else, and refuses one across a block", async () => {
    const t = await start();
    const ivy = await t.settler("Ivy", 0);
    const tam = await t.settler("Tam", 2);
    await t.adopt(tam.token);
    const items = t.service.state.items;
    if (!items) throw new Error("items are open");
    items.inventories[ivy.id] = { stacks: { strawberry: 2 }, goods: [] };
    items.inventories[tam.id] = { stacks: { strawberry: 1 }, goods: [] };

    expect(
      await t.act(ivy.token, { type: "treat_pet", owner: tam.id, item: "strawberry" }),
    ).toMatchObject({ ok: true });
    const notes = (await t.call("GET", "/v1/notifications", undefined, tam.token)).body;
    expect(notes.notifications[0]).toMatchObject({
      type: "pet_treat",
      actor: { id: ivy.id },
      pet: { kind: "cat", name: "Biscuit" },
      treat: "strawberry",
    });

    // A treat for your own pet tells nobody.
    t.advance(DAY_MS);
    await t.act(tam.token, { type: "home" });
    expect(
      await t.act(tam.token, { type: "treat_pet", owner: tam.id, item: "strawberry" }),
    ).toMatchObject({ ok: true });
    const after = (await t.call("GET", "/v1/notifications", undefined, tam.token)).body;
    expect(after.notifications).toHaveLength(1);

    t.advance(DAY_MS);
    await t.call("PUT", `/v1/residents/${ivy.id}/block`, undefined, tam.token);
    expect(
      await t.act(ivy.token, { type: "treat_pet", owner: tam.id, item: "strawberry" }),
    ).toMatchObject({ ok: false, error: { code: "forbidden" } });
  });
});

describe("pets in the check-in", () => {
  it("names unread pats and treats by count, never by the pet's name", async () => {
    const t = await start();
    const tam = await t.settler("Tam", 2);
    await t.adopt(tam.token, "Sir Biscuit");
    await t.pat(t.join("Ivy"), tam);
    const checkin = (await t.call("GET", "/v1/checkin", undefined, tam.token)).body;
    const line = checkin.todo.find((l: string) => l.includes("patted your pet"));
    expect(line).toContain("1 pet notification");
    expect(checkin.todo.join("\n")).not.toContain("Sir Biscuit");
  });

  it("suggests adopting to someone at home without a pet, and not once they have one", async () => {
    const t = await start();
    const tam = await t.settler("Tam", 2);
    const roamer = t.join("Roamer");
    const none = new Set<string>();
    expect(pickTryNext(t.service.state, tam.id, new Set(["plant", "gather"]), none)?.id).toBe(
      "pet",
    );
    // No hearth, no pet: the line would only lead to `no_hearth`.
    expect(
      pickTryNext(t.service.state, roamer.id, new Set(["plant", "gather"]), none)?.id,
    ).not.toBe("pet");
    await t.adopt(tam.token);
    expect(pickTryNext(t.service.state, tam.id, new Set(["plant", "gather"]), none)?.id).not.toBe(
      "pet",
    );
  });
});
