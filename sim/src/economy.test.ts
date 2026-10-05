import { describe, expect, it } from "vitest";
import { apply, prepare } from "./apply";
import { coinsOf, ECONOMY, purseOf, treasuryOf } from "./economy";
import {
  POST_ECONOMY_CONFIG,
  POST_ECONOMY_HASH,
  POST_ECONOMY_LOG,
} from "./fixtures/post-economy-log";
import { PRE_ECONOMY_CONFIG, PRE_ECONOMY_HASH, PRE_ECONOMY_LOG } from "./fixtures/pre-economy-log";
import { PRE_TOWN_CONFIG, PRE_TOWN_HASH, PRE_TOWN_LOG } from "./fixtures/pre-town-log";
import { hashWorld } from "./hash";
import { replay } from "./replay";
import {
  type Command,
  type Input,
  TOWN_ACTOR,
  type WorldConfig,
  type WorldEvent,
  type WorldState,
} from "./types";
import { createWorld } from "./world";

// 3x3 plots of 8 tiles. The Commons is plot (1,1); spawn is (12,12). Settling puts a resident on
// the plot's center, which is where the starter home puts its hearth.
const CONFIG: WorldConfig = {
  width: 24,
  height: 24,
  plotSize: 8,
  maxPlotsPerResident: 1,
  reach: 3,
};
const PLOTS = [
  [0, 0],
  [1, 0],
  [2, 0],
  [0, 1],
  [2, 1],
  [0, 2],
  [1, 2],
  [2, 2],
] as const;
const DAY = 20_000;

/** Every coin is in a purse or the treasury, and every amount is a whole number. */
function expectSupplyHolds(state: WorldState) {
  const econ = state.economy;
  if (!econ) return;
  let held = 0;
  for (const n of Object.values(econ.coins)) {
    expect(Number.isInteger(n) && n > 0).toBe(true);
    held += n;
  }
  expect(Number.isInteger(econ.treasury) && econ.treasury >= 0).toBe(true);
  expect(held + econ.treasury).toBe(econ.minted - econ.burned);
}

/**
 * A world and its log. Every input checks the supply identity afterwards, and every rejection
 * checks that nothing changed.
 */
function world(config = CONFIG) {
  const state = createWorld(config);
  const log: Input[] = [];
  const messages: string[] = [];
  const send = (actor: string, command: Command) => {
    const before = hashWorld(state);
    const result = apply(state, { actor, command });
    if (result.ok) log.push({ actor, command });
    else {
      expect(hashWorld(state)).toBe(before);
      messages.push(result.rejection.message);
    }
    expectSupplyHolds(state);
    return result;
  };
  const ok = (actor: string, command: Command): WorldEvent[] => {
    const result = send(actor, command);
    expect(result, `${actor} ${JSON.stringify(command)}`).toMatchObject({ ok: true });
    return result.ok ? result.events : [];
  };
  const code = (actor: string, command: Command) => {
    const result = send(actor, command);
    return result.ok ? null : result.rejection.code;
  };
  const day = (d: number) => ok(TOWN_ACTOR, { type: "new_day", day: d });
  const open = () => ok(TOWN_ACTOR, { type: "open_economy" });
  const join = (name: string) => ok(name, { type: "join", name, kind: "human" });
  /** Join, settle the nth plot, and build a starter home, which sets a hearth where they stand. */
  const settle = (name: string, n: number) => {
    const [px, py] = PLOTS[n] ?? [0, 0];
    join(name);
    ok(name, { type: "settle", px, py });
    return ok(name, { type: "build_starter_home" });
  };
  /** Step off the hearth (south, inside the hut) and back onto it. */
  const homeAgain = (name: string) => {
    ok(name, { type: "move", dir: "s" });
    return ok(name, { type: "move", dir: "n" });
  };
  const give = (from: string, to: string, amount: number, note?: string) =>
    send(from, { type: "give_coins", to, amount, ...(note === undefined ? {} : { note }) });
  const giveCode = (from: string, to: string, amount: number, note?: string) => {
    const result = give(from, to, amount, note);
    return result.ok ? null : result.rejection.code;
  };
  const coins = (id: string) => coinsOf(state, id);
  const treasury = () => state.economy?.treasury ?? 0;
  return {
    state,
    log,
    messages,
    send,
    ok,
    code,
    day,
    open,
    join,
    settle,
    homeAgain,
    give,
    giveCode,
    coins,
    treasury,
  };
}

/** A world counting days, with the economy open. */
function opened() {
  const w = world();
  w.day(DAY);
  w.open();
  return w;
}

/** Set the treasury for a test, minting or unminting the difference so the supply adds up. */
function setTreasury(state: WorldState, n: number) {
  const econ = state.economy;
  if (!econ) throw new Error("open the economy first");
  econ.minted += n - econ.treasury;
  econ.treasury = n;
}

/**
 * Put coins straight into a purse for a test, minting them so the supply identity still holds.
 * Never part of a replayed log.
 */
function fund(state: WorldState, id: string, n: number) {
  const econ = state.economy;
  if (!econ) throw new Error("open the economy first");
  econ.coins[id] = (econ.coins[id] ?? 0) + n;
  econ.minted += n;
}

const coinEvents = (events: WorldEvent[]) =>
  events.filter((e) => e.type === "coins" || e.type === "treasury");

