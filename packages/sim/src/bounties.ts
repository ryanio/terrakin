import { coinCount as coins, isWhole, oneTimeSwitch, refuse } from "./check";
import {
  ECONOMY,
  isTownsfolk,
  movePurse,
  moveTreasury,
  ownerPaired,
  pairSkipsCaps,
} from "./economy";
import { bountyEarns, earned, townBountyEarns } from "./levels";
import { residentById } from "./own";
import type {
  BountiesState,
  Bounty,
  BountyStatus,
  Command,
  EconomyState,
  Proposal,
  Rejection,
  ResidentId,
  WorldEvent,
  WorldState,
} from "./types";

/**
 * Bounties and grants (RFC 0008, phase 5, decision 0062): jobs a resident or the town pays for
 * once they're done, and Town Hall grants that pay a resident from the treasury.
 *
 * Nothing here runs until the server sends `open_bounties`, which needs coins open, so worlds from
 * before it replay to the hash they always had. A bounty's reward leaves its poster's purse (or the
 * treasury, for a town bounty) when it's posted and is held in the bounty until it pays, is
 * cancelled, or expires, so `sum(coins) + treasury + bountyHeld == minted - burned`.
 */

/**
 * The numbers (decision 0062). Replay checks logged bounties against them, so changing one needs
 * a logged input that switches it, the way `set_shop_share` does for the shop.
 */
export const BOUNTIES = {
  /** The most a resident's own bounty may pay. Posting it counts toward their daily give cap. */
  rewardMax: 200,
  /** The most a Town Hall grant or town bounty may pay. */
  townMax: 1_000,
  /** Bounties one resident has posted that haven't finished. */
  postedMax: 3,
  /** Bounties one resident holds a claim on (claimed or done) at once. */
  claimsMax: 3,
  /** Bounty titles, in characters. */
  titleMax: 80,
  /** Bounty texts, in characters. */
  textMax: 500,
  /** An open or claimed bounty expires when the day this many days after posting starts. */
  openDays: 30,
  /** Finished bounties kept in the world, newest last. Older ones drop off. */
  keepFinished: 100,
} as const;

type Mutation = () => WorldEvent[];
export type BountiesChecked = Mutation | Rejection;

const RUNNING: readonly BountyStatus[] = ["open", "claimed", "done"];

/** Whether a bounty is still running: open, claimed, or done and waiting to be confirmed. */
export const isRunning = (b: Bounty) => RUNNING.includes(b.status);

/** Coins held in bounties that haven't finished. Part of the supply identity. */
export function bountyHeld(state: WorldState): number {
  let held = 0;
  for (const b of state.bounties?.list ?? []) if (isRunning(b)) held += b.reward;
  return held;
}

export const findBounty = (state: WorldState, id: string): Bounty | undefined =>
  state.bounties?.list.find((b) => b.id === id);

/** A copy for an event, so later changes don't reach events already sent. */
const copy = (b: Bounty): Bounty => ({ ...b });

interface Open {
  bounties: BountiesState;
  econ: EconomyState;
  day: number;
}

function opened(state: WorldState): Open | Rejection {
  const { bounties, economy: econ, day } = state;
  if (!bounties || !econ || day === undefined) {
    return refuse("bounties_closed", "Bounties haven't opened in this world yet.");
  }
  return { bounties, econ, day };
}

/** A running bounty by id, or why not. */
function running(state: WorldState, id: unknown): Bounty | Rejection {
  const b = typeof id === "string" ? findBounty(state, id) : undefined;
  if (!b) return refuse("unknown_bounty", "No bounty has that id. See GET /v1/bounties.");
  if (!isRunning(b))
    return refuse("bounty_not_open", `That bounty has ${b.status === "paid" ? "paid" : "ended"}.`);
  return b;
}

/**
 * Mark a bounty finished, then drop the ones that finished longest ago past `keepFinished` (by
 * `closedDay`, then posting order). Running ones always stay, and so does the one just finished.
 */
