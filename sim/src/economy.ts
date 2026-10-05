import type {
  CoinReason,
  Command,
  EconomyState,
  EconomyToday,
  LedgerLine,
  Rejection,
  RejectionCode,
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
 * holds after every input.
 */

/**
 * The numbers. Every amount is a whole number of coins.
 *
 * `scripts/economy-sim.ts` plays a month of a few hundred residents with these numbers and prints
 * supply per active resident. Change a number here, rerun it, and record why in a decision
 * (decision 0037 has the reasoning behind the current ones).
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
  /** Ledger lines kept for each resident and for the treasury. */
  ledgerMax: 50,
} as const;

type Mutation = () => WorldEvent[];
export type EconomyChecked = Mutation | Rejection;

const refuse = (code: RejectionCode, message: string): Rejection => ({ code, message });
const isWhole = (n: unknown): n is number => typeof n === "number" && Number.isSafeInteger(n);
const coins = (n: number) => (n === 1 ? "1 coin" : `${n} coins`);

export const isTownsfolk = (state: WorldState, id: ResidentId) =>
  state.townsfolk?.includes(id) ?? false;
export const isMaintainer = (state: WorldState, id: ResidentId) =>
  state.maintainers?.includes(id) ?? false;

/** Whether two residents are an owner-linked pair, in either order. */
export function ownerPaired(state: WorldState, a: ResidentId, b: ResidentId): boolean {
  const [x, y] = a < b ? [a, b] : [b, a];
  return state.ownerPairs?.some(([p, q]) => p === x && q === y) ?? false;
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
interface At {
  seq: number;
  day: number;
}

/** Move coins in (positive) or out of a resident's purse, with a ledger line and a private event. */
function movePurse(
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
function moveTreasury(
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
  { type: "open_economy" | "set_owner_pairs" | "set_maintainers" }
>;

/** `open_economy`, `set_owner_pairs`, and `set_maintainers`, which only TOWN_ACTOR sends. */
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
          today: emptyToday(),
        };
        state.economy = econ;
        const opening = moveTreasury(econ, ECONOMY.treasuryOpening, "opening", at);
        return [{ type: "economy_opened", treasury: econ.treasury }, opening];
      };
    }

    case "set_owner_pairs": {
      const valid =
        Array.isArray(command.pairs) &&
        command.pairs.every(
          (p) =>
            Array.isArray(p) &&
            p.length === 2 &&
            p.every((id) => typeof id === "string" && id !== "") &&
            p[0] !== p[1],
        );
      if (!valid) {
        return refuse("server_only", "Owner pairs are a list of pairs of two different ids.");
      }
      const byKey = new Map<string, [ResidentId, ResidentId]>();
      for (const [a, b] of command.pairs) {
        const pair: [ResidentId, ResidentId] = a < b ? [a, b] : [b, a];
        byKey.set(JSON.stringify(pair), pair);
      }
      const order = (x: string, y: string) => (x < y ? -1 : x > y ? 1 : 0);
      const pairs = [...byKey.values()].sort((p, q) => order(p[0], q[0]) || order(p[1], q[1]));
      return () => {
        if (pairs.length > 0) state.ownerPairs = pairs;
        else delete state.ownerPairs;
        return [{ type: "owner_pairs_set", pairs: pairs.map(([a, b]) => [a, b]) }];
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
  }
}

/**
 * What `new_day` does to coins, or null before the economy opens: each townsfolk resident's
 * whole purse goes back to the treasury, the treasury mints, the gift caps reset, and each
 * townsfolk resident (in id order) gets their budget from what the treasury holds above the
 * reserve. All amounts are worked out here, before anything changes.
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
  const budgets: [ResidentId, number][] = [];
  for (const id of townsfolk) {
    if (!state.residents[id]) continue;
    const pay = Math.min(ECONOMY.townsfolkBudget, treasury - ECONOMY.budgetReserve);
    if (pay <= 0) break;
    budgets.push([id, pay]);
    treasury -= pay;
  }
  return () => {
    const events: WorldEvent[] = [];
    for (const [id, held] of returns) {
      events.push(movePurse(econ, id, -held, "budget_return", at));
      events.push(moveTreasury(econ, held, "budget_return", at, id));
    }
    econ.minted += ECONOMY.treasuryMint;
    events.push(moveTreasury(econ, ECONOMY.treasuryMint, "mint", at));
    econ.today = emptyToday();
    for (const [id, pay] of budgets) {
      events.push(moveTreasury(econ, -pay, "budget", at, id));
      events.push(movePurse(econ, id, pay, "budget", at));
    }
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
  return () =>
    leaving.flatMap(([id, held]) => [
      movePurse(econ, id, -held, "budget_return", at),
      moveTreasury(econ, held, "budget_return", at, id),
    ]);
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
  if (typeof to !== "string" || !state.residents[to]) {
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
  const paired = ownerPaired(state, actor, to);
  const given = econ.today.given[actor] ?? 0;
  const received = econ.today.received[to] ?? 0;
  if (!paired && given + amount > ECONOMY.giveCap) {
    return refuse(
      "gift_limit",
      `You can give ${coins(ECONOMY.giveCap)} a day. You have ${coins(ECONOMY.giveCap - given)} left to give today.`,
    );
  }
  // Their total is theirs: say no without saying how much they've had.
  if (!paired && received + amount > ECONOMY.receiveCap) {
    return refuse(
      "gift_limit",
      `A resident can receive ${coins(ECONOMY.receiveCap)} in gifts a day, and that would go over. Try fewer coins, or tomorrow.`,
    );
  }
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
 * The welcome gift `command` would pay `actor`, or null. Due on a resident's first plot by
 * `settle` or `claim` while the economy is open, once per resident ever, never to townsfolk.
 * When the treasury is short it pays what the treasury has, and the gift still counts as had.
 * Worked out before the command commits.
 */
export function welcomeDue(state: WorldState, actor: ResidentId, command: Command): number | null {
  const econ = state.economy;
  if (!econ || (command.type !== "settle" && command.type !== "claim")) return null;
  if (econ.welcomed.includes(actor) || isTownsfolk(state, actor)) return null;
  if (plotsOwnedBy(state, actor).length > 0) return null;
  return Math.min(ECONOMY.welcomeGift, econ.treasury);
}

/** Pay a welcome gift worked out by `welcomeDue`. */
export function payWelcome(
  state: WorldState,
  actor: ResidentId,
  amount: number,
  seq: number,
): WorldEvent[] {
  const econ = state.economy;
  if (!econ) return [];
  insertSorted(econ.welcomed, actor);
  if (amount <= 0) return [];
  const at = { seq, day: state.day ?? 0 };
  return [
    moveTreasury(econ, -amount, "welcome", at, actor),
    movePurse(econ, actor, amount, "welcome", at),
  ];
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
  if (me.x !== me.hearth.x || me.y !== me.hearth.y || !allowanceDue(state, id)) return [];
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
