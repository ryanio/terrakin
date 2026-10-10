/**
 * Coins numbers simulation (RFC 0008). Plays a month of a few hundred residents arriving in a
 * world whose economy, items, and town shop have just opened, and prints supply per active
 * resident each day.
 *
 *   node scripts/economy-sim.ts [--seed 1] [--days 30] [--residents 300] [--start 2024-10-04] [--no-shop] [--no-appreciation] [--no-fishing] [--no-recipes] [--picks sell] [--no-holidays] [--holiday-prices lower] [--no-storeys] [--no-levels] [--set key=value ...]
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
 *   --no-storeys nobody builds up (RFC 0028), so the month plays as it did before storeys (the
 *                decision 0242 baseline)
 *   --no-levels  nobody earns points (RFC 0029): no `open_levels`, and none of what residents do
 *                for a level (finds, furniture, events, bounties, rated games, casting to the
 *                cap), so the month plays as it did before levels (the decision 0246 baseline)
 *   --picks      how gardeners use their free picks: `sell` (the default) picks the goods they'd
 *                sell, best paid first; `shelf` picks any three cards off the shelf, as someone
 *                picking what they like might, and leaves the goods to cards and lessons
 *   --set        try a different number without editing it: a key of ECONOMY (`allowance=8`), a
 *                shop price (`price.lantern=50`), what the town pays (`buy.lemon_jam=5`), its daily
 *                count (`perDay.lemon_jam=3`), a key of SHOP (`goodsPerDay=2`), or the pantry once
 *                the shop is open (`shopPantry.jar=2`, `shopStapleMax=8`), a key of
 *                RECIPES_RULES (`recipes.rotationTimes=4`, `recipes.pageOneIn=30`), or a key of
 *                STOREYS (`storeys.price=120`, `storeys.stairsWood=6`), or a key of PROGRESS
 *                (`progress.dailyCap=30`, `progress.step=20`)
 *
 * Every step is an input to the real sim (apply), and the numbers are the sim's own (ECONOMY in
 * packages/sim/src/economy.ts, ITEMS in packages/sim/src/items.ts, the catalog and buy orders in
 * packages/sim/src/shop.ts, RECIPES_RULES in packages/sim/src/recipes.ts, STOREYS in
 * packages/sim/src/storeys.ts, PROGRESS in packages/sim/src/levels.ts), so the script and the
 * rules can't drift. Karma is scored by the server's own `scoreKarma` with `KARMA` from the
 * protocol, and the townsfolk teach the server's own specialties (`SPECIALTIES`). Change a number
 * there, rerun this, and record why in a decision (decisions 0039, 0052, 0055, 0186, 0210, 0242,
 * and 0246).
 */
import { execFileSync } from "node:child_process";
import { registerHooks } from "node:module";
import { fileURLToPath } from "node:url";
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
  Skill,
  StackKind,
  WorldState,
} from "../packages/sim/src/index.ts";

