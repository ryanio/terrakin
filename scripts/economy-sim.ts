/**
 * Coins numbers simulation (RFC 0008). Plays a month of a few hundred residents arriving in a
 * world whose economy, items, and town shop have just opened, and prints supply per active
 * resident each day.
 *
 *   node scripts/economy-sim.ts [--seed 1] [--days 30] [--residents 300] [--start 2024-10-04] [--no-shop] [--no-appreciation] [--set key=value ...]
 *
 *   --seed       PRNG seed, so a run repeats exactly (default 1)
 *   --days       days to play (default 30)
 *   --start      the UTC date the month starts on (default 2024-10-04, an autumn month, so the
 *                shop's autumn stock and the town's autumn buying are in it; RFC 0017).
 *                `--start 2024-12-04` plays a winter month (decision 0124).
 *   --residents  residents who arrive over those days, not counting the townsfolk (default 300)
 *   --no-shop    play phase 1 only: coins, no gardens, no shop (the decision 0039 baseline)
 *   --no-appreciation  no posts, reactions, or appreciation coins (the decision 0052 baseline)
 *   --set        try a different number without editing it: a key of ECONOMY (`allowance=8`), a
 *                shop price (`price.lantern=50`), what the town pays (`buy.lemon_jam=5`), its daily
 *                count (`perDay.lemon_jam=3`), a key of SHOP (`goodsPerDay=2`), or the pantry once
 *                the shop is open (`shopPantry.jar=2`, `shopStapleMax=8`)
 *
 * Every step is an input to the real sim (apply), and the numbers are the sim's own (ECONOMY in
 * packages/sim/src/economy.ts, ITEMS in packages/sim/src/items.ts, the catalog and buy orders in
 * packages/sim/src/shop.ts), so the script and the rules can't drift. Karma is scored by the
 * server's own `scoreKarma` with `KARMA` from the protocol. Change a number there, rerun this, and
 * record why in a decision (decisions 0039, 0052, and 0055).
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

import type { KarmaFacts } from "../packages/server/src/karma.ts";
import type {
  Command,
  Crop,
  DailyAward,
  GoodKind,
  ShopSku,
  StackKind,
  WorldState,
} from "../packages/sim/src/index.ts";

const {
  apply,
  BUY_ORDERS,
  CROP_INFO,
  CROPS,
  coinsOf,
  createWorld,
  ECONOMY,
  ITEMS,
  isCommons,
  isDecorKind,
  isGoodKind,
  isReady,
  onSale,
  RECIPES,
  SHOP,
  SHOP_CATALOG,
  SHOP_SHARE_BEFORE,
  TOWN_ACTOR,
  dayOfDate,
  tileKey,
  townBuys,
} = await import("../packages/sim/src/index.ts");
const { KARMA, KARMA_TIERS, tierAtLeast } = await import("../packages/protocol/src/social.ts");
const { scoreKarma } = await import("../packages/server/src/karma.ts");

type Numbers = { -readonly [K in keyof typeof ECONOMY]: number };
type Mutable = Record<string, number | Record<string, number | Record<string, number>>>;

const { values: args } = parseArgs({
  options: {
    seed: { type: "string", default: "1" },
    days: { type: "string", default: "30" },
    residents: { type: "string", default: "300" },
    start: { type: "string", default: "2024-10-04" },
    "no-shop": { type: "boolean", default: false },
    "no-appreciation": { type: "boolean", default: false },
    set: { type: "string", multiple: true, default: [] },
  },
});

// `--set` changes the sim's own numbers for this run only, so the rules play the trial numbers.
const N = ECONOMY as Numbers;
for (const pair of args.set ?? []) {
  const [key = "", value = ""] = pair.split("=");
  const n = Number(value);
  if (!Number.isInteger(n) || value === "") throw new Error(`--set wants a whole number: ${pair}`);
  const [head = "", tail] = key.split(".");
  const where: Record<string, Mutable> = {
    price: SHOP_CATALOG as unknown as Mutable,
    buy: BUY_ORDERS as unknown as Mutable,
    perDay: BUY_ORDERS as unknown as Mutable,
  };
  if (key in N) N[key as keyof Numbers] = n;
  else if (key in SHOP) (SHOP as unknown as Mutable)[key] = n;
  else if (key === "shopStapleMax") (ITEMS as unknown as Mutable).shopStapleMax = n;
  else if (tail && head === "shopPantry" && tail in ITEMS.shopPantry) {
    (ITEMS.shopPantry as Record<string, number>)[tail] = n;
  } else if (tail && (head === "price" || head === "buy" || head === "perDay")) {
    const entry = (where[head] as Record<string, Record<string, number>>)[tail];
    if (!entry)
      throw new Error(`--set ${head}.${tail}: no such ${head === "price" ? "sku" : "buy order"}`);
    entry[head === "perDay" ? "perDay" : "price"] = n;
  } else throw new Error(`--set: unknown key ${key}`);
}
const SHOP_OPEN = !args["no-shop"];
const APPRECIATION = !args["no-appreciation"];
const SEED = Number(args.seed);
const DAYS = Number(args.days);
const RESIDENTS = Number(args.residents);
const [startYear = 0, startMonth = 0, startDate = 0] = (args.start ?? "").split("-").map(Number);
if (!startYear || !startMonth || !startDate) throw new Error("--start wants a date, YYYY-MM-DD");
/** The world day the month starts on. */
const DAY0 = dayOfDate(startYear, startMonth, startDate);

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
/** Draws from one seeded stream. */
function draws(random: () => number) {
  return {
    chance: (p: number) => random() < p,
    between: (lo: number, hi: number) => lo + Math.floor(random() * (hi - lo + 1)),
    pick: <T>(list: readonly T[]): T | undefined => list[Math.floor(random() * list.length)],
  };
}
// Who arrives and when they visit and give: the same stream as decision 0039, so `--no-shop`
// plays that month exactly and both runs have the same people on the same days.
const random = mulberry32(SEED);
const { chance, between, pick } = draws(random);
// Gardens and shopping draw from their own stream, so they never shift the one above.
const taste = draws(mulberry32(SEED ^ 0x5eed));
// Posts and reactions too, so turning appreciation on or off leaves the rest of the month alone.
const social = draws(mulberry32(SEED ^ 0xa11ce));

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
  /** Log appreciation coins for day `d`, as the server does early on day `d + 1`. */
  award(d: number, awards: DailyAward[]): void;
  balance(id: string): number;
  treasury(): number;
  minted(): number;
  burned(): number;
  /** Residents still waiting for a welcome gift the treasury couldn't pay in full. */
  owed(): number;
  /** Any resident input. True when accepted. */
  send(actor: string, command: Command): boolean;
  /** The world, read-only, for residents deciding what to do. */
  readonly state: WorldState;
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
  const send = (actor: string, command: Command) => apply(state, { actor, command }).ok;
  const must = (actor: string, command: Command) => {
    const result = apply(state, { actor, command });
    if (!result.ok) throw new Error(`${actor} ${command.type}: ${result.rejection.message}`);
  };
  return {
    open() {
      must(TOWN_ACTOR, { type: "new_day", day: DAY0 });
      must(TOWN_ACTOR, { type: "open_economy" });
      if (SHOP_OPEN) {
        must(TOWN_ACTOR, { type: "open_items" });
        must(TOWN_ACTOR, { type: "open_shop" });
        // As the server does: log the share when it isn't the one the shop opened with (`--set`
        // can change it, so compare as numbers).
        if ((SHOP.treasuryShare as number) !== SHOP_SHARE_BEFORE) {
          must(TOWN_ACTOR, { type: "set_shop_share", percent: SHOP.treasuryShare });
        }
      }
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
    award: (d, awards) => must(TOWN_ACTOR, { type: "daily_awards", day: DAY0 + d, awards }),
    balance: (id) => coinsOf(state, id),
    treasury: () => state.economy?.treasury ?? 0,
    minted: () => state.economy?.minted ?? 0,
    burned: () => state.economy?.burned ?? 0,
    owed: () => state.economy?.owed.length ?? 0,
    send,
    state,
  };
}

