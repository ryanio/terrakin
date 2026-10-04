/**
 * Coins numbers simulation (RFC 0008). Plays a month of a few hundred residents arriving in a
 * world whose economy has just opened, and prints supply per active resident each day.
 *
 *   node scripts/economy-sim.ts [--seed 1] [--days 30] [--residents 300] [--set key=value ...]
 *
 *   --seed       PRNG seed, so a run repeats exactly (default 1)
 *   --days       days to play (default 30)
 *   --residents  residents who arrive over those days, not counting the townsfolk (default 300)
 *   --set        try a different number from ECONOMY without editing it, e.g. --set allowance=8
 *
 * The numbers come from ECONOMY in sim/src/economy.ts, so the script and the sim can't drift.
 * Change a number there, rerun this, and record why in a decision (decision 0037).
 */
import { registerHooks } from "node:module";
import { parseArgs } from "node:util";

// The sim imports its own files without extensions, which Node does not resolve. Same hook as gen.ts.
registerHooks({
  resolve(specifier, context, nextResolve) {
    try {
      return nextResolve(specifier, context);
    } catch (err) {
      if (!/^\.\.?\//.test(specifier) || /\.[cm]?[jt]s$/.test(specifier)) throw err;
      return nextResolve(`${specifier}.ts`, context);
    }
  },
});

const { ECONOMY } = await import("../sim/src/economy.ts");

type Numbers = { -readonly [K in keyof typeof ECONOMY]: number };

const { values: args } = parseArgs({
  options: {
    seed: { type: "string", default: "1" },
    days: { type: "string", default: "30" },
    residents: { type: "string", default: "300" },
    set: { type: "string", multiple: true, default: [] },
  },
});

const N: Numbers = { ...ECONOMY };
for (const pair of args.set ?? []) {
  const [key, value] = pair.split("=");
  if (!key || !(key in N) || !value || !Number.isInteger(Number(value))) {
    throw new Error(`--set wants key=whole-number with a key from ECONOMY, got ${pair}`);
  }
  N[key as keyof Numbers] = Number(value);
}
const SEED = Number(args.seed);
const DAYS = Number(args.days);
const RESIDENTS = Number(args.residents);

// ---------- seeded randomness ----------

/** mulberry32: small, fast, and the same sequence on every machine for a given seed. */
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const random = mulberry32(SEED);
const chance = (p: number) => random() < p;
const between = (lo: number, hi: number) => lo + Math.floor(random() * (hi - lo + 1));
function pick<T>(list: readonly T[]): T | undefined {
  return list[Math.floor(random() * list.length)];
}

// ---------- the rules ----------

/** What the population needs from the economy. One implementation follows the RFC's rules. */
interface Rules {
  open(): void;
  newDay(day: number): void;
  join(id: string): void;
  /** Settle a first plot and build a starter home, which sets a hearth. */
  settle(id: string): void;
  /** Stand on your own hearth. */
  home(id: string): void;
  give(from: string, to: string, amount: number): boolean;
  setTownsfolk(ids: string[]): void;
  setOwnerPairs(pairs: [string, string][]): void;
  balance(id: string): number;
  treasury(): number;
  minted(): number;
  burned(): number;
}

/** The phase 1 rules, as RFC 0008 and decision 0037 describe them. */
function modelRules(): Rules {
  let day = 0;
  let treasury = 0;
  let minted = 0;
  const burned = 0;
  const coins = new Map<string, number>();
  const streaks = new Map<string, { day: number; streak: number }>();
  const welcomed = new Set<string>();
  const hasHearth = new Set<string>();
  const known = new Set<string>();
  let newcomers = new Set<string>();
  let given = new Map<string, number>();
  let received = new Map<string, number>();
  let fromTownsfolk = new Map<string, number>();
  let townsfolk: string[] = [];
  let pairs = new Set<string>();
  const add = (id: string, n: number) => coins.set(id, (coins.get(id) ?? 0) + n);
  const isTownsfolk = (id: string) => townsfolk.includes(id);
  return {
    open() {
      treasury += N.treasuryOpening;
      minted += N.treasuryOpening;
    },
    newDay(d) {
      day = d;
      for (const id of townsfolk) {
        treasury += coins.get(id) ?? 0;
        coins.delete(id);
      }
      treasury += N.treasuryMint;
      minted += N.treasuryMint;
      newcomers = new Set();
      given = new Map();
      received = new Map();
      fromTownsfolk = new Map();
      for (const id of [...townsfolk].sort()) {
        const pay = Math.min(N.townsfolkBudget, treasury - N.budgetReserve);
        if (pay <= 0) break;
        treasury -= pay;
        add(id, pay);
      }
    },
    join(id) {
      if (!known.has(id)) newcomers.add(id);
      known.add(id);
    },
    settle(id) {
      hasHearth.add(id);
      if (welcomed.has(id) || isTownsfolk(id)) return;
      welcomed.add(id);
      const pay = Math.min(N.welcomeGift, treasury);
      treasury -= pay;
      add(id, pay);
    },
    home(id) {
      if (!hasHearth.has(id) || isTownsfolk(id)) return;
      const last = streaks.get(id);
      if (last?.day === day) return;
      const streak = last?.day === day - 1 ? last.streak + 1 : 1;
      streaks.set(id, { day, streak });
      const pay = N.allowance + (streak >= N.streakDays ? N.streakBonus : 0);
      add(id, pay);
      minted += pay;
    },
    give(from, to, amount) {
      if (from === to || newcomers.has(from) || (coins.get(from) ?? 0) < amount) return false;
      const paired = pairs.has([from, to].sort().join(">"));
      if (!paired) {
        if ((given.get(from) ?? 0) + amount > N.giveCap) return false;
        if ((received.get(to) ?? 0) + amount > N.receiveCap) return false;
      }
      if (isTownsfolk(from)) {
        if (isTownsfolk(to)) return false;
        if ((fromTownsfolk.get(to) ?? 0) + amount > N.townsfolkPerResident) return false;
        fromTownsfolk.set(to, (fromTownsfolk.get(to) ?? 0) + amount);
      }
      if (!paired) {
        given.set(from, (given.get(from) ?? 0) + amount);
        received.set(to, (received.get(to) ?? 0) + amount);
      }
      add(from, -amount);
      add(to, amount);
      return true;
    },
    setTownsfolk(ids) {
      townsfolk = [...ids];
    },
    setOwnerPairs(list) {
      pairs = new Set(list.map((p) => [...p].sort().join(">")));
    },
    balance: (id) => coins.get(id) ?? 0,
    treasury: () => treasury,
    minted: () => minted,
    burned: () => burned,
  };
}

// ---------- the population ----------

/**
 * How often each kind of resident comes back. Regulars nearly every day, visitors every few days,
 * drifters keen at first and then fading, one-timers never after their first day.
 */
const KINDS = {
  regular: { share: 0.3, visit: () => 0.92 },
  visitor: { share: 0.3, visit: () => 0.3 },
  drifter: { share: 0.25, visit: (age: number) => 0.85 * 0.8 ** age },
  oneday: { share: 0.15, visit: () => 0 },
} as const;
type Kind = keyof typeof KINDS;

interface Person {
  id: string;
  kind: Kind;
  arrives: number;
  settles: boolean;
  /** A generous resident gives small gifts more often. */
  giving: number;
}

const TOWNSFOLK = ["t_bram", "t_clem", "t_dot", "t_fern", "t_hale", "t_ivy", "t_juno", "t_moss"];
/** Share of each townsfolk budget their scripts actually hand out on a typical day. */
const TOWNSFOLK_SPEND = 0.8;
/** Owner-linked pairs among the arrivals: a person and their AI. */
const PAIRS = 20;

function population(): Person[] {
  const people: Person[] = [];
  for (let i = 0; i < RESIDENTS; i++) {
    const r = random();
    let kind: Kind = "oneday";
    let acc = 0;
    for (const k of Object.keys(KINDS) as Kind[]) {
      acc += KINDS[k].share;
      if (r < acc) {
        kind = k;
        break;
      }
    }
    people.push({
      id: `r_${String(i).padStart(3, "0")}`,
      kind,
      // A launch bump: arrivals lean toward the first days, then settle into a steady trickle.
      arrives: Math.min(DAYS - 1, Math.floor(DAYS * random() ** 1.4)),
      settles: chance(0.85),
      giving: chance(0.2) ? 0.3 : 0.06,
    });
  }
  return people;
}

// ---------- the month ----------

interface Row {
  day: number;
  arrived: number;
  active: number;
  supply: number;
  treasury: number;
  held: number;
  perActive: number;
  mint: number;
  townPaid: number;
}

const townCoins = (rules: Rules) =>
  TOWNSFOLK.reduce((sum, id) => sum + rules.balance(id), rules.treasury());

function play(rules: Rules) {
  const people = population();
  const byId = new Map(people.map((p) => [p.id, p]));
  const pairs: [string, string][] = [];
  const unpaired = people.map((p) => p.id);
  for (let i = 0; i < PAIRS && unpaired.length >= 2; i++) {
    const a = unpaired.splice(Math.floor(random() * unpaired.length), 1)[0] ?? "";
    const b = unpaired.splice(Math.floor(random() * unpaired.length), 1)[0] ?? "";
    pairs.push([a, b]);
  }
  for (const id of TOWNSFOLK) rules.join(id);
  rules.setTownsfolk(TOWNSFOLK);
  rules.setOwnerPairs(pairs);

  const rows: Row[] = [];
  let shortWelcomes = 0;
  const settled = new Set<string>();
  rules.open();
  for (let day = 0; day < DAYS; day++) {
    const mintedBefore = rules.minted();
    // The town's coins are the treasury plus the townsfolk purses it funds. What they lose in a
    // day, beyond the mint, went to residents as welcome gifts and townsfolk tips.
    const townBefore = townCoins(rules);
    // The economy opens partway through day 0, so day 0 has no new_day of its own.
    if (day > 0) rules.newDay(day);
    const townMint = day > 0 ? N.treasuryMint : 0;

    const active: string[] = [];
    const arrived: string[] = [];
    for (const p of people) {
      if (p.arrives === day) {
        rules.join(p.id);
        arrived.push(p.id);
        active.push(p.id);
        if (p.settles) {
          rules.settle(p.id);
          if (rules.balance(p.id) < N.welcomeGift) shortWelcomes++;
          settled.add(p.id);
          rules.home(p.id);
        }
      } else if (p.arrives < day && chance(KINDS[p.kind].visit(day - p.arrives))) {
        active.push(p.id);
        if (settled.has(p.id)) rules.home(p.id);
      }
    }

    // Residents tip each other now and then. Not on their first day: the rules refuse that.
    const veterans = active.filter((id) => !arrived.includes(id));
    for (const id of veterans) {
      const p = byId.get(id);
      if (!p || !chance(p.giving)) continue;
      const to = pick(active.filter((other) => other !== id));
      const amount = Math.min(rules.balance(id), between(5, 30));
      if (to && amount > 0) rules.give(id, to, amount);
    }
    // An AI saving up for its person, or the other way round. Pairs skip the daily caps.
    for (const [a, b] of pairs) {
      if (!active.includes(a) || !chance(0.1)) continue;
      const amount = Math.min(rules.balance(a), between(10, 60));
      if (amount > 0) rules.give(a, b, amount);
    }

    // Townsfolk scripts: a welcome tip for each newcomer, then tips for active residents.
    const spent = new Map<string, number>();
    const tfGive = (from: string, to: string, amount: number) => {
      if (rules.balance(from) < amount) return false;
      const ok = rules.give(from, to, amount);
      if (ok) spent.set(from, (spent.get(from) ?? 0) + amount);
      return ok;
    };
    arrived.forEach((id, i) => {
      const from = TOWNSFOLK[i % TOWNSFOLK.length] ?? "";
      tfGive(from, id, 10);
    });
    for (const from of TOWNSFOLK) {
      const target = Math.floor(N.townsfolkBudget * TOWNSFOLK_SPEND);
      for (let tries = 0; tries < 20 && (spent.get(from) ?? 0) < target; tries++) {
        const to = pick(active);
        const amount = Math.min(between(5, 15), target - (spent.get(from) ?? 0));
        if (to && amount > 0) tfGive(from, to, amount);
      }
    }

    let held = 0;
    for (const p of people) held += rules.balance(p.id);
    const supply = rules.minted() - rules.burned();
    rows.push({
      day,
      arrived: arrived.length,
      active: active.length,
      supply,
      treasury: rules.treasury(),
      held,
      perActive: active.length ? Math.round(held / active.length) : 0,
      mint: rules.minted() - mintedBefore,
      townPaid: townBefore + townMint - townCoins(rules),
    });

    // The ledger must balance every day: everything minted is in a purse or the treasury.
    let inPurses = held;
    for (const id of TOWNSFOLK) inPurses += rules.balance(id);
    if (inPurses + rules.treasury() !== supply) {
      throw new Error(
        `Day ${day}: purses + treasury = ${inPurses + rules.treasury()}, supply ${supply}`,
      );
    }
  }
  return { rows, people, shortWelcomes };
}

// ---------- report ----------

const pad = (v: string | number, n: number) => String(v).padStart(n);
const percentile = (sorted: number[], q: number) =>
  sorted.length ? (sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? 0) : 0;

function report(rules: Rules) {
  const { rows, people, shortWelcomes } = play(rules);
  console.log(
    `Economy simulation: seed ${SEED}, ${DAYS} days, ${RESIDENTS} residents + 8 townsfolk`,
  );
  console.log(
    Object.entries(N)
      .map(([k, v]) => `${k}=${v}`)
      .join(" "),
  );
  console.log("");
  console.log(
    "day  new  active   supply  treasury  held(res)  per active  minted today  town paid",
  );
  for (const r of rows) {
    console.log(
      [
        pad(r.day, 3),
        pad(r.arrived, 4),
        pad(r.active, 7),
        pad(r.supply, 8),
        pad(r.treasury, 9),
        pad(r.held, 10),
        pad(r.perActive, 11),
        pad(r.mint, 13),
        pad(r.townPaid, 10),
      ].join("  "),
    );
  }
  const purses = (kind: Kind, arrivedBy: number) =>
    people
      .filter((p) => p.kind === kind && p.settles && p.arrives <= arrivedBy)
      .map((p) => rules.balance(p.id))
      .sort((a, b) => a - b);
  console.log("");
  console.log("Month-end purses (settled residents who arrived in the first week):");
  for (const kind of Object.keys(KINDS) as Kind[]) {
    const list = purses(kind, 6);
    console.log(
      `  ${kind.padEnd(8)} n=${pad(list.length, 3)}  median ${pad(percentile(list, 0.5), 4)}  p90 ${pad(percentile(list, 0.9), 4)}  max ${pad(list.at(-1) ?? 0, 4)}`,
    );
  }
  const last = rows.at(-1);
  const week = rows.slice(-7);
  const avg = (f: (r: Row) => number) =>
    Math.round(week.reduce((s, r) => s + f(r), 0) / week.length);
  if (last) {
    console.log("");
    console.log(
      `Last 7 days: ${avg((r) => r.active)} active a day, the town paid out ${avg((r) => r.townPaid)} a day (welcome gifts and townsfolk tips) against a mint of ${N.treasuryMint}, total minted ${avg((r) => r.mint)} a day.`,
    );
    console.log(
      `Month end: supply ${last.supply}, treasury ${last.treasury}, ${last.perActive} coins per active resident.`,
    );
    console.log(`Welcome gifts paid short because the treasury ran low: ${shortWelcomes}.`);
  }
}

report(modelRules());
