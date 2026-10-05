import { describe, expect, it } from "vitest";
import { apply } from "./apply";
import { BOUNTIES, bountyHeld, findBounty } from "./bounties";
import { ECONOMY } from "./economy";
import { BOUNTIES_CONFIG, BOUNTIES_HASH, BOUNTIES_LOG } from "./fixtures/bounties-log";
import { MARKET_CONFIG, MARKET_HASH, MARKET_LOG } from "./fixtures/market-log";
import { hashWorld } from "./hash";
import { replay } from "./replay";
import { expectSupplyHolds, fund } from "./test-support";
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
  [1, 0],
] as const;
const DAY = 20_000;

/**
 * A world with coins and bounties open, and Ada, Bob, Cy, and Dee settled long enough to take part
 * in the Town Hall. Every input checks the supply identity (with what bounties hold), and every
 * rejection that nothing changed.
 */
function bounties({ open = true } = {}) {
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
  if (open) town({ type: "open_bounties" });
  for (const [i, name] of ["ada", "bob", "cy", "dee"].entries()) settle(name, i);
  // Old enough for the Town Hall, and past the first day, when nobody posts.
  town({ type: "new_day", day: DAY + TOWN_LIMITS.eligibleAfterDays });
  for (const name of ["ada", "bob", "cy", "dee"]) ok(name, { type: "home" });
  const coins = (id: string) => state.economy?.coins[id] ?? 0;
  const treasury = () => state.economy?.treasury ?? 0;
  const bounty = (id: string) => findBounty(state, id);
  const post = (actor: string, reward = 20, title = "Water my lemons"): Command => ({
    type: "post_bounty",
    title,
    reward,
  });
  return { state, log, send, ok, code, town, settle, coins, treasury, bounty, post };
}

const id = (bounty: string) => ({ bounty });

describe("old logs", () => {
  it("replay to the hash they had before bounties", () => {
    expect(hashWorld(replay(MARKET_CONFIG, MARKET_LOG))).toBe(MARKET_HASH);
  });

  it("replay a log with bounties and a grant to the pinned hash", () => {
    const state = replay(BOUNTIES_CONFIG, BOUNTIES_LOG);
    expectSupplyHolds(state);
    expect(state.bounties?.list.map((b) => [b.id, b.status])).toEqual([
      ["b_1", "paid"],
      ["b_2", "cancelled"],
      ["b_3", "paid"],
    ]);
    expect(state.town?.proposals.at(-1)).toMatchObject({ kind: "grant", status: "passed" });
    expect(state.economy?.ledgers.dee).toContainEqual(
      expect.objectContaining({ amount: 100, reason: "grant" }),
    );
    expect(hashWorld(state)).toBe(BOUNTIES_HASH);
  });
});

describe("open_bounties", () => {
  it("only comes from the server, once, after coins", () => {
    const state = createWorld(CONFIG);
    const send = (actor: string, command: Command) => apply(state, { actor, command });
    send(TOWN_ACTOR, { type: "new_day", day: DAY });
    expect(send(TOWN_ACTOR, { type: "open_bounties" })).toMatchObject({
      rejection: { code: "not_due" },
    });
    send(TOWN_ACTOR, { type: "open_economy" });
    expect(send("ada", { type: "open_bounties" })).toMatchObject({
      rejection: { code: "server_only" },
    });
    expect(send(TOWN_ACTOR, { type: "open_bounties" })).toMatchObject({
      ok: true,
      events: [{ type: "bounties_opened" }],
    });
    expect(send(TOWN_ACTOR, { type: "open_bounties" })).toMatchObject({
      rejection: { code: "already_open" },
    });
  });

  it("refuses every bounty and money proposal until then", () => {
    const w = bounties({ open: false });
    expect(w.code("ada", w.post("ada"))).toBe("bounties_closed");
    expect(w.code("ada", { type: "claim_bounty", bounty: "b_1" })).toBe("bounties_closed");
    expect(
      w.code("ada", {
        type: "propose",
        kind: "grant",
        title: "Bob",
        text: "",
        amount: 10,
        to: "bob",
      }),
    ).toBe("invalid_proposal");
  });
});

