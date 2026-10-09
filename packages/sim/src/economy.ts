import { coinCount as coins, isWhole, refuse } from "./check";
import { residentById } from "./own";
import type {
  CoinReason,
  Command,
  EconomyState,
  EconomyToday,
  LedgerLine,
  Rejection,
  ResidentId,
  WorldEvent,
  WorldState,
} from "./types";
import { plotsOwnedBy } from "./world";

/**
 * Coins (RFC 0008, phase 1): the treasury, purses, the daily allowance, the welcome gift,
 * townsfolk budgets, and gifts between residents.
 *
 * Nothing here runs until the server sends `open_economy`, so worlds from before coins replay to
 * the hash they always had. Coins are whole numbers, and `sum(coins) + treasury == minted - burned`
 * holds after every input, counting coins held in bounties (`bountyHeld`) and Commons bookings
 * (`eventHeld`) once those open.
 */

/**
 * The numbers. Every amount is a whole number of coins.
 *
 * `scripts/economy-sim.ts` plays a month of a few hundred residents with these numbers and prints
 * supply per active resident. Change a number here, rerun it, and record why in a decision
 * (decision 0039 has the reasoning behind the current ones).
 */
export const ECONOMY = {
  /** Coins the treasury opens with, minted by `open_economy`. */
  treasuryOpening: 5_000,
  /** Coins minted into the treasury at each `new_day`. */
  treasuryMint: 700,
  /** Minted the first time each day a resident stands on their own hearth. */
  allowance: 10,
  /** Days in a row of allowance that start the streak bonus. */
  streakDays: 7,
  /** Minted on top of the allowance on each day of a streak, from day `streakDays` on. */
  streakBonus: 5,
  /** Paid from the treasury the first time a resident gets a plot while the economy is open. */
  welcomeGift: 50,
  /** Each townsfolk resident's daily budget, from the treasury at `new_day`. */
  townsfolkBudget: 50,
  /**
   * Townsfolk budgets come only from what the treasury holds above this, so welcome gifts for
   * newcomers stay funded on a busy day.
   */
  budgetReserve: 1_000,
  /** The most all townsfolk together may give one resident in a day. */
  townsfolkPerResident: 25,
  /** The most a resident may give in gifts in a day. */
  giveCap: 200,
  /** The most a resident may receive in gifts in a day. */
  receiveCap: 500,
  /** Gift notes, in characters. */
  noteMax: 140,
  /**
   * The most appreciation coins one resident gets for one day: one for each resident who reacted
   * to their posts that day, counted by the server (decision 0055) and logged as `daily_awards`.
   * It may go up, never down: replay checks every logged award against it.
   */
  appreciationCap: 20,
  /** Ledger lines kept for each resident and for the treasury. */
  ledgerMax: 50,
} as const;

type Mutation = () => WorldEvent[];
export type EconomyChecked = Mutation | Rejection;

export const isTownsfolk = (state: WorldState, id: ResidentId) =>
  state.townsfolk?.includes(id) ?? false;
export const isMaintainer = (state: WorldState, id: ResidentId) =>
  state.maintainers?.includes(id) ?? false;

/** Whether two residents are an owner-linked pair, in either order. */
export function ownerPaired(state: WorldState, a: ResidentId, b: ResidentId): boolean {
  const [x, y] = a < b ? [a, b] : [b, a];
  return state.ownerPairs?.some(([p, q]) => p === x && q === y) ?? false;
}

/** The residents owner-linked to `id`. */
function linkedTo(state: WorldState, id: ResidentId): ResidentId[] {
  const linked: ResidentId[] = [];
  for (const [p, q] of state.ownerPairs ?? []) {
    if (p === id) linked.push(q);
    else if (q === id) linked.push(p);
  }
  return linked;
}

/**
 * Whether two residents are one household: the same resident, an owner-linked pair (a person and
 * their AI), or both linked to the same resident (two AIs of one person).
 */
export function sameHousehold(state: WorldState, a: ResidentId, b: ResidentId): boolean {
  if (a === b || ownerPaired(state, a, b)) return true;
  const ofA = linkedTo(state, a);
  return ofA.length > 0 && linkedTo(state, b).some((id) => ofA.includes(id));
}

