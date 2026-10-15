import { describe, expect, it } from "vitest";
import { apply } from "./apply";
import {
  KINDREDS_CONFIG,
  KINDREDS_DAY,
  KINDREDS_HASH,
  KINDREDS_LOG,
  KINDREDS_SETUP,
} from "./fixtures/kindreds-log";
import { hashWorld } from "./hash";
import { gatheredRun, KINDREDS, kindredById, kindredName, kindredOf } from "./kindreds";
import { replay } from "./replay";
import { expectSupplyHolds, fund } from "./test-support";
import { type Command, TOWN_ACTOR, type WorldState } from "./types";
import { cloneWorld } from "./world";

/**
 * Kindreds (RFC 0033). Every world here starts from the fixture's setup: thirteen people and
 * Ada's three AIs (ada_a, ada_b, ada_c, one household with Ada), each on a plot of their own with a
 * hearth, able to found and host, on Friday, October 17, 2025, with kindreds just opened.
 */

const base = replay(KINDREDS_CONFIG, KINDREDS_SETUP);
const world = () => cloneWorld(base);

const HOUR = 3_600_000;
const at = (day: number, hour: number) => day * 24 * HOUR + hour * HOUR;
const MONDAY = KINDREDS_DAY + 3;

const act = (state: WorldState, actor: string, command: Command) =>
  apply(state, { actor, command });
const ok = (state: WorldState, actor: string, command: Command) => {
  const result = act(state, actor, command);
  expect(result.ok ? null : result.rejection, `${actor} ${JSON.stringify(command)}`).toBeNull();
  return result.ok ? result.events : [];
};
const town = (state: WorldState, command: Command) => ok(state, TOWN_ACTOR, command);
/** A refusal with `code` that leaves the world as it was. Its words. */
function refused(state: WorldState, actor: string, command: Command, code: string): string {
  const before = hashWorld(state);
  const result = act(state, actor, command);
  expect(result.ok ? null : result.rejection.code, JSON.stringify(command)).toBe(code);
  expect(hashWorld(state)).toBe(before);
  return result.ok ? "" : result.rejection.message;
}

const found = (name = "Lantern Row"): Command => ({ type: "found_kindred", name });
const invite = (resident: string): Command => ({ type: "invite_to_kindred", resident });
const join = (kindred = "k_1"): Command => ({ type: "join_kindred", kindred });

/** Ada founds Lantern Row (k_1), and invites each of `members`, who join. */
function row(state: WorldState, members: string[] = []) {
  ok(state, "ada", found());
  for (const id of members) {
    ok(state, "ada", invite(id));
    ok(state, id, join());
  }
  return kindredById(state, "k_1");
}

/** Lantern Row formed (Ada, Bob, and Cy: three households) with its hall on Ada's plot. */
function formedRow(state: WorldState, more: string[] = []) {
  row(state, ["bob", "cy", ...more]);
  ok(state, "ada", { type: "set_kindred_hall", px: 0, py: 0 });
}

type Schedule = Extract<Command, { type: "schedule_event" }>;
/** Tonight's kindred night at Lantern Row's hall, with any field changed. */
const night = (fields: Partial<Schedule> = {}): Schedule => ({
  type: "schedule_event",
  kind: "gathering",
  title: "At the Row",
  px: 0,
  py: 0,
  startsAt: at(KINDREDS_DAY, 19),
  minutes: 30,
  kindred: "k_1",
  ...fields,
});

/** Hold event `id` (30 minutes, six marks) with `guests` there; whoever's home at the plot counts too. */
function hold(state: WorldState, id: string, guests: string[]) {
  town(state, { type: "event_start", event: id });
  for (const g of guests) ok(state, g, { type: "join_event", event: id });
  for (let slot = 1; slot <= 5; slot++) town(state, { type: "event_tick", event: id, slot });
  return town(state, { type: "event_end", event: id });
}

describe("the kindreds log", () => {
  it("replays to its pinned hash, with the supply whole after every input", () => {
    const state = replay(KINDREDS_CONFIG, KINDREDS_SETUP);
    for (const input of KINDREDS_LOG.slice(KINDREDS_SETUP.length)) {
      expect(apply(state, input).ok).toBe(true);
      expectSupplyHolds(state);
    }
    expect(hashWorld(state)).toBe(KINDREDS_HASH);
    expect(hashWorld(replay(KINDREDS_CONFIG, KINDREDS_LOG))).toBe(KINDREDS_HASH);
  });
});

describe("open_kindreds", () => {
  it("comes once from the server, with coins open, and nothing about kindreds runs before it", () => {
    const before = replay(KINDREDS_CONFIG, KINDREDS_SETUP.slice(0, -1));
    expect(before.kindreds).toBeUndefined();
    refused(before, "ada", found(), "kindreds_closed");
    refused(before, "ada", { type: "leave_kindred" }, "kindreds_closed");
    refused(before, "ada", night(), "kindreds_closed");
    refused(before, "ada", { type: "open_kindreds" }, "server_only");
    expect(town(before, { type: "open_kindreds" })).toEqual([{ type: "kindreds_opened" }]);
    expect(before.kindreds).toEqual({ opened: KINDREDS_DAY, nextId: 1, list: {} });
    refused(before, TOWN_ACTOR, { type: "open_kindreds" }, "already_open");

    const noCoins = replay(KINDREDS_CONFIG, [KINDREDS_SETUP[0] as (typeof KINDREDS_SETUP)[0]]);
    refused(noCoins, TOWN_ACTOR, { type: "open_kindreds" }, "not_due");
  });
});