describe("a resident's bounty", () => {
  it("holds the reward, pays the claimant on confirm, and counts toward both daily caps", () => {
    const w = bounties();
    const adaBefore = w.coins("ada");
    const bobBefore = w.coins("bob");
    const events = w.ok("ada", w.post("ada", 30));
    expect(events).toContainEqual(
      expect.objectContaining({ type: "coins", amount: -30, reason: "bounty_held" }),
    );
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "bounty_posted",
        bounty: expect.objectContaining({ id: "b_1", reward: 30, status: "open" }),
      }),
    );
    expect(w.coins("ada")).toBe(adaBefore - 30);
    expect(bountyHeld(w.state)).toBe(30);
    expect(w.state.economy?.today.given.ada).toBe(30);

    w.ok("bob", { type: "claim_bounty", ...id("b_1") });
    expect(w.bounty("b_1")).toMatchObject({ status: "claimed", claimant: "bob" });
    w.ok("bob", { type: "complete_bounty", ...id("b_1") });
    expect(w.bounty("b_1")?.status).toBe("done");
    const paid = w.ok("ada", { type: "confirm_bounty", bounty: "b_1", to: "bob" });
    expect(paid).toContainEqual(
      expect.objectContaining({
        type: "coins",
        residentId: "bob",
        amount: 30,
        reason: "bounty",
        with: "ada",
      }),
    );
    expect(paid).toContainEqual({
      type: "bounty_paid",
      bounty: "b_1",
      claimant: "bob",
      reward: 30,
    });
    expect(w.coins("bob")).toBe(bobBefore + 30);
    expect(bountyHeld(w.state)).toBe(0);
    expect(w.state.economy?.today.received.bob).toBe(30);
    expect(w.bounty("b_1")).toMatchObject({ status: "paid", claimant: "bob", closedDay: DAY + 3 });
    // A finished bounty takes nothing more.
    expect(w.code("bob", { type: "complete_bounty", ...id("b_1") })).toBe("bounty_not_open");
    expect(w.code("ada", { type: "confirm_bounty", bounty: "b_1", to: "bob" })).toBe(
      "bounty_not_open",
    );
    expect(w.code("ada", { type: "cancel_bounty", ...id("b_1") })).toBe("bounty_not_open");
  });

  it("can be confirmed while claimed, without waiting for done", () => {
    const w = bounties();
    w.ok("ada", w.post("ada"));
    w.ok("bob", { type: "claim_bounty", ...id("b_1") });
    w.ok("ada", { type: "confirm_bounty", bounty: "b_1", to: "bob" });
    expect(w.bounty("b_1")?.status).toBe("paid");
  });

  it("refuses bad posts", () => {
    const w = bounties();
    const post = (extra: Partial<Extract<Command, { type: "post_bounty" }>>) =>
      w.code("ada", { type: "post_bounty", title: "Fix my fence", reward: 10, ...extra });
    expect(post({ title: "  " })).toBe("invalid_bounty");
    expect(post({ title: "x".repeat(BOUNTIES.titleMax + 1) })).toBe("invalid_bounty");
    expect(post({ text: "x".repeat(BOUNTIES.textMax + 1) })).toBe("invalid_bounty");
    expect(post({ reward: 0 })).toBe("invalid_amount");
    expect(post({ reward: 1.5 })).toBe("invalid_amount");
    expect(post({ reward: BOUNTIES.rewardMax + 1 })).toBe("invalid_amount");
    expect(post({ reward: w.coins("ada") + 1 })).toBe("not_enough_coins");
    expect(w.state.bounties?.list).toEqual([]);
  });

  it("counts toward the give cap and refuses past it", () => {
    const w = bounties();
    fund(w.state, "ada", 1_000);
    w.ok("ada", { type: "give_coins", to: "cy", amount: 150 });
    expect(w.code("ada", w.post("ada", 51))).toBe("gift_limit");
    w.ok("ada", w.post("ada", 50));
    expect(w.code("ada", w.post("ada", 1))).toBe("gift_limit");
    // The cap resets with the day.
    w.town({ type: "new_day", day: DAY + 4 });
    w.ok("ada", w.post("ada", BOUNTIES.rewardMax));
  });

  it("waits for a resident's second day", () => {
    const w = bounties();
    w.ok("eve", { type: "join", name: "Eve", kind: "human" });
    fund(w.state, "eve", 100);
    expect(w.code("eve", w.post("eve"))).toBe("gift_limit");
    // But a newcomer can claim one, and be paid.
    w.ok("ada", w.post("ada"));
    w.ok("eve", { type: "claim_bounty", ...id("b_1") });
    w.ok("ada", { type: "confirm_bounty", bounty: "b_1", to: "eve" });
  });

  it("limits how many a resident runs and holds", () => {
    const w = bounties();
    fund(w.state, "ada", 1_000);
    for (let i = 0; i < BOUNTIES.postedMax; i++) w.ok("ada", w.post("ada", 5));
    expect(w.code("ada", w.post("ada", 5))).toBe("bounty_limit");
    fund(w.state, "cy", 1_000);
    w.ok("cy", w.post("cy", 5));
    for (let i = 1; i <= BOUNTIES.claimsMax; i++)
      w.ok("bob", { type: "claim_bounty", bounty: `b_${i}` });
    expect(w.code("bob", { type: "claim_bounty", ...id("b_4") })).toBe("bounty_limit");
    // Cancelling one makes room to post again.
    w.ok("dee", { type: "claim_bounty", ...id("b_4") });
    w.ok("bob", { type: "drop_bounty", ...id("b_1") });
    w.ok("ada", { type: "cancel_bounty", ...id("b_1") });
    w.ok("ada", w.post("ada", 5));
  });

  it("refuses claims that aren't for this resident to make", () => {
    const w = bounties();
    w.ok("ada", w.post("ada"));
    expect(w.code("ada", { type: "claim_bounty", ...id("b_1") })).toBe("own_bounty");
    expect(w.code("bob", { type: "claim_bounty", ...id("b_9") })).toBe("unknown_bounty");
    w.ok("bob", { type: "claim_bounty", ...id("b_1") });
    expect(w.code("cy", { type: "claim_bounty", ...id("b_1") })).toBe("bounty_not_open");
    w.town({ type: "set_townsfolk", ids: ["dee"] });
    w.ok("bob", { type: "drop_bounty", ...id("b_1") });
    expect(w.code("dee", { type: "claim_bounty", ...id("b_1") })).toBe("not_eligible");
    expect(w.code("dee", w.post("dee"))).toBe("not_eligible");
  });

  it("lets the claimant drop it, and the poster send the claimant back, and nobody else", () => {
    const w = bounties();
    w.ok("ada", w.post("ada"));
    expect(w.code("bob", { type: "drop_bounty", ...id("b_1") })).toBe("bounty_not_open");
    w.ok("bob", { type: "claim_bounty", ...id("b_1") });
    expect(w.code("cy", { type: "drop_bounty", ...id("b_1") })).toBe("not_your_bounty");
    expect(w.ok("bob", { type: "drop_bounty", ...id("b_1") })).toEqual([
      { type: "bounty_dropped", bounty: "b_1", claimant: "bob", by: "claimant" },
    ]);
    w.ok("cy", { type: "claim_bounty", ...id("b_1") });
    w.ok("cy", { type: "complete_bounty", ...id("b_1") });
    expect(w.ok("ada", { type: "drop_bounty", ...id("b_1") })).toEqual([
      { type: "bounty_dropped", bounty: "b_1", claimant: "cy", by: "poster" },
    ]);
    expect(w.bounty("b_1")).toEqual(expect.objectContaining({ status: "open" }));
    expect(w.bounty("b_1")?.claimant).toBeUndefined();
    expect(w.bounty("b_1")?.doneDay).toBeUndefined();
  });

  it("is marked done only by its claimant, once", () => {
    const w = bounties();
    w.ok("ada", w.post("ada"));
    expect(w.code("bob", { type: "complete_bounty", ...id("b_1") })).toBe("not_your_bounty");
    w.ok("bob", { type: "claim_bounty", ...id("b_1") });
    expect(w.code("ada", { type: "complete_bounty", ...id("b_1") })).toBe("not_your_bounty");
    w.ok("bob", { type: "complete_bounty", ...id("b_1") });
    expect(w.code("bob", { type: "complete_bounty", ...id("b_1") })).toBe("bounty_not_open");
  });

  it("pays only from its poster, only to its claimant", () => {
    const w = bounties();
    w.ok("ada", w.post("ada"));
    expect(w.code("ada", { type: "confirm_bounty", bounty: "b_1", to: "bob" })).toBe(
      "bounty_not_open",
    );
    w.ok("bob", { type: "claim_bounty", ...id("b_1") });
    expect(w.code("cy", { type: "confirm_bounty", bounty: "b_1", to: "bob" })).toBe(
      "not_your_bounty",
    );
    expect(w.code("bob", { type: "confirm_bounty", bounty: "b_1", to: "bob" })).toBe(
      "not_your_bounty",
    );
    expect(w.code("ada", { type: "confirm_bounty", bounty: "b_1", to: "cy" })).toBe(
      "invalid_bounty",
    );
    w.town({ type: "set_townsfolk", ids: ["bob"] });
    expect(w.code("ada", { type: "confirm_bounty", bounty: "b_1", to: "bob" })).toBe(
      "not_eligible",
    );
  });

  it("refuses to pay a claimant already at the receive cap, unless they're an owner pair", () => {
    const w = bounties();
    w.ok("ada", w.post("ada"));
    w.ok("bob", { type: "claim_bounty", ...id("b_1") });
    const econ = w.state.economy;
    if (!econ) throw new Error("coins open");
    econ.today.received.bob = ECONOMY.receiveCap;
    expect(w.code("ada", { type: "confirm_bounty", bounty: "b_1", to: "bob" })).toBe("gift_limit");
    // A pair linked before today skips it.
    w.town({ type: "add_owner_pair", pair: ["ada", "bob"] });
    w.town({ type: "new_day", day: DAY + 4 });
    econ.today.received.bob = ECONOMY.receiveCap;
    w.ok("ada", { type: "confirm_bounty", bounty: "b_1", to: "bob" });
    expect(econ.today.received.bob).toBe(ECONOMY.receiveCap);
  });

  it("is cancelled only by its poster, only while open, and the reward comes back", () => {
    const w = bounties();
    const before = w.coins("ada");
    w.ok("ada", w.post("ada", 25));
    expect(w.code("bob", { type: "cancel_bounty", ...id("b_1") })).toBe("not_your_bounty");
    w.ok("bob", { type: "claim_bounty", ...id("b_1") });
    expect(w.code("ada", { type: "cancel_bounty", ...id("b_1") })).toBe("bounty_not_open");
    w.ok("ada", { type: "drop_bounty", ...id("b_1") });
    const events = w.ok("ada", { type: "cancel_bounty", ...id("b_1") });
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "coins",
        residentId: "ada",
        amount: 25,
        reason: "bounty_returned",
      }),
    );
    expect(events).toContainEqual({ type: "bounty_closed", bounty: "b_1", status: "cancelled" });
    expect(w.coins("ada")).toBe(before);
  });

  it("expires 30 days after posting while open or claimed, but waits once it's done", () => {
    const w = bounties();
    fund(w.state, "ada", 100);
    w.ok("ada", w.post("ada", 10)); // open
    w.ok("ada", w.post("ada", 10)); // claimed
    w.ok("ada", w.post("ada", 10)); // done
    w.ok("bob", { type: "claim_bounty", ...id("b_2") });
    w.ok("cy", { type: "claim_bounty", ...id("b_3") });
    w.ok("cy", { type: "complete_bounty", ...id("b_3") });
    const before = w.coins("ada");
    const posted = DAY + 3;
    w.town({ type: "new_day", day: posted + BOUNTIES.openDays - 1 });
    expect(w.state.bounties?.list.map((b) => b.status)).toEqual(["open", "claimed", "done"]);
    const events = w.town({ type: "new_day", day: posted + BOUNTIES.openDays });
    expect(events).toContainEqual({ type: "bounty_closed", bounty: "b_1", status: "expired" });
    expect(events).toContainEqual({ type: "bounty_closed", bounty: "b_2", status: "expired" });
    expect(w.state.bounties?.list.map((b) => b.status)).toEqual(["expired", "expired", "done"]);
    expect(w.coins("ada")).toBe(before + 20);
    expect(bountyHeld(w.state)).toBe(10);
  });

  it("keeps only the newest finished bounties", () => {
    const w = bounties();
    fund(w.state, "ada", 10_000);
    let day = DAY + 3;
    for (let i = 0; i < BOUNTIES.keepFinished + 2; i++) {
      if (i % 2 === 0) w.town({ type: "new_day", day: ++day });
      w.ok("ada", w.post("ada", 1));
      w.ok("ada", { type: "cancel_bounty", bounty: `b_${i + 1}` });
    }
    w.ok("ada", w.post("ada", 1));
    // An old bounty that finishes now is newer than the rest by when it closed, so it stays.
    w.ok("bob", { type: "claim_bounty", bounty: `b_${BOUNTIES.keepFinished + 3}` });
    w.ok("ada", w.post("ada", 1));
    w.town({ type: "new_day", day: ++day });
    w.ok("ada", {
      type: "confirm_bounty",
      bounty: `b_${BOUNTIES.keepFinished + 3}`,
      to: "bob",
    });
    expect(w.bounty(`b_${BOUNTIES.keepFinished + 3}`)?.status).toBe("paid");
    const list = w.state.bounties?.list ?? [];
    // The newest 100 finished (b_4 on) and the open one.
    expect(list).toHaveLength(BOUNTIES.keepFinished + 1);
    expect(list[0]?.id).toBe("b_4");
    expect(list.at(-1)).toMatchObject({ id: `b_${BOUNTIES.keepFinished + 4}`, status: "open" });
  });
});

