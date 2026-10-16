import { describe, expect, it } from "vitest";
import { apply } from "./apply";
import { AWARDS } from "./awards";
import { ECONOMY } from "./economy";
import { AWARDS_CONFIG, AWARDS_HASH, AWARDS_LOG } from "./fixtures/awards-log";
import { hashWorld } from "./hash";
import { replay } from "./replay";
import { expectSupplyHolds } from "./test-support";
import { TOWN_LIMITS } from "./town";
import { type Command, type Input, TOWN_ACTOR, type WorldConfig, type WorldEvent } from "./types";
import { createWorld } from "./world";

// 3x3 plots of 8 tiles; the Commons is plot (1,1).
const CONFIG: WorldConfig = {
  width: 24,
  height: 24,
  plotSize: 8,
  maxPlotsPerResident: 1,
  reach: 3,
};
const PLOTS = [
  [0, 0],
  [2, 0],
  [0, 2],
  [2, 2],
] as const;
const DAY = 20_000;

/** The opaque staff id the server sends with a staff input. Never a resident id. */
const STAFF = "staff_4f2a9c1e8b7d3056";

/**
 * A world with coins open and Ada, Bob and Cy settled long enough to take part in the Town Hall.
 * Pip is townsfolk. Every input checks the supply identity, and every rejection that the world is
 * byte-identical afterwards.
 */
function awards() {
  const state = createWorld(CONFIG);
  const log: Input[] = [];
  const send = (actor: string, command: Command) => {
    const before = hashWorld(state);
    const result = apply(state, { actor, command });
    if (result.ok) log.push({ actor, command });
    else expect(hashWorld(state)).toBe(before);
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
  const town = (command: Command) => ok(TOWN_ACTOR, command);
  const settle = (name: string, n: number) => {
    const [px, py] = PLOTS[n] ?? [0, 0];
    ok(name, { type: "join", name, kind: "human" });
    ok(name, { type: "settle", px, py });
    ok(name, { type: "build_starter_home" });
  };
  town({ type: "new_day", day: DAY });
  town({ type: "open_economy" });
  for (const [i, name] of ["ada", "bob", "cy"].entries()) settle(name, i);
  ok("pip", { type: "join", name: "pip", kind: "agent" });
  town({ type: "set_townsfolk", ids: ["pip"] });
  town({ type: "new_day", day: DAY + TOWN_LIMITS.eligibleAfterDays });
  for (const name of ["ada", "bob", "cy"]) ok(name, { type: "home" });
  const coins = (id: string) => state.economy?.coins[id] ?? 0;
  const treasury = () => state.economy?.treasury ?? 0;
  // `resident` is the maintainer's own, always sent. Cy by default: outside everyone's household.
  const award = (to: string, n: number, resident = "cy", by = STAFF): Command => ({
    type: "award_grant",
    to,
    coins: n,
    by,
    resident,
  });
  return { state, log, send, ok, code, town, settle, coins, treasury, award };
}

describe("old logs", () => {
  // `replay.test.ts` walks every fixture and checks a snapshot plus the rest of the log replays
  // the same, so adding the file is what covers `state.awards` against that invariant. This pins
  // the hash, so changing AWARDS, the window, or the pruning fails here rather than silently.
  it("replays a log with awards to the pinned hash, pruned to the window", () => {
    const state = replay(AWARDS_CONFIG, AWARDS_LOG);
    expectSupplyHolds(state);
    // Only the last award is still inside the window; the two before it were pruned.
    expect(state.awards).toEqual([{ seq: 61, day: 20_038, to: "ada", coins: 200, by: STAFF }]);
    // The household award's mark is on the treasury's line, which outlives the event.
    const ledger = state.economy?.treasuryLedger ?? [];
    expect(ledger.filter((l) => l.reason === "award" && l.household === true)).toHaveLength(1);
    expect(hashWorld(state)).toBe(AWARDS_HASH);
  });
});

describe("award_grant", () => {
  it("pays from the treasury into a purse, minting nothing", () => {
    const w = awards();
    const before = { purse: w.coins("ada"), treasury: w.treasury() };
    const minted = w.state.economy?.minted ?? 0;
    const events = w.ok(TOWN_ACTOR, w.award("ada", 200));
    expect(w.coins("ada")).toBe(before.purse + 200);
    expect(w.treasury()).toBe(before.treasury - 200);
    expect(w.state.economy?.minted).toBe(minted);
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "treasury", amount: -200, reason: "award" }),
        expect.objectContaining({
          type: "coins",
          residentId: "ada",
          amount: 200,
          reason: "award",
        }),
        expect.objectContaining({ type: "award_paid", to: "ada", amount: 200 }),
      ]),
    );
  });

  it("is the server's alone", () => {
    const w = awards();
    expect(w.code("ada", w.award("bob", 10))).toBe("server_only");
  });

  it("needs a staff id to log who awarded it", () => {
    const w = awards();
    expect(w.code(TOWN_ACTOR, w.award("ada", 10, "cy", ""))).toBe("server_only");
  });

  it("refuses a resident nobody knows", () => {
    const w = awards();
    expect(w.code(TOWN_ACTOR, w.award("nobody", 10))).toBe("unknown_resident");
  });

  it("refuses townsfolk, whose coins are the town's", () => {
    const w = awards();
    expect(w.code(TOWN_ACTOR, w.award("pip", 10))).toBe("not_eligible");
  });

  it("refuses a resident too new to take part in the Town Hall", () => {
    const w = awards();
    w.settle("newbie", 3);
    expect(w.code(TOWN_ACTOR, w.award("newbie", 10))).toBe("not_eligible");
  });

  it("refuses an amount that isn't whole coins, or is none", () => {
    const w = awards();
    expect(w.code(TOWN_ACTOR, w.award("ada", 0))).toBe("invalid_amount");
    expect(w.code(TOWN_ACTOR, w.award("ada", -5))).toBe("invalid_amount");
    expect(w.code(TOWN_ACTOR, w.award("ada", 1.5))).toBe("invalid_amount");
  });
});

