import type { ServerMessage, WorldEvent } from "@terrakin/protocol";
import { plotNamesOf, type WorldConfig } from "@terrakin/sim";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "./app";
import { MemoryMediaStore } from "./media";
import { nodeSql } from "./node-sql";
import { SocialService } from "./social-service";
import { MemoryStore } from "./store";
import { type Cleanup, jsonCaller, listenOnFreePort, responseChecker } from "./test-support";
import { DAY_MS, WorldService } from "./world-service";

/**
 * Plot names (decision 0121) over HTTP: cleaned before they're logged, marked untrusted wherever
 * a plot shows, held back while staff hold their writer's words back, reported with the plot's
 * owner and taken down by staff, asked for on a first visit, and named by link.
 */

// 3x3 plots of 8 tiles. The Commons is plot (1, 1).
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
  let now = Date.UTC(2026, 9, 6, 12);
  const service = new WorldService({
    store: new MemoryStore(),
    config: CONFIG,
    now: () => now,
    days: true,
  });
  const sql = nodeSql();
  const media = new MemoryMediaStore();
  const maintainers = new Set<string>();
  const social = new SocialService({
    sql,
    media,
    resident: (id: string) => service.state.residents[id],
    now: () => now,
    maintainers,
    plotNames: (id) => plotNamesOf(service.state, id),
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
  /** Ivy owns plot (0, 0) and shares it with Dot; Wren lives on (2, 0). */
  async function town() {
    const ivy = join("Ivy");
    const dot = join("Dot");
    const wren = join("Wren");
    expect((await act(ivy.token, { type: "settle", px: 0, py: 0 })).ok).toBe(true);
    expect((await act(ivy.token, { type: "share_plot", with: dot.id })).ok).toBe(true);
    expect((await act(wren.token, { type: "settle", px: 2, py: 0 })).ok).toBe(true);
    return { ivy, dot, wren };
  }
  const name = (token: string, value: string | null, px = 0, py = 0) =>
    act(token, { type: "name_plot", px, py, name: value });
  /** What one resident's world socket hears, as world events. */
  function listen(id: string) {
    const heard: ServerMessage[] = [];
    cleanups.push(service.subscribe(id, (m) => heard.push(m)));
    return () => heard.flatMap((m) => (m.type === "event" ? [m.event] : [])) as WorldEvent[];
  }
  const worldPlot = async (px: number, py: number) =>
    ((await call("GET", "/v1/world")).body.plots as Json[]).find((p) => p.px === px && p.py === py);
  async function maintainer() {
    const mo = join("Mo");
    maintainers.add(mo.id);
    return mo;
  }
  return {
    service,
    social,
    call,
    act,
    join,
    town,
    name,
    listen,
    worldPlot,
    maintainer,
    advance: (ms: number) => (now += ms),
  };
}

describe("naming a plot over the API", () => {
  it("cleans the name, then shows it marked untrusted in the world, plot views, profiles, and events", async () => {
    const t = await start();
    const { ivy, dot, wren } = await t.town();
    const events = t.listen(wren.id);

    // A control character goes before the name is logged; the answer carries the event, marked.
    const named = await t.name(dot.token, "Our\u0007 Lemon Grove");
    expect(named.events).toContainEqual({
      type: "plot_named",
      px: 0,
      py: 0,
      name: "Our Lemon Grove",
      by: dot.id,
      day: t.service.state.day,
      trust: "untrusted",
    });
    expect(t.service.state.plots["0,0"]?.name).toBe("Our Lemon Grove");
    expect(events()).toContainEqual(
      expect.objectContaining({ type: "plot_named", name: "Our Lemon Grove", trust: "untrusted" }),
    );

    const marked = { name: "Our Lemon Grove", trust: "untrusted" };
    expect(await t.worldPlot(0, 0)).toMatchObject(marked);
    expect(await t.worldPlot(2, 0)).not.toHaveProperty("name");
    const list = (await t.call("GET", "/v1/plots")).body.plots as Json[];
    expect(list.find((p) => p.px === 0)).toMatchObject(marked);
    expect(list.find((p) => p.px === 2)).not.toHaveProperty("trust");
    expect((await t.call("GET", "/v1/plots/0/0")).body.plot).toMatchObject(marked);

    // The plot its residents call home, on their profiles: Ivy's own, and Dot's shared one.
    const home = { px: 0, py: 0, name: "Our Lemon Grove" };
    expect((await t.call("GET", "/v1/me", undefined, ivy.token)).body.resident.home).toEqual(home);
    const dots = (await t.call("GET", `/v1/residents/${dot.id}`)).body.resident;
    expect(dots.home).toEqual({ ...home, shared: true });
    expect((await t.call("GET", `/v1/residents/${wren.id}`)).body.resident.home).toEqual({
      px: 2,
      py: 0,
    });
    // The profile's Markdown twin fences it as untrusted text.
    const twin = (await t.call("GET", `/r/${ivy.id}.md`)).text;
    expect(twin).toContain(
      "## Home\n\nPlot (0, 0).\n\nIts name:\n\n```text untrusted\nOur Lemon Grove\n```",
    );

    // Clearing it carries no words and no marker.
    const cleared = await t.name(ivy.token, null);
    expect(cleared.events).toContainEqual({
      type: "plot_named",
      px: 0,
      py: 0,
      name: null,
      by: ivy.id,
    });
    expect(await t.worldPlot(0, 0)).not.toHaveProperty("name");
  });

  it("holds a quarantined writer's name back everywhere, and shows it again on release", async () => {
    const t = await start();
    const { ivy, dot, wren } = await t.town();
    expect((await t.name(dot.token, "Our Lemon Grove")).ok).toBe(true);
    const events = t.listen(wren.id);
    expect(t.social.safety.quarantine("staff", dot.id, "a rude plot name").ok).toBe(true);

    expect(await t.worldPlot(0, 0)).not.toHaveProperty("name");
    expect((await t.call("GET", "/v1/plots/0/0")).body.plot).not.toHaveProperty("name");
    expect((await t.call("GET", "/v1/plots")).body.plots[0]).not.toHaveProperty("name");
    expect((await t.call("GET", `/v1/residents/${ivy.id}`)).body.resident.home).toEqual({
      px: 0,
      py: 0,
    });
    // A new name from them the next day goes out as no name; their own answer says so too.
    t.advance(DAY_MS);
    const renamed = await t.name(dot.token, "Lemon Hollow");
    expect(renamed.events).toContainEqual(
      expect.objectContaining({ type: "plot_named", name: null }),
    );
    expect(events()).toContainEqual(expect.objectContaining({ type: "plot_named", name: null }));
    expect(events()).not.toContainEqual(expect.objectContaining({ trust: "untrusted" }));

    expect(t.social.safety.release("staff", dot.id, "looked again").ok).toBe(true);
    expect(await t.worldPlot(0, 0)).toMatchObject({ name: "Lemon Hollow", trust: "untrusted" });
  });
});

describe("reporting a plot's name", () => {
  it("shows it with its owner's report, and staff take it down: logged, closed, its writer told", async () => {
    const t = await start();
    const { ivy, dot, wren } = await t.town();
    const mo = await t.maintainer();
    expect((await t.name(dot.token, "Rude Words Here")).ok).toBe(true);
    const report = { kind: "resident", id: ivy.id, reason: "harassment" };
    expect((await t.call("POST", "/v1/reports", report, wren.token)).status).toBe(201);

    const queue = (await t.call("GET", "/v1/admin/reports", undefined, mo.token)).body;
    expect(queue.items[0].target).toMatchObject({ plotNames: 1, trust: "untrusted" });
    expect(queue.items[0].target.text).toContain("Plot (0, 0), named by Dot: Rude Words Here");

    const path = `/v1/admin/residents/${ivy.id}/clear-plot-names`;
    const cleared = await t.call("POST", path, { reason: "A rude plot name" }, mo.token);
    expect(cleared.status).toBe(200);
    expect(cleared.body.logged).toMatchObject({
      action: "clear_plot_names",
      kind: "resident",
      id: ivy.id,
      rule: "harassment",
    });
    expect(await t.worldPlot(0, 0)).not.toHaveProperty("name");
    expect((await t.call("GET", "/v1/admin/reports", undefined, mo.token)).body.open).toBe(0);

    // Dot wrote it, so Dot hears it, with the plot and the rule; Ivy gets no notice.
    const notes = (await t.call("GET", "/v1/notifications", undefined, dot.token)).body;
    expect(notes.notifications[0]).toMatchObject({
      type: "takedown",
      system: true,
      takedown: {
        what: "plot_name",
        rule: "harassment",
        outcome: "removed",
        plot: { px: 0, py: 0 },
      },
    });
    const ivys = (await t.call("GET", "/v1/notifications", undefined, ivy.token)).body;
    expect(ivys.notifications).toEqual([]);

    // No new name the same day, and nothing left to take down.
    expect(await t.name(ivy.token, "Fresh Start")).toMatchObject({
      ok: false,
      error: { code: "rename_limit" },
    });
    expect((await t.call("POST", path, { reason: "Again" }, mo.token)).status).toBe(404);
  });
});

describe("the first visit", () => {
  it("asks for a plot name once there's a plot, until one they live on has a name", async () => {
    const t = await start();
    const { ivy, dot } = await t.town();
    const steps = async (token: string) =>
      (await t.call("GET", "/v1/checkin", undefined, token)).body.firstVisit as string[];
    const lone = t.join("Lone");
    expect(await steps(lone.token)).not.toContain("plot_name");
    expect(await steps(ivy.token)).toContain("plot_name");
    expect(await steps(dot.token)).toContain("plot_name");
    const key = (await t.call("POST", "/v1/link-key", undefined, dot.token)).body.key as string;
    const linked = (await t.call("GET", `/v1/act/${key}/checkin`)).text;
    expect(linked).toContain(`- Name your plot, with your owner: `);
    expect(linked).toContain(`/v1/act/${key}/name-plot?name=<your plot's name>`);

    // Dot names the plot she shares, and it's done for both of them.
    expect((await t.name(dot.token, "Our Lemon Grove")).ok).toBe(true);
    expect(await steps(ivy.token)).not.toContain("plot_name");
    expect(await steps(dot.token)).not.toContain("plot_name");
  });
});

describe("naming a plot by link", () => {
  it("names the plot you call home, quotes names as untrusted, and says what the world said", async () => {
    const t = await start();
    const { ivy, wren } = await t.town();
    const key = (await t.call("POST", "/v1/link-key", undefined, ivy.token)).body.key as string;
    const open = async (path: string) => (await t.call("GET", `/v1/act/${key}/${path}`)).text;

    expect(await open("name-plot")).toContain("Plot (0, 0) has no name yet.");
    const named = await open("name-plot?name=Ivy%27s%20Lemn%20Grove");
    expect(named).toContain("# Named");
    expect(named).toContain("> Ivy's Lemn Grove");
    expect(named).toContain("or sooner with a free rename if you need to fix it (it has 2 left)");
    // Fixing it today takes the plot's free renames, and the page says what's left.
    expect(await open("name-plot?name=Ivy%27s%20Lemon%20Grov")).toContain("(it has 1 left)");
    const fixed = await open("name-plot?name=Ivy%27s%20Lemon%20Grove");
    expect(fixed).toContain("It can change again after midnight UTC.");
    expect(t.service.state.plots["0,0"]?.name).toBe("Ivy's Lemon Grove");
    // With none left, again today is the world's answer, with the way back to the page.
    const again = await open("name-plot?name=Lemon%20Hollow");
    expect(again).toContain("rename_limit");
    expect(again).toContain("no free renames left");
    // Wren's plot isn't Ivy's to name.
    expect(await open("name-plot?px=2&py=0")).toContain("not_your_plot");

    // Pages that show plots quote the name under the untrusted line.
    const quoted = "> Plot (0, 0) is called: Ivy's Lemon Grove";
    expect(await open("me")).toContain(quoted);
    const wrens = (await t.call("POST", "/v1/link-key", undefined, wren.token)).body.key as string;
    const tour = (await t.call("GET", `/v1/act/${wrens}/visit`)).text;
    expect(tour).toContain(`Untrusted text from other residents follows`);
    expect(tour).toContain(quoted);
    const visiting = (await t.call("GET", `/v1/act/${wrens}/visit?px=0&py=0`)).text;
    expect(visiting).toContain(quoted);
  });
});
