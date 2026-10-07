/**
 * Coins numbers simulation (RFC 0008). Plays a month of a few hundred residents arriving in a
 * world whose economy, items, and town shop have just opened, and prints supply per active
 * resident each day.
 *
 *   node scripts/economy-sim.ts [--seed 1] [--days 30] [--residents 300] [--start 2024-10-04] [--no-shop] [--no-appreciation] [--no-fishing] [--no-recipes] [--picks sell] [--no-holidays] [--holiday-prices lower] [--set key=value ...]
 *
 *   --seed       PRNG seed, so a run repeats exactly (default 1)
 *   --days       days to play (default 30)
 *   --start      the UTC date the month starts on (default 2024-10-04, an autumn month, so the
 *                shop's autumn stock and the town's autumn buying are in it; RFC 0017).
 *                `--start 2024-12-04` plays a winter month (decision 0124).
 *   --residents  residents who arrive over those days, not counting the townsfolk (default 300)
 *   --no-shop    play phase 1 only: coins, no gardens, no shop (the decision 0039 baseline)
 *   --no-appreciation  no posts, reactions, or appreciation coins (the decision 0052 baseline)
 *   --no-fishing  nobody fishes (RFC 0023), so the month plays as it did before fishing (the
 *                decision 0123 baseline)
 *   --no-recipes everyone knows every recipe, as before `open_recipes` (RFC 0024), so the month
 *                plays as it did before recipes were learned (the decision 0186 baseline)
 *   --no-holidays nobody buys a holiday's costumes or decor (RFC 0022), so the month plays as it
 *                did before holiday shopping (the decision 0210 baseline)
 *   --holiday-prices  `lower` (the default) logs `lower_holiday_prices` when the shop opens, as
 *                terrakin.org does; `before` leaves it out, so holiday stock costs decision 0107's
 *                prices (decision 0210)
 *   --picks      how gardeners use their free picks: `sell` (the default) picks the goods they'd
 *                sell, best paid first; `shelf` picks any three cards off the shelf, as someone
 *                picking what they like might, and leaves the goods to cards and lessons
 *   --set        try a different number without editing it: a key of ECONOMY (`allowance=8`), a
 *                shop price (`price.lantern=50`), what the town pays (`buy.lemon_jam=5`), its daily
 *                count (`perDay.lemon_jam=3`), a key of SHOP (`goodsPerDay=2`), or the pantry once
 *                the shop is open (`shopPantry.jar=2`, `shopStapleMax=8`), or a key of
 *                RECIPES_RULES (`recipes.rotationTimes=4`, `recipes.pageOneIn=30`)
 *
 * Every step is an input to the real sim (apply), and the numbers are the sim's own (ECONOMY in
 * packages/sim/src/economy.ts, ITEMS in packages/sim/src/items.ts, the catalog and buy orders in
 * packages/sim/src/shop.ts, RECIPES_RULES in packages/sim/src/recipes.ts), so the script and the
 * rules can't drift. Karma is scored by the server's own `scoreKarma` with `KARMA` from the
 * protocol, and the townsfolk teach the server's own specialties (`SPECIALTIES`). Change a number
 * there, rerun this, and record why in a decision (decisions 0039, 0052, 0055, 0186, and 0210).
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
  Holiday,
  RecipeName,
  SellKind,
  ShopSku,
  StackKind,
  WorldState,
} from "../packages/sim/src/index.ts";

const {
  apply,
  biomeAt,
  BUY_ORDERS,
  CARD_RECIPES,
  cardSeason,
  cardSku,
  chebyshev,
  CROP_INFO,
  CROPS,
  castsToday,
  coinsOf,
  createWorld,
  ECONOMY,
  FISH_KINDS,
  FISHING,
  FISHING_ROD,
  HOLIDAY_STOCK,
  holdsRod,
  holidayOf,
  holidaySpan,
  ITEMS,
  inventorySize,
  isCommons,
  isDecorKind,
  isGoodKind,
  isShopWear,
  isReady,
  isWater,
  knows,
  onSale,
  onShelf,
  pageOn,
  pickupLeft,
  picksLeft,
  plotOf,
  POND,
  priceOf,
  RECIPE_PAGE,
  RECIPES,
  RECIPES_RULES,
  recipeCardPrice,
  route,
  SHOP,
  SHOP_CATALOG,
  SHOP_SHARE_BEFORE,
  shelfOn,
  TIMES_OF_DAY,
  TOWN_ACTOR,
  dateOfDay,
  dayOfDate,
  taughtToday,
  teachingToday,
  tileKey,
  townBuys,
  townsfolkLessonDue,
  visitTile,
  waterBeside,
  weatherAt,
  worldGround,
} = await import("../packages/sim/src/index.ts");
const { SPECIALTIES } = await import("../packages/server/src/lesson-plan.ts");
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
    "no-fishing": { type: "boolean", default: false },
    "no-recipes": { type: "boolean", default: false },
    "no-holidays": { type: "boolean", default: false },
    "holiday-prices": { type: "string", default: "lower" },
    picks: { type: "string", default: "sell" },
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
  else if (tail && head === "recipes" && tail in RECIPES_RULES) {
    (RECIPES_RULES as unknown as Mutable)[tail] = n;
  } else if (tail && head === "shopPantry" && tail in ITEMS.shopPantry) {
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
/** Fishing needs items, and its coins need the shop. */
const FISHING_ON = SHOP_OPEN && !args["no-fishing"];
/** Recipes are learned once the shop is open (`open_recipes` needs it). */
const RECIPES_ON = SHOP_OPEN && !args["no-recipes"];
/** Residents buy a holiday's costumes and decor while it runs (RFC 0022). */
const HOLIDAYS_ON = SHOP_OPEN && !args["no-holidays"];
if (args["holiday-prices"] !== "lower" && args["holiday-prices"] !== "before") {
  throw new Error("--holiday-prices is lower or before");
}
/** Whether the world logs `lower_holiday_prices` when the shop opens, as terrakin.org does. */
const LOWER_HOLIDAY_PRICES = SHOP_OPEN && args["holiday-prices"] === "lower";
if (args.picks !== "sell" && args.picks !== "shelf") throw new Error("--picks is sell or shelf");
/** Whether gardeners pick the goods they'd sell (`--picks sell`) or any cards (`--picks shelf`). */
const PICK_TO_SELL = args.picks === "sell";
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
// Who fishes, and every cast's roll and sky, so turning fishing off leaves the rest alone too.
const angling = draws(mulberry32(SEED ^ 0xf15));
// Picks, lessons, and who meets a townsfolk: `--no-recipes` draws none of them.
const lore = draws(mulberry32(SEED ^ 0x7ec1));
// Who keeps a holiday and what they'd buy for it: `--no-holidays` draws none of them, and nothing
// is drawn outside a holiday, so a month without one plays as it did before.
const festive = draws(mulberry32(SEED ^ 0xb00));

