import { PRAISE_LIMITS } from "@terrakin/protocol";
import type { WorldConfig } from "@terrakin/sim";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "./app";
import { MemoryMediaStore } from "./media";
import { nodeSql } from "./node-sql";
import { SocialService } from "./social-service";
import { MemoryStore } from "./store";
import { listenOnFreePort, responseChecker } from "./test-support";
import { WorldService } from "./world-service";

const CONFIG: WorldConfig = {
  width: 12,
  height: 12,
  plotSize: 4,
  maxPlotsPerResident: 1,
  reach: 2,
};
const DAY = 24 * 60 * 60_000;

const cleanups: (() => void | Promise<void>)[] = [];
const { problems, onResponse } = responseChecker();
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
  expect(problems.splice(0)).toEqual([]);
});

/** A server whose clock starts at noon UTC, where everyone has been here `age` days. */
async function start(age: (id: string) => number = () => 30) {
  let now = 1_700_000_000_000 - (1_700_000_000_000 % DAY) + DAY / 2;
  const service = new WorldService({ store: new MemoryStore(), config: CONFIG });
  const sql = nodeSql();
  const media = new MemoryMediaStore();
  const social = new SocialService({
    sql,
    media,
    resident: (id) => service.state.residents[id],
    now: () => now,
    residentAgeDays: age,
  });
  const server = createApp({
    service,
    social,
    media,
    actionsPerSecond: 1000,
    sessionsPerMinute: 1000,
    onResponse,
  });
  const base = await listenOnFreePort(server, cleanups);
  cleanups.push(() => sql.close());

  async function call(method: string, path: string, token?: string, body?: unknown) {
    const res = await fetch(base + path, {
      method,
      headers: {
        "content-type": "application/json",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await res.text();
    return {
      status: res.status,
      retryAfter: res.headers.get("retry-after"),
      body: text ? JSON.parse(text) : undefined,
    };
  }
  async function join(name: string) {
    const { body } = await call("POST", "/v1/session", undefined, { name, kind: "agent" });
    return body as { residentId: string; token: string };
  }
  const praise = (from: { token: string }, to: { residentId: string }) =>
    call("POST", `/v1/residents/${to.residentId}/praise`, from.token);
  return { call, join, praise, social, advance: (ms: number) => (now += ms) };
}

describe("praise", () => {
  it("adds one to the count on the profile, marks it for the giver, and notifies", async () => {
    const { call, join, praise } = await start();
    const wren = await join("Wren");
    const ash = await join("Ash");
    const before = await call("GET", `/v1/residents/${ash.residentId}`, wren.token);
    expect(before.body.resident.praise).toBe(0);
    expect(before.body.resident.praisedToday).toBeUndefined();

    const res = await praise(wren, ash);
    expect(res.status).toBe(201);
    expect(res.body.resident).toMatchObject({ id: ash.residentId, praise: 1, praisedToday: true });
    // Anyone can see the count; only the giver sees praisedToday.
    const anon = await call("GET", `/v1/residents/${ash.residentId}`);
    expect(anon.body.resident.praise).toBe(1);
    expect(anon.body.resident.praisedToday).toBeUndefined();

    const notes = await call("GET", "/v1/notifications", ash.token);
    expect(notes.body.notifications[0]).toMatchObject({
      type: "praise",
      actor: { id: wren.residentId },
      postId: null,
      excerpt: "",
    });
  });

  it("refuses praising yourself", async () => {
    const { join, praise } = await start();
    const wren = await join("Wren");
    const res = await praise(wren, wren);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("bad_request");
  });

  it("refuses an unknown resident and a caller without a token", async () => {
    const { call, join, praise } = await start();
    const wren = await join("Wren");
    expect((await praise(wren, { residentId: "r_0000000000000000" })).status).toBe(404);
    expect((await call("POST", `/v1/residents/${wren.residentId}/praise`)).status).toBe(401);
  });

  it("refuses across a block, either way", async () => {
    const { call, join, praise } = await start();
    const wren = await join("Wren");
    const ash = await join("Ash");
    await call("PUT", `/v1/residents/${wren.residentId}/block`, ash.token);
    const out = await praise(wren, ash);
    expect(out.status).toBe(403);
    expect(out.body.error.code).toBe("forbidden");
    expect((await praise(ash, wren)).status).toBe(403);
    expect((await call("GET", `/v1/residents/${ash.residentId}`)).body.resident.praise).toBe(0);
  });

  it("refuses a second praise of the same resident on the same UTC day, and allows it the next", async () => {
    const { call, join, praise, advance } = await start();
    const wren = await join("Wren");
    const ash = await join("Ash");
    expect((await praise(wren, ash)).status).toBe(201);
    const again = await praise(wren, ash);
    expect(again.status).toBe(429);
    expect(again.body.error.code).toBe("rate_limited");
    // Noon UTC: half a day until it resets.
    expect(Number(again.retryAfter)).toBe(DAY / 2 / 1000);
    advance(DAY / 2);
    expect((await praise(wren, ash)).status).toBe(201);
    expect((await call("GET", `/v1/residents/${ash.residentId}`)).body.resident.praise).toBe(2);
  });

  it(`stops one giver at ${PRAISE_LIMITS.perGiverPerDay} a day`, async () => {
    const { join, praise, advance } = await start();
    const wren = await join("Wren");
    const others = [];
    for (let i = 0; i <= PRAISE_LIMITS.perGiverPerDay; i++) others.push(await join(`Friend ${i}`));
    for (const other of others.slice(0, PRAISE_LIMITS.perGiverPerDay)) {
      expect((await praise(wren, other)).status).toBe(201);
    }
    const last = others[PRAISE_LIMITS.perGiverPerDay];
    if (!last) throw new Error("no last friend");
    const refused = await praise(wren, last);
    expect(refused.status).toBe(429);
    expect(refused.body.error.message).toMatch(/today/);
    advance(DAY);
    expect((await praise(wren, last)).status).toBe(201);
  });

  it("refuses a resident on their first UTC day here", async () => {
    const ages = new Map<string, number>();
    const { join, praise } = await start((id) => ages.get(id) ?? 30);
    const fresh = await join("Fresh");
    const ash = await join("Ash");
    ages.set(fresh.residentId, 0);
    const refused = await praise(fresh, ash);
    expect(refused.status).toBe(429);
    expect(refused.body.error.message).toMatch(/second day/);
    ages.set(fresh.residentId, 1);
    expect((await praise(fresh, ash)).status).toBe(201);
  });

  it("refuses a suspended resident", async () => {
    const { join, praise, social } = await start();
    const wren = await join("Wren");
    const ash = await join("Ash");
    const staff = await join("Staff");
    const suspended = social.safety.suspend(staff.residentId, wren.residentId, 1, "test");
    expect(suspended.ok).toBe(true);
    const out = await praise(wren, ash);
    expect(out.status).toBe(403);
    expect(out.body.error.code).toBe("suspended");
  });

  it("keeps every praise as its own row for later readers like karma", async () => {
    const { join, praise, social, advance } = await start();
    const wren = await join("Wren");
    const ash = await join("Ash");
    await praise(wren, ash);
    advance(DAY);
    await praise(wren, ash);
    const rows = [
      ...social.sql.exec("SELECT giver, receiver, day FROM praise ORDER BY day"),
    ] as Record<string, unknown>[];
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ giver: wren.residentId, receiver: ash.residentId });
    expect(Number(rows[1]?.day) - Number(rows[0]?.day)).toBe(1);
  });
});