describe("founding", () => {
  it("makes a forming kindred with its founder as steward, for 25 coins burned", () => {
    const state = world();
    const burned = state.economy?.burned ?? 0;
    const had = state.economy?.coins.ada ?? 0;
    const events = ok(state, "ada", found("  Lantern Row "));
    expect(events.slice(0, 2)).toEqual([
      { type: "kindred_founded", kindred: "k_1", name: "Lantern Row", founder: "ada" },
      {
        type: "coins",
        residentId: "ada",
        amount: -KINDREDS.fee,
        balance: had - KINDREDS.fee,
        reason: "kindred_fee",
      },
    ]);
    expect(state.economy?.burned).toBe(burned + KINDREDS.fee);
    expectSupplyHolds(state);
    expect(kindredOf(state, "ada")).toMatchObject({
      id: "k_1",
      name: "Lantern Row",
      status: "forming",
      stewards: ["ada"],
      foundedDay: KINDREDS_DAY,
    });
  });

  it("needs what voting in the Town Hall needs, no kindred already, and the fee", () => {
    const state = world();
    // A newcomer who settled today.
    ok(state, "zed", { type: "join", name: "Zed", kind: "human" });
    ok(state, "zed", { type: "settle", px: 2, py: 3 });
    ok(state, "zed", { type: "set_hearth", x: 19, y: 27 });
    expect(refused(state, "zed", found(), "not_eligible")).toContain("Town Hall");
    ok(state, "ada", found());
    refused(state, "ada", found("Second Row"), "in_kindred");
    const econ = state.economy;
    if (!econ) throw new Error("coins are open");
    econ.treasury += econ.coins.bob ?? 0;
    delete econ.coins.bob;
    refused(state, "bob", found("Bob's Row"), "not_enough_coins");
  });

  it("takes a name of 3 to 32 characters that no other kindred has, ignoring case", () => {
    const state = world();
    refused(state, "ada", found("Ro"), "invalid_name");
    refused(state, "ada", found("x".repeat(KINDREDS.nameMax + 1)), "invalid_name");
    refused(state, "ada", found("Kindred 7"), "invalid_name");
    ok(state, "ada", found("x".repeat(KINDREDS.nameMax)));
    refused(state, "bob", found("X".repeat(KINDREDS.nameMax)), "name_taken");
  });

  it("closes the invites the founder held", () => {
    const state = world();
    ok(state, "ada", found());
    ok(state, "ada", invite("bob"));
    const events = ok(state, "bob", found("Bob's Row"));
    expect(events).toContainEqual({
      type: "kindred_uninvited",
      kindred: "k_1",
      residentId: "bob",
      how: "joined",
    });
    expect(kindredById(state, "k_1")?.invites).toBeUndefined();
  });
});