function finish(bounties: BountiesState, b: Bounty, status: BountyStatus, day: number) {
  b.status = status;
  b.closedDay = day;
  const finished = bounties.list.filter((x) => !isRunning(x));
  const extra = finished.length - BOUNTIES.keepFinished;
  if (extra > 0) {
    // A stable sort keeps posting order among bounties that closed on the same day.
    const oldest = [...finished].sort((x, y) => (x.closedDay ?? 0) - (y.closedDay ?? 0));
    const drop = new Set(oldest.filter((x) => x !== b).slice(0, extra));
    bounties.list = bounties.list.filter((x) => !drop.has(x));
  }
}

/** What the treasury can spare for a grant or a town bounty: what it holds above the reserve. */
const treasurySpare = (econ: EconomyState) => Math.max(0, econ.treasury - ECONOMY.budgetReserve);

/** Whether `who` is one of `ids`, or in one of their owner-linked households. */
const inHousehold = (state: WorldState, who: string, ids: readonly (string | undefined)[]) =>
  ids.some((id) => id !== undefined && (id === who || ownerPaired(state, who, id)));

/** Whether a maintainer acting as `by` is in on a bounty: its claimant, its poster, or either's household. */
const inOnIt = (state: WorldState, by: string, b: Bounty) =>
  inHousehold(state, by, [b.claimant, b.poster]);

/**
 * Whether a staff input's `resident`, the resident the maintainer also is when the server knows
 * it, is one of `ids` or in their household. Inputs logged before it existed don't have it, so they
 * replay as they did.
 */
function residentIn(
  state: WorldState,
  command: { resident?: unknown },
  ids: readonly (string | undefined)[],
): boolean | Rejection {
  const { resident } = command;
  if (resident === undefined) return false;
  if (typeof resident !== "string" || resident === "") {
    return refuse("server_only", "A maintainer's resident is a resident id.");
  }
  return inHousehold(state, resident, ids);
}

/** Give a bounty's reward back to where it came from: its poster's purse, or the treasury. */
function giveBack(econ: EconomyState, b: Bounty, at: { seq: number; day: number }): WorldEvent {
  return b.proposal === undefined
    ? movePurse(econ, b.poster, b.reward, "bounty_returned", at)
    : moveTreasury(econ, b.reward, "bounty_returned", at);
}

const clearClaim = (b: Bounty) => {
  delete b.claimant;
  delete b.claimedDay;
  delete b.doneDay;
};

// ---------- server inputs ----------

/** `open_bounties`, which only TOWN_ACTOR sends. Needs coins open. */
export function checkOpenBounties(state: WorldState): BountiesChecked {
  return oneTimeSwitch({
    on: state.bounties,
    already: "Bounties are already open.",
    notYet: () =>
      !state.economy || state.day === undefined
        ? refuse("not_due", "Bounties open once coins have.")
        : null,
    turnOn: () => {
      state.bounties = { nextId: 1, list: [] };
    },
    event: { type: "bounties_opened" },
  });
}

/**
 * `confirm_town_bounty {bounty, to, by, resident?}`, which only TOWN_ACTOR sends for a maintainer: a
 * town bounty its claimant marked done, or a passed grant, pays them from what it holds. The
 * confirmer (`by`, and `resident` when given) can't be the claimant or the proposer, or in either's
 * household.
 */
