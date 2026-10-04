import { describe, expect, it } from "vitest";
import { apply } from "./apply";
import { PRE_TOWN_CONFIG, PRE_TOWN_HASH, PRE_TOWN_LOG } from "./fixtures/pre-town-log";
import { hashWorld } from "./hash";
import { replay } from "./replay";
import { electorate, quorum, TOWN_LIMITS, townEligibility, votesCast } from "./town";
import { type Command, type Input, type PlannedBlock, TOWN_ACTOR, type WorldConfig } from "./types";
import { createWorld, townHallTiles } from "./world";

// 3x3 plots of 8 tiles. The Commons is plot (1,1), tiles 8..15; spawn is (12,12). The Town Hall
// stands on (11..13, 8..9).
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

/** A world, its log, and helpers that keep the log in step, so any test can replay it. */
function world(config = CONFIG) {
  const state = createWorld(config);
  const log: Input[] = [];
  const send = (actor: string, command: Command) => {
    const result = apply(state, { actor, command });
    if (result.ok) log.push({ actor, command });
    return result;
  };
  const ok = (actor: string, command: Command) => {
    const result = send(actor, command);
    expect(result, `${actor} ${JSON.stringify(command)}`).toMatchObject({ ok: true });
    return result.ok ? result.events : [];
  };
  const code = (actor: string, command: Command) => {
    const before = hashWorld(state);
    const result = send(actor, command);
    // A rejection never changes anything.
    if (!result.ok) expect(hashWorld(state)).toBe(before);
    return result.ok ? null : result.rejection.code;
  };
  const day = (d: number) => ok(TOWN_ACTOR, { type: "new_day", day: d });
  /** Join, settle the nth plot, and build a starter home (which sets a hearth). */
  const settle = (name: string, n: number) => {
    const [px, py] = PLOTS[n] ?? [0, 0];
    ok(name, { type: "join", name, kind: "human" });
    ok(name, { type: "settle", px, py });
    ok(name, { type: "build_starter_home" });
  };
  const propose = (actor: string, extra: Partial<Extract<Command, { type: "propose" }>> = {}) =>
    send(actor, { type: "propose", kind: "advisory", title: "More benches", text: "", ...extra });
  const vote = (actor: string, proposal: string, choice: "yes" | "no" | "abstain") =>
    send(actor, { type: "vote", proposal, choice });
  const close = (proposal: string) => send(TOWN_ACTOR, { type: "close_proposal", proposal });
  const proposal = (id: string) => state.town?.proposals.find((p) => p.id === id);
  return { state, log, send, ok, code, day, settle, propose, vote, close, proposal };
}

/** Residents settled on day DAY, and the world moved on to the day they become eligible. */
function town(...names: string[]) {
  const w = world();
  w.day(DAY);
  names.forEach((name, i) => {
    w.settle(name, i);
  });
  w.day(DAY + TOWN_LIMITS.eligibleAfterDays);
  return w;
}

const fountain: PlannedBlock[] = [
  { x: 9, y: 13, block: "glass" },
  { x: 10, y: 13, block: "glass" },
  { x: 9, y: 14, block: "stone" },
];

describe("old logs", () => {
  it("replay to the hash they had before the Town Hall", () => {
    expect(hashWorld(replay(PRE_TOWN_CONFIG, PRE_TOWN_LOG))).toBe(PRE_TOWN_HASH);
  });

  it("leave no Town Hall fields behind until the first new_day", () => {
    const state = replay(PRE_TOWN_CONFIG, PRE_TOWN_LOG);
    expect(state.day).toBeUndefined();
    expect(state.lastActiveDay).toBeUndefined();
    expect(state.town).toBeUndefined();
    for (const plot of Object.values(state.plots)) expect(plot.claimedDay).toBeUndefined();
  });

  it("make plots from before day counting eligible right away once days start", () => {
    const log: Input[] = [
      ...PRE_TOWN_LOG,
      { actor: TOWN_ACTOR, command: { type: "new_day", day: DAY } },
    ];
    const state = replay(PRE_TOWN_CONFIG, log);
    expect(hashWorld(state)).not.toBe(PRE_TOWN_HASH);
    // Ada has a plot from before (day 0) and a hearth, but hasn't acted since days began.
    expect(townEligibility(state, "ada")).toMatchObject({ reason: "inactive" });
    expect(apply(state, { actor: "ada", command: { type: "move", dir: "e" } }).ok).toBe(true);
    expect(townEligibility(state, "ada")).toEqual({ eligible: true });
  });
});