/**
 * Whether a gift between two residents skips the daily caps: they're an owner pair, and the pair
 * has been linked since before today. A pair linked today is capped until tomorrow, so linking a
 * fresh account, giving, and unlinking can't be repeated in one day.
 */
export function pairSkipsCaps(state: WorldState, a: ResidentId, b: ResidentId): boolean {
  if (!ownerPaired(state, a, b)) return false;
  const [x, y] = a < b ? [a, b] : [b, a];
  const since = state.ownerPairDays?.[x]?.[y] ?? 0;
  return (state.day ?? 0) > since;
}

/** A resident's balance. 0 before the economy opens. */
export function coinsOf(state: WorldState, id: ResidentId): number {
  return state.economy?.coins[id] ?? 0;
}

/** What `GET /v1/purse` shows a resident. Private to them. */
export interface Purse {
  balance: number;
  /** Newest last. */
  ledger: LedgerLine[];
  /** Days in a row of allowance, counting today if it's been paid, else up to yesterday. */
  streak: number;
  /** Whether today's allowance has been paid. */
  allowanceToday: boolean;
  /** Coins given and received in gifts today, toward the daily caps. */
  givenToday: number;
  receivedToday: number;
  /** A resident's first day can receive gifts but not give. */
  firstDay: boolean;
  /** Waiting for a welcome gift the treasury couldn't pay in full yet. */
  welcomeOwed: boolean;
}

/** A resident's purse, or null before the economy opens. */
export function purseOf(state: WorldState, id: ResidentId): Purse | null {
  const econ = state.economy;
  if (!econ) return null;
  const day = state.day ?? 0;
  const last = econ.allowance[id];
  const current = last !== undefined && last.day >= day - 1;
  return {
    balance: econ.coins[id] ?? 0,
    ledger: (econ.ledgers[id] ?? []).map((l) => ({ ...l })),
    streak: current ? last.streak : 0,
    allowanceToday: last?.day === day,
    givenToday: econ.today.given[id] ?? 0,
    receivedToday: econ.today.received[id] ?? 0,
    firstDay: econ.today.newcomers.includes(id),
    welcomeOwed: econ.owed.includes(id),
  };
}

/** What the treasury shows everyone, or null before the economy opens. */
export function treasuryOf(
  state: WorldState,
): { balance: number; minted: number; burned: number; ledger: LedgerLine[] } | null {
  const econ = state.economy;
  if (!econ) return null;
  return {
    balance: econ.treasury,
    minted: econ.minted,
    burned: econ.burned,
    ledger: econ.treasuryLedger.map((l) => ({ ...l })),
  };
}

// ---------- moving coins ----------

const emptyToday = (): EconomyToday => ({
  given: {},
  received: {},
  fromTownsfolk: {},
  newcomers: [],
});

function addLine(lines: LedgerLine[], line: LedgerLine) {
  lines.push(line);
  if (lines.length > ECONOMY.ledgerMax) lines.splice(0, lines.length - ECONOMY.ledgerMax);
}

/** Who the coins went to or came from, and a gift's note. Absent fields stay absent. */
interface Other {
  with?: ResidentId;
  note?: string;
}

/** Where and when a movement happens: the input's seq and the day. */
export interface At {
  seq: number;
  day: number;
}

/** The share the shop opened with, before any `set_shop_share` (decision 0052). */
export const SHOP_SHARE_BEFORE = 50;

/**
 * The treasury's share of shop spending in this world right now, in percent: `shop.treasuryShare`
 * once the server logged `set_shop_share`, else `SHOP_SHARE_BEFORE`. A storey's price splits the
 * same way (RFC 0028).
 */
export const treasuryShareOf = (state: WorldState) =>
  state.shop?.treasuryShare ?? SHOP_SHARE_BEFORE;