describe("inviting and joining", () => {
  it("is a steward's invite, accepted, and the third household forms the kindred", () => {
    const state = world();
    ok(state, "ada", found());
    refused(state, "bob", invite("cy"), "not_in_kindred");
    expect(ok(state, "ada", invite("bob"))).toEqual([
      { type: "kindred_invited", kindred: "k_1", residentId: "bob", by: "ada" },
    ]);
    refused(state, "ada", invite("bob"), "already_invited");
    refused(state, "cy", join(), "no_invite");
    refused(state, "bob", join("k_9"), "unknown_kindred");
    expect(ok(state, "bob", join()).slice(0, 1)).toEqual([
      { type: "kindred_joined", kindred: "k_1", residentId: "bob" },
    ]);
    refused(state, "bob", invite("cy"), "not_steward");
    refused(state, "ada", invite("bob"), "in_kindred");
    // Ada's AI is Ada's household: still two.
    ok(state, "ada", invite("ada_a"));
    ok(state, "ada_a", join());
    expect(kindredById(state, "k_1")?.status).toBe("forming");
    ok(state, "ada", invite("cy"));
    const events = ok(state, "cy", join());
    expect(events).toContainEqual({ type: "kindred_formed", kindred: "k_1" });
    expect(kindredById(state, "k_1")).toMatchObject({ status: "formed", formedDay: KINDREDS_DAY });
  });

  it("asks for a resident with a hearth, not townsfolk, in no kindred", () => {
    const state = world();
    ok(state, "ada", found());
    refused(state, "ada", invite("nobody"), "unknown_resident");
    ok(state, "zed", { type: "join", name: "Zed", kind: "human" });
    refused(state, "ada", invite("zed"), "no_hearth");
    town(state, { type: "set_townsfolk", ids: ["ivy"] });
    refused(state, "ada", invite("ivy"), "not_eligible");
    ok(state, "bob", found("Bob's Row"));
    refused(state, "ada", invite("bob"), "in_kindred");
  });

  it("holds 8 open invites at most, and a resident may hold several; joining one closes the rest", () => {
    const state = world();
    ok(state, "ada", found());
    const many = ["bob", "cy", "dee", "fay", "gus", "hal", "ivy", "jo"];
    for (const id of many) ok(state, "ada", invite(id));
    refused(state, "ada", invite("kit"), "invite_limit");
    ok(state, "ada", { type: "cancel_kindred_invite", resident: "jo" });
    refused(state, "ada", { type: "cancel_kindred_invite", resident: "jo" }, "no_invite");
    ok(state, "ada", invite("kit"));
    ok(state, "lu", found("Lu's Row"));
    ok(state, "lu", invite("bob"));
    const events = ok(state, "bob", join("k_2"));
    expect(events).toContainEqual({
      type: "kindred_uninvited",
      kindred: "k_1",
      residentId: "bob",
      how: "joined",
    });
    expect(Object.keys(kindredById(state, "k_1")?.invites ?? {})).not.toContain("bob");
    expect(ok(state, "cy", { type: "decline_kindred_invite", kindred: "k_1" })[0]).toEqual({
      type: "kindred_uninvited",
      kindred: "k_1",
      residentId: "cy",
      how: "declined",
    });
    refused(state, "cy", join(), "no_invite");
  });

  it("stops at 12 members, and 3 from one household", () => {
    const state = world();
    row(state, ["ada_a", "ada_b"]);
    // Ada and two of her AIs: her household is full.
    expect(refused(state, "ada", invite("ada_c"), "household_full")).toContain("household");
    // The cap holds at joining too, for an invite sent before the household filled.
    const other = world();
    row(other, ["ada_a"]);
    ok(other, "ada", invite("ada_b"));
    ok(other, "ada", invite("ada_c"));
    ok(other, "ada_b", join());
    refused(other, "ada_c", join(), "household_full");
    // One household counts once toward forming.
    expect(kindredById(other, "k_1")?.status).toBe("forming");

    const full = world();
    const people = ["bob", "cy", "dee", "fay", "gus", "hal", "ivy", "jo", "kit", "lu", "mo"];
    row(full, people.slice(0, 7));
    for (const id of people.slice(7)) ok(full, "ada", invite(id));
    ok(full, "ada", invite("ned"));
    for (const id of people.slice(7)) ok(full, id, join());
    expect(Object.keys(kindredById(full, "k_1")?.members ?? {})).toHaveLength(KINDREDS.membersMax);
    refused(full, "ned", join(), "kindred_full");
    refused(full, "ada", invite("ada_a"), "kindred_full");
  });
});

describe("leaving, removing, and stewards", () => {
  it("leaving makes a 7-day wait, and the last member out disbands it and frees its name", () => {
    const state = world();
    row(state, ["bob"]);
    expect(ok(state, "bob", { type: "leave_kindred" })[0]).toEqual({
      type: "kindred_left",
      kindred: "k_1",
      residentId: "bob",
      how: "left",
    });
    refused(state, "bob", { type: "leave_kindred" }, "not_in_kindred");
    expect(refused(state, "bob", found("Bob's Row"), "wait_after_leaving")).toContain("7 days");
    refused(state, "ada", invite("bob"), "wait_after_leaving");
    expect(ok(state, "ada", { type: "leave_kindred" }).slice(0, 2)).toEqual([
      { type: "kindred_left", kindred: "k_1", residentId: "ada", how: "left" },
      { type: "kindred_disbanded", kindred: "k_1", how: "empty" },
    ]);
    expect(state.kindreds?.list).toEqual({});
    ok(state, "cy", found("Lantern Row"));
    // The wait is over 7 days on, and new_day forgets it.
    town(state, { type: "new_day", day: KINDREDS_DAY + 6 });
    refused(state, "bob", found("Bob's Row"), "wait_after_leaving");
    town(state, { type: "new_day", day: KINDREDS_DAY + 7 });
    expect(state.kindreds?.leftDay).toBeUndefined();
    ok(state, "bob", { type: "home" });
    ok(state, "bob", found("Bob's Row"));
  });

  it("a steward removes a member who isn't a steward, and they wait too", () => {
    const state = world();
    row(state, ["bob", "cy"]);
    refused(state, "bob", { type: "remove_from_kindred", resident: "cy" }, "not_steward");
    refused(state, "ada", { type: "remove_from_kindred", resident: "dee" }, "not_in_kindred");
    ok(state, "ada", { type: "set_kindred_steward", resident: "bob", steward: true });
    refused(state, "ada", { type: "remove_from_kindred", resident: "bob" }, "not_eligible");
    expect(ok(state, "bob", { type: "remove_from_kindred", resident: "cy" })).toEqual([
      { type: "kindred_left", kindred: "k_1", residentId: "cy", how: "removed" },
    ]);
    ok(state, "ada", invite("dee"));
    refused(state, "ada", invite("cy"), "wait_after_leaving");
  });

  it("has up to 3 stewards, who step down themselves; with none left the longest-standing member is one", () => {
    const state = world();
    row(state, ["bob", "cy", "dee", "fay"]);
    const steward = (actor: string, resident: string, on: boolean, code?: string) =>
      code
        ? refused(state, actor, { type: "set_kindred_steward", resident, steward: on }, code)
        : ok(state, actor, { type: "set_kindred_steward", resident, steward: on });
    steward("ada", "bob", true);
    steward("ada", "bob", true, "already_set");
    steward("bob", "cy", true);
    steward("ada", "dee", true, "not_eligible");
    steward("ada", "gus", true, "not_in_kindred");
    steward("ada", "bob", false, "not_eligible");
    steward("dee", "dee", true, "not_steward");
    steward("bob", "bob", false);
    expect(kindredById(state, "k_1")?.stewards).toEqual(["ada", "cy"]);
    steward("cy", "cy", false);
    // Ada, the last steward, leaves: Bob has stood longest of the rest.
    expect(ok(state, "ada", { type: "leave_kindred" }).slice(0, 3)).toEqual([
      { type: "kindred_left", kindred: "k_1", residentId: "ada", how: "left" },
      { type: "kindred_steward", kindred: "k_1", residentId: "ada", steward: false },
      { type: "kindred_steward", kindred: "k_1", residentId: "bob", steward: true },
    ]);
    expect(kindredById(state, "k_1")?.stewards).toEqual(["bob"]);

    const alone = world();
    row(alone);
    refused(
      alone,
      "ada",
      { type: "set_kindred_steward", resident: "ada", steward: false },
      "not_eligible",
    );
  });
});