// ---------- the rules ----------

/** What the population below does in the world. */
interface Rules {
  open(): void;
  newDay(day: number): void;
  join(id: string): void;
  /**
   * Settle a first plot and build a starter home, which sets a hearth. With `near`, the first free
   * plot it likes, else the next one.
   */
  settle(id: string, near?: (px: number, py: number) => boolean): void;
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
        if (LOWER_HOLIDAY_PRICES) must(TOWN_ACTOR, { type: "lower_holiday_prices" });
      }
      if (RECIPES_ON) {
        // Finds are out on terrakin.org, and recipe pages lie only where a find would. Nobody here
        // gathers a find, so they change nothing else.
        must(TOWN_ACTOR, { type: "open_finds" });
        must(TOWN_ACTOR, { type: "open_recipes" });
      }
    },
    newDay: (d) => must(TOWN_ACTOR, { type: "new_day", day: DAY0 + d }),
    join: (id) => must(id, { type: "join", name: id, kind: "human" }),
    settle(id, near) {
      const liked = near ? free.findIndex(([px, py]) => near(px, py)) : -1;
      const plot = liked >= 0 ? free.splice(liked, 1)[0] : free.shift();
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
  /** Casts a line this many times on a day at home, once they have a rod and a pond (RFC 0023). 0 never fishes. */
  casts: number;
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

/** Where an angler digs their pond: the tile north of their hearth, inside the starter hut. */
const pondTile = (hearth: { x: number; y: number }) => ({ x: hearth.x, y: hearth.y - 1 });

/** Residents who fish, so their gardens leave the pond's tile free. */
const anglers = new Set<string>();

/** The free tiles on a resident's plot within reach of their hearth, nearest first. */
function gardenTiles(state: WorldState, id: string): { x: number; y: number }[] {
  const me = state.residents[id];
  const hearth = me?.hearth;
  if (!me || !hearth) return [];
  const pond = anglers.has(id) ? pondTile(hearth) : undefined;
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
      if (pond && pond.x === x && pond.y === y) continue;
      tiles.push({ x, y, d: Math.abs(dx) + Math.abs(dy) });
    }
  }
  return tiles.sort((a, b) => a.d - b.d || a.y - b.y || a.x - b.x).map(({ x, y }) => ({ x, y }));
}

