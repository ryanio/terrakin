import { chebyshev, DAY_MS, plotOf, purseOf, spawnTile, type WorldConfig } from "@terrakin/sim";
import { afterEach, describe, expect, it } from "vitest";
import { Api } from "./api";
import { MemoryMediaStore } from "./media";
import { Moderation } from "./moderation";
import { nodeSql } from "./node-sql";
import { SocialService } from "./social-service";
import { MemoryStore } from "./store";
import { TIP_NOTES, TIPS } from "./tip-plan";
import { type TipsMode, TownsfolkTips } from "./townsfolk-tips";
import {
  GREET,
  TownsfolkWelcome,
  WELCOME,
  type WelcomeMode,
  welcomeMode,
} from "./townsfolk-welcome";
import { WorldService } from "./world-service";

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
 * A world with coins open and two townsfolk, Clem (living in the north-west, plot (1, 1)) and Pip
 * (in the east, plot (8, 3), a little nearer the Commons), with their handles, run through an
 * `Api` so the welcome is wired as both adapters wire it. Newcomers settle on the second day, so
 * the treasury pays their welcome gift.
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
  as(pip, { type: "settle", px: 8, py: 3 });
  // Townsfolk have homes: a hearth one tile in from their plot's north-west corner.
  as(clem, { type: "set_hearth", x: 5, y: 5 });
  as(pip, { type: "set_hearth", x: 33, y: 13 });
  // Townsfolk budgets come with a new day, and the treasury's welcome gifts with coins.
  now += DAY_MS;
  world.tick();
  const tips = new TownsfolkTips({ mode: tipsMode, world, social, townsfolk, now: clock });
  const welcome = new TownsfolkWelcome({ mode, world, social, townsfolk, tips, now: clock });
  const api = new Api({ service: world, social, skill: "", openapi: "{}", tips, welcome });
  /** A newcomer stepping into the world, in the town square, with their greeting queued. */
  const newcomer = (name: string, kind: "human" | "agent" = "human") => join(world, name, kind);
  /** A newcomer who settles at once. Visits are tested alone, so the join's greeting is left out. */
  const settle = (name: string, px: number, kind: "human" | "agent" = "human") => {
    const id = join(world, name, kind);
    sql.exec("DELETE FROM townsfolk_greetings WHERE resident_id = ?", id);
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
    newcomer,
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
    expect(t.plotUnder(t.pip)).toEqual({ px: 8, py: 3 });
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

describe("a greeting in the town square", () => {
  /** How far apart two residents stand, in tiles. */
  const apart = (t: ReturnType<typeof town>, a: string, b: string) => {
    const ra = t.world.state.residents[a];
    const rb = t.world.state.residents[b];
    if (!ra || !rb) throw new Error("no such resident");
    return chebyshev(ra, rb);
  };

  it("comes a minute after a person first steps in: the townsfolk living nearest the Commons walks over and waves", () => {
    const t = town();
    const ash = t.newcomer("Ash");
    const before = t.coins(ash);
    // The alarm wakes for it a minute on, the soonest a waiting row may set it.
    expect(t.api.nextWelcomeAt()).toBe(t.world.now() + WELCOME.wakeGapMs);
    expect(t.welcome.greetingFor(ash)?.dueAt).toBe(t.world.now() + GREET.afterMs);
    t.advance(GREET.afterMs - 1);
    expect(t.api.runWelcomes()).toMatchObject({ greeted: 0, greetCodes: [] });

    t.advance(1);
    const seq = t.world.state.seq;
    t.api.sweep();
    // Pip lives nearer the Commons than Clem: Pip goes, and stands next to Ash in the square.
    expect(t.welcome.greetingFor(ash)).toMatchObject({ done: true, by: t.pip, outcome: "waved" });
    expect(apart(t, t.pip, ash)).toBe(1);
    expect(t.world.state.residents[t.pip]?.online).toBe(true);
    // The walk is Pip's own logged moves, nothing the sim hasn't seen before.
    const logged = new Set<string>();
    t.store.eachInput(seq, (input) => {
      if (input.actor === t.pip) logged.add(input.command.type);
    });
    expect([...logged]).toEqual(["move"]);
    // Ash gets a wave with no note, and no coins.
    expect(t.waves(ash)).toMatchObject([{ actor: { id: t.pip } }]);
    expect(t.social.together.gestures(ash, {}).gestures).toMatchObject([
      { kind: "wave", note: "" },
    ]);
    expect(t.coins(ash)).toBe(before);
    expect(t.api.nextWelcomeAt()).toBeUndefined();
  });

  it("finds them where they stand in the Commons, and heads home first when that's nearer", () => {
    const t = town();
    // Pip wandered off to the west edge; home is nearer the square than there.
    t.as(t.pip, { type: "visit", px: 1, py: 1 });
    const ash = t.newcomer("Ash");
    const spawn = spawnTile(CONFIG);
    t.as(ash, { type: "move", dir: "se" });
    t.as(ash, { type: "move", dir: "e" });
    t.advance(GREET.afterMs);
    const seq = t.world.state.seq;
    expect(t.api.runWelcomes()).toMatchObject({ greeted: 1 });
    expect(apart(t, t.pip, ash)).toBe(1);
    expect(t.world.state.residents[ash]).toMatchObject({ x: spawn.x + 2, y: spawn.y + 1 });
    const first: string[] = [];
    t.store.eachInput(seq, (input) => {
      if (input.actor === t.pip) first.push(input.command.type);
    });
    expect(first[0]).toBe("home");
  });

  it("sends nobody when the newcomer already left the Commons, as an invite settles them at once", () => {
    const t = town();
    const ash = t.newcomer("Ash");
    t.as(ash, { type: "settle", px: 2, py: 1 });
    const seq = t.world.state.seq;
    t.advance(GREET.afterMs);
    expect(t.api.runWelcomes()).toMatchObject({ greeted: 0, greetCodes: ["away"] });
    expect(t.world.state.seq).toBe(seq);
    expect(t.waves(ash)).toEqual([]);
  });

  it("plans the walk before it moves anyone: a townsfolk whose home is walled in isn't sent there, and the next one goes", () => {
    const t = town();
    // Pip is at home: wall the hearth in on every side.
    expect(t.world.state.residents[t.pip]).toMatchObject({ x: 33, y: 13 });
    for (const [dx, dy] of [
      [-1, -1],
      [0, -1],
      [1, -1],
      [-1, 0],
      [1, 0],
      [-1, 1],
      [0, 1],
      [1, 1],
    ] as const) {
      t.as(t.pip, { type: "place", x: 33 + dx, y: 13 + dy, block: "stone" });
    }
    // Then wanders off, so the walk would start by going home.
    t.as(t.pip, { type: "visit", px: 1, py: 1 });
    const ash = t.newcomer("Ash");
    const seq = t.world.state.seq;
    t.advance(GREET.afterMs);
    expect(t.api.runWelcomes()).toMatchObject({ greeted: 1 });
    expect(t.welcome.greetingFor(ash)).toMatchObject({ by: t.clem, outcome: "waved" });
    const fromPip: string[] = [];
    t.store.eachInput(seq, (input) => {
      if (input.actor === t.pip) fromPip.push(input.command.type);
    });
    expect(fromPip).toEqual([]);
    expect(apart(t, t.clem, ash)).toBe(1);
  });

  it("comes once per resident, ever: coming back, or claiming a plot, brings no second one", () => {
    const t = town();
    const ash = t.newcomer("Ash");
    t.advance(GREET.afterMs);
    expect(t.api.runWelcomes()).toMatchObject({ greeted: 1 });
    t.world.leave(ash);
    expect(t.world.ensureOnline(ash).ok).toBe(true);
    t.as(ash, { type: "settle", px: 2, py: 1 });
    t.advance(WELCOME.afterMs);
    // The claim brings its visit; the greeting stays done.
    expect(t.api.runWelcomes()).toMatchObject({ greeted: 0, greetCodes: [], welcomed: 1 });
    expect(t.welcome.greetingFor(ash)).toMatchObject({ done: true, by: t.pip });
  });

  it("leaves the welcome visit to someone else, so the door brings a second face", () => {
    const t = town();
    const ash = t.newcomer("Ash");
    t.advance(GREET.afterMs);
    expect(t.api.runWelcomes()).toMatchObject({ greeted: 1 });
    // Pip lives next door to this plot, but Pip greeted Ash a minute ago: Clem visits instead.
    t.as(ash, { type: "settle", px: 7, py: 3 });
    t.advance(WELCOME.afterMs);
    expect(t.api.runWelcomes()).toMatchObject({ welcomed: 1, codes: [] });
    expect(t.welcome.rowFor(ash)).toMatchObject({ by: t.clem, outcome: "waved" });
    expect(t.waves(ash)).toHaveLength(2);
  });

  it("is for people: an agent stepping in, or townsfolk, are never queued", () => {
    const t = town();
    const bot = t.newcomer("Bot", "agent");
    expect(t.welcome.greetingFor(bot)).toBeUndefined();
    expect(t.welcome.greetingFor(t.pip)).toBeUndefined();
    expect(t.api.nextWelcomeAt()).toBeUndefined();
  });

  it("skips a newcomer who is suspended", () => {
    const t = town();
    const ash = t.newcomer("Ash");
    expect(t.social.safety.suspend("system", ash, 3, "Testing.").ok).toBe(true);
    const seq = t.world.state.seq;
    t.advance(GREET.afterMs);
    expect(t.api.runWelcomes()).toMatchObject({ greeted: 0, greetCodes: ["suspended"] });
    expect(t.world.state.seq).toBe(seq);
    expect(t.waves(ash)).toEqual([]);
  });

  it("skips a newcomer who already left", () => {
    const t = town();
    const ash = t.newcomer("Ash");
    t.world.leave(ash);
    t.advance(GREET.afterMs);
    expect(t.api.runWelcomes()).toMatchObject({ greeted: 0, greetCodes: ["gone"] });
    expect(t.welcome.greetingFor(ash)).toMatchObject({ done: true, outcome: "gone" });
  });

  it("drops one that waited too long, as after the server was down", () => {
    const t = town();
    const ash = t.newcomer("Ash");
    const seq = t.world.state.seq;
    t.advance(GREET.staleMs + 1);
    expect(t.api.runWelcomes()).toMatchObject({ greeted: 0, greetCodes: ["stale"] });
    expect(t.world.state.seq).toBe(seq);
    expect(t.waves(ash)).toEqual([]);
  });

  it("sends the next nearest townsfolk past one who is suspended or blocked either way, and nobody past all", () => {
    const blocked = town();
    const ash = blocked.newcomer("Ash");
    blocked.social.setBlock(blocked.pip, ash, true);
    blocked.advance(GREET.afterMs);
    expect(blocked.api.runWelcomes()).toMatchObject({ greeted: 1 });
    expect(blocked.welcome.greetingFor(ash)).toMatchObject({ by: blocked.clem, outcome: "waved" });

    const suspended = town();
    const bo = suspended.newcomer("Bo");
    expect(suspended.social.safety.suspend("system", suspended.pip, 3, "Testing.").ok).toBe(true);
    suspended.advance(GREET.afterMs);
    expect(suspended.api.runWelcomes()).toMatchObject({ greeted: 1 });
    expect(suspended.welcome.greetingFor(bo)).toMatchObject({ by: suspended.clem });

    const nobody = town();
    const cy = nobody.newcomer("Cy");
    nobody.social.setBlock(cy, nobody.pip, true);
    nobody.social.setBlock(nobody.clem, cy, true);
    const seq = nobody.world.state.seq;
    nobody.advance(GREET.afterMs);
    expect(nobody.api.runWelcomes()).toMatchObject({ greeted: 0, greetCodes: ["nobody"] });
    expect(nobody.world.state.seq).toBe(seq);
    expect(nobody.waves(cy)).toEqual([]);
  });

  it("is marked done before it's tried, so a failure partway never brings a second one", () => {
    const t = town();
    const ash = t.newcomer("Ash");
    t.advance(GREET.afterMs);
    const together = t.social.together;
    const send = together.sendGesture.bind(together);
    together.sendGesture = () => {
      throw new Error("gestures went away");
    };
    expect(t.api.runWelcomes()).toMatchObject({ greeted: 0, greetCodes: ["error"] });
    together.sendGesture = send;
    t.advance(60_000);
    expect(t.api.runWelcomes()).toMatchObject({ greeted: 0, greetCodes: [] });
    expect(t.welcome.greetingFor(ash)).toMatchObject({ done: true, outcome: "error" });
  });

  it("greets at most a few newcomers a run, and the rest on the next", () => {
    const t = town();
    const ids = ["Ash", "Bo", "Cy", "Dee"].map((name) => t.newcomer(name));
    t.advance(GREET.afterMs);
    expect(t.api.runWelcomes()).toMatchObject({ greeted: GREET.perRun });
    expect(t.api.nextWelcomeAt()).toBe(t.world.now() + WELCOME.wakeGapMs);
    expect(t.api.runWelcomes()).toMatchObject({ greeted: 1 });
    for (const id of ids) expect(t.waves(id)).toHaveLength(1);
  });

  it("does nothing while off, and moves and sends nothing while dry", () => {
    const off = town("off");
    const ash = off.newcomer("Ash");
    expect(off.welcome.greetingFor(ash)).toBeUndefined();
    off.advance(GREET.afterMs);
    expect(off.api.runWelcomes()).toMatchObject({ skipped: "off" });
    expect(off.api.nextWelcomeAt()).toBeUndefined();

    const dry = town("dry");
    const bo = dry.newcomer("Bo");
    const seq = dry.world.state.seq;
    const where = dry.plotUnder(dry.pip);
    dry.advance(GREET.afterMs);
    expect(dry.api.runWelcomes()).toMatchObject({ greeted: 1 });
    expect(dry.welcome.greetingFor(bo)).toMatchObject({ by: dry.pip, outcome: "waved" });
    expect(dry.world.state.seq).toBe(seq);
    expect(dry.plotUnder(dry.pip)).toEqual(where);
    expect(dry.waves(bo)).toEqual([]);

    // Out far from home, the greeter is planned from its hearth, as the real walk would go.
    const away = town("dry");
    away.as(away.pip, { type: "visit", px: 1, py: 1 });
    const cy = away.newcomer("Cy");
    const at = away.world.state.seq;
    away.advance(GREET.afterMs);
    expect(away.api.runWelcomes()).toMatchObject({ greeted: 1 });
    expect(away.welcome.greetingFor(cy)).toMatchObject({ by: away.pip, outcome: "waved" });
    expect(away.world.state.seq).toBe(at);
  });
});
