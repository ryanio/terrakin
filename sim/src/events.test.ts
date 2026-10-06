import { describe, expect, it } from "vitest";
import { apply } from "./apply";
import { eventHeld, findEvent } from "./events";
import { EVENTS_CONFIG, EVENTS_HASH, EVENTS_LOG } from "./fixtures/events-log";
import { hashWorld } from "./hash";
import { replay } from "./replay";
import { expectSupplyHolds } from "./test-support";
import { type Command, TOWN_ACTOR, type WorldConfig, type WorldState } from "./types";
import { createWorld } from "./world";

// 3x3 plots of 8 tiles. The Commons is plot (1, 1), tiles 8 to 15; the Town Hall stands on x 11
// to 13, y 8 and 9.
const CONFIG: WorldConfig = {
  width: 24,
  height: 24,
  plotSize: 8,
  maxPlotsPerResident: 1,
  reach: 3,
};

const DAY = 20_000;
/** The day the hosts below can host: three days after they settled. */
const TODAY = DAY + 3;
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
/** `hour`:`minute` UTC on world day `day`, in ms. */
const at = (day: number, hour: number, minute = 0) =>
  day * 24 * HOUR + hour * HOUR + minute * MINUTE;

const act = (state: WorldState, actor: string, command: Command) =>
  apply(state, { actor, command });
const town = (state: WorldState, command: Command) => act(state, TOWN_ACTOR, command);
const code = (result: ReturnType<typeof apply>) => (result.ok ? null : result.rejection.code);
const ok = (result: ReturnType<typeof apply>) => {
  expect(result.ok ? null : result.rejection).toBeNull();
  return result.ok ? result.events : [];
};

/**
 * Four hosts with starter homes on their own plots, three days old, who acted today: Ada (0, 0),
 * Bob (2, 0), Cy (0, 2), and Dee (2, 2). Eve has a plot (1, 0) and a hearth but no blocks, so she
 * can release it. With `coins`, everyone has their welcome gift and a day's allowance (60 coins).
 */
function world({ coins = true } = {}): WorldState {
  const state = createWorld(CONFIG);
  ok(town(state, { type: "new_day", day: DAY }));
  if (coins) ok(town(state, { type: "open_economy" }));
  for (const [id, px, py] of [
    ["ada", 0, 0],
    ["bob", 2, 0],
    ["cy", 0, 2],
    ["dee", 2, 2],
  ] as const) {
    ok(act(state, id, { type: "join", name: id, kind: "human" }));
    ok(act(state, id, { type: "settle", px, py }));
    ok(act(state, id, { type: "build_starter_home" }));
  }
  ok(act(state, "eve", { type: "join", name: "Eve", kind: "agent" }));
  ok(act(state, "eve", { type: "settle", px: 1, py: 0 }));
  ok(act(state, "eve", { type: "set_hearth", x: 11, y: 3 }));
  ok(town(state, { type: "new_day", day: TODAY }));
  for (const id of ["ada", "bob", "cy", "dee", "eve"]) {
    ok(act(state, id, { type: "move", dir: "n" }));
  }
  return state;
}

type Schedule = Extract<Command, { type: "schedule_event" }>;
/** A listening session on Ada's plot tonight, with any field changed. */
const schedule = (fields: Partial<Schedule> = {}): Schedule => ({
  type: "schedule_event",
  kind: "listening",
  title: "Sunday records",
  px: 0,
  py: 0,
  startsAt: at(TODAY, 19),
  minutes: 60,
  ...fields,
});
const COMMONS = { px: 1, py: 1 } as const;

const coinsOf = (state: WorldState, id: string) => state.economy?.coins[id] ?? 0;

/** Sample `event` at marks `from` to `to`. */
function sample(state: WorldState, event: string, from: number, to: number) {
  for (let slot = from; slot <= to; slot++) ok(town(state, { type: "event_tick", event, slot }));
}