/** Move coins in (positive) or out of a resident's purse, with a ledger line and a private event. */
export function movePurse(
  econ: EconomyState,
  id: ResidentId,
  amount: number,
  reason: CoinReason,
  at: At,
  other: Other = {},
): WorldEvent {
  const balance = (econ.coins[id] ?? 0) + amount;
  if (balance === 0) delete econ.coins[id];
  else econ.coins[id] = balance;
  const ledger = econ.ledgers[id] ?? [];
  addLine(ledger, { ...at, amount, reason, ...other });
  econ.ledgers[id] = ledger;
  return { type: "coins", residentId: id, amount, balance, reason, ...other };
}

/** Move coins in (positive) or out of the treasury, with a ledger line and a public event. */
export function moveTreasury(
  econ: EconomyState,
  amount: number,
  reason: CoinReason,
  at: At,
  residentId?: ResidentId,
): WorldEvent {
  econ.treasury += amount;
  const who = residentId === undefined ? {} : { residentId };
  addLine(econ.treasuryLedger, {
    ...at,
    amount,
    reason,
    ...(residentId === undefined ? {} : { with: residentId }),
  });
  return { type: "treasury", amount, balance: econ.treasury, reason, ...who };
}

/** Insert into a sorted list, keeping it sorted. */
function insertSorted(list: ResidentId[], id: ResidentId) {
  if (list.includes(id)) return;
  list.push(id);
  list.sort();
}

// ---------- server inputs ----------

type EconomyServerCommand = Extract<
  Command,
  {
    type:
      | "open_economy"
      | "set_owner_pairs"
      | "add_owner_pair"
      | "remove_owner_pair"
      | "set_maintainers"
      | "daily_awards";
  }
>;

/** Two different, non-empty ids. */
const isPair = (p: unknown): p is [ResidentId, ResidentId] =>
  Array.isArray(p) &&
  p.length === 2 &&
  p.every((id) => typeof id === "string" && id !== "") &&
  p[0] !== p[1];

const sortPair = (a: ResidentId, b: ResidentId): [ResidentId, ResidentId] =>
  a < b ? [a, b] : [b, a];

const order = (x: string, y: string) => (x < y ? -1 : x > y ? 1 : 0);
const comparePairs = (p: [ResidentId, ResidentId], q: [ResidentId, ResidentId]) =>
  order(p[0], q[0]) || order(p[1], q[1]);

/**
 * The day a pair new in this input is stamped with: today, except before coins open or before
 * the world counts days. Those links predate the wait-a-day rule, so they count from day 0.
 */
const pairStamp = (state: WorldState) =>
  state.economy === undefined || state.day === undefined ? 0 : state.day;

/** A copy of the pair days to change in a check, so nothing is touched until commit. */
function copyPairDays(state: WorldState): Record<ResidentId, Record<ResidentId, number>> {
  const days: Record<ResidentId, Record<ResidentId, number>> = {};
  for (const [a, inner] of Object.entries(state.ownerPairDays ?? {})) days[a] = { ...inner };
  return days;
}

/**
 * `open_economy`, the owner-pair commands, `set_maintainers`, and `daily_awards`, which only
 * TOWN_ACTOR sends.
 */