describe("names", () => {
  it("a steward renames it once a UTC week, Monday to Sunday", () => {
    const state = world();
    row(state, ["bob"]);
    const name = (to: string): Command => ({ type: "name_kindred", name: to });
    refused(state, "bob", name("Bob's Row"), "not_steward");
    refused(state, "ada", name("Lantern Row"), "invalid_name");
    ok(state, "cy", found("Cy's Row"));
    refused(state, "ada", name("cy's row"), "name_taken");
    expect(ok(state, "ada", name("Lantern Lane"))).toEqual([
      { type: "kindred_named", kindred: "k_1", name: "Lantern Lane", by: "ada" },
    ]);
    expect(refused(state, "ada", name("Lantern Way"), "rename_limit")).toContain("Monday");
    town(state, { type: "new_day", day: KINDREDS_DAY + 2 });
    refused(state, "ada", name("Lantern Way"), "rename_limit");
    town(state, { type: "new_day", day: MONDAY });
    ok(state, "ada", name("Lantern Way"));
  });

  it("staff take a name down, and it goes by its id until a steward names it again", () => {
    const state = world();
    row(state);
    expect(town(state, { type: "clear_kindred_name", kindred: "k_1" })).toEqual([
      { type: "kindred_named", kindred: "k_1", name: null, by: null },
    ]);
    refused(state, TOWN_ACTOR, { type: "clear_kindred_name", kindred: "k_1" }, "already_set");
    refused(state, "ada", { type: "clear_kindred_name", kindred: "k_1" }, "server_only");
    const k = kindredById(state, "k_1");
    expect(k && kindredName(k)).toBe("Kindred 1");
    // Its old name is free for anyone.
    ok(state, "bob", found("Lantern Row"));
    ok(state, "ada", { type: "name_kindred", name: "Lantern Lane" });
  });
});

describe("the hall", () => {
  it("is a plot a steward of a formed kindred owns or shares, one kindred's at most", () => {
    const state = world();
    row(state, ["bob"]);
    const hall = (px: number | null, py: number | null): Command => ({
      type: "set_kindred_hall",
      px,
      py,
    });
    refused(state, "ada", hall(0, 0), "not_formed");
    ok(state, "ada", invite("cy"));
    ok(state, "cy", join());
    refused(state, "bob", hall(1, 0), "not_steward");
    refused(state, "ada", hall(1, 0), "not_your_plot");
    refused(state, "ada", hall(2, 2), "plot_is_commons");
    refused(state, "ada", hall(9, 0), "out_of_bounds");
    refused(state, "ada", hall(null, null), "already_set");
    expect(ok(state, "ada", hall(0, 0))).toEqual([
      { type: "kindred_hall", kindred: "k_1", hall: { px: 0, py: 0 }, name: "Lantern Row" },
    ]);
    refused(state, "ada", hall(0, 0), "already_set");
    // Ada shares her plot with Dee, whose own kindred can't have it as a hall too.
    ok(state, "ada", { type: "share_plot", with: "dee" });
    ok(state, "dee", found("Dee's Row"));
    ok(state, "dee", invite("fay"));
    ok(state, "fay", join("k_2"));
    ok(state, "dee", invite("gus"));
    ok(state, "gus", join("k_2"));
    refused(state, "dee", hall(0, 0), "already_set");
    expect(ok(state, "ada", hall(null, null))).toEqual([
      { type: "kindred_hall", kindred: "k_1", hall: null },
    ]);
  });

  it("is cleared when its plot is released, its steward is unshared from it, or steps down", () => {
    const released = world();
    formedRow(released);
    expect(ok(released, "ada", { type: "release" })).toContainEqual({
      type: "kindred_hall",
      kindred: "k_1",
      hall: null,
    });

    const unshared = world();
    row(unshared, ["bob", "cy"]);
    ok(unshared, "ada", { type: "set_kindred_steward", resident: "bob", steward: true });
    ok(unshared, "ada", { type: "share_plot", with: "bob" });
    ok(unshared, "bob", { type: "set_kindred_hall", px: 0, py: 0 });
    expect(kindredById(unshared, "k_1")?.hall).toEqual({ px: 0, py: 0, by: "bob" });
    expect(ok(unshared, "ada", { type: "unshare_plot", with: "bob" })).toContainEqual({
      type: "kindred_hall",
      kindred: "k_1",
      hall: null,
    });

    const stepped = world();
    formedRow(stepped);
    ok(stepped, "ada", { type: "set_kindred_steward", resident: "bob", steward: true });
    expect(
      ok(stepped, "ada", { type: "set_kindred_steward", resident: "ada", steward: false }),
    ).toContainEqual({ type: "kindred_hall", kindred: "k_1", hall: null });
  });
});

