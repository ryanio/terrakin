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
 * Every step is an input to the real sim (apply), and the numbers are ECONOMY in
 * sim/src/economy.ts, so the script and the rules can't drift. Change a number there, rerun this,
 * and record why in a decision (decision 0039).
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

import type { Command } from "../sim/src/index.ts";

const { apply, coinsOf, createWorld, ECONOMY, isCommons, TOWN_ACTOR } = await import(
  "../sim/src/index.ts"
);

type Numbers = { -readonly [K in keyof typeof ECONOMY]: number };

const { values: args } = parseArgs({
  options: {
    seed: { type: "string", default: "1" },
    days: { type: "string", default: "30" },
    residents: { type: "string", default: "300" },
    set: { type: "string", multiple: true, default: [] },
  },
});

// `--set` changes the sim's own ECONOMY for this run only, so the rules play the trial numbers.
const N = ECONOMY as Numbers;
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

/** What the population below does in the world. */
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
  /** Residents still waiting for a welcome gift the treasury couldn't pay in full. */
  owed(): number;
}

/** The real rules: every step is an input to the sim, exactly as the server would log it. */
function simRules(): Rules {
  // A square of 8-tile plots with room for every resident, less the Commons.
  const side = Math.ceil(Math.sqrt(RESIDENTS + 1)) + 1;
  const state = createWorld({
    width: side * 8,
    height: side * 8,
    plotSize: 8,
    maxPlotsPerResident: 1,
    reach: 3,
  });
  const free: [number, number][] = [];
  for (let py = 0; py < side; py++) {
    for (let px = 0; px < side; px++) if (!isCommons(state.config, px, py)) free.push([px, py]);
  }
  const DAY0 = 20_000;
  const send = (actor: string, command: Command) => apply(state, { actor, command }).ok;
  const must = (actor: string, command: Command) => {
    const result = apply(state, { actor, command });
    if (!result.ok) throw new Error(`${actor} ${command.type}: ${result.rejection.message}`);
  };
  return {
    open() {
      must(TOWN_ACTOR, { type: "new_day", day: DAY0 });
      must(TOWN_ACTOR, { type: "open_economy" });
    },
    newDay: (d) => must(TOWN_ACTOR, { type: "new_day", day: DAY0 + d }),
    join: (id) => must(id, { type: "join", name: id, kind: "human" }),
    settle(id) {
      const plot = free.shift();
      if (!plot) throw new Error("The simulated world ran out of plots.");
      must(id, { type: "settle", px: plot[0], py: plot[1] });
      // Settling lands on the plot's center, where the starter home puts the hearth.
      must(id, { type: "build_starter_home" });
    },
    // Refused as already_home once today's allowance is paid, like a real second `home`.
    home: (id) => void send(id, { type: "home" }),
    give: (from, to, amount) => send(from, { type: "give_coins", to, amount }),
    setTownsfolk: (ids) => must(TOWN_ACTOR, { type: "set_townsfolk", ids }),
    setOwnerPairs: (pairs) => must(TOWN_ACTOR, { type: "set_owner_pairs", pairs }),
    balance: (id) => coinsOf(state, id),
    treasury: () => state.economy?.treasury ?? 0,
    minted: () => state.economy?.minted ?? 0,
    burned: () => state.economy?.burned ?? 0,
    owed: () => state.economy?.owed.length ?? 0,
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
    console.log(
      `Welcome gifts that had to wait for a new_day because the treasury ran low: ${shortWelcomes}, still waiting at month end: ${rules.owed()}.`,
    );
  }
}

report(simRules());