const {
  activeTable,
  apply,
  biomeAt,
  bountyHeld,
  BUY_ORDERS,
  CARD_RECIPES,
  cardSeason,
  cardSku,
  chebyshev,
  CROP_INFO,
  CROPS,
  FIND_KINDS,
  castsToday,
  coinsOf,
  createWorld,
  ECONOMY,
  eventHeld,
  FISH_KINDS,
  FISHING,
  FISHING_ROD,
  FURNITURE_KINDS,
  FURNITURE_RECIPES,
  findEvent,
  firstsOf,
  GOOD_KINDS,
  HOLIDAY_STOCK,
  holdsRod,
  holidayOf,
  holidaySpan,
  ITEMS,
  inventorySize,
  isCommons,
  isDecorKind,
  isFindKind,
  isGoodKind,
  isShopWear,
  isReady,
  isWater,
  joinTile,
  knows,
  levelOf,
  levelsOf,
  onSale,
  onShelf,
  pageOn,
  pickupLeft,
  picksLeft,
  plotAtTile,
  plotOf,
  POND,
  PROGRESS,
  pointsFor,
  pointsOf,
  priceOf,
  RECIPE_PAGE,
  RECIPES,
  RECIPES_RULES,
  recipeCardPrice,
  recipeOf,
  route,
  SHOP,
  SHOP_CATALOG,
  SHOP_SHARE_BEFORE,
  SKILLS,
  STOREYS,
  SWEET_KINDS,
  sameHousehold,
  shelfOn,
  TIMES_OF_DAY,
  TOWN_ACTOR,
  dateOfDay,
  dayOfDate,
  taughtToday,
  teachable,
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
    "no-storeys": { type: "boolean", default: false },
    "no-levels": { type: "boolean", default: false },
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
  } else if (tail && head === "storeys" && tail in STOREYS) {
    (STOREYS as unknown as Mutable)[tail] = n;
  } else if (tail && head === "progress" && tail in PROGRESS) {
    (PROGRESS as unknown as Mutable)[tail] = n;
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
/** Some regulars save for a storey and gather wood for stairs and a loft (RFC 0028). */
const STOREYS_ON = SHOP_OPEN && !args["no-storeys"];
/** Deeds earn points, and some residents play for them (RFC 0029). */
const LEVELS_ON = SHOP_OPEN && !args["no-levels"];
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
// Who builds up a storey (RFC 0028): `--no-storeys` draws none of it.
const building = draws(mulberry32(SEED ^ 0x5707));
// Who plays for levels and how (RFC 0029): `--no-levels` draws none of it.
const climbing = draws(mulberry32(SEED ^ 0x1e7e1));

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
function simRules(residents = RESIDENTS): Rules {
  // A square of 8-tile plots with room for every resident, less the Commons.
  const side = Math.ceil(Math.sqrt(residents + 1)) + 1;
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
      if (LEVELS_ON) {
        // As on terrakin.org: a plot's pickups are its owners', bounties are open, and finds are
        // out. Everyone here gathers within reach of their own hearth, which is their own plot, so
        // the first changes nothing for anglers and builders. A new world has no collection book
        // to credit.
        if (!RECIPES_ON) must(TOWN_ACTOR, { type: "open_finds" });
        must(TOWN_ACTOR, { type: "own_plot_pickups" });
        must(TOWN_ACTOR, { type: "open_bounties" });
        must(TOWN_ACTOR, { type: "open_levels", firsts: [] });
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
  /** Saves for a storey, gathers wood, and puts up stairs and a planked loft (RFC 0028). */
  builds: boolean;
  /** Picks up the finds lying within reach of their hearth (RFC 0029). */
  forages: boolean;
  /** Picks up wood and stone within reach and makes furniture at a workbench. */
  makes: boolean;
  /** Holds an event on their plot once a week and posts a small bounty once a week. */
  hosts: boolean;
  /** Rated games they sit down to on a day they're around. 0 never plays. */
  plays: number;
  /** Keeps casting past their habit until the day's casts or Foraging's cap run out. */
  climbs: boolean;
  /**
   * The one skill they play in earnest, as a keen person or an AI on a schedule would, leaving the
   * other ways to play for levels alone (RFC 0029's gardeners, makers, foragers, hosts, and
   * players).
   */
  focus?: Skill;
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

/**
 * Where a builder puts their stairs: outside the starter hut's east wall, beside its middle, so
 * they come up next to the loft (RFC 0028).
 */
const stairsTile = (hearth: { x: number; y: number }) => ({ x: hearth.x + 3, y: hearth.y + 1 });

/** Residents who build up, so their gardens leave the stairs' tile free. */
const builders = new Set<string>();

/** The free tiles on a resident's plot within reach of their hearth, nearest first. */
function gardenTiles(state: WorldState, id: string): { x: number; y: number }[] {
  const me = state.residents[id];
  const hearth = me?.hearth;
  if (!me || !hearth) return [];
  const pond = anglers.has(id) ? pondTile(hearth) : undefined;
  const stairs = builders.has(id) ? stairsTile(hearth) : undefined;
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
      if (stairs && stairs.x === x && stairs.y === y) continue;
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
const tally = {
  sold: 0,
  spent: 0,
  fish: 0,
  casts: 0,
  cards: 0,
  holiday: 0,
  holidayBurned: 0,
  storeys: 0,
  storeyBurned: 0,
};

/** Coins each resident has spent at the shop, for what they had to spend in their first week. */
const spentBy = new Map<string, number>();
/**
 * What each settled resident had to spend by the end of their seventh day: purse plus shop
 * spending, and a storey's price if they added one. And what they spent at the shop alone.
 */
const firstWeek = new Map<string, number>();
const firstWeekShop = new Map<string, number>();

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
  // Someone growing in earnest (RFC 0029) fills their planters sooner: two seeds of the quickest
  // crop the shop sells today, whenever the purse allows.
  if (habits.focus === "growing" && SHOP_OPEN && mine.size < habits.planters) {
    const quick = CROPS.filter((c) => onSale(CROP_INFO[c].seed, day)).sort(
      (a, b) => CROP_INFO[a].days - CROP_INFO[b].days,
    )[0];
    if (quick) {
      const seed = CROP_INFO[quick].seed;
      if (coinsOf(state, id) >= SHOP_CATALOG[seed].price * 2 + 20) buy(rules, id, seed, 2);
    }
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
  // Someone making in earnest (RFC 0029) cooks what's left: any good they know, from what they
  // hold, while Making has room today. A kind they haven't made comes first.
  if (habits.focus === "making") {
    const needs = (kind: GoodKind) => Object.entries(RECIPES[kind].needs) as [StackKind, number][];
    const can = (kind: GoodKind) =>
      knows(state, id, recipeOf(kind)) && needs(kind).every(([k, n]) => holds(state, id, k) >= n);
    while (
      roomToday(state, id, "making") > 0 &&
      inventorySize(state.items?.inventories[id]) < ITEMS.inventoryMax - 50
    ) {
      const made = firstsOf(state, id);
      const ready = GOOD_KINDS.filter(can);
      const next = ready.find((kind) => !made.includes(kind)) ?? ready[0];
      const at = next && station(RECIPES[next].station);
      if (!next || !at || !rules.send(id, { type: "craft", recipe: next, ...at })) break;
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
  // Everyone keeps a little back, and a builder saving for a storey keeps that back too.
  const saving = habits.builds && !storeyAdded.has(id) ? STOREYS.price : 0;
  if (coinsOf(state, id) < SHOP_CATALOG[next].price + 10 + saving) return;
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
  if (holdsRod(inv()) && !firstRod.has(id)) firstRod.set(id, today(state));
  if (!holdsRod(inv()) || !waterBeside(me, (x, y) => isWater(state, x, y))) return;
  for (let i = castsToday(state, id); i < Math.min(habits.casts, FISHING.castsPerDay); i++) {
    if (inventorySize(inv()) > ITEMS.inventoryMax - 50) break;
    // As the server would log it: its roll, and the sky at a moment of the day.
    const roll = angling.between(0, FISHING.outOf - 1);
    const weather = weatherAt(day, angling.between(0, 23));
    const timeOfDay = angling.pick(TIMES_OF_DAY) ?? "day";
    if (rules.send(id, { type: "fish", roll, weather, timeOfDay })) tally.casts++;
  }
  // Someone playing for levels (RFC 0029) casts on while Foraging has room today, from their own
  // stream, so the casts above are the ones a month without levels makes.
  if (habits.climbs) {
    for (let i = castsToday(state, id); i < FISHING.castsPerDay; i++) {
      if (inventorySize(inv()) > ITEMS.inventoryMax - 50 || roomToday(state, id, "foraging") <= 0)
        break;
      const roll = climbing.between(0, FISHING.outOf - 1);
      const weather = weatherAt(day, climbing.between(0, 23));
      const timeOfDay = climbing.pick(TIMES_OF_DAY) ?? "day";
      if (rules.send(id, { type: "fish", roll, weather, timeOfDay })) tally.casts++;
    }
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

// ---------- storeys (RFC 0028) ----------

/** The month's day each builder first held the price of a storey, added it, and finished it. */
const storeyAfforded = new Map<string, number>();
const storeyAdded = new Map<string, number>();
const stairsUp = new Map<string, number>();
const loftDone = new Map<string, number>();
/** The month's day each angler first held a rod, to compare with and without builders. */
const firstRod = new Map<string, number>();
/**
 * Wood builders gathered for building up, and the days they were home gathering it, and how much
 * each has put into stairs and floors.
 */
const woodFor = { gathered: 0, daysHome: 0 };
const woodUsed = new Map<string, number>();

/** The starter hut's 25 tiles, which a builder planks over upstairs. */
const loftTiles = (hearth: { x: number; y: number }) => {
  const tiles: { x: number; y: number }[] = [];
  for (let y = hearth.y - 2; y <= hearth.y + 2; y++) {
    for (let x = hearth.x - 2; x <= hearth.x + 2; x++) tiles.push({ x, y });
  }
  return tiles;
};
/** Wood a builder needs in all: stairs, and a plank floor over the hut. */
const loftWood = () => STOREYS.stairsWood + 25;

/**
 * Whether a plot suits a builder: woods within reach of where its hearth will be, so branches turn
 * up there, as they would for someone who walks a little way to gather them.
 */
function buildersPlot(state: WorldState, px: number, py: number): boolean {
  const { plotSize, reach } = state.config;
  const hx = px * plotSize + Math.floor((plotSize - 1) / 2);
  const hy = py * plotSize + Math.floor((plotSize - 1) / 2);
  let forest = 0;
  for (let y = hy - reach; y <= hy + reach; y++) {
    for (let x = hx - reach; x <= hx + reach; x++) {
      if (biomeAt(state.config, x, y) === "forest") forest++;
    }
  }
  return forest >= 8;
}

/**
 * A builder's day at home: pick up branches within reach while short of the wood the stairs and a
 * plank loft take, add the storey once they hold its price with 10 coins to spare (they skip other
 * wishes that would eat into it, `goShopping`), then put up the stairs and plank the loft as the
 * wood allows, from their hearth.
 */
function goBuild(rules: Rules, id: string, habits: Habits) {
  const { state } = rules;
  const me = state.residents[id];
  const hearth = me?.hearth;
  if (!me || !hearth || !habits.builds) return;
  const day = today(state);
  const used = () => woodUsed.get(id) ?? 0;
  const { reach, plotSize } = state.config;
  if (used() + holds(state, id, "wood") < loftWood()) woodFor.daysHome++;
  for (let y = hearth.y - reach; y <= hearth.y + reach; y++) {
    for (let x = hearth.x - reach; x <= hearth.x + reach; x++) {
      if (used() + holds(state, id, "wood") >= loftWood()) break;
      if (pickupLeft(state, x, y) !== "wood") continue;
      const before = holds(state, id, "wood");
      if (rules.send(id, { type: "gather", x, y })) {
        woodFor.gathered += holds(state, id, "wood") - before;
      }
    }
  }
  if (!storeyAdded.has(id)) {
    const purse = coinsOf(state, id);
    if (purse >= STOREYS.price && !storeyAfforded.has(id)) storeyAfforded.set(id, day);
    if (purse < STOREYS.price + 10) return;
    const px = Math.floor(hearth.x / plotSize);
    const py = Math.floor(hearth.y / plotSize);
    const burned = state.economy?.burned ?? 0;
    if (!rules.send(id, { type: "add_storey", px, py })) return;
    storeyAdded.set(id, day);
    tally.storeys += purse - coinsOf(state, id);
    tally.storeyBurned += (state.economy?.burned ?? 0) - burned;
  }
  const spend = (n: number) => woodUsed.set(id, used() + n);
  if (used() < STOREYS.stairsWood) {
    if (holds(state, id, "wood") < STOREYS.stairsWood) return;
    if (!rules.send(id, { type: "place", ...stairsTile(hearth), block: "stairs" })) return;
    spend(STOREYS.stairsWood);
    stairsUp.set(id, day);
  }
  for (const tile of loftTiles(hearth)) {
    if (used() >= loftWood() || holds(state, id, "wood") < 1) break;
    const laid = { type: "lay", ...tile, storey: 1, ground: "planks" } as const;
    if (rules.send(id, laid)) spend(1);
  }
  if (used() >= loftWood() && !loftDone.has(id)) loftDone.set(id, day);
}

// ---------- levels (RFC 0029) ----------

/**
 * Who plays for levels beyond a garden and a rod, by how often they come back. Guesses, not
 * measurements: about half the regulars pick up finds and keep casting, fewer make furniture or
 * sit down to games, and a few host. The sim's caps bound them whatever they are.
 */
const FORAGERS: Record<Kind, number> = { regular: 0.5, visitor: 0.3, drifter: 0.2, oneday: 0 };
const MAKERS: Record<Kind, number> = { regular: 0.4, visitor: 0.2, drifter: 0.1, oneday: 0 };
const HOSTS: Record<Kind, number> = { regular: 0.2, visitor: 0.1, drifter: 0, oneday: 0 };
const PLAYERS: Record<Kind, number> = { regular: 0.3, visitor: 0.2, drifter: 0.1, oneday: 0 };
const CLIMBERS: Record<Kind, number> = { regular: 0.5, visitor: 0.25, drifter: 0.1, oneday: 0 };
/** Regulars who play one skill in earnest: a quarter of them, spread over the five skills. */
const FOCUSED = 0.25;
/** Chance a neighbor who's around today comes to a host's event. */
const COMES = 0.35;

/**
 * Turn a regular into someone who plays one skill in earnest and none of the others for levels: a
 * full garden; a garden cooked into goods and furniture from what lies near; ten casts a day and
 * every find near home; an event a week, every neighbor's event, a lesson a day, and any bounty
 * going; or three slow tables a day, which is as many seats as one resident holds.
 */
function focusOn(habits: Habits, skill: Skill) {
  Object.assign(habits, { forages: false, makes: false, hosts: false, plays: 0, climbs: false });
  habits.focus = skill;
  if (skill === "growing" || skill === "making") habits.gardens = true;
  if (skill === "growing") habits.planters = 22;
  if (skill === "making") habits.makes = true;
  if (skill === "foraging") {
    habits.casts = FISHING_ON ? FISHING.castsPerDay : 0;
    habits.forages = true;
    habits.climbs = true;
  }
  if (skill === "hosting") habits.hosts = true;
  if (skill === "playing") habits.plays = 3;
}
/** The server's guest rule (`countGuests`): this old with a hearth, counted for this many hosts a day. */
const GUEST_MIN_AGE_DAYS = 3;
const GUEST_HOSTS_PER_DAY = 2;
const HOUR_MS = 3_600_000;

/** Points a skill can still count today for a resident. */
const roomToday = (state: WorldState, id: string, skill: Skill) =>
  PROGRESS.dailyCap - (state.progress?.today?.[id]?.[skill] ?? 0);

const totalPoints = (state: WorldState, id: string) =>
  SKILLS.reduce((sum, skill) => sum + (pointsOf(state, id)[skill] ?? 0), 0);

/** A forager's day at home: every find lying within reach of their hearth. */
function goForage(rules: Rules, id: string) {
  const { state } = rules;
  const hearth = state.residents[id]?.hearth;
  if (!hearth) return;
  const { reach } = state.config;
  for (let y = hearth.y - reach; y <= hearth.y + reach; y++) {
    for (let x = hearth.x - reach; x <= hearth.x + reach; x++) {
      if (isFindKind(pickupLeft(state, x, y))) rules.send(id, { type: "gather", x, y });
    }
  }
}

/** Furniture made of nothing but wood and stone, which a maker can pick up near home. */
const MAKER_RECIPES = FURNITURE_KINDS.filter((kind) =>
  Object.keys(FURNITURE_RECIPES[kind].needs).every((k) => k === "wood" || k === "stone"),
);
const woodIn = (kind: (typeof MAKER_RECIPES)[number]) => FURNITURE_RECIPES[kind].needs.wood ?? 0;
const stoneIn = (kind: (typeof MAKER_RECIPES)[number]) => FURNITURE_RECIPES[kind].needs.stone ?? 0;

/** A resident's own workbench within reach of their hearth, placed now if they have none. */
function workbench(rules: Rules, id: string): { x: number; y: number } | undefined {
  const { state } = rules;
  const hearth = state.residents[id]?.hearth;
  if (!hearth) return undefined;
  for (const [key, b] of Object.entries(state.blocks)) {
    const [x = 0, y = 0] = key.split(",").map(Number);
    const near = Math.max(Math.abs(x - hearth.x), Math.abs(y - hearth.y)) <= state.config.reach;
    if (b === "workbench" && near) return { x, y };
  }
  const tile = gardenTiles(state, id)[0];
  return tile && rules.send(id, { type: "place", ...tile, block: "workbench" }) ? tile : undefined;
}

/**
 * A maker's day at home: pick up the branches and stones within reach, then make furniture from
 * them at a workbench while Making has room today. A kind they haven't made comes first (it's a
 * first), then whatever takes the least. Wood a builder still needs for a loft, and what an angler
 * still needs for a rod and a pond, is left alone.
 */
function goMake(rules: Rules, id: string, habits: Habits) {
  const { state } = rules;
  const me = state.residents[id];
  const hearth = me?.hearth;
  if (!me || !hearth) return;
  const inv = () => state.items?.inventories[id];
  if (inventorySize(inv()) > ITEMS.inventoryMax - 50) return;
  const { reach } = state.config;
  for (let y = hearth.y - reach; y <= hearth.y + reach; y++) {
    for (let x = hearth.x - reach; x <= hearth.x + reach; x++) {
      const kind = pickupLeft(state, x, y);
      if (kind === "wood" || kind === "stone") rules.send(id, { type: "gather", x, y });
    }
  }
  const loft = habits.builds ? Math.max(0, loftWood() - (woodUsed.get(id) ?? 0)) : 0;
  const rod = habits.casts > 0 && !holdsRod(inv()) ? ROD_WOOD : 0;
  const pond = pondTile(hearth);
  const dig = habits.casts > 0 && !isWater(state, pond.x, pond.y) ? POND.stone : 0;
  const wood = () => holds(state, id, "wood") - loft - rod;
  const stone = () => holds(state, id, "stone") - dig;
  const fits = (kind: (typeof MAKER_RECIPES)[number]) =>
    knows(state, id, kind) && woodIn(kind) <= wood() && stoneIn(kind) <= stone();
  let bench: { x: number; y: number } | undefined;
  while (roomToday(state, id, "making") > 0) {
    const can = MAKER_RECIPES.filter(fits);
    if (can.length === 0) break;
    const made = firstsOf(state, id);
    const cost = (kind: (typeof MAKER_RECIPES)[number]) => woodIn(kind) + stoneIn(kind);
    const next =
      can.find((kind) => !made.includes(kind)) ?? [...can].sort((a, b) => cost(a) - cost(b))[0];
    bench ??= workbench(rules, id);
    if (!next || !bench || !rules.send(id, { type: "craft", recipe: next, ...bench })) break;
  }
}

/** Who each guest was counted for today, for the server's two-hosts-a-day rule. */
const countedFor = new Map<string, Set<string>>();

/**
 * One event on a host's plot today: scheduled, started, the guests walk over, two samples, the
 * end, and the credit, with the guests the server would count (`countGuests`: three days old with
 * a hearth, outside the host's household, counted for at most two other hosts today). Then the
 * guests go home. `age` is how many days ago a resident arrived. Returns the counted guests, or
 * null when the sim wouldn't book it. `credit` overrides the list sent, to try a wrong one.
 */
function holdEvent(
  rules: Rules,
  host: string,
  guests: readonly string[],
  hour: number,
  age: (id: string) => number,
  credit?: (counted: string[], attended: string[]) => string[],
): string[] | null {
  const { state } = rules;
  const hearth = state.residents[host]?.hearth;
  if (!hearth) return null;
  const { px, py } = plotOf(state.config, hearth.x, hearth.y);
  const startsAt = (state.day ?? 0) * 24 * HOUR_MS + hour * HOUR_MS;
  const booked = rules.send(host, {
    type: "schedule_event",
    kind: "gathering",
    title: "Tea",
    px,
    py,
    startsAt,
    minutes: 30,
  });
  const event = state.events?.list.at(-1);
  if (!booked || !event || event.host !== host) return null;
  rules.send(TOWN_ACTOR, { type: "event_start", event: event.id });
  for (const guest of guests) {
    const tile = joinTile(state, guest, event);
    rules.send(guest, { type: "join_event", event: event.id, ...(tile ?? {}) });
  }
  rules.send(TOWN_ACTOR, { type: "event_tick", event: event.id, slot: 1 });
  rules.send(TOWN_ACTOR, { type: "event_tick", event: event.id, slot: 2 });
  rules.send(TOWN_ACTOR, { type: "event_end", event: event.id });
  const attended = findEvent(state, event.id)?.attended ?? [];
  const counted = attended.filter((id) => {
    const others = [...(countedFor.get(id) ?? [])].filter((h) => h !== host).length;
    return (
      age(id) >= GUEST_MIN_AGE_DAYS &&
      state.residents[id]?.hearth != null &&
      !sameHousehold(state, host, id) &&
      others < GUEST_HOSTS_PER_DAY
    );
  });
  const listed = credit ? credit(counted, attended) : counted;
  if (rules.send(TOWN_ACTOR, { type: "credit_event", event: event.id, guests: listed })) {
    for (const id of listed) countedFor.set(id, (countedFor.get(id) ?? new Set()).add(host));
  }
  for (const guest of guests) rules.home(guest);
  return counted;
}

/** A bounty posted, claimed, done, and paid in one go. True when the poster paid. */
function payBounty(rules: Rules, poster: string, claimant: string, reward: number): boolean {
  const { state } = rules;
  if (coinsOf(state, poster) < reward + 10) return false;
  if (!rules.send(poster, { type: "post_bounty", title: "A hand in the garden", reward })) {
    return false;
  }
  const bounty = state.bounties?.list.at(-1)?.id ?? "";
  if (
    rules.send(claimant, { type: "claim_bounty", bounty }) &&
    rules.send(claimant, { type: "complete_bounty", bounty })
  ) {
    return rules.send(poster, { type: "confirm_bounty", bounty, to: claimant });
  }
  rules.send(poster, { type: "cancel_bounty", bounty });
  return false;
}

/** The server's clock for game inputs: a second on each time it's read. */
let gameClock = 1_000;
const HEX = "0123456789abcdef";

/**
 * One Hearth race at a slow table: the first seat opens it and starts it, everyone picks 1 to 3 a
 * round from `rng`, and the server closes each round until someone's home. The sim decides who's
 * rated. True when the game was played.
 */
function playGame(rules: Rules, seats: readonly string[], rng: ReturnType<typeof draws>): boolean {
  const { state } = rules;
  const [first = "", ...rest] = seats;
  const salt = Array.from({ length: 32 }, () => HEX[rng.between(0, 15)]).join("");
  const at = () => {
    gameClock += 1_000;
    return gameClock;
  };
  if (
    !rules.send(first, { type: "open_table", game: "hearth_race", pace: "slow", salt, at: at() })
  ) {
    return false;
  }
  const table = Object.keys(state.games?.tables ?? {})
    .sort((a, b) => Number(a.slice(2)) - Number(b.slice(2)))
    .at(-1);
  if (!table) return false;
  for (const seat of rest) rules.send(seat, { type: "sit", table, at: at() });
  if (!rules.send(first, { type: "start_game", table, at: at() })) {
    rules.send(first, { type: "stand", table });
    return false;
  }
  for (let rounds = 0; rounds < 40; rounds++) {
    const t = activeTable(state, table);
    if (t?.status !== "playing") break;
    for (const seat of t.seats) {
      const move = rng.between(1, 3);
      rules.send(seat.resident, { type: "decide", table, round: t.round, move });
    }
    rules.send(TOWN_ACTOR, { type: "close_round", table, round: t.round, at: at() });
  }
  return true;
}

/** Neighbors of `id` among `around`: residents whose hearths are within two plots, not their household. */
function neighborsOf(state: WorldState, id: string, around: readonly string[]): string[] {
  const home = state.residents[id]?.hearth;
  if (!home) return [];
  return around.filter((other) => {
    const h = state.residents[other]?.hearth;
    return (
      other !== id && h && chebyshev(h, home) <= NEIGHBORLY && !sameHousehold(state, id, other)
    );
  });
}

/** What hosting and playing came to over the month, for the report. */
const gatherings = { events: 0, guests: 0, counted: 0, bounties: 0, games: 0, lessons: 0 };

/**
 * The day's events and bounties, once everyone around has been home. A host who's been here three
 * days holds an event on their plot once a week, and the neighbors who are around come now and
 * then (`COMES`). Two days later in their week they post a small bounty that a neighbor does.
 */
function hostingDay(rules: Rules, active: readonly string[], byId: Map<string, Person>) {
  const { state } = rules;
  const day = today(state);
  const age = (id: string) => day - (byId.get(id)?.arrives ?? day);
  const housed = active.filter((id) => state.residents[id]?.hearth);
  countedFor.clear();
  for (const id of housed) {
    const p = byId.get(id);
    if (!p?.habits.hosts || age(id) < GUEST_MIN_AGE_DAYS) continue;
    const neighbors = neighborsOf(state, id, housed);
    const keen = neighbors.filter((n) => byId.get(n)?.habits.focus === "hosting");
    if (age(id) % 7 === 3) {
      // Someone hosting in earnest goes to every neighbor's event; the rest come now and then.
      const guests = neighbors.filter((n) => keen.includes(n) || climbing.chance(COMES));
      const counted = holdEvent(rules, id, guests, 18, age);
      if (counted) {
        gatherings.events++;
        gatherings.guests += guests.length;
        gatherings.counted += counted.length;
      }
    }
    if (age(id) % 7 === 5) {
      // And takes any bounty going.
      const claimant = keen[0] ?? climbing.pick(neighbors);
      const reward = climbing.between(5, 10);
      if (claimant && payBounty(rules, id, claimant, reward)) gatherings.bounties++;
    }
  }
  // Someone hosting in earnest also teaches a neighbor a day, when one who's around and hasn't
  // been taught today lacks something they know.
  for (const id of housed) {
    if (byId.get(id)?.habits.focus !== "hosting" || teachingToday(state, id) > 0) continue;
    const learner = neighborsOf(state, id, housed).find(
      (n) => taughtToday(state, n) === 0 && teachable(state, id, n).length > 0,
    );
    const recipe = learner && teachable(state, id, learner)[0];
    if (learner && recipe && meet(rules, id, learner)) {
      if (rules.send(id, { type: "teach", recipe, to: learner })) gatherings.lessons++;
    }
    rules.home(id);
  }
}

/**
 * The day's games: the players who are around sit down in twos (a third joins the last table when
 * they're odd), shuffled again for each game, as many games each as they play in a day.
 */
function playingDay(rules: Rules, active: readonly string[], byId: Map<string, Person>) {
  const { state } = rules;
  const players = active.filter(
    (id) => state.residents[id]?.hearth && (byId.get(id)?.habits.plays ?? 0) > 0,
  );
  for (let game = 1; game <= 4; game++) {
    const pool = players.filter((id) => (byId.get(id)?.habits.plays ?? 0) >= game);
    for (let i = pool.length - 1; i > 0; i--) {
      const j = climbing.between(0, i);
      [pool[i], pool[j]] = [pool[j] as string, pool[i] as string];
    }
    while (pool.length >= 2) {
      const seats = pool.length === 3 ? pool.splice(0, 3) : pool.splice(0, 2);
      if (playGame(rules, seats, climbing)) gatherings.games++;
    }
  }
}

/** The month's day each resident reached level 5, a skill at level 3, and each skill at level 5. */
const reachedFive = new Map<string, number>();
const reachedTitle = new Map<string, number>();
const skillFive = new Map<Skill, Map<string, number>>(SKILLS.map((skill) => [skill, new Map()]));
/** Each settled resident's points when their first day ended. */
const firstDay = new Map<string, number>();
/** Days a resident earned in a skill, and days they filled its cap, over everyone. */
const earnedDays = new Map<Skill, number>(SKILLS.map((skill) => [skill, 0]));
const cappedDays = new Map<Skill, number>(SKILLS.map((skill) => [skill, 0]));

/** Note where everyone's levels stand as a day ends. */
function noteLevels(state: WorldState, people: readonly Person[], settled: Set<string>) {
  const day = today(state);
  for (const p of people) {
    if (!settled.has(p.id)) continue;
    if (p.arrives === day) firstDay.set(p.id, totalPoints(state, p.id));
    const { level, skills } = levelsOf(state, p.id);
    if (level >= 5 && !reachedFive.has(p.id)) reachedFive.set(p.id, day);
    for (const skill of SKILLS) {
      if (skills[skill] >= 3 && !reachedTitle.has(p.id)) reachedTitle.set(p.id, day);
      const seen = skillFive.get(skill);
      if (skills[skill] >= 5 && seen && !seen.has(p.id)) seen.set(p.id, day);
      const counted = state.progress?.today?.[p.id]?.[skill] ?? 0;
      if (counted > 0) earnedDays.set(skill, (earnedDays.get(skill) ?? 0) + 1);
      if (counted >= PROGRESS.dailyCap) cappedDays.set(skill, (cappedDays.get(skill) ?? 0) + 1);
    }
  }
}

/**
 * What RFC 0029's first and fifth checks need that a month of ordinary residents doesn't show: a
 * small world of its own, played beside the month so it changes nothing there. In it a newcomer
 * does the first visit and then a chair, a rod, and a fish; a household of a person and two AIs
 * teach, pay, host, and play each other; and a ring of ten fresh accounts teach each other, pay
 * each other two bounties a day, and go to two of their own events a day.
 */
function lab() {
  const rules = simRules(40);
  const { state } = rules;
  rules.open();
  const guide = "l_guide";
  const pat = "l_pat";
  const ais = ["l_ai1", "l_ai2"];
  const trio = [pat, ...ais];
  const ring = Array.from({ length: 10 }, (_, i) => `l_ring${i}`);
  const everyone = [guide, ...trio, ...ring];
  for (const id of everyone) rules.join(id);
  rules.setOwnerPairs(ais.map((ai) => [ai, pat].sort() as [string, string]));
  anglers.add(guide);
  rules.settle(guide, (px, py) => anglersPlot(state, px, py));
  for (const id of [...trio, ...ring]) rules.settle(id);
  for (const id of everyone) rules.home(id);
  // Free picks, three cards each off today's shelf, so there's something to teach.
  for (const id of everyone) {
    while (picksLeft(state, id) > 0) {
      const recipe = climbing.pick(shelfOn(state.day ?? 0).filter((r) => !knows(state, id, r)));
      if (!recipe || !rules.send(id, { type: "pick_recipe", recipe })) break;
    }
  }

  // The newcomer's first day. The first visit's steps in the world: a plot, a home, a seed in the
  // ground. None is a deed.
  const plot = gardenTiles(state, guide)[0];
  if (plot && rules.send(guide, { type: "place", ...plot, block: "planter" })) {
    const seed = CROPS.find((c) => holds(state, guide, CROP_INFO[c].seed) > 0);
    if (seed) rules.send(guide, { type: "plant", ...plot, seed });
  }
  const afterVisit = totalPoints(state, guide);
  // Then a walk for what a chair, a rod, and a pond take, picked up where it lies nearest home.
  const needs = { wood: woodIn("chair") + ROD_WOOD, stone: POND.stone };
  let steps = 0;
  const hearth = state.residents[guide]?.hearth ?? { x: 0, y: 0 };
  const lying: { x: number; y: number; kind: "wood" | "stone"; far: number }[] = [];
  for (let y = 0; y < state.config.height; y++) {
    for (let x = 0; x < state.config.width; x++) {
      const kind = pickupLeft(state, x, y);
      if (kind !== "wood" && kind !== "stone") continue;
      const owner = plotAtTile(state, x, y)?.ownerId;
      if (owner !== undefined && owner !== guide) continue;
      lying.push({ x, y, kind, far: chebyshev({ x, y }, hearth) });
    }
  }
  lying.sort((a, b) => a.far - b.far || a.y - b.y || a.x - b.x);
  for (const at of lying) {
    if (holds(state, guide, at.kind) >= needs[at.kind]) continue;
    const me = state.residents[guide];
    if (!me) break;
    for (const dir of route(worldGround(state), me, at, state.config.reach, 48)) {
      if (!rules.send(guide, { type: "move", dir })) break;
      steps++;
    }
    rules.send(guide, { type: "gather", x: at.x, y: at.y });
  }
  rules.send(guide, { type: "home" });
  const bench = workbench(rules, guide);
  if (bench) {
    rules.send(guide, { type: "craft", recipe: "chair", ...bench });
    rules.send(guide, { type: "craft", recipe: FISHING_ROD, ...bench });
  }
  rules.send(guide, { type: "place", ...pondTile(hearth), block: "pond" });
  let fish = 0;
  for (let i = 0; i < FISHING.castsPerDay; i++) {
    const roll = climbing.between(0, FISHING.outOf - 1);
    const before = pointsOf(state, guide).foraging ?? 0;
    rules.send(guide, { type: "fish", roll, weather: "clear", timeOfDay: "day" });
    if ((pointsOf(state, guide).foraging ?? 0) > before) fish++;
  }
  const newcomer = {
    afterVisit,
    steps,
    fish,
    points: totalPoints(state, guide),
    level: levelsOf(state, guide).level,
  };

  // The month for the household and the ring.
  const ringDays: number[] = [];
  let refusedCredits = 0;
  const ringLevel = { title: -1, wear: -1 };
  const age = () => today(state);
  for (let day = 0; day < DAYS; day++) {
    if (day > 0) rules.newDay(day);
    for (const id of everyone) rules.home(id);
    countedFor.clear();
    // The household: a lesson each way where there's one to give, a bounty round the three, a
    // game together, and once a week an event with the other two as guests, credited as if the
    // server had counted them, which the sim refuses.
    for (const a of trio) {
      for (const b of trio) {
        const recipe = a === b ? undefined : teachable(state, a, b)[0];
        if (recipe && meet(rules, a, b)) rules.send(a, { type: "teach", recipe, to: b });
        rules.home(a);
      }
    }
    trio.forEach((poster, i) => {
      payBounty(rules, poster, trio[(i + 1) % 3] ?? "", PROGRESS.bountyMinReward);
    });
    playGame(rules, trio, climbing);
    if (day % 7 === 3) {
      const before = state.seq;
      holdEvent(rules, pat, ais, 10, age, (_counted, attended) => attended);
      const event = state.events?.list.at(-1);
      if (event && !event.credited && state.seq > before) refusedCredits++;
    }
    // The ring: each teaches the next one round a lesson when there's one to give, posts two
    // bounties to two others, and all of them go to the two events two of them hold.
    const shift = 1 + (day % 9);
    const other = 1 + ((day + 4) % 9);
    ring.forEach((a, i) => {
      const b = ring[(i + shift) % 10] ?? "";
      const recipe = teachable(state, a, b)[0];
      if (recipe && meet(rules, a, b)) rules.send(a, { type: "teach", recipe, to: b });
      rules.home(a);
    });
    ring.forEach((poster, i) => {
      payBounty(rules, poster, ring[(i + shift) % 10] ?? "", PROGRESS.bountyMinReward);
      payBounty(rules, poster, ring[(i + other) % 10] ?? "", PROGRESS.bountyMinReward);
    });
    for (const [n, hour] of [
      [day % 10, 12],
      [(day + 5) % 10, 15],
    ] as const) {
      const host = ring[n] ?? "";
      holdEvent(
        rules,
        host,
        ring.filter((id) => id !== host),
        hour,
        age,
      );
    }
    for (const id of ring) {
      ringDays.push(state.progress?.today?.[id]?.hosting ?? 0);
      const hosting = levelsOf(state, id).skills.hosting;
      if (hosting >= 3 && ringLevel.title < 0) ringLevel.title = day;
      if (hosting >= 5 && ringLevel.wear < 0) ringLevel.wear = day;
    }
  }
  const each = (id: string, skill: Skill) => pointsOf(state, id)[skill] ?? 0;
  return {
    newcomer,
    household: {
      hosting: trio.reduce((sum, id) => sum + each(id, "hosting"), 0),
      playing: trio.reduce((sum, id) => sum + each(id, "playing"), 0),
      refusedCredits,
    },
    ring: {
      mean: ringDays.reduce((sum, n) => sum + n, 0) / Math.max(1, ringDays.length),
      max: Math.max(0, ...ringDays),
      hosting: ring.map((id) => each(id, "hosting")).sort((a, b) => a - b),
      level: Math.min(...ring.map((id) => levelsOf(state, id).skills.hosting)),
      ...ringLevel,
    },
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
  habits: Habits;
}

/** Regulars garden most, and AI residents (a third of them) tend a garden as a daily routine. */
const GARDENS: Record<Kind, number> = { regular: 0.7, visitor: 0.45, drifter: 0.3, oneday: 0 };

/** Who fishes (RFC 0023), as many as garden or more: casting costs nothing but a little time. */
const ANGLERS: Record<Kind, number> = { regular: 0.7, visitor: 0.5, drifter: 0.3, oneday: 0 };

/**
 * Who builds up (RFC 0028): half the regulars, a guess. A storey is a long goal, and only someone
 * who comes home most days saves for one.
 */
const BUILDERS: Record<Kind, number> = { regular: 0.5, visitor: 0, drifter: 0, oneday: 0 };

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
        // From their own stream too, so `--no-storeys` leaves everyone else's month as it was.
        builds: STOREYS_ON && BUILDERS[kind] > 0 && building.chance(BUILDERS[kind]),
        // And these from theirs, so `--no-levels` does.
        forages: LEVELS_ON && climbing.chance(FORAGERS[kind]),
        makes: LEVELS_ON && climbing.chance(MAKERS[kind]),
        hosts: LEVELS_ON && climbing.chance(HOSTS[kind]),
        plays: LEVELS_ON && climbing.chance(PLAYERS[kind]) ? climbing.between(1, 4) : 0,
        climbs: LEVELS_ON && climbing.chance(CLIMBERS[kind]),
      },
    });
    const p = people.at(-1);
    if (p && LEVELS_ON && kind === "regular" && climbing.chance(FOCUSED)) {
      focusOn(p.habits, climbing.pick(SKILLS) ?? "growing");
    }
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
  /** Coins storeys took (RFC 0028), and the part burned. */
  storeys: number;
  storeyBurned: number;
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
    if (p.habits.builds) goBuild(rules, p.id, p.habits);
    if (p.habits.forages) goForage(rules, p.id);
    if (p.habits.makes) goMake(rules, p.id, p.habits);
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
    tally.storeys = 0;
    tally.storeyBurned = 0;
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
          // An angler settles where branches and stones lie near their hearth, and a builder
          // where branches do.
          if (p.habits.casts > 0) anglers.add(p.id);
          if (p.habits.builds) builders.add(p.id);
          rules.settle(
            p.id,
            p.habits.casts > 0
              ? (px, py) => anglersPlot(rules.state, px, py)
              : p.habits.builds
                ? (px, py) => buildersPlot(rules.state, px, py)
                : undefined,
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
    if (LEVELS_ON) {
      hostingDay(rules, active, byId);
      playingDay(rules, active, byId);
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
      fish: tally.fish,
      casts: tally.casts,
      spent: tally.spent,
      cards: tally.cards,
      holiday: tally.holiday,
      holidayBurned: tally.holidayBurned,
      storeys: tally.storeys,
      storeyBurned: tally.storeyBurned,
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

    // The ledger must balance every day: everything minted is in a purse or the treasury, or held
    // in a bounty or a booking that hasn't finished (none without levels).
    let inPurses = held;
    for (const id of TOWNSFOLK) inPurses += rules.balance(id);
    const waiting = bountyHeld(rules.state) + eventHeld(rules.state);
    if (inPurses + rules.treasury() + waiting !== supply) {
      throw new Error(
        `Day ${day}: purses + treasury = ${inPurses + rules.treasury() + waiting}, supply ${supply}`,
      );
    }
    if (LEVELS_ON) noteLevels(rules.state, people, settled);
    // What each newcomer had to spend by the end of their seventh day: their purse and what they
    // spent at the shop.
    for (const p of people) {
      if (p.arrives + 6 === day && settled.has(p.id)) {
        const storey = storeyAdded.has(p.id) ? STOREYS.price : 0;
        firstWeek.set(p.id, rules.balance(p.id) + (spentBy.get(p.id) ?? 0) + storey);
        firstWeekShop.set(p.id, spentBy.get(p.id) ?? 0);
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

/**
 * The five checks RFC 0028 asks of storeys: supply per active resident at each week, how soon a
 * builder can afford a storey and adds it, the newcomers' first week at the shop, how long the wood
 * for stairs and a planked loft takes against the anglers' rods, and what storeys burn against the
 * mint. The first, third, and fourth print with `--no-storeys` too, to compare.
 */
function storeyLines(people: Person[], rows: Row[]) {
  console.log("");
  console.log(
    `Storeys (RFC 0028): ${STOREYS_ON ? `price ${STOREYS.price}, stairs ${STOREYS.stairsWood} wood, a loft of 25 planks` : "off"}.`,
  );
  const weeks = [7, 14, 21, DAYS - 1].map((d) => rows[d]).filter((r): r is Row => r !== undefined);
  console.log(
    `  Per active resident: ${weeks.map((r) => `day ${r.day} ${r.perActive}`).join(", ")}; ${(((weeks.at(-1)?.perActive ?? 0) - (weeks[0]?.perActive ?? 0)) / Math.max(1, (weeks.at(-1)?.day ?? 0) - (weeks[0]?.day ?? 0))).toFixed(1)} a day from day 7.`,
  );
  const fell = rows.filter((r, i) => i > 0 && r.supply < (rows[i - 1]?.supply ?? 0)).length;
  const shop = (kind: Kind, builds?: boolean) =>
    people
      .filter((p) => p.kind === kind && firstWeekShop.has(p.id))
      .filter((p) => builds === undefined || p.habits.builds === builds)
      .map((p) => firstWeekShop.get(p.id) ?? 0)
      .sort((a, b) => a - b);
  const line = (l: number[]) =>
    `${percentile(l, 0.5)} (${percentile(l, 0.25)}, ${percentile(l, 0.9)})`;
  console.log(
    `  Newcomers' first 7 days at the shop alone, median (p25, p90): ${(
      Object.keys(KINDS) as Kind[]
    )
      .map((k) => `${k} ${line(shop(k))}`)
      .join(", ")}.`,
  );
  if (STOREYS_ON) {
    console.log(
      `  Of the regulars: builders ${line(shop("regular", true))}, the rest ${line(shop("regular", false))}.`,
    );
  }
  const anglersEarly = people.filter(
    (p) => p.habits.casts > 0 && p.settles && p.arrives <= DAYS - 8,
  );
  const rodDays = anglersEarly
    .flatMap((p) => {
      const d = firstRod.get(p.id);
      return d === undefined ? [] : [d - p.arrives];
    })
    .sort((a, b) => a - b);
  console.log(
    `  Anglers with a week or more left (n=${anglersEarly.length}): a rod in median ${percentile(rodDays, 0.5)} days, p90 ${percentile(rodDays, 0.9)}, ${rodDays.length} of ${anglersEarly.length}.`,
  );
  console.log(`  Supply fell on ${fell} of ${rows.length - 1} days.`);
  if (!STOREYS_ON) return;
  const mine = people.filter((p) => p.habits.builds && p.settles && p.arrives <= DAYS - 8);
  const after = (seen: Map<string, number>) => {
    const list = mine
      .flatMap((p) => {
        const d = seen.get(p.id);
        return d === undefined ? [] : [d - p.arrives];
      })
      .sort((a, b) => a - b);
    return `median ${percentile(list, 0.5)} days after arriving, p25 ${percentile(list, 0.25)}, p90 ${percentile(list, 0.9)}, earliest ${list[0] ?? "-"}, ${list.length} of ${mine.length}`;
  };
  console.log(
    `  Builders: ${people.filter((p) => p.habits.builds).length} regulars, ${mine.length} settled with a week or more left.`,
  );
  console.log(`  Held the price of a storey: ${after(storeyAfforded)}.`);
  console.log(`  Added it: ${after(storeyAdded)}.`);
  console.log(`  Stairs up (${STOREYS.stairsWood} wood): ${after(stairsUp)}.`);
  console.log(
    `  Stairs and a planked loft (${loftWood()} wood): ${after(loftDone)}; ${woodFor.gathered} wood gathered for it in ${woodFor.daysHome} builder-days at home, ${(woodFor.gathered / Math.max(1, woodFor.daysHome)).toFixed(2)} a day.`,
  );
  const week = rows.slice(-7);
  const sum = (f: (r: Row) => number, list: Row[]) => list.reduce((s, r) => s + f(r), 0);
  const mint = sum((r) => r.mint, week) / week.length;
  const burned = sum((r) => r.storeyBurned, week) / week.length;
  console.log(
    `  Storeys took ${sum((r) => r.storeys, rows)} coins in the month (${sum((r) => r.storeyBurned, rows)} burned); in the last 7 days ${Math.round(burned)} burned a day against ${Math.round(mint)} minted a day (${Math.round((100 * burned) / Math.max(1, mint))}%).`,
  );
}

/**
 * The six checks RFC 0029 asks of levels (section 10), from the month just played, a small world
 * of its own for the newcomer, the household, and the ring (`lab`), and the same month played
 * again with `--no-levels` to compare supply.
 */
function levelLines(rules: Rules, people: Person[], rows: Row[]) {
  const { state } = rules;
  console.log("");
  console.log(
    `Levels (RFC 0029): ${Object.entries(PROGRESS)
      .map(([k, v]) => `${k}=${v}`)
      .join(
        " ",
      )}. Level 2 at ${pointsFor(2)} points, 3 at ${pointsFor(3)}, 5 at ${pointsFor(5)}, 10 at ${pointsFor(10)}.`,
  );
  const settled = people.filter((p) => p.settles);
  const share = (n: number, of: number) =>
    `${n} of ${of} (${Math.round((100 * n) / Math.max(1, of))}%)`;
  /** Days after arriving that each of `list` was first seen, sorted; unseen ones last, as 99. */
  const after = (list: Person[], seen: Map<string, number>) =>
    list
      .map((p) => {
        const d = seen.get(p.id);
        return d === undefined ? 99 : d - p.arrives;
      })
      .sort((a, b) => a - b);
  const days = (n: number) => (n >= 99 ? "not in the month" : `${n} days`);
  const within = (list: number[], n: number) => list.filter((d) => d <= n).length;
  const tested = lab();

  // 1. The first day.
  const first = settled.map((p) => firstDay.get(p.id) ?? 0).sort((a, b) => a - b);
  console.log(
    `  1. First day. Settled newcomers in the month ended their first day with a median of ${percentile(first, 0.5)} points (p90 ${percentile(first, 0.9)}); level 2 that day: ${share(first.filter((n) => n >= pointsFor(2)).length, first.length)}.`,
  );
  console.log(
    `     On their own: the first visit's steps earned ${tested.newcomer.afterVisit} points. Then ${tested.newcomer.steps} steps for the wood and stone, a chair, a rod, a pond, and ${FISHING.castsPerDay} casts (${tested.newcomer.fish} fish): ${tested.newcomer.points} points, level ${tested.newcomer.level}. ${tested.newcomer.level >= 2 ? "Holds for a newcomer who makes and fishes" : "Fails"}; the first visit alone has no deed in it.`,
  );

  // 2. A regular's first two weeks.
  const regulars = settled.filter((p) => p.kind === "regular" && p.arrives <= DAYS - 15);
  const five = after(regulars, reachedFive);
  const title = after(regulars, reachedTitle);
  console.log(
    `  2. Regulars with two weeks or more left (n=${regulars.length}): level 5 after a median of ${days(percentile(five, 0.5))} (p25 ${percentile(five, 0.25)}, p90 ${days(percentile(five, 0.9))}), within 7 days ${share(within(five, 7), five.length)}, within 14 ${share(within(five, 14), five.length)}; a skill at level 3 after a median of ${days(percentile(title, 0.5))} (p90 ${days(percentile(title, 0.9))}), within 14 days ${share(within(title, 14), title.length)}.`,
  );

  // 3. A resident at every cap against a regular.
  const early = settled.filter((p) => p.kind === "regular" && p.arrives <= 2);
  const levels = early.map((p) => levelsOf(state, p.id).level).sort((a, b) => a - b);
  const points = early.map((p) => totalPoints(state, p.id)).sort((a, b) => a - b);
  const kinds =
    CROPS.length +
    GOOD_KINDS.length +
    FURNITURE_KINDS.length +
    SWEET_KINDS.length +
    FIND_KINDS.length +
    FISH_KINDS.length;
  const ceiling = DAYS * SKILLS.length * PROGRESS.dailyCap + kinds * PROGRESS.first;
  const top = Math.max(1, ...settled.map((p) => levelsOf(state, p.id).level));
  const median = percentile(levels, 0.5);
  // The regular the RFC has in mind tends a garden and more: here, a garden and a rod.
  const busy = early
    .filter((p) => p.habits.gardens && p.habits.casts > 0)
    .map((p) => levelsOf(state, p.id).level)
    .sort((a, b) => a - b);
  const busyMedian = percentile(busy, 0.5);
  const times = (level: number) =>
    `${(levelOf(ceiling) / Math.max(1, level)).toFixed(2)} times (${levelOf(ceiling) <= 2 * level ? "holds" : "fails"}: at most 2)`;
  console.log(
    `  3. Month end. Regulars who arrived in the first 3 days (n=${early.length}): level median ${median} (p25 ${percentile(levels, 0.25)}, p90 ${percentile(levels, 0.9)}), points median ${percentile(points, 0.5)}; those with a garden and a rod (n=${busy.length}): level median ${busyMedian}. Every cap every day with every first (${kinds} kinds) is ${ceiling} points, level ${levelOf(ceiling)}: ${times(median)} the median regular, ${times(busyMedian)} one with a garden and a rod. The highest level anyone reached: ${top}.`,
  );

  // 4. Each skill on its own.
  const plays: Record<Skill, (p: Person) => boolean> = {
    growing: (p) => p.habits.gardens,
    making: (p) => p.habits.makes || p.habits.gardens,
    foraging: (p) => p.habits.casts > 0 || p.habits.forages,
    hosting: (p) => p.habits.hosts,
    playing: (p) => p.habits.plays > 0,
  };
  console.log(
    `  4. Days to level 5 in a skill (${pointsFor(5)} points). Regulars who play that one skill in earnest and arrived with 2 weeks or more left: how many reached it and when, and the days it takes at the points a day they earned over their days here. Then the same pace for every regular who plays the skill at all.`,
  );
  /** Points a day in `skill` over each resident's days here, sorted. */
  const paces = (list: Person[], skill: Skill) =>
    list
      .map((p) => (pointsOf(state, p.id)[skill] ?? 0) / Math.max(1, DAYS - p.arrives))
      .sort((a, b) => a - b);
  const at = (rate: number) => (rate > 0 ? `${Math.round(pointsFor(5) / rate)} days` : "never");
  for (const skill of SKILLS) {
    const lasting = settled.filter((p) => p.kind === "regular" && p.arrives <= DAYS - 15);
    const keen = lasting.filter((p) => p.habits.focus === skill);
    const seen = after(keen, skillFive.get(skill) ?? new Map());
    const pace = paces(keen, skill);
    const casual = paces(
      lasting.filter((p) => p.habits.focus === undefined && plays[skill](p)),
      skill,
    );
    const earnedOn = earnedDays.get(skill) ?? 0;
    console.log(
      `     ${skill.padEnd(9)} in earnest n=${pad(keen.length, 2)}: reached it ${share(within(seen, 98), seen.length)}, soonest ${days(seen[0] ?? 99)}; ${percentile(pace, 0.5).toFixed(1)} a day at the median (${at(percentile(pace, 0.5))}), ${(pace.at(-1) ?? 0).toFixed(1)} at best (${at(pace.at(-1) ?? 0)}). The rest who play it, n=${pad(casual.length, 2)}: ${percentile(casual, 0.5).toFixed(1)} a day (${at(percentile(casual, 0.5))}). At the cap on ${Math.round((100 * (cappedDays.get(skill) ?? 0)) / Math.max(1, earnedOn))}% of the ${earnedOn} days anyone earned in it.`,
    );
  }
  console.log(
    `     In the month: ${gatherings.events} events with ${gatherings.guests} guests (${gatherings.counted} counted), ${gatherings.bounties} bounties paid, ${gatherings.lessons} lessons from those hosting in earnest, ${gatherings.games} games played.`,
  );

  // 5. A household, and a ring.
  console.log(
    `  5. A person and two AIs teaching, paying, hosting, and playing each other for ${DAYS} days earned ${tested.household.hosting} Hosting and ${tested.household.playing} Playing points (${tested.household.hosting + tested.household.playing === 0 ? "holds" : "fails"}: nothing), and the sim refused ${tested.household.refusedCredits} event credits that named them as guests. A ring of ten fresh accounts earned ${tested.ring.mean.toFixed(1)} Hosting points an account a day, ${tested.ring.max} at most (${tested.ring.max <= PROGRESS.dailyCap ? "holds" : "fails"}: the cap is ${PROGRESS.dailyCap}); by month end each had ${tested.ring.hosting[0]} to ${tested.ring.hosting.at(-1)} points, Hosting ${tested.ring.level}, with the title from day ${tested.ring.title} and the garment from day ${tested.ring.wear < 0 ? "none" : tested.ring.wear}.`,
  );

  // 6. Supply against the same month without levels.
  const last = rows.at(-1);
  const without = execFileSync(
    process.execPath,
    [fileURLToPath(import.meta.url), ...process.argv.slice(2), "--no-levels"],
    { encoding: "utf8", maxBuffer: 1 << 26 },
  );
  const found = /Month end: supply (\d+), treasury \d+, (\d+) coins per active resident/.exec(
    without,
  );
  const sold = /residents sold (\d+) a day to the town/.exec(without);
  if (last && found) {
    const before = Number(found[2]);
    const supply = Number(found[1]);
    const moved = (now: number, was: number) =>
      `${(((now - was) / Math.max(1, was)) * 100).toFixed(1)}%`;
    const week = rows.slice(-7);
    const soldNow = Math.round(week.reduce((s, r) => s + r.sold, 0) / week.length);
    console.log(
      `  6. Per active resident at month end: ${last.perActive} with levels, ${before} without (${moved(last.perActive, before)}; ${Math.abs(last.perActive - before) * 50 < before ? "holds" : "fails"}: under 2%). Supply ${last.supply} against ${supply} (${moved(last.supply, supply)}). Sold to the town in the last 7 days: ${soldNow} a day against ${sold ? sold[1] : "?"}.`,
    );
  }
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
        `Last 7 days at the shop: residents sold ${avg((r) => r.sold)} a day to the town (minted) and spent ${avg((r) => r.spent)} a day (${avg((r) => r.burned - r.storeyBurned)} burned, the rest to the treasury).`,
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
    if (SHOP_OPEN) storeyLines(people, rows);
    if (LEVELS_ON) levelLines(rules, people, rows);
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