describe("old logs", () => {
  it("replay to the hashes they had before coins", () => {
    expect(hashWorld(replay(PRE_TOWN_CONFIG, PRE_TOWN_LOG))).toBe(PRE_TOWN_HASH);
    expect(hashWorld(replay(PRE_ECONOMY_CONFIG, PRE_ECONOMY_LOG))).toBe(PRE_ECONOMY_HASH);
  });

  it("leave no coin fields behind, though they count days and come home", () => {
    const state = replay(PRE_ECONOMY_CONFIG, PRE_ECONOMY_LOG);
    expect(state.day).toBeDefined();
    expect(state.economy).toBeUndefined();
    expect(state.ownerPairs).toBeUndefined();
    expect(state.maintainers).toBeUndefined();
  });

  it("with coins replay to the hash pinned when coins landed", () => {
    const state = replay(POST_ECONOMY_CONFIG, POST_ECONOMY_LOG);
    expect(hashWorld(state)).toBe(POST_ECONOMY_HASH);
    expectSupplyHolds(state);
    expect(state.economy).toMatchObject({
      treasury: 6_305,
      minted: 6_450,
      coins: { ada: 1, bob: 40, dee: 104 },
      welcomed: ["ada", "bob", "clem", "cy", "dee"],
      owed: [],
    });
    expect(state.ownerPairDays).toEqual({ ada: { bob: 0 }, cy: { dee: DAY + 6 } });
  });
});

describe("prepare with coins", () => {
  it("changes nothing until commit, for every kind of coin input", () => {
    const w = opened();
    w.join("clem");
    w.ok(TOWN_ACTOR, { type: "set_townsfolk", ids: ["clem"] });
    w.settle("ada", 0);
    w.join("bob");
    const inputs: Input[] = [
      { actor: TOWN_ACTOR, command: { type: "new_day", day: DAY + 1 } },
      { actor: "ada", command: { type: "home" } },
      { actor: "ada", command: { type: "give_coins", to: "bob", amount: 5, note: "hi" } },
      { actor: "bob", command: { type: "settle", px: 1, py: 0 } },
      { actor: TOWN_ACTOR, command: { type: "set_townsfolk", ids: [] } },
    ];
    for (const input of inputs) {
      const before = hashWorld(w.state);
      const prepared = prepare(w.state, input);
      expect(prepared.ok).toBe(true);
      expect(hashWorld(w.state)).toBe(before);
      if (prepared.ok) prepared.commit();
      expect(hashWorld(w.state)).not.toBe(before);
      expectSupplyHolds(w.state);
    }
    const fresh = world();
    fresh.day(DAY);
    const before = hashWorld(fresh.state);
    expect(prepare(fresh.state, { actor: TOWN_ACTOR, command: { type: "open_economy" } }).ok).toBe(
      true,
    );
    expect(hashWorld(fresh.state)).toBe(before);
  });
});

describe("open_economy", () => {
  it("only comes from the server, once, and only once the world counts days", () => {
    const w = world();
    w.join("ada");
    expect(w.code("ada", { type: "open_economy" })).toBe("server_only");
    expect(w.code(TOWN_ACTOR, { type: "open_economy" })).toBe("not_due");
    w.day(DAY);
    expect(w.open()).toEqual([
      { type: "economy_opened", treasury: ECONOMY.treasuryOpening },
      { type: "treasury", amount: ECONOMY.treasuryOpening, balance: 5_000, reason: "opening" },
    ]);
    expect(w.state.economy).toMatchObject({
      treasury: 5_000,
      minted: 5_000,
      burned: 0,
      coins: {},
      treasuryLedger: [{ seq: w.state.seq, day: DAY, amount: 5_000, reason: "opening" }],
    });
    expect(w.code(TOWN_ACTOR, { type: "open_economy" })).toBe("already_open");
  });

  it("counts residents who already have a plot as welcomed", () => {
    const w = world();
    w.day(DAY);
    w.settle("bob", 1);
    w.settle("ada", 0);
    w.join("cy");
    w.open();
    expect(w.state.economy?.welcomed).toEqual(["ada", "bob"]);
  });

  it("is needed before anything else about coins happens", () => {
    const w = world();
    w.day(DAY);
    w.settle("ada", 0);
    w.settle("bob", 1);
    w.homeAgain("ada");
    expect(w.code("ada", { type: "home" })).toBe("already_home");
    expect(w.giveCode("ada", "bob", 1)).toBe("economy_closed");
    w.day(DAY + 1);
    expect(w.state.economy).toBeUndefined();
    expect(purseOf(w.state, "ada")).toBeNull();
    expect(treasuryOf(w.state)).toBeNull();
  });
});