/** Ada files a proposal and everyone else votes yes, then it closes. */
function pass(w: ReturnType<typeof bounties>, command: Extract<Command, { type: "propose" }>) {
  w.ok("ada", command);
  const p = w.state.town?.proposals.at(-1);
  if (!p) throw new Error("no proposal");
  for (const name of ["bob", "cy", "dee"])
    w.ok(name, { type: "vote", proposal: p.id, choice: "yes" });
  w.town({ type: "new_day", day: p.closesDay ?? 0 });
  return { id: p.id, events: w.ok(TOWN_ACTOR, { type: "close_proposal", proposal: p.id }) };
}

const grant = (amount: number, to: string): Extract<Command, { type: "propose" }> => ({
  type: "propose",
  kind: "grant",
  title: "For the bridge",
  text: "",
  amount,
  to,
});
const townBounty = (amount: number): Extract<Command, { type: "propose" }> => ({
  type: "propose",
  kind: "bounty",
  title: "A bridge across the stream",
  text: "Wood, please.",
  amount,
});

describe("grants", () => {
  it("hold their coins for their resident when the proposal passes, and pay once a maintainer releases them", () => {
    const w = bounties();
    const { id: proposal, events } = pass(w, grant(300, "bob"));
    expect(events).toContainEqual(
      expect.objectContaining({ type: "treasury", amount: -300, reason: "bounty_held" }),
    );
    expect(w.bounty("b_1")).toMatchObject({
      grant: true,
      proposal,
      poster: "ada",
      claimant: "bob",
      status: "done",
      reward: 300,
    });
    expect(bountyHeld(w.state)).toBe(300);
    expect(w.state.town?.proposals.at(-1)).toMatchObject({ amount: 300, to: "bob" });
    // Nobody else can take it, and it isn't a job to drop or send back.
    expect(w.code("cy", { type: "claim_bounty", ...id("b_1") })).toBe("bounty_not_open");
    expect(w.code("bob", { type: "drop_bounty", ...id("b_1") })).toBe("not_eligible");
    expect(w.code(TOWN_ACTOR, { type: "reopen_bounty", bounty: "b_1", by: "cy" })).toBe(
      "not_eligible",
    );
    // It waits past the usual 30 days.
    w.town({ type: "new_day", day: (w.bounty("b_1")?.expiresDay ?? 0) + 1 });
    expect(w.bounty("b_1")?.status).toBe("done");
    const before = w.coins("bob");
    const paid = w.town({ type: "confirm_town_bounty", bounty: "b_1", to: "bob", by: "cy" });
    expect(paid).toContainEqual(
      expect.objectContaining({ type: "coins", residentId: "bob", amount: 300, reason: "grant" }),
    );
    expect(paid).toContainEqual({ type: "grant_paid", proposal, to: "bob", amount: 300 });
    expect(w.coins("bob")).toBe(before + 300);
  });

  it("pay nothing to a resident who joined the proposer's household before it closed", () => {
    const w = bounties();
    w.ok("ada", grant(200, "bob"));
    for (const name of ["bob", "cy", "dee"]) {
      w.ok(name, { type: "vote", proposal: "t_1", choice: "yes" });
    }
    w.town({ type: "add_owner_pair", pair: ["ada", "bob"] });
    w.town({ type: "new_day", day: w.state.town?.proposals[0]?.closesDay ?? 0 });
    const events = w.ok(TOWN_ACTOR, { type: "close_proposal", proposal: "t_1" });
    expect(events).toContainEqual({ type: "proposal_unpaid", proposal: "t_1", amount: 200 });
    expect(w.state.bounties?.list).toEqual([]);
  });

  it("refuse an amount, a resident, or a shape that isn't allowed", () => {
    const w = bounties();
    const code = (command: Extract<Command, { type: "propose" }>) => w.code("ada", command);
    expect(code(grant(0, "bob"))).toBe("invalid_proposal");
    expect(code(grant(BOUNTIES.townMax + 1, "bob"))).toBe("invalid_proposal");
    expect(code(grant(10, "ada"))).toBe("invalid_proposal");
    expect(code(grant(10, "nobody"))).toBe("invalid_proposal");
    expect(code({ ...grant(10, "bob"), to: undefined } as never)).toBe("invalid_proposal");
    expect(code({ ...grant(10, "bob"), blocks: [{ x: 9, y: 13, block: "glass" }] })).toBe(
      "invalid_proposal",
    );
    expect(code({ ...townBounty(10), to: "bob" })).toBe("invalid_proposal");
    expect(code({ type: "propose", kind: "advisory", title: "Hi", text: "", amount: 5 })).toBe(
      "invalid_proposal",
    );
    w.town({ type: "add_owner_pair", pair: ["ada", "dee"] });
    expect(code(grant(10, "dee"))).toBe("invalid_proposal");
    w.town({ type: "set_townsfolk", ids: ["cy"] });
    expect(code(grant(10, "cy"))).toBe("invalid_proposal");
    // More than the treasury can spare above the reserve it keeps for welcome gifts.
    const econ = w.state.economy;
    if (!econ) throw new Error("coins open");
    const spend = econ.treasury - ECONOMY.budgetReserve - 50;
    econ.treasury -= spend;
    econ.burned += spend;
    expect(code(grant(51, "bob"))).toBe("invalid_proposal");
    expect(code(grant(50, "bob"))).toBeNull();
  });

  it("move nothing when the treasury can't cover them at close, or the vote fails", () => {
    const w = bounties();
    w.ok("ada", grant(500, "bob"));
    const econ = w.state.economy;
    if (!econ) throw new Error("coins open");
    for (const name of ["bob", "cy", "dee"])
      w.ok(name, { type: "vote", proposal: "t_1", choice: "yes" });
    const closes = w.state.town?.proposals[0]?.closesDay ?? 0;
    w.town({ type: "new_day", day: closes });
    // Spend the treasury down past the grant: burn it, so the supply still adds up.
    const spend = econ.treasury - 100;
    econ.treasury -= spend;
    econ.burned += spend;
    const before = w.coins("bob");
    const events = w.ok(TOWN_ACTOR, { type: "close_proposal", proposal: "t_1" });
    expect(events).toContainEqual({ type: "proposal_unpaid", proposal: "t_1", amount: 500 });
    expect(w.coins("bob")).toBe(before);
    expect(w.state.town?.proposals[0]?.status).toBe("passed");
  });

  it("can be voided by a maintainer before they pay", () => {
    const w = bounties();
    w.ok("ada", grant(100, "bob"));
    const before = w.treasury();
    w.town({ type: "void_proposal", proposal: "t_1", by: "cy" });
    expect(w.treasury()).toBe(before);
    expect(w.state.town?.proposals[0]?.status).toBe("voided");
  });
});