describe("new_day", () => {
  it("lapses an invite after 7 days, and disbands a kindred still forming after 14", () => {
    const state = world();
    row(state, ["bob"]);
    ok(state, "ada", invite("cy"));
    town(state, { type: "new_day", day: KINDREDS_DAY + 6 });
    expect(kindredById(state, "k_1")?.invites).toBeDefined();
    expect(town(state, { type: "new_day", day: KINDREDS_DAY + 7 })).toContainEqual({
      type: "kindred_uninvited",
      kindred: "k_1",
      residentId: "cy",
      how: "lapsed",
    });
    town(state, { type: "new_day", day: KINDREDS_DAY + 13 });
    expect(kindredById(state, "k_1")).toBeDefined();
    const burned = state.economy?.burned;
    expect(town(state, { type: "new_day", day: KINDREDS_DAY + 14 })).toContainEqual({
      type: "kindred_disbanded",
      kindred: "k_1",
      how: "unformed",
    });
    expect(kindredOf(state, "ada")).toBeUndefined();
    // Nobody waits.
    expect(state.economy?.burned).toBe(burned);
    ok(state, "bob", { type: "home" });
    ok(state, "bob", found("Lantern Row"));
  });

  it("leaves a formed kindred standing", () => {
    const state = world();
    formedRow(state);
    town(state, { type: "new_day", day: KINDREDS_DAY + 30 });
    expect(kindredById(state, "k_1")?.status).toBe("formed");
  });
});

describe("the fee (issue #69)", () => {
  const coins = (state: WorldState, id: string) => state.economy?.coins[id] ?? 0;
  const chip = (n: number, kindred = "k_1"): Command => ({
    type: "chip_in_kindred",
    kindred,
    coins: n,
  });

  it("comes back but its small burn when the kindred doesn't form, to each who paid it", () => {
    const state = world();
    row(state, ["bob", "ada_a"]);
    const ada = coins(state, "ada");
    const bob = coins(state, "bob");
    expect(ok(state, "bob", chip(8))).toContainEqual({
      type: "kindred_chipped_in",
      kindred: "k_1",
      residentId: "bob",
      coins: 8,
    });
    expect([coins(state, "ada"), coins(state, "bob")]).toEqual([ada + 8, bob - 8]);
    ok(state, "ada_a", chip(4));
    expect(kindredById(state, "k_1")?.chips).toEqual({ bob: 8, ada_a: 4 });
    const events = town(state, { type: "new_day", day: KINDREDS_DAY + 14 });
    const refunds = events.filter((e) => e.type === "coins" && e.reason === "kindred_refund");
    expect(refunds).toEqual([
      expect.objectContaining({ residentId: "bob", amount: 8 }),
      expect.objectContaining({ residentId: "ada_a", amount: 4 }),
      expect.objectContaining({ residentId: "ada", amount: 25 - 5 - 12 }),
    ]);
    // Bob is whole; Ada is out the small burn, and the chip-ins she held went back to the givers.
    expect(coins(state, "bob")).toBe(bob);
    expectSupplyHolds(state);
  });

  it("is shared by members up to all but the small burn, and only while it forms", () => {
    const state = world();
    row(state, ["bob"]);
    refused(state, "ada", chip(5), "not_eligible");
    refused(state, "cy", chip(5), "not_in_kindred");
    refused(state, "bob", chip(0), "invalid_amount");
    expect(refused(state, "bob", chip(21), "invalid_amount")).toContain("20 coins");
    refused(state, "bob", chip(5, "k_9"), "unknown_kindred");
    // Bob spends down to 3 coins, so 4 is more than he has.
    const econ = state.economy;
    if (econ) {
      econ.burned += coins(state, "bob") - 3;
      econ.coins.bob = 3;
    }
    refused(state, "bob", chip(4), "not_enough_coins");
    fund(state, "bob", 30);
    ok(state, "bob", chip(15));
    expect(refused(state, "bob", chip(6), "invalid_amount")).toContain("5 coins");
    ok(state, "bob", chip(5));
    refused(state, "bob", chip(1), "chip_in_full");
    ok(state, "ada", invite("cy"));
    ok(state, "cy", join());
    expect(kindredById(state, "k_1")?.status).toBe("formed");
    refused(state, "cy", chip(1), "not_forming");
  });

  it("stays burned for its founder when a forming kindred empties, and chip-ins go back", () => {
    const state = world();
    row(state, ["bob"]);
    const bob = coins(state, "bob");
    ok(state, "bob", chip(6));
    ok(state, "bob", { type: "leave_kindred" });
    const ada = coins(state, "ada");
    const events = ok(state, "ada", { type: "leave_kindred" });
    expect(kindredById(state, "k_1")).toBeUndefined();
    expect(events.filter((e) => e.type === "coins")).toEqual([
      expect.objectContaining({ residentId: "bob", amount: 6, reason: "kindred_refund" }),
    ]);
    expect([coins(state, "ada"), coins(state, "bob")]).toEqual([ada, bob]);
    expectSupplyHolds(state);
  });

  it("keeps a member who chipped in from being removed while it forms", () => {
    const state = world();
    row(state, ["bob", "ada_a"]);
    ok(state, "bob", chip(3));
    refused(state, "ada", { type: "remove_from_kindred", resident: "bob" }, "chipped_in");
    ok(state, "ada", { type: "remove_from_kindred", resident: "ada_a" });
  });
});

