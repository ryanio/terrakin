import { PUTTER_LIMITS, type ServerMessage } from "@terrakin/protocol";
import { TOWN_ACTOR, type WorldConfig } from "@terrakin/sim";
import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { createApp } from "./app";
import { REPEAT_NOTE } from "./links";
import { MemoryMediaStore } from "./media";
import { nodeSql } from "./node-sql";
import { SocialService } from "./social-service";
import { MemoryStore } from "./store";
import {
  type Cleanup,
  confirmLinkIn,
  jsonCaller,
  listenOnFreePort,
  responseChecker,
} from "./test-support";
import { DAY_MS, utcDay, WorldService } from "./world-service";

// 6x6 plots of 8 tiles. The Commons is plot (3,3); everyone joins at (24,24).
const CONFIG: WorldConfig = {
  width: 48,
  height: 48,
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

/** Noon UTC, so a few hours later is still the same day. */
const NOON = Date.UTC(2026, 9, 4, 12);
const MINUTE = 60_000;
const KEY = /k_[A-Za-z0-9_-]{43}/;

async function start() {
  let now = NOON;
  const clock = () => now;
  const store = new MemoryStore();
  const service = new WorldService({ store, config: CONFIG, now: clock });
  const sql = nodeSql();
  const social = new SocialService({
    sql,
    media: new MemoryMediaStore(),
    resident: (id) => service.state.residents[id],
    now: clock,
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

  async function join(name: string, kind: "human" | "agent" = "agent") {
    const { body } = await call("POST", "/v1/session", { name, kind });
    return { id: body.residentId as string, token: body.token as string };
  }

  /** `POST /v1/actions` with a putter, dry or not. */
  const putter = async (who: { token: string }, dry = false) =>
    (await call("POST", "/v1/actions", { type: "putter", ...(dry ? { dry } : {}) }, who.token))
      .body;

  /** A live socket for one resident, collecting what it hears. */
  const live = (who: { token: string }) => {
    const ws = new WebSocket(`${base.replace("http", "ws")}/v1/live`);
    const messages: ServerMessage[] = [];
    cleanups.push(() => ws.close());
    const welcomed = new Promise<void>((resolve) => {
      ws.on("message", (data) => {
        const m = JSON.parse(data.toString()) as ServerMessage;
        messages.push(m);
        if (m.type === "welcome") resolve();
      });
    });
    ws.once("open", () => ws.send(JSON.stringify({ type: "hello", v: 1, token: who.token })));
    return { ws, messages, welcomed };
  };

  const gestures = async (who: { token: string }) =>
    (await call("GET", "/v1/gestures", undefined, who.token)).body;

  return {
    base,
    call,
    join,
    putter,
    live,
    gestures,
    service,
    social,
    store,
    clock,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

describe("putter", () => {
  it("walks an agent next to another resident and waves at them, live and in their gestures", async () => {
    const t = await start();
    const wren = await t.join("Wren", "agent");
    const ada = await t.join("Ada", "human");
    const adaLive = t.live(ada);
    await adaLive.welcomed;

    // Both stand at spawn; Wren steps off Ada's tile to stand next to her.
    const result = await t.putter(wren);
    expect(result.ok).toBe(true);
    expect(result.greeted).toBe(ada.id);
    expect(result.events.length).toBeGreaterThan(0);
    expect(result.events.every((e: { type: string }) => e.type === "moved")).toBe(true);
    const me = t.service.state.residents[wren.id];
    const her = t.service.state.residents[ada.id];
    expect(me && her && Math.max(Math.abs(me.x - her.x), Math.abs(me.y - her.y))).toBe(1);

    // Ada's socket sees the walk and gets the wave, marked as a putter wave with no note.
    await expect
      .poll(() => adaLive.messages.find((m) => m.type === "gesture"))
      .toMatchObject({ kind: "wave", from: { id: wren.id }, note: "", putter: true });
    expect(
      adaLive.messages.some(
        (m) => m.type === "event" && m.event.type === "moved" && m.event.residentId === wren.id,
      ),
    ).toBe(true);

    // It's an ordinary wave in both residents' gestures, and it starts no streak.
    const mine = await t.gestures(wren);
    expect(mine.gestures).toMatchObject([
      { kind: "wave", from: { id: wren.id }, to: { id: ada.id }, putter: true },
    ]);
    expect(mine.streaks).toEqual([]);
    expect((await t.gestures(ada)).gestures[0].putter).toBe(true);
    expect(t.social.together.longestStreak(ada.id)).toBe(0);
  });

  it("puts greeted on the socket ack too", async () => {
    const t = await start();
    const wren = await t.join("Wren");
    const ada = await t.join("Ada");
    const wrenLive = t.live(wren);
    await wrenLive.welcomed;
    wrenLive.ws.send(JSON.stringify({ type: "action", id: "p1", action: { type: "putter" } }));
    await expect
      .poll(() => wrenLive.messages.find((m) => m.type === "ack"))
      .toMatchObject({ type: "ack", id: "p1", greeted: ada.id });
  });

  it("doesn't wave across a block, either way", async () => {
    const t = await start();
    const wren = await t.join("Wren");
    const ada = await t.join("Ada");
    await t.call("PUT", `/v1/residents/${wren.id}/block`, undefined, ada.token);
    const result = await t.putter(wren);
    expect(result).toMatchObject({ ok: true, greeted: null });
    expect((await t.gestures(ada)).gestures).toEqual([]);
  });

  it("never walks up to someone blocked either way", async () => {
    const t = await start();
    const wren = await t.join("Wren");
    const ada = await t.join("Ada");
    const her = t.service.state.residents[ada.id];
    if (!her) throw new Error("no resident");
    // Eight tiles east: one putter could reach her side, but not by wandering.
    Object.assign(her, { x: her.x + 8 });
    await t.call("PUT", `/v1/residents/${wren.id}/block`, undefined, ada.token);
    const me = () => t.service.state.residents[wren.id] as { x: number; y: number };
    const away = () => Math.max(Math.abs(me().x - her.x), Math.abs(me().y - her.y));
    for (let i = 0; i < 5; i++) {
      expect((await t.putter(wren)).ok).toBe(true);
      expect(away()).toBeGreaterThan(1);
      t.advance(MINUTE);
    }
  });

  it("waves at the next nearest when the nearest can't take one", async () => {
    const t = await start();
    const wren = await t.join("Wren");
    const ada = await t.join("Ada");
    const bo = await t.join("Bo");
    await t.call("PUT", `/v1/residents/${wren.id}/block`, undefined, ada.token);
    await t.call("PUT", `/v1/residents/${wren.id}/block`, undefined, bo.token);
    const cal = await t.join("Cal");
    // Everyone's at spawn, so all three are equally near; only Cal can take a wave.
    expect((await t.putter(wren)).greeted).toBe(cal.id);
  });

  it("waves at most once per pair a UTC day, in either direction", async () => {
    const t = await start();
    const wren = await t.join("Wren");
    const ada = await t.join("Ada");
    expect((await t.putter(wren)).greeted).toBe(ada.id);
    // Past the minute limit and the 10-minute gesture cooldown: still no second wave today.
    t.advance(11 * MINUTE);
    expect(await t.putter(wren)).toMatchObject({ ok: true, greeted: null });
    expect(await t.putter(ada)).toMatchObject({ ok: true, greeted: null });
    expect((await t.gestures(ada)).gestures).toHaveLength(1);
    // A wave someone chooses to send still goes, and still counts for the streak.
    const chosen = await t.call(
      "POST",
      `/v1/residents/${ada.id}/gesture`,
      { kind: "hug" },
      wren.token,
    );
    expect(chosen.body.streak).toBe(1);
    // The next UTC day, they can wave again.
    t.advance(DAY_MS);
    expect((await t.putter(wren)).greeted).toBe(ada.id);
  });

  it("refuses a second putter within a minute, and only accepted ones count", async () => {
    const t = await start();
    const wren = await t.join("Wren");
    expect((await t.putter(wren)).ok).toBe(true);
    const seq = t.service.state.seq;
    t.advance(30_000);
    const again = await t.putter(wren);
    expect(again).toMatchObject({ ok: false, error: { code: "rate_limited", retryAfter: 30 } });
    expect(again.error.message).toMatch(/30 seconds/);
    expect(t.service.state.seq).toBe(seq);
    t.advance(30_000);
    expect((await t.putter(wren)).ok).toBe(true);
  });

  it(`refuses past ${PUTTER_LIMITS.perDay} a UTC day, and counts them again after midnight`, async () => {
    const t = await start();
    const wren = await t.join("Wren");
    for (let i = 0; i < PUTTER_LIMITS.perDay; i++) {
      const result = await t.putter(wren);
      expect(result.ok, JSON.stringify(result)).toBe(true);
      t.advance(PUTTER_LIMITS.secondsBetween * 1000);
    }
    const seq = t.service.state.seq;
    const over = await t.putter(wren);
    expect(over).toMatchObject({ ok: false, error: { code: "rate_limited" } });
    expect(over.error.message).toMatch(/midnight UTC/);
    const midnight = (utcDay(t.clock()) + 1) * DAY_MS;
    expect(over.error.retryAfter).toBe(Math.ceil((midnight - t.clock()) / 1000));
    expect(await t.putter(wren, true)).toMatchObject({ ok: false, dry: true });
    expect(t.service.state.seq).toBe(seq);
    t.advance(DAY_MS);
    expect((await t.putter(wren)).ok).toBe(true);
  });

  it("keeps the day's count through a restart, read back from the log", () => {
    let now = NOON;
    const store = new MemoryStore();
    const make = () => new WorldService({ store, config: CONFIG, now: () => now, days: true });
    const first = make();
    first.createResident({ name: "Wren", kind: "agent" });
    const wren = Object.keys(first.state.residents).find((id) => id !== TOWN_ACTOR) as string;
    for (let i = 0; i < PUTTER_LIMITS.perDay; i++) {
      first.ensureOnline(wren);
      expect(first.act(wren, { type: "putter" }).ok).toBe(true);
      now += PUTTER_LIMITS.secondsBetween * 1000;
    }
    const second = make();
    second.ensureOnline(wren);
    expect(second.act(wren, { type: "putter" })).toMatchObject({
      ok: false,
      error: { code: "rate_limited" },
    });
    // Tomorrow the log's putters are yesterday's.
    now = (utcDay(now) + 1) * DAY_MS + MINUTE;
    const third = make();
    third.ensureOnline(wren);
    expect(third.act(wren, { type: "putter" }).ok).toBe(true);
  });

  it("dry runs plan and check the walk, but move nobody, greet nobody, and use up nothing", async () => {
    const t = await start();
    const wren = await t.join("Wren");
    const ada = await t.join("Ada");
    const before = t.service.hash();
    const seq = t.service.state.seq;
    const log = t.store.log.length;
    expect(await t.putter(wren, true)).toEqual({ ok: true, dry: true, seq, events: [] });
    expect(t.service.hash()).toBe(before);
    expect(t.store.log).toHaveLength(log);
    expect((await t.gestures(ada)).gestures).toEqual([]);
    // The dry run didn't count against the limit: a real one goes right away.
    expect((await t.putter(wren)).greeted).toBe(ada.id);
    // And a dry run inside the minute gets the refusal a real call would.
    expect(await t.putter(wren, true)).toMatchObject({
      ok: false,
      dry: true,
      error: { code: "rate_limited" },
    });
  });

  it("refuses with nowhere_to_go and a way out when walled in", async () => {
    const t = await start();
    const wren = await t.join("Wren");
    const me = t.service.state.residents[wren.id];
    if (!me) throw new Error("no resident");
    // Box Wren in from the world's corner. Tests may set blocks directly; the sim only reads them.
    Object.assign(me, { x: 0, y: 0 });
    t.service.state.blocks["1,0"] = "stone";
    t.service.state.blocks["0,1"] = "stone";
    const result = await t.putter(wren);
    expect(result).toMatchObject({ ok: false, error: { code: "nowhere_to_go" } });
    expect(result.error.message).toMatch(/settle at px/);
  });
});

describe("the putter link", () => {
  it("walks, says who it waved at by id, and doesn't act twice when opened again", async () => {
    const t = await start();
    const open = async (path: string) => {
      const res = await fetch(t.base + path);
      return { status: res.status, text: await res.text() };
    };
    const joined = await open(confirmLinkIn((await open("/v1/join?name=Wren")).text));
    const key = KEY.exec(joined.text)?.[0];
    if (!key) throw new Error(`No key in:\n${joined.text}`);
    const ada = await t.join("Ada");

    const first = await open(`/v1/act/${key}/putter`);
    expect(first.status).toBe(200);
    expect(first.text).toContain("# Puttered");
    expect(first.text).toContain(`You waved at resident \`${ada.id}\``);
    expect(first.text).not.toContain("Ada");
    expect(first.text).toContain(`/v1/act/${key}/putter`);
    const seq = t.service.state.seq;

    const again = await open(`/v1/act/${key}/putter`);
    expect(again.text.startsWith(REPEAT_NOTE)).toBe(true);
    expect(t.service.state.seq).toBe(seq);

    // Every page's next steps offer it.
    expect((await open(`/v1/act/${key}/me`)).text).toContain(`/v1/act/${key}/putter`);
  });
});