export function checkEconomyServer(
  state: WorldState,
  command: EconomyServerCommand,
): EconomyChecked {
  switch (command.type) {
    case "open_economy": {
      if (state.economy) return refuse("already_open", "Coins are already open.");
      const day = state.day;
      if (day === undefined) {
        return refuse("not_due", "Coins open once the world starts counting days.");
      }
      const at = { seq: state.seq + 1, day };
      // Anyone who already has a plot settled before coins: no welcome gift for them.
      const welcomed = [...new Set(Object.values(state.plots).map((p) => p.ownerId))].sort();
      return () => {
        const econ: EconomyState = {
          treasury: 0,
          minted: ECONOMY.treasuryOpening,
          burned: 0,
          coins: {},
          ledgers: {},
          treasuryLedger: [],
          allowance: {},
          welcomed,
          owed: [],
          today: emptyToday(),
        };
        state.economy = econ;
        const opening = moveTreasury(econ, ECONOMY.treasuryOpening, "opening", at);
        return [{ type: "economy_opened", treasury: econ.treasury }, opening];
      };
    }

    case "set_owner_pairs": {
      const valid = Array.isArray(command.pairs) && command.pairs.every(isPair);
      if (!valid) {
        return refuse("server_only", "Owner pairs are a list of pairs of two different ids.");
      }
      const byKey = new Map<string, [ResidentId, ResidentId]>();
      for (const [a, b] of command.pairs) {
        const pair = sortPair(a, b);
        byKey.set(JSON.stringify(pair), pair);
      }
      const pairs = [...byKey.values()].sort(comparePairs);
      // A pair keeps the day it first appeared. A new one is stamped with `pairStamp`.
      const days: Record<ResidentId, Record<ResidentId, number>> = {};
      for (const [a, b] of pairs) {
        const since = state.ownerPairDays?.[a]?.[b] ?? pairStamp(state);
        days[a] = { ...days[a], [b]: since };
      }
      return () => {
        if (pairs.length > 0) state.ownerPairs = pairs;
        else delete state.ownerPairs;
        state.ownerPairDays = days;
        return [{ type: "owner_pairs_set", pairs: pairs.map(([a, b]) => [a, b]) }];
      };
    }

    // One pair at a time, so each link or unlink logs one small input. They leave the world
    // exactly as `set_owner_pairs` with the whole new list would, day stamps included.
    case "add_owner_pair": {
      if (!isPair(command.pair)) {
        return refuse("server_only", "An owner pair is two different ids.");
      }
      const [a, b] = sortPair(command.pair[0], command.pair[1]);
      if (ownerPaired(state, a, b)) {
        return refuse("server_only", "Those two are already an owner pair.");
      }
      const pairs = [...(state.ownerPairs ?? []), [a, b] as [ResidentId, ResidentId]].sort(
        comparePairs,
      );
      const days = copyPairDays(state);
      days[a] = { ...days[a], [b]: pairStamp(state) };
      return () => {
        state.ownerPairs = pairs;
        state.ownerPairDays = days;
        return [{ type: "owner_pair_added", pair: [a, b] }];
      };
    }

    case "remove_owner_pair": {
      if (!isPair(command.pair)) {
        return refuse("server_only", "An owner pair is two different ids.");
      }
      const [a, b] = sortPair(command.pair[0], command.pair[1]);
      if (!ownerPaired(state, a, b)) {
        return refuse("server_only", "Those two aren't an owner pair.");
      }
      const pairs = (state.ownerPairs ?? []).filter(([p, q]) => p !== a || q !== b);
      // Unlinking forgets the day, so linking again starts the wait over.
      const days = copyPairDays(state);
      delete days[a]?.[b];
      if (Object.keys(days[a] ?? {}).length === 0) delete days[a];
      return () => {
        if (pairs.length > 0) state.ownerPairs = pairs;
        else delete state.ownerPairs;
        state.ownerPairDays = days;
        return [{ type: "owner_pair_removed", pair: [a, b] }];
      };
    }

    case "set_maintainers": {
      if (!Array.isArray(command.ids) || command.ids.some((id) => typeof id !== "string")) {
        return refuse("server_only", "Maintainers are a list of resident ids.");
      }
      const ids = [...new Set(command.ids)].sort();
      return () => {
        if (ids.length > 0) state.maintainers = ids;
        else delete state.maintainers;
        return [{ type: "maintainers_set", ids: [...ids] }];
      };
    }

    case "daily_awards":
      return checkDailyAwards(state, command);
  }
}

/**
 * `daily_awards {day, awards}`: coins the server counted from social data for one past day
 * (decision 0055), minted into each resident's purse. Each day is awarded at most once, in order,
 * so a restart can't pay a day twice. An empty list still marks the day as done.
 */
