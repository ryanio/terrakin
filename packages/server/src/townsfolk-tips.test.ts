import { readFileSync } from "node:fs";
import { ECONOMY, purseOf, treasuryOf, type WorldConfig } from "@terrakin/sim";
import { afterEach, describe, expect, it } from "vitest";
import { Api } from "./api";
import { createApp } from "./app";
import { MemoryMediaStore } from "./media";
import { Moderation } from "./moderation";
import { nodeSql } from "./node-sql";
import { SocialService } from "./social-service";
import { MemoryStore } from "./store";
import { jsonCaller, listenOnFreePort, responseChecker } from "./test-support";
import { TIP_NOTES, TIPS } from "./tip-plan";
import { TIPS_CRON, type TipsMode, TownsfolkTips, tipsMode } from "./townsfolk-tips";
import { DAY_MS, WorldService } from "./world-service";

const CONFIG: WorldConfig = {
  width: 40,
  height: 40,
  plotSize: 4,
  maxPlotsPerResident: 1,
  reach: 2,
};
const START = Date.UTC(2026, 9, 5, 9);

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const fn of cleanups.splice(0).reverse()) fn();
});

/**
 * A world with coins open, two townsfolk (Clem and Pip, with their handles), a maintainer (Mo), and
 * real residents who settle on the second day, so the treasury pays them welcome gifts.
 */
function town(mode: TipsMode = "on") {
  let now = START;
  const clock = () => now;
  const store = new MemoryStore();
  /** Set to make the next log writes fail, as a storage hiccup would. */
  const failWrites = { count: 0 };
  const append = store.appendInput.bind(store);
  store.appendInput = (input) => {
    if (failWrites.count > 0) {
      failWrites.count--;
      throw new Error("storage went away");
    }
    append(input);
  };
  // Implicit presence, as both adapters run (decision 0071).
  const options = {
    store,
    config: CONFIG,
    now: clock,
    days: true,
    economy: true,
    presence: true,
  } as const;
  const first = new WorldService(options);
  const join = (world: WorldService, name: string) => {
    const made = world.createResident({ name, kind: "agent" });
    if (!made.ok || !made.residentId) throw new Error(`couldn't join ${name}`);
    return made.residentId;
  };
  const clem = join(first, "Clem");
  const pip = join(first, "Pip");
  const mo = join(first, "Mo");
  const townsfolk = new Set([clem, pip]);
  const maintainers = new Set([mo]);
  // Boot again with the grants, as the server does from its config.
  const world = new WorldService({ ...options, townsfolk, maintainers });
  const moderation = new Moderation({ now: clock });
  const sql = nodeSql();
  cleanups.push(() => sql.close());
  const social = new SocialService({
    sql,
    media: new MemoryMediaStore(),
    now: clock,
    resident: (id) => world.state.residents[id],
    townsfolk,
    maintainers,
    moderation,
  });
  world.blockedEither = (a, b) => social.blockedEither(a, b);
  social.sql.exec(
    "INSERT INTO handles (handle, resident_id, claimed_at, released_at) VALUES ('clem', ?, 0, 0)",
    clem,
  );
  social.sql.exec(
    "INSERT INTO handles (handle, resident_id, claimed_at, released_at) VALUES ('pip', ?, 0, 0)",
    pip,
  );
  const nextDay = () => {
    now += DAY_MS;
    world.tick();
  };
  // Townsfolk budgets come with a new day, and newcomers can't give on their first.
  nextDay();
  const settle = (name: string, px: number) => {
    const id = join(world, name);
    const done = world.act(id, { type: "settle", px, py: 1 });
    if (!done.ok) throw new Error(done.error.message);
    return id;
  };
  const tips = (m: TipsMode = mode) =>
    new TownsfolkTips({ mode: m, world, social, townsfolk, now: clock });
  /** An action as `/v1/actions` does it: `arrive`, then the action. */
  const as = (id: string, action: Parameters<WorldService["act"]>[1]) => {
    world.arrive(id, action.type);
    return world.act(id, action);
  };
  const coins = (id: string) => purseOf(world.state, id)?.balance ?? 0;
  const fromTownsfolk = (id: string) =>
    (purseOf(world.state, id)?.ledger ?? []).filter(
      (l) => l.reason === "gift_in" && l.with !== undefined && townsfolk.has(l.with),
    );
  return {
    world,
    social,
    sql,
    failWrites,
    maintainers,
    as,
    clem,
    pip,
    mo,
    settle,
    tips,
    coins,
    fromTownsfolk,
    nextDay,
    advance: (ms: number) => (now += ms),
  };
}