describe("the guards", () => {
  // Each of these must go red if its guard is deleted. They are the whole of what stands in for a
  // second maintainer (RFC 0036), so they are tested at the boundary, one coin either side.
  it("caps one award at AWARDS.max, and takes exactly that", () => {
    const w = awards();
    expect(w.code(TOWN_ACTOR, w.award("ada", AWARDS.max + 1))).toBe("invalid_amount");
    const before = w.coins("ada");
    w.ok(TOWN_ACTOR, w.award("ada", AWARDS.max));
    expect(w.coins("ada")).toBe(before + AWARDS.max);
  });

  it("caps every award together at AWARDS.perMonth inside the window", () => {
    const w = awards();
    const each = AWARDS.max;
    const rounds = AWARDS.perMonth / each;
    for (let i = 0; i < rounds; i += 1) w.ok(TOWN_ACTOR, w.award("ada", each));
    // One more coin is over the cap, however small.
    expect(w.code(TOWN_ACTOR, w.award("bob", 1))).toBe("gift_limit");
  });

  it("lets the window roll, so an old award stops counting", () => {
    const w = awards();
    for (let i = 0; i < AWARDS.perMonth / AWARDS.max; i += 1) {
      w.ok(TOWN_ACTOR, w.award("ada", AWARDS.max));
    }
    expect(w.code(TOWN_ACTOR, w.award("bob", 1))).toBe("gift_limit");
    w.town({ type: "new_day", day: DAY + TOWN_LIMITS.eligibleAfterDays + AWARDS.windowDays });
    w.ok("bob", { type: "home" });
    // The window has rolled past every one of them, so a full award goes again.
    w.ok(TOWN_ACTOR, w.award("bob", AWARDS.max));
  });

  it("keeps the treasury's reserve for welcome gifts", () => {
    const w = awards();
    const econ = w.state.economy;
    if (!econ) throw new Error("economy");
    // Leave the treasury holding the reserve and one coin above it.
    const spare = econ.treasury - ECONOMY.budgetReserve;
    econ.treasury -= spare - 1;
    econ.burned += spare - 1;
    expect(w.code(TOWN_ACTOR, w.award("ada", 2))).toBe("not_enough_coins");
    w.ok(TOWN_ACTOR, w.award("ada", 1));
    expect(econ.treasury).toBe(ECONOMY.budgetReserve);
    // Nothing is left to spare, so the next award of any size is refused.
    expect(w.code(TOWN_ACTOR, w.award("ada", 1))).toBe("not_enough_coins");
  });
});