function checkDailyAwards(
  state: WorldState,
  command: Extract<Command, { type: "daily_awards" }>,
): EconomyChecked {
  const econ = state.economy;
  const today = state.day;
  if (!econ || today === undefined) return refuse("economy_closed", "Coins aren't open yet.");
  const { day, awards } = command;
  if (!isWhole(day) || day >= today) {
    return refuse("server_only", "Awards are for a day that has ended.");
  }
  if (econ.awardedDay !== undefined && day <= econ.awardedDay) {
    return refuse("server_only", `Awards are already done through day ${econ.awardedDay}.`);
  }
  if (!Array.isArray(awards)) return refuse("server_only", "Awards are a list.");
  const seen = new Set<ResidentId>();
  for (const award of awards) {
    const { to, amount, reason } = award ?? {};
    if (reason !== "appreciation") return refuse("server_only", "Unknown award reason.");
    if (!residentById(state, to) || seen.has(to as ResidentId)) {
      return refuse("server_only", "Each award goes to a different resident who exists.");
    }
    if (isTownsfolk(state, to)) return refuse("server_only", "Townsfolk don't get awards.");
    if (!isWhole(amount) || amount < 1 || amount > ECONOMY.appreciationCap) {
      return refuse(
        "server_only",
        `An appreciation award is 1 to ${ECONOMY.appreciationCap} coins.`,
      );
    }
    seen.add(to);
  }
  const at = { seq: state.seq + 1, day: today };
  const paid = awards.map(({ to, amount }) => [to, amount] as const);
  return () => {
    econ.awardedDay = day;
    return paid.map(([to, amount]) => {
      econ.minted += amount;
      return movePurse(econ, to, amount, "appreciation", at);
    });
  };
}

/**
 * What `new_day` does to coins, or null before the economy opens: each townsfolk resident's
 * whole purse goes back to the treasury, the treasury mints, welcome gifts still owed are paid in
 * full in the order they were owed, the gift caps reset, and each townsfolk resident (in id order)
 * gets their budget from what the treasury holds above the reserve. All amounts are worked out
 * here, before anything changes.
 *
 * The treasury's history is public, so the returns and the budgets are one line each for all
 * townsfolk together: a line per townsfolk resident would show what they gave and were given.
 */
export function economyNewDay(state: WorldState, day: number): Mutation | null {
  const econ = state.economy;
  if (!econ) return null;
  const at = { seq: state.seq + 1, day };
  const townsfolk = state.townsfolk ?? [];
  const returns: [ResidentId, number][] = [];
  let treasury = econ.treasury + ECONOMY.treasuryMint;
  for (const id of townsfolk) {
    const held = econ.coins[id] ?? 0;
    if (held > 0) {
      returns.push([id, held]);
      treasury += held;
    }
  }
  const returned = returns.reduce((sum, [, held]) => sum + held, 0);
  // Owed welcome gifts, oldest first, each only in full. One that can't be paid holds up the
  // rest, so nobody jumps the queue. Townsfolk never get one, so any in the queue drop out.
  const welcomes: ResidentId[] = [];
  const stillOwed: ResidentId[] = [];
  for (const id of econ.owed) {
    if (isTownsfolk(state, id)) continue;
    if (stillOwed.length === 0 && treasury >= ECONOMY.welcomeGift) {
      welcomes.push(id);
      treasury -= ECONOMY.welcomeGift;
    } else stillOwed.push(id);
  }
  const budgets: [ResidentId, number][] = [];
  for (const id of townsfolk) {
    if (!state.residents[id]) continue;
    const pay = Math.min(ECONOMY.townsfolkBudget, treasury - ECONOMY.budgetReserve);
    if (pay <= 0) break;
    budgets.push([id, pay]);
    treasury -= pay;
  }
  const budgeted = budgets.reduce((sum, [, pay]) => sum + pay, 0);
  return () => {
    const events: WorldEvent[] = [];
    for (const [id, held] of returns) {
      events.push(movePurse(econ, id, -held, "budget_return", at));
    }
    if (returned > 0) events.push(moveTreasury(econ, returned, "budget_return", at));
    econ.minted += ECONOMY.treasuryMint;
    events.push(moveTreasury(econ, ECONOMY.treasuryMint, "mint", at));
    for (const id of welcomes) events.push(...welcome(econ, id, at));
    econ.owed = stillOwed;
    econ.today = emptyToday();
    if (budgeted > 0) events.push(moveTreasury(econ, -budgeted, "budget", at));
    for (const [id, pay] of budgets) events.push(movePurse(econ, id, pay, "budget", at));
    return events;
  };
}

/**
 * What `set_townsfolk` does to coins, or null when nothing moves: a resident leaving the
 * townsfolk hands what's left of their budget back to the treasury right away.
 */