describe("the tips setting", () => {
  it("runs from a cron the Worker's config really has", () => {
    const config = readFileSync(new URL("../../../wrangler.jsonc", import.meta.url), "utf8");
    const crons = /"crons":\s*\[([^\]]*)\]/.exec(config)?.[1] ?? "";
    expect(crons).toContain(`"${TIPS_CRON}"`);
  });

  it("is off unless it says dry or on", () => {
    expect(tipsMode({})).toBe("off");
    expect(tipsMode({ TERRAKIN_TIPS: " on " })).toBe("on");
    expect(tipsMode({ TERRAKIN_TIPS: "dry" })).toBe("dry");
    expect(tipsMode({ TERRAKIN_TIPS: "1" })).toBe("off");
  });
});

describe("the townsfolk's daily tips", () => {
  it("welcome each newcomer with 10 and tip the day's best post, as the townsfolk", () => {
    const t = town();
    const ash = t.settle("Ash", 1);
    const bo = t.settle("Bo", 5);
    const post = t.social.createPost(ash, { text: "My first hut is up!" });
    if (!post.ok) throw new Error(post.message);
    t.social.setLike(bo, post.value.id, true);
    const before = { ash: t.coins(ash), bo: t.coins(bo) };

    const result = t.tips().run();
    expect(result).toMatchObject({
      welcomed: 2,
      refused: 0,
      welcomeCoins: 2 * TIPS.welcome,
      post: "tipped",
      // Ash already had 10 from townsfolk today, so the tip fills up to their 25.
      postCoins: TIPS.perResident - TIPS.welcome,
      stopped: false,
    });
    expect(t.coins(ash) - before.ash).toBe(TIPS.perResident);
    expect(t.coins(bo) - before.bo).toBe(TIPS.welcome);
    // The notes say which townsfolk gave them, so the ledger shows its own gifts later.
    const notes = new Set<string>(Object.values(TIP_NOTES).flatMap((n) => [n.welcome, n.post]));
    for (const line of [...t.fromTownsfolk(ash), ...t.fromTownsfolk(bo)]) {
      expect(notes.has(line.note ?? "")).toBe(true);
    }
    // The gifts brought the givers back, as any action does; the idle sweep takes them out.
    expect(t.world.state.residents[t.clem]?.online || t.world.state.residents[t.pip]?.online).toBe(
      true,
    );
  });

  it("runs once a day, and remembers who it welcomed and what it tipped", () => {
    const t = town();
    const ash = t.settle("Ash", 1);
    const tips = t.tips();
    expect(tips.run().welcomed).toBe(1);
    expect(tips.run()).toMatchObject({ skipped: "done", welcomed: 0 });
    const given = t.coins(ash);
    // A new day, and a fresh service on the same database, as after a restart.
    t.nextDay();
    expect(t.tips().run()).toMatchObject({ welcomed: 0, skippedNewcomers: 0, post: "none" });
    expect(t.coins(ash)).toBe(given);
    expect(t.tips().state().welcomedThrough).toBeGreaterThan(0);
  });

  it("never welcomes anyone twice when its state is lost: the purse ledgers say who had one", () => {
    const t = town();
    const ash = t.settle("Ash", 1);
    t.tips().run();
    t.sql.exec("DELETE FROM townsfolk_tips");
    t.sql.exec("DELETE FROM townsfolk_tips_runs");
    expect(t.tips().run()).toMatchObject({ welcomed: 0, skippedNewcomers: 1 });
    expect(t.fromTownsfolk(ash)).toHaveLength(1);
  });

  it("logs the sim's refusals by code and moves on, never retrying", () => {
    const t = town();
    // A maintainer settling is welcomed by the treasury, but townsfolk may not give them coins.
    t.as(t.mo, { type: "settle", px: 9, py: 1 });
    const bo = t.settle("Bo", 5);
    // Bo blocked both townsfolk, so neither can give to them.
    t.social.setBlock(bo, t.clem, true);
    t.social.setBlock(bo, t.pip, true);
    const ash = t.settle("Ash", 1);
    const result = t.tips().run();
    expect(result).toMatchObject({ welcomed: 1, refused: 2 });
    expect(result.codes.sort()).toEqual(["forbidden", "invalid_gift"]);
    expect(t.fromTownsfolk(ash)).toHaveLength(1);
    expect(t.fromTownsfolk(bo)).toHaveLength(0);
    // The refused newcomers are done with; tomorrow doesn't try them again.
    t.nextDay();
    expect(t.tips().run().refused).toBe(0);
  });

  it("in a dry run, checks each gift with the sim and gives nothing", () => {
    const t = town("dry");
    t.as(t.mo, { type: "settle", px: 9, py: 1 });
    const ash = t.settle("Ash", 1);
    const before = t.coins(ash);
    t.world.tick();
    const seq = t.world.state.seq;
    const purses = [t.coins(t.clem), t.coins(t.pip)];
    const result = t.tips().run();
    expect(result).toMatchObject({ welcomed: 1, refused: 1, codes: ["invalid_gift"] });
    expect(t.coins(ash)).toBe(before);
    expect([t.coins(t.clem), t.coins(t.pip)]).toEqual(purses);
    // Nothing reached the world's log.
    expect(t.world.state.seq).toBe(seq);
    expect(t.tips().state()).toEqual({ tippedPosts: [] });
    expect(t.tips().lastRun()).toMatchObject({ mode: "dry", result: { welcomed: 1 } });
    // Turning it on the same day still gives: a dry run doesn't use up the day.
    expect(t.tips("on").run().welcomed).toBe(1);
    expect(t.fromTownsfolk(ash)).toHaveLength(1);
  });

  it("does nothing while off, or before coins open", () => {
    const t = town("off");
    t.settle("Ash", 1);
    expect(t.tips().run()).toMatchObject({ skipped: "off" });
    expect(t.tips().lastRun()).toBeNull();

    const closed = new WorldService({ store: new MemoryStore(), config: CONFIG, days: true });
    const sql = nodeSql();
    cleanups.push(() => sql.close());
    const social = new SocialService({
      sql,
      media: new MemoryMediaStore(),
      resident: (id) => closed.state.residents[id],
    });
    const tips = new TownsfolkTips({ mode: "on", world: closed, social, townsfolk: new Set() });
    expect(tips.run()).toMatchObject({ skipped: "closed" });
  });

  it("stops when a gift can't be written, and leaves the newcomer for the next day's run", () => {
    const t = town();
    const ash = t.settle("Ash", 1);
    // The giver's join and the gift both fail to reach the log.
    t.failWrites.count = 5;
    const result = t.tips().run();
    expect(result).toMatchObject({ welcomed: 0, refused: 0, stopped: true });
    expect(t.fromTownsfolk(ash)).toHaveLength(0);
    expect(t.tips().state().welcomedThrough).toBeUndefined();
    t.failWrites.count = 0;
    t.nextDay();
    expect(t.tips().run()).toMatchObject({ welcomed: 1, stopped: false });
    expect(t.fromTownsfolk(ash)).toHaveLength(1);
  });

  it("finds a newcomer whose welcome left the treasury's short history", () => {
    const t = town();
    t.settle("Bo", 5);
    expect(t.tips().run().welcomed).toBe(1);
    const ash = t.settle("Ash", 1);
    // Weeks without a run: the treasury's last 50 lines no longer reach Ash's welcome.
    for (let d = 0; d < 20; d++) t.nextDay();
    const treasury = treasuryOf(t.world.state)?.ledger ?? [];
    expect(treasury.some((l) => l.reason === "welcome" && l.with === ash)).toBe(false);
    expect(t.tips().run()).toMatchObject({ welcomed: 1, gap: false });
    expect(t.fromTownsfolk(ash)).toHaveLength(1);
  });

  it("leaves a suspended townsfolk resident out of the giving", () => {
    const t = town();
    t.settle("Ash", 1);
    t.settle("Bo", 5);
    expect(t.social.safety.suspend("system", t.clem, 3, "Testing.").ok).toBe(true);
    const before = t.coins(t.clem);
    expect(t.tips().run().welcomed).toBe(2);
    expect(t.coins(t.clem)).toBe(before);
  });
});

