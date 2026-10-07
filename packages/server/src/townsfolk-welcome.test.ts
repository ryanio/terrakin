import { plotOf, purseOf, type WorldConfig } from "@terrakin/sim";
import { afterEach, describe, expect, it } from "vitest";
import { Api } from "./api";
import { MemoryMediaStore } from "./media";
import { Moderation } from "./moderation";
import { nodeSql } from "./node-sql";
import { SocialService } from "./social-service";
import { MemoryStore } from "./store";
import { TIP_NOTES, TIPS } from "./tip-plan";
import { type TipsMode, TownsfolkTips } from "./townsfolk-tips";
import { TownsfolkWelcome, WELCOME, type WelcomeMode, welcomeMode } from "./townsfolk-welcome";
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
 * A world with coins open and two townsfolk, Clem (living on the west side, plot 1) and Pip (on
 * the east, plot 8), with their handles, run through an `Api` so the welcome is wired as both
 * adapters wire it. Newcomers settle on the second day, so the treasury pays their welcome gift.
 */
function town(mode: WelcomeMode = "on", tipsMode: TipsMode = "on") {
  let now = START;
  const clock = () => now;
  const store = new MemoryStore();
  const options = {
    store,
    config: CONFIG,
    now: clock,
    days: true,
    economy: true,
    presence: true,
  } as const;
  const first = new WorldService(options);
  const join = (world: WorldService, name: string, kind: "human" | "agent" = "agent") => {
    const made = world.createResident({ name, kind });
    if (!made.ok || !made.residentId) throw new Error(`couldn't join ${name}`);
    return made.residentId;
  };
  const clem = join(first, "Clem");
  const pip = join(first, "Pip");
  const townsfolk = new Set([clem, pip]);
  const world = new WorldService({ ...options, townsfolk });
  const sql = nodeSql();
  cleanups.push(() => sql.close());
  const social = new SocialService({
    sql,
    media: new MemoryMediaStore(),
    now: clock,
    resident: (id) => world.state.residents[id],
    townsfolk,
    moderation: new Moderation({ now: clock }),
  });
  for (const [handle, id] of [
    ["clem", clem],
    ["pip", pip],
  ] as const) {
    social.sql.exec(
      "INSERT INTO handles (handle, resident_id, claimed_at, released_at) VALUES (?, ?, 0, 0)",
      handle,
      id,
    );
  }
  const as = (id: string, action: Parameters<WorldService["act"]>[1]) => {
    world.arrive(id, action.type);
    const done = world.act(id, action);
    if (!done.ok) throw new Error(done.error.message);
    return done;
  };
  as(clem, { type: "settle", px: 1, py: 1 });
  as(pip, { type: "settle", px: 8, py: 1 });
  // Townsfolk budgets come with a new day, and the treasury's welcome gifts with coins.
  now += DAY_MS;
  world.tick();
  const tips = new TownsfolkTips({ mode: tipsMode, world, social, townsfolk, now: clock });
  const welcome = new TownsfolkWelcome({ mode, world, social, townsfolk, tips, now: clock });
  const api = new Api({ service: world, social, skill: "", openapi: "{}", tips, welcome });
  const settle = (name: string, px: number, kind: "human" | "agent" = "human") => {
    const id = join(world, name, kind);
    as(id, { type: "settle", px, py: 1 });
    return id;
  };
  const coins = (id: string) => purseOf(world.state, id)?.balance ?? 0;
  const fromTownsfolk = (id: string) =>
    (purseOf(world.state, id)?.ledger ?? []).filter(
      (l) => l.reason === "gift_in" && l.with !== undefined && townsfolk.has(l.with),
    );
  const plotUnder = (id: string) => {
    const r = world.state.residents[id];
    return r ? plotOf(CONFIG, r.x, r.y) : undefined;
  };
  const waves = (to: string) =>
    social.notifications(to, {}).notifications.filter((n) => n.type === "gesture");
  return {
    world,
    store,
    social,
    sql,
    api,
    welcome,
    tips,
    clem,
    pip,
    as,
    settle,
    coins,
    fromTownsfolk,
    plotUnder,
    waves,
    advance: (ms: number) => (now += ms),
  };
}