const holds = (state: WorldState, id: string, kind: StackKind) =>
  state.items?.inventories[id]?.stacks[kind] ?? 0;
const goodsOf = (state: WorldState, id: string, kind: GoodKind) =>
  (state.items?.inventories[id]?.goods ?? []).filter((g) => g.kind === kind).length;

/**
 * Counts for the report, kept per day. `cards` is the part of `spent` that bought recipe cards, and
 * `holiday` the part that bought a holiday's stock.
 */
const tally = { sold: 0, spent: 0, fish: 0, casts: 0, cards: 0, holiday: 0, holidayBurned: 0 };

/** Coins each resident has spent at the shop, for what they had to spend in their first week. */
const spentBy = new Map<string, number>();
/** What each settled resident had to spend by the end of their seventh day: purse plus shop spending. */
const firstWeek = new Map<string, number>();

/** Count a purchase the sim took: what it cost, read from the purse, so any price list counts. */
function spend(id: string, coins: number) {
  tally.spent += coins;
  spentBy.set(id, (spentBy.get(id) ?? 0) + coins);
}

/** The month's day (0 is the first) the world is on now. */
const today = (state: WorldState) => (state.day ?? DAY0) - DAY0;

/** The month's day each resident first sold the town anything, and first sold something they made. */
const firstSale = new Map<string, number>();
const firstMadeSale = new Map<string, number>();

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
  const before = coinsOf(rules.state, id);
  const ok = rules.send(id, { type: "shop_buy", sku, count });
  if (ok) spend(id, before - coinsOf(rules.state, id));
  return ok;
}

