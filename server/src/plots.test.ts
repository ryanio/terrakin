import { type ErrorCode, PLOT_ADMIRE } from "@terrakin/protocol";
import { apply, type Command, createWorld, visitTile, type WorldConfig } from "@terrakin/sim";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "./app";
import { MemoryMediaStore } from "./media";
import { nodeSql } from "./node-sql";
import { PLOT_LIST_MS, PlotVisits } from "./plots";
import { SocialService } from "./social-service";
import { MemoryStore } from "./store";
import { type Cleanup, jsonCaller, listenOnFreePort, responseChecker } from "./test-support";
import { DAY_MS, WorldService } from "./world-service";

/** Plots worth visiting (RFC 0020): admiring a plot, and the plot lists. */

// 5x5 plots of 8 tiles. The Commons is plot (2, 2).
const CONFIG: WorldConfig = {
  width: 40,
  height: 40,
  plotSize: 8,
  maxPlotsPerResident: 1,
  reach: 3,
};
const NOON = Date.UTC(2026, 9, 6, 12);

const cleanups: Cleanup[] = [];
const { problems, onResponse } = responseChecker();
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
  expect(problems.splice(0)).toEqual([]);
});

// biome-ignore lint/suspicious/noExplicitAny: the response checker already holds every body to its schema.
type Json = Record<string, any>;