describe("new_day", () => {
  it("only comes from the server, and only moves forward", () => {
    const w = world();
    w.ok("ada", { type: "join", name: "Ada", kind: "human" });
    expect(w.code("ada", { type: "new_day", day: DAY })).toBe("server_only");
    expect(w.day(DAY)).toEqual([{ type: "day_started", day: DAY }]);
    expect(w.state.day).toBe(DAY);
    expect(w.code(TOWN_ACTOR, { type: "new_day", day: DAY })).toBe("not_due");
    expect(w.code(TOWN_ACTOR, { type: "new_day", day: DAY - 1 })).toBe("not_due");
    expect(w.code(TOWN_ACTOR, { type: "new_day", day: 1.5 })).toBe("not_due");
    // Missed days are fine: the server sends today, not every day in between.
    w.day(DAY + 5);
    expect(w.state.day).toBe(DAY + 5);
  });

  it("stamps claims and shares, and records activity, only once days are counted", () => {
    const w = world();
    w.ok("ada", { type: "join", name: "Ada", kind: "human" });
    w.ok("bob", { type: "join", name: "Bob", kind: "human" });
    w.ok("ada", { type: "settle", px: 0, py: 0 });
    expect(w.state.plots["0,0"]).toEqual({ px: 0, py: 0, ownerId: "ada" });
    expect(w.state.lastActiveDay).toBeUndefined();

    w.day(DAY);
    w.ok("bob", { type: "settle", px: 2, py: 0 });
    expect(w.state.plots["2,0"]?.claimedDay).toBe(DAY);
    expect(w.state.lastActiveDay).toEqual({ bob: DAY });
    w.ok("ada", { type: "share_plot", with: "bob" });
    expect(w.state.plots["0,0"]?.sharedDay).toEqual({ bob: DAY });
    w.ok("ada", { type: "unshare_plot", with: "bob" });
    expect(w.state.plots["0,0"]).toEqual({ px: 0, py: 0, ownerId: "ada" });

    // Joining and leaving aren't activity: any API call does those.
    w.ok("cy", { type: "join", name: "Cy", kind: "agent" });
    w.ok("cy", { type: "leave" });
    expect(w.state.lastActiveDay?.cy).toBeUndefined();
  });
});

describe("set_townsfolk", () => {
  it("only comes from the server, stores a sorted list, and clears to nothing", () => {
    const w = world();
    w.ok("ada", { type: "join", name: "Ada", kind: "human" });
    expect(w.code("ada", { type: "set_townsfolk", ids: ["ada"] })).toBe("server_only");
    expect(w.ok(TOWN_ACTOR, { type: "set_townsfolk", ids: ["r_b", "r_a", "r_b"] })).toEqual([
      { type: "townsfolk_set", ids: ["r_a", "r_b"] },
    ]);
    expect(w.state.townsfolk).toEqual(["r_a", "r_b"]);
    w.ok(TOWN_ACTOR, { type: "set_townsfolk", ids: [] });
    expect(w.state.townsfolk).toBeUndefined();
  });
});