// ---------- gardens and the shop ----------

/** What a resident does with their plot and purse, beyond coming home. */
interface Habits {
  /** Keeps a garden: plants, harvests, makes things, and sells what the town buys today. */
  gardens: boolean;
  /** How many planters they grow to, buying seeds as they go. */
  planters: number;
  /** Chance on an active day of buying the next thing they want, once they can afford it. */
  shops: number;
  /** What they'd like from the shop, in order. */
  wants: ShopSku[];
}

/**
 * Autumn's decor (RFC 0017) and winter's are skipped by anyone shopping in another season, without
 * a draw, so adding a season's wishes never changes another season's month.
 */
const WISHES: ShopSku[][] = [
  ["lantern", "scarecrow", "snowman", "bench", "top_hat"],
  [
    "fence",
    "fence",
    "fence",
    "fence",
    "fence",
    "fence",
    "hay_bale",
    "hay_bale",
    "string_lights",
    "string_lights",
    "frame",
    "lantern",
  ],
  ["umbrella", "lantern", "lantern", "frame"],
  ["bench", "raincoat", "hay_bale", "scarecrow", "little_fir", "sled", "lantern"],
  ["frame", "frame", "top_hat", "bench"],
];

/** The free tiles on a resident's plot within reach of their hearth, nearest first. */
function gardenTiles(state: WorldState, id: string): { x: number; y: number }[] {
  const me = state.residents[id];
  const hearth = me?.hearth;
  if (!me || !hearth) return [];
  const { plotSize, reach } = state.config;
  const px = Math.floor(hearth.x / plotSize);
  const py = Math.floor(hearth.y / plotSize);
  const tiles: { x: number; y: number; d: number }[] = [];
  for (let dy = -reach; dy <= reach; dy++) {
    for (let dx = -reach; dx <= reach; dx++) {
      const x = hearth.x + dx;
      const y = hearth.y + dy;
      if (Math.floor(x / plotSize) !== px || Math.floor(y / plotSize) !== py) continue;
      if ((dx === 0 && dy === 0) || state.blocks[tileKey(x, y)] !== undefined) continue;
      tiles.push({ x, y, d: Math.abs(dx) + Math.abs(dy) });
    }
  }
  return tiles.sort((a, b) => a.d - b.d || a.y - b.y || a.x - b.x).map(({ x, y }) => ({ x, y }));
}