describe("admiring a plot", () => {
  /**
   * Ivy owns plot (0, 0) and shares it with Dot; Felix is Ivy's AI. Wren lives on (4, 4), and the
   * other plots in the top row belong to Ann, Bo, Cal, and Eli. Everyone has been here a while
   * unless they're in `fresh`.
   */
  function town() {
    const state = createWorld(CONFIG);
    let now = NOON;
    const blocked = new Set<string>();
    const fresh = new Set(["new"]);
    const suspended = new Set<string>();
    const told: string[] = [];
    const sql = nodeSql();
    cleanups.push(() => sql.close());
    const visits = new PlotVisits({
      sql,
      now: () => now,
      exists: (id) => state.residents[id] !== undefined,
      blockedEither: (a, b) => blocked.has([a, b].sort().join(" ")),
      household: (a, b) => a === b || [a, b].sort().join(" ") === "felix ivy",
      ageDays: (id) => (fresh.has(id) ? 0 : 30),
      suspended: (id) => suspended.has(id),
      notify: (to, from, plot) => told.push(`${from} -> ${to} (${plot.px}, ${plot.py})`),
    });
    /** Apply an input and hand what it did to the plot tables, as the world service does. */
    const run = (actor: string, command: Command) => {
      const result = apply(state, { actor, command });
      expect(result.ok, `${actor} ${command.type}`).toBe(true);
      if (result.ok) visits.noteCommitted(state, { actor, command }, result.events);
    };
    const plots: [string, number, number][] = [
      ["ivy", 0, 0],
      ["ann", 1, 0],
      ["bo", 2, 0],
      ["cal", 3, 0],
      ["eli", 4, 0],
      ["wren", 4, 4],
    ];
    for (const id of ["ivy", "dot", "felix", "ann", "bo", "cal", "eli", "wren", "zed", "new"]) {
      run(id, { type: "join", name: id, kind: "human" });
    }
    for (const [id, px, py] of plots) run(id, { type: "settle", px, py });
    run("ivy", { type: "share_plot", with: "dot" });
    /** Jump to a plot the way the server sends a visit. */
    const go = (actor: string, px: number, py: number) =>
      run(actor, { type: "visit", px, py, ...visitTile(state, actor, px, py) });
    const walk = (actor: string, dir: "e" | "w", tiles: number) => {
      for (let i = 0; i < tiles; i++) run(actor, { type: "move", dir });
    };
    const admire = (actor: string, px: number, py: number) => visits.admire(state, actor, px, py);
    const week = () => visits.facts().admirers;
    return {
      state,
      run,
      go,
      walk,
      admire,
      week,
      facts: (only?: { px: number; py: number }) => visits.facts(only),
      told,
      blocked,
      suspended,
      advance: (ms: number) => (now += ms),
    };
  }

  it("counts once a UTC day per resident per plot, from on it, or beside it after a visit this week", () => {
    const t = town();
    // Wren stands on her own plot, far from Ivy's.
    expect(t.admire("wren", 0, 0)).toMatchObject({
      ok: false,
      code: "out_of_reach",
      message:
        'Stand on the plot or beside it to admire it. Visit it first: {"type": "visit", "px": 0, "py": 0}.',
    });
    // Ann's plot is next door, x 8 to 15, and she settled at its center, (11, 3). Two tiles west,
    // at (9, 3), she's too far from Ivy's plot. One more, at her own plot's edge, she's beside it,
    // but she hasn't visited it, so that isn't enough.
    expect(t.state.residents.ann).toMatchObject({ x: 11, y: 3 });
    t.walk("ann", "w", 2);
    expect(t.admire("ann", 0, 0)).toMatchObject({ ok: false, code: "out_of_reach" });
    t.walk("ann", "w", 1);
    expect(t.state.residents.ann).toMatchObject({ x: 8, y: 3 });
    expect(t.admire("ann", 0, 0)).toMatchObject({
      ok: false,
      code: "out_of_reach",
      message:
        'To admire this plot from beside it, visit it first: {"type": "visit", "px": 0, "py": 0}. Standing on it works too.',
    });
    expect(t.told).toEqual([]);
    // She visits, landing at (3, 0), and walks back to her own edge: now beside it is enough.
    t.go("ann", 0, 0);
    expect(t.state.residents.ann).toMatchObject({ x: 3, y: 0 });
    t.walk("ann", "e", 5);
    expect(t.admire("ann", 0, 0)).toEqual({ ok: true, value: null });
    expect(t.admire("ann", 0, 0)).toMatchObject({ ok: false, code: "already_admired" });
    // Both of the plot's residents hear about it.
    expect(t.told).toEqual(["ann -> ivy (0, 0)", "ann -> dot (0, 0)"]);
    expect(t.week().get("0,0|ivy")).toBe(1);
    // The next day the visit still counts, and she's still one neighbor this week, however many
    // days she admires it.
    t.advance(DAY_MS);
    expect(t.admire("ann", 0, 0)).toEqual({ ok: true, value: null });
    expect(t.week().get("0,0|ivy")).toBe(1);
    // A week later the visit is too old: beside the plot needs a new one, and on it is enough.
    t.advance(PLOT_ADMIRE.weekDays * DAY_MS);
    expect(t.admire("ann", 0, 0)).toMatchObject({ ok: false, code: "out_of_reach" });
    t.walk("ann", "w", 1);
    expect(t.admire("ann", 0, 0)).toEqual({ ok: true, value: null });
  });

  it("refuses your own plot, your household's, a block, a first day, and plots nobody lives on", () => {
    const t = town();
    for (const id of ["felix", "zed", "new"]) t.go(id, 0, 0);
    t.blocked.add(["ivy", "zed"].sort().join(" "));
    const cases: [string, number, number, ErrorCode][] = [
      ["ivy", 0, 0, "own_plot"],
      ["dot", 0, 0, "own_plot"],
      ["felix", 0, 0, "forbidden"],
      ["zed", 0, 0, "forbidden"],
      ["new", 0, 0, "rate_limited"],
      ["wren", 2, 2, "not_found"],
      ["wren", 0, 4, "not_found"],
      ["wren", 9, 0, "not_found"],
      ["nobody", 0, 0, "unauthorized"],
    ];
    for (const [actor, px, py, code] of cases) {
      expect(t.admire(actor, px, py), `${actor} (${px}, ${py})`).toMatchObject({ ok: false, code });
    }
    // A first day waits for the next UTC day, from noon: half a day.
    expect(t.admire("new", 0, 0)).toMatchObject({ retryAfter: DAY_MS / 2 / 1000 });
    // A suspended owner's plot is closed for now.
    t.go("wren", 1, 0);
    t.suspended.add("ann");
    expect(t.admire("wren", 1, 0)).toMatchObject({ ok: false, code: "not_found" });
    expect(t.told).toEqual([]);
    expect(t.week().size).toBe(0);
  });

  it("reads one plot's rows alone for that plot's view", () => {
    const t = town();
    for (const [px, py] of [
      [0, 0],
      [1, 0],
    ] as const) {
      t.go("wren", px, py);
      expect(t.admire("wren", px, py).ok).toBe(true);
    }
    expect([...t.facts().admirers.keys()].sort()).toEqual(["0,0|ivy", "1,0|ann"]);
    const one = t.facts({ px: 1, py: 0 });
    expect([...one.admirers.keys()]).toEqual(["1,0|ann"]);
    expect([...one.visitors.keys()]).toEqual(["1,0|ann"]);
    expect([...one.changed.keys()]).toEqual(["1,0"]);
  });

  it("stops at the daily count, and opens again the next UTC day", () => {
    const t = town();
    // Ten plots that aren't Wren's: she can admire all ten in a day.
    const state = t.state;
    const extra: [string, number, number][] = [
      ["gus", 0, 1],
      ["hal", 1, 1],
      ["ida", 3, 1],
      ["jo", 4, 1],
      ["kai", 0, 2],
    ];
    for (const [id, px, py] of extra) {
      t.run(id, { type: "join", name: id, kind: "human" });
      t.run(id, { type: "settle", px, py });
    }
    const theirs = Object.values(state.plots).filter((p) => p.ownerId !== "wren");
    expect(theirs).toHaveLength(10);
    for (const p of theirs) {
      t.go("wren", p.px, p.py);
      expect(t.admire("wren", p.px, p.py).ok, `(${p.px}, ${p.py})`).toBe(true);
    }
    // An eleventh plot to try it on.
    t.run("lu", { type: "join", name: "lu", kind: "human" });
    t.run("lu", { type: "settle", px: 1, py: 2 });
    t.go("wren", 1, 2);
    expect(t.admire("wren", 1, 2)).toMatchObject({
      ok: false,
      code: "rate_limited",
      message: "You've admired 10 plots today. You can again after midnight UTC.",
    });
    t.advance(DAY_MS);
    expect(t.admire("wren", 1, 2)).toEqual({ ok: true, value: null });
  });
});

