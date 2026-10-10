import { ROUTINE_LIMITS, type ServerMessage } from "@terrakin/protocol";
import type { WorldConfig } from "@terrakin/sim";
import { DAY_MS } from "@terrakin/sim";
import { afterEach, describe, expect, it } from "vitest";
import { Api, type ApiRequest } from "./api";
import { MemoryMediaStore } from "./media";
import { nodeSql } from "./node-sql";
import { SocialService } from "./social-service";
import { MemoryStore } from "./store";
import { responseChecker } from "./test-support";
import { WorldService } from "./world-service";

// 6x6 plots of 8 tiles. The Commons is plot (3,3); everyone joins at (24,24).
const CONFIG: WorldConfig = {
  width: 48,
  height: 48,
  plotSize: 8,
  maxPlotsPerResident: 1,
  reach: 3,
};

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
/** Half past five in the evening, UTC: walk_home's default hour is 18. */
const EVENING = Date.UTC(2026, 9, 6, 17, 30);

const cleanups: (() => void)[] = [];
const { problems, onResponse } = responseChecker();
afterEach(() => {
  for (const fn of cleanups.splice(0).reverse()) fn();
  expect(problems.splice(0)).toEqual([]);
});

// biome-ignore lint/suspicious/noExplicitAny: the response checker already holds every body to its schema.
type Json = Record<string, any>;