export function checkConfirmTownBounty(
  state: WorldState,
  command: Extract<Command, { type: "confirm_town_bounty" }>,
): BountiesChecked {
  const open = opened(state);
  if ("code" in open) return open;
  const { bounties, econ, day } = open;
  const b = running(state, command.bounty);
  if ("code" in b) return b;
  if (b.proposal === undefined) {
    return refuse("not_eligible", "That's a resident's bounty. Its poster confirms it.");
  }
  const { by, to } = command;
  if (typeof by !== "string" || by === "") {
    return refuse("server_only", "Say which maintainer confirmed it.");
  }
  if (b.status !== "done") {
    return refuse("bounty_not_open", "Its claimant hasn't said it's done yet.");
  }
  if (to !== b.claimant) return refuse("invalid_bounty", "That isn't who did it.");
  const theirs = residentIn(state, command, [b.claimant, b.poster]);
  if (typeof theirs !== "boolean") return theirs;
  if (theirs || inOnIt(state, by, b)) {
    return refuse(
      "not_eligible",
      "A maintainer can't confirm a bounty they, or their own AI or person, claimed or proposed.",
    );
  }
  if (isTownsfolk(state, to)) return refuse("not_eligible", "Townsfolk aren't paid bounties.");
  const at = { seq: state.seq + 1, day };
  const grant = b.grant === true && b.proposal !== undefined ? b.proposal : null;
  const points = townBountyEarns(state, to);
  return () => {
    const paid = movePurse(econ, to, b.reward, grant ? "grant" : "bounty", at);
    b.by = by;
    finish(bounties, b, "paid", day);
    return [
      paid,
      { type: "bounty_paid", bounty: b.id, claimant: to, reward: b.reward },
      ...(grant
        ? [{ type: "grant_paid", proposal: grant, to, amount: b.reward } as WorldEvent]
        : []),
      ...earned(points),
    ];
  };
}

/**
 * `reopen_bounty {bounty, by, resident?}`, which only TOWN_ACTOR sends for a maintainer: a town
 * bounty's claimant is sent back, because it isn't done. It's open again. Not for grants, which have
 * no job to reopen. A `resident` who is the proposer, or in their household, is refused.
 */
export function checkReopenBounty(
  state: WorldState,
  command: Extract<Command, { type: "reopen_bounty" }>,
): BountiesChecked {
  const open = opened(state);
  if ("code" in open) return open;
  const b = running(state, command.bounty);
  if ("code" in b) return b;
  if (b.proposal === undefined || b.grant) {
    return refuse("not_eligible", "Only a town bounty's claim can be sent back by a maintainer.");
  }
  if (typeof command.by !== "string" || command.by === "") {
    return refuse("server_only", "Say which maintainer sent it back.");
  }
  const claimant = b.claimant;
  if (claimant === undefined) return refuse("bounty_not_open", "Nobody has claimed it.");
  // Only the proposer's side gains by it. Sending back their own household's claim costs it.
  const theirs = residentIn(state, command, [b.poster]);
  if (typeof theirs !== "boolean") return theirs;
  if (theirs) {
    return refuse(
      "not_eligible",
      "A maintainer can't send back a bounty they, or their own AI or person, proposed.",
    );
  }
  return () => {
    b.status = "open";
    clearClaim(b);
    return [{ type: "bounty_dropped", bounty: b.id, claimant, by: "maintainer" }];
  };
}

/**
 * `void_bounty {bounty, by, resident?}`, which only TOWN_ACTOR sends for a maintainer: any bounty
 * that hasn't paid is cancelled, and its reward goes back to its poster or the treasury. A
 * `resident` who is the poster, or in their household, is refused.
 */
export function checkVoidBounty(
  state: WorldState,
  command: Extract<Command, { type: "void_bounty" }>,
): BountiesChecked {
  const open = opened(state);
  if ("code" in open) return open;
  const { bounties, econ, day } = open;
  const b = running(state, command.bounty);
  if ("code" in b) return b;
  const { by } = command;
  if (typeof by !== "string" || by === "") {
    return refuse("server_only", "Say which maintainer voided it.");
  }
  // Only the poster's side gains by it, when a resident's reward goes back to them. A bounty their
  // household claimed can still be taken down, which costs that claim.
  const theirs = residentIn(state, command, [b.poster]);
  if (typeof theirs !== "boolean") return theirs;
  if (theirs) {
    return refuse(
      "not_eligible",
      "A maintainer can't void a bounty they, or their own AI or person, posted.",
    );
  }
  const at = { seq: state.seq + 1, day };
  return () => {
    const back = giveBack(econ, b, at);
    b.by = by;
    finish(bounties, b, "cancelled", day);
    return [back, { type: "bounty_closed", bounty: b.id, status: "cancelled" }];
  };
}