describe("the daily allowance", () => {
  it("pays once a day, for whatever leaves you on your own hearth", () => {
    const w = opened();
    // Building the starter home sets the hearth where Ada stands, so it pays at once.
    const built = w.settle("ada", 0);
    expect(coinEvents(built)).toContainEqual({
      type: "coins",
      residentId: "ada",
      amount: 10,
      balance: 60,
      reason: "allowance",
    });
    expect(w.coins("ada")).toBe(ECONOMY.welcomeGift + ECONOMY.allowance);
    expect(coinEvents(w.homeAgain("ada"))).toEqual([]);
    expect(w.code("ada", { type: "home" })).toBe("already_home");

    w.day(DAY + 1);
    // Walking onto the hearth pays.
    w.ok("ada", { type: "move", dir: "s" });
    expect(coinEvents(w.ok("ada", { type: "move", dir: "n" }))).toEqual([
      { type: "coins", residentId: "ada", amount: 10, balance: 70, reason: "allowance" },
    ]);

    w.day(DAY + 2);
    // So does `home` from anywhere, and `home` while already there when it's due.
    expect(coinEvents(w.ok("ada", { type: "home" }))).toEqual([
      { type: "coins", residentId: "ada", amount: 10, balance: 80, reason: "allowance" },
    ]);
    expect(w.code("ada", { type: "home" })).toBe("already_home");

    w.day(DAY + 3);
    // Any other action taken while standing on the hearth pays too.
    w.ok("ada", { type: "profile", note: "hello" });
    expect(w.coins("ada")).toBe(90);
    expect(purseOf(w.state, "ada")).toMatchObject({ streak: 4, allowanceToday: true });
  });

  it("pays nothing off the hearth, on joining, or before a hearth exists", () => {
    const w = opened();
    w.join("ada");
    w.ok("ada", { type: "settle", px: 0, py: 0 });
    expect(w.coins("ada")).toBe(ECONOMY.welcomeGift);
    expect(w.code("ada", { type: "home" })).toBe("no_hearth");
    w.ok("ada", { type: "move", dir: "s" });
    w.ok("ada", { type: "set_hearth", x: 3, y: 3 });
    expect(w.coins("ada")).toBe(ECONOMY.welcomeGift);
    // Setting the hearth where you stand pays.
    expect(coinEvents(w.ok("ada", { type: "set_hearth", x: 3, y: 4 }))).toHaveLength(1);

    w.ok("ada", { type: "leave" });
    w.day(DAY + 1);
    // Joining brings you back on your hearth, but joining isn't doing anything.
    w.join("ada");
    expect(w.coins("ada")).toBe(ECONOMY.welcomeGift + 10);
    expect(coinEvents(w.ok("ada", { type: "home" }))).toHaveLength(1);
  });

  it("adds the streak bonus from the seventh day in a row, and starts over after a gap", () => {
    const w = opened();
    w.settle("ada", 0);
    const paid: number[] = [];
    for (let d = 1; d <= 9; d++) {
      w.day(DAY + d);
      const before = w.coins("ada");
      w.ok("ada", { type: "home" });
      paid.push(w.coins("ada") - before);
    }
    // Day DAY was the first; DAY + 6 is the seventh in a row.
    expect(paid).toEqual([10, 10, 10, 10, 10, 15, 15, 15, 15]);
    expect(w.state.economy?.allowance.ada).toEqual({ day: DAY + 9, streak: 10 });

    w.day(DAY + 11); // DAY + 10 missed.
    expect(purseOf(w.state, "ada")?.streak).toBe(0);
    const events = coinEvents(w.ok("ada", { type: "home" }));
    expect(events).toEqual([
      {
        type: "coins",
        residentId: "ada",
        amount: 10,
        balance: w.coins("ada"),
        reason: "allowance",
      },
    ]);
    expect(w.state.economy?.allowance.ada).toEqual({ day: DAY + 11, streak: 1 });
  });

  it("is minted, and never paid to townsfolk", () => {
    const w = opened();
    w.join("clem");
    w.ok(TOWN_ACTOR, { type: "set_townsfolk", ids: ["clem"] });
    w.ok("clem", { type: "settle", px: 0, py: 0 });
    expect(coinEvents(w.ok("clem", { type: "build_starter_home" }))).toEqual([]);
    w.day(DAY + 1);
    const budget = w.coins("clem");
    w.homeAgain("clem");
    expect(w.code("clem", { type: "home" })).toBe("already_home");
    expect(w.coins("clem")).toBe(budget);

    w.settle("ada", 1);
    expect(w.state.economy?.minted).toBe(5_000 + 700 + ECONOMY.allowance);
  });
});