describe("scheduling an event", () => {
  it("puts it on the host's own or shared plot for free, and a Commons booking holds a deposit", () => {
    const state = world();
    ok(act(state, "ada", { type: "share_plot", with: "bob" }));
    const events = ok(act(state, "ada", schedule()));
    expect(events).toEqual([
      {
        type: "event_scheduled",
        event: "e_1",
        host: "ada",
        kind: "listening",
        px: 0,
        py: 0,
        startsAt: at(TODAY, 19),
        minutes: 60,
      },
    ]);
    expect(findEvent(state, "e_1")).toMatchObject({ status: "scheduled", day: TODAY, ticks: 0 });
    // Bob hosts on the plot Ada shares with him, later the same evening.
    ok(act(state, "bob", schedule({ kind: "class", title: "Knots", startsAt: at(TODAY, 21) })));
    expect(coinsOf(state, "ada")).toBe(60);
    expect(eventHeld(state)).toBe(0);

    const commons = ok(act(state, "dee", schedule({ ...COMMONS, title: "Lantern walk" })));
    expect(commons).toContainEqual({
      type: "coins",
      residentId: "dee",
      amount: -10,
      balance: 50,
      reason: "event_deposit",
    });
    // Events carry where and when, never the host's words.
    expect(JSON.stringify(commons)).not.toContain("Lantern walk");
    expect(findEvent(state, "e_3")).toMatchObject({ deposit: 10 });
    expect(eventHeld(state)).toBe(10);
    expectSupplyHolds(state);
  });

  it("refuses what the rules don't allow, and changes nothing", () => {
    interface Case {
      what: string;
      /** What has to be true first. Accepted. */
      setup?: (state: WorldState) => void;
      actor: string;
      command: Command;
      code: string;
      /** A world without coins. */
      noCoins?: true;
    }
    const bob = (fields: Partial<Schedule>) => schedule({ px: 2, ...fields });
    const cases: Case[] = [
      {
        what: "a host whose plot is new",
        setup: (state) => {
          ok(act(state, "fay", { type: "join", name: "Fay", kind: "human" }));
          ok(act(state, "fay", { type: "settle", px: 0, py: 1 }));
          ok(act(state, "fay", { type: "build_starter_home" }));
        },
        actor: "fay",
        command: schedule({ px: 0, py: 1 }),
        code: "not_eligible",
      },
      {
        what: "townsfolk",
        setup: (state) => ok(town(state, { type: "set_townsfolk", ids: ["cy"] })),
        actor: "cy",
        command: schedule({ px: 0, py: 2 }),
        code: "not_eligible",
      },
      {
        what: "an unknown kind",
        actor: "bob",
        command: bob({ kind: "rave" as "show" }),
        code: "invalid_event",
      },
      { what: "no title", actor: "bob", command: bob({ title: "  " }), code: "invalid_event" },
      {
        what: "a long title",
        actor: "bob",
        command: bob({ title: "x".repeat(81) }),
        code: "invalid_event",
      },
      {
        what: "a long text",
        actor: "bob",
        command: bob({ text: "x".repeat(501) }),
        code: "invalid_event",
      },
      { what: "14 minutes", actor: "bob", command: bob({ minutes: 14 }), code: "invalid_event" },
      { what: "181 minutes", actor: "bob", command: bob({ minutes: 181 }), code: "invalid_event" },
      {
        what: "a start off the minute",
        actor: "bob",
        command: bob({ startsAt: at(TODAY, 19) + 30_000 }),
        code: "invalid_event",
      },
      {
        what: "a day that's gone",
        actor: "bob",
        command: bob({ startsAt: at(TODAY - 1, 19) }),
        code: "invalid_event",
      },
      {
        what: "15 days ahead",
        actor: "bob",
        command: bob({ startsAt: at(TODAY + 15, 0) }),
        code: "invalid_event",
      },
      { what: "someone else's plot", actor: "bob", command: schedule(), code: "not_your_plot" },
      {
        what: "a plot off the world",
        actor: "bob",
        command: bob({ px: 3 }),
        code: "invalid_event",
      },
      {
        what: "a place already booked then",
        actor: "ada",
        command: schedule({ startsAt: at(TODAY, 19, 30) }),
        code: "event_clash",
      },
      {
        what: "less than 15 minutes after another ends",
        actor: "ada",
        command: schedule({ startsAt: at(TODAY, 20, 10) }),
        code: "event_clash",
      },
      {
        what: "less than 15 minutes before another starts",
        actor: "ada",
        command: schedule({ startsAt: at(TODAY, 18), minutes: 50 }),
        code: "event_clash",
      },
      {
        what: "a third event on the calendar",
        setup: (state) => ok(act(state, "ada", schedule({ startsAt: at(TODAY + 2, 19) }))),
        actor: "ada",
        command: schedule({ startsAt: at(TODAY + 4, 19) }),
        code: "event_limit",
      },
      {
        what: "a second Commons event within 7 days",
        actor: "dee",
        command: schedule({ ...COMMONS, startsAt: at(TODAY + 7, 18) }),
        code: "event_limit",
      },
      {
        what: "a Commons booking without the deposit",
        setup: (state) =>
          ok(
            act(state, "bob", { type: "give_coins", to: "cy", amount: coinsOf(state, "bob") - 9 }),
          ),
        actor: "bob",
        command: schedule({ ...COMMONS, startsAt: at(TODAY, 21) }),
        code: "not_enough_coins",
      },
      {
        what: "a Commons booking before coins open",
        noCoins: true,
        actor: "bob",
        command: schedule({ ...COMMONS }),
        code: "economy_closed",
      },
      {
        what: "the server's own input",
        actor: "ada",
        command: { type: "event_start", event: "e_1" },
        code: "server_only",
      },
    ];
    for (const c of cases) {
      // Ada has tonight's session; with coins, Dee has the Commons booked tomorrow evening.
      const state = world({ coins: !c.noCoins });
      ok(act(state, "ada", schedule()));
      if (!c.noCoins) ok(act(state, "dee", schedule({ ...COMMONS, startsAt: at(TODAY + 1, 18) })));
      c.setup?.(state);
      const before = hashWorld(state);
      expect(code(act(state, c.actor, c.command)), c.what).toBe(c.code);
      expect(hashWorld(state), c.what).toBe(before);
    }
  });

  it("accepts the edges of each rule", () => {
    const state = world();
    ok(act(state, "ada", schedule()));
    // 15 minutes after another ends, and 14 days ahead.
    ok(act(state, "ada", schedule({ startsAt: at(TODAY, 20, 15), minutes: 15 })));
    ok(act(state, "bob", schedule({ px: 2, startsAt: at(TODAY + 14, 23, 59), minutes: 180 })));
    // A Commons event a week after another, once one of Dee's is off the calendar.
    ok(act(state, "dee", schedule({ ...COMMONS, startsAt: at(TODAY, 21) })));
    ok(act(state, "dee", schedule({ ...COMMONS, startsAt: at(TODAY + 7, 21) })));
    expectSupplyHolds(state);
  });
});