/**
 * What `new_day` does to bounties, or null when nothing expires: every open or claimed bounty
 * whose `expiresDay` has come ends, and its reward goes back. A bounty marked done waits for its
 * confirmation instead.
 */
export function bountiesNewDay(state: WorldState, day: number): Mutation | null {
  const bounties = state.bounties;
  const econ = state.economy;
  if (!bounties || !econ) return null;
  const due = bounties.list.filter(
    (b) => (b.status === "open" || b.status === "claimed") && b.expiresDay <= day,
  );
  if (due.length === 0) return null;
  const at = { seq: state.seq + 1, day };
  return () =>
    due.flatMap((b) => {
      const back = giveBack(econ, b, at);
      finish(bounties, b, "expired", day);
      return [back, { type: "bounty_closed", bounty: b.id, status: "expired" } as WorldEvent];
    });
}

// ---------- grants and town bounties through the Town Hall ----------

/**
 * Why a `grant` or `bounty` proposal can't be filed, or null. Checked when it's filed: bounties
 * open, an amount the treasury can spare now (above the reserve kept for welcome gifts), and for a
 * grant, someone else to pay.
 */
export function townMoneyProblem(
  state: WorldState,
  actor: ResidentId,
  command: Extract<Command, { type: "propose" }>,
): string | null {
  const econ = state.economy;
  if (!state.bounties || !econ) return "Grants and bounties open once coins have.";
  const { amount, to } = command;
  if (!isWhole(amount) || amount < 1 || amount > BOUNTIES.townMax) {
    return "A grant or a town bounty pays 1 to 1,000 coins.";
  }
  if (amount > treasurySpare(econ)) {
    return `The treasury keeps ${coins(ECONOMY.budgetReserve)} for welcome gifts, so it can spare ${coins(treasurySpare(econ))}.`;
  }
  if (command.kind === "bounty") {
    return to === undefined ? null : "A town bounty pays whoever does the job. Leave out to.";
  }
  if (typeof to !== "string" || !residentById(state, to))
    return "A grant needs to: someone in the world.";
  if (to === actor || ownerPaired(state, actor, to)) {
    return "A grant goes to someone else, not you or your own AI or person.";
  }
  if (isTownsfolk(state, to)) return "Townsfolk aren't given grants. Their coins are the town's.";
  return null;
}

/**
 * What a passed `grant` or `bounty` proposal does when it closes. Either way its coins move from
 * the treasury into a new town bounty and wait there for a maintainer: a bounty opens for anyone
 * to claim, and a grant is held for its resident, marked done, until a maintainer releases it.
 * When the treasury can't spare it, or the grant's resident is gone, townsfolk, or now in the
 * proposer's household, nothing moves and `proposal_unpaid` says so. Worked out before anything
 * changes.
 */
export function townMoneyOnPass(state: WorldState, p: Proposal, day: number): Mutation | null {
  if (p.kind !== "grant" && p.kind !== "bounty") return null;
  const econ = state.economy;
  const bounties = state.bounties;
  const amount = p.amount ?? 0;
  const at = { seq: state.seq + 1, day };
  const unpaid = (): WorldEvent[] => [{ type: "proposal_unpaid", proposal: p.id, amount }];
  if (!econ || !bounties || amount < 1 || treasurySpare(econ) < amount) return unpaid;
  /** A grant's resident, who holds it from the start. */
  let held: ResidentId | null = null;
  if (p.kind === "grant") {
    const to = p.to;
    const can =
      to !== undefined &&
      residentById(state, to) !== undefined &&
      !isTownsfolk(state, to) &&
      to !== p.author &&
      !ownerPaired(state, p.author, to);
    if (!can) return unpaid;
    held = to;
  }
  return () => {
    const b: Bounty = {
      id: `b_${bounties.nextId}`,
      poster: p.author,
      proposal: p.id,
      ...(held ? { grant: true } : {}),
      title: p.title,
      text: p.text,
      reward: amount,
      status: held ? "done" : "open",
      postedDay: day,
      expiresDay: day + BOUNTIES.openDays,
      ...(held ? { claimant: held, claimedDay: day, doneDay: day } : {}),
    };
    bounties.nextId += 1;
    bounties.list.push(b);
    return [
      moveTreasury(econ, -amount, "bounty_held", at),
      { type: "bounty_posted", bounty: copy(b) },
    ];
  };
}