describe("the welcome setting", () => {
  it("is off unless it says dry or on", () => {
    expect(welcomeMode({})).toBe("off");
    expect(welcomeMode({ TERRAKIN_WELCOME_VISITS: "yes" })).toBe("off");
    expect(welcomeMode({ TERRAKIN_WELCOME_VISITS: " dry " })).toBe("dry");
    expect(welcomeMode({ TERRAKIN_WELCOME_VISITS: "on" })).toBe("on");
  });
});

describe("a welcome visit", () => {
  it("comes minutes after a person's first claim: the nearest townsfolk visits and waves", () => {
    const t = town();
    const ash = t.settle("Ash", 2);
    // Due a couple of minutes after the claim, and the Worker's alarm is set for it.
    expect(t.api.nextWelcomeAt()).toBe(t.welcome.rowFor(ash)?.dueAt);
    t.advance(WELCOME.afterMs - 1);
    expect(t.api.runWelcomes()).toMatchObject({ welcomed: 0 });
    expect(t.waves(ash)).toEqual([]);

    t.advance(1);
    const seq = t.world.state.seq;
    t.api.sweep();
    // Clem lives on plot 1, next door: Clem goes, not Pip, and stands on Ash's plot.
    expect(t.welcome.rowFor(ash)).toMatchObject({ done: true, by: t.clem, outcome: "waved" });
    expect(t.plotUnder(t.clem)).toEqual({ px: 2, py: 1 });
    expect(t.plotUnder(t.pip)).toEqual({ px: 8, py: 1 });
    // The visit is a logged input with the tile the server picked, as any visit is.
    const logged: unknown[] = [];
    t.store.eachInput(seq, (input) => {
      if (input.actor === t.clem && input.command.type === "visit") logged.push(input.command);
    });
    expect(logged).toEqual([
      { type: "visit", px: 2, py: 1, x: expect.any(Number), y: expect.any(Number) },
    ]);
    // Ash gets a notice of the wave, with no note.
    expect(t.waves(ash)).toMatchObject([{ actor: { id: t.clem } }]);
    expect(t.social.together.gestures(ash, {}).gestures).toMatchObject([
      { kind: "wave", note: "" },
    ]);
    expect(t.api.nextWelcomeAt()).toBeUndefined();
  });

  it("gives the welcome tip in the same pass, and the daily run doesn't give it again", () => {
    const t = town();
    const ash = t.settle("Ash", 2);
    const before = t.coins(ash);
    t.advance(WELCOME.afterMs);
    expect(t.api.runWelcomes()).toMatchObject({ welcomed: 1, tipped: 1 });
    expect(t.coins(ash) - before).toBe(TIPS.welcome);
    expect(t.fromTownsfolk(ash)).toMatchObject([
      { amount: TIPS.welcome, with: t.clem, note: TIP_NOTES.clem.welcome },
    ]);

    // The daily run sees Clem's gift in the ledgers and passes Ash over.
    expect(t.tips.run()).toMatchObject({ welcomed: 0, skippedNewcomers: 1 });
    expect(t.coins(ash) - before).toBe(TIPS.welcome);
  });

  it("keeps the daily run from tipping again once the giver's ledger has moved on", () => {
    const t = town();
    const ash = t.settle("Ash", 2);
    t.advance(WELCOME.afterMs);
    expect(t.api.runWelcomes()).toMatchObject({ tipped: 1 });
    const after = t.coins(ash);
    // A purse ledger keeps its newest 50 lines; this stands in for 50 newer ones pushing the
    // visit's gift out of Clem's.
    const ledger = t.world.state.economy?.ledgers[t.clem] ?? [];
    ledger.splice(0, ledger.length, ...ledger.filter((l) => l.with !== ash));
    expect(t.tips.run()).toMatchObject({ welcomed: 0, skippedNewcomers: 1 });
    expect(t.coins(ash)).toBe(after);
    // The record of the visit's tip is what passed Ash over: without it (and the daily state,
    // which the run above moved past Ash), a run would give.
    t.sql.exec("DELETE FROM townsfolk_tips_welcomed");
    t.sql.exec("DELETE FROM townsfolk_tips");
    const check = new TownsfolkTips({
      mode: "dry",
      world: t.world,
      social: t.social,
      townsfolk: new Set([t.clem, t.pip]),
      now: t.world.now,
    });
    expect(check.run()).toMatchObject({ welcomed: 1 });
  });

  it("leaves the tip alone when the daily run gave it first", () => {
    const t = town();
    const ash = t.settle("Ash", 2);
    expect(t.tips.run()).toMatchObject({ welcomed: 1 });
    const after = t.coins(ash);
    t.advance(WELCOME.afterMs);
    expect(t.api.runWelcomes()).toMatchObject({ welcomed: 1, tipped: 0 });
    expect(t.welcome.rowFor(ash)).toMatchObject({ outcome: "waved", tip: "not_due" });
    expect(t.coins(ash)).toBe(after);
    expect(t.fromTownsfolk(ash)).toHaveLength(1);
  });

  it("gives no tip while tips are off, and only checks it while they're dry", () => {
    for (const mode of ["off", "dry"] as const) {
      const t = town("on", mode);
      const ash = t.settle("Ash", 2);
      const before = t.coins(ash);
      t.advance(WELCOME.afterMs);
      // A tip a dry run only checked never reads as given.
      expect(t.api.runWelcomes()).toMatchObject({ welcomed: 1, tipped: 0 });
      expect(t.welcome.rowFor(ash)?.tip).toBe(mode === "off" ? "off" : "checked");
      expect(t.coins(ash)).toBe(before);
    }
  });

  it("finds no budget for the tip when the giver's purse is short, or the day's 25 went", () => {
    const t = town();
    const ash = t.settle("Ash", 2);
    // Clem gives the day's budget away to two other newcomers.
    for (const [name, px] of [
      ["Bo", 3],
      ["Cy", 4],
    ] as const) {
      t.as(t.clem, { type: "give_coins", to: t.settle(name, px), amount: TIPS.perResident });
    }
    expect(t.coins(t.clem)).toBeLessThan(TIPS.welcome);
    const before = t.coins(ash);
    expect(t.tips.welcomeNow(ash, t.clem, false)).toEqual({ kind: "none", why: "no_budget" });
    expect(t.coins(ash)).toBe(before);

    // Pip has room, but Ash already had 25 from the townsfolk today.
    t.as(t.pip, { type: "give_coins", to: ash, amount: TIPS.perResident });
    const full = t.coins(ash);
    const pipCoins = t.coins(t.pip);
    expect(t.tips.welcomeNow(ash, t.pip, false)).toEqual({ kind: "none", why: "no_budget" });
    expect(t.coins(ash)).toBe(full);
    expect(t.coins(t.pip)).toBe(pipCoins);
  });

  it("records nobody, and gives nothing, when every townsfolk and the newcomer block each other", () => {
    const t = town();
    const ash = t.settle("Ash", 2);
    t.social.setBlock(ash, t.clem, true);
    t.social.setBlock(t.pip, ash, true);
    const before = t.coins(ash);
    t.advance(WELCOME.afterMs);
    expect(t.api.runWelcomes()).toMatchObject({ welcomed: 0, dropped: 1, codes: ["nobody"] });
    expect(t.welcome.rowFor(ash)).toMatchObject({ done: true, outcome: "nobody", tip: "" });
    expect(t.coins(ash)).toBe(before);
    expect(t.waves(ash)).toEqual([]);
  });

  it("is only for a first claim ever: someone who had a plot before and settles again gets none", () => {
    const t = town();
    const ash = t.settle("Ash", 2);
    // As for a resident who settled before welcome visits existed: no row.
    t.sql.exec("DELETE FROM townsfolk_welcomes");
    t.as(ash, { type: "release" });
    t.as(ash, { type: "settle", px: 3, py: 1 });
    expect(t.welcome.rowFor(ash)).toBeUndefined();
    expect(t.api.nextWelcomeAt()).toBeUndefined();
  });

  it("comes once per resident, ever", () => {
    const t = town();
    const ash = t.settle("Ash", 2);
    t.advance(WELCOME.afterMs);
    expect(t.api.runWelcomes()).toMatchObject({ welcomed: 1 });
    // Ash lets the plot go and claims another: no second visit.
    t.as(ash, { type: "release" });
    t.as(ash, { type: "settle", px: 3, py: 1 });
    expect(t.welcome.rowFor(ash)).toMatchObject({ done: true, by: t.clem });
    t.advance(WELCOME.afterMs);
    expect(t.api.runWelcomes()).toMatchObject({ welcomed: 0, dropped: 0 });
    expect(t.waves(ash)).toHaveLength(1);
  });

  it("is marked done before it's tried, so a failure partway never brings a second one", () => {
    const t = town();
    const ash = t.settle("Ash", 2);
    t.advance(WELCOME.afterMs);
    const together = t.social.together;
    const send = together.sendGesture.bind(together);
    together.sendGesture = () => {
      throw new Error("gestures went away");
    };
    expect(t.api.runWelcomes()).toMatchObject({ welcomed: 0, dropped: 1, codes: ["error"] });
    together.sendGesture = send;
    t.advance(60_000);
    expect(t.api.runWelcomes()).toMatchObject({ welcomed: 0, dropped: 0 });
    expect(t.welcome.rowFor(ash)).toMatchObject({ done: true, outcome: "error" });
  });

  it("visits at most a few newcomers a run, and the rest on the next", () => {
    const t = town();
    const ids = [2, 3, 4, 6].map((px, i) => t.settle(`New ${i}`, px));
    t.advance(WELCOME.afterMs);
    expect(t.api.runWelcomes()).toMatchObject({ welcomed: WELCOME.perRun });
    // The alarm comes back for the one left, no sooner than a minute on.
    expect(t.api.nextWelcomeAt()).toBe(t.world.now() + WELCOME.wakeGapMs);
    expect(t.api.runWelcomes()).toMatchObject({ welcomed: 1 });
    for (const id of ids) expect(t.waves(id)).toHaveLength(1);
  });

  it("skips a newcomer who is suspended", () => {
    const t = town();
    const ash = t.settle("Ash", 2);
    expect(t.social.safety.suspend("system", ash, 3, "Testing.").ok).toBe(true);
    const where = t.plotUnder(t.clem);
    const before = t.coins(ash);
    t.advance(WELCOME.afterMs);
    expect(t.api.runWelcomes()).toMatchObject({ welcomed: 0, dropped: 1, codes: ["suspended"] });
    expect(t.plotUnder(t.clem)).toEqual(where);
    expect(t.coins(ash)).toBe(before);
    expect(t.waves(ash)).toEqual([]);
  });

  it("drops one that waited too long, as after the server was down", () => {
    const t = town();
    const ash = t.settle("Ash", 2);
    t.advance(WELCOME.staleMs + 1);
    expect(t.api.runWelcomes()).toMatchObject({ welcomed: 0, dropped: 1, codes: ["stale"] });
    expect(t.waves(ash)).toEqual([]);
  });

  it("sends the next nearest townsfolk when the newcomer and the nearest block each other", () => {
    const t = town();
    const ash = t.settle("Ash", 2);
    t.social.setBlock(ash, t.clem, true);
    t.advance(WELCOME.afterMs);
    expect(t.api.runWelcomes()).toMatchObject({ welcomed: 1 });
    expect(t.welcome.rowFor(ash)).toMatchObject({ by: t.pip, outcome: "waved" });
    expect(t.plotUnder(t.pip)).toEqual({ px: 2, py: 1 });
  });

  it("is for people: agents and townsfolk who claim are never queued", () => {
    const t = town();
    const bot = t.settle("Bot", 2, "agent");
    expect(t.welcome.rowFor(bot)).toBeUndefined();
    expect(t.welcome.rowFor(t.clem)).toBeUndefined();
    expect(t.api.nextWelcomeAt()).toBeUndefined();
  });

  it("does nothing while off, and moves and gives nothing while dry", () => {
    const off = town("off");
    const ash = off.settle("Ash", 2);
    expect(off.welcome.rowFor(ash)).toBeUndefined();
    off.advance(WELCOME.afterMs);
    expect(off.api.runWelcomes()).toMatchObject({ skipped: "off" });
    expect(off.api.nextWelcomeAt()).toBeUndefined();

    const dry = town("dry");
    const bo = dry.settle("Bo", 2);
    const before = dry.coins(bo);
    const seq = dry.world.state.seq;
    dry.advance(WELCOME.afterMs);
    expect(dry.api.runWelcomes()).toMatchObject({ welcomed: 1, tipped: 0 });
    expect(dry.welcome.rowFor(bo)).toMatchObject({
      by: dry.clem,
      outcome: "waved",
      tip: "checked",
    });
    expect(dry.world.state.seq).toBe(seq);
    expect(dry.plotUnder(dry.clem)).toEqual({ px: 1, py: 1 });
    expect(dry.coins(bo)).toBe(before);
    expect(dry.waves(bo)).toEqual([]);
  });
});