describe("eligibility", () => {
  it("needs the world to count days", () => {
    const w = world();
    w.settle("ada", 0);
    expect(townEligibility(w.state, "ada")).toMatchObject({ reason: "no_days_yet" });
    expect(w.propose("ada")).toMatchObject({ ok: false, rejection: { code: "not_eligible" } });
  });

  it("needs a plot held for three days, counted from the day it was claimed", () => {
    const w = world();
    w.day(DAY);
    w.settle("ada", 0);
    w.day(DAY + 2);
    w.ok("ada", { type: "move", dir: "n" });
    const early = townEligibility(w.state, "ada");
    expect(early).toMatchObject({ eligible: false, reason: "plot_too_new" });
    expect(early.eligible ? "" : early.message).toContain("1 day from now");
    w.day(DAY + 3);
    expect(townEligibility(w.state, "ada")).toEqual({ eligible: true });
  });

  it("follows the world's townEligibleAfterDays dial", () => {
    const w = world({ ...CONFIG, townEligibleAfterDays: 0 });
    w.day(DAY);
    w.settle("ada", 0);
    expect(townEligibility(w.state, "ada")).toEqual({ eligible: true });
  });

  it("counts a co-owner from the day the share started, not the plot's claim", () => {
    const w = town("ada");
    w.ok("bob", { type: "join", name: "Bob", kind: "human" });
    expect(townEligibility(w.state, "bob")).toMatchObject({ reason: "no_plot" });
    w.ok("ada", { type: "share_plot", with: "bob" });
    w.ok("bob", { type: "build_starter_home" });
    expect(townEligibility(w.state, "bob")).toMatchObject({ reason: "plot_too_new" });
    w.day(DAY + 6);
    w.ok("bob", { type: "move", dir: "s" });
    expect(townEligibility(w.state, "bob")).toEqual({ eligible: true });
  });

  it("needs a hearth", () => {
    const w = world();
    w.day(DAY);
    w.ok("ada", { type: "join", name: "Ada", kind: "human" });
    w.ok("ada", { type: "settle", px: 0, py: 0 });
    w.day(DAY + 3);
    w.ok("ada", { type: "move", dir: "n" });
    expect(townEligibility(w.state, "ada")).toMatchObject({ reason: "no_hearth" });
  });

  it("needs an action in the last seven days", () => {
    const w = town("ada"); // Ada last acted on DAY.
    w.day(DAY + 6);
    expect(townEligibility(w.state, "ada")).toEqual({ eligible: true });
    w.day(DAY + 7);
    expect(townEligibility(w.state, "ada")).toMatchObject({ reason: "inactive" });
    w.ok("ada", { type: "move", dir: "n" });
    expect(townEligibility(w.state, "ada")).toEqual({ eligible: true });
  });

  it("never includes townsfolk", () => {
    const w = town("ada", "npc");
    w.ok(TOWN_ACTOR, { type: "set_townsfolk", ids: ["npc"] });
    expect(townEligibility(w.state, "npc")).toMatchObject({ reason: "townsfolk" });
    expect(electorate(w.state)).toEqual(["ada"]);
    expect(w.propose("npc")).toMatchObject({ ok: false, rejection: { code: "not_eligible" } });
    expect(townEligibility(w.state, "nobody")).toMatchObject({ reason: "not_resident" });
  });
});

describe("quorum", () => {
  it("is at least three, or ten percent of the electorate rounded up", () => {
    expect([0, 1, 3, 29, 30, 31, 100, 101].map(quorum)).toEqual([3, 3, 3, 3, 3, 4, 10, 11]);
  });
});