describe("the welcome gift", () => {
  it("pays from the treasury for a first plot, once ever", () => {
    const w = opened();
    w.join("ada");
    const events = w.ok("ada", { type: "settle", px: 0, py: 0 });
    expect(coinEvents(events)).toEqual([
      { type: "treasury", amount: -50, balance: 4_950, reason: "welcome", residentId: "ada" },
      { type: "coins", residentId: "ada", amount: 50, balance: 50, reason: "welcome" },
    ]);
    expect(w.state.economy?.welcomed).toEqual(["ada"]);
    expect(w.state.economy?.minted).toBe(5_000);
    w.ok("ada", { type: "release" });
    w.ok("ada", { type: "settle", px: 1, py: 0 });
    expect(w.coins("ada")).toBe(50);
  });

  it("pays for a first plot by claim too", () => {
    const w = opened();
    w.join("ada");
    for (let i = 0; i < 5; i++) w.ok("ada", { type: "move", dir: "w" });
    expect(coinEvents(w.ok("ada", { type: "claim" }))).toHaveLength(2);
    expect(w.coins("ada")).toBe(50);
  });

  it("skips residents who had a plot before coins, even if they settle again", () => {
    const w = world();
    w.day(DAY);
    w.join("ada");
    w.ok("ada", { type: "settle", px: 0, py: 0 });
    w.open();
    w.ok("ada", { type: "release" });
    w.ok("ada", { type: "settle", px: 1, py: 0 });
    expect(w.coins("ada")).toBe(0);
  });

  it("never goes to townsfolk", () => {
    const w = opened();
    w.join("clem");
    w.ok(TOWN_ACTOR, { type: "set_townsfolk", ids: ["clem"] });
    w.ok("clem", { type: "settle", px: 0, py: 0 });
    expect(w.coins("clem")).toBe(0);
    expect(w.state.economy?.welcomed).toEqual([]);
  });

  it("is only paid in full: short newcomers wait in line and new_day pays them in order", () => {
    const w = opened();
    w.join("clem");
    w.ok(TOWN_ACTOR, { type: "set_townsfolk", ids: ["clem"] });
    setTreasury(w.state, 80);
    // Ada is paid in full, leaving 30. Bob can't be, so he waits.
    w.join("ada");
    w.ok("ada", { type: "settle", px: 0, py: 0 });
    expect(w.coins("ada")).toBe(50);
    w.join("bob");
    expect(coinEvents(w.ok("bob", { type: "settle", px: 1, py: 0 }))).toEqual([]);
    // Cy waits behind Bob even though the treasury could now pay one gift: nobody jumps the line.
    setTreasury(w.state, 100);
    w.join("cy");
    expect(coinEvents(w.ok("cy", { type: "settle", px: 2, py: 0 }))).toEqual([]);
    expect(w.state.economy?.owed).toEqual(["bob", "cy"]);
    expect(w.state.economy?.welcomed).toEqual(["ada"]);
    expect(purseOf(w.state, "bob")).toMatchObject({ balance: 0, welcomeOwed: true });
    // Releasing and settling again doesn't queue anyone twice.
    w.ok("cy", { type: "release" });
    w.ok("cy", { type: "settle", px: 2, py: 0 });
    expect(w.state.economy?.owed).toEqual(["bob", "cy"]);

    // Tomorrow's mint (100 + 700) pays both, in order, before Clem's budget.
    const events = coinEvents(w.day(DAY + 1));
    expect(events.map((e) => [e.type, e.reason, "residentId" in e ? e.residentId : ""])).toEqual([
      ["treasury", "mint", ""],
      ["treasury", "welcome", "bob"],
      ["coins", "welcome", "bob"],
      ["treasury", "welcome", "cy"],
      ["coins", "welcome", "cy"],
    ]);
    // Paying them left 700, under the reserve, so no budget for Clem today.
    expect(w.treasury()).toBe(700);
    expect(w.coins("clem")).toBe(0);
    expect([w.coins("bob"), w.coins("cy")]).toEqual([50, 50]);
    expect(w.state.economy?.owed).toEqual([]);
    expect(w.state.economy?.welcomed).toEqual(["ada", "bob", "cy"]);
    expect(purseOf(w.state, "bob")?.welcomeOwed).toBe(false);
  });

  it("pays the line only while each gift can be paid in full, and keeps the rest in order", () => {
    // 5x5 plots, so 16 newcomers fit.
    const w = world({ ...CONFIG, width: 40, height: 40 });
    w.day(DAY);
    w.open();
    setTreasury(w.state, 0);
    const names = Array.from({ length: 16 }, (_, i) => `r_${String(i).padStart(2, "0")}`);
    names.forEach((name, i) => {
      // Plots in reading order, skipping the Commons at (2, 2).
      const n = i < 12 ? i : i + 1;
      w.join(name);
      w.ok(name, { type: "settle", px: n % 5, py: Math.floor(n / 5) });
    });
    expect(w.state.economy?.owed).toEqual(names);
    // The mint of 700 pays 14 gifts of 50. The last two wait for tomorrow, still in order.
    w.day(DAY + 1);
    expect(w.state.economy?.owed).toEqual(names.slice(14));
    expect(w.treasury()).toBe(0);
    expect(names.map((n) => w.coins(n))).toEqual([...Array(14).fill(50), 0, 0]);
    w.day(DAY + 2);
    expect(w.state.economy?.owed).toEqual([]);
    expect(w.treasury()).toBe(600);
  });
});