describe("an event's life", () => {
  it("starts on its day, samples who's online in its area, and settles who attended", () => {
    const state = world();
    ok(act(state, "ada", schedule()));
    ok(act(state, "bob", schedule({ px: 2, startsAt: at(TODAY + 1, 19) })));
    expect(code(town(state, { type: "event_start", event: "e_2" }))).toBe("not_due");
    for (const command of [
      { type: "event_tick", event: "e_1", slot: 1 },
      { type: "event_end", event: "e_1" },
    ] as const) {
      expect(code(town(state, command))).toBe("event_not_live");
    }
    expect(code(act(state, "bob", { type: "join_event", event: "e_1" }))).toBe("event_not_live");
    expect(code(act(state, "bob", { type: "join_event", event: "e_9" }))).toBe("unknown_event");

    expect(ok(town(state, { type: "event_start", event: "e_1" }))).toEqual([
      { type: "event_started", event: "e_1" },
    ]);
    expect(code(town(state, { type: "event_start", event: "e_1" }))).toBe("event_closed");
    // Bob and Cy come over in one step each; Ada, the host, is home; Dee stays on her plot.
    const moved = ok(act(state, "bob", { type: "join_event", event: "e_1" }));
    expect(moved).toEqual([{ type: "moved", residentId: "bob", x: 2, y: 2 }]);
    ok(act(state, "cy", { type: "join_event", event: "e_1" }));
    // A 60-minute event has eleven marks; attending needs 4 of 11 samples.
    sample(state, "e_1", 1, 4);
    ok(act(state, "cy", { type: "leave" }));
    sample(state, "e_1", 5, 8);
    ok(act(state, "dee", { type: "join_event", event: "e_1" }));
    sample(state, "e_1", 9, 11);
    expect(code(town(state, { type: "event_tick", event: "e_1", slot: 11 }))).toBe("not_due");
    expect(code(town(state, { type: "event_tick", event: "e_1", slot: 12 }))).toBe("not_due");

    const ended = ok(town(state, { type: "event_end", event: "e_1" }));
    // Cy was there for 4 samples, Dee for 3, and the host doesn't count.
    expect(ended).toEqual([{ type: "event_ended", event: "e_1", attended: ["bob", "cy"] }]);
    expect(findEvent(state, "e_1")).toMatchObject({ status: "ended", ticks: 11 });
    expect(findEvent(state, "e_1")?.seen).toBeUndefined();
    for (const command of [
      { type: "event_tick", event: "e_1", slot: 11 },
      { type: "event_end", event: "e_1" },
    ] as const) {
      expect(code(town(state, command))).toBe("event_not_live");
    }
    expect(code(act(state, "bob", { type: "join_event", event: "e_1" }))).toBe("event_not_live");
    expect(code(town(state, { type: "event_start", event: "e_1" }))).toBe("event_closed");
    expectSupplyHolds(state);
  });

  it("asks for both samples of a short event, and an hour of a long town event", () => {
    const state = world();
    ok(act(state, "ada", schedule({ minutes: 15 })));
    ok(town(state, { type: "event_start", event: "e_1" }));
    ok(act(state, "bob", { type: "join_event", event: "e_1" }));
    ok(act(state, "cy", { type: "join_event", event: "e_1" }));
    sample(state, "e_1", 1, 1);
    ok(act(state, "cy", { type: "leave" }));
    sample(state, "e_1", 2, 2);
    expect(code(town(state, { type: "event_tick", event: "e_1", slot: 3 }))).toBe("not_due");
    expect(ok(town(state, { type: "event_end", event: "e_1" }))).toMatchObject([
      { attended: ["bob"] },
    ]);

    // Nine hours, sampled 40 times: Bob stays 12 samples, Cy 11.
    ok(
      town(state, {
        type: "schedule_town_event",
        key: "harvest-night",
        kind: "gathering",
        title: "Harvest night",
        startsAt: at(TODAY, 18),
        minutes: 540,
      }),
    );
    ok(town(state, { type: "event_start", event: "e_2" }));
    ok(act(state, "cy", { type: "join", name: "cy", kind: "human" }));
    ok(act(state, "bob", { type: "join_event", event: "e_2" }));
    ok(act(state, "cy", { type: "join_event", event: "e_2" }));
    sample(state, "e_2", 1, 11);
    ok(act(state, "cy", { type: "leave" }));
    sample(state, "e_2", 12, 12);
    ok(act(state, "bob", { type: "home" }));
    sample(state, "e_2", 13, 40);
    expect(ok(town(state, { type: "event_end", event: "e_2" }))).toMatchObject([
      { attended: ["bob"] },
    ]);
  });

  it("gives a Commons deposit back when 3 come from outside the host's household, and burns it otherwise", () => {
    const run = (pairs: [string, string][]) => {
      const state = world();
      if (pairs.length > 0) ok(town(state, { type: "set_owner_pairs", pairs }));
      ok(act(state, "dee", schedule({ ...COMMONS })));
      ok(town(state, { type: "event_start", event: "e_1" }));
      for (const id of ["ada", "bob", "cy"])
        ok(act(state, id, { type: "join_event", event: "e_1" }));
      sample(state, "e_1", 1, 11);
      const burned = state.economy?.burned ?? 0;
      const ended = ok(town(state, { type: "event_end", event: "e_1" }));
      expectSupplyHolds(state);
      return { state, ended, burned: (state.economy?.burned ?? 0) - burned };
    };

    const back = run([]);
    expect(back.ended).toEqual([
      { type: "event_ended", event: "e_1", attended: ["ada", "bob", "cy"], deposit: "refunded" },
      { type: "coins", residentId: "dee", amount: 10, balance: 60, reason: "event_refund" },
    ]);
    expect(back.burned).toBe(0);
    expect(eventHeld(back.state)).toBe(0);

    // Cy is Dee's own AI, so only two guests came from outside her household.
    const gone = run([["cy", "dee"]]);
    expect(gone.ended).toEqual([
      { type: "event_ended", event: "e_1", attended: ["ada", "bob", "cy"], deposit: "burned" },
    ]);
    expect(gone.burned).toBe(10);
    expect(coinsOf(gone.state, "dee")).toBe(50);
  });

  it("lets its host call it off before it starts: the deposit back before its day, burned on it", () => {
    const state = world();
    ok(act(state, "dee", schedule({ ...COMMONS, startsAt: at(TODAY + 1, 18) })));
    expect(code(act(state, "ada", { type: "cancel_event", event: "e_1" }))).toBe("not_your_event");
    expect(ok(act(state, "dee", { type: "cancel_event", event: "e_1" }))).toEqual([
      { type: "event_cancelled", event: "e_1", deposit: "refunded" },
      { type: "coins", residentId: "dee", amount: 10, balance: 60, reason: "event_refund" },
    ]);
    expect(code(act(state, "dee", { type: "cancel_event", event: "e_1" }))).toBe("event_closed");

    ok(act(state, "dee", schedule({ ...COMMONS, startsAt: at(TODAY, 22) })));
    expect(ok(act(state, "dee", { type: "cancel_event", event: "e_2" }))).toEqual([
      { type: "event_cancelled", event: "e_2", deposit: "burned" },
    ]);
    expect(coinsOf(state, "dee")).toBe(50);

    ok(act(state, "ada", schedule()));
    ok(town(state, { type: "event_start", event: "e_3" }));
    expect(code(act(state, "ada", { type: "cancel_event", event: "e_3" }))).toBe("event_closed");
    expectSupplyHolds(state);
  });

  it("lets a maintainer call off any event that hasn't ended, with the deposit back", () => {
    const state = world();
    ok(act(state, "dee", schedule({ ...COMMONS })));
    ok(town(state, { type: "event_start", event: "e_1" }));
    expect(code(town(state, { type: "void_event", event: "e_1", by: "" }))).toBe("server_only");
    expect(ok(town(state, { type: "void_event", event: "e_1", by: "staff_0123456789ab" }))).toEqual(
      [
        { type: "event_cancelled", event: "e_1", deposit: "refunded" },
        { type: "coins", residentId: "dee", amount: 10, balance: 60, reason: "event_refund" },
      ],
    );
    expect(findEvent(state, "e_1")).toMatchObject({
      status: "cancelled",
      voidedBy: "staff_0123456789ab",
    });
    expect(code(town(state, { type: "void_event", event: "e_1", by: "staff_0123456789ab" }))).toBe(
      "event_closed",
    );
    expectSupplyHolds(state);
  });

  it("calls off the events on a plot its host lets go of", () => {
    const state = world();
    ok(act(state, "eve", schedule({ px: 1, py: 0 })));
    ok(act(state, "ada", { type: "share_plot", with: "bob" }));
    ok(act(state, "bob", schedule({ startsAt: at(TODAY, 21) })));
    ok(act(state, "ada", schedule()));
    expect(ok(act(state, "eve", { type: "release" }))).toContainEqual({
      type: "event_cancelled",
      event: "e_1",
    });
    // Unsharing calls off Bob's event there, and leaves Ada's.
    expect(ok(act(state, "ada", { type: "unshare_plot", with: "bob" }))).toContainEqual({
      type: "event_cancelled",
      event: "e_2",
    });
    expect(findEvent(state, "e_3")?.status).toBe("scheduled");
  });
});

