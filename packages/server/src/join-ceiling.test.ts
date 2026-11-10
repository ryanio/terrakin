import { JOIN_LIMITS, type ServerMessage } from "@terrakin/protocol";
import { DAY_MS, type WorldConfig } from "@terrakin/sim";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { createApp } from "./app";
import { MemoryMediaStore } from "./media";
import { nodeSql } from "./node-sql";
import { SocialService } from "./social-service";
import { MemoryStore } from "./store";
import {
  confirmLinkIn,
  jsonCaller,
  listenOnFreePort,
  recordTelemetry,
  responseChecker,
} from "./test-support";
import { WorldService } from "./world-service";

// Room for the starter home on 8-tile plots, and plots enough for every invited neighbor.
const CONFIG: WorldConfig = {
  width: 96,
  height: 96,
  plotSize: 8,
  maxPlotsPerResident: 1,
  reach: 3,
};

const cleanups: (() => void | Promise<void>)[] = [];
const { problems, onResponse } = responseChecker();
const telemetry = recordTelemetry();
beforeEach(() => telemetry.start());
afterEach(async () => {
  telemetry.stop();
  for (const fn of cleanups.splice(0).reverse()) await fn();
  expect(problems.splice(0)).toEqual([]);
});

/** Noon UTC, so a few hours on stays the same day. */
const NOON = Date.UTC(2026, 10, 9, 12);