describe("plots to visit over HTTP", () => {
  async function start() {
    let now = NOON;
    const service = new WorldService({ store: new MemoryStore(), config: CONFIG, now: () => now });
    const sql = nodeSql();
    const media = new MemoryMediaStore();
    const social = new SocialService({
      sql,
      media,
      resident: (id: string) => service.state.residents[id],
      now: () => now,
      residentAgeDays: () => 30,
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
    const join = (name: string, kind: "human" | "agent" = "human") => {
      const made = service.createSession({ name, kind });
      if (!made.ok || !made.residentId || !made.token) throw new Error(`Couldn't join ${name}`);
      return { id: made.residentId, token: made.token };
    };
    const act = async (token: string, action: Json) =>
      (await call("POST", "/v1/actions", action, token)).body as Json;
    const plots = async (query = "", token?: string) =>
      (await call("GET", `/v1/plots${query}`, undefined, token)).body.plots as Json[];
    return { call, join, act, plots, social, service, advance: (ms: number) => (now += ms) };
  }

  it("lists plots by their latest change, takes visitors to the door, and counts admirers without naming them", async () => {
    const t = await start();
    const ivy = t.join("Ivy");
    const sam = t.join("Sam");
    const wren = t.join("Wren");
    const felix = t.join("Felix", "agent");
    t.social.link(felix.id, ivy.id);
    await t.act(ivy.token, { type: "settle", px: 0, py: 0 });
    await t.act(ivy.token, { type: "build_starter_home" });
    t.advance(60_000);
    await t.act(sam.token, { type: "settle", px: 2, py: 0 });
    await t.act(sam.token, { type: "build_starter_home" });

    // Without a token: both plots, Sam's built a minute later, so first. Nobody has visited.
    const first = await t.plots();
    expect(first.map((p) => [p.px, p.py, p.owner.id, p.blocks])).toEqual([
      [2, 0, sam.id, 15],
      [0, 0, ivy.id, 15],
    ]);
    expect(first[1]).toMatchObject({
      visitors: 0,
      admirers: 0,
      changedAt: new Date(NOON).toISOString(),
    });
    expect(first[1]?.admiredToday).toBeUndefined();

    // A dry run checks the visit and leaves Wren where she is; the real one lands at Ivy's door.
    const at = { ...t.service.state.residents[wren.id] };
    expect(await t.act(wren.token, { type: "visit", px: 0, py: 0, dry: true })).toMatchObject({
      ok: true,
      dry: true,
    });
    expect(t.service.state.residents[wren.id]).toMatchObject({ x: at.x, y: at.y });
    expect((await t.act(wren.token, { type: "visit", px: 0, py: 0 })).events).toEqual([
      { type: "moved", residentId: wren.id, x: 3, y: 7 },
    ]);
    // Ivy's own AI visiting counts as household, not as a visitor, and can't admire it.
    await t.act(felix.token, { type: "visit", px: 0, py: 0 });
    const felixAdmires = await t.call("POST", "/v1/plots/0/0/admire", undefined, felix.token);
    expect(felixAdmires.body.error.code).toBe("forbidden");

    const admired = await t.call("POST", "/v1/plots/0/0/admire", undefined, wren.token);
    expect(admired.status).toBe(201);
    expect(admired.body.plot).toMatchObject({
      px: 0,
      py: 0,
      visitors: 1,
      admirers: 1,
      admiredToday: true,
    });
    const again = await t.call("POST", "/v1/plots/0/0/admire", undefined, wren.token);
    expect(again.body.error.code).toBe("already_admired");

    // Ivy hears it, with the plot, and her check-in says how many without saying who.
    const notes = (await t.call("GET", "/v1/notifications", undefined, ivy.token)).body;
    expect(notes.notifications[0]).toMatchObject({
      type: "plot_admired",
      actor: { id: wren.id },
      count: 1,
      plot: { px: 0, py: 0 },
      postId: null,
    });
    const checkin = (await t.call("GET", "/v1/checkin", undefined, ivy.token)).body;
    const line = checkin.todo.find((l: string) => l.includes("admired a plot of yours"));
    expect(line).toBe(
      "1 resident admired a plot of yours (`plot_admired` notifications). Tell your owner. GET /v1/plots/0/0 has this week's visitors and admirers.",
    );

    // Most admired first; the lists never say who visited or admired.
    expect((await t.plots("?sort=admired")).map((p) => [p.px, p.py])).toEqual([
      [0, 0],
      [2, 0],
    ]);
    const anon = await t.call("GET", "/v1/plots");
    expect(JSON.stringify(anon.body)).not.toContain(wren.id);
    expect((await t.call("GET", "/v1/plots/0/0", undefined, wren.token)).body.plot).toMatchObject({
      admiredToday: true,
    });
    expect((await t.call("GET", "/v1/plots/1/0")).status).toBe(404);

    // A second admirer within the hour joins the same notification.
    const ash = t.join("Ash");
    await t.act(ash.token, { type: "visit", px: 0, py: 0 });
    expect((await t.call("POST", "/v1/plots/0/0/admire", undefined, ash.token)).status).toBe(201);
    const grouped = (await t.call("GET", "/v1/notifications", undefined, ivy.token)).body;
    expect(grouped.notifications.filter((n: Json) => n.type === "plot_admired")).toEqual([
      expect.objectContaining({ actor: expect.objectContaining({ id: ash.id }), count: 2 }),
    ]);

    // Ivy building on her plot makes it the latest change.
    t.advance(60_000);
    await t.act(ivy.token, { type: "place", x: 1, y: 6, block: "leaf" });
    expect((await t.plots())[0]).toMatchObject({ px: 0, py: 0, blocks: 16 });

    // Once Sam blocks Wren, she can't visit his plot, but it stays in her list, as it is in the
    // list anyone can read: leaving it out would tell her who blocked her.
    await t.call("PUT", `/v1/residents/${wren.id}/block`, undefined, sam.token);
    const both = [
      [0, 0],
      [2, 0],
    ];
    expect((await t.plots("", wren.token)).map((p) => [p.px, p.py])).toEqual(both);
    expect((await t.plots()).map((p) => [p.px, p.py])).toEqual(both);
    expect((await t.call("GET", "/v1/plots/2/0", undefined, wren.token)).status).toBe(200);
    expect(await t.act(wren.token, { type: "visit", px: 2, py: 0 })).toMatchObject({
      ok: false,
      error: { code: "forbidden" },
    });
    // The plots of someone Wren blocked are gone from her list, and from a read of one plot.
    await t.call("PUT", `/v1/residents/${ivy.id}/block`, undefined, wren.token);
    expect((await t.plots("", wren.token)).map((p) => [p.px, p.py])).toEqual([[2, 0]]);
    expect((await t.call("GET", "/v1/plots/0/0", undefined, wren.token)).status).toBe(404);
  });
  it("closes a suspended owner's plot to visits, and points a visit to an empty plot at one that's open", async () => {
    const t = await start();
    const ivy = t.join("Ivy");
    const sam = t.join("Sam");
    const kit = t.join("Kit");
    const wren = t.join("Wren");
    await t.act(ivy.token, { type: "settle", px: 0, py: 0 });
    await t.act(sam.token, { type: "settle", px: 2, py: 0 });
    await t.act(kit.token, { type: "settle", px: 4, py: 0 });
    const empty = async () =>
      (await t.act(wren.token, { type: "visit", px: 0, py: 1 })).error.message as string;
    // The nearest plot someone lives on is Ivy's.
    expect(await empty()).toContain("Try visit at px 0, py 0,");
    // Once Ivy blocks Wren, the hint passes her plot for Sam's.
    await t.call("PUT", `/v1/residents/${wren.id}/block`, undefined, ivy.token);
    expect(await empty()).toContain("Try visit at px 2, py 0,");
    // Sam is suspended: his plot is closed to visits, real or dry, and the hint moves on to Kit's.
    expect(t.social.safety.suspend("staff", sam.id, 3, "test").ok).toBe(true);
    for (const dry of [false, true]) {
      expect(await t.act(wren.token, { type: "visit", px: 2, py: 0, dry })).toMatchObject({
        ok: false,
        error: { code: "forbidden", message: "That plot is closed for now." },
      });
    }
    expect(await empty()).toBe(
      "Nobody lives on that plot yet. Try visit at px 4, py 0, the nearest plot someone lives on. Or make it yours: try settle at px 0, py 1.",
    );
  });
  it("builds the list at most once a minute, and again after a visit or an admire, while one plot reads fresh", async () => {
    const t = await start();
    const ivy = t.join("Ivy");
    const wren = t.join("Wren");
    await t.act(ivy.token, { type: "settle", px: 0, py: 0 });
    await t.act(ivy.token, { type: "build_starter_home" });
    const listed = async () => (await t.plots())[0] as Json;
    const one = async () => (await t.call("GET", "/v1/plots/0/0")).body.plot as Json;
    expect(await listed()).toMatchObject({ blocks: 15, visitors: 0, admirers: 0 });
    // Ivy places a block: her plot's own read has it at once, the list within a minute.
    expect((await t.act(ivy.token, { type: "place", x: 1, y: 6, block: "leaf" })).ok).toBe(true);
    expect(await one()).toMatchObject({ blocks: 16 });
    expect(await listed()).toMatchObject({ blocks: 15 });
    t.advance(PLOT_LIST_MS);
    expect(await listed()).toMatchObject({ blocks: 16 });
    // A visit, and then an admire, each show in the list at once.
    await t.act(wren.token, { type: "visit", px: 0, py: 0 });
    expect(await listed()).toMatchObject({ visitors: 1, admirers: 0 });
    expect((await t.call("POST", "/v1/plots/0/0/admire", undefined, wren.token)).status).toBe(201);
    expect(await listed()).toMatchObject({ visitors: 1, admirers: 1 });
  });

  it("refuses a visit across a block either way, with the owner or a co-owner, dry runs too", async () => {
    const t = await start();
    const ivy = t.join("Ivy");
    const dot = t.join("Dot");
    const wren = t.join("Wren");
    await t.act(ivy.token, { type: "settle", px: 0, py: 0 });
    await t.act(ivy.token, { type: "share_plot", with: dot.id });
    const visit = (dry: boolean) => t.act(wren.token, { type: "visit", px: 0, py: 0, dry });
    const refused = {
      ok: false,
      error: { code: "forbidden", message: "You can't visit this plot." },
    };
    const at = { ...t.service.state.residents[wren.id] };
    // Wren blocks the owner.
    await t.call("PUT", `/v1/residents/${ivy.id}/block`, undefined, wren.token);
    expect(await visit(false)).toMatchObject(refused);
    expect(await visit(true)).toMatchObject({ ...refused, dry: true });
    await t.call("DELETE", `/v1/residents/${ivy.id}/block`, undefined, wren.token);
    // The plot's co-owner blocks Wren.
    await t.call("PUT", `/v1/residents/${wren.id}/block`, undefined, dot.token);
    expect(await visit(true)).toMatchObject({ ...refused, dry: true });
    expect(await visit(false)).toMatchObject(refused);
    expect(t.service.state.residents[wren.id]).toMatchObject({ x: at.x, y: at.y });
    // With the block gone, the same visit goes through.
    await t.call("DELETE", `/v1/residents/${wren.id}/block`, undefined, dot.token);
    expect((await visit(false)).ok).toBe(true);
  });
});

describe("the commit hook", () => {
  it("never fails or undoes an action when it throws", () => {
    const store = new MemoryStore();
    const service = new WorldService({ store, config: CONFIG });
    service.onCommitted = () => {
      throw new Error("the plots table is gone");
    };
    const made = service.createSession({ name: "Wren", kind: "human" });
    if (!made.ok || !made.residentId) throw new Error("Couldn't join Wren");
    const result = service.act(made.residentId, { type: "move", dir: "n" });
    expect(result).toMatchObject({ ok: true, seq: service.state.seq });
    expect(store.log.at(-1)).toEqual({
      actor: made.residentId,
      command: { type: "move", dir: "n" },
    });
  });
});