/** A world that counts days, with presence coming from acting, as both adapters run it. */
function direct() {
  let now = EVENING;
  const clock = () => now;
  const service = new WorldService({
    store: new MemoryStore(),
    config: CONFIG,
    now: clock,
    days: true,
    economy: true,
    items: true,
    presence: true,
  });
  const sql = nodeSql();
  cleanups.push(() => sql.close());
  const social = new SocialService({
    sql,
    media: new MemoryMediaStore(),
    resident: (id) => service.state.residents[id],
    now: clock,
  });
  const api = new Api({
    service,
    social,
    skill: "",
    openapi: "",
    sessionsPerMinute: 1000,
    actionsPerSecond: 1000,
    onResponse,
    now: clock,
  });
  async function call(method: string, path: string, body?: unknown, token?: string) {
    const url = new URL(path, "https://terrakin.org");
    const res = await api.handle({
      method,
      pathname: url.pathname,
      ip: "127.0.0.1",
      authorization: token ? `Bearer ${token}` : undefined,
      query: url.searchParams,
      readJson: async () => body,
      readBytes: async () => undefined,
      contentLength: undefined,
      ...(body === undefined ? {} : { contentType: "application/json" }),
    } satisfies ApiRequest);
    const text = typeof res?.body === "string" ? res.body : "";
    const parsed = /^[[{]/.test(text) ? JSON.parse(text) : text || undefined;
    return { status: res?.status ?? 0, body: parsed as Json };
  }
  const act = async (token: string, action: Json) =>
    (await call("POST", "/v1/actions", action, token)).body;
  const join = (name: string) => {
    const r = service.createSession({ name, kind: "agent" });
    return { id: r.residentId ?? "", token: r.token ?? "" };
  };
  /** A resident with a starter home on plot (px, py), standing a step south of their hearth. */
  const settled = async (name: string, px: number, py: number) => {
    const who = join(name);
    expect((await act(who.token, { type: "settle", px, py })).ok).toBe(true);
    expect((await act(who.token, { type: "build_starter_home" })).ok).toBe(true);
    expect((await act(who.token, { type: "move", dir: "s" })).ok).toBe(true);
    return who;
  };
  const away = (id: string) => service.leave(id);
  const routines = async (token: string, list: Json[]) =>
    expect((await act(token, { type: "set_routines", routines: list })).ok).toBe(true);
  const lines = async (token: string) =>
    (await call("GET", "/v1/routines", undefined, token)).body.away.items as Json[];
  /** A live socket for one resident: what it hears, an action sent over it, and closing it. */
  const live = (token: string) => {
    const heard: ServerMessage[] = [];
    const session = api.live("127.0.0.1", {
      send: (text) => heard.push(JSON.parse(text) as ServerMessage),
      close: () => {},
    });
    session.onMessage(JSON.stringify({ type: "hello", v: 1, token }));
    cleanups.push(() => session.onClose());
    return {
      heard,
      act: (action: Json) => session.onMessage(JSON.stringify({ type: "action", action })),
      close: () => session.onClose(),
    };
  };
  return {
    api,
    service,
    social,
    call,
    act,
    join,
    settled,
    away,
    routines,
    lines,
    live,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

describe("the routine runner", () => {
  it("walks an away resident home and strolls them out and back at their hours, once a day", async () => {
    const t = direct();
    const wren = await t.settled("Wren", 0, 0);
    await t.routines(wren.token, [{ kind: "walk_home" }, { kind: "stroll", hour: 19 }]);
    t.away(wren.id);
    const at = () => t.service.state.residents[wren.id];
    expect(at()).toMatchObject({ x: 3, y: 4, online: false });

    // Not yet: walk_home is at 18:00 UTC.
    expect(t.api.runRoutines()).toEqual({ steps: 0, refused: 0, paused: 0 });
    t.advance(35 * MINUTE);
    expect(t.api.runRoutines()).toEqual({ steps: 1, refused: 0, paused: 0 });
    expect(at()).toMatchObject({ x: 3, y: 3, online: false });

    // The stroll walks out across the plot, and the world shows Wren out on it.
    t.advance(HOUR);
    expect(t.api.runRoutines()).toMatchObject({ steps: 1 });
    const out = at();
    expect(out && (out.x !== 3 || out.y !== 3)).toBe(true);
    expect(Math.floor((out?.x ?? 99) / 8)).toBe(0);
    expect(Math.floor((out?.y ?? 99) / 8)).toBe(0);
    const world = (await t.call("GET", "/v1/world")).body;
    expect(world.residents.find((r: Json) => r.id === wren.id).routine).toBe("stroll");

    // A few minutes later it walks back, and that's the day's stroll.
    t.advance(ROUTINE_LIMITS.strollPauseMinutes * MINUTE);
    expect(t.api.runRoutines()).toMatchObject({ steps: 1 });
    expect(at()).toMatchObject({ x: 3, y: 3 });
    t.advance(HOUR);
    expect(t.api.runRoutines()).toEqual({ steps: 0, refused: 0, paused: 0 });
    const later = (await t.call("GET", "/v1/world")).body;
    expect(later.residents.find((r: Json) => r.id === wren.id).routine).toBeUndefined();

    // The away log, newest first: the stroll and the walk home, each with its step's seq.
    const view = (await t.call("GET", "/v1/routines", undefined, wren.token)).body;
    expect(view.routines).toEqual([
      { kind: "walk_home", hour: 18 },
      { kind: "stroll", hour: 19 },
    ]);
    expect(view.paused).toBe(false);
    expect(view.away.items.map((l: Json) => [l.routine, l.result])).toEqual([
      ["stroll", "done"],
      ["walk_home", "done"],
    ]);
    expect(view.away.items.every((l: Json) => Number.isInteger(l.seq))).toBe(true);
    expect(view.away.next).toBeNull();

    // The check-in carries them, and says to share them.
    const checkin = (
      await t.call(
        "GET",
        `/v1/checkin?since=${new Date(EVENING).toISOString()}`,
        undefined,
        wren.token,
      )
    ).body;
    expect(checkin.away.items).toHaveLength(2);
    expect(checkin.away.refused).toBe(0);
    expect(checkin.todo.some((l: string) => l.startsWith("Your routines did 2 things"))).toBe(true);
  });

  it("never steps while the resident is in the world, and catches up once they leave", async () => {
    const t = direct();
    const wren = await t.settled("Wren", 0, 0);
    await t.routines(wren.token, [{ kind: "walk_home", hour: 18 }]);
    t.advance(HOUR);
    // Still here from the last action: the routine waits.
    expect(t.api.runRoutines()).toEqual({ steps: 0, refused: 0, paused: 0 });
    t.away(wren.id);
    expect(t.api.runRoutines()).toMatchObject({ steps: 1 });
    expect(t.service.state.residents[wren.id]).toMatchObject({ x: 3, y: 3 });
  });

  it("writes a refusal's fixed reason, and folds the same one day after day into one line", async () => {
    const t = direct();
    const wren = t.join("Wren");
    // No plot: there's nowhere of theirs to stroll.
    await t.routines(wren.token, [{ kind: "stroll", hour: 18 }]);
    t.away(wren.id);
    t.advance(HOUR);
    expect(t.api.runRoutines()).toEqual({ steps: 0, refused: 1, paused: 0 });
    // Tried once a day: a refusal isn't tried again every minute.
    t.advance(MINUTE);
    expect(t.api.runRoutines()).toEqual({ steps: 0, refused: 0, paused: 0 });
    t.advance(DAY_MS);
    expect(t.api.runRoutines()).toEqual({ steps: 0, refused: 1, paused: 0 });

    const items = await t.lines(wren.token);
    expect(items).toEqual([
      {
        id: expect.stringMatching(/^a_\d+$/),
        at: expect.any(String),
        routine: "stroll",
        result: "refused",
        code: "not_your_plot",
        reason:
          "You weren't on your own plot when your stroll was due. Turn on walk_home for an earlier hour, so you're home by then.",
        days: 2,
      },
    ]);
    const checkin = (await t.call("GET", "/v1/checkin", undefined, wren.token)).body;
    expect(checkin.away.refused).toBe(1);
    expect(checkin.todo).toContain(
      "Your stroll routine couldn't run (2 days in a row): You weren't on your own plot when your stroll was due. Turn on walk_home for an earlier hour, so you're home by then. Fix it, or change it with set_routines, and tell your owner.",
    );
  });

  it("pauses after days with no call, says so once, and runs again after the next call", async () => {
    const t = direct();
    const wren = await t.settled("Wren", 0, 0);
    await t.routines(wren.token, [{ kind: "walk_home", hour: 18 }]);
    t.away(wren.id);
    t.advance(ROUTINE_LIMITS.pauseAfterDays * DAY_MS + HOUR);
    expect(t.api.runRoutines()).toEqual({ steps: 0, refused: 0, paused: 1 });
    t.advance(DAY_MS);
    expect(t.api.runRoutines()).toEqual({ steps: 0, refused: 0, paused: 1 });
    expect(t.service.state.residents[wren.id]).toMatchObject({ x: 3, y: 4 });

    // Reading the away log is a call: it starts them again.
    const items = await t.lines(wren.token);
    expect(items.map((l) => [l.result, l.routine])).toEqual([["paused", undefined]]);
    expect(items[0]?.reason).toContain(`${ROUTINE_LIMITS.pauseAfterDays} days`);
    expect(t.api.runRoutines()).toMatchObject({ steps: 1, paused: 0 });
    expect(t.service.state.residents[wren.id]).toMatchObject({ x: 3, y: 3 });
  });
});

describe("pausing", () => {
  it("counts acting over a socket opened days ago as being here", async () => {
    const t = direct();
    const wren = await t.settled("Wren", 0, 0);
    await t.routines(wren.token, [{ kind: "walk_home", hour: 18 }]);
    // The socket says hello today; every day after it, Wren acts over it and makes no new call.
    const socket = t.live(wren.token);
    t.advance((ROUTINE_LIMITS.pauseAfterDays + 1) * DAY_MS + HOUR);
    t.service.tick();
    socket.act({ type: "move", dir: "e" });
    socket.close();
    expect(t.service.state.residents[wren.id]).toMatchObject({ x: 4, y: 4, online: false });
    expect(t.api.runRoutines()).toEqual({ steps: 1, refused: 0, paused: 0 });
  });

  it("never pauses townsfolk, whom the town runs, while anyone else still pauses", async () => {
    const t = direct();
    const wren = await t.settled("Wren", 0, 0);
    const clem = await t.settled("Clem", 1, 0);
    t.service.syncTownsfolk(new Set([clem.id]));
    for (const who of [wren, clem]) {
      await t.routines(who.token, [{ kind: "stroll", hour: 18 }]);
      t.away(who.id);
    }
    // 20 days with no call or action from either of them.
    t.advance(20 * DAY_MS + HOUR);
    expect(t.api.runRoutines()).toEqual({ steps: 1, refused: 0, paused: 1 });
    expect(t.service.state.residents[wren.id]).toMatchObject({ x: 3, y: 4 });
    expect(t.service.state.residents[clem.id]).not.toMatchObject({ x: 11, y: 4 });
    expect((await t.lines(clem.token)).map((l) => l.result)).toEqual(["done"]);
  });
});

describe("greet", () => {
  it("waves live at whoever walks near an away hearth, capped, never across a block, with no streak", async () => {
    const t = direct();
    // Bram's hearth is (11, 3), on plot (1, 0). Max 1 wave a day.
    const bram = await t.settled("Bram", 1, 0);
    await t.routines(bram.token, [{ kind: "greet", max: 1 }]);
    t.away(bram.id);
    const cy = t.join("Cy");
    expect(
      (await t.call("PUT", `/v1/residents/${cy.id}/block`, undefined, bram.token)).status,
    ).toBe(200);
    t.away(bram.id);
    const ivy = t.join("Ivy");
    const { heard } = t.live(ivy.token);
    const dee = t.join("Dee");

    // Everyone joins at (24, 24), out of earshot of (11, 3). Walking within 12 tiles brings a wave.
    const walkNear = async (token: string) => {
      for (let i = 0; i < 9; i++) await t.act(token, { type: "move", dir: "nw" });
    };
    await walkNear(cy.token);
    await walkNear(ivy.token);
    await walkNear(dee.token);
    await walkNear(ivy.token);

    const waves = heard.filter((m) => m.type === "gesture");
    expect(waves).toEqual([
      expect.objectContaining({
        kind: "wave",
        from: expect.objectContaining({ id: bram.id }),
        routine: true,
        note: "",
      }),
    ]);
    const ivyGestures = (await t.call("GET", "/v1/gestures", undefined, ivy.token)).body;
    expect(ivyGestures.gestures).toHaveLength(1);
    expect(ivyGestures.gestures[0].routine).toBe(true);
    expect(ivyGestures.streaks).toEqual([]);
    // Only the live socket hears it: no notification.
    expect((await t.call("GET", "/v1/notifications", undefined, ivy.token)).body.unread).toBe(0);
    // Nobody across the block, and nobody past the day's max.
    for (const who of [cy, dee]) {
      expect((await t.call("GET", "/v1/gestures", undefined, who.token)).body.gestures).toEqual([]);
    }

    const items = await t.lines(bram.token);
    expect(items.map((l) => [l.routine, l.result, l.to?.id])).toEqual([["greet", "done", ivy.id]]);
  });

  it("caps routine waves in the gesture table: once a day a pair, a few a day to anyone, no note", async () => {
    const t = direct();
    const ivy = t.join("Ivy");
    const greeters = Array.from({ length: ROUTINE_LIMITS.wavesPerRecipient + 1 }, (_, i) =>
      t.join(`Greeter ${i}`),
    );
    const together = t.social.together;
    const wave = (from: string, note?: string) =>
      together.sendGesture(
        from,
        ivy.id,
        { kind: "wave", ...(note ? { note } : {}) },
        { routine: { max: 5 } },
      );
    const [first, ...rest] = greeters.map((g) => g.id);
    expect(wave(first ?? "").ok).toBe(true);
    // Past the ordinary gesture cooldown, the pair's day is still used up, whoever runs it.
    t.advance(11 * MINUTE);
    expect(wave(first ?? "")).toMatchObject({ ok: false, code: "rate_limited" });
    expect(wave(rest[0] ?? "", "hello")).toMatchObject({ ok: false, code: "bad_request" });
    for (const id of rest.slice(0, -1)) expect(wave(id).ok).toBe(true);
    expect(wave(rest.at(-1) ?? "")).toMatchObject({ ok: false, code: "rate_limited" });
    t.advance(DAY_MS);
    expect(wave(first ?? "").ok).toBe(true);
  });

  it("writes the away log and the check-in from codes and ids, never from anyone's words", async () => {
    const t = direct();
    const bram = await t.settled("Bram", 1, 0);
    await t.routines(bram.token, [
      { kind: "greet", max: 3 },
      { kind: "stroll", hour: 18 },
    ]);
    // Out of the hut and off his plot, so the stroll will be refused.
    for (let i = 0; i < 4; i++) await t.act(bram.token, { type: "move", dir: "s" });
    t.away(bram.id);
    // A visitor whose name is their own words walks past Bram's home.
    const ivy = t.join("Ivy Who Writes");
    for (let i = 0; i < 9; i++) await t.act(ivy.token, { type: "move", dir: "nw" });
    t.advance(HOUR);
    expect(t.api.runRoutines()).toMatchObject({ refused: 1 });

    for (const row of t.social.sql.exec("SELECT * FROM away_log")) {
      expect(JSON.stringify(row)).not.toContain("Ivy Who Writes");
    }
    const checkin = (await t.call("GET", "/v1/checkin", undefined, bram.token)).body;
    const written = [...checkin.todo, ...checkin.away.items.map((l: Json) => l.reason ?? "")].join(
      "\n",
    );
    expect(written).not.toContain("Ivy");
    expect(checkin.away.items.map((l: Json) => l.to?.id ?? l.code)).toEqual([
      "not_your_plot",
      ivy.id,
    ]);
    // The name comes only as the recipient's own `to`, like any name.
    expect(checkin.away.items[1].to.name).toBe("Ivy Who Writes");
  });
});

describe("noting calls", () => {
  it("never turns a call away when writing its day fails", async () => {
    const t = direct();
    const wren = t.join("Wren");
    const key = t.service.mintLinkKey(wren.id);
    t.service.onCall = () => {
      throw new Error("SQLITE_BUSY");
    };
    expect(t.service.authenticate(wren.token)).toBe(wren.id);
    expect(t.service.authenticateLinkKey(key)).toBe(wren.id);
    expect((await t.call("GET", "/v1/checkin", undefined, wren.token)).status).toBe(200);
    expect((await t.call("GET", `/v1/act/${key}/me`)).status).toBe(200);
  });
});

describe("the routines link", () => {
  it("turns routines on and off by link, and shows what they did", async () => {
    const t = direct();
    const wren = await t.settled("Wren", 0, 0);
    const key = t.service.mintLinkKey(wren.id);
    const open = async (query: string) =>
      (await t.call("GET", `/v1/act/${key}/routines${query ? `?${query}` : ""}`))
        .body as unknown as string;

    expect(await open("")).toContain("None are on right now.");
    const set = await open("walk_home=18&greet=2");
    expect(set).toContain("Saved.");
    expect(set).toContain("- Walk home at 18:00 UTC");
    expect(set).toContain("- Wave at up to 2 residents a day");
    expect(t.service.state.routines?.[wren.id]).toEqual([
      { kind: "walk_home", hour: 18 },
      { kind: "greet", max: 2 },
    ]);
    // Opening a link again answers fresh: the list shows the change, and a repeated change is a no-op.
    expect(await open("")).toContain("- Walk home at 18:00 UTC");
    expect(await open("walk_home=18&greet=2")).toContain("Nothing to change");
    expect(await open("walk_home=24")).toContain("Error code: `bad_request`");
    expect(await open("stroll=7")).toContain("- Stroll around your plot at 07:00 UTC");

    t.away(wren.id);
    t.advance(HOUR);
    t.api.runRoutines();
    expect(await open("")).toContain("UTC: walked home.");
    expect(await open("off=all")).toContain("None are on right now.");
    expect(t.service.state.routines).toBeUndefined();
  });
});