describe("kindred night", () => {
  it("is a member's event at the formed kindred's hall, one a UTC week", () => {
    const state = world();
    row(state, ["bob"]);
    refused(state, "bob", night(), "not_formed");
    ok(state, "ada", invite("cy"));
    ok(state, "cy", join());
    expect(refused(state, "bob", night(), "not_your_plot")).toContain("set_kindred_hall");
    ok(state, "ada", { type: "set_kindred_hall", px: 0, py: 0 });
    refused(state, "dee", night(), "not_in_kindred");
    refused(state, "bob", night({ kindred: "k_7" }), "unknown_kindred");
    refused(state, "bob", night({ px: 1, py: 0 }), "not_your_plot");
    // Bob doesn't share Ada's plot, and hosts at the hall all the same.
    expect(ok(state, "bob", night())).toEqual([
      {
        type: "event_scheduled",
        event: "e_1",
        host: "bob",
        kind: "gathering",
        px: 0,
        py: 0,
        startsAt: at(KINDREDS_DAY, 19),
        minutes: 30,
        kindred: "k_1",
      },
    ]);
    // Sunday is the same UTC week. Monday starts the next.
    refused(state, "cy", night({ startsAt: at(MONDAY - 1, 19) }), "night_this_week");
    ok(state, "cy", night({ startsAt: at(MONDAY, 19) }));
    // A night called off frees its week.
    ok(state, "bob", { type: "cancel_event", event: "e_1" });
    ok(state, "ada", night({ startsAt: at(KINDREDS_DAY + 1, 19) }));
    // Without `kindred`, Bob still can't host on Ada's plot.
    refused(state, "bob", { ...night(), kindred: undefined }, "not_your_plot");
  });

  it("counts its week when 3 members from 2 households came, the host among them", () => {
    const state = world();
    formedRow(state, ["ada_a", "ada_b"]);
    ok(state, "bob", night());
    // Ada is home at the hall, and Bob, who hosts, stays on his own plot: Ada and her two AIs are
    // three members but one household, so the week doesn't count.
    const events = hold(state, "e_1", ["ada_a", "ada_b", "dee"]);
    expect(events.find((e) => e.type === "kindred_gathered")).toBeUndefined();
    const e = state.events?.list[0];
    expect(e?.kin).toEqual(["ada", "ada_a", "ada_b"]);
    expect(e?.attended).toEqual(["ada", "ada_a", "ada_b", "dee"]);

    const counted = world();
    formedRow(counted, ["ada_a"]);
    ok(counted, "bob", night());
    town(counted, { type: "event_start", event: "e_1" });
    for (const g of ["bob", "ada_a", "dee"]) ok(counted, g, { type: "join_event", event: "e_1" });
    for (let slot = 1; slot <= 5; slot++) town(counted, { type: "event_tick", event: "e_1", slot });
    const end = town(counted, { type: "event_end", event: "e_1" });
    expect(end).toContainEqual({
      type: "kindred_gathered",
      kindred: "k_1",
      event: "e_1",
      week: MONDAY - 7,
      members: ["ada", "ada_a", "bob"],
      weeks: 1,
    });
    // The host attended the kindred's night, and still isn't one of its guests.
    expect(counted.events?.list[0]?.attended).toEqual(["ada", "ada_a", "dee"]);
    expect(counted.kindreds?.nights).toEqual({ ada: 1, ada_a: 1, bob: 1 });
    const k = kindredById(counted, "k_1");
    expect(k && gatheredRun(k, KINDREDS_DAY)).toBe(1);
    expect(k && gatheredRun(k, MONDAY)).toBe(1);
    expect(k && gatheredRun(k, MONDAY + 7)).toBe(0);
  });

  it("never counts a member as a guest at their own kindred's night", () => {
    const state = world();
    formedRow(state);
    ok(state, "bob", night());
    hold(state, "e_1", ["bob", "cy", "dee"]);
    refused(
      state,
      TOWN_ACTOR,
      { type: "credit_event", event: "e_1", guests: ["cy"] },
      "not_eligible",
    );
    town(state, { type: "credit_event", event: "e_1", guests: ["dee"] });
  });

  it("brings the title after 8 counted nights, across weeks", () => {
    const state = world();
    formedRow(state);
    const title: Command = { type: "profile", title: "kindred_regular" };
    for (let week = 0; week < KINDREDS.regularAt; week++) {
      const day = KINDREDS_DAY + 7 * week;
      if (week > 0) {
        town(state, { type: "new_day", day });
        // Everyone acts in the new week, so they're active, and Bob and Cy go home from the hall.
        for (const id of ["ada", "bob", "cy"]) ok(state, id, { type: "home" });
      }
      if (week === KINDREDS.regularAt - 1) {
        expect(refused(state, "cy", title, "not_earned")).toContain("7");
      }
      ok(state, "ada", night({ startsAt: at(day, 19) }));
      const event = state.events?.list.at(-1)?.id as string;
      const end = hold(state, event, ["bob", "cy"]);
      expect(end.some((e) => e.type === "kindred_gathered")).toBe(true);
    }
    expect(state.kindreds?.nights).toEqual({ ada: 8, bob: 8, cy: 8 });
    expect(ok(state, "cy", title)).toEqual([
      { type: "title_changed", residentId: "cy", title: "kindred_regular" },
    ]);
    const k = kindredById(state, "k_1");
    expect(k && gatheredRun(k, KINDREDS_DAY + 49)).toBe(8);
  });
});