function sell(rules: Rules, id: string, item: string, count: number) {
  const before = coinsOf(rules.state, id);
  if (rules.send(id, { type: "sell_to_town", item, count })) {
    tally.sold += coinsOf(rules.state, id) - before;
    const day = today(rules.state);
    if (!firstSale.has(id)) firstSale.set(id, day);
    if (isGoodKind(item) && !firstMadeSale.has(id)) firstMadeSale.set(id, day);
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

// ---------- holidays (RFC 0022) ----------

/**
 * Who keeps a holiday: wants a costume and a piece of its decor, and buys them while it runs. A
 * guess, not a measurement: most regulars, fewer of those who come by less.
 */
const KEEPS: Record<Kind, number> = { regular: 0.6, visitor: 0.5, drifter: 0.4, oneday: 0.3 };

/** What each resident wants for a holiday this year, drawn on their first day home in it. */
const holidayWants = new Map<string, ShopSku[]>();
/** Residents who kept a holiday, and who bought a costume or decor for it, by holiday and year. */
const holidayKept = new Map<string, Set<string>>();
const costumeBought = new Map<string, Set<string>>();
const decorBought = new Map<string, Set<string>>();
const addTo = (sets: Map<string, Set<string>>, key: string, id: string) =>
  sets.set(key, (sets.get(key) ?? new Set()).add(id));

/**
 * A resident at home while a holiday runs: on their first day home in it, whether they keep it,
 * and if so one of its costumes and one piece of its decor, each at random; then they buy what they
 * want once they can afford it with 10 coins to spare, as they do everything else, and place the
 * decor. A holiday with no costume or decor (Midwinter's candy canes are all it sells) draws nothing.
 */
function keepHoliday(rules: Rules, p: Person) {
  const { state } = rules;
  const day = state.day ?? 0;
  const holiday = holidayOf(day);
  if (!holiday) return;
  const stock = HOLIDAY_STOCK[holiday];
  const costumes = stock.filter((sku) => isShopWear(sku));
  const decor = stock.filter((sku) => isDecorKind(sku));
  if (costumes.length === 0 && decor.length === 0) return;
  const key = `${holiday}:${dateOfDay(day).year}`;
  const mine = `${p.id}:${key}`;
  let wants = holidayWants.get(mine);
  if (!wants) {
    wants = [];
    if (festive.chance(KEEPS[p.kind])) {
      addTo(holidayKept, key, p.id);
      const costume = festive.pick(costumes);
      const piece = festive.pick(decor);
      if (costume) wants.push(costume);
      if (piece) wants.push(piece);
    }
    holidayWants.set(mine, wants);
  }
  while (wants[0]) {
    const next = wants[0];
    const before = coinsOf(state, p.id);
    const burned = state.economy?.burned ?? 0;
    if (before < priceOf(state, next) + 10 || !buy(rules, p.id, next)) return;
    tally.holiday += before - coinsOf(state, p.id);
    tally.holidayBurned += (state.economy?.burned ?? 0) - burned;
    wants.shift();
    if (isShopWear(next)) addTo(costumeBought, key, p.id);
    else if (isDecorKind(next)) {
      addTo(decorBought, key, p.id);
      const tile = gardenTiles(state, p.id)[0];
      if (tile) rules.send(p.id, { type: "place", ...tile, block: next });
    }
  }
}

// ---------- recipes you learn (RFC 0024) ----------

/**
 * How often a resident who's around asks a neighbor to teach them something they'd sell, and how
 * often a townsfolk stands near a resident who's around. Neither is measured yet: they're modest
 * guesses, and the sim's own limits (one lesson a day each way, a townsfolk's once a week) cap
 * them whatever they are.
 */
const TEACH_ASK = 0.1;
const NEAR_TOWNSFOLK = 0.1;
/** Neighbors are residents whose hearths are within two plots of yours. */
const NEIGHBORLY = 16;

/** What learning came to over the month, by how. */
const learned = { picked: 0, bought: 0, taught: 0, townsfolk: 0, found: 0, cardCoins: 0 };

/** The crops a good uses, leaving out the pantry's staples. */
const cropsIn = (good: GoodKind): Crop[] =>
  Object.keys(RECIPES[good].needs).filter((k): k is Crop =>
    (CROPS as readonly string[]).includes(k),
  );

/** A card for a good the town buys. */
type SellingCard = RecipeName & GoodKind & SellKind;

/** Cards for goods the town buys, best paid first: what a gardener makes to sell. */
const SELLING_CARDS = (
  CARD_RECIPES.filter((r) => isGoodKind(r) && Object.hasOwn(BUY_ORDERS, r)) as SellingCard[]
).sort((a, b) => BUY_ORDERS[b].price - BUY_ORDERS[a].price);

/** The goods the starter seeds make that are cards, on the shelf all year. */
const YEAR_ROUND = SELLING_CARDS.filter((r) => cardSeason(r) === undefined);

/** The month's day each gardener knew every one of `YEAR_ROUND`. */
const knewThem = new Map<string, number>();

/** Whether a resident grows a crop: holds its seed or the crop, or has it in a planter. */
function grows(state: WorldState, id: string, crop: Crop, planters: Map<string, Set<string>>) {
  if (holds(state, id, CROP_INFO[crop].seed) > 0 || holds(state, id, crop) > 0) return true;
  return [...(planters.get(id) ?? [])].some((key) => state.items?.crops[key]?.crop === crop);
}

/** The cards on today's shelf for goods a gardener would sell from what they grow, best paid first. */
function wantedCards(state: WorldState, id: string, planters: Map<string, Set<string>>) {
  const day = state.day ?? 0;
  return SELLING_CARDS.filter(
    (r) => onShelf(r, day) && cropsIn(r).every((c) => grows(state, id, c, planters)),
  );
}

/**
 * A resident's recipes at home: free picks first (a gardener picks the goods they'd sell, best
 * paid first, unless `--picks shelf`; anyone else three cards off today's shelf), then a gardener buys the card for each
 * good they'd sell once they can afford it with 10 coins to spare, and anyone picks up a recipe
 * page for something they don't know lying within reach.
 */
function learnAtHome(rules: Rules, id: string, habits: Habits, planters: Map<string, Set<string>>) {
  const { state } = rules;
  const day = state.day ?? 0;
  const unknown = (r: RecipeName) => !knows(state, id, r);
  while (picksLeft(state, id) > 0) {
    const recipe =
      habits.gardens && PICK_TO_SELL
        ? wantedCards(state, id, planters).find(unknown)
        : lore.pick(shelfOn(day).filter(unknown));
    if (!recipe || !rules.send(id, { type: "pick_recipe", recipe })) break;
    learned.picked++;
  }
  if (habits.gardens) {
    for (const recipe of wantedCards(state, id, planters).filter(unknown)) {
      const price = recipeCardPrice(recipe);
      if (coinsOf(state, id) < price + 10) continue;
      if (!rules.send(id, { type: "shop_buy", sku: cardSku(recipe) })) continue;
      spend(id, price);
      tally.cards += price;
      learned.bought++;
      learned.cardCoins += price;
    }
    if (!knewThem.has(id) && YEAR_ROUND.every((r) => knows(state, id, r))) {
      knewThem.set(id, today(state));
    }
  }
  const me = state.residents[id];
  if (!me) return;
  const { reach } = state.config;
  for (let y = me.y - reach; y <= me.y + reach; y++) {
    for (let x = me.x - reach; x <= me.x + reach; x++) {
      if (pickupLeft(state, x, y) !== RECIPE_PAGE) continue;
      if (knows(state, id, pageOn(x, y, day) as RecipeName)) continue;
      if (rules.send(id, { type: "gather", x, y })) learned.found++;
    }
  }
}

/**
 * Bring `who` within reach of `to`, who stands at home: a visit to their plot, which lands at its
 * edge in front of the door, then the fewest steps closer. True when they're within reach.
 */
function meet(rules: Rules, who: string, to: string): boolean {
  const { state } = rules;
  const near = () => {
    const a = state.residents[who];
    const b = state.residents[to];
    return a !== undefined && b !== undefined && chebyshev(a, b) <= state.config.reach;
  };
  const target = state.residents[to];
  if (!target || near()) return near();
  const { px, py } = plotOf(state.config, target.x, target.y);
  const tile = visitTile(state, who, px, py);
  if (tile) rules.send(who, { type: "visit", px, py, x: tile.x, y: tile.y });
  const from = state.residents[who];
  if (!from) return false;
  for (const dir of route(worldGround(state), from, target, state.config.reach, 8)) {
    if (!rules.send(who, { type: "move", dir })) break;
  }
  return near();
}

/** What a townsfolk here teaches: the real townsfolk's lists (`SPECIALTIES`), one each, in order. */
const teaches = (by: string): readonly RecipeName[] =>
  Object.values(SPECIALTIES)[TOWNSFOLK.indexOf(by)] ?? [];

/**
 * The day's lessons, once everyone around has been home. A gardener who'd sell a good they don't
 * know asks now and then (`TEACH_ASK`): the nearest neighbor around today who knows it and hasn't
 * taught today walks over, teaches it, and goes home. And now and then (`NEAR_TOWNSFOLK`) a
 * townsfolk stands near a resident who's around and teaches the first of their specialties the
 * resident doesn't know, as the server's lessons run does. The sim checks every lesson.
 */
function teachingDay(
  rules: Rules,
  active: readonly string[],
  byId: Map<string, Person>,
  planters: Map<string, Set<string>>,
) {
  const { state } = rules;
  const day = state.day ?? 0;
  const housed = active.filter((id) => state.residents[id]?.hearth);
  for (const id of housed) {
    const learner = state.residents[id];
    if (!learner?.hearth || !byId.get(id)?.habits.gardens) continue;
    const want = wantedCards(state, id, planters).filter((r) => !knows(state, id, r));
    if (want.length === 0 || taughtToday(state, id) > 0 || !lore.chance(TEACH_ASK)) continue;
    const home = learner.hearth;
    const teacher = housed
      .flatMap((t) => {
        const h = state.residents[t]?.hearth;
        if (t === id || !h || teachingToday(state, t) > 0) return [];
        const far = chebyshev(h, home);
        return far <= NEIGHBORLY && want.some((r) => knows(state, t, r)) ? [{ t, far }] : [];
      })
      .sort((a, b) => a.far - b.far || (a.t < b.t ? -1 : 1))[0]?.t;
    if (!teacher) continue;
    const recipe = want.find((r) => knows(state, teacher, r)) as RecipeName;
    if (meet(rules, teacher, id) && rules.send(teacher, { type: "teach", recipe, to: id })) {
      learned.taught++;
    }
    rules.home(teacher);
  }
  for (const id of housed) {
    if (!lore.chance(NEAR_TOWNSFOLK)) continue;
    const by = lore.pick(TOWNSFOLK) ?? "";
    const recipe = teaches(by).find((r) => !knows(state, id, r));
    if (!recipe || taughtToday(state, id) > 0 || !townsfolkLessonDue(state, id, day)) continue;
    if (meet(rules, by, id) && rules.send(by, { type: "teach", recipe, to: id })) {
      learned.townsfolk++;
    }
  }
}

// ---------- fishing (RFC 0023) ----------

/** The things a rod and a tile of pond take, gathered on the angler's own plot. */
const ROD_WOOD = RECIPES[FISHING_ROD].needs.wood ?? 0;

/**
 * Whether a plot suits an angler: forest and stony ground within reach of where its hearth will
 * be, so branches and stones for a rod and a pond turn up there within a few days, as they would
 * for someone who walks a little way to gather them.
 */
function anglersPlot(state: WorldState, px: number, py: number): boolean {
  const { plotSize, reach } = state.config;
  const hx = px * plotSize + Math.floor((plotSize - 1) / 2);
  const hy = py * plotSize + Math.floor((plotSize - 1) / 2);
  let forest = 0;
  let stone = 0;
  for (let y = hy - reach; y <= hy + reach; y++) {
    for (let x = hx - reach; x <= hx + reach; x++) {
      const b = biomeAt(state.config, x, y);
      if (b === "forest") forest++;
      if (b === "stone") stone++;
    }
  }
  return forest >= 8 && stone >= 8;
}

/**
 * An angler's day at home: pick up branches and stones within reach until they have a rod and a
 * pond, make the rod at their workbench and dig the pond by their hearth, then cast their casts
 * at moments through the day, and sell the town what it buys of their catch. They stop casting
 * while their things are near full, so fish never crowd out their garden.
 */
function goFishing(rules: Rules, id: string, habits: Habits) {
  const { state } = rules;
  const me = state.residents[id];
  const hearth = me?.hearth;
  const day = state.day ?? 0;
  if (!me || !hearth || habits.casts === 0) return;
  const inv = () => state.items?.inventories[id];
  const rod = holdsRod(inv());
  const pond = pondTile(hearth);
  const dug = isWater(state, pond.x, pond.y);
  if (!rod || !dug) {
    const { reach } = state.config;
    for (let y = hearth.y - reach; y <= hearth.y + reach; y++) {
      for (let x = hearth.x - reach; x <= hearth.x + reach; x++) {
        const kind = pickupLeft(state, x, y);
        if (kind === "wood" && (rod || holds(state, id, "wood") >= ROD_WOOD)) continue;
        if (kind === "stone" && (dug || holds(state, id, "stone") >= POND.stone)) continue;
        if (kind === "wood" || kind === "stone") rules.send(id, { type: "gather", x, y });
      }
    }
  }
  if (!rod && holds(state, id, "wood") >= ROD_WOOD) {
    let bench = Object.entries(state.blocks).find(([key, b]) => {
      const [x = 0, y = 0] = key.split(",").map(Number);
      const near = Math.max(Math.abs(x - hearth.x), Math.abs(y - hearth.y)) <= state.config.reach;
      return b === "workbench" && near;
    })?.[0];
    if (!bench) {
      const tile = gardenTiles(state, id)[0];
      if (tile && rules.send(id, { type: "place", ...tile, block: "workbench" })) {
        bench = tileKey(tile.x, tile.y);
      }
    }
    if (bench) {
      const [x = 0, y = 0] = bench.split(",").map(Number);
      rules.send(id, { type: "craft", recipe: FISHING_ROD, x, y });
    }
  }
  if (!dug && holds(state, id, "stone") >= POND.stone) {
    rules.send(id, { type: "place", ...pond, block: "pond" });
  }
  if (!holdsRod(inv()) || !waterBeside(me, (x, y) => isWater(state, x, y))) return;
  for (let i = castsToday(state, id); i < Math.min(habits.casts, FISHING.castsPerDay); i++) {
    if (inventorySize(inv()) > ITEMS.inventoryMax - 50) break;
    // As the server would log it: its roll, and the sky at a moment of the day.
    const roll = angling.between(0, FISHING.outOf - 1);
    const weather = weatherAt(day, angling.between(0, 23));
    const timeOfDay = angling.pick(TIMES_OF_DAY) ?? "day";
    if (rules.send(id, { type: "fish", roll, weather, timeOfDay })) tally.casts++;
  }
  for (const kind of townBuys(day)) {
    if (!(FISH_KINDS as readonly string[]).includes(kind)) continue;
    const count = Math.min(BUY_ORDERS[kind].perDay, holds(state, id, kind as StackKind));
    if (count === 0) continue;
    const before = coinsOf(state, id);
    sell(rules, id, kind, count);
    tally.fish += coinsOf(state, id) - before;
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

/** Who fishes (RFC 0023), as many as garden or more: casting costs nothing but a little time. */
const ANGLERS: Record<Kind, number> = { regular: 0.7, visitor: 0.5, drifter: 0.3, oneday: 0 };

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
        // Drawn from their own stream, so `--no-fishing` leaves everyone else's month as it was.
        casts: FISHING_ON && angling.chance(ANGLERS[kind]) ? angling.between(4, 10) : 0,
      },
    });
  }
  return people;
}