describe("the sim's caps, through the action path tips use", () => {
  it("refuse a 26th coin to one resident in a day from all townsfolk together", () => {
    const t = town();
    const ash = t.settle("Ash", 1);
    const give = (from: string, amount: number) =>
      t.as(from, { type: "give_coins", to: ash, amount });
    expect(give(t.clem, ECONOMY.townsfolkPerResident).ok).toBe(true);
    const more = give(t.pip, 1);
    expect(more.ok).toBe(false);
    if (!more.ok) expect(more.error.code).toBe("gift_limit");
  });

  it("refuse gifts to townsfolk, to maintainers, and across a block", () => {
    const t = town();
    t.as(t.mo, { type: "settle", px: 9, py: 1 });
    const bo = t.settle("Bo", 5);
    t.social.setBlock(bo, t.clem, true);
    const code = (to: string) => {
      const done = t.as(t.clem, { type: "give_coins", to, amount: 1 });
      return done.ok ? "ok" : done.error.code;
    };
    expect(code(t.pip)).toBe("invalid_gift");
    expect(code(t.mo)).toBe("invalid_gift");
    expect(code(bo)).toBe("forbidden");
  });
});

describe("the tips on the staff overview", () => {
  it("run through Api.runTips once a day and show the last run's counts", async () => {
    const t = town("dry");
    t.settle("Ash", 1);
    const tips = t.tips();
    const api = new Api({ service: t.world, social: t.social, skill: "", openapi: "{}", tips });
    expect(api.runTips()).toMatchObject({ welcomed: 1 });
    expect(api.runTips()).toMatchObject({ skipped: "done" });

    const { problems, onResponse } = responseChecker();
    const serverCleanups: (() => void | Promise<void>)[] = [];
    const server = createApp({
      service: t.world,
      social: t.social,
      media: new MemoryMediaStore(),
      tips,
      sessionsPerMinute: 1000,
      onResponse,
    });
    const call = jsonCaller(await listenOnFreePort(server, serverCleanups));
    try {
      const staff = t.world.createSession({ name: "Staffer", kind: "human" });
      if (!staff.residentId || !staff.token) throw new Error("no staff");
      t.maintainers.add(staff.residentId);
      const overview = await call("GET", "/v1/admin/overview", undefined, staff.token);
      expect(overview.status).toBe(200);
      expect(overview.body.tips).toMatchObject({
        mode: "dry",
        lastRun: { mode: "dry", welcomed: 1, refused: 0, post: "none", stopped: false },
      });
      expect(problems).toEqual([]);
    } finally {
      for (const fn of serverCleanups.reverse()) await fn();
    }
  });
});