export function economyTownsfolkChange(state: WorldState, ids: ResidentId[]): Mutation | null {
  const econ = state.economy;
  if (!econ) return null;
  const at = { seq: state.seq + 1, day: state.day ?? 0 };
  const leaving = (state.townsfolk ?? [])
    .filter((id) => !ids.includes(id))
    .flatMap((id): [ResidentId, number][] => {
      const held = econ.coins[id] ?? 0;
      return held > 0 ? [[id, held]] : [];
    });
  if (leaving.length === 0) return null;
  const returned = leaving.reduce((sum, [, held]) => sum + held, 0);
  return () => [
    ...leaving.map(([id, held]) => movePurse(econ, id, -held, "budget_return", at)),
    moveTreasury(econ, returned, "budget_return", at),
  ];
}

// ---------- gifts ----------

/** `give_coins {to, amount, note?}`. */
export function checkGive(
  state: WorldState,
  actor: ResidentId,
  command: Extract<Command, { type: "give_coins" }>,
): EconomyChecked {
  const econ = state.economy;
  const day = state.day;
  if (!econ || day === undefined) return refuse("economy_closed", "Coins aren't open yet.");
  const { to, amount, note } = command;
  if (!isWhole(amount) || amount < 1) {
    return refuse("invalid_amount", "Give a whole number of coins, at least 1.");
  }
  if (note !== undefined && (typeof note !== "string" || note.length > ECONOMY.noteMax)) {
    return refuse("invalid_gift", `A note is text, at most ${ECONOMY.noteMax} characters.`);
  }
  if (!residentById(state, to)) {
    return refuse("unknown_resident", "Nobody in the world has that id.");
  }
  if (to === actor) return refuse("invalid_gift", "You can't give coins to yourself.");
  const fromTownsfolk = isTownsfolk(state, actor);
  if (fromTownsfolk && (isTownsfolk(state, to) || isMaintainer(state, to))) {
    return refuse("invalid_gift", "Townsfolk don't give coins to townsfolk or maintainers.");
  }
  if (econ.today.newcomers.includes(actor)) {
    return refuse(
      "gift_limit",
      "You can give coins from your second day. You can receive them today.",
    );
  }
  const have = econ.coins[actor] ?? 0;
  if (have < amount) return refuse("not_enough_coins", `You have ${coins(have)}.`);
  const paired = pairSkipsCaps(state, actor, to);
  const given = econ.today.given[actor] ?? 0;
  const received = econ.today.received[to] ?? 0;
  if (!paired && given + amount > ECONOMY.giveCap) {
    return refuse(
      "gift_limit",
      `You can give ${coins(ECONOMY.giveCap)} a day. You have ${coins(ECONOMY.giveCap - given)} left to give today.`,
    );
  }
  // Their total is theirs. Refusing only once they're already at the cap means a refusal never
  // depends on this gift's amount, so trying amounts can't measure what they've had today. The
  // gift that crosses the cap goes through.
  if (!paired && received >= ECONOMY.receiveCap) {
    return refuse(
      "gift_limit",
      `A resident can receive ${coins(ECONOMY.receiveCap)} in gifts a day, and they've had that today. Try tomorrow.`,
    );
  }
  // This one stays exact: only townsfolk (run by the team) can hit it, so there's nobody to hide
  // the total from, and it keeps the treasury's daily cost per resident fixed.
  const tipped = econ.today.fromTownsfolk[to] ?? 0;
  if (fromTownsfolk && tipped + amount > ECONOMY.townsfolkPerResident) {
    return refuse(
      "gift_limit",
      `Townsfolk give one resident at most ${coins(ECONOMY.townsfolkPerResident)} a day, together. ${coins(ECONOMY.townsfolkPerResident - tipped)} left for them today.`,
    );
  }
  const at = { seq: state.seq + 1, day };
  const withNote = typeof note === "string" && note !== "" ? { note } : {};
  return () => {
    if (!paired) {
      econ.today.given[actor] = given + amount;
      econ.today.received[to] = received + amount;
    }
    if (fromTownsfolk) econ.today.fromTownsfolk[to] = tipped + amount;
    return [
      movePurse(econ, actor, -amount, "gift_out", at, { with: to, ...withNote }),
      movePurse(econ, to, amount, "gift_in", at, { with: actor, ...withNote }),
    ];
  };
}