describe("new_day with coins", () => {
  it("mints into the treasury and hands townsfolk their budgets", () => {
    const w = opened();
    w.join("clem");
    w.join("bram");
    w.ok(TOWN_ACTOR, { type: "set_townsfolk", ids: ["clem", "bram"] });
    const events = w.day(DAY + 1);
    expect(events).toEqual([
      { type: "day_started", day: DAY + 1 },
      { type: "treasury", amount: 700, balance: 5_700, reason: "mint" },
      // One public line for all the budgets: what each townsfolk resident holds is private.
      { type: "treasury", amount: -100, balance: 5_600, reason: "budget" },
      { type: "coins", residentId: "bram", amount: 50, balance: 50, reason: "budget" },
      { type: "coins", residentId: "clem", amount: 50, balance: 50, reason: "budget" },
    ]);
    expect(w.state.economy?.treasuryLedger.at(-1)).toEqual({
      seq: w.state.seq,
      day: DAY + 1,
      amount: -100,
      reason: "budget",
    });
    expect(w.state.economy?.minted).toBe(5_700);
  });

  it("takes back what townsfolk didn't give, as one public line, before the new budgets", () => {
    const w = opened();
    w.join("bram");
    w.join("clem");
    w.settle("ada", 0);
    w.ok(TOWN_ACTOR, { type: "set_townsfolk", ids: ["bram", "clem"] });
    w.day(DAY + 1);
    expect(w.give("clem", "ada", 20).ok).toBe(true);
    const start = 5_000 - 50 + 700 - 100;
    const events = w.day(DAY + 2);
    expect(events.slice(1, 5)).toEqual([
      { type: "coins", residentId: "bram", amount: -50, balance: 0, reason: "budget_return" },
      { type: "coins", residentId: "clem", amount: -30, balance: 0, reason: "budget_return" },
      { type: "treasury", amount: 80, balance: start + 80, reason: "budget_return" },
      { type: "treasury", amount: 700, balance: start + 80 + 700, reason: "mint" },
    ]);
    expect(w.coins("clem")).toBe(50);
  });

  it("returns gifts a townsfolk received too: townsfolk never save", () => {
    const w = opened();
    w.join("clem");
    w.settle("ada", 0);
    w.ok(TOWN_ACTOR, { type: "set_townsfolk", ids: ["clem"] });
    w.day(DAY + 1);
    expect(w.give("ada", "clem", 5).ok).toBe(true);
    expect(w.coins("clem")).toBe(55);
    w.day(DAY + 2);
    expect(w.coins("clem")).toBe(50);
  });

  it("pays budgets only from what the treasury holds above the reserve", () => {
    const w = opened();
    w.join("bram");
    w.join("clem");
    w.ok(TOWN_ACTOR, { type: "set_townsfolk", ids: ["bram", "clem"] });
    const econ = w.state.economy;
    if (!econ) throw new Error("no economy");
    // After tomorrow's mint the treasury holds the reserve plus 30.
    const target = ECONOMY.budgetReserve + 30 - ECONOMY.treasuryMint;
    econ.minted -= econ.treasury - target;
    econ.treasury = target;
    w.day(DAY + 1);
    expect([w.coins("bram"), w.coins("clem")]).toEqual([30, 0]);
    expect(w.treasury()).toBe(ECONOMY.budgetReserve);
  });

  it("resets the daily gift counters", () => {
    const w = opened();
    w.settle("ada", 0);
    w.settle("bob", 1);
    w.day(DAY + 1);
    fund(w.state, "ada", 400);
    expect(w.giveCode("ada", "bob", 200)).toBeNull();
    expect(w.giveCode("ada", "bob", 1)).toBe("gift_limit");
    w.day(DAY + 2);
    expect(w.giveCode("ada", "bob", 200)).toBeNull();
  });

  it("hands back a former townsfolk's coins as soon as they leave the list", () => {
    const w = opened();
    w.join("clem");
    w.ok(TOWN_ACTOR, { type: "set_townsfolk", ids: ["clem"] });
    w.day(DAY + 1);
    const before = w.treasury();
    expect(w.ok(TOWN_ACTOR, { type: "set_townsfolk", ids: [] })).toEqual([
      { type: "townsfolk_set", ids: [] },
      { type: "coins", residentId: "clem", amount: -50, balance: 0, reason: "budget_return" },
      { type: "treasury", amount: 50, balance: before + 50, reason: "budget_return" },
    ]);
  });
});