describe("propose", () => {
  it("opens an advisory at once with a snapshot of who may vote", () => {
    const w = town("ada", "bob", "cy");
    const result = w.propose("ada", { title: "  More benches  ", text: "By the well." });
    expect(result).toEqual({
      ok: true,
      seq: expect.any(Number),
      events: [
        {
          type: "proposal_opened",
          proposal: "t_1",
          author: "ada",
          kind: "advisory",
          closesDay: DAY + 3 + TOWN_LIMITS.openDays,
          electorate: 3,
          quorum: 3,
        },
      ],
    });
    expect(w.proposal("t_1")).toMatchObject({
      title: "More benches",
      text: "By the well.",
      status: "open",
      filedDay: DAY + 3,
      openedDay: DAY + 3,
      electorate: ["ada", "bob", "cy"],
      votes: {},
    });
  });

  it("keeps the electorate fixed: someone who qualifies later can't vote", () => {
    const w = world();
    w.day(DAY);
    w.settle("ada", 0);
    w.day(DAY + 1);
    w.settle("late", 1);
    w.day(DAY + 3);
    w.ok("ada", { type: "move", dir: "n" });
    w.propose("ada");
    w.day(DAY + 4);
    w.ok("late", { type: "move", dir: "n" });
    expect(townEligibility(w.state, "late")).toEqual({ eligible: true });
    expect(w.vote("late", "t_1", "yes")).toMatchObject({
      ok: false,
      rejection: { code: "not_eligible" },
    });
  });

  it("checks titles, texts, and kinds", () => {
    const w = town("ada");
    const code = (extra: Partial<Extract<Command, { type: "propose" }>>) =>
      w.code("ada", { type: "propose", kind: "advisory", title: "t", text: "", ...extra });
    expect(code({ title: "   " })).toBe("invalid_proposal");
    expect(code({ title: "x".repeat(81) })).toBe("invalid_proposal");
    expect(code({ text: "x".repeat(1001) })).toBe("invalid_proposal");
    expect(code({ kind: "rule" as never })).toBe("invalid_proposal");
    expect(code({ blocks: fountain })).toBe("invalid_proposal");
    expect(code({ title: "x".repeat(80), text: "x".repeat(1000) })).toBeNull();
  });

  it("checks a build against the Commons as it is when filed", () => {
    const w = town("ada", "bob");
    // Bob stands on (9,13), a tile in the plan. (Set directly: walking there isn't the point.)
    const bob = w.state.residents.bob;
    if (!bob) throw new Error("no bob");
    bob.x = 9;
    bob.y = 13;
    const code = (blocks: PlannedBlock[], remove?: { x: number; y: number }[]) =>
      w.code("ada", {
        type: "propose",
        kind: "commons_build",
        title: "A fountain",
        text: "",
        blocks,
        ...(remove ? { remove } : {}),
      });
    const [hall] = townHallTiles(CONFIG);
    expect(code([])).toBe("invalid_proposal");
    expect(code([{ x: 3, y: 3, block: "wood" }])).toBe("invalid_proposal"); // Ada's plot
    expect(code([{ x: 30, y: 3, block: "wood" }])).toBe("invalid_proposal"); // off the world
    expect(code([{ x: hall?.x ?? 0, y: hall?.y ?? 0, block: "wood" }])).toBe("invalid_proposal");
    expect(code(fountain)).toBe("invalid_proposal"); // Bob is on (9,13)
    expect(code([fountain[1] as PlannedBlock, fountain[1] as PlannedBlock])).toBe(
      "invalid_proposal",
    );
    expect(code([{ x: 10, y: 10, block: "gold" as never }])).toBe("invalid_proposal");
    expect(code([], [{ x: 10, y: 10 }])).toBe("invalid_proposal"); // nothing to take away
    const many = Array.from({ length: 41 }, (_, i) => ({
      x: 8 + (i % 8),
      y: 10 + Math.floor(i / 8),
      block: "leaf" as const,
    }));
    expect(code(many)).toBe("invalid_proposal");
    expect(code(many.slice(0, 40).filter((b) => !(b.x === 9 && b.y === 13)))).toBeNull();
  });

  it("allows one open or queued proposal per resident, and one new one a week", () => {
    const w = town("ada", "bob", "cy");
    expect(w.propose("ada").ok).toBe(true);
    expect(w.propose("ada")).toMatchObject({ ok: false, rejection: { code: "proposal_limit" } });
    w.ok("ada", { type: "withdraw", proposal: "t_1" });
    const again = w.propose("ada");
    expect(again).toMatchObject({ ok: false, rejection: { code: "proposal_limit" } });
    expect(again.ok ? "" : again.rejection.message).toContain("in 7 days");
    w.day(DAY + 3 + 6);
    w.ok("ada", { type: "move", dir: "n" });
    expect(w.propose("ada")).toMatchObject({ ok: false, rejection: { code: "proposal_limit" } });
    w.day(DAY + 3 + 7);
    expect(w.propose("ada").ok).toBe(true);
  });

  it("queues past five open proposals and opens the oldest as slots free up", () => {
    const names = ["a", "b", "c", "d", "e", "f", "g"];
    const w = town(...names);
    for (const name of names.slice(0, 5)) expect(w.propose(name).ok).toBe(true);
    expect(w.propose("f")).toMatchObject({
      ok: true,
      events: [{ type: "proposal_queued", proposal: "t_6", author: "f", kind: "advisory" }],
    });
    w.propose("g");
    expect(w.proposal("t_6")?.status).toBe("queued");
    expect(w.vote("a", "t_6", "yes")).toMatchObject({
      ok: false,
      rejection: { code: "proposal_not_open" },
    });
    // Withdrawing a queued one frees no slot.
    w.ok("g", { type: "withdraw", proposal: "t_7" });
    // Withdrawing an open one opens the oldest queued one, with today's electorate.
    w.day(DAY + 4);
    const events = w.ok("a", { type: "withdraw", proposal: "t_1" });
    expect(events).toEqual([
      { type: "proposal_closed", proposal: "t_1", status: "withdrawn", yes: 0, no: 0, abstain: 0 },
      expect.objectContaining({ type: "proposal_opened", proposal: "t_6", closesDay: DAY + 6 }),
    ]);
    expect(w.proposal("t_6")).toMatchObject({ status: "open", openedDay: DAY + 4 });
  });
});