describe("a kindred night's place", () => {
  /** Ada's plot, shared with Bob, a steward, who makes it the hall; Cy books tonight's night there. */
  function booked() {
    const state = world();
    row(state, ["bob", "cy"]);
    ok(state, "ada", { type: "set_kindred_steward", resident: "bob", steward: true });
    ok(state, "ada", { type: "share_plot", with: "bob" });
    ok(state, "bob", { type: "set_kindred_hall", px: 0, py: 0 });
    ok(state, "cy", night());
    return state;
  }
  const cancelled = { type: "event_cancelled", event: "e_1" };
  const status = (state: WorldState) => state.events?.list[0]?.status;

  it("is called off when the hall's steward is unshared from its plot", () => {
    const state = booked();
    expect(ok(state, "ada", { type: "unshare_plot", with: "bob" })).toContainEqual(cancelled);
    expect(status(state)).toBe("cancelled");
  });

  it("is called off when its hall moves, or is cleared", () => {
    const moved = booked();
    // Bob moves the hall to his own plot.
    expect(ok(moved, "bob", { type: "set_kindred_hall", px: 1, py: 0 })).toEqual([
      { type: "kindred_hall", kindred: "k_1", hall: { px: 1, py: 0 }, name: "Lantern Row" },
      cancelled,
    ]);
    const cleared = booked();
    expect(ok(cleared, "bob", { type: "set_kindred_hall", px: null, py: null })).toContainEqual(
      cancelled,
    );
  });

  it("is called off when its host leaves the kindred, or staff disband it", () => {
    const left = booked();
    expect(ok(left, "cy", { type: "leave_kindred" })).toContainEqual(cancelled);
    const gone = booked();
    expect(town(gone, { type: "disband_kindred", kindred: "k_1", by: "staff_1" })).toContainEqual(
      cancelled,
    );
    // Someone else's night stays when a member who isn't its host leaves.
    const stays = booked();
    ok(stays, "ada", { type: "leave_kindred" });
    expect(status(stays)).toBe("scheduled");
  });

  it("keeps a member who leaves during it as one of its kin", () => {
    const state = world();
    formedRow(state, ["dee"]);
    ok(state, "bob", night());
    town(state, { type: "event_start", event: "e_1" });
    expect(state.events?.list[0]?.kin).toEqual(["ada", "bob", "cy", "dee"]);
    for (const g of ["bob", "cy", "dee"]) ok(state, g, { type: "join_event", event: "e_1" });
    for (let slot = 1; slot <= 5; slot++) town(state, { type: "event_tick", event: "e_1", slot });
    ok(state, "dee", { type: "leave_kindred" });
    town(state, { type: "event_end", event: "e_1" });
    expect(state.events?.list[0]?.kin).toEqual(["ada", "bob", "cy", "dee"]);
    refused(
      state,
      TOWN_ACTOR,
      { type: "credit_event", event: "e_1", guests: ["dee"] },
      "not_eligible",
    );
  });

  it("counts no week for 2 members from 2 households", () => {
    const state = world();
    formedRow(state);
    ok(state, "bob", night());
    // Ada is home at the hall and Bob hosts from his plot; only Cy comes.
    const end = hold(state, "e_1", ["cy"]);
    expect(state.events?.list[0]?.kin).toEqual(["ada", "cy"]);
    expect(end.find((e) => e.type === "kindred_gathered")).toBeUndefined();
  });
});