// ---------- residents' own bounties ----------

/**
 * `post_bounty {title, text?, reward}`: a job paid from your own purse. The reward is held in the
 * bounty from now on and counts toward what you give today. Not on your first day, and not for
 * townsfolk.
 */
export function checkPostBounty(
  state: WorldState,
  actor: ResidentId,
  command: Extract<Command, { type: "post_bounty" }>,
): BountiesChecked {
  const open = opened(state);
  if ("code" in open) return open;
  const { bounties, econ, day } = open;
  if (isTownsfolk(state, actor)) {
    return refuse("not_eligible", "Townsfolk don't post bounties. Their coins are the town's.");
  }
  const title = typeof command.title === "string" ? command.title.trim() : "";
  const text = typeof command.text === "string" ? command.text.trim() : "";
  if (title.length < 1 || title.length > BOUNTIES.titleMax) {
    return refuse("invalid_bounty", `A title is 1 to ${BOUNTIES.titleMax} characters.`);
  }
  if (text.length > BOUNTIES.textMax) {
    return refuse("invalid_bounty", `The text is at most ${BOUNTIES.textMax} characters.`);
  }
  const { reward } = command;
  if (!isWhole(reward) || reward < 1 || reward > BOUNTIES.rewardMax) {
    return refuse("invalid_amount", `A bounty pays 1 to ${coins(BOUNTIES.rewardMax)}.`);
  }
  if (econ.today.newcomers.includes(actor)) {
    return refuse("gift_limit", "You can post a bounty from your second day.");
  }
  const mine = bounties.list.filter(
    (b) => b.poster === actor && b.proposal === undefined && isRunning(b),
  ).length;
  if (mine >= BOUNTIES.postedMax) {
    return refuse(
      "bounty_limit",
      `You have ${BOUNTIES.postedMax} bounties running. Wait for one to finish, or cancel one.`,
    );
  }
  const have = econ.coins[actor] ?? 0;
  if (have < reward) return refuse("not_enough_coins", `You have ${coins(have)}.`);
  const given = econ.today.given[actor] ?? 0;
  if (given + reward > ECONOMY.giveCap) {
    return refuse(
      "gift_limit",
      `A bounty counts toward the ${coins(ECONOMY.giveCap)} you can give a day. You have ${coins(ECONOMY.giveCap - given)} left today.`,
    );
  }
  const at = { seq: state.seq + 1, day };
  return () => {
    const b: Bounty = {
      id: `b_${bounties.nextId}`,
      poster: actor,
      title,
      text,
      reward,
      status: "open",
      postedDay: day,
      expiresDay: day + BOUNTIES.openDays,
    };
    bounties.nextId += 1;
    bounties.list.push(b);
    econ.today.given[actor] = given + reward;
    return [
      movePurse(econ, actor, -reward, "bounty_held", at),
      { type: "bounty_posted", bounty: copy(b) },
    ];
  };
}