describe("vote", () => {
  it("records a choice, lets it change, and refuses the same choice twice", () => {
    const w = town("ada", "bob");
    w.propose("ada");
    expect(w.vote("bob", "t_1", "no")).toMatchObject({
      ok: true,
      events: [
        {
          type: "vote_cast",
          proposal: "t_1",
          residentId: "bob",
          choice: "no",
          yes: 0,
          no: 1,
          abstain: 0,
        },
      ],
    });
    expect(w.vote("bob", "t_1", "no")).toMatchObject({
      ok: false,
      rejection: { code: "already_voted" },
    });
    expect(w.vote("bob", "t_1", "yes")).toMatchObject({
      ok: true,
      events: [{ yes: 1, no: 0 }],
    });
    expect(w.vote("bob", "t_9", "yes")).toMatchObject({
      ok: false,
      rejection: { code: "unknown_proposal" },
    });
    expect(w.vote("eve", "t_1", "yes")).toMatchObject({
      ok: false,
      rejection: { code: "not_joined" },
    });
    expect(votesCast(w.state, "bob")).toBe(1);
    expect(votesCast(w.state, "ada")).toBe(0);
  });

  it("refuses townsfolk even when they were in the snapshot", () => {
    const w = town("ada", "npc");
    w.propose("ada");
    w.ok(TOWN_ACTOR, { type: "set_townsfolk", ids: ["npc"] });
    expect(w.vote("npc", "t_1", "yes")).toMatchObject({
      ok: false,
      rejection: { code: "not_eligible" },
    });
  });
});

describe("withdraw", () => {
  it("is for the author, while the proposal is open or queued", () => {
    const w = town("ada", "bob");
    w.propose("ada");
    expect(w.code("bob", { type: "withdraw", proposal: "t_1" })).toBe("not_your_proposal");
    expect(w.code("bob", { type: "withdraw", proposal: "t_2" })).toBe("unknown_proposal");
    w.ok("ada", { type: "withdraw", proposal: "t_1" });
    expect(w.proposal("t_1")).toMatchObject({ status: "withdrawn", closedDay: DAY + 3 });
    expect(w.code("ada", { type: "withdraw", proposal: "t_1" })).toBe("proposal_not_open");
  });
});