describe("give_coins", () => {
  /**
   * Ada and Bob settled on DAY. It's now the next day, so both can give, and both have come home
   * for today's allowance: 70 coins each.
   */
  function neighbors() {
    const w = opened();
    w.settle("ada", 0);
    w.settle("bob", 1);
    w.day(DAY + 1);
    w.ok("ada", { type: "home" });
    w.ok("bob", { type: "home" });
    return w;
  }

  it("moves coins between purses, with a private event for each side", () => {
    const w = neighbors();
    const result = w.give("ada", "bob", 15, "for the jam");
    expect(result).toMatchObject({ ok: true });
    expect(result.ok && result.events).toEqual([
      {
        type: "coins",
        residentId: "ada",
        amount: -15,
        balance: 55,
        reason: "gift_out",
        with: "bob",
        note: "for the jam",
      },
      {
        type: "coins",
        residentId: "bob",
        amount: 15,
        balance: 85,
        reason: "gift_in",
        with: "ada",
        note: "for the jam",
      },
    ]);
    expect(w.state.economy?.ledgers.bob?.at(-1)).toEqual({
      seq: w.state.seq,
      day: DAY + 1,
      amount: 15,
      reason: "gift_in",
      with: "ada",
      note: "for the jam",
    });
    expect(purseOf(w.state, "ada")).toMatchObject({ balance: 55, givenToday: 15 });
    expect(purseOf(w.state, "bob")).toMatchObject({ balance: 85, receivedToday: 15 });
    // An empty note is no note.
    const plain = w.give("ada", "bob", 1, "");
    expect(plain.ok && plain.events[0]).toEqual({
      type: "coins",
      residentId: "ada",
      amount: -1,
      balance: 54,
      reason: "gift_out",
      with: "bob",
    });
  });

  it("refuses bad amounts, long notes, yourself, strangers, and overdrafts", () => {
    const w = neighbors();
    for (const amount of [0, -1, 1.5, Number.NaN, Number.MAX_VALUE]) {
      expect(w.giveCode("ada", "bob", amount)).toBe("invalid_amount");
    }
    expect(w.giveCode("ada", "bob", 1, "x".repeat(ECONOMY.noteMax + 1))).toBe("invalid_gift");
    expect(w.giveCode("ada", "bob", 1, "x".repeat(ECONOMY.noteMax))).toBeNull();
    const numberNote = { type: "give_coins", to: "bob", amount: 1, note: 5 } as unknown as Command;
    expect(w.code("ada", numberNote)).toBe("invalid_gift");
    expect(w.giveCode("ada", "ada", 1)).toBe("invalid_gift");
    expect(w.giveCode("ada", "nobody", 1)).toBe("unknown_resident");
    expect(w.giveCode("ada", "bob", w.coins("ada") + 1)).toBe("not_enough_coins");
    expect(w.giveCode("ada", "bob", w.coins("ada"))).toBeNull();
    expect(w.coins("ada")).toBe(0);
    expect(w.state.economy?.coins.ada).toBeUndefined();
    expect(w.giveCode("ada", "bob", 1)).toBe("not_enough_coins");
    expect(w.code("nobody", { type: "give_coins", to: "bob", amount: 1 })).toBe("not_joined");
  });

  it("lets a newcomer receive on their first day but not give until the next", () => {
    const w = neighbors();
    w.join("cy");
    expect(purseOf(w.state, "cy")?.firstDay).toBe(true);
    expect(w.giveCode("ada", "cy", 10)).toBeNull();
    expect(w.giveCode("cy", "ada", 1)).toBe("gift_limit");
    w.day(DAY + 2);
    expect(w.giveCode("cy", "ada", 1)).toBeNull();
    // Residents from before coins opened were never newcomers.
    const old = world();
    old.day(DAY);
    old.settle("ada", 0);
    old.settle("bob", 1);
    old.open();
    fund(old.state, "ada", 5);
    expect(old.giveCode("ada", "bob", 5)).toBeNull();
  });

  it("caps giving at 200 a day: exactly at the cap is fine, one over is not", () => {
    const w = neighbors();
    w.settle("cy", 2);
    w.day(DAY + 2);
    fund(w.state, "ada", 500);
    expect(w.giveCode("ada", "bob", 150)).toBeNull();
    expect(w.giveCode("ada", "cy", 51)).toBe("gift_limit");
    expect(w.giveCode("ada", "cy", 50)).toBeNull();
    expect(w.giveCode("ada", "cy", 1)).toBe("gift_limit");
    expect(w.messages.at(-1)).toContain("0 coins left");
  });

  it("caps receiving at 500 a day: the gift that crosses the cap goes through, then no more", () => {
    const w = neighbors();
    for (const [i, name] of ["cy", "dee", "eve"].entries()) w.settle(name, 2 + i);
    w.day(DAY + 2);
    for (const name of ["ada", "cy", "dee", "eve"]) fund(w.state, name, 300);
    expect(w.giveCode("ada", "bob", 200)).toBeNull();
    expect(w.giveCode("cy", "bob", 200)).toBeNull();
    // At 400, any amount goes through, even one that takes Bob over 500.
    expect(w.giveCode("dee", "bob", 150)).toBeNull();
    expect(purseOf(w.state, "bob")?.receivedToday).toBe(550);
    // Over the cap, every amount is refused alike, so the refusal says nothing about the total.
    expect(w.giveCode("eve", "bob", 1)).toBe("gift_limit");
    expect(w.giveCode("eve", "bob", 200)).toBe("gift_limit");
    expect(w.messages.at(-1)).not.toMatch(/550|50 /);
  });

  it("refuses at exactly 500 received, and not at 499", () => {
    const w = neighbors();
    for (const [i, name] of ["cy", "dee"].entries()) w.settle(name, 2 + i);
    w.day(DAY + 2);
    for (const name of ["ada", "cy", "dee"]) fund(w.state, name, 300);
    expect(w.giveCode("ada", "bob", 200)).toBeNull();
    expect(w.giveCode("cy", "bob", 200)).toBeNull();
    expect(w.giveCode("dee", "bob", 99)).toBeNull();
    expect(w.giveCode("dee", "bob", 1)).toBeNull();
    expect(purseOf(w.state, "bob")?.receivedToday).toBe(500);
    expect(w.giveCode("dee", "bob", 1)).toBe("gift_limit");
  });

  it("lets owner-linked pairs skip both caps, both ways, without using them up", () => {
    const w = neighbors();
    w.settle("cy", 2);
    w.ok(TOWN_ACTOR, { type: "set_owner_pairs", pairs: [["bob", "ada"]] });
    w.day(DAY + 2);
    fund(w.state, "ada", 1_000);
    expect(w.giveCode("ada", "bob", 600)).toBeNull();
    expect(w.giveCode("bob", "ada", 300)).toBeNull();
    expect(purseOf(w.state, "ada")).toMatchObject({ givenToday: 0, receivedToday: 0 });
    expect(w.giveCode("ada", "cy", 200)).toBeNull();
    expect(w.giveCode("ada", "cy", 1)).toBe("gift_limit");
  });

  it("skips the caps only from the day after a pair first appears", () => {
    const w = neighbors();
    w.settle("cy", 2);
    // Coins are open, so even the first list ever sent waits a day: a world with no links when
    // coins opened mustn't let its first new pair skip the caps on the day it links.
    w.ok(TOWN_ACTOR, { type: "set_owner_pairs", pairs: [["bob", "ada"]] });
    expect(w.state.ownerPairDays).toEqual({ ada: { bob: DAY + 1 } });
    fund(w.state, "ada", 2_000);
    expect(w.giveCode("ada", "bob", 300)).toBe("gift_limit");

    // A pair new today is capped like anyone else until tomorrow.
    w.ok(TOWN_ACTOR, {
      type: "set_owner_pairs",
      pairs: [
        ["ada", "bob"],
        ["ada", "cy"],
      ],
    });
    expect(w.state.ownerPairDays).toEqual({ ada: { bob: DAY + 1, cy: DAY + 1 } });
    expect(w.giveCode("ada", "cy", 201)).toBe("gift_limit");
    expect(w.giveCode("ada", "cy", 200)).toBeNull();
    w.day(DAY + 2);
    expect(w.giveCode("ada", "cy", 500)).toBeNull();
    expect(purseOf(w.state, "ada")?.givenToday).toBe(0);

    // Unlinking and linking again starts the wait over.
    w.ok(TOWN_ACTOR, { type: "set_owner_pairs", pairs: [["ada", "bob"]] });
    w.ok(TOWN_ACTOR, {
      type: "set_owner_pairs",
      pairs: [
        ["ada", "bob"],
        ["cy", "ada"],
      ],
    });
    expect(w.state.ownerPairDays).toEqual({ ada: { bob: DAY + 1, cy: DAY + 2 } });
    expect(w.giveCode("ada", "cy", 201)).toBe("gift_limit");
    w.day(DAY + 3);
    expect(w.giveCode("ada", "cy", 201)).toBeNull();

    // An empty list clears the record; a later pair is stamped the day it appears.
    w.ok(TOWN_ACTOR, { type: "set_owner_pairs", pairs: [] });
    expect(w.state.ownerPairs).toBeUndefined();
    expect(w.state.ownerPairDays).toEqual({});
    w.ok(TOWN_ACTOR, { type: "set_owner_pairs", pairs: [["ada", "bob"]] });
    expect(w.state.ownerPairDays).toEqual({ ada: { bob: DAY + 3 } });
  });

  it("counts pairs set before coins open as day 0, so links from before this rule work", () => {
    const w = world();
    w.ok(TOWN_ACTOR, { type: "new_day", day: DAY });
    w.ok(TOWN_ACTOR, { type: "set_owner_pairs", pairs: [["ada", "bob"]] });
    expect(w.state.ownerPairDays).toEqual({ ada: { bob: 0 } });
  });

  it("counts pairs set before the world counts days as day 0", () => {
    const w = world();
    w.ok(TOWN_ACTOR, { type: "set_owner_pairs", pairs: [["ada", "bob"]] });
    w.ok(TOWN_ACTOR, {
      type: "set_owner_pairs",
      pairs: [
        ["ada", "bob"],
        ["ada", "cy"],
      ],
    });
    expect(w.state.ownerPairDays).toEqual({ ada: { bob: 0, cy: 0 } });
  });

  it("holds townsfolk to 25 a resident a day between them, never to townsfolk or maintainers", () => {
    const w = neighbors();
    w.join("bram");
    w.join("clem");
    w.join("mia");
    w.ok(TOWN_ACTOR, { type: "set_townsfolk", ids: ["clem", "bram"] });
    w.ok(TOWN_ACTOR, { type: "set_maintainers", ids: ["mia"] });
    w.day(DAY + 2);
    expect(w.giveCode("clem", "ada", 20)).toBeNull();
    expect(w.giveCode("bram", "ada", 6)).toBe("gift_limit");
    expect(w.giveCode("bram", "ada", 5)).toBeNull();
    expect(w.giveCode("bram", "ada", 1)).toBe("gift_limit");
    expect(w.giveCode("bram", "bob", 25)).toBeNull();
    expect(w.giveCode("clem", "bram", 1)).toBe("invalid_gift");
    expect(w.giveCode("clem", "mia", 1)).toBe("invalid_gift");
    // Residents may still tip townsfolk and maintainers.
    expect(w.giveCode("ada", "clem", 1)).toBeNull();
    expect(w.giveCode("ada", "mia", 1)).toBeNull();
    w.day(DAY + 3);
    expect(w.giveCode("clem", "ada", 25)).toBeNull();
  });
});