describe("join_event", () => {
  it("refuses someone already there, and leaves someone coming back online where they stand", () => {
    const state = world();
    ok(town(state, { type: "implicit_presence" }));
    ok(act(state, "ada", schedule()));
    ok(town(state, { type: "event_start", event: "e_1" }));
    ok(act(state, "bob", { type: "join_event", event: "e_1" }));
    const there = state.residents.bob;
    expect(code(act(state, "bob", { type: "join_event", event: "e_1" }))).toBe("already_joined");
    ok(town(state, { type: "leave_idle", ids: ["bob"] }));
    const back = ok(act(state, "bob", { type: "join_event", event: "e_1" }));
    expect(back).toMatchObject([
      { type: "joined", resident: { id: "bob", x: there?.x, y: there?.y } },
    ]);
    expect(back).toHaveLength(1);
    expect(state.residents.bob).toMatchObject({ online: true, x: there?.x, y: there?.y });
  });
});

describe("town events", () => {
  const harvest = (fields: Partial<Extract<Command, { type: "schedule_town_event" }>> = {}) =>
    ({
      type: "schedule_town_event",
      key: "harvest-night",
      kind: "gathering",
      title: "Harvest night",
      startsAt: at(TODAY, 18),
      minutes: 540,
      ...fields,
    }) satisfies Command;

  it("go in the Commons once per key, with no deposit, townsfolk faces, and up to 12 hours", () => {
    const state = world();
    ok(town(state, { type: "set_townsfolk", ids: ["cy"] }));
    const treasury = state.economy?.treasury;
    expect(code(act(state, "ada", harvest()))).toBe("server_only");
    expect(code(town(state, harvest({ faces: ["ada"] })))).toBe("invalid_event");
    expect(code(town(state, harvest({ key: "Harvest Night" })))).toBe("invalid_event");
    expect(code(town(state, harvest({ minutes: 721 })))).toBe("invalid_event");
    expect(ok(town(state, harvest({ faces: ["cy"] })))).toEqual([
      {
        type: "event_scheduled",
        event: "e_1",
        host: TOWN_ACTOR,
        kind: "gathering",
        px: 1,
        py: 1,
        startsAt: at(TODAY, 18),
        minutes: 540,
        town: true,
      },
    ]);
    expect(findEvent(state, "e_1")).toMatchObject({ faces: ["cy"], key: "harvest-night" });
    expect(findEvent(state, "e_1")?.deposit).toBeUndefined();
    expect(state.economy?.treasury).toBe(treasury);
    expect(code(town(state, harvest({ startsAt: at(TODAY + 1, 18) })))).toBe("already_set");
    // The Commons is the town's that evening.
    expect(code(act(state, "dee", schedule({ ...COMMONS, startsAt: at(TODAY, 22) })))).toBe(
      "event_clash",
    );
    expectSupplyHolds(state);
  });

  it("can't take the Commons from a resident who booked it first", () => {
    const state = world();
    ok(act(state, "dee", schedule({ ...COMMONS, startsAt: at(TODAY, 20) })));
    expect(code(town(state, harvest()))).toBe("event_clash");
  });
});