/** `claim_bounty {bounty}`: take an open bounty to work on. Not your own, and not as townsfolk. */
export function checkClaimBounty(
  state: WorldState,
  actor: ResidentId,
  command: Extract<Command, { type: "claim_bounty" }>,
): BountiesChecked {
  const open = opened(state);
  if ("code" in open) return open;
  const { bounties, day } = open;
  const b = running(state, command.bounty);
  if ("code" in b) return b;
  if (b.status !== "open") return refuse("bounty_not_open", "Someone is already on that one.");
  if (isTownsfolk(state, actor)) {
    return refuse("not_eligible", "Townsfolk don't take bounties. Their coins are the town's.");
  }
  if (b.proposal === undefined && b.poster === actor) {
    return refuse("own_bounty", "That's your own bounty.");
  }
  const held = bounties.list.filter(
    (x) => x.claimant === actor && (x.status === "claimed" || x.status === "done"),
  ).length;
  if (held >= BOUNTIES.claimsMax) {
    return refuse(
      "bounty_limit",
      `You're on ${BOUNTIES.claimsMax} bounties already. Finish or drop one first.`,
    );
  }
  return () => {
    b.status = "claimed";
    b.claimant = actor;
    b.claimedDay = day;
    return [{ type: "bounty_claimed", bounty: b.id, claimant: actor }];
  };
}

/**
 * `drop_bounty {bounty}`: the claimant lets go, or the poster of a resident's bounty sends the
 * claimant back. Either way it's open again.
 */
export function checkDropBounty(
  state: WorldState,
  actor: ResidentId,
  command: Extract<Command, { type: "drop_bounty" }>,
): BountiesChecked {
  const open = opened(state);
  if ("code" in open) return open;
  const b = running(state, command.bounty);
  if ("code" in b) return b;
  const claimant = b.claimant;
  if (claimant === undefined) return refuse("bounty_not_open", "Nobody has claimed it.");
  if (b.grant) return refuse("not_eligible", "A grant isn't a job to let go of.");
  const by =
    actor === claimant
      ? "claimant"
      : b.proposal === undefined && actor === b.poster
        ? "poster"
        : null;
  if (!by)
    return refuse("not_your_bounty", "Only its claimant, or the resident who posted it, can.");
  return () => {
    b.status = "open";
    clearClaim(b);
    return [{ type: "bounty_dropped", bounty: b.id, claimant, by }];
  };
}

/** `complete_bounty {bounty}`: the claimant says it's done. It pays once it's confirmed. */
export function checkCompleteBounty(
  state: WorldState,
  actor: ResidentId,
  command: Extract<Command, { type: "complete_bounty" }>,
): BountiesChecked {
  const open = opened(state);
  if ("code" in open) return open;
  const { day } = open;
  const b = running(state, command.bounty);
  if ("code" in b) return b;
  if (b.claimant !== actor) return refuse("not_your_bounty", "Claim it first.");
  if (b.status === "done") return refuse("bounty_not_open", "You already said it's done.");
  return () => {
    b.status = "done";
    b.doneDay = day;
    return [{ type: "bounty_done", bounty: b.id, claimant: actor }];
  };
}

/**
 * `confirm_bounty {bounty, to}`: the poster of a resident's bounty pays its claimant, `to`, from
 * what it holds. It counts toward what they receive today, unless they're an owner pair.
 */
