import { readFileSync } from "node:fs";
import {
  JOB_WORDS,
  type JobDoneView,
  type NotificationView,
  type ServerMessage,
  TERRAKIN_ACTOR,
  type WorldEvent as WireEvent,
} from "@terrakin/protocol";
import {
  DAY_MS,
  hashWorld,
  JOB_EDITIONS,
  JOBS,
  jobsOn,
  replay,
  type WorldConfig,
  type WorldEvent,
} from "@terrakin/sim";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WebSocket } from "ws";
import { JOBS_CONFIG, JOBS_LOG } from "../../sim/src/fixtures/jobs-log";
import { createApp, TEST_OPEN_JOBS_PATH } from "./app";
import { pickTryNext, TRY_NEXT } from "./checkin-suggest";
import { eventWords } from "./events";
import {
  checkinJobs,
  giverIds,
  jobDoneView,
  jobsDoneField,
  jobsView,
  jobTodo,
  linkCanFinish,
} from "./jobs";
import { levelView } from "./levels";
import { MemoryMediaStore } from "./media";
import { nodeSql } from "./node-sql";
import { SocialService } from "./social-service";
import { MemoryStore } from "./store";
import {
  type Cleanup,
  jsonCaller,
  listenOnFreePort,
  recordTelemetry,
  responseChecker,
} from "./test-support";
import { WorldService } from "./world-service";
import { eventsFor, publicEvents, toWire } from "./world-wire";

/**
 * Jobs (RFC 0030) over HTTP: nothing of them in a world that never opened them, the switch, the
 * board anyone may read, job events that reach only their resident, the notice and the one `todo`
 * line a finished job makes, a check-in that carries the board and never asks, and the link page.
 */

// 3x3 plots of 8 tiles. Settling plot (0, 0) and building the starter home leaves you on the
// hearth at (3, 3), inside a hut from (1, 1) to (5, 5).
const CONFIG: WorldConfig = {
  width: 24,
  height: 24,
  plotSize: 8,
  maxPlotsPerResident: 1,
  reach: 3,
};
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

const cleanups: Cleanup[] = [];
const { problems, onResponse } = responseChecker();
const telemetry = recordTelemetry();
beforeEach(telemetry.start);
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
  telemetry.stop();
  expect(problems.splice(0)).toEqual([]);
});

// biome-ignore lint/suspicious/noExplicitAny: the response checker already holds every body to its schema.
type Json = Record<string, any>;

/** Every job id and every job's words, to look for in text that should name none. */
const EVERY_JOB = new RegExp(
  [...Object.keys(JOB_WORDS), ...Object.values(JOB_WORDS)].join("|"),
  "i",
);

/**
 * The world on Tuesday 6 October 2026, 09:00 UTC, with coins, things, and presence. Levels and
 * jobs are closed until a test opens them. A boot after another passes the same `store` and `sql`.
 */
async function start(
  options: {
    store?: MemoryStore;
    sql?: ReturnType<typeof nodeSql>;
    levels?: boolean;
    jobs?: boolean;
    testClock?: boolean;
    at?: number;
  } = {},
) {
  let now = options.at ?? Date.UTC(2026, 9, 6, 9);
  const store = options.store ?? new MemoryStore();
  const service = new WorldService({
    store,
    config: CONFIG,
    now: () => now,
    days: true,
    economy: true,
    items: true,
    presence: true,
    levels: options.levels ?? false,
    jobs: options.jobs ?? false,
  });
  const sql = options.sql ?? nodeSql();
  const social = new SocialService({
    sql,
    media: new MemoryMediaStore(),
    resident: (id: string) => service.state.residents[id],
    now: () => now,
    residentAgeDays: (id) => service.residentAgeDays(id),
    credits: (since) => service.credits(since),
    event: (id) => eventWords(service.state, id),
  });
  const server = createApp({
    service,
    social,
    media: new MemoryMediaStore(),
    actionsPerSecond: 1000,
    sessionsPerMinute: 1000,
    onResponse,
    // The repeat window of a link opened twice runs on the test's clock too.
    now: () => now,
    ...(options.testClock ? { testClock: { advanceDay: () => service.state.day ?? null } } : {}),
  });
  if (!options.sql) cleanups.push(() => sql.close());
  const base = await listenOnFreePort(server, cleanups);
  const call = jsonCaller(base);
  const act = async (token: string, action: Json) =>
    (await call("POST", "/v1/actions", action, token)).body;
  async function settler(name: string, px: number, py: number, kind: "human" | "agent" = "agent") {
    const made = service.createSession({ name, kind });
    if (!made.ok || !made.residentId || !made.token) throw new Error(`Couldn't join ${name}`);
    expect(await act(made.token, { type: "settle", px, py })).toMatchObject({ ok: true });
    expect(await act(made.token, { type: "build_starter_home" })).toMatchObject({ ok: true });
    return { id: made.residentId, token: made.token, px, py };
  }
  /** Move the clock on, then do what the minute sweep does, in its order. */
  const later = (ms: number) => {
    now += ms;
    service.tick();
    service.sweepEvents();
    service.sweepIdle();
  };
  /** Everything a resident's socket would be sent. */
  const listen = (id: string) => {
    const got: ServerMessage[] = [];
    cleanups.push(service.subscribe(id, (m) => got.push(m)));
    return () => got.flatMap((m) => (m.type === "event" ? [m.event] : [])) as WireEvent[];
  };
  /** A workbench beside the hearth, with wood and flowers, and what making `recipe` answers. */
  const bench = async (r: { id: string; token: string; px: number; py: number }) => {
    const tile = { x: r.px * 8 + 4, y: r.py * 8 + 3 };
    expect(service.testGrant(r.id, undefined, { wood: 8, flower: 6 })).toMatchObject({ ok: true });
    expect(await act(r.token, { type: "place", ...tile, block: "workbench" })).toMatchObject({
      ok: true,
    });
    return (recipe: string) => act(r.token, { type: "craft", recipe, ...tile });
  };
  /** Levels, which jobs need, and then jobs. */
  const open = () => {
    expect(service.testOpenLevels()).toMatchObject({ ok: true });
    return service.testOpenJobs();
  };
  /** Today's board, by id. */
  const board = () => jobsOn(service.state).map((job) => job.id);
  /** Move on a day at a time until `job` is on the board. */
  const until = (job: string) => {
    for (let days = 0; days < 40 && !board().includes(job); days++) later(DAY_MS);
    expect(board()).toContain(job);
  };
  const logged = (type: string) => store.log.filter((input) => input.command.type === type);
  const checkin = async (token: string, query = "") =>
    (await call("GET", `/v1/checkin${query}`, undefined, token)).body;
  const notes = async (token: string): Promise<NotificationView[]> =>
    (await call("GET", "/v1/notifications", undefined, token)).body.notifications;
  service.tick();
  return {
    base,
    call,
    act,
    settler,
    later,
    listen,
    bench,
    open,
    board,
    until,
    logged,
    checkin,
    notes,
    service,
    social,
    store,
    sql,
    now: () => now,
  };
}