describe("close_proposal", () => {
  function voted(choices: Record<string, "yes" | "no" | "abstain">) {
    const w = town("ada", "bob", "cy", "di");
    w.propose("ada");
    for (const [who, choice] of Object.entries(choices)) w.vote(who, "t_1", choice);
    w.day(DAY + 5);
    return w;
  }

  it("only comes from the server, and not before the closing day", () => {
    const w = town("ada", "bob", "cy");
    w.propose("ada");
    expect(w.code("ada", { type: "close_proposal", proposal: "t_1" })).toBe("server_only");
    expect(w.close("t_1")).toMatchObject({ ok: false, rejection: { code: "not_due" } });
    w.day(DAY + 4);
    expect(w.close("t_1")).toMatchObject({ ok: false, rejection: { code: "not_due" } });
    expect(w.close("t_9")).toMatchObject({ ok: false, rejection: { code: "unknown_proposal" } });
    w.day(DAY + 5);
    expect(w.close("t_1").ok).toBe(true);
    expect(w.close("t_1")).toMatchObject({ ok: false, rejection: { code: "proposal_not_open" } });
  });

  it("passes with quorum and more yes than no", () => {
    const w = voted({ ada: "yes", bob: "yes", cy: "no", di: "abstain" });
    expect(w.close("t_1")).toMatchObject({
      ok: true,
      events: [
        { type: "proposal_closed", proposal: "t_1", status: "passed", yes: 2, no: 1, abstain: 1 },
      ],
    });
    expect(w.proposal("t_1")).toMatchObject({ status: "passed", closedDay: DAY + 5 });
  });

  it("fails on a tie or more no than yes", () => {
    expect(voted({ ada: "yes", bob: "no", cy: "no" }).close("t_1")).toMatchObject({
      events: [{ status: "failed" }],
    });
    expect(voted({ ada: "yes", bob: "no", cy: "yes", di: "no" }).close("t_1")).toMatchObject({
      events: [{ status: "failed" }],
    });
  });

  it("expires without quorum: abstentions don't count toward it", () => {
    expect(voted({ ada: "yes", bob: "yes", cy: "abstain" }).close("t_1")).toMatchObject({
      events: [{ status: "no_quorum", yes: 2, abstain: 1 }],
    });
  });

  it("builds a passed commons_build, skipping tiles taken since it was filed", () => {
    const w = town("ada", "bob", "cy");
    const plan = [...fountain, { x: 10, y: 14, block: "leaf" as const }];
    w.propose("ada", { kind: "commons_build", title: "A fountain", blocks: plan });
    for (const who of ["ada", "bob", "cy"]) w.vote(who, "t_1", "yes");
    // Cy walks home and stands on (10,14) by closing time.
    const cy = w.state.residents.cy;
    if (!cy) throw new Error("no cy");
    cy.x = 10;
    cy.y = 14;
    w.day(DAY + 5);
    const result = w.close("t_1");
    expect(result).toMatchObject({ ok: true });
    expect(result.ok && result.events).toEqual([
      { type: "proposal_closed", proposal: "t_1", status: "passed", yes: 3, no: 0, abstain: 0 },
      { type: "block_placed", x: 9, y: 13, block: "glass", by: "t_1" },
      { type: "block_placed", x: 10, y: 13, block: "glass", by: "t_1" },
      { type: "block_placed", x: 9, y: 14, block: "stone", by: "t_1" },
      {
        type: "town_built",
        proposal: "t_1",
        placed: fountain,
        removed: [],
        skipped: [{ x: 10, y: 14 }],
      },
    ]);
    expect(w.state.blocks["9,13"]).toBe("glass");
    expect(w.state.blocks["10,14"]).toBeUndefined();
    expect(w.state.town?.built).toEqual({ "9,13": "t_1", "10,13": "t_1", "9,14": "t_1" });
  });

  it("skips tiles another passed build took, and a later build can take blocks away", () => {
    const w = town("ada", "bob", "cy");
    w.propose("ada", { kind: "commons_build", title: "A fountain", blocks: fountain });
    w.propose("bob", {
      kind: "commons_build",
      title: "A pond",
      blocks: [fountain[0] as PlannedBlock],
    });
    for (const who of ["ada", "bob", "cy"]) {
      w.vote(who, "t_1", "yes");
      w.vote(who, "t_2", "yes");
    }
    w.day(DAY + 5);
    w.close("t_1");
    expect(w.close("t_2")).toMatchObject({
      events: [
        { status: "passed" },
        { type: "town_built", placed: [], skipped: [{ x: 9, y: 13 }] },
      ],
    });

    w.day(DAY + 10);
    for (const who of ["ada", "bob", "cy"]) w.ok(who, { type: "move", dir: "n" });
    w.propose("cy", { kind: "commons_build", title: "Fewer stones", remove: [{ x: 9, y: 14 }] });
    for (const who of ["ada", "bob", "cy"]) w.vote(who, "t_3", "yes");
    w.day(DAY + 12);
    expect(w.close("t_3")).toMatchObject({
      events: [
        { status: "passed" },
        { type: "block_removed", x: 9, y: 14, by: "t_3" },
        { type: "town_built", removed: [{ x: 9, y: 14 }] },
      ],
    });
    expect(w.state.blocks["9,14"]).toBeUndefined();
    expect(w.state.town?.built["9,14"]).toBeUndefined();
  });

  it("does nothing to the world for a passed advisory or a failed build", () => {
    const w = town("ada", "bob", "cy");
    w.propose("ada", { kind: "commons_build", title: "A fountain", blocks: fountain });
    for (const who of ["ada", "bob", "cy"]) w.vote(who, "t_1", "no");
    w.day(DAY + 5);
    const blocks = { ...w.state.blocks };
    expect(w.close("t_1")).toMatchObject({ events: [{ status: "failed" }] });
    expect(w.state.blocks).toEqual(blocks);
  });
});