describe("finished events", () => {
  it("leave the world 30 days after their day", () => {
    const state = world();
    ok(act(state, "ada", schedule()));
    ok(town(state, { type: "event_start", event: "e_1" }));
    ok(town(state, { type: "event_end", event: "e_1" }));
    ok(act(state, "bob", schedule({ px: 2, startsAt: at(TODAY + 1, 19) })));
    ok(act(state, "bob", { type: "cancel_event", event: "e_2" }));
    ok(town(state, { type: "new_day", day: TODAY + 30 }));
    expect(state.events?.list.map((e) => e.id)).toEqual(["e_1", "e_2"]);
    ok(town(state, { type: "new_day", day: TODAY + 31 }));
    expect(state.events?.list.map((e) => e.id)).toEqual(["e_2"]);
    ok(town(state, { type: "new_day", day: TODAY + 32 }));
    expect(state.events?.list).toEqual([]);
    expect(state.events?.nextId).toBe(3);
  });
});

describe("the events fixture", () => {
  it("replays to its pinned hash with the coins adding up", () => {
    const state = replay(EVENTS_CONFIG, EVENTS_LOG);
    expect(hashWorld(state)).toBe(EVENTS_HASH);
    expectSupplyHolds(state);
    expect(findEvent(state, "e_1")).toMatchObject({
      status: "ended",
      attended: ["ada", "bob", "clem"],
    });
    expect(findEvent(state, "e_4")).toMatchObject({ host: TOWN_ACTOR, status: "ended" });
  });
});