const holds = (state: WorldState, id: string, kind: StackKind) =>
  state.items?.inventories[id]?.stacks[kind] ?? 0;
const goodsOf = (state: WorldState, id: string, kind: GoodKind) =>
  (state.items?.inventories[id]?.goods ?? []).filter((g) => g.kind === kind).length;

/** Counts for the report, kept per day. */
const tally = { sold: 0, spent: 0 };

/** A gardener's day at home: harvest, replant, make and sell what the town buys, and grow. */
function tendGarden(rules: Rules, id: string, habits: Habits, planters: Map<string, Set<string>>) {
  const { state } = rules;
  const day = state.day ?? 0;
  let mine = planters.get(id);
  if (!mine) {
    // Moving in: a kitchen, a workbench, and a planter for each starter seed.
    mine = new Set();
    planters.set(id, mine);
    const [kitchen, bench] = gardenTiles(state, id);
    if (kitchen) rules.send(id, { type: "place", ...kitchen, block: "kitchen" });
    if (bench) rules.send(id, { type: "place", ...bench, block: "workbench" });
  }
  /** Their own kitchen or workbench, within reach of their hearth. */
  const station = (block: "kitchen" | "workbench") => {
    const h = state.residents[id]?.hearth;
    for (const [key, b] of Object.entries(state.blocks)) {
      const [x = 0, y = 0] = key.split(",").map(Number);
      if (
        b === block &&
        h &&
        Math.max(Math.abs(x - h.x), Math.abs(y - h.y)) <= state.config.reach
      ) {
        return { x, y };
      }
    }
    return undefined;
  };
  // Harvest what's ready.
  for (const key of mine) {
    const crop = state.items?.crops[key];
    const [x = 0, y = 0] = key.split(",").map(Number);
    if (crop && isReady(crop.readyDay, day)) rules.send(id, { type: "harvest", x, y });
  }
  // Grow: buy seeds for a new planter while short of the plan and the purse allows.
  if (SHOP_OPEN && mine.size >= 10 && mine.size < habits.planters && taste.chance(0.5)) {
    // Only seeds the shop sells today (pumpkin seeds are autumn's), for crops the town buys: these
    // gardeners grow to sell.
    const crop = taste.pick(
      CROPS.filter((c) => Object.hasOwn(BUY_ORDERS, c) && onSale(CROP_INFO[c].seed, day)),
    ) as Crop;
    const seed = CROP_INFO[crop].seed;
    if (coinsOf(state, id) >= SHOP_CATALOG[seed].price * 2 + 20) buy(rules, id, seed, 2);
  }
  // Plant every empty planter, and new ones while there are seeds and room.
  const plant = (x: number, y: number) => {
    const crop = [...CROPS].sort(
      (a, b) => holds(state, id, CROP_INFO[b].seed) - holds(state, id, CROP_INFO[a].seed),
    )[0] as Crop;
    if (holds(state, id, CROP_INFO[crop].seed) > 0) {
      rules.send(id, { type: "plant", x, y, seed: crop });
    }
  };
  for (const key of mine) {
    if (!state.items?.crops[key]) {
      const [x = 0, y = 0] = key.split(",").map(Number);
      plant(x, y);
    }
  }
  const seeds = () => CROPS.reduce((n, c) => n + holds(state, id, CROP_INFO[c].seed), 0);
  while (seeds() > 0 && mine.size < habits.planters) {
    const tile = gardenTiles(state, id)[0];
    if (!tile || !rules.send(id, { type: "place", ...tile, block: "planter" })) break;
    mine.add(tileKey(tile.x, tile.y));
    plant(tile.x, tile.y);
  }
  if (!SHOP_OPEN) return;
  // Make and sell what the town buys today, up to its daily counts.
  for (const kind of townBuys(day)) {
    const { perDay } = BUY_ORDERS[kind];
    if (isGoodKind(kind)) {
      const at = station(RECIPES[kind].station);
      if (!at) continue;
      const { x, y } = at;
      for (let i = goodsOf(state, id, kind); i < perDay; i++) {
        if (!rules.send(id, { type: "craft", recipe: kind, x, y })) break;
      }
      const have = Math.min(perDay, goodsOf(state, id, kind));
      if (have > 0) sell(rules, id, kind, have);
    } else {
      // Keep a few for the kitchen and the workbench; sell the rest.
      const spare = Math.min(perDay, holds(state, id, kind) - 4);
      if (spare > 0) sell(rules, id, kind, spare);
    }
  }
}