describe("coins and the townsfolk list", () => {
  it("pays the allowance after a gift made on the hearth, in that order", () => {
    const w = opened();
    w.settle("ada", 0);
    w.settle("bob", 1);
    w.day(DAY + 1);
    const result = w.give("ada", "bob", 5);
    expect(result.ok && result.events.map((e) => e.type === "coins" && e.reason)).toEqual([
      "gift_out",
      "gift_in",
      "allowance",
    ]);
    expect(w.coins("ada")).toBe(60 - 5 + 10);
  });

  it("sweeps a new townsfolk resident's own coins to the treasury at the next new_day", () => {
    const w = opened();
    w.settle("ada", 0);
    expect(w.coins("ada")).toBe(60);
    w.ok(TOWN_ACTOR, { type: "set_townsfolk", ids: ["ada"] });
    const events = w.day(DAY + 1);
    expect(events).toContainEqual({
      type: "coins",
      residentId: "ada",
      amount: -60,
      balance: 0,
      reason: "budget_return",
    });
    expect(w.coins("ada")).toBe(ECONOMY.townsfolkBudget);
  });
});

describe("set_owner_pairs and set_maintainers", () => {
  it("only come from the server, work before coins open, and store tidy lists", () => {
    const w = world();
    w.join("ada");
    expect(w.code("ada", { type: "set_owner_pairs", pairs: [] })).toBe("server_only");
    expect(w.code("ada", { type: "set_maintainers", ids: [] })).toBe("server_only");
    expect(
      w.ok(TOWN_ACTOR, {
        type: "set_owner_pairs",
        pairs: [
          ["r_b", "r_a"],
          ["r_c", "r_d"],
          ["r_a", "r_b"],
        ],
      }),
    ).toEqual([
      {
        type: "owner_pairs_set",
        pairs: [
          ["r_a", "r_b"],
          ["r_c", "r_d"],
        ],
      },
    ]);
    expect(w.state.ownerPairs).toEqual([
      ["r_a", "r_b"],
      ["r_c", "r_d"],
    ]);
    for (const pairs of [[["r_a", "r_a"]], [["r_a"]], [["r_a", "r_b", "r_c"]], [["r_a", ""]]]) {
      expect(
        w.code(TOWN_ACTOR, { type: "set_owner_pairs", pairs: pairs as [string, string][] }),
      ).toBe("server_only");
    }
    w.ok(TOWN_ACTOR, { type: "set_owner_pairs", pairs: [] });
    expect(w.state.ownerPairs).toBeUndefined();

    expect(w.ok(TOWN_ACTOR, { type: "set_maintainers", ids: ["r_b", "r_a", "r_b"] })).toEqual([
      { type: "maintainers_set", ids: ["r_a", "r_b"] },
    ]);
    expect(w.state.maintainers).toEqual(["r_a", "r_b"]);
    w.ok(TOWN_ACTOR, { type: "set_maintainers", ids: [] });
    expect(w.state.maintainers).toBeUndefined();
    const badIds = { type: "set_maintainers", ids: [1] } as unknown as Command;
    expect(w.code(TOWN_ACTOR, badIds)).toBe("server_only");
    expect(w.state.economy).toBeUndefined();
  });
});