describe("void_proposal", () => {
  it("lets the server void an open or queued proposal for a maintainer, and opens the next", () => {
    const names = ["a", "b", "c", "d", "e", "f"];
    const w = town(...names);
    for (const name of names) w.propose(name);
    expect(w.code("a", { type: "void_proposal", proposal: "t_1", by: "a" })).toBe("server_only");
    const result = w.send(TOWN_ACTOR, { type: "void_proposal", proposal: "t_1", by: "r_admin" });
    expect(result).toMatchObject({
      ok: true,
      events: [
        { type: "proposal_closed", proposal: "t_1", status: "voided" },
        { type: "proposal_opened", proposal: "t_6" },
      ],
    });
    expect(w.proposal("t_1")).toMatchObject({ status: "voided", voidedBy: "r_admin" });
    expect(w.code(TOWN_ACTOR, { type: "void_proposal", proposal: "t_1", by: "r_admin" })).toBe(
      "proposal_not_open",
    );
  });
});

describe("replay", () => {
  it("rebuilds the same town from a log of days, proposals, votes, closes, and builds", () => {
    const w = town("ada", "bob", "cy", "di", "eve", "fay");
    w.ok(TOWN_ACTOR, { type: "set_townsfolk", ids: ["fay"] });
    w.propose("ada", { kind: "commons_build", title: "A fountain", blocks: fountain });
    w.propose("bob", { title: "Longer days", text: "Please." });
    for (const who of ["ada", "bob", "cy", "di"]) w.vote(who, "t_1", "yes");
    w.vote("eve", "t_1", "no");
    w.vote("cy", "t_2", "abstain");
    w.ok("cy", { type: "place", x: 18, y: 6, block: "leaf" });
    w.day(DAY + 5);
    w.close("t_1");
    w.close("t_2");
    w.send(TOWN_ACTOR, { type: "void_proposal", proposal: "t_9", by: "x" }); // rejected, not logged
    expect(w.state.seq).toBe(w.log.length);
    const again = replay(CONFIG, w.log);
    expect(hashWorld(again)).toBe(hashWorld(w.state));
    expect(again.town).toEqual(w.state.town);
    expect(again.lastActiveDay).toEqual(w.state.lastActiveDay);
  });
});