describe("awards inside the awarding maintainer's household", () => {
  // RFC 0036 allows these and marks them, rather than refusing them as decision 0062 does for a
  // vote-passed grant. The mark is the only disclosure, so these pin it.
  it("are allowed, and marked on the event and in state", () => {
    const w = awards();
    // Felipe needs a plot old enough and a hearth to be eligible, like anyone.
    w.settle("felipe", 3);
    w.town({ type: "add_owner_pair", pair: ["ada", "felipe"] });
    w.town({ type: "new_day", day: DAY + TOWN_LIMITS.eligibleAfterDays * 2 });
    w.ok("felipe", { type: "home" });
    w.ok("ada", { type: "home" });
    const events = w.ok(TOWN_ACTOR, w.award("felipe", 200, "ada"));
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "award_paid", to: "felipe", household: true }),
      ]),
    );
    expect(w.state.awards?.at(-1)).toMatchObject({ to: "felipe", coins: 200, household: true });
  });

  it("are marked for the maintainer's own resident too", () => {
    const w = awards();
    const events = w.ok(TOWN_ACTOR, w.award("ada", 10, "ada"));
    expect(events).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: "award_paid", household: true })]),
    );
  });

  // The mark is the only disclosure, so an award the sim can't place in a household is refused
  // rather than paid unmarked. That makes mapping every maintainer's email a requirement.
  it("are refused outright when the server doesn't know the maintainer's resident", () => {
    const w = awards();
    // `resident` is required in the command type, so only a malformed logged input arrives without
    // it. The runtime check has to stand on its own, which is what the cast tests.
    expect(
      w.code(TOWN_ACTOR, { type: "award_grant", to: "ada", coins: 10, by: STAFF } as Command),
    ).toBe("server_only");
    expect(w.code(TOWN_ACTOR, w.award("ada", 10, "nobody"))).toBe("server_only");
    expect(w.state.awards).toBeUndefined();
  });

  it("are not marked for someone outside the household", () => {
    const w = awards();
    const events = w.ok(TOWN_ACTOR, w.award("bob", 10, "ada"));
    const paid = events.find((e) => e.type === "award_paid");
    expect(paid).not.toHaveProperty("household");
  });
});

describe("state", () => {
  it("is absent until the first award, so older logs hash as they did", () => {
    const w = awards();
    expect(w.state.awards).toBeUndefined();
    w.ok(TOWN_ACTOR, w.award("ada", 10));
    expect(w.state.awards).toHaveLength(1);
  });

  it("never names a resident as the awarder, only the opaque staff id", () => {
    const w = awards();
    w.ok(TOWN_ACTOR, w.award("ada", 10, "bob"));
    expect(w.state.awards?.at(-1)?.by).toBe(STAFF);
    expect(JSON.stringify(w.state.awards)).not.toContain("bob");
  });

  it("drops awards that have fallen out of the window", () => {
    const w = awards();
    w.ok(TOWN_ACTOR, w.award("ada", 10));
    w.town({ type: "new_day", day: DAY + TOWN_LIMITS.eligibleAfterDays + AWARDS.windowDays });
    w.ok("bob", { type: "home" });
    w.ok(TOWN_ACTOR, w.award("bob", 10));
    expect(w.state.awards).toHaveLength(1);
    expect(w.state.awards?.at(0)).toMatchObject({ to: "bob" });
  });
});