// ---------- bookkeeping on residents' own inputs ----------

/**
 * Whether `command` gives `actor` a welcome gift now ("pay"), puts them in line for one ("owe"),
 * or neither (null). Due on a resident's first plot by `settle` or `claim` while the economy is
 * open, once per resident ever, never to townsfolk. It's only ever paid in full: when the treasury
 * can't, or others are already waiting, the resident joins the end of the line and `new_day` pays
 * it. Worked out before the command commits.
 */
export function welcomeDue(
  state: WorldState,
  actor: ResidentId,
  command: Command,
): "pay" | "owe" | null {
  const econ = state.economy;
  if (!econ || (command.type !== "settle" && command.type !== "claim")) return null;
  if (econ.welcomed.includes(actor) || econ.owed.includes(actor)) return null;
  if (isTownsfolk(state, actor) || plotsOwnedBy(state, actor).length > 0) return null;
  return econ.owed.length === 0 && econ.treasury >= ECONOMY.welcomeGift ? "pay" : "owe";
}

/** Pay a welcome gift in full from the treasury, and count it as had. */
function welcome(econ: EconomyState, id: ResidentId, at: At): WorldEvent[] {
  insertSorted(econ.welcomed, id);
  return [
    moveTreasury(econ, -ECONOMY.welcomeGift, "welcome", at, id),
    movePurse(econ, id, ECONOMY.welcomeGift, "welcome", at),
  ];
}

/**
 * Carry out what `welcomeDue` decided. Joining the line has no event: the purse shows
 * `welcomeOwed`, and the gift's own events come when `new_day` pays it.
 */
export function payWelcome(
  state: WorldState,
  actor: ResidentId,
  due: "pay" | "owe",
  seq: number,
): WorldEvent[] {
  const econ = state.economy;
  if (!econ) return [];
  if (due === "owe") {
    econ.owed.push(actor);
    return [];
  }
  return welcome(econ, actor, { seq, day: state.day ?? 0 });
}

/**
 * Whether `id` would get today's allowance by standing on their hearth: the economy is open, the
 * world counts days, they have a hearth, they aren't townsfolk, and they haven't had it today.
 */
export function allowanceDue(state: WorldState, id: ResidentId): boolean {
  const econ = state.economy;
  if (!econ || state.day === undefined || isTownsfolk(state, id)) return false;
  if (!state.residents[id]?.hearth) return false;
  return econ.allowance[id]?.day !== state.day;
}

/**
 * After a resident's accepted input: if it leaves them standing on their own hearth and today's
 * allowance is due, mint it, plus the streak bonus from the `streakDays`th day in a row.
 */
export function payAllowance(state: WorldState, id: ResidentId, seq: number): WorldEvent[] {
  const econ = state.economy;
  const day = state.day;
  const me = state.residents[id];
  if (!econ || day === undefined || !me?.hearth) return [];
  // On the hearth means on the ground floor too, never standing over it upstairs (RFC 0028).
  if (me.x !== me.hearth.x || me.y !== me.hearth.y || me.storey !== undefined) return [];
  if (!allowanceDue(state, id)) return [];
  const last = econ.allowance[id];
  const streak = last?.day === day - 1 ? last.streak + 1 : 1;
  econ.allowance[id] = { day, streak };
  const at = { seq, day };
  econ.minted += ECONOMY.allowance;
  const events = [movePurse(econ, id, ECONOMY.allowance, "allowance", at)];
  if (streak >= ECONOMY.streakDays) {
    econ.minted += ECONOMY.streakBonus;
    events.push(movePurse(econ, id, ECONOMY.streakBonus, "streak", at));
  }
  return events;
}

/** Note a resident who first joined the world today, while the economy is open. */
export function markNewcomer(state: WorldState, id: ResidentId) {
  if (state.economy) insertSorted(state.economy.today.newcomers, id);
}