async function start() {
  let now = NOON;
  const clock = () => now;
  const service = new WorldService({ store: new MemoryStore(), config: CONFIG, now: clock });
  const sql = nodeSql();
  const social = new SocialService({
    sql,
    media: new MemoryMediaStore(),
    resident: (id) => service.state.residents[id],
    now: clock,
  });
  // Every join here comes from one IP: the per-IP limit is raised so only the ceiling is tested.
  const server = createApp({
    service,
    social,
    actionsPerSecond: 1000,
    sessionsPerMinute: 1000,
    now: clock,
    onResponse,
  });
  const base = await listenOnFreePort(server, cleanups);
  cleanups.push(() => sql.close());
  const call = jsonCaller(base);
  let named = 0;
  const join = (name = `Newcomer_${++named}`) =>
    call("POST", "/v1/session", { name, kind: "human" });
  /** Spend the main share down to nothing: the refusal comes at the burst at the latest. */
  async function fill() {
    for (let i = 0; i <= JOIN_LIMITS.all.burst; i++) {
      const res = await join();
      if (res.status === 429) return res;
      expect(res.status).toBe(201);
    }
    throw new Error("The ceiling let more than its burst in at once.");
  }
  async function settled(name: string) {
    const { body } = await join(name);
    const token = body.token as string;
    for (const type of ["settle", "build_starter_home"]) {
      const action = type === "settle" ? { type, px: 1, py: 1 } : { type };
      expect((await call("POST", "/v1/actions", action, token)).body.ok).toBe(true);
    }
    expect(service.state.residents[body.residentId]?.hearth).toBeTruthy();
    return { id: body.residentId as string, token };
  }
  async function accept(inviterToken: string) {
    const made = await call("POST", "/v1/invites", {}, inviterToken);
    expect(made.status).toBe(201);
    return call("POST", `/v1/invites/${made.body.invite.code}/accept`, {
      name: `Invited_${++named}`,
      kind: "human",
      build: false,
    });
  }
  return {
    base,
    call,
    join,
    fill,
    settled,
    accept,
    service,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

function hello(base: string, name: string) {
  const ws = new WebSocket(`${base.replace("http", "ws")}/v1/live`);
  cleanups.push(() => ws.close());
  return new Promise<ServerMessage>((resolve) => {
    ws.on("open", () => ws.send(JSON.stringify({ type: "hello", v: 1, name, kind: "human" })));
    ws.on("message", (data) => resolve(JSON.parse(data.toString())));
  });
}

describe("the world-wide ceiling on joins (RFC 0055)", () => {
  it("turns away the join past the burst on every door, says how long to wait, and logs nothing", async () => {
    const t = await start();
    const full = await t.fill();
    const seq = t.service.state.seq;

    // POST /v1/session: a 429 like every request limit, with the wait in words and Retry-After.
    expect(full.body.error.code).toBe("rate_limited");
    const wait = Number(full.headers.get("retry-after"));
    expect(wait).toBeGreaterThan(0);
    expect(full.body.error.message).toBe(
      `A lot of people are moving in right now. Try again in ${Math.ceil(wait / 60)} minutes. You can keep looking around.`,
    );

    // The live socket's hello, which the web's Move in sends: the same words, with retryAfter.
    const refused = await hello(t.base, "Socket_Newcomer");
    expect(refused).toMatchObject({
      type: "error",
      error: { code: "rate_limited", message: full.body.error.message, retryAfter: wait },
    });

    // GET /v1/join's confirm link: the same refusal as a Markdown page.
    const page = await t.call("GET", "/v1/join?name=Link_Newcomer");
    const confirmed = await t.call("GET", confirmLinkIn(page.text));
    expect(confirmed.status).toBe(429);
    expect(confirmed.headers.get("retry-after")).toBe(String(wait));
    expect(confirmed.text).toContain("A lot of people are moving in right now.");

    // None of them reached the log, and staff heard each refusal as a count.
    expect(t.service.state.seq).toBe(seq);
    const gauges = telemetry.gauges.filter((g) => g.name === "world.joins_full");
    expect(gauges.map((g) => g.value)).toEqual([1, 2, 3]);
    expect(gauges.every((g) => g.share === "all")).toBe(true);
    // Every join that went through was counted by kind and share, for the hourly read.
    const joins = telemetry.counts.filter((c) => c.name === "world.joins");
    expect(joins).toHaveLength(JOIN_LIMITS.all.burst);
    expect(joins[0]).toMatchObject({ kind: "human", share: "all" });
  });

  it("lets one more in once the bucket has refilled for that long, and no more", async () => {
    const t = await start();
    const full = await t.fill();
    const wait = Number(full.headers.get("retry-after"));
    t.advance(wait * 1000 - 1000);
    expect((await t.join()).status).toBe(429);
    t.advance(1000);
    expect((await t.join()).status).toBe(201);
    expect((await t.join()).status).toBe(429);
  });

  it("keeps a share of its own for invites from a settled resident of a day or more", async () => {
    const t = await start();
    const ada = await t.settled("Ada");
    t.advance(DAY_MS);
    await t.fill();
    // The main share is empty, but Ada's invites draw on their own, up to its burst.
    for (let i = 0; i < JOIN_LIMITS.invited.burst; i++) {
      expect((await t.accept(ada.token)).status, `invite ${i + 1}`).toBe(201);
    }
    const over = await t.accept(ada.token);
    expect(over.status).toBe(429);
    expect(over.body.error.code).toBe("rate_limited");
    expect(telemetry.gauges.at(-1)).toMatchObject({ name: "world.joins_full", share: "invited" });
    // Spending the invited share took nothing from the main one, which is still empty.
    expect((await t.join()).status).toBe(429);
  });

  it("sends an invite from a resident with no hearth, or one here under a day, through the main share", async () => {
    const t = await start();
    const ada = await t.settled("Ada");
    const bo = await t.join("Bo");
    await t.fill();
    // Ada has a hearth but joined today.
    expect((await t.accept(ada.token)).status).toBe(429);
    t.advance(DAY_MS);
    // A day on, Bo has the age but no hearth. The day refilled the main share, so drain it again.
    await t.fill();
    expect((await t.accept(bo.body.token)).status).toBe(429);
    // Ada now meets both, and gets in while the main share is still empty.
    expect((await t.accept(ada.token)).status).toBe(201);
  });
});