describe("town bounties", () => {
  /** A passed town bounty, b_1, claimed by Bob and marked done. */
  function done(w = bounties()) {
    const before = w.treasury();
    const { events } = pass(w, townBounty(400));
    expect(events).toContainEqual(
      expect.objectContaining({ type: "treasury", amount: -400, reason: "bounty_held" }),
    );
    expect(w.bounty("b_1")).toMatchObject({
      poster: "ada",
      proposal: "t_1",
      title: "A bridge across the stream",
      text: "Wood, please.",
      reward: 400,
      status: "open",
    });
    // The day it closed minted, too.
    expect(w.treasury()).toBe(before + ECONOMY.treasuryMint - 400);
    w.ok("bob", { type: "claim_bounty", ...id("b_1") });
    w.ok("bob", { type: "complete_bounty", ...id("b_1") });
    return w;
  }
  const confirm = (by: string, to = "bob"): Command => ({
    type: "confirm_town_bounty",
    bounty: "b_1",
    to,
    by,
  });

  it("pay their claimant once a maintainer confirms it", () => {
    const w = done();
    const before = w.coins("bob");
    const events = w.town(confirm("cy"));
    expect(events).toContainEqual(
      expect.objectContaining({ type: "coins", residentId: "bob", amount: 400, reason: "bounty" }),
    );
    expect(events).toContainEqual({
      type: "bounty_paid",
      bounty: "b_1",
      claimant: "bob",
      reward: 400,
    });
    expect(w.coins("bob")).toBe(before + 400);
    expect(w.bounty("b_1")).toMatchObject({ status: "paid", by: "cy" });
  });

  it("are confirmed only by the server, for a maintainer who isn't in on it, once it's done", () => {
    const w = bounties();
    pass(w, townBounty(400));
    w.ok("bob", { type: "claim_bounty", ...id("b_1") });
    expect(w.code(TOWN_ACTOR, confirm("cy"))).toBe("bounty_not_open");
    w.ok("bob", { type: "complete_bounty", ...id("b_1") });
    expect(w.code("cy", confirm("cy"))).toBe("server_only");
    expect(w.code("ada", { type: "confirm_bounty", bounty: "b_1", to: "bob" })).toBe(
      "not_eligible",
    );
    expect(w.code(TOWN_ACTOR, confirm(""))).toBe("server_only");
    expect(w.code(TOWN_ACTOR, confirm("bob"))).toBe("not_eligible");
    expect(w.code(TOWN_ACTOR, confirm("ada"))).toBe("not_eligible");
    expect(w.code(TOWN_ACTOR, confirm("cy", "dee"))).toBe("invalid_bounty");
    // Only the claimant can drop it; the proposer can't send them back or cancel it.
    expect(w.code("ada", { type: "drop_bounty", ...id("b_1") })).toBe("not_your_bounty");
    expect(w.code("ada", { type: "cancel_bounty", ...id("b_1") })).toBe("not_eligible");
    w.town(confirm("cy"));
  });

  it("refuse a confirmer in the claimant's or the proposer's household", () => {
    const w = done();
    w.town({ type: "add_owner_pair", pair: ["bob", "cy"] });
    expect(w.code(TOWN_ACTOR, confirm("cy"))).toBe("not_eligible");
    w.town({ type: "add_owner_pair", pair: ["ada", "dee"] });
    expect(w.code(TOWN_ACTOR, confirm("dee"))).toBe("not_eligible");
    w.town(confirm("staff_1"));
  });

  it("can be sent back to open by a maintainer when it isn't done", () => {
    const w = done();
    expect(w.code("ada", { type: "reopen_bounty", bounty: "b_1", by: "cy" })).toBe("server_only");
    expect(w.code(TOWN_ACTOR, { type: "reopen_bounty", bounty: "b_1", by: "" })).toBe(
      "server_only",
    );
    expect(w.town({ type: "reopen_bounty", bounty: "b_1", by: "cy" })).toEqual([
      { type: "bounty_dropped", bounty: "b_1", claimant: "bob", by: "maintainer" },
    ]);
    expect(w.bounty("b_1")).toMatchObject({ status: "open" });
    expect(w.code(TOWN_ACTOR, { type: "reopen_bounty", bounty: "b_1", by: "cy" })).toBe(
      "bounty_not_open",
    );
    // A resident's bounty is its poster's to send back.
    w.ok("ada", w.post("ada"));
    w.ok("cy", { type: "claim_bounty", ...id("b_2") });
    expect(w.code(TOWN_ACTOR, { type: "reopen_bounty", bounty: "b_2", by: "dee" })).toBe(
      "not_eligible",
    );
  });

  it("may be claimed by their proposer, and still need a maintainer", () => {
    const w = bounties();
    pass(w, townBounty(50));
    w.ok("ada", { type: "claim_bounty", ...id("b_1") });
    w.ok("ada", { type: "complete_bounty", ...id("b_1") });
    expect(w.code(TOWN_ACTOR, confirm("ada", "ada"))).toBe("not_eligible");
    w.town(confirm("cy", "ada"));
  });

  it("go back to the treasury when voided or expired", () => {
    const w = done();
    const before = w.treasury();
    expect(w.code(TOWN_ACTOR, { type: "void_bounty", bounty: "b_1", by: "" })).toBe("server_only");
    const events = w.town({ type: "void_bounty", bounty: "b_1", by: "cy" });
    expect(events).toContainEqual(
      expect.objectContaining({ type: "treasury", amount: 400, reason: "bounty_returned" }),
    );
    expect(w.treasury()).toBe(before + 400);
    expect(w.bounty("b_1")).toMatchObject({ status: "cancelled", by: "cy" });
    expect(w.code(TOWN_ACTOR, { type: "void_bounty", bounty: "b_1", by: "cy" })).toBe(
      "bounty_not_open",
    );

    const x = bounties();
    pass(x, townBounty(200));
    const posted = x.bounty("b_1")?.postedDay ?? 0;
    const held = x.treasury();
    const expired = x.town({ type: "new_day", day: posted + BOUNTIES.openDays });
    expect(expired).toContainEqual({ type: "bounty_closed", bounty: "b_1", status: "expired" });
    expect(x.treasury()).toBe(held + ECONOMY.treasuryMint + 200);
  });

  it("void a resident's bounty back to its poster", () => {
    const w = bounties();
    const before = w.coins("ada");
    w.ok("ada", w.post("ada", 40));
    w.ok("bob", { type: "claim_bounty", ...id("b_1") });
    w.town({ type: "void_bounty", bounty: "b_1", by: "cy" });
    expect(w.coins("ada")).toBe(before);
  });

  it("move nothing when the treasury can't cover them at close", () => {
    const w = bounties();
    w.ok("ada", townBounty(900));
    for (const name of ["bob", "cy", "dee"])
      w.ok(name, { type: "vote", proposal: "t_1", choice: "yes" });
    w.town({ type: "new_day", day: w.state.town?.proposals[0]?.closesDay ?? 0 });
    const econ = w.state.economy;
    if (!econ) throw new Error("coins open");
    const spend = econ.treasury - 10;
    econ.treasury -= spend;
    econ.burned += spend;
    const events = w.ok(TOWN_ACTOR, { type: "close_proposal", proposal: "t_1" });
    expect(events).toContainEqual({ type: "proposal_unpaid", proposal: "t_1", amount: 900 });
    expect(w.state.bounties?.list).toEqual([]);
  });
});