type T = Awaited<ReturnType<typeof start>>;

const types = (events: readonly { type: string }[]) => events.map((e) => e.type);
const jobEvents = (events: readonly { type: string }[]) =>
  types(events).filter((type) => type.startsWith("job"));

/** Every key in a JSON value, at any depth. */
function keysIn(value: unknown, found = new Set<string>()): Set<string> {
  if (Array.isArray(value)) for (const v of value) keysIn(v, found);
  else if (value && typeof value === "object") {
    for (const [key, v] of Object.entries(value)) {
      found.add(key);
      keysIn(v, found);
    }
  }
  return found;
}

describe("a world that never opened jobs", () => {
  /**
   * A world with every switch terrakin.org sets, and levels and jobs as asked, after three days of
   * ticks, with what it logged and every line it wrote for a switch the sim refused.
   */
  function threeDays(jobs: boolean, levels = true) {
    const refused: string[] = [];
    const errors = vi.spyOn(console, "error").mockImplementation((line) => {
      refused.push(String(line));
    });
    let now = Date.UTC(2026, 9, 10, 12);
    const store = new MemoryStore();
    const service = new WorldService({
      store,
      now: () => now,
      days: true,
      economy: true,
      items: true,
      gifts: true,
      plotPickups: true,
      finds: true,
      solidBuildings: true,
      tableSpots: true,
      shop: true,
      recipes: true,
      holidayPrices: true,
      levels,
      market: true,
      bounties: true,
      presence: true,
      jobs,
    });
    // The levels switch waits for the collection book's credit, which `Api` wires.
    service.levelFirsts = () => [];
    try {
      for (let day = 0; day < 3; day++) {
        service.tick();
        now += DAY_MS;
      }
    } finally {
      errors.mockRestore();
    }
    return { service, refused, logged: store.log.map((input) => input.command.type) };
  }

  it("isn't switched on without the option, which no adapter passes yet", () => {
    const off = threeDays(false);
    // The newest switch before jobs is on, so the table ran.
    expect(off.logged).toContain("open_levels");
    expect(off.logged).not.toContain("open_jobs");
    expect(off.logged).not.toContain("set_job_edition");
    expect(off.service.state.jobs).toBeUndefined();
    // With the option it's logged once, after levels, which it needs, and never asked for again.
    const on = threeDays(true);
    expect(on.logged.filter((type) => type === "open_jobs")).toHaveLength(1);
    expect(on.logged.indexOf("open_jobs")).toBe(on.logged.indexOf("open_levels") + 1);
    expect(on.service.state.jobs).toMatchObject({ edition: 1 });
    expect(on.refused).toEqual([]);
    // In a world without levels the switch waits, and asks the sim for nothing.
    const early = threeDays(true, false);
    expect(early.logged).not.toContain("open_jobs");
    expect(early.refused).toEqual([]);
    // Turning jobs on is the RFC's last step. Until then neither adapter passes the option, and
    // the Worker has no test route.
    const worker = readFileSync(new URL("../cloudflare/worker.ts", import.meta.url), "utf8");
    const node = readFileSync(new URL("./main.ts", import.meta.url), "utf8");
    for (const adapter of [worker, node]) expect(adapter).not.toMatch(/\bjobs\s*:/);
    expect(worker).not.toMatch(/open-jobs|testOpenJobs|open_jobs/);
  });

  it("reads as it always did: no jobs field, event, notice, line, or link anywhere on the wire", async () => {
    const t = await start();
    // Levels are open, as on terrakin.org. Jobs aren't.
    expect(t.service.testOpenLevels()).toMatchObject({ ok: true });
    const ada = await t.settler("Ada", 0, 0);
    const bob = await t.settler("Bob", 2, 0);
    const heard = t.listen(bob.id);
    const make = await t.bench(ada);
    // A deed that would move a job answers with what it always did.
    expect(types((await make("chair")).events)).toEqual(["inventory", "progress"]);
    expect(jobEvents(heard())).toEqual([]);
    expect(t.service.state.jobs).toBeUndefined();

    // Each read jobs add to, key by key and in order, so a field that leaked in (or moved) fails
    // here by name.
    const world = (await t.call("GET", "/v1/world")).body;
    expect(Object.keys(world)).toEqual([
      "v",
      "seq",
      "hash",
      "time",
      "season",
      "weather",
      "timeOfDay",
      "config",
      "commons",
      "residents",
      "plots",
      "blocks",
      "day",
      "townHall",
      "pickups",
      "levelsOpen",
    ]);
    const profile = (await t.call("GET", `/v1/residents/${ada.id}`, undefined, bob.token)).body;
    expect(Object.keys(profile.resident)).toEqual([
      "id",
      "trust",
      "name",
      "kind",
      "color",
      "shape",
      "note",
      "bio",
      "avatar",
      "online",
      "posts",
      "followers",
      "following",
      "friends",
      "followed",
      "praise",
      "karma",
      "votes",
      "level",
      "collected",
      "home",
      "links",
    ]);
    const checkin = await t.checkin(ada.token);
    expect(Object.keys(checkin)).toEqual([
      "at",
      "since",
      "season",
      "weather",
      "timeOfDay",
      "catalog",
      "notifications",
      "letters",
      "gestures",
      "following",
      "proposals",
      "notices",
      "coins",
      "progress",
      "changelog",
      "devlog",
      "away",
      "events",
      "todo",
      "firstVisit",
      "tryToday",
      "digest",
      "everyHours",
      "links",
    ]);
    const visit = (await t.call("GET", "/v1/first-visit", undefined, ada.token)).body;
    expect(visit.tries.map((s: Json) => s.id)).not.toContain("jobs");
    const notes = await t.notes(ada.token);
    expect(notes).toEqual([]);
    for (const [name, body] of Object.entries({ world, profile, checkin, visit, notes })) {
      const keys = keysIn(body);
      for (const key of ["jobs", "jobsOpen", "job", "board", "held"]) {
        expect(keys.has(key), `${key} in ${name}`).toBe(false);
      }
    }
    expect(JSON.stringify(checkin.todo)).not.toMatch(/\bjobs?\b/i);
    const link = (await t.call("POST", "/v1/link-key", {}, ada.token)).body.key;
    // No link page has a Jobs section or a link to the job page. (The changelog a check-in lists
    // does name jobs: it's the same in every world.)
    for (const page of ["checkin", "me", "world"]) {
      const text = (await t.call("GET", `/v1/act/${link}/${page}`)).text;
      expect(text, page).not.toMatch(/## Jobs|\/jobs\b(?!`)|You hold one of the town's jobs/);
    }

    // Asking for the board is the one new thing, and it says jobs aren't open.
    const jobs = (await t.call("GET", "/v1/jobs", undefined, ada.token)).body;
    expect(jobs).toMatchObject({
      open: false,
      jobs: [],
      you: { held: null, total: 0, canTake: false, unlocked: [] },
    });
    // Nothing takes one, and a job's title and the satchel are nobody's yet: not to show, to wear,
    // to style, or to clear a style from. Each is refused, dry or not, with nothing logged and the
    // world as it was, so the log never holds an input the build before jobs would refuse.
    const logged = t.store.log.length;
    const hash = hashWorld(t.service.state);
    const untouched = (what: string) => {
      expect(t.store.log.length, what).toBe(logged);
      expect(hashWorld(t.service.state), what).toBe(hash);
    };
    for (const [action, code] of [
      [{ type: "take_job", job: "bram_chair" }, "unknown_job"],
      [{ type: "drop_job" }, "no_job"],
      [{ type: "hand_in" }, "no_job"],
      [{ type: "profile", title: "helping_hand" }, "not_earned"],
      [{ type: "profile", wear: ["town_satchel"] }, "not_earned"],
      [{ type: "profile", wearStyle: { town_satchel: { pattern: "stripes" } } }, "not_earned"],
      [{ type: "profile", wearStyle: { town_satchel: null } }, "not_earned"],
    ] as const) {
      for (const dry of [true, false]) {
        const what = `${JSON.stringify(action)}${dry ? " dry" : ""}`;
        const answer = await t.act(ada.token, dry ? { ...action, dry } : action);
        expect(answer.error?.code, what).toBe(code);
        untouched(what);
      }
    }
    // By link too: the job page and each thing it does, a switch that isn't `yes`, and the look
    // link, which is the one link that sets what a resident wears.
    for (const [path, status, words] of [
      ["jobs", 200, "Error code: `unknown_job`"],
      ["jobs?take=bram_chair", 200, "Error code: `unknown_job`"],
      ["jobs?drop=yes", 200, "Error code: `unknown_job`"],
      ["jobs?hand_in=yes", 200, "Error code: `unknown_job`"],
      ["jobs?drop=no", 400, "`drop` must be one of: yes."],
      ["jobs?drop=true", 400, "Error code: `bad_request`"],
      ["look?wear=town_satchel", 200, "Error code: `not_earned`"],
    ] as const) {
      const page = await t.call("GET", `/v1/act/${link}/${path}`);
      expect([page.status, page.text], path).toEqual([status, expect.stringContaining(words)]);
      untouched(path);
    }
    // Nobody arrives wearing it. A join takes no `wearStyle` at all, so one sent with it is
    // dropped before the world sees it: the join that's logged names no garment.
    const wearing = { name: "Cy", kind: "agent", wear: ["town_satchel"] };
    expect((await t.call("POST", "/v1/session", wearing)).body.error.code).toBe("not_earned");
    untouched("a join wearing it");
    const styled = { name: "Dee", kind: "agent", wearStyle: { town_satchel: { pattern: "dots" } } };
    expect((await t.call("POST", "/v1/session", styled)).status).toBe(201);
    expect(t.store.log.slice(logged).map((input) => input.command)).toEqual([
      { type: "join", name: "Dee", kind: "agent" },
    ]);
  });
});

describe("opening jobs", () => {
  it("has a test route that opens them now, only with the test clock and only from this machine", async () => {
    const off = await start();
    const post = (base: string) => fetch(base + TEST_OPEN_JOBS_PATH, { method: "POST" });
    expect((await post(off.base)).status).toBe(404);

    const on = await start({ testClock: true });
    // Jobs pay points, so the sim refuses the switch before levels.
    const early = await post(on.base);
    expect(early.status).toBe(400);
    expect(await early.json()).toMatchObject({ ok: false, error: { code: "not_due" } });
    expect(on.service.testOpenLevels()).toMatchObject({ ok: true });
    expect(await (await post(on.base)).json()).toEqual({ ok: true });
    expect(on.service.state.jobs).toEqual({ opened: on.service.state.day, edition: 1 });
    const again = await post(on.base);
    expect(again.status).toBe(400);
    expect(await again.json()).toMatchObject({ ok: false, error: { code: "already_open" } });
    expect((await on.call("GET", "/v1/world")).body.jobsOpen).toBe(true);

    // A caller on the network gets a 404, test clock or not.
    const far = await start();
    expect(far.service.testOpenLevels()).toMatchObject({ ok: true });
    const server = createApp({
      service: far.service,
      onResponse,
      testClock: { advanceDay: () => far.service.state.day ?? null },
    });
    const answer = await new Promise<{ status: number; body: string }>((done) => {
      let status = 0;
      const req = {
        method: "POST",
        url: TEST_OPEN_JOBS_PATH,
        headers: { host: "localhost" },
        socket: { remoteAddress: "10.0.0.1" },
      };
      const res = {
        headersSent: false,
        writeHead: (code: number) => {
          status = code;
        },
        end: (body: string) => done({ status, body }),
      };
      server.emit("request", req, res);
    });
    expect(answer.status).toBe(404);
    expect(far.service.state.jobs).toBeUndefined();
    // That the Worker has no such route is `town.test.ts`'s, with the other test routes.
  });

  it("opens on the server's own tick once the option is on and levels are open", async () => {
    const before = await start();
    expect(before.service.testOpenLevels()).toMatchObject({ ok: true });
    before.later(DAY_MS);
    expect(before.logged("open_jobs")).toEqual([]);
    const t = await start({ store: before.store, sql: before.sql, jobs: true, at: before.now() });
    expect(t.logged("open_jobs")).toHaveLength(1);
    t.later(DAY_MS);
    expect(t.logged("open_jobs")).toHaveLength(1);
  });
});

describe("the board", () => {
  it("is public: three jobs in the town's words for anyone, and where you stand only with your token", async () => {
    const t = await start();
    const ada = await t.settler("Ada", 0, 0);
    expect(t.open()).toMatchObject({ ok: true });
    const anyone = (await t.call("GET", "/v1/jobs")).body;
    expect(anyone).toMatchObject({ open: true, day: t.service.state.day, you: null });
    expect(anyone.jobs.map((j: Json) => j.id)).toEqual(t.board());
    expect(anyone.jobs).toHaveLength(JOBS.board);
    for (const job of anyone.jobs) {
      expect(job.title).toBe(JOB_WORDS[job.id]);
      expect(job.points).toBe(JOBS.points);
      // No townsfolk lives here, so a job is the town's: a name, and no resident.
      expect(Object.keys(job.from)).toEqual(["handle", "name"]);
      expect(job.shape === "deed" ? job.deed : job.bring).toBeDefined();
    }
    expect(anyone.rules).toEqual({
      board: 3,
      held: 1,
      perDay: 1,
      perWeek: 3,
      points: 10,
      keepDays: 7,
      unlocks: [
        { jobs: 10, title: "helping_hand" },
        { jobs: 25, wear: "town_satchel" },
        { jobs: 75, title: "pillar_of_the_town" },
      ],
    });
    const mine = (await t.call("GET", "/v1/jobs", undefined, ada.token)).body;
    expect(mine.jobs).toEqual(anyone.jobs);
    expect(mine.you).toEqual({
      held: null,
      doneToday: false,
      week: { done: 0, max: 3 },
      total: 0,
      canTake: true,
      unlocked: [],
    });
    // Someone with no hearth is told why they can't take one, in the sim's own words.
    const made = t.service.createSession({ name: "Cy", kind: "agent" });
    const cy = (await t.call("GET", "/v1/jobs", undefined, made.token)).body.you;
    expect(cy).toMatchObject({ canTake: false, why: expect.stringContaining("hearth") });
    // And the board isn't something to suggest to them yet, where it is to Ada.
    const tries = async (token: string | undefined) =>
      (await t.call("GET", "/v1/first-visit", undefined, token)).body.tries.map((s: Json) => s.id);
    expect(await tries(made.token)).not.toContain("jobs");
    expect(await tries(ada.token)).toContain("jobs");
    expect((await t.act(made.token ?? "", { type: "take_job", job: t.board()[0] })).error).toEqual({
      code: "no_hearth",
      message: cy.why,
    });
    // Nor is it suggested to townsfolk, who give the jobs: Ada, hearth and all, once she's one.
    const others = new Set(TRY_NEXT.map((s) => s.id).filter((id) => id !== "jobs"));
    const suggested = () => pickTryNext(t.service.state, ada.id, new Set(), others)?.id ?? null;
    expect(suggested()).toBe("jobs");
    t.service.syncTownsfolk(new Set([ada.id]));
    expect(t.service.state.residents[ada.id]?.hearth).toMatchObject({ x: 3, y: 3 });
    expect(suggested()).toBeNull();
  });

  it("names a giver's resident only while that townsfolk lives here, and shows what a count unlocked", () => {
    // The sim's jobs fixture: Clem is townsfolk there, and Eve has finished ten jobs.
    const state = replay(JOBS_CONFIG, JOBS_LOG);
    const handles: Record<string, string> = { clem: "clem", bram: "bob" };
    const givers = giverIds(state, (handle) => handles[handle]);
    expect(givers("clem")).toBe("clem");
    // Bob holds Bram's handle and isn't townsfolk, and nobody holds Sable's.
    expect(givers("bram")).toBeUndefined();
    expect(givers("sable")).toBeUndefined();
    const view = jobsView(state, "eve", givers);
    expect(view.you).toMatchObject({
      total: 10,
      doneToday: true,
      week: { done: 1, max: 3 },
      canTake: false,
      unlocked: [{ jobs: 10, title: "helping_hand" }],
    });
    // The title she shows is on her profile's level, and her count beside it.
    expect(levelView(state, "eve")?.title).toBe("helping_hand");
    expect(jobsDoneField(state, "eve")).toBe(10);
    expect(jobsDoneField(state, "ada")).toBe(0);
    // Townsfolk give jobs and never take one: no count, no board in a check-in, and no standing.
    expect(jobsDoneField(state, "clem")).toBeUndefined();
    expect(checkinJobs(state, "clem")).toBeUndefined();
    expect(checkinJobs(state, "eve")).toEqual({
      board: jobsOn(state).map((job) => job.id),
      left: 2,
    });
    expect(jobsView(state, "clem", givers).you).toMatchObject({ canTake: false });
    // The tenth job's notice says what it unlocked, and the twenty-fifth's the satchel.
    const done = { job: "clem_jam", skill: "making", points: 10 } as const;
    expect(jobDoneView({ ...done, total: 9 }, givers)?.unlocks).toBeUndefined();
    expect(jobDoneView({ ...done, total: 10 }, givers)).toEqual({
      job: "clem_jam",
      title: "A jar of jam for the cafe",
      from: { handle: "clem", name: "Clem", id: "clem" },
      skill: "making",
      points: 10,
      total: 10,
      unlocks: { title: "helping_hand" },
    });
    expect(jobDoneView({ ...done, total: 25 })?.unlocks).toEqual({ wear: "town_satchel" });
    expect(jobDoneView({ ...done, job: "no_such_job", total: 1 })).toBeUndefined();
  });
});

describe("job events are private", () => {
  it("reach only their resident: never the broadcast, a neighbor's socket, or another resident's answer", async () => {
    const t = await start();
    const ada = await t.settler("Ada", 0, 0);
    const bob = await t.settler("Bob", 2, 0);
    expect(t.open()).toMatchObject({ ok: true });
    t.until("bram_chair");
    const mine = t.listen(ada.id);
    const theirs = t.listen(bob.id);
    const make = await t.bench(ada);
    const taken = await t.act(ada.token, { type: "take_job", job: "bram_chair" });
    expect(taken.events).toEqual([{ type: "job_taken", residentId: ada.id, job: "bram_chair" }]);
    const made = await make("chair");
    expect(jobEvents(made.events)).toEqual(["job_done"]);
    expect(made.events.find((e: Json) => e.type === "job_done")).toEqual({
      type: "job_done",
      residentId: ada.id,
      job: "bram_chair",
      skill: "making",
      points: 10,
      week: 1,
      total: 1,
    });
    // Ada's own socket hears them, and Bob's hears none: a level she reached is all he's told.
    expect(jobEvents(mine())).toEqual(["job_taken", "job_done"]);
    expect(jobEvents(theirs())).toEqual([]);
    expect(types(theirs())).toContain("level_reached");

    // Whoever's input made them: a credit from the town, or a neighbor's action.
    const sim: WorldEvent[] = [
      { type: "job_taken", residentId: ada.id, job: "otis_host" },
      { type: "job_progress", residentId: ada.id, job: "pip_two_games", count: 1, of: 2 },
      {
        type: "job_done",
        residentId: ada.id,
        job: "otis_host",
        skill: "hosting",
        points: 10,
        week: 2,
        total: 2,
      },
      { type: "job_dropped", residentId: ada.id, job: "otis_host", lapsed: true },
      // A merge's count and a change of edition stay on the server.
      { type: "job_total", residentId: ada.id, total: 3 },
      { type: "job_edition_set", edition: 2 },
      { type: "jobs_opened" },
    ];
    const wire = toWire(sim);
    expect(types(wire)).toEqual([
      "job_taken",
      "job_progress",
      "job_done",
      "job_dropped",
      "jobs_opened",
    ]);
    expect(types(publicEvents(wire))).toEqual(["jobs_opened"]);
    expect(types(eventsFor(wire, bob.id))).toEqual(["jobs_opened"]);
    expect(types(eventsFor(wire, ada.id))).toEqual(types(wire));
    // A title from jobs finished goes out like a skill's.
    const title: WorldEvent = { type: "title_changed", residentId: ada.id, title: "helping_hand" };
    expect(publicEvents(toWire([title]))).toEqual([title]);
  });
});

describe("a finished job", () => {
  it("makes one notice from Terrakin and one todo line, counts on the profile, and ends the day's jobs", async () => {
    const t = await start();
    const ada = await t.settler("Ada", 0, 0);
    const bob = await t.settler("Bob", 2, 0);
    expect(t.open()).toMatchObject({ ok: true });
    t.until("bram_chair");
    const profile = async () =>
      (await t.call("GET", `/v1/residents/${ada.id}`, undefined, bob.token)).body.resident;
    expect((await profile()).jobs).toBe(0);
    const make = await t.bench(ada);
    await t.act(ada.token, { type: "take_job", job: "bram_chair" });
    expect((await t.call("GET", "/v1/jobs", undefined, ada.token)).body.you).toMatchObject({
      held: {
        job: "bram_chair",
        // No Bram lives here, so the job is the town's: a name, and no resident.
        from: { handle: "bram", name: "Bram" },
        skill: "making",
        title: "Make a chair",
        shape: "deed",
        deed: { type: "craft", count: 1, recipe: "chair" },
        count: 0,
        of: 1,
        lapsesDay: (t.service.state.day ?? 0) + JOBS.keepDays,
      },
      canTake: false,
      why: expect.stringContaining("drop_job"),
    });
    await make("chair");

    // One notice, from Terrakin, in the job's fixed words. The chair's level-up is its own.
    const notes = (await t.notes(ada.token)).filter((n) => n.type === "job_done");
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({
      actor: TERRAKIN_ACTOR,
      system: true,
      count: 1,
      postId: null,
      excerpt: "",
      job: {
        job: "bram_chair",
        title: "Make a chair",
        from: { handle: "bram", name: "Bram" },
        skill: "making",
        points: 10,
        total: 1,
      },
    });
    const checkin = await t.checkin(ada.token);
    const lines = checkin.todo.filter((line: string) => EVERY_JOB.test(line));
    expect(lines).toEqual([
      "You finished the town's job, make a chair: 10 Making points. Tell your owner.",
    ]);
    // Read, the line is gone: it's news once.
    await t.call("POST", "/v1/notifications/read", { upTo: notes[0]?.id }, ada.token);
    expect((await t.checkin(ada.token)).todo.filter((l: string) => EVERY_JOB.test(l))).toEqual([]);

    // The count is public, on her profile. Bob's own stays at none.
    expect((await profile()).jobs).toBe(1);
    expect((await t.call("GET", `/v1/residents/${bob.id}`)).body.resident.jobs).toBe(0);
    // And the day has one: the refusal says when the next can be taken, as the board's `why` does.
    const you = (await t.call("GET", "/v1/jobs", undefined, ada.token)).body.you;
    expect(you).toMatchObject({ held: null, doneToday: true, week: { done: 1 }, total: 1 });
    expect(you.canTake).toBe(false);
    const refused = await t.act(ada.token, { type: "take_job", job: t.board()[1] });
    expect(refused.error).toEqual({ code: "job_limit", message: you.why });
  });

  it("is handed in for a bring job, with a thing its resident made, and a dry run takes nothing", async () => {
    const t = await start();
    const ada = await t.settler("Ada", 0, 0);
    expect(t.open()).toMatchObject({ ok: true });
    t.until("ansel_bouquet");
    const make = await t.bench(ada);
    await t.act(ada.token, { type: "take_job", job: "ansel_bouquet" });
    // The job she holds says who asked and what it asks, as a job on the board does: a bring job
    // names its recipe and no deed, and its giver's resident once that townsfolk lives here.
    const florist = await t.settler("Ansel", 2, 0);
    const named = await t.call("PUT", "/v1/profile", { handle: "ansel" }, florist.token);
    expect(named.status).toBe(200);
    const heldNow = async () =>
      (await t.call("GET", "/v1/jobs", undefined, ada.token)).body.you.held;
    const asked = (await t.call("GET", "/v1/jobs")).body.jobs.find(
      (job: Json) => job.id === "ansel_bouquet",
    );
    expect(await heldNow()).toEqual({
      job: "ansel_bouquet",
      from: { handle: "ansel", name: "Ansel" },
      skill: "making",
      title: asked.title,
      shape: "bring",
      bring: { recipe: "bouquet", count: 1 },
      count: 0,
      of: 1,
      lapsesDay: (t.service.state.day ?? 0) + JOBS.keepDays,
    });
    t.service.syncTownsfolk(new Set([florist.id]));
    expect((await heldNow()).from).toEqual({ handle: "ansel", name: "Ansel", id: florist.id });
    expect((await t.act(ada.token, { type: "hand_in" })).error.code).toBe("nothing_to_hand_in");
    const made = await make("bouquet");
    const first = made.events.find((e: Json) => e.type === "inventory").gained[0].id;
    const bouquet = (await make("bouquet")).events.find((e: Json) => e.type === "inventory")
      .gained[0].id;
    // Making it isn't handing it in, and a dry run says which one would go and takes nothing: the
    // oldest she made, or the one she names.
    expect(jobEvents(made.events)).toEqual([]);
    const dry = await t.act(ada.token, { type: "hand_in", dry: true });
    expect(dry).toMatchObject({ ok: true, dry: true, handedIn: { item: first, kind: "bouquet" } });
    expect(await t.act(ada.token, { type: "hand_in", item: bouquet, dry: true })).toMatchObject({
      handedIn: { item: bouquet, kind: "bouquet" },
    });
    // The socket's ack names it too.
    const ws = new WebSocket(`${t.base.replace("http", "ws")}/v1/live`);
    cleanups.push(() => ws.close());
    const ack = new Promise<ServerMessage>((resolve) => {
      ws.on("message", (data) => {
        const m = JSON.parse(data.toString()) as ServerMessage;
        if (m.type === "welcome") {
          const action = { type: "hand_in", dry: true };
          ws.send(JSON.stringify({ type: "action", id: "h1", action }));
        }
        if (m.type === "ack" || m.type === "error") resolve(m);
      });
    });
    ws.once("open", () => ws.send(JSON.stringify({ type: "hello", v: 1, token: ada.token })));
    expect(await ack).toMatchObject({
      type: "ack",
      id: "h1",
      dry: true,
      handedIn: { item: first, kind: "bouquet" },
    });
    expect(t.logged("hand_in")).toEqual([]);
    const handed = await t.act(ada.token, { type: "hand_in", item: bouquet });
    expect(handed.handedIn).toEqual({ item: bouquet, kind: "bouquet" });
    expect(types(handed.events).slice(0, 2)).toEqual(["inventory", "job_done"]);
    expect(handed.events[0]).toEqual({
      type: "inventory",
      residentId: ada.id,
      reason: "handed_in",
      lost: [bouquet],
    });
    const things = (await t.call("GET", "/v1/inventory", undefined, ada.token)).body;
    expect(JSON.stringify(things)).not.toContain(`"${bouquet}"`);
    expect(JSON.stringify(things)).toContain(`"${first}"`);
    // No other action's answer carries it.
    expect(await t.act(ada.token, { type: "home", dry: true })).not.toHaveProperty("handedIn");
  });

  it("tells a host who was away when the event's credit finished their job, once", async () => {
    const t = await start();
    const ada = await t.settler("Ada", 0, 0, "human");
    const guests = [
      await t.settler("Bob", 2, 0),
      await t.settler("Cy", 0, 2),
      await t.settler("Dee", 2, 2),
    ];
    const everyone = [ada, ...guests];
    // Settled three days ago and active today, so each may host and count as a guest.
    t.later(3 * DAY_MS);
    for (const r of everyone) await t.act(r.token, { type: "move", dir: "n" });
    expect(t.open()).toMatchObject({ ok: true });
    t.later(DAY_MS);
    t.until("otis_host");
    for (const r of everyone) await t.act(r.token, { type: "move", dir: "s" });
    expect(await t.act(ada.token, { type: "take_job", job: "otis_host" })).toMatchObject({
      ok: true,
    });
    const noon = Math.floor(t.now() / DAY_MS) * DAY_MS + 12 * HOUR;
    const scheduled = await t.act(ada.token, {
      type: "schedule_event",
      kind: "listening",
      title: "Sunday records",
      text: "Bring a song.",
      px: 0,
      py: 0,
      startsAt: new Date(noon).toISOString(),
      minutes: 60,
    });
    expect(scheduled).toMatchObject({ ok: true });
    const id = scheduled.events.find((e: Json) => e.type === "event_scheduled").event;
    const heard = t.listen(ada.id);
    t.later(noon + MINUTE - t.now());
    // Three guests stay the hour. Ada does nothing more, and the idle sweep takes her offline.
    for (let i = 0; i < 12; i++) {
      for (const r of guests) {
        expect(await t.act(r.token, { type: "join_event", event: id })).toMatchObject({ ok: true });
      }
      t.later(5 * MINUTE);
    }
    expect(t.service.state.residents[ada.id]?.online).toBe(false);
    expect(t.logged("credit_event").map((i) => i.command)).toEqual([
      { type: "credit_event", event: id, guests: guests.map((g) => g.id).sort() },
    ]);
    // The credit, an input of the town's, finished her job: her socket alone was sent it.
    expect(jobEvents(heard())).toEqual(["job_done"]);
    const notes = (await t.notes(ada.token)).filter((n) => n.type === "job_done");
    expect(notes).toHaveLength(1);
    expect(notes[0]?.job).toMatchObject({ job: "otis_host", skill: "hosting", total: 1 });
    expect((await t.notes(guests[0]?.token ?? "")).filter((n) => n.type === "job_done")).toEqual(
      [],
    );
    // More sweeps and a new boot write no second one.
    t.later(DAY_MS);
    const again = await start({ store: t.store, sql: t.sql, at: t.now() });
    again.later(MINUTE);
    expect((await again.notes(ada.token)).filter((n) => n.type === "job_done")).toHaveLength(1);
  });

  it("says what the count unlocked, and how to show it, in the line for its notice", () => {
    const notice = (job: JobDoneView): NotificationView => ({
      id: "n_1",
      type: "job_done",
      trust: "untrusted",
      actor: TERRAKIN_ACTOR,
      count: 1,
      postId: null,
      excerpt: "",
      system: true,
      job,
      read: false,
      createdAt: "2026-10-10T12:00:00.000Z",
    });
    const done = jobDoneView({ job: "otis_teach", skill: "hosting", points: 10, total: 10 });
    const satchel = jobDoneView({ job: "clem_jam", skill: "making", points: 10, total: 25 });
    if (!done || !satchel) throw new Error("no view");
    expect(jobTodo([notice(done), notice(satchel)])).toEqual([
      'You finished the town\'s job, teach a neighbor a recipe: 10 Hosting points. Tell your owner. That\'s 10 jobs finished, so you can show the title Helping hand ({"type": "profile", "title": "helping_hand"}): ask if they\'d like you to.',
      'You finished the town\'s job, a jar of jam for the cafe: 10 Making points. Tell your owner. That\'s 25 jobs finished, so you can wear the town satchel ({"type": "profile", "wear": [..., "town_satchel"]}, with the rest of what you wear, since `wear` is your whole outfit): ask if they\'d like you to.',
    ]);
    // No other kind of notice makes a job line.
    expect(jobTodo([{ ...notice(done), type: "level_reached" }])).toEqual([]);
  });
});

describe("the check-in", () => {
  /** Everything a first visit asks, so a check-in can be quiet. */
  async function settledIn(
    t: T,
    r: { id: string; token: string; px: number; py: number },
    follow: string,
  ) {
    const ok = async (method: string, path: string, body?: unknown) =>
      expect((await t.call(method, path, body, r.token)).status).toBeLessThan(300);
    const tile = { x: r.px * 8 + 2, y: r.py * 8 + 2 };
    await ok("POST", "/v1/actions", { type: "name_plot", px: r.px, py: r.py, name: "Ada's Rest" });
    await ok("PUT", "/v1/profile", { handle: "ada", bio: "a gardener" });
    await ok("POST", "/v1/actions", { type: "profile", theme: "meadow" });
    await ok("POST", "/v1/actions", { type: "place", ...tile, block: "planter" });
    await ok("POST", "/v1/actions", { type: "plant", ...tile, seed: "herb" });
    await (await t.bench(r))("chair");
    await ok("POST", "/v1/posts", { text: "Hello" });
    await ok("PUT", `/v1/residents/${follow}/follow`);
  }

  it("carries the board as data, suggests it once, and never writes a line that names a job", async () => {
    const t = await start();
    const ada = await t.settler("Ada", 0, 0);
    const bob = await t.settler("Bob", 2, 0);
    await settledIn(t, ada, bob.id);
    expect(t.open()).toMatchObject({ ok: true });
    const first = await t.checkin(ada.token);
    expect(first.firstVisit).toEqual([]);
    expect(first.jobs).toEqual({ board: t.board(), left: 3 });

    // A check-in a day until nothing is left to suggest. One of them introduces the board, in
    // words that name no job, and no line ever does: the board is data.
    const suggested: string[] = [];
    let quiet = first;
    for (let day = 0; day < 40 && quiet.tryToday !== null; day++) {
      suggested.push(quiet.tryToday);
      expect(quiet.jobs.board).toEqual(t.board());
      expect(quiet.todo.filter((line: string) => EVERY_JOB.test(line))).toEqual([]);
      if (quiet.tryToday === "jobs") {
        expect(quiet.todo.at(-1)).toMatch(/^Something to try today: The town has three small jobs/);
        expect(quiet.todo.at(-1)).toContain("GET /v1/jobs");
      }
      // The day's first check-in is the one that carries its suggestion.
      t.later(DAY_MS);
      quiet = await t.checkin(ada.token);
    }
    expect(quiet.tryToday).toBeNull();
    expect(quiet.todo.filter((line: string) => EVERY_JOB.test(line))).toEqual([]);
    expect(suggested.filter((id) => id === "jobs")).toHaveLength(1);

    // Midnight brings a new board. On its own that's no news: the same digest still answers
    // `unchanged`, with the new board in it.
    const yesterday = t.board();
    t.later(DAY_MS);
    expect(t.board()).not.toEqual(yesterday);
    const seen = `?since=${encodeURIComponent(quiet.at)}&seen=${quiet.digest}`;
    const next = await t.checkin(ada.token, seen);
    expect(next).toMatchObject({ unchanged: true, todo: [], tryToday: null });
    expect(next.jobs).toEqual({ board: t.board(), left: 3 });

    // Holding one shows in `jobs` and still makes no line, and taking it counts as having tried.
    const [job = ""] = t.board();
    await t.act(ada.token, { type: "take_job", job });
    const held = await t.checkin(ada.token, seen);
    expect(held.jobs.held).toMatchObject({ job, count: 0 });
    expect(held.todo.filter((line: string) => EVERY_JOB.test(line))).toEqual([]);
    const tries = (await t.call("GET", "/v1/first-visit", undefined, ada.token)).body.tries;
    expect(tries).toContainEqual({ id: "jobs", done: true });
  });
});

describe("by link", () => {
  it("lists only the jobs a link can finish, takes one, lets it go, and hands a made thing in", async () => {
    const t = await start();
    const ada = await t.settler("Ada", 0, 0);
    expect(t.open()).toMatchObject({ ok: true });
    const key = (await t.call("POST", "/v1/link-key", {}, ada.token)).body.key;
    const page = async (query = "") => (await t.call("GET", `/v1/act/${key}/jobs${query}`)).text;
    // Teaching, hosting, and a game need the API, on every day of the first edition.
    const table = JOB_EDITIONS[1] ?? [];
    expect(table.filter((job) => !linkCanFinish(job)).map((job) => job.skill)).toEqual(
      expect.arrayContaining(["hosting", "playing"]),
    );
    for (const job of table) {
      if (job.skill === "hosting" || job.skill === "playing") {
        expect(linkCanFinish(job), job.id).toBe(false);
      } else expect(linkCanFinish(job), job.id).toBe(true);
    }
    for (let day = 0; day < 4; day++) {
      const text = await page();
      for (const job of jobsOn(t.service.state)) {
        const listed = text.includes(`jobs?take=${job.id}`);
        expect(listed, `${job.id} on day ${day}`).toBe(linkCanFinish(job));
      }
      t.later(DAY_MS);
    }
    // Once jobs are open, every page's Next list has the way in, for a resident with a hearth.
    expect((await t.call("GET", `/v1/act/${key}/me`)).text).toContain(`/v1/act/${key}/jobs`);
    const cy = t.service.createSession({ name: "Cy", kind: "agent" });
    const cyKey = (await t.call("POST", "/v1/link-key", {}, cy.token)).body.key;
    expect((await t.call("GET", `/v1/act/${cyKey}/me`)).text).not.toMatch(/\/jobs\b/);

    t.until("ansel_bouquet");
    const make = await t.bench(ada);
    const taken = await page("?take=ansel_bouquet");
    expect(taken).toContain("You took a job: A bouquet for Ansel.");
    expect(taken).toContain("## The job you hold");
    expect(taken).toContain(`/v1/act/${key}/jobs?hand_in=yes`);
    expect(taken).toContain(`/v1/act/${key}/craft?recipe=bouquet`);
    // While she holds one, no take link is offered, and the link check-in says one line about it.
    expect(taken).not.toContain("jobs?take=");
    const checkin = (await t.call("GET", `/v1/act/${key}/checkin`)).text;
    expect(checkin).toContain(
      "You hold one of the town's jobs: A bouquet for Ansel (0 of 1 done).",
    );

    expect(await page("?drop=yes")).toContain("You let the job go.");
    expect(t.service.state.jobs?.held).toBeUndefined();
    // The take link opened again within two minutes is a repeat, like every link that acts: it
    // takes nothing, and the page says first that it's the earlier answer.
    const again = await page("?take=ansel_bouquet");
    expect(again).toMatch(/^You opened this same link a moment ago, so nothing new happened\./);
    expect(t.service.state.jobs?.held).toBeUndefined();
    t.later(3 * MINUTE);
    await page("?take=ansel_bouquet");
    // With nothing she made, the hand-in is the world's refusal, in the page's own shape.
    t.later(3 * MINUTE);
    expect(await page("?hand_in=yes")).toContain("Error code: `nothing_to_hand_in`");
    await make("bouquet");
    t.later(3 * MINUTE);
    const handed = await page("?hand_in=yes");
    expect(handed).toContain("You handed it in, and the job is done.");
    expect(handed).toContain(
      "You've finished 1 of the 3 jobs that count this week, and 1 job in all.",
    );
    // The link check-in says so once, from Terrakin, and no longer says she holds one.
    const after = (await t.call("GET", `/v1/act/${key}/checkin`)).text;
    expect(after).toContain(
      "You finished the town's job, a bouquet for Ansel: 10 Making points. Tell your owner.",
    );
    expect(after).not.toContain("You hold one of the town's jobs");

    // A count that unlocked something says so here as the JSON check-in does, from the same
    // notice, with what a link can do about it: put the satchel on with the rest of the outfit
    // (less the basket, which shares its slot), and nothing for a title.
    await t.act(ada.token, { type: "profile", wear: ["beret", "basket"] });
    const done = { job: "clem_jam", skill: "making", points: 10 } as const;
    for (const total of [10, 25]) {
      const view = jobDoneView({ ...done, total });
      if (!view) throw new Error("no view");
      t.social.jobDone(ada.id, view);
    }
    t.later(3 * MINUTE);
    const unlocked = (await t.call("GET", `/v1/act/${key}/checkin`)).text;
    expect(unlocked).toContain(
      "10 Making points. Tell your owner. That's 10 jobs finished, so you can show the title Helping hand (showing a title on your profile needs the API or the website): ask if they'd like you to.",
    );
    expect(unlocked).toContain(
      `That's 25 jobs finished, so you can wear the town satchel (with the rest of what you have on: ${t.base}/v1/act/${key}/look?wear=beret,town_satchel): ask if they'd like you to.`,
    );
  });
});