/** Buy at the shop, counting what was spent. True when the sim took it. */
function buy(rules: Rules, id: string, sku: ShopSku, count = 1): boolean {
  const ok = rules.send(id, { type: "shop_buy", sku, count });
  if (ok) tally.spent += SHOP_CATALOG[sku].price * count;
  return ok;
}

function sell(rules: Rules, id: string, item: string, count: number) {
  const before = coinsOf(rules.state, id);
  if (rules.send(id, { type: "sell_to_town", item, count })) {
    tally.sold += coinsOf(rules.state, id) - before;
  }
}

/** Maybe buy the next wanted thing, and place it if it's decor. */
function goShopping(rules: Rules, id: string, habits: Habits) {
  const { state } = rules;
  // What's only sold in another season is skipped, as a resident would.
  while (habits.wants[0] && !onSale(habits.wants[0], state.day ?? 0)) habits.wants.shift();
  const next = habits.wants[0];
  if (!SHOP_OPEN || !next || !taste.chance(habits.shops)) return;
  // Everyone keeps a little back.
  if (coinsOf(state, id) < SHOP_CATALOG[next].price + 10) return;
  if (!buy(rules, id, next)) return;
  habits.wants.shift();
  if (isDecorKind(next)) {
    const tile = gardenTiles(state, id)[0];
    if (tile) rules.send(id, { type: "place", ...tile, block: next });
  }
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
  habits: Habits;
}