// ---------- the month ----------

interface Row {
  appreciation: number;
  sold: number;
  /** Coins the town paid for fish (part of `sold`), and casts made. */
  fish: number;
  casts: number;
  spent: number;
  /** Coins spent on recipe cards (part of `spent`). */
  cards: number;
  /** Coins spent on a holiday's costumes and decor (part of `spent`), and the part burned. */
  holiday: number;
  holidayBurned: number;
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
    if (RECIPES_ON) learnAtHome(rules, p.id, p.habits, planters);
    if (p.habits.gardens) tendGarden(rules, p.id, p.habits, planters);
    if (p.habits.casts > 0) goFishing(rules, p.id, p.habits);
    // A holiday's things sell only while it runs, so they come before the rest of the wish list.
    if (HOLIDAYS_ON) keepHoliday(rules, p);
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
    tally.fish = 0;
    tally.casts = 0;
    tally.cards = 0;
    tally.holiday = 0;
    tally.holidayBurned = 0;
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
          // An angler settles where branches and stones lie near their hearth.
          if (p.habits.casts > 0) anglers.add(p.id);
          rules.settle(
            p.id,
            p.habits.casts > 0 ? (px, py) => anglersPlot(rules.state, px, py) : undefined,
          );
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

    if (RECIPES_ON) teachingDay(rules, active, byId, planters);

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
      fish: tally.fish,
      casts: tally.casts,
      spent: tally.spent,
      cards: tally.cards,
      holiday: tally.holiday,
      holidayBurned: tally.holidayBurned,
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
    // What each newcomer had to spend by the end of their seventh day: their purse and what they
    // spent at the shop.
    for (const p of people) {
      if (p.arrives + 6 === day && settled.has(p.id)) {
        firstWeek.set(p.id, rules.balance(p.id) + (spentBy.get(p.id) ?? 0));
      }
    }
  }
  return { rows, people, shortWelcomes, facts, paired };
}