describe("staff", () => {
  it("disband a kindred, and nobody waits after it", () => {
    const state = world();
    row(state, ["bob"]);
    refused(state, TOWN_ACTOR, { type: "disband_kindred", kindred: "k_1", by: "" }, "server_only");
    refused(
      state,
      TOWN_ACTOR,
      { type: "disband_kindred", kindred: "k_2", by: "s" },
      "unknown_kindred",
    );
    expect(town(state, { type: "disband_kindred", kindred: "k_1", by: "staff_1" })).toEqual([
      { type: "kindred_disbanded", kindred: "k_1", how: "staff" },
    ]);
    ok(state, "bob", found());
  });
});

describe("merging a resident", () => {
  const merge = (state: WorldState, from: string, into: string) =>
    town(state, { type: "merge_resident", from, into });

  it("moves a membership into the record that stays, with its place and stewardship", () => {
    const state = world();
    row(state, ["jo", "bob"]);
    ok(state, "ada", { type: "set_kindred_steward", resident: "jo", steward: true });
    ok(state, "ada", invite("cy"));
    ok(state, "jo", { type: "leave" });
    const events = merge(state, "jo", "kit");
    expect(events).toContainEqual({ type: "kindred_joined", kindred: "k_1", residentId: "kit" });
    const k = kindredById(state, "k_1");
    expect(k?.stewards).toEqual(["ada", "kit"]);
    expect(Object.keys(k?.members ?? {})).toEqual(["ada", "bob", "kit"]);
  });

  it("ends the membership when the record that stays is in a kindred, and moves its nights", () => {
    const state = world();
    formedRow(state, ["jo"]);
    ok(state, "ada", night());
    hold(state, "e_1", ["bob", "jo"]);
    ok(state, "kit", found("Kit's Row"));
    ok(state, "jo", { type: "leave" });
    const events = merge(state, "jo", "kit");
    expect(events).toContainEqual({
      type: "kindred_left",
      kindred: "k_1",
      residentId: "jo",
      how: "merged",
    });
    expect(events).toContainEqual({ type: "kindred_nights", residentId: "kit", nights: 1 });
    expect(kindredOf(state, "kit")?.id).toBe("k_2");
    expect(state.kindreds?.leftDay).toBeUndefined();
  });
});

describe("merging into a household with no room", () => {
  it("ends the membership, and a hall that was the merged record's plot is cleared", () => {
    const state = world();
    // Bob's kindred has Ada's three AIs, her household's share, and Jo, a steward whose plot is
    // the hall. Jo is merged into Ada, who'd be her household's fourth.
    ok(state, "bob", found());
    for (const id of ["ada_a", "ada_b", "ada_c", "jo"]) {
      ok(state, "bob", invite(id));
      ok(state, id, join());
    }
    ok(state, "bob", { type: "set_kindred_steward", resident: "jo", steward: true });
    ok(state, "jo", { type: "set_kindred_hall", px: 3, py: 1 });
    ok(state, "jo", { type: "leave" });
    const events = town(state, { type: "merge_resident", from: "jo", into: "ada" });
    expect(events).toContainEqual({ type: "kindred_hall", kindred: "k_1", hall: null });
    expect(events).toContainEqual({
      type: "kindred_left",
      kindred: "k_1",
      residentId: "jo",
      how: "merged",
    });
    expect(kindredOf(state, "ada")).toBeUndefined();
    expect(state.kindreds?.leftDay).toBeUndefined();
  });
});

describe("joining as townsfolk", () => {
  it("is refused for an invitee made townsfolk since", () => {
    const state = world();
    row(state);
    ok(state, "ada", invite("bob"));
    town(state, { type: "set_townsfolk", ids: ["bob"] });
    refused(state, "bob", join(), "not_eligible");
  });
});

describe("rejected inputs", () => {
  it("leave the world as it was for every kindred command", () => {
    const state = world();
    formedRow(state);
    const commands: [string, Command][] = [
      ["dee", { type: "leave_kindred" }],
      ["dee", { type: "join_kindred", kindred: "__proto__" }],
      ["dee", { type: "decline_kindred_invite", kindred: "toString" }],
      ["ada", { type: "cancel_kindred_invite", resident: "__proto__" }],
      ["ada", { type: "remove_from_kindred", resident: "constructor" }],
      ["ada", { type: "set_kindred_steward", resident: "__proto__", steward: true }],
      ["ada", { type: "invite_to_kindred", resident: "__proto__" }],
      [TOWN_ACTOR, { type: "clear_kindred_name", kindred: "__proto__" }],
      [TOWN_ACTOR, { type: "disband_kindred", kindred: "hasOwnProperty", by: "s" }],
      ["ada", night({ kindred: "__proto__" })],
    ];
    for (const [actor, command] of commands) {
      const before = hashWorld(state);
      expect(act(state, actor, command).ok, JSON.stringify(command)).toBe(false);
      expect(hashWorld(state)).toBe(before);
    }
  });
});