/** Regulars garden most, and AI residents (a third of them) tend a garden as a daily routine. */
const GARDENS: Record<Kind, number> = { regular: 0.7, visitor: 0.45, drifter: 0.3, oneday: 0 };

const TOWNSFOLK = ["t_bram", "t_clem", "t_dot", "t_fern", "t_hale", "t_ivy", "t_juno", "t_moss"];
/** Share of each townsfolk budget their scripts actually hand out on a typical day. */
const TOWNSFOLK_SPEND = 0.8;
/** Owner-linked pairs among the arrivals: a person and their AI. */
const PAIRS = 20;

// ---------- posts, reactions, and karma ----------

/** Chance of posting on a day they're around. Newcomers post to say hello. */
const POSTS: Record<Kind, number> = { regular: 0.5, visitor: 0.35, drifter: 0.25, oneday: 0.5 };
/** The most of the day's posts one resident reacts to. */
const REACTS_UP_TO = 4;

/**
 * Appreciation coins for day `d`, the way `KarmaService.awards` counts them: one for each other
 * resident who reacted to your posts that day, if they're a Neighbor by karma up to that day, have
 * a hearth, and were old enough, and aren't your own AI or person. Townsfolk don't post here.
 */
function appreciationFor(
  d: number,
  facts: KarmaFacts,
  byId: Map<string, Person>,
  settled: Set<string>,
  paired: (a: string, b: string) => boolean,
): DailyAward[] {
  const scores = scoreKarma(facts, { counts: (id) => !id.startsWith("t_"), paired });
  const counted = new Map<string, Set<string>>();
  for (const { from, to, day } of facts.reactions) {
    if (day !== d || from === to || paired(from, to) || !settled.has(from)) continue;
    const tier = scores.get(from)?.tier ?? "newcomer";
    if (!tierAtLeast(tier, KARMA.appreciationTier)) continue;
    if (d - (byId.get(from)?.arrives ?? d) < KARMA.appreciationMinAgeDays) continue;
    counted.set(to, (counted.get(to) ?? new Set()).add(from));
  }
  return [...counted.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([to, set]) => ({
      to,
      amount: Math.min(set.size, N.appreciationCap),
      reason: "appreciation" as const,
    }));
}

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
      habits: {
        gardens: taste.chance(GARDENS[kind]),
        planters: taste.between(10, 22),
        shops: taste.chance(0.3) ? 0.6 : 0.25,
        wants: [...(taste.pick(WISHES) ?? [])],
      },
    });
  }
  return people;
}

// ---------- the month ----------

interface Row {
  appreciation: number;
  sold: number;
  spent: number;
  burned: number;
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
  const pairKeys = new Set(pairs.map(([a, b]) => [a, b].sort().join(" ")));
  const paired = (a: string, b: string) => pairKeys.has([a, b].sort().join(" "));
  const facts: KarmaFacts = {
    reactions: [],
    praise: [],
    gifts: [],
    heartedReplies: [],
    votes: [],
    upheld: [],
  };