// ---------- report ----------

/**
 * How newcomers' first weeks went: gardeners who arrived with at least a week of the month left,
 * how many days until their first sale and their first sale of something they made, and once
 * recipes are learned, how they learned them, what cards cost them, and how many days until they
 * knew every year-round good they'd sell.
 */
function newcomerLines(people: Person[], rows: Row[]) {
  const gardeners = people.filter((p) => p.habits.gardens && p.settles && p.arrives <= DAYS - 8);
  const days = (seen: Map<string, number>) => {
    const list = gardeners.flatMap((p) => {
      const d = seen.get(p.id);
      return d === undefined ? [] : [d - p.arrives];
    });
    list.sort((a, b) => a - b);
    return `median ${percentile(list, 0.5)} days, p90 ${percentile(list, 0.9)}, ${list.length} of ${gardeners.length}`;
  };
  console.log(
    `Gardeners with a week or more left (n=${gardeners.length}): first sale ${days(firstSale)}; first sale of something they made ${days(firstMadeSale)}.`,
  );
  if (!RECIPES_ON) return;
  const week = rows.slice(-7);
  const cards = week.reduce((s, r) => s + r.cards, 0);
  const active = week.reduce((s, r) => s + r.active, 0) / week.length;
  console.log(
    `Recipes learned in the month: ${learned.picked} picked, ${learned.bought} cards bought (${learned.cardCoins} coins), ${learned.taught} taught by neighbors, ${learned.townsfolk} by townsfolk, ${learned.found} from pages.`,
  );
  console.log(
    `Last 7 days: cards ${Math.round(cards / 7)} coins a day, ${(cards / Math.max(1, active)).toFixed(1)} a week per active resident. Gardeners who know every year-round good they sell (${YEAR_ROUND.join(", ")}): ${days(knewThem)}.`,
  );
}