describe("ledgers", () => {
  it("keep the last 50 lines for each resident and for the treasury", () => {
    const w = opened();
    w.settle("ada", 0);
    w.settle("bob", 1);
    w.day(DAY + 1);
    for (let i = 0; i < 60; i++) expect(w.giveCode("ada", "bob", 1)).toBeNull();
    const lines = w.state.economy?.ledgers.ada ?? [];
    expect(lines).toHaveLength(ECONOMY.ledgerMax);
    expect(lines.at(-1)).toMatchObject({ seq: w.state.seq, amount: -1, reason: "gift_out" });
    for (let d = 2; d < 60; d++) w.day(DAY + d);
    const treasury = treasuryOf(w.state);
    expect(treasury?.ledger).toHaveLength(ECONOMY.ledgerMax);
    expect(treasury?.ledger.at(-1)).toMatchObject({ day: DAY + 59, reason: "mint" });
    expect(treasury?.balance).toBe(5_000 - 100 + 59 * 700);
  });
});

describe("a long scripted month", () => {
  /** A tiny seeded PRNG, so the script is the same every run. */
  function lcg(seed: number) {
    let s = seed >>> 0;
    return () => {
      s = (Math.imul(s, 1_664_525) + 1_013_904_223) >>> 0;
      return s / 2 ** 32;
    };
  }

  it("keeps every coin accounted for after every input, and replays to the same hash", () => {
    const w = world({ ...CONFIG, width: 40, height: 40 });
    const random = lcg(7);
    const names = ["ada", "bob", "cy", "dee", "eve", "fay", "gus", "hal"];
    const townsfolk = ["t_bram", "t_clem"];
    w.day(DAY);
    for (const id of townsfolk) w.join(id);
    w.ok(TOWN_ACTOR, { type: "set_townsfolk", ids: townsfolk });
    w.ok(TOWN_ACTOR, { type: "set_maintainers", ids: ["hal"] });
    w.ok(TOWN_ACTOR, { type: "set_owner_pairs", pairs: [["ada", "bob"]] });
    // Two settle before coins open, so they never get a welcome gift.
    w.settle("ada", 0);
    w.settle("bob", 1);
    w.open();
    const plots: [number, number][] = [];
    for (let py = 0; py < 5; py++) {
      for (let px = 0; px < 5; px++) if (px !== 2 || py !== 2) plots.push([px, py]);
    }
    let next = 2;
    const pick = <T>(list: readonly T[]): T => list[Math.floor(random() * list.length)] as T;
    for (let d = 1; d <= 30; d++) {
      w.day(DAY + d);
      // Someone new settles most days, while plots last.
      const arriving = names[next];
      const plot = plots[next];
      if (arriving && plot && random() < 0.7) {
        w.join(arriving);
        w.ok(arriving, { type: "settle", px: plot[0], py: plot[1] });
        w.ok(arriving, { type: "build_starter_home" });
        next++;
      }
      const here = names.slice(0, next);
      for (let i = 0; i < 12; i++) {
        const who = pick(here);
        const roll = random();
        if (roll < 0.3) w.send(who, { type: "home" });
        else if (roll < 0.5)
          w.send(who, { type: "move", dir: pick(["n", "s", "e", "w"] as const) });
        else {
          // Gifts, including ones that should fail: too much, to oneself, to strangers.
          const to = pick([...here, ...townsfolk, "nobody"]);
          const amount = pick([1, 5, 25, 120, 250, 600, 0]);
          w.give(who, to, amount, random() < 0.3 ? "thanks" : undefined);
        }
      }
      for (const from of townsfolk) {
        for (let i = 0; i < 4; i++) w.give(from, pick([...here, ...townsfolk]), pick([5, 10, 20]));
      }
    }
    // Some of every kind of refusal happened along the way, none of them saying "token".
    expect(w.messages.length).toBeGreaterThan(50);
    for (const message of w.messages) expect(message).not.toMatch(/token/i);
    const econ = w.state.economy;
    expect(econ?.minted).toBeGreaterThan(5_000 + 30 * 700);
    expect(Object.keys(econ?.coins ?? {}).length).toBeGreaterThan(4);
    expect(econ?.welcomed).toEqual([...names.slice(0, next)].sort());

    const replayed = replay(w.state.config, w.log);
    expect(hashWorld(replayed)).toBe(hashWorld(w.state));
  });
});