export function checkConfirmBounty(
  state: WorldState,
  actor: ResidentId,
  command: Extract<Command, { type: "confirm_bounty" }>,
): BountiesChecked {
  const open = opened(state);
  if ("code" in open) return open;
  const { bounties, econ, day } = open;
  const b = running(state, command.bounty);
  if ("code" in b) return b;
  if (b.proposal !== undefined) {
    return refuse("not_eligible", "A maintainer confirms town bounties.");
  }
  if (b.poster !== actor) return refuse("not_your_bounty", "Only the resident who posted it can.");
  const to = b.claimant;
  if (to === undefined) return refuse("bounty_not_open", "Nobody has claimed it yet.");
  if (command.to !== to) return refuse("invalid_bounty", "That isn't who's working on it.");
  if (isTownsfolk(state, to)) return refuse("not_eligible", "Townsfolk aren't paid bounties.");
  const paired = pairSkipsCaps(state, actor, to);
  const received = econ.today.received[to] ?? 0;
  if (!paired && received >= ECONOMY.receiveCap) {
    return refuse(
      "gift_limit",
      `A resident can take in ${coins(ECONOMY.receiveCap)} from gifts, sales, and bounties a day, and they have today. Try tomorrow.`,
    );
  }
  const at = { seq: state.seq + 1, day };
  const points = bountyEarns(state, actor, to, b.reward);
  return () => {
    if (!paired) econ.today.received[to] = received + b.reward;
    const paid = movePurse(econ, to, b.reward, "bounty", at, { with: actor });
    finish(bounties, b, "paid", day);
    return [
      paid,
      { type: "bounty_paid", bounty: b.id, claimant: to, reward: b.reward },
      ...earned(points),
    ];
  };
}

/** `cancel_bounty {bounty}`: take back your own bounty while nobody has claimed it. */
export function checkCancelBounty(
  state: WorldState,
  actor: ResidentId,
  command: Extract<Command, { type: "cancel_bounty" }>,
): BountiesChecked {
  const open = opened(state);
  if ("code" in open) return open;
  const { bounties, econ, day } = open;
  const b = running(state, command.bounty);
  if ("code" in b) return b;
  if (b.proposal !== undefined) {
    return refuse("not_eligible", "Only a maintainer can cancel a town bounty.");
  }
  if (b.poster !== actor) return refuse("not_your_bounty", "Only the resident who posted it can.");
  if (b.status !== "open") {
    return refuse(
      "bounty_not_open",
      "Someone is working on it. Send them back with drop_bounty first, if you must.",
    );
  }
  const at = { seq: state.seq + 1, day };
  return () => {
    const back = giveBack(econ, b, at);
    finish(bounties, b, "cancelled", day);
    return [back, { type: "bounty_closed", bounty: b.id, status: "cancelled" }];
  };
}

// ---------- reading ----------

/** What a resident can send about one bounty. */
export const BOUNTY_MOVES = [
  "claim_bounty",
  "drop_bounty",
  "complete_bounty",
  "confirm_bounty",
  "cancel_bounty",
] as const;
export type BountyMove = (typeof BOUNTY_MOVES)[number];

/**
 * The moves `id` could make on a bounty right now, worked out with the same checks the commands
 * run, so a view never offers what the sim would refuse. Nothing changes.
 */
export function bountyMoves(state: WorldState, id: ResidentId, b: Bounty): BountyMove[] {
  if (!state.residents[id] || !isRunning(b)) return [];
  const bounty = b.id;
  const can = (checked: BountiesChecked) => typeof checked === "function";
  const moves: BountyMove[] = [];
  if (can(checkClaimBounty(state, id, { type: "claim_bounty", bounty })))
    moves.push("claim_bounty");
  if (can(checkDropBounty(state, id, { type: "drop_bounty", bounty }))) moves.push("drop_bounty");
  if (can(checkCompleteBounty(state, id, { type: "complete_bounty", bounty }))) {
    moves.push("complete_bounty");
  }
  const to = b.claimant ?? "";
  if (can(checkConfirmBounty(state, id, { type: "confirm_bounty", bounty, to }))) {
    moves.push("confirm_bounty");
  }
  if (can(checkCancelBounty(state, id, { type: "cancel_bounty", bounty })))
    moves.push("cancel_bounty");
  return moves;
}

/**
 * Why `id` can't post a bounty of `reward` now, or null when they can, from the same check
 * `post_bounty` runs.
 */
export function postBountyProblem(state: WorldState, id: ResidentId, reward = 1): string | null {
  if (!state.residents[id]) return "Join the world first.";
  const checked = checkPostBounty(state, id, { type: "post_bounty", title: "?", reward });
  return typeof checked === "function" ? null : checked.message;
}