  const rows: Row[] = [];
  let shortWelcomes = 0;
  const settled = new Set<string>();
  const planters = new Map<string, Set<string>>();
  const atHome = (p: Person) => {
    if (p.habits.gardens) tendGarden(rules, p.id, p.habits, planters);
    goShopping(rules, p.id, p.habits);
  };
  rules.open();
  for (let day = 0; day < DAYS; day++) {
    const mintedBefore = rules.minted();
    // The town's coins are the treasury plus the townsfolk purses it funds. What they lose in a
    // day, beyond the mint, went to residents as welcome gifts and townsfolk tips.
    const townBefore = townCoins(rules);
    const burnedBefore = rules.burned();
    tally.sold = 0;
    tally.spent = 0;
    // The economy opens partway through day 0, so day 0 has no new_day of its own.
    if (day > 0) rules.newDay(day);
    // Yesterday's appreciation, paid early today.
    let appreciation = 0;
    if (APPRECIATION && day > 0) {
      const awards = appreciationFor(day - 1, facts, byId, settled, paired);
      if (awards.length > 0) rules.award(day - 1, awards);
      appreciation = awards.reduce((sum, a) => sum + a.amount, 0);
    }
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
          atHome(p);
        }
      } else if (p.arrives < day && chance(KINDS[p.kind].visit(day - p.arrives))) {
        active.push(p.id);
        if (settled.has(p.id)) {
          rules.home(p.id);
          atHome(p);
        }
      }
    }

    // Residents tip each other now and then. Not on their first day: the rules refuse that.
    const veterans = active.filter((id) => !arrived.includes(id));
    for (const id of veterans) {
      const p = byId.get(id);
      if (!p || !chance(p.giving)) continue;
      const to = pick(active.filter((other) => other !== id));
      const amount = Math.min(rules.balance(id), between(5, 30));
      if (to && amount > 0 && rules.give(id, to, amount)) facts.gifts.push({ from: id, to, day });
    }
    // An AI saving up for its person, or the other way round. Pairs skip the daily caps.
    for (const [a, b] of pairs) {
      if (!active.includes(a) || !chance(0.1)) continue;
      const amount = Math.min(rules.balance(a), between(10, 60));
      if (amount > 0) rules.give(a, b, amount);
    }
    // Some post, and everyone around reacts to a few of today's posts by others.
    if (APPRECIATION) {
      const posters = active.filter((id) => social.chance(POSTS[byId.get(id)?.kind ?? "oneday"]));
      for (const id of active) {
        const others = posters.filter((p) => p !== id);
        const reacts = Math.min(others.length, social.between(0, REACTS_UP_TO));
        for (let i = 0; i < reacts; i++) {
          const [to] = others.splice(social.between(0, others.length - 1), 1);
          if (to) facts.reactions.push({ from: id, to, day });
        }
      }
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
      appreciation,
      sold: tally.sold,
      spent: tally.spent,
      burned: rules.burned() - burnedBefore,
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
  return { rows, people, shortWelcomes, facts, paired };
}

// ---------- report ----------

const pad = (v: string | number, n: number) => String(v).padStart(n);
const percentile = (sorted: number[], q: number) =>
  sorted.length ? (sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? 0) : 0;

function report(rules: Rules) {
  const { rows, people, shortWelcomes, facts, paired } = play(rules);
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
    "day  new  active   supply  treasury  held(res)  per active  minted today  town paid   sold  spent  burned  apprec",
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
        pad(r.sold, 5),
        pad(r.spent, 5),
        pad(r.burned, 6),
        pad(r.appreciation, 6),
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
    if (SHOP_OPEN) {
      console.log(
        `Last 7 days at the shop: residents sold ${avg((r) => r.sold)} a day to the town (minted) and spent ${avg((r) => r.spent)} a day (${avg((r) => r.burned)} burned, the rest to the treasury).`,
      );
      const gardeners = people.filter((p) => p.habits.gardens && p.settles && p.arrives <= 6);
      const g = gardeners.map((p) => rules.balance(p.id)).sort((a, b) => a - b);
      console.log(
        `Gardeners who arrived in the first week (n=${g.length}): month-end purse median ${percentile(g, 0.5)}, p90 ${percentile(g, 0.9)}, max ${g.at(-1) ?? 0}.`,
      );
    }
    if (APPRECIATION) {
      console.log(
        `Last 7 days: appreciation minted ${avg((r) => r.appreciation)} a day, ${(
          week.reduce((s, r) => s + r.appreciation, 0) /
            Math.max(
              1,
              week.reduce((s, r) => s + r.active, 0),
            )
        ).toFixed(1)} per active resident.`,
      );
      const scores = scoreKarma(facts, { counts: (id) => !id.startsWith("t_"), paired });
      const tiers = KARMA_TIERS.map(
        (t) => `${t} ${people.filter((p) => (scores.get(p.id)?.tier ?? "newcomer") === t).length}`,
      );
      console.log(`Month-end karma tiers: ${tiers.join(", ")}.`);
    }
    console.log(
      `Welcome gifts that had to wait for a new_day because the treasury ran low: ${shortWelcomes}, still waiting at month end: ${rules.owed()}.`,
    );
  }
}

report(simRules());