/**
 * What newcomers had to spend in their first week, by kind, and how each holiday in the month went:
 * who kept it, who bought a costume and decor for it (newcomers too: residents who arrived in the
 * week before it or during it), and what its stock took in and burned.
 */
function holidayLines(people: Person[], rows: Row[]) {
  console.log(
    "Newcomers' first 7 days (settled, arrived with 7 days left), purse plus shop spending:",
  );
  for (const kind of Object.keys(KINDS) as Kind[]) {
    const list = people
      .filter((p) => p.kind === kind && firstWeek.has(p.id))
      .map((p) => firstWeek.get(p.id) ?? 0)
      .sort((a, b) => a - b);
    if (list.length === 0) continue;
    console.log(
      `  ${kind.padEnd(8)} n=${pad(list.length, 3)}  p25 ${pad(percentile(list, 0.25), 4)}  median ${pad(percentile(list, 0.5), 4)}  p90 ${pad(percentile(list, 0.9), 4)}`,
    );
  }
  if (!HOLIDAYS_ON) return;
  const spent = rows.reduce((s, r) => s + r.holiday, 0);
  const burned = rows.reduce((s, r) => s + r.holidayBurned, 0);
  const arrives = new Map(people.map((p) => [p.id, p.arrives]));
  for (const [key, kept] of holidayKept) {
    const [holiday = "", year = "0"] = key.split(":");
    const { first, last } = holidaySpan(holiday as Holiday, Number(year));
    const days = rows.filter((r) => r.day >= first - DAY0 && r.day <= last - DAY0);
    const active = days.reduce((s, r) => s + r.active, 0) / Math.max(1, days.length);
    const newcomers = [...kept].filter((id) => (arrives.get(id) ?? -99) >= first - DAY0 - 7);
    const costumes = costumeBought.get(key) ?? new Set();
    const decor = decorBought.get(key) ?? new Set();
    const share = (n: number, of: number) =>
      `${n} of ${of} (${Math.round((100 * n) / Math.max(1, of))}%)`;
    console.log(
      `${holiday} ${year} (days ${first - DAY0} to ${last - DAY0}, ${Math.round(active)} active a day): ${kept.size} kept it; a costume ${share(costumes.size, kept.size)}, decor ${share(decor.size, kept.size)}. Newcomers (arrived from 7 days before it): a costume ${share(newcomers.filter((id) => costumes.has(id)).length, newcomers.length)}, decor ${share(newcomers.filter((id) => decor.has(id)).length, newcomers.length)}.`,
    );
  }
  console.log(`Holiday stock in the month: ${spent} coins spent, ${burned} burned.`);
}

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
      if (FISHING_ON) {
        const early = people.filter((p) => p.habits.casts > 0 && p.settles && p.arrives <= 6);
        const fishing = early.filter((p) => holdsRod(rules.state.items?.inventories[p.id]));
        const a = early.map((p) => rules.balance(p.id)).sort((x, y) => x - y);
        console.log(
          `Last 7 days fishing: ${avg((r) => r.casts)} casts a day, and the town paid ${avg((r) => r.fish)} a day for fish (part of what it paid for everything).`,
        );
        console.log(
          `Anglers who arrived in the first week (n=${early.length}, ${fishing.length} with a rod by month end): month-end purse median ${percentile(a, 0.5)}, p90 ${percentile(a, 0.9)}, max ${a.at(-1) ?? 0}.`,
        );
      }
    }
    if (SHOP_OPEN) newcomerLines(people, rows);
    if (SHOP_OPEN) holidayLines(people, rows);
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
