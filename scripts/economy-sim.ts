/**
 * Coins numbers simulation (RFC 0008). Plays a month of a few hundred residents arriving in a
 * world whose economy, items, and town shop have just opened, and prints supply per active
 * resident each day.
 *
 *   node scripts/economy-sim.ts [--seed 1] [--days 30] [--residents 300] [--start 2024-10-04] [--no-shop] [--no-shop-counter] [--shop-trips 100] [--no-appreciation] [--no-fishing] [--no-recipes] [--picks sell] [--no-holidays] [--holiday-prices lower] [--no-floors] [--no-cozy] [--no-levels] [--no-jobs] [--kiln] [--townsfolk-spend 80] [--starter-gift 0] [--starter-from resident] [--job-pay 0] [--job-pay-from treasury] [--set key=value ...]
 *
 *   --seed       PRNG seed, so a run repeats exactly (default 1)
 *   --days       days to play (default 30)
 *   --start      the UTC date the month starts on (default 2024-10-04, an autumn month, so the
 *                shop's autumn stock and the town's autumn buying are in it; RFC 0017).
 *                `--start 2024-12-04` plays a winter month (decision 0124).
 *   --residents  residents who arrive over those days, not counting the townsfolk (default 300)
 *   --no-shop    play phase 1 only: coins, no gardens, no shop (the decision 0039 baseline)
 *   --no-shop-counter  the shop serves from anywhere, as it did before RFC 0042. The default
 *                logs `shop_in_person` as terrakin.org does, so a resident walks to the counter
 *                and back for every purchase and sale.
 *   --shop-trips the percent of days a resident who wants the shop actually makes the walk
 *                (default 100). The walk costs nothing in the sim, so this is the only channel
 *                the counter rule has on the coin numbers: a trade either happens or it doesn't.
 *                Nobody has measured the real figure; a week of the live world will say.
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
 *   --kiln       the world logs `open_clay` with `water` (RFC 0047, off on terrakin.org until
 *                it's switched on), and some residents, drawn from their own stream, take up
 *                pottery: they dig a pond, pick up the clay beside it or walk for more, place a
 *                kiln, and fire a pot a day, buying the vase's and
 *                the teapot's cards as they can. Off by default, so the month plays as terrakin.org
 *                does; it prints RFC 0047's checks, to compare against the same month without it
 *   --no-cozy    makers never go on to the armchair, the sofa, and the bed (RFC 0044), so the month
 *                plays as it did before them
 *   --no-floors nobody builds up (RFC 0028), so the month plays as it did before homes went up (the
 *                decision 0242 baseline)
 *   --no-levels  nobody earns points (RFC 0029): no `open_levels`, and none of what residents do
 *                for a level (finds, furniture, events, bounties, rated games, casting to the
 *                cap), so the month plays as it did before levels (the decision 0246 baseline)
 *   --no-jobs    nobody takes a job (RFC 0030): no `open_jobs`, and none of what residents do for
 *                one, so the month plays as it did before jobs (the decision 0255 baseline)
 *   --job-edition  the edition of the jobs table the board reads (default: the newest, which
 *                terrakin.org reads), logged with `set_job_edition` right after `open_jobs`, so the
 *                whole month reads it. `--job-edition 1` plays the first edition (the decision
 *                0255 run)
 *   --townsfolk-spend  the percent of each townsfolk budget their scripts hand out as tips each day
 *                (default 80). On terrakin.org with about 40 residents they hand out about 10%,
 *                and the rest goes back to the treasury at `new_day`.
 *   --starter-gift  coins a welcomer gives each settled newcomer (default 0, no welcomer). The
 *                welcomer is one more resident who comes home every day and does nothing else, as
 *                an AI resident welcoming newcomers might (issue #63). With `--starter-from
 *                resident` (the default) they pay from their own purse, oldest newcomer first,
 *                when they can, and the coin flow lines say how long the gifts waited. With `town`
 *                the treasury pays it as part of a larger welcome gift (`welcomeGift` plus this),
 *                and with `townsfolk` the townsfolk add it to their welcome tip of 10, from their
 *                budgets (the sim refuses what goes past `townsfolkPerResident`); the welcomer then
 *                gives nothing.
 *   --job-pay    coins for each job finished (default 0, RFC 0030 pays none). With
 *                `--job-pay-from treasury` (the default) the treasury pays it only while it keeps
 *                `budgetReserve` afterwards, and skips it otherwise; with `mint` it's minted. No
 *                sim rule pays it: the script moves the coins with the sim's own ledger helpers
 *                when it hears `job_done`, so the supply still adds up. With a starter gift the
 *                welcomer finishes a job on each of the first three days of a UTC week.
 *   --picks      how gardeners use their free picks: `sell` (the default) picks the goods they'd
 *                sell, best paid first; `shelf` picks any three cards off the shelf, as someone
 *                picking what they like might, and leaves the goods to cards and lessons
 *   --set        try a different number without editing it: a key of ECONOMY (`allowance=8`), a
 *                shop price (`price.lantern=50`), what the town pays (`buy.lemon_jam=5`), its daily
 *                count (`perDay.lemon_jam=3`), a key of SHOP (`goodsPerDay=2`), or the pantry once
 *                the shop is open (`shopPantry.jar=2`, `shopStapleMax=8`), a key of
 *                RECIPES_RULES (`recipes.rotationTimes=4`, `recipes.pageOneIn=30`), or a key of
 *                FLOORS (`floors.price=120`, `floors.stairsWood=6`), or a key of PROGRESS
 *                (`progress.dailyCap=30`, `progress.step=20`), or a key of JOBS (`jobs.points=20`,
 *                `jobs.perWeek=5`)
 *
 * Every step is an input to the real sim (apply), and the numbers are the sim's own (ECONOMY in
 * packages/sim/src/economy.ts, ITEMS in packages/sim/src/items.ts, the catalog and buy orders in
 * packages/sim/src/shop.ts, RECIPES_RULES in packages/sim/src/recipes.ts, FLOORS in
 * packages/sim/src/floors.ts, PROGRESS in packages/sim/src/levels.ts, JOBS and the jobs table in
 * packages/sim/src/jobs.ts), so the script and the rules can't drift. Karma is scored by the server's own `scoreKarma` with `KARMA` from the
 * protocol, and the townsfolk teach the server's own specialties (`SPECIALTIES`). Change a number
 * there, rerun this, and record why in a decision (decisions 0039, 0052, 0055, 0186, 0210, 0242,
 * 0246, and 0255).
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
  Job,
  JobDeed,
  JobWait,
  RecipeName,
  SellKind,
  ShopSku,
  Skill,
  StackKind,
  Station,
  WorldEvent,
  WorldState,
} from "../packages/sim/src/index.ts";

const {
  activeTable,
  apply,
  biomeAt,
  bountyHeld,
  BUY_ORDERS,
  CARD_RECIPES,
  CATALOG,
  cardSeason,
  cardSku,
  chebyshev,
  CROP_INFO,
  CROPS,
  dayName,
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
  GLAZE_COSTS,
  GOOD_KINDS,
  HOLIDAY_STOCK,
  holdsRod,
  holidayRun,
  holidaySpan,
  holidaysOf,
  ITEMS,
  inventorySize,
  isCommons,
  isDecorKind,
  isFindKind,
  isGoodKind,
  isShopWear,
  isReady,
  isWater,
  JOB_EDITIONS,
  JOB_TITLE_INFO,
  JOBS,
  jobById,
  jobsDone,
  jobsOn,
  jobWaits,
  joinTile,
  circleById,
  knownByAll,
  knows,
  levelOf,
  levelsOf,
  nearestCounter,
  notAtTheCounter,
  onSale,
  onShelf,
  pageOn,
  pickupLeft,
  picksLeft,
  plotAtTile,
  plotOf,
  POND,
  POTTERY,
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
  FLOORS,
  SWEET_KINDS,
  sameHousehold,
  seasonOf,
  shelfOn,
  soloJob,
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
  weekStart,
  worldGround,
} = await import("../packages/sim/src/index.ts");
const { SPECIALTIES } = await import("../packages/server/src/lesson-plan.ts");
const { KARMA, KARMA_TIERS, tierAtLeast } = await import("../packages/protocol/src/social.ts");
const { scoreKarma } = await import("../packages/server/src/karma.ts");
const { movePurse, moveTreasury } = await import("../packages/sim/src/economy.ts");
const { jobPayFromTreasury, starterGiftsToday, waits } = await import("./coin-flow.ts");
type Waits = import("./coin-flow.ts").Waits;

type Numbers = { -readonly [K in keyof typeof ECONOMY]: number };
type Mutable = Record<string, number | Record<string, number | Record<string, number>>>;

const { values: args } = parseArgs({
  options: {
    seed: { type: "string", default: "1" },
    days: { type: "string", default: "30" },
    residents: { type: "string", default: "300" },
    start: { type: "string", default: "2024-10-04" },
    "no-shop": { type: "boolean", default: false },
    "no-shop-counter": { type: "boolean", default: false },
    "shop-trips": { type: "string", default: "100" },
    "no-appreciation": { type: "boolean", default: false },
    "no-fishing": { type: "boolean", default: false },
    "no-recipes": { type: "boolean", default: false },
    "no-holidays": { type: "boolean", default: false },
    "holiday-prices": { type: "string", default: "lower" },
    "no-floors": { type: "boolean", default: false },
    "no-cozy": { type: "boolean", default: false },
    "no-levels": { type: "boolean", default: false },
    "no-jobs": { type: "boolean", default: false },
    kiln: { type: "boolean", default: false },
    "job-edition": { type: "string" },
    // Print only what a run with jobs compares against, as one line of JSON (`jobLines`).
    dump: { type: "boolean", default: false },
    picks: { type: "string", default: "sell" },
    "townsfolk-spend": { type: "string", default: "80" },
    "starter-gift": { type: "string", default: "0" },
    "starter-from": { type: "string", default: "resident" },
    "job-pay": { type: "string", default: "0" },
    "job-pay-from": { type: "string", default: "treasury" },
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
  } else if (tail && head === "floors" && tail in FLOORS) {
    (FLOORS as unknown as Mutable)[tail] = n;
  } else if (tail && head === "progress" && tail in PROGRESS) {
    (PROGRESS as unknown as Mutable)[tail] = n;
  } else if (tail && head === "jobs" && tail in JOBS) {
    (JOBS as unknown as Mutable)[tail] = n;
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
/** Some regulars save for a floor and gather wood for stairs and a loft (RFC 0028). */
const FLOORS_ON = SHOP_OPEN && !args["no-floors"];
/** Deeds earn points, and some residents play for them (RFC 0029). */
const LEVELS_ON = SHOP_OPEN && !args["no-levels"];
/**
 * Makers who have made every wood-and-stone piece they know go on to the pieces you rest on (RFC 0044):
 * a card and cushions from the shop for each. `--no-cozy` plays the month as it was before them.
 * No draw: it is a rule over what a maker has already made, so no other stream moves.
 */
const COZY_ON = LEVELS_ON && !args["no-cozy"];
/**
 * Pottery (RFC 0047): clay on the ground, a kiln, and residents who fire a pot a day. Off unless
 * asked for, as it is on terrakin.org until `open_clay` is logged; its draws are its own stream.
 */
const KILN_ON = LEVELS_ON && args.kiln === true;
/** The town has a board, and some residents take its jobs (RFC 0030). Jobs pay points. */
const JOBS_ON = LEVELS_ON && !args["no-jobs"];
/** The edition of the jobs table the board reads, from the month's first day (decision 0265). */
const JOB_EDITION = Number(
  args["job-edition"] ?? Math.max(...Object.keys(JOB_EDITIONS).map(Number)),
);
if (!(JOB_EDITION in JOB_EDITIONS)) throw new Error(`--job-edition: no edition ${JOB_EDITION}`);
if (args["holiday-prices"] !== "lower" && args["holiday-prices"] !== "before") {
  throw new Error("--holiday-prices is lower or before");
}
/** Whether the world logs `lower_holiday_prices` when the shop opens, as terrakin.org does. */
const LOWER_HOLIDAY_PRICES = SHOP_OPEN && args["holiday-prices"] === "lower";
if (args.picks !== "sell" && args.picks !== "shelf") throw new Error("--picks is sell or shelf");
/** Whether gardeners pick the goods they'd sell (`--picks sell`) or any cards (`--picks shelf`). */
/**
 * The shop is a place you go to ([RFC 0042](../docs/rfcs/0042-actions-that-need-you-there.md)):
 * the world logs `shop_in_person`, as terrakin.org does, and a resident walks to the counter
 * before buying or selling and comes home after. `--no-shop-counter` plays the month as it was
 * before the rule, which is the run every number before 2026-10-20 was tuned against.
 */
const SHOP_COUNTER = SHOP_OPEN && !args["no-shop-counter"];
/**
 * The share of days a resident who wants something actually makes the trip, as a percent. The
 * walk itself costs nothing in the sim, so this is the only channel the counter rule has on the
 * coin numbers: a trade either happens or it doesn't. 100 is the designed behaviour, residents
 * shop as they did and walk for it. Lower numbers are the pessimistic end of the bracket, for
 * residents who stop bothering. Nobody has measured the real figure yet; a week of the live
 * world now that the rule is on will say what it is.
 */
const SHOP_TRIPS = Number(args["shop-trips"] ?? 100) / 100;

const PICK_TO_SELL = args.picks === "sell";
const SEED = Number(args.seed);
/** A welcomer's starter gift to each newcomer (issue #63), and whether the town pays it instead. */
const STARTER_GIFT = Number(args["starter-gift"]);
const STARTER_FROM = args["starter-from"];
if (STARTER_FROM !== "resident" && STARTER_FROM !== "town" && STARTER_FROM !== "townsfolk") {
  throw new Error("--starter-from is resident, town, or townsfolk");
}
// The town's starter gift is the welcome gift made larger: paid in full from the treasury, in
// order, ahead of townsfolk budgets.
if (STARTER_FROM === "town") N.welcomeGift += STARTER_GIFT;
/**
 * What the townsfolk scripts give each newcomer: 10, decision 0039's month. terrakin.org gives 25
 * (`TIPS.welcome`, decision 0278), which `--starter-gift 15 --starter-from townsfolk` plays.
 */
const TOWNSFOLK_WELCOME = 10 + (STARTER_FROM === "townsfolk" ? STARTER_GIFT : 0);
/** Coins for a finished job, and where they come from. */
const JOB_PAY = Number(args["job-pay"]);
if (args["job-pay-from"] !== "treasury" && args["job-pay-from"] !== "mint") {
  throw new Error("--job-pay-from is treasury or mint");
}
const JOB_PAY_MINTED = args["job-pay-from"] === "mint";
for (const [flag, n] of [
  ["--starter-gift", STARTER_GIFT],
  ["--job-pay", JOB_PAY],
  ["--townsfolk-spend", Number(args["townsfolk-spend"])],
] as const) {
  if (!Number.isInteger(n) || n < 0) throw new Error(`${flag} wants a whole number`);
}
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
// Who builds up a floor (RFC 0028): `--no-floors` draws none of it.
const building = draws(mulberry32(SEED ^ 0x5707));
// Who plays for levels and how (RFC 0029): `--no-levels` draws none of it.
const climbing = draws(mulberry32(SEED ^ 0x1e7e1));
// Who takes jobs and what they do for one (RFC 0030): `--no-jobs` draws none of it.
const working = draws(mulberry32(SEED ^ 0x10b5));
// Who takes up pottery, their glazes, and every finish's roll (RFC 0047): `--kiln` alone draws it.
const potting = draws(mulberry32(SEED ^ 0xc1a7));
/** Whether a resident bothers with the walk to the counter today (RFC 0042), its own stream. */
const walking = draws(mulberry32(SEED ^ 0xc0117e2));

// ---------- the rules ----------

/** What the population below does in the world. */
interface Rules {
  open(): void;
  newDay(day: number): void;
  join(id: string): void;
  /**
   * Settle a first plot and build a starter home, which sets a hearth. With `near`, the first free
   * plot it likes, else the next one. With `last`, the last free plot, so nobody else's moves.
   */
  settle(id: string, near?: (px: number, py: number) => boolean, last?: boolean): void;
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
function simRules(residents = RESIDENTS, heard: JobCounts = monthJobs): Rules {
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
    for (let px = 0; px < side; px++) if (!isCommons(state, px, py)) free.push([px, py]);
  }
  // Only the month's own world pays for jobs; the labs' small worlds keep RFC 0030's rules.
  const paysJobs = JOB_PAY > 0 && heard === monthJobs;
  const send = (actor: string, command: Command) => {
    const result = apply(state, { actor, command });
    if (result.ok && JOBS_ON) hearJobs(heard, state, result.events);
    if (result.ok && paysJobs) payForJobs(state, result.events);
    return result.ok;
  };
  const must = (actor: string, command: Command) => {
    const result = apply(state, { actor, command });
    if (!result.ok) throw new Error(`${actor} ${command.type}: ${result.rejection.message}`);
    if (JOBS_ON) hearJobs(heard, state, result.events);
    if (paysJobs) payForJobs(state, result.events);
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
        // Both adapters set `shopInPerson`, so every world but a `--no-shop-counter` run has it.
        if (SHOP_COUNTER) must(TOWN_ACTOR, { type: "shop_in_person" });
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
      if (JOBS_ON) {
        must(TOWN_ACTOR, { type: "open_jobs" });
        // Before anyone has seen the first board, so the whole month reads the edition.
        if (JOB_EDITION !== 1) must(TOWN_ACTOR, { type: "set_job_edition", edition: JOB_EDITION });
      }
      if (KILN_ON) must(TOWN_ACTOR, { type: "open_clay", water: true });
    },
    newDay: (d) => must(TOWN_ACTOR, { type: "new_day", day: DAY0 + d }),
    join: (id) => must(id, { type: "join", name: id, kind: "human" }),
    settle(id, near, last) {
      const liked = near ? free.findIndex(([px, py]) => near(px, py)) : -1;
      const plot = last ? free.pop() : liked >= 0 ? free.splice(liked, 1)[0] : free.shift();
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

/** What job pay came to in the month: paid, and skipped because the treasury held its reserve. */
const jobPay = { paid: 0, coins: 0, skipped: 0, to: new Map<string, number>() };

/**
 * Pays `--job-pay` for one finished job, from the treasury or minted. There's no such rule in the
 * sim, so this moves the coins with the sim's own ledger helpers, and the supply identity holds.
 */
function payJob(state: WorldState, id: string) {
  const econ = state.economy;
  if (!econ) return;
  const at = { seq: state.seq, day: state.day ?? DAY0 };
  const pay = JOB_PAY_MINTED
    ? JOB_PAY
    : jobPayFromTreasury(econ.treasury, JOB_PAY, N.budgetReserve);
  if (pay === 0) {
    jobPay.skipped++;
    return;
  }
  if (JOB_PAY_MINTED) econ.minted += pay;
  else moveTreasury(econ, -pay, "grant", at, id);
  movePurse(econ, id, pay, "grant", at);
  jobPay.paid++;
  jobPay.coins += pay;
  jobPay.to.set(id, (jobPay.to.get(id) ?? 0) + pay);
}

function payForJobs(state: WorldState, events: readonly WorldEvent[]) {
  for (const e of events) if (e.type === "job_done") payJob(state, e.residentId);
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
  /** Saves for a floor, gathers wood, and puts up stairs and a planked loft (RFC 0028). */
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
   * Takes the town's jobs (RFC 0030): `skills` when the board has one in a skill they play, `any`
   * for any job they could do.
   */
  jobs: "none" | "skills" | "any";
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
      // Nothing on the column south of the hearth: the hut's doorway is on it
      // (`starterHome` puts it at the hearth's x), and so is the way out of the plot. The sim
      // has the same rule for a planter inside the hut (`starterHutGardenTiles`, "never the tile
      // between the hearth and the doorway") and the garden link follows it. Without it these
      // residents wall themselves in, and almost none of them could walk to the counter once the
      // rule asked them to (RFC 0042). It is the same thing that has happened to two residents
      // of the live world, whose check-ins now say so.
      if (dx === 0 && dy > 0) continue;
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
  floors: 0,
  floorBurned: 0,
};

/** Coins each resident has spent at the shop, for what they had to spend in their first week. */
const spentBy = new Map<string, number>();
/**
 * What each settled resident had to spend by the end of their seventh day: purse plus shop
 * spending, and a floor's price if they added one. And what they spent at the shop alone.
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
  const station = (block: Station) => {
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

/** How the counter rule went: trips made, days nobody bothered, tiles walked. */
const trips = { made: 0, skipped: 0, nowhere: 0, tiles: [] as number[] };
/** Whether each resident could be bothered with the walk today, drawn once a day. */
let bothersToday = { day: -1, by: new Map<string, boolean>() };

/**
 * Do something at the shop's counter: walk there over the sim's own route, run `at`, and come
 * home (RFC 0042). False when they never went, either because they couldn't be bothered today
 * (`--shop-trips`) or because no walk reaches it.
 *
 * A round trip per visit rather than one trip a day, because the rest of a resident's day happens
 * within reach of their hearth: their planters, their kitchen, their workbench. Leaving them
 * standing at the counter would refuse everything that came after, which is a change to the day
 * and not to the shop. Walking costs no coins and no time in the sim, so a round trip each is
 * worth exactly what one trip is: the only thing the counter rule changes is whether the trade
 * happens at all.
 */
function atShop<T>(rules: Rules, id: string, at: () => T, nothing: T): T {
  if (!SHOP_COUNTER) return at();
  const { state } = rules;
  const me = state.residents[id];
  if (!me) return nothing;
  if (!notAtTheCounter(state, me)) return at();
  const day = state.day ?? 0;
  if (bothersToday.day !== day) bothersToday = { day, by: new Map() };
  let bothered = bothersToday.by.get(id);
  if (bothered === undefined) {
    bothered = walking.chance(SHOP_TRIPS);
    bothersToday.by.set(id, bothered);
  }
  if (!bothered) {
    trips.skipped++;
    return nothing;
  }
  const home = { x: me.x, y: me.y };
  const door = nearestCounter(state, me);
  let walked = 0;
  for (const dir of route(worldGround(state), me, door, state.config.reach, 128)) {
    if (!rules.send(id, { type: "move", dir })) break;
    walked++;
  }
  if (notAtTheCounter(state, state.residents[id] as never)) {
    trips.nowhere++;
    walkBack(rules, id, home);
    return nothing;
  }
  trips.made++;
  trips.tiles.push(walked);
  const out = at();
  walkBack(rules, id, home);
  return out;
}

/** Back to the tile they left, so the rest of their day is within reach of it as it always was. */
function walkBack(rules: Rules, id: string, to: { x: number; y: number }) {
  const { state } = rules;
  const me = state.residents[id];
  if (!me || (me.x === to.x && me.y === to.y)) return;
  // `home` is a jump to the hearth, which is where everything else in the day happens from.
  if (!rules.send(id, { type: "home" })) {
    for (const dir of route(worldGround(state), me, to, 0, 128)) {
      if (!rules.send(id, { type: "move", dir })) break;
    }
  }
}

/** Buy at the shop, counting what was spent. True when the sim took it. */
function buy(rules: Rules, id: string, sku: ShopSku, count = 1): boolean {
  return atShop(
    rules,
    id,
    () => {
      const before = coinsOf(rules.state, id);
      const ok = rules.send(id, { type: "shop_buy", sku, count });
      if (ok) spend(id, before - coinsOf(rules.state, id));
      return ok;
    },
    false,
  );
}

function sell(rules: Rules, id: string, item: string, count: number) {
  atShop(rules, id, () => sellAtCounter(rules, id, item, count), undefined);
}

function sellAtCounter(rules: Rules, id: string, item: string, count: number) {
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
  // Everyone keeps a little back, and a builder saving for a floor keeps that back too.
  const saving = habits.builds && !floorAdded.has(id) ? FLOORS.price : 0;
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
  const day = rules.state.day ?? 0;
  for (const holiday of holidaysOf(day)) if (!keepOne(rules, p, holiday, day)) return;
}

/** `keepHoliday` for one holiday running on `day`: false once the resident can't afford more today. */
function keepOne(rules: Rules, p: Person, holiday: Holiday, day: number): boolean {
  const { state } = rules;
  const stock = HOLIDAY_STOCK[holiday];
  const costumes = stock.filter((sku) => isShopWear(sku));
  const decor = stock.filter((sku) => isDecorKind(sku));
  if (costumes.length === 0 && decor.length === 0) return true;
  // A run is named by the year it starts in, since one can cross into the next year.
  const key = `${holiday}:${dateOfDay(holidayRun(holiday, day)?.first ?? day).year}`;
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
    if (before < priceOf(state, next) + 10 || !buy(rules, p.id, next)) return false;
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
  return true;
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

// ---------- floors (RFC 0028) ----------

/** The month's day each builder first held the price of a floor, added it, and finished it. */
const floorAfforded = new Map<string, number>();
const floorAdded = new Map<string, number>();
const stairsUp = new Map<string, number>();
const loftDone = new Map<string, number>();
/** The month's day each angler first held a rod, to compare with and without builders. */
const firstRod = new Map<string, number>();
/**
 * Wood builders gathered for building up, and the days they were home gathering it, and how much
 * each has put into stairs and flooring.
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
/** Wood a builder needs in all: stairs, and plank flooring over the hut. */
const loftWood = () => FLOORS.stairsWood + 25;

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
 * plank loft take, add the floor once they hold its price with 10 coins to spare (they skip other
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
  if (!floorAdded.has(id)) {
    const purse = coinsOf(state, id);
    if (purse >= FLOORS.price && !floorAfforded.has(id)) floorAfforded.set(id, day);
    if (purse < FLOORS.price + 10) return;
    const px = Math.floor(hearth.x / plotSize);
    const py = Math.floor(hearth.y / plotSize);
    const burned = state.economy?.burned ?? 0;
    if (!rules.send(id, { type: "add_floor", px, py })) return;
    floorAdded.set(id, day);
    tally.floors += purse - coinsOf(state, id);
    tally.floorBurned += (state.economy?.burned ?? 0) - burned;
  }
  const spend = (n: number) => woodUsed.set(id, used() + n);
  if (used() < FLOORS.stairsWood) {
    if (holds(state, id, "wood") < FLOORS.stairsWood) return;
    if (!rules.send(id, { type: "place", ...stairsTile(hearth), block: "stairs" })) return;
    spend(FLOORS.stairsWood);
    stairsUp.set(id, day);
  }
  for (const tile of loftTiles(hearth)) {
    if (used() >= loftWood() || holds(state, id, "wood") < 1) break;
    const laid = { type: "lay", ...tile, floor: 1, ground: "planks" } as const;
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

/** The pieces you rest on (RFC 0044), in the order a maker goes on to them. */
const COZY_RECIPES = ["armchair", "sofa", "bed"] as const;
/** What the cozy pieces cost residents: cards and cushions, and how many of each were made. */
const cozy = { cards: 0, cushions: 0, made: 0, makers: new Set<string>() };

/**
 * A maker who has made every wood-and-stone piece they know makes the next piece they rest on, once each:
 * its card from the shop if they don't know it, the cushions it takes, and then the craft, with
 * 10 coins kept back as for anything they buy, and a floor's price while they save for one. The
 * piece goes on their plot. False when they can't today.
 */
function goNest(rules: Rules, id: string, habits: Habits, wood: () => number): boolean {
  const { state } = rules;
  const made = firstsOf(state, id);
  const known = MAKER_RECIPES.filter((kind) => knows(state, id, kind));
  if (!known.every((kind) => made.includes(kind))) return false;
  const next = COZY_RECIPES.find((kind) => !made.includes(kind));
  if (!next || roomToday(state, id, "making") <= 0) return false;
  const needs = FURNITURE_RECIPES[next].needs;
  if ((needs.wood ?? 0) > wood()) return false;
  const saving = habits.builds && !floorAdded.has(id) ? FLOORS.price : 0;
  const spare = () => coinsOf(state, id) - 10 - saving;
  if (!knows(state, id, next)) {
    const price = recipeCardPrice(next);
    if (spare() < price) return false;
    const bought = atShop(
      rules,
      id,
      () => rules.send(id, { type: "shop_buy", sku: cardSku(next) }),
      false,
    );
    if (!bought) return false;
    spend(id, price);
    tally.cards += price;
    cozy.cards += price;
  }
  const short = (needs.cushion ?? 0) - holds(state, id, "cushion");
  if (short > 0) {
    const cost = short * SHOP_CATALOG.cushion.price;
    if (spare() < cost || !buy(rules, id, "cushion", short)) return false;
    cozy.cushions += cost;
  }
  const bench = workbench(rules, id);
  if (!bench || !rules.send(id, { type: "craft", recipe: next, ...bench })) return false;
  cozy.made++;
  cozy.makers.add(id);
  const tile = gardenTiles(state, id)[0];
  if (tile) rules.send(id, { type: "place", ...tile, block: next });
  return true;
}

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
  if (COZY_ON) goNest(rules, id, habits, wood);
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

// ---------- pottery (RFC 0047) ----------

/** Who takes up pottery, by kind: the people who'd come back tomorrow to open a kiln. */
const POTTERS: Record<Kind, number> = { regular: 0.35, visitor: 0.15, drifter: 0.05, oneday: 0 };
/** How far from home a potter looks for clay on a walk, in tiles. */
const CLAY_WALK = 12;
const potters = new Map<string, boolean>();
/** Whether a resident takes up pottery, drawn once from its own stream the first day they're home. */
function isPotter(p: Person): boolean {
  let is = potters.get(p.id);
  if (is === undefined) {
    is = potting.chance(POTTERS[p.kind]);
    potters.set(p.id, is);
  }
  return is;
}
/** What pottery did over the month: RFC 0047's checks. */
const pottery = {
  /** Potter-days at home, clay picked up within reach of the hearth on them, and walks for more. */
  days: 0,
  nearClay: 0,
  walks: 0,
  walkedTiles: [] as number[],
  walkClay: 0,
  /** Walks by potters whose hearth stands on forest or stone ground. */
  farWalks: [] as number[],
  kilns: 0,
  /** Tiles of pond potters dug by home, since clay lies beside water. */
  ponds: 0,
  /** Potter-days that began with a kiln and water within reach of home, the clay picked up near home on them, and the pots taken out. */
  engagedDays: 0,
  engagedClay: 0,
  engagedFired: 0,
  stoneWalks: 0,
  fired: { bowl: 0, vase: 0, teapot: 0 } as Record<string, number>,
  finishes: { plain: 0, speckled: 0, crackle: 0, iridescent: 0 } as Record<string, number>,
  glazed: 0,
  cards: 0,
  firstBowl: new Map<string, number>(),
  firstTeapot: new Map<string, number>(),
  making5: new Map<string, number>(),
};
const POTS = ["teapot", "vase", "bowl"] as const;

/** Each potter's own tile of pond, dug for the clay beside it. */
const potterPonds = new Map<string, { x: number; y: number }>();

/**
 * Where a potter digs their pond: the free tile on their plot with the most free tiles around it,
 * nearest the hearth among those, never on the column south of the hearth (the hut's doorway).
 */
function openPondTile(state: WorldState, hearth: { x: number; y: number }) {
  const { plotSize } = state.config;
  const px = Math.floor(hearth.x / plotSize);
  const py = Math.floor(hearth.y / plotSize);
  const onPlot = (x: number, y: number) =>
    Math.floor(x / plotSize) === px && Math.floor(y / plotSize) === py;
  const free = (x: number, y: number) =>
    onPlot(x, y) && state.blocks[tileKey(x, y)] === undefined && !(x === hearth.x && y >= hearth.y);
  let best: { x: number; y: number; open: number; d: number } | undefined;
  for (let y = py * plotSize; y < (py + 1) * plotSize; y++) {
    for (let x = px * plotSize; x < (px + 1) * plotSize; x++) {
      if (!free(x, y)) continue;
      let open = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) if ((dx || dy) && free(x + dx, y + dy)) open++;
      }
      const d = Math.max(Math.abs(x - hearth.x), Math.abs(y - hearth.y));
      if (!best || open > best.open || (open === best.open && d < best.d)) best = { x, y, open, d };
    }
  }
  return best && { x: best.x, y: best.y };
}

/** A walk to stand beside the potter's pond, the clay around it picked up, and home again. */
function clayByPond(
  rules: Rules,
  id: string,
  pond: { x: number; y: number },
  hearth: { x: number; y: number },
): number {
  const { state } = rules;
  const me = state.residents[id];
  if (!me) return 0;
  for (const dir of route(worldGround(state), me, pond, 1, 64)) {
    if (!rules.send(id, { type: "move", dir })) break;
  }
  const got = gatherClay(rules, id);
  walkBack(rules, id, hearth);
  return got;
}

/** Every `kind` lying within reach of where a resident stands that they may pick up, picked up. */
function gatherClay(rules: Rules, id: string, kind: "clay" | "stone" = "clay"): number {
  const { state } = rules;
  const me = state.residents[id];
  if (!me) return 0;
  const before = holds(state, id, kind);
  const { reach } = state.config;
  for (let y = me.y - reach; y <= me.y + reach; y++) {
    for (let x = me.x - reach; x <= me.x + reach; x++) {
      if (pickupLeft(state, x, y) === kind) rules.send(id, { type: "gather", x, y });
    }
  }
  return holds(state, id, kind) - before;
}

/** The nearest `kind` lying within `CLAY_WALK` of the hearth on ground the potter may gather. */
function nearestClay(
  state: WorldState,
  id: string,
  from: { x: number; y: number },
  kind: "clay" | "stone" = "clay",
) {
  for (let d = 1; d <= CLAY_WALK; d++) {
    for (let y = from.y - d; y <= from.y + d; y++) {
      for (let x = from.x - d; x <= from.x + d; x++) {
        if (Math.max(Math.abs(x - from.x), Math.abs(y - from.y)) !== d) continue;
        if (pickupLeft(state, x, y) !== kind) continue;
        const plot = plotAtTile(state, x, y);
        if (plot && plot.ownerId !== id && !(plot.coOwners ?? []).includes(id)) continue;
        return { x, y };
      }
    }
  }
  return undefined;
}

/**
 * A potter's day (RFC 0047): the clay within reach of their hearth, a walk for more when that
 * isn't a bowl's worth, a kiln placed from stone picked up near home, the pot that's ready taken
 * out at a roll from their own stream, and the best pot they know and hold the clay for loaded, in
 * a glaze half the time when they hold one's thing. They buy the vase's card once they've fired a
 * bowl, and the teapot's once they've fired a vase, keeping 10 coins back.
 */
function goPot(rules: Rules, id: string) {
  const { state } = rules;
  const me = state.residents[id];
  const hearth = me?.hearth;
  if (!me || !hearth) return;
  const day = today(state);
  pottery.days++;
  const { reach } = state.config;
  const near = (x: number, y: number) =>
    Math.max(Math.abs(x - hearth.x), Math.abs(y - hearth.y)) <= reach;
  let kiln: { x: number; y: number } | undefined;
  for (const [key, b] of Object.entries(state.blocks)) {
    const [x = 0, y = 0] = key.split(",").map(Number);
    if (b === "kiln" && near(x, y)) kiln = { x, y };
  }
  // A day that starts with a kiln and the potter's own pond is an engaged potter's day.
  const dug = potterPonds.get(id);
  const engaged = kiln !== undefined && dug !== undefined && isWater(state, dug.x, dug.y);
  const nearClay = gatherClay(rules, id) + (dug ? clayByPond(rules, id, dug, hearth) : 0);
  pottery.nearClay += nearClay;
  if (engaged) {
    pottery.engagedDays++;
    pottery.engagedClay += nearClay;
  }
  // Clay lies beside water, so a potter digs a tile of pond on open ground on their plot, where
  // the most tiles around it are free. A pond's stone and a kiln's come the same way, picked up
  // near home or on one walk a day to the nearest loose stone.
  const dry = dug === undefined;
  const stoneWanted = (kiln ? 0 : POTTERY.kilnStone) + (dry ? POND.stone : 0);
  if (stoneWanted > 0) {
    for (let y = hearth.y - reach; y <= hearth.y + reach; y++) {
      for (let x = hearth.x - reach; x <= hearth.x + reach; x++) {
        if (holds(state, id, "stone") >= stoneWanted) break;
        if (pickupLeft(state, x, y) === "stone") rules.send(id, { type: "gather", x, y });
      }
    }
    const stoneAt =
      holds(state, id, "stone") < stoneWanted ? nearestClay(state, id, hearth, "stone") : undefined;
    if (stoneAt) {
      for (const dir of route(worldGround(state), me, stoneAt, reach, 64)) {
        if (!rules.send(id, { type: "move", dir })) break;
      }
      gatherClay(rules, id, "stone");
      gatherClay(rules, id);
      walkBack(rules, id, hearth);
      pottery.stoneWalks++;
    }
  }
  if (!kiln) {
    const tile = gardenTiles(state, id)[0];
    if (!tile || holds(state, id, "stone") < POTTERY.kilnStone) return;
    if (!rules.send(id, { type: "place", ...tile, block: "kiln" })) return;
    pottery.kilns++;
    kiln = tile;
  }
  const pond = dry ? openPondTile(state, hearth) : undefined;
  if (
    pond &&
    holds(state, id, "stone") >= POND.stone &&
    rules.send(id, { type: "place", ...pond, block: "pond" })
  ) {
    potterPonds.set(id, pond);
    pottery.ponds++;
    pottery.nearClay += clayByPond(rules, id, pond, hearth);
  }
  const firing = state.items?.firings?.[tileKey(kiln.x, kiln.y)];
  if (firing && firing.readyDay <= (state.day ?? 0)) {
    const kind = firing.good.kind;
    const before = state.items?.inventories[id]?.goods.length ?? 0;
    rules.send(id, { type: "harvest", ...kiln, roll: potting.between(0, POTTERY.outOf - 1) });
    const pot = state.items?.inventories[id]?.goods.at(-1);
    if ((state.items?.inventories[id]?.goods.length ?? 0) > before && pot?.finish) {
      pottery.fired[kind] = (pottery.fired[kind] ?? 0) + 1;
      if (engaged) pottery.engagedFired++;
      pottery.finishes[pot.finish] = (pottery.finishes[pot.finish] ?? 0) + 1;
      if (kind === "bowl" && !pottery.firstBowl.has(id)) pottery.firstBowl.set(id, day);
    }
  }
  if (state.items?.firings?.[tileKey(kiln.x, kiln.y)]) return;
  // The next card, once the pot before it has come out of the kiln.
  const fired = (kind: string) => firstsOf(state, id).includes(kind as never);
  const next = !knows(state, id, "vase")
    ? fired("bowl") && "vase"
    : !knows(state, id, "teapot") && fired("vase") && "teapot";
  if (next && coinsOf(state, id) - 10 >= recipeCardPrice(next)) {
    const bought = atShop(
      rules,
      id,
      () => rules.send(id, { type: "shop_buy", sku: cardSku(next) }),
      false,
    );
    if (bought) {
      spend(id, recipeCardPrice(next));
      tally.cards += recipeCardPrice(next);
      pottery.cards += recipeCardPrice(next);
    }
  }
  if (holds(state, id, "clay") < 2) {
    const at = nearestClay(state, id, hearth);
    if (at) {
      let walked = 0;
      for (const dir of route(worldGround(state), me, at, reach, 64)) {
        if (!rules.send(id, { type: "move", dir })) break;
        walked++;
      }
      const got = gatherClay(rules, id);
      walkBack(rules, id, hearth);
      pottery.walks++;
      pottery.walkedTiles.push(walked);
      pottery.walkClay += got;
      const ground = biomeAt(state.config, hearth.x, hearth.y);
      if (ground === "forest" || ground === "stone") pottery.farWalks.push(walked);
    }
  }
  const pot = POTS.find(
    (kind) =>
      knows(state, id, kind) &&
      Object.entries(RECIPES[kind].needs).every(
        ([k, n]) => holds(state, id, k as StackKind) >= (n ?? 0),
      ),
  );
  if (!pot) return;
  const glazes = (Object.entries(GLAZE_COSTS) as [string, StackKind | null][]).filter(
    ([, cost]) => cost !== null && holds(state, id, cost) > 0,
  );
  const glaze = glazes.length > 0 && potting.chance(0.5) ? potting.pick(glazes)?.[0] : undefined;
  const loaded = rules.send(id, {
    type: "craft",
    recipe: pot,
    ...kiln,
    ...(glaze ? { glaze: glaze as never } : {}),
  });
  if (loaded && glaze) pottery.glazed++;
  if (loaded && pot === "teapot" && !pottery.firstTeapot.has(id)) pottery.firstTeapot.set(id, day);
  if (!pottery.making5.has(id) && levelOf(pointsOf(state, id).making ?? 0) >= 5) {
    pottery.making5.set(id, day - (pottery.firstBowl.get(id) ?? day));
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
 * rated. Without `rng` nobody ever chooses, and the game ends once every seat is away. The number
 * of seats the sim rated when it was played, or null when it wasn't.
 */
function playGame(
  rules: Rules,
  seats: readonly string[],
  rng?: ReturnType<typeof draws>,
): number | null {
  const { state } = rules;
  const [first = "", ...rest] = seats;
  const salt = rng
    ? Array.from({ length: 32 }, () => HEX[rng.between(0, 15)]).join("")
    : HEX.repeat(2);
  const at = () => {
    gameClock += 1_000;
    return gameClock;
  };
  if (
    !rules.send(first, { type: "open_table", game: "hearth_race", pace: "slow", salt, at: at() })
  ) {
    return null;
  }
  const table = Object.keys(state.games?.tables ?? {})
    .sort((a, b) => Number(a.slice(2)) - Number(b.slice(2)))
    .at(-1);
  if (!table) return null;
  for (const seat of rest) rules.send(seat, { type: "sit", table, at: at() });
  if (!rules.send(first, { type: "start_game", table, at: at() })) {
    rules.send(first, { type: "stand", table });
    return null;
  }
  const rated = activeTable(state, table)?.seats.filter((seat) => seat.rated).length ?? 0;
  for (let rounds = 0; rounds < 40; rounds++) {
    const t = activeTable(state, table);
    if (t?.status !== "playing") break;
    for (const seat of rng ? t.seats : []) {
      const move = rng?.between(1, 3) ?? 1;
      rules.send(seat.resident, { type: "decide", table, round: t.round, move });
    }
    rules.send(TOWN_ACTOR, { type: "close_round", table, round: t.round, at: at() });
  }
  return rated;
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
      // And so does a neighbor who holds a guest's job (RFC 0030), after the same draw.
      const guests = neighbors.filter(
        (n) => keen.includes(n) || climbing.chance(COMES) || holding(state, n, "guest"),
      );
      const counted = holdEvent(rules, id, guests, 18, age);
      if (counted) {
        gatherings.events++;
        gatherings.guests += guests.length;
        gatherings.counted += counted.length;
      }
    }
    if (age(id) % 7 === 5) {
      // And takes any bounty going.
      const anyone = keen[0] ?? climbing.pick(neighbors);
      // A neighbor who holds a bounty job (RFC 0030) is the one who asks for it.
      const claimant = neighbors.find((n) => holding(state, n, "bounty")) ?? anyone;
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
      if (playGame(rules, seats, climbing) !== null) gatherings.games++;
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
 * each other two bounties a day, go to two of their own events a day, and sit down to two rated
 * tables a day each where nobody ever chooses.
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
  const idle = { games: 0, rated: 0 };
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
    // And each sits down with the next one round at a table where neither ever chooses: ten
    // games a day, two seats each, which the sim rates once they've been here three days.
    ring.forEach((a, i) => {
      const rated = playGame(rules, [a, ring[(i + shift) % 10] ?? ""]);
      if (rated === null) return;
      idle.games++;
      idle.rated += rated;
    });
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
      playing: ring.reduce((sum, id) => sum + each(id, "playing"), 0),
      idle,
      ...ringLevel,
    },
  };
}

// ---------- circles (RFC 0033) ----------

/**
 * How a circle lab's members behave: `none` is the same people with no circles, meeting weekly
 * at an ordinary event on the founder's plot; `night` meets at circle night instead and reacts as
 * before; `circle` also reacts to mates' posts before anyone else's, as many reactions as before;
 * `ring` also has every member react to every mate's post every day, the most a group of friends
 * could farm appreciation coins, in a circle or not.
 */
type CircleRun = "none" | "night" | "circle" | "ring";

/** The neighbors in a circle lab who aren't members. Two come to each night. */
const CIRCLE_NEIGHBORS = 12;

/**
 * What RFC 0033's economy check needs, in a small world of its own beside the month, so it changes
 * nothing there: a circle of `size` (a person, two AIs of hers, and the rest from households of
 * their own) and `CIRCLE_NEIGHBORS` neighbors, everyone home every day, posting and reacting from
 * one stream seeded the same for every run, and the members meeting once a week from day 3, when
 * they can first host. Each member's Hosting points, karma, appreciation coins, and month-end purse.
 */
function circleLab(size: number, run: CircleRun) {
  const rules = simRules(size + CIRCLE_NEIGHBORS, jobCounts());
  const { state } = rules;
  const talk = draws(mulberry32(SEED ^ 0x41d));
  rules.open();
  if (run !== "none") rules.send(TOWN_ACTOR, { type: "open_circles" });
  const members = Array.from({ length: size }, (_, i) => `k_m${String(i).padStart(2, "0")}`);
  const neighbors = Array.from({ length: CIRCLE_NEIGHBORS }, (_, i) => `k_n${i}`);
  const everyone = [...members, ...neighbors];
  for (const id of everyone) rules.join(id);
  const founder = members[0] ?? "";
  const ais = members.slice(1, 3);
  rules.setOwnerPairs(ais.map((ai) => [ai, founder].sort() as [string, string]));
  const pairKeys = new Set(ais.map((ai) => [ai, founder].sort().join(" ")));
  const paired = (a: string, b: string) => pairKeys.has([a, b].sort().join(" "));
  for (const id of everyone) rules.settle(id);
  const byId = new Map(everyone.map((id) => [id, { id, arrives: 0 } as Person]));
  const settled = new Set(everyone);
  const facts: KarmaFacts = {
    reactions: [],
    praise: [],
    gifts: [],
    heartedReplies: [],
    votes: [],
    upheld: [],
    hosted: [],
    attended: [],
  };
  const appreciation = new Map<string, number>();
  const isMember = new Set(members);
  const hearth = state.residents[founder]?.hearth ?? { x: 0, y: 0 };
  const hall = plotOf(state.config, hearth.x, hearth.y);
  for (let day = 0; day < DAYS; day++) {
    if (day > 0) {
      rules.newDay(day);
      const awards = appreciationFor(day - 1, facts, byId, settled, paired);
      if (awards.length > 0) rules.award(day - 1, awards);
      for (const a of awards) appreciation.set(a.to, (appreciation.get(a.to) ?? 0) + a.amount);
    }
    for (const id of everyone) rules.home(id);
    if (day === 3 && run !== "none") {
      const must = (actor: string, command: Command) => {
        const result = apply(state, { actor, command });
        if (!result.ok)
          throw new Error(`The circle lab's ${command.type}: ${result.rejection.message}`);
      };
      must(founder, { type: "found_circle", name: "Lantern Row" });
      for (const id of members.slice(1)) {
        must(founder, { type: "invite_to_circle", resident: id });
        must(id, { type: "join_circle", circle: "c_1" });
      }
      must(founder, { type: "set_circle_hall", ...hall });
    }
    if (day >= 3 && day % 7 === 3) {
      const week = Math.floor(day / 7);
      const guests = [
        ...members.slice(1),
        ...neighbors.slice((2 * week) % CIRCLE_NEIGHBORS, ((2 * week) % CIRCLE_NEIGHBORS) + 2),
      ];
      const booked = apply(state, {
        actor: founder,
        command: {
          type: "schedule_event",
          kind: "gathering",
          title: "At the Row",
          ...hall,
          startsAt: (state.day ?? 0) * 24 * HOUR_MS + 19 * HOUR_MS,
          minutes: 30,
          ...(run === "none" ? {} : { circle: "c_1" }),
        },
      });
      const event = state.events?.list.at(-1);
      if (!booked.ok || !event) {
        throw new Error(`The circle lab's night on day ${day}: ${JSON.stringify(booked)}`);
      }
      rules.send(TOWN_ACTOR, { type: "event_start", event: event.id });
      for (const guest of guests) {
        const tile = joinTile(state, guest, event);
        rules.send(guest, { type: "join_event", event: event.id, ...(tile ?? {}) });
      }
      rules.send(TOWN_ACTOR, { type: "event_tick", event: event.id, slot: 1 });
      rules.send(TOWN_ACTOR, { type: "event_tick", event: event.id, slot: 2 });
      rules.send(TOWN_ACTOR, { type: "event_end", event: event.id });
      // The guests the server would count: as for any event, and never the circle's own.
      const ended = findEvent(state, event.id);
      const counted = (ended?.attended ?? []).filter(
        (id) => !sameHousehold(state, founder, id) && !(ended?.kin ?? []).includes(id),
      );
      rules.send(TOWN_ACTOR, { type: "credit_event", event: event.id, guests: counted });
      facts.hosted?.push({ host: founder, event: event.id, day, guests: counted });
      for (const id of counted) facts.attended?.push({ from: id, host: founder, day });
      for (const guest of guests) rules.home(guest);
    }
    const posters = everyone.filter(() => talk.chance(POSTS.regular));
    for (const id of everyone) {
      const others = posters.filter((p) => p !== id);
      const first = (run === "circle" || run === "ring") && isMember.has(id);
      const mates = first ? others.filter((p) => isMember.has(p)) : [];
      const rest = others.filter((p) => !mates.includes(p));
      const reacts = Math.min(others.length, talk.between(0, REACTS_UP_TO));
      for (let i = 0; i < reacts; i++) {
        const from = mates.length > 0 ? mates : rest;
        const [to] = from.splice(talk.between(0, from.length - 1), 1);
        if (to) facts.reactions.push({ from: id, to, day });
      }
      if (run === "ring" && isMember.has(id)) {
        for (const to of posters) {
          if (to !== id && isMember.has(to)) facts.reactions.push({ from: id, to, day });
        }
      }
    }
  }
  const scores = scoreKarma(facts, { counts: () => true, paired });
  const each = (f: (id: string) => number) => members.map(f).sort((a, b) => a - b);
  return {
    hosting: each((id) => pointsOf(state, id).hosting ?? 0),
    karma: each((id) => scores.get(id)?.score ?? 0),
    appreciation: each((id) => appreciation.get(id) ?? 0),
    purse: each((id) => coinsOf(state, id)),
    gathered: circleById(state, "c_1")?.gathered?.length ?? 0,
  };
}

/**
 * RFC 0033's economy check: a circle of 6 meeting weekly earns no more Hosting points or karma a
 * member than the same people meeting at an ordinary event, and what a circle of 12 does to its
 * members' coins through appreciation, when they react to mates first and when every member reacts
 * to every mate every day. RFC 0033 says to exclude circle-mates from appreciation, as households
 * are, if a circle of 12 moves the median member's coins by more than 10%.
 */
function circleLines() {
  const mean = (list: number[]) => list.reduce((sum, n) => sum + n, 0) / Math.max(1, list.length);
  const median = (list: number[]) => percentile(list, 0.5);
  const change = (now: number, was: number) =>
    `${now >= was ? "+" : ""}${((100 * (now - was)) / Math.max(1, was)).toFixed(1)}%`;
  const holds = (ok: boolean) => (ok ? "holds" : "fails");
  console.log("");
  console.log(
    `Circles (RFC 0033), in a small world of their own with ${CIRCLE_NEIGHBORS} neighbors who aren't members, meeting weekly from day 3 for ${DAYS} days:`,
  );
  const six = { none: circleLab(6, "none"), night: circleLab(6, "night") };
  const hosting = [mean(six.night.hosting), mean(six.none.hosting)];
  const karma = [mean(six.night.karma), mean(six.none.karma)];
  console.log(
    `  1. A circle of 6 (a person and two AIs of hers, and three others) gathered ${six.night.gathered} weeks. Hosting points a member: ${hosting[0]?.toFixed(1)} at circle night against ${hosting[1]?.toFixed(1)} at an ordinary weekly event among the same people (${holds((hosting[0] ?? 0) <= (hosting[1] ?? 0))}: no rise). Karma a member, reacting as before: ${karma[0]?.toFixed(1)} against ${karma[1]?.toFixed(1)} (${holds((karma[0] ?? 0) <= (karma[1] ?? 0))}: no rise).`,
  );
  const twelve = {
    none: circleLab(12, "none"),
    circle: circleLab(12, "circle"),
    ring: circleLab(12, "ring"),
  };
  const was = median(twelve.none.purse);
  const first = median(twelve.circle.purse);
  const ring = median(twelve.ring.purse);
  console.log(
    `  2. A circle of 12: appreciation coins a member over the month, mean ${mean(twelve.none.appreciation).toFixed(1)} with no circles, ${mean(twelve.circle.appreciation).toFixed(1)} reacting to mates first, and ${mean(twelve.ring.appreciation).toFixed(1)} with every member reacting to every mate every day. The median member's month-end purse: ${was}, then ${first} (${change(first, was)}, ${holds(Math.abs(first - was) <= was / 10)}: within 10%), and ${ring} (${change(ring, was)}, ${holds(Math.abs(ring - was) <= was / 10)}: within 10%).`,
  );
}

// ---------- jobs (RFC 0030) ----------

/**
 * Who takes jobs, by how often they come back. Guesses, not measurements: about half the regulars
 * take a job when the board has one in a skill they already play, fewer of those who come by
 * less, and a few take any job they could do, in a skill they play or not. Everyone playing one
 * skill in earnest takes that skill's jobs. The sim's bounds cap them whatever they are.
 */
const JOB_TAKERS: Record<Kind, number> = { regular: 0.5, visitor: 0.3, drifter: 0.15, oneday: 0 };
const JOB_ANY: Record<Kind, number> = { regular: 0.1, visitor: 0.05, drifter: 0, oneday: 0 };
/** Days a resident keeps a job they haven't finished before swapping it for one on today's board. */
const JOB_PATIENCE = 2;

/** What happened to jobs in one world, heard from the events of every input the sim took. */
interface JobCounts {
  taken: Map<string, number>;
  done: Map<string, number>;
  dropped: Map<string, number>;
  lapsed: Map<string, number>;
  /** Jobs each resident finished on each world day, and in each UTC week, by `id:day`. */
  byDay: Map<string, number>;
  byWeek: Map<string, number>;
  /** The world days each resident finished a job on. */
  days: Map<string, number[]>;
}
const jobCounts = (): JobCounts => ({
  taken: new Map(),
  done: new Map(),
  dropped: new Map(),
  lapsed: new Map(),
  byDay: new Map(),
  byWeek: new Map(),
  days: new Map(),
});
/** The month's own counts. `jobsLab` keeps its own. */
const monthJobs = jobCounts();
const bump = (map: Map<string, number>, key: string) => map.set(key, (map.get(key) ?? 0) + 1);

function hearJobs(counts: JobCounts, state: WorldState, events: readonly WorldEvent[]) {
  const day = state.day ?? 0;
  for (const e of events) {
    if (e.type === "job_taken") bump(counts.taken, e.job);
    else if (e.type === "job_dropped") bump(e.lapsed ? counts.lapsed : counts.dropped, e.job);
    else if (e.type === "job_done") {
      bump(counts.done, e.job);
      bump(counts.byDay, `${e.residentId}:${day}`);
      bump(counts.byWeek, `${e.residentId}:${weekStart(day)}`);
      counts.days.set(e.residentId, [...(counts.days.get(e.residentId) ?? []), day]);
    }
  }
}

/** The skills a resident's habits have them play. */
const PLAYS: Record<Skill, (h: Habits) => boolean> = {
  growing: (h) => h.gardens,
  making: (h) => h.makes || h.gardens,
  foraging: (h) => h.casts > 0 || h.forages,
  hosting: (h) => h.hosts,
  playing: (h) => h.plays > 0,
};

/** Everyone's habits by id, filled as the month's residents are drawn. */
const habitsOf = new Map<string, Habits>();
const byHabit = (id: string) => habitsOf.get(id);

/** The job a resident holds, if any. */
function heldJob(state: WorldState, id: string): Job | undefined {
  const held = state.jobs?.held?.[id];
  return held ? jobById(held.job) : undefined;
}
const holding = (state: WorldState, id: string, deed: JobDeed["type"]) =>
  heldJob(state, id)?.deed?.type === deed;

/** Whether the sim would let a resident take a job now: none finished today, under three this week. */
function mayTake(state: WorldState, id: string): boolean {
  const jobs = state.jobs;
  if (!jobs || jobs.doneToday?.includes(id)) return false;
  const week = jobs.week;
  const done = week && week.start === weekStart(state.day ?? 0) ? (week.done[id] ?? 0) : 0;
  return done < JOBS.perWeek;
}

/** What a recipe's things are made of and where, for the first kind of it a resident could make now. */
function makeable(state: WorldState, id: string, recipe: RecipeName) {
  const kinds = (Object.keys(CATALOG) as (keyof typeof CATALOG)[]).filter((kind) => {
    const entry = CATALOG[kind] as { recipe?: unknown };
    return entry.recipe !== undefined && recipeOf(kind as GoodKind) === recipe;
  });
  const needsOf = (kind: string) =>
    (CATALOG[kind as keyof typeof CATALOG] as { recipe: { station: Station; needs: object } })
      .recipe;
  const short = (kind: string) =>
    (Object.entries(needsOf(kind).needs) as [StackKind, number][]).filter(
      ([k, n]) => holds(state, id, k) < n,
    );
  const kind = kinds.find((k) => short(k).length === 0) ?? kinds[0];
  return kind === undefined ? undefined : { kind, ...needsOf(kind), short: short(kind) };
}

/** Whether any tile within reach of a hearth is `wanted`. */
function nearHearth(state: WorldState, id: string, wanted: (x: number, y: number) => boolean) {
  const hearth = state.residents[id]?.hearth;
  if (!hearth) return false;
  const { reach } = state.config;
  for (let y = hearth.y - reach; y <= hearth.y + reach; y++) {
    for (let x = hearth.x - reach; x <= hearth.x + reach; x++) if (wanted(x, y)) return true;
  }
  return false;
}

/** Residents with a hearth within two plots of `id`'s, outside their household, around or not. */
function nearbyHomes(state: WorldState, id: string): string[] {
  return neighborsOf(
    state,
    id,
    Object.values(state.residents)
      .filter((r) => r.hearth)
      .map((r) => r.id),
  );
}

/**
 * Whether a resident has what a recipe's thing is made of: everything in hand, or the wood and
 * stone it lacks lying within reach today.
 */
function hasTheMakings(state: WorldState, id: string, recipe: RecipeName): boolean {
  const made = makeable(state, id, recipe);
  if (!made) return false;
  const lying = new Map<string, number>();
  nearHearth(state, id, (x, y) => {
    const kind = pickupLeft(state, x, y);
    if (kind === "wood" || kind === "stone") lying.set(kind, (lying.get(kind) ?? 0) + 1);
    return false;
  });
  return made.short.every(
    ([kind, n]) =>
      (kind === "wood" || kind === "stone") && holds(state, id, kind) + (lying.get(kind) ?? 0) >= n,
  );
}

/** How many of a resident's planters hold one of `crops`, at any age. */
function planted(
  state: WorldState,
  id: string,
  crops: readonly Crop[],
  planters: Map<string, Set<string>>,
): number {
  return [...(planters.get(id) ?? [])].filter((key) => {
    const crop = state.items?.crops[key]?.crop;
    return crop !== undefined && crops.includes(crop);
  }).length;
}

/** Whether a find a job would count lies within reach of a resident's hearth today. */
function findLies(state: WorldState, id: string, d: Extract<JobDeed, { type: "find" }>): boolean {
  return nearHearth(state, id, (x, y) => {
    const kind = pickupLeft(state, x, y);
    if (!isFindKind(kind) && kind !== RECIPE_PAGE) return false;
    if (d.biome !== undefined && biomeAt(state.config, x, y) !== d.biome) return false;
    return d.kinds === undefined || (d.kinds as readonly string[]).includes(kind);
  });
}

/**
 * Whether a resident could do a job from where they live, with what they have and know. A harvest
 * takes a garden, and a named crop enough of it in their planters already (someone who takes any
 * job buys its seed when they can afford it). Something made takes its recipe and its makings. A find takes one
 * lying within reach today, a fish a rod, a lesson a neighbor who lacks something they know, a
 * guest's or a bounty's job a neighbor who hosts, a host's job the habit and neighbors to come,
 * and a game the habit, or the will to take any job.
 */
function ableTo(
  state: WorldState,
  p: Person,
  job: Job,
  planters: Map<string, Set<string>>,
): boolean {
  const h = p.habits;
  const { id } = p;
  const day = state.day ?? 0;
  const mine = state.items?.inventories[id];
  if (job.bring !== undefined) {
    const { bring } = job;
    const kept = mine?.goods.some((g) => g.maker === id && recipeOf(g.kind as GoodKind) === bring);
    return knows(state, id, bring) && (kept === true || hasTheMakings(state, id, bring));
  }
  const d = job.deed;
  switch (d.type) {
    case "harvest": {
      if (!h.gardens) return false;
      if (d.crops === undefined || planted(state, id, d.crops, planters) >= d.count) return true;
      return (
        h.jobs === "any" &&
        SHOP_OPEN &&
        d.crops.some((c) => {
          const seed = CROP_INFO[c].seed;
          return onSale(seed, day) && coinsOf(state, id) >= SHOP_CATALOG[seed].price * d.count + 10;
        })
      );
    }
    case "craft":
      return knows(state, id, d.recipe) && hasTheMakings(state, id, d.recipe);
    case "find":
      return findLies(state, id, d);
    case "fish":
      return h.casts > 0 && holdsRod(mine);
    case "teach":
      return nearbyHomes(state, id).some((n) => teachable(state, id, n).length > 0);
    case "guest":
    case "bounty":
      return nearbyHomes(state, id).some((n) => byHabit(n)?.hosts === true);
    case "host":
      return h.hosts && nearbyHomes(state, id).length >= d.guests;
    case "game":
      return h.plays > 0 || h.jobs === "any";
  }
}

/** Whether a resident would take a job: any they could do, or only ones in a skill they play. */
const wouldTake = (p: Person, job: Job) =>
  p.habits.jobs === "any" ||
  (p.habits.focus ? job.skill === p.habits.focus : PLAYS[job.skill](p.habits));

/**
 * A job taker's first thing at home: take the first of today's jobs they'd take and could do. One
 * they've held `JOB_PATIENCE` days without finishing is let go when today has another for them,
 * unless it's a harvest, which waits for what's growing.
 */
function takeJob(rules: Rules, p: Person, planters: Map<string, Set<string>>) {
  const { state } = rules;
  if (p.habits.jobs === "none" || !state.jobs || !mayTake(state, p.id)) return;
  const held = state.jobs.held?.[p.id];
  if (held) {
    const stale = (state.day ?? 0) - held.day >= JOB_PATIENCE;
    if (!stale || jobById(held.job)?.deed?.type === "harvest") return;
  }
  const next = jobsOn(state).find(
    (job) => job.id !== held?.job && wouldTake(p, job) && ableTo(state, p, job, planters),
  );
  if (!next) return;
  if (held) rules.send(p.id, { type: "drop_job" });
  rules.send(p.id, { type: "take_job", job: next.id });
}

/** A resident's own kitchen or workbench within reach of their hearth, placed now if they have none. */
function stationFor(rules: Rules, id: string, block: Station) {
  const { state } = rules;
  const hearth = state.residents[id]?.hearth;
  if (!hearth) return undefined;
  for (const [key, b] of Object.entries(state.blocks)) {
    const [x = 0, y = 0] = key.split(",").map(Number);
    const near = Math.max(Math.abs(x - hearth.x), Math.abs(y - hearth.y)) <= state.config.reach;
    if (b === block && near) return { x, y };
  }
  const tile = gardenTiles(state, id)[0];
  return tile && rules.send(id, { type: "place", ...tile, block }) ? tile : undefined;
}

/** Make one of a recipe's things for a job, picking up the wood and stone it takes near home. */
function makeForJob(rules: Rules, id: string, recipe: RecipeName): boolean {
  const { state } = rules;
  const hearth = state.residents[id]?.hearth;
  if (!hearth) return false;
  let made = makeable(state, id, recipe);
  if (made?.short.some(([k]) => k === "wood" || k === "stone")) {
    const { reach } = state.config;
    for (let y = hearth.y - reach; y <= hearth.y + reach; y++) {
      for (let x = hearth.x - reach; x <= hearth.x + reach; x++) {
        const lying = pickupLeft(state, x, y);
        if (made.short.some(([k]) => k === lying)) rules.send(id, { type: "gather", x, y });
      }
    }
    made = makeable(state, id, recipe);
  }
  if (!made || made.short.length > 0) return false;
  const at = stationFor(rules, id, made.station);
  return at !== undefined && rules.send(id, { type: "craft", recipe: made.kind, ...at } as Command);
}

/**
 * What a job taker does for the job they hold. First thing at home (`early`), before the garden's
 * crops and jars go into what the town buys: make its thing, and hand it in when that's what it
 * asks. Then, after their day's own habits, which may have moved it already: the same again with
 * what the day brought in; the crop it asks for planted, its seed bought, by someone who takes any
 * job; the finds within reach picked up; or more casts for the fish. Jobs with a neighbor are the
 * day's later rounds (`jobsDay`).
 */
function workJob(rules: Rules, p: Person, planters: Map<string, Set<string>>, early = false) {
  const { state } = rules;
  const { id } = p;
  const job = heldJob(state, id);
  const hearth = state.residents[id]?.hearth;
  const day = state.day ?? 0;
  if (!job || !hearth) return;
  if (job.bring !== undefined) {
    // One they made earlier and kept will do. Otherwise one more.
    if (!rules.send(id, { type: "hand_in" }) && makeForJob(rules, id, job.bring)) {
      rules.send(id, { type: "hand_in" });
    }
    return;
  }
  const d = job.deed;
  if (d.type === "craft") makeForJob(rules, id, d.recipe);
  if (early) return;
  if (d.type === "find") goForage(rules, id);
  if (d.type === "harvest" && d.crops && planted(state, id, d.crops, planters) < d.count) {
    const [crop] = d.crops;
    if (!crop) return;
    const seed = CROP_INFO[crop].seed;
    if (!SHOP_OPEN || !onSale(seed, day)) return;
    if (coinsOf(state, id) < SHOP_CATALOG[seed].price * d.count + 10) return;
    if (!buy(rules, id, seed, d.count)) return;
    const mine = planters.get(id) ?? new Set<string>();
    planters.set(id, mine);
    for (let i = 0; i < d.count; i++) {
      const tile = gardenTiles(state, id)[0];
      if (!tile || !rules.send(id, { type: "place", ...tile, block: "planter" })) break;
      mine.add(tileKey(tile.x, tile.y));
      rules.send(id, { type: "plant", ...tile, seed: crop });
    }
  }
  if (d.type === "fish") {
    for (let i = castsToday(state, id); i < FISHING.castsPerDay && heldJob(state, id); i++) {
      if (inventorySize(state.items?.inventories[id]) > ITEMS.inventoryMax - 50) break;
      const roll = working.between(0, FISHING.outOf - 1);
      const weather = weatherAt(day, working.between(0, 23));
      const timeOfDay = working.pick(TIMES_OF_DAY) ?? "day";
      if (rules.send(id, { type: "fish", roll, weather, timeOfDay })) tally.casts++;
    }
  }
}

/**
 * The day's jobs with a neighbor, once everyone around has been home and the day's events, bounties,
 * and games are done. Whoever holds Otis's lesson job teaches a neighbor who lacks something they
 * know. Whoever holds his host job holds an event today, and neighbors who hold a guest's job come,
 * with the rest coming now and then. And whoever holds one of Pip's jobs and hasn't a habit of
 * playing sits down with another like them, or with a player who's around.
 */
function jobsDay(rules: Rules, active: readonly string[], byId: Map<string, Person>) {
  const { state } = rules;
  const day = today(state);
  const age = (id: string) => day - (byId.get(id)?.arrives ?? day);
  const housed = active.filter((id) => state.residents[id]?.hearth);
  for (const id of housed) {
    if (!holding(state, id, "teach") || teachingToday(state, id) > 0) continue;
    const learner = neighborsOf(state, id, housed).find(
      (n) => taughtToday(state, n) === 0 && teachable(state, id, n).length > 0,
    );
    const recipe = learner && teachable(state, id, learner)[0];
    if (learner && recipe && meet(rules, id, learner)) {
      rules.send(id, { type: "teach", recipe, to: learner });
    }
    rules.home(id);
  }
  for (const id of housed) {
    if (!holding(state, id, "host") || age(id) < GUEST_MIN_AGE_DAYS) continue;
    const guests = neighborsOf(state, id, housed).filter(
      (n) => working.chance(COMES) || holding(state, n, "guest"),
    );
    holdEvent(rules, id, guests, 20, age);
  }
  const sitters = housed.filter(
    (id) => holding(state, id, "game") && (byId.get(id)?.habits.plays ?? 0) === 0,
  );
  const players = housed.filter((id) => (byId.get(id)?.habits.plays ?? 0) > 0);
  while (sitters.length > 0) {
    const seat = sitters.shift() as string;
    const other = sitters.shift() ?? working.pick(players.filter((id) => id !== seat));
    if (other) playGame(rules, [seat, other], working);
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

/**
 * Who builds up (RFC 0028): half the regulars, a guess. A floor is a long goal, and only someone
 * who comes home most days saves for one.
 */
const BUILDERS: Record<Kind, number> = { regular: 0.5, visitor: 0, drifter: 0, oneday: 0 };

const TOWNSFOLK = ["t_bram", "t_clem", "t_dot", "t_fern", "t_hale", "t_ivy", "t_juno", "t_moss"];
/** Share of each townsfolk budget their scripts actually hand out on a typical day. */
const TOWNSFOLK_SPEND = Number(args["townsfolk-spend"]) / 100;
/** The welcomer, when there's a starter gift: one more resident, never one of the month's people. */
const WELCOMER = "w_welcomer";
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
        // From their own stream too, so `--no-floors` leaves everyone else's month as it was.
        builds: FLOORS_ON && BUILDERS[kind] > 0 && building.chance(BUILDERS[kind]),
        // And these from theirs, so `--no-levels` does.
        forages: LEVELS_ON && climbing.chance(FORAGERS[kind]),
        makes: LEVELS_ON && climbing.chance(MAKERS[kind]),
        hosts: LEVELS_ON && climbing.chance(HOSTS[kind]),
        plays: LEVELS_ON && climbing.chance(PLAYERS[kind]) ? climbing.between(1, 4) : 0,
        climbs: LEVELS_ON && climbing.chance(CLIMBERS[kind]),
        jobs: "none",
      },
    });
    const p = people.at(-1);
    if (p && LEVELS_ON && kind === "regular" && climbing.chance(FOCUSED)) {
      focusOn(p.habits, climbing.pick(SKILLS) ?? "growing");
    }
    // From their own stream, two draws a resident, so `--no-jobs` leaves everyone else's month as
    // it was. Someone playing one skill in earnest takes its jobs.
    if (p && JOBS_ON) {
      const any = working.chance(JOB_ANY[kind]);
      const some = working.chance(JOB_TAKERS[kind]);
      p.habits.jobs = p.habits.focus ? "skills" : any ? "any" : some ? "skills" : "none";
      habitsOf.set(p.id, p.habits);
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
  /** Coins floors took (RFC 0028), and the part burned. */
  floors: number;
  floorBurned: number;
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
  // Who waited for the treasury's welcome gift, and for a starter gift, from the day they settled
  // to the day it came.
  const welcomeOwed = new Map<string, number>();
  const welcomePaid = new Map<string, number>();
  const starterOwed = new Map<string, number>();
  const starterPaid = new Map<string, number>();
  const starterQueue: string[] = [];
  let townsfolkWelcomed = 0;
  const settled = new Set<string>();
  const planters = new Map<string, Set<string>>();
  const atHome = (p: Person) => {
    if (JOBS_ON) {
      takeJob(rules, p, planters);
      workJob(rules, p, planters, true);
    }
    if (RECIPES_ON) learnAtHome(rules, p.id, p.habits, planters);
    if (p.habits.gardens) tendGarden(rules, p.id, p.habits, planters);
    if (p.habits.casts > 0) goFishing(rules, p.id, p.habits);
    if (p.habits.builds) goBuild(rules, p.id, p.habits);
    if (p.habits.forages) goForage(rules, p.id);
    if (p.habits.makes) goMake(rules, p.id, p.habits);
    if (KILN_ON && isPotter(p)) goPot(rules, p.id);
    if (JOBS_ON) workJob(rules, p, planters);
    // A holiday's things sell only while it runs, so they come before the rest of the wish list.
    if (HOLIDAYS_ON) keepHoliday(rules, p);
    goShopping(rules, p.id, p.habits);
  };
  rules.open();
  const welcoming = STARTER_GIFT > 0;
  if (welcoming) {
    rules.join(WELCOMER);
    rules.settle(WELCOMER, undefined, true);
  }
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
    tally.floors = 0;
    tally.floorBurned = 0;
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

    // The welcomer comes home every day, and finishes a job on the first three days of a UTC week.
    if (welcoming) {
      rules.home(WELCOMER);
      if (JOB_PAY > 0 && JOBS_ON && DAY0 + day - weekStart(DAY0 + day) < 3)
        payJob(rules.state, WELCOMER);
    }
    const owedNow = new Set(rules.state.economy?.owed ?? []);
    for (const id of welcomeOwed.keys()) {
      if (!welcomePaid.has(id) && !owedNow.has(id)) welcomePaid.set(id, day);
    }
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
          if (rules.state.economy?.owed.includes(p.id)) welcomeOwed.set(p.id, day);
          if (welcoming && STARTER_FROM === "resident") {
            starterOwed.set(p.id, day);
            starterQueue.push(p.id);
          }
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

    // The welcomer pays starter gifts from their own purse, oldest newcomer first. Not on their
    // own first day: the rules refuse that.
    if (welcoming && day > 0) {
      const given = rules.state.economy?.today.given[WELCOMER] ?? 0;
      const due = starterGiftsToday(
        starterQueue,
        rules.balance(WELCOMER),
        STARTER_GIFT,
        N.giveCap - given,
      );
      for (const id of due) {
        if (!rules.give(WELCOMER, id, STARTER_GIFT)) break;
        starterQueue.shift();
        starterPaid.set(id, day);
      }
    }

    if (RECIPES_ON) teachingDay(rules, active, byId, planters);
    if (LEVELS_ON) {
      hostingDay(rules, active, byId);
      playingDay(rules, active, byId);
    }
    if (JOBS_ON) jobsDay(rules, active, byId);

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
      if (tfGive(from, id, TOWNSFOLK_WELCOME)) townsfolkWelcomed++;
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
      floors: tally.floors,
      floorBurned: tally.floorBurned,
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
    let inPurses = held + (welcoming ? rules.balance(WELCOMER) : 0);
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
        const floor = floorAdded.has(p.id) ? FLOORS.price : 0;
        firstWeek.set(p.id, rules.balance(p.id) + (spentBy.get(p.id) ?? 0) + floor);
        firstWeekShop.set(p.id, spentBy.get(p.id) ?? 0);
      }
    }
  }
  const flow = {
    welcome: waits(welcomeOwed, welcomePaid, DAYS - 1),
    starter: waits(starterOwed, starterPaid, DAYS - 1),
    townsfolkWelcomed,
  };
  return { rows, people, shortWelcomes, facts, paired, flow };
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
    const run = holidaySpan(holiday as Holiday, Number(year));
    if (!run) continue;
    const { first, last } = run;
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
 * The five checks RFC 0028 asks of floors: supply per active resident at each week, how soon a
 * builder can afford a floor and adds it, the newcomers' first week at the shop, how long the wood
 * for stairs and a planked loft takes against the anglers' rods, and what floors burn against the
 * mint. The first, third, and fourth print with `--no-floors` too, to compare.
 */
function floorLines(people: Person[], rows: Row[]) {
  console.log("");
  console.log(
    `Floors (RFC 0028): ${FLOORS_ON ? `price ${FLOORS.price}, stairs ${FLOORS.stairsWood} wood, a loft of 25 planks` : "off"}.`,
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
  if (FLOORS_ON) {
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
  if (!FLOORS_ON) return;
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
  console.log(`  Held the price of a floor: ${after(floorAfforded)}.`);
  console.log(`  Added it: ${after(floorAdded)}.`);
  console.log(`  Stairs up (${FLOORS.stairsWood} wood): ${after(stairsUp)}.`);
  console.log(
    `  Stairs and a planked loft (${loftWood()} wood): ${after(loftDone)}; ${woodFor.gathered} wood gathered for it in ${woodFor.daysHome} builder-days at home, ${(woodFor.gathered / Math.max(1, woodFor.daysHome)).toFixed(2)} a day.`,
  );
  const week = rows.slice(-7);
  const sum = (f: (r: Row) => number, list: Row[]) => list.reduce((s, r) => s + f(r), 0);
  const mint = sum((r) => r.mint, week) / week.length;
  const burned = sum((r) => r.floorBurned, week) / week.length;
  console.log(
    `  Floors took ${sum((r) => r.floors, rows)} coins in the month (${sum((r) => r.floorBurned, rows)} burned); in the last 7 days ${Math.round(burned)} burned a day against ${Math.round(mint)} minted a day (${Math.round((100 * burned) / Math.max(1, mint))}%).`,
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
    `  5. A person and two AIs teaching, paying, hosting, and playing each other for ${DAYS} days earned ${tested.household.hosting} Hosting and ${tested.household.playing} Playing points (${tested.household.hosting + tested.household.playing === 0 ? "holds" : "fails"}: nothing), and the sim refused ${tested.household.refusedCredits} event credits that named them as guests. A ring of ten fresh accounts earned ${tested.ring.mean.toFixed(1)} Hosting points an account a day, ${tested.ring.max} at most (${tested.ring.max <= PROGRESS.dailyCap ? "holds" : "fails"}: the cap is ${PROGRESS.dailyCap}); by month end each had ${tested.ring.hosting[0]} to ${tested.ring.hosting.at(-1)} points, Hosting ${tested.ring.level}, with the title from day ${tested.ring.title} and the garment from day ${tested.ring.wear < 0 ? "none" : tested.ring.wear}. The ring also sat down to ${tested.ring.idle.games} games where nobody ever chose (${tested.ring.idle.rated} seats rated) and earned ${tested.ring.playing} Playing points (${tested.ring.playing === 0 ? "holds" : "fails"}: nothing).`,
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

/**
 * What RFC 0030's first and fifth checks need that a month of ordinary residents doesn't show, in
 * a small world of its own. Two accounts with a kitchen, a workbench, a rod, and a pond, handed
 * whatever a job's thing is made of: one plays every day and takes a job whenever the sim lets it,
 * the other plays the last three days of each UTC week. A household of a person and two AIs hold
 * the day's job with neighbors and teach, pay, host, and play each other, and pass a jar one of
 * them made around for Clem's job. And a ring of ten fresh accounts hold the same jobs and do all
 * of that among themselves, with real choices at the game table.
 */
function jobsLab() {
  const counts = jobCounts();
  const rules = simRules(40, counts);
  const { state } = rules;
  rules.open();
  const daily = "j_daily";
  const three = "j_three";
  const pat = "j_pat";
  const ais = ["j_ai1", "j_ai2"];
  const trio = [pat, ...ais];
  const ring = Array.from({ length: 10 }, (_, i) => `j_ring${i}`);
  const everyone = [daily, three, ...trio, ...ring];
  for (const id of everyone) rules.join(id);
  rules.setOwnerPairs(ais.map((ai) => [ai, pat].sort() as [string, string]));
  for (const id of [daily, three]) anglers.add(id);
  for (const id of everyone) rules.settle(id);
  for (const id of everyone) rules.home(id);
  const grant = (to: string, stacks: Partial<Record<string, number>>) =>
    rules.send(TOWN_ACTOR, { type: "test_grant", to, stacks });
  for (const id of [daily, three]) {
    const hearth = state.residents[id]?.hearth ?? { x: 0, y: 0 };
    grant(id, { wood: ROD_WOOD, stone: POND.stone });
    const bench = stationFor(rules, id, "workbench");
    if (bench) rules.send(id, { type: "craft", recipe: FISHING_ROD, ...bench });
    rules.send(id, { type: "place", ...pondTile(hearth), block: "pond" });
  }
  // Free picks, three cards each off today's shelf, so the household and the ring have lessons.
  for (const id of [...trio, ...ring]) {
    while (picksLeft(state, id) > 0) {
      const recipe = working.pick(shelfOn(state.day ?? 0).filter((r) => !knows(state, id, r)));
      if (!recipe || !rules.send(id, { type: "pick_recipe", recipe })) break;
    }
  }
  const done = (id: string) => counts.days.get(id)?.length ?? 0;

  /** The recipe of what a job asks to be made, if it asks for that. */
  const toMake = (job: Job) =>
    job.bring ?? (job.deed?.type === "craft" ? job.deed.recipe : undefined);
  /** Whether the two on their own can do a job in a day: a fish job, or something to make. */
  const inADay = (job: Job) => toMake(job) !== undefined || job.deed?.type === "fish";
  /**
   * Take one of today's jobs and finish it today: a fish job, cast at the hour it asks for, or
   * something to make, from what it takes handed over, with its card bought if it has one.
   */
  const finishOne = (id: string): boolean => {
    for (const job of jobsOn(state).filter(inADay)) {
      const recipe = toMake(job);
      if (recipe !== undefined && !knows(state, id, recipe)) {
        rules.send(TOWN_ACTOR, { type: "test_grant", to: id, coins: recipeCardPrice(recipe) });
        if (!rules.send(id, { type: "shop_buy", sku: cardSku(recipe) })) continue;
      }
      if (!rules.send(id, { type: "take_job", job: job.id })) return false;
      if (job.deed?.type === "fish") {
        const timeOfDay = job.deed.timeOfDay ?? "day";
        for (let i = 0; i < job.deed.count; i++) {
          // A roll past the boot's share and inside the minnow's: a fish at any hour, in any season.
          rules.send(id, { type: "fish", roll: 600, weather: "clear", timeOfDay });
        }
      } else if (recipe !== undefined) {
        const made = makeable(state, id, recipe);
        if (made) grant(id, Object.fromEntries(made.short.map(([k, n]) => [k, n])));
        makeForJob(rules, id, recipe);
        if (job.bring !== undefined) rules.send(id, { type: "hand_in" });
      }
      return heldJob(state, id) === undefined;
    }
    return false;
  };
  /**
   * The last three days of each UTC week that fall in the month and have a job the two can do in a
   * day. A day whose jobs are a crop from the shop's seed, a find, and a host's has none.
   */
  const threeDays = new Set<number>();
  for (let d = DAYS - 1; d >= 0; d--) {
    const week = weekStart(DAY0 + d);
    const inWeek = [...threeDays].filter((day) => weekStart(DAY0 + day) === week).length;
    if (inWeek < 3 && jobsOn({ ...state, day: DAY0 + d }).some(inADay)) threeDays.add(d);
  }
  /** The month's day each of the two finished their tenth job, which is a title. */
  const titleDay = new Map<string, number>();
  let turnedAway = 0;

  /** Hold today's job with neighbors: let go of an older one that's off the board, and take it. */
  const holdNeighbors = (id: string) => {
    const today = jobsOn(state).find((job) => job.skill === "hosting" || job.skill === "playing");
    const held = state.jobs?.held?.[id];
    if (!today || held?.job === today.id || !mayTake(state, id)) return;
    if (held) rules.send(id, { type: "drop_job" });
    rules.send(id, { type: "take_job", job: today.id });
  };
  const jar = { tried: false, aiRefused: false, makerDone: false };
  const age = () => today(state);
  for (let day = 0; day < DAYS; day++) {
    if (day > 0) rules.newDay(day);
    for (const id of everyone) rules.home(id);
    countedFor.clear();

    // The two accounts on their own.
    if (!finishOne(daily)) turnedAway++;
    if (threeDays.has(day)) finishOne(three);
    for (const id of [daily, three]) {
      if (!titleDay.has(id) && jobsDone(state, id) >= JOBS.titleAt) titleDay.set(id, day);
    }

    // The household. Once, on a day Clem asks for something everyone can make, a jar goes round:
    // Pat makes it and gives it to her AI, who holds the same job and can't hand it in, and then
    // Pat, with it back, can.
    const clem = jobsOn(state).find((job) => job.bring !== undefined && knownByAll(job.bring));
    const [ai = ""] = ais;
    if (clem?.bring && !jar.tried && mayTake(state, pat) && mayTake(state, ai)) {
      jar.tried = true;
      for (const id of [pat, ai]) {
        if (state.jobs?.held?.[id]) rules.send(id, { type: "drop_job" });
        rules.send(id, { type: "take_job", job: clem.id });
      }
      const made = makeable(state, pat, clem.bring);
      if (made) grant(pat, Object.fromEntries(made.short.map(([k, n]) => [k, n])));
      makeForJob(rules, pat, clem.bring);
      const item = state.items?.inventories[pat]?.goods.at(-1)?.id ?? "";
      rules.send(pat, { type: "give", item, to: ai });
      jar.aiRefused = !rules.send(ai, { type: "hand_in" }) && done(ai) === 0;
      rules.send(ai, { type: "give", item, to: pat });
      jar.makerDone = rules.send(pat, { type: "hand_in" });
    }
    for (const id of trio) holdNeighbors(id);
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
    playGame(rules, trio, working);
    if (day % 7 === 3) holdEvent(rules, pat, ais, 10, age, (_counted, attended) => attended);

    // The ring: the same job each, and everything it could ask for done among themselves.
    for (const id of ring) holdNeighbors(id);
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
    ring.forEach((a, i) => {
      playGame(rules, [a, ring[(i + shift) % 10] ?? ""], working);
      playGame(rules, [a, ring[(i + other) % 10] ?? ""], working);
    });
  }
  const weeks = (id: string) =>
    [...counts.byWeek.entries()].filter(([key]) => key.startsWith(`${id}:`)).map(([, n]) => n);
  const ringWeeks = ring.flatMap(weeks);
  return {
    daily: done(daily),
    three: done(three),
    turnedAway,
    titleDay: [daily, three].map((id) => titleDay.get(id) ?? "none"),
    household: { jobs: trio.reduce((sum, id) => sum + done(id), 0) - (jar.makerDone ? 1 : 0), jar },
    ring: {
      most: Math.max(0, ...ringWeeks),
      jobs: ring.map(done).sort((a, b) => a - b),
      mostDay: Math.max(0, ...[...counts.byDay.values()]),
    },
  };
}

/** The UTC weeks that lie wholly inside the month, by their Monday. */
function fullWeeks(): number[] {
  const weeks = new Map<number, number>();
  for (let d = 0; d < DAYS; d++) {
    const week = weekStart(DAY0 + d);
    weeks.set(week, (weeks.get(week) ?? 0) + 1);
  }
  return [...weeks.entries()].filter(([, days]) => days === 7).map(([week]) => week);
}

/** The regulars who play a skill in earnest and arrived with two weeks or more left. */
const keenOn = (people: Person[], skill: Skill) =>
  people.filter(
    (p) => p.settles && p.kind === "regular" && p.arrives <= DAYS - 15 && p.habits.focus === skill,
  );

/** Their median points a day in that skill, over their days here. */
function keenPace(state: WorldState, people: Person[], skill: Skill): number {
  const pace = keenOn(people, skill)
    .map((p) => (pointsOf(state, p.id)[skill] ?? 0) / Math.max(1, DAYS - p.arrives))
    .sort((a, b) => a - b);
  return percentile(pace, 0.5);
}

/** What a month with jobs is compared against: the same month's numbers, as `--dump` prints them. */
interface Comparison {
  perActive: number;
  supply: number;
  /** Coins a day the town paid residents for goods over the last 7 days. */
  sold: number;
  /** Coins the town paid for goods, and coins residents spent at the shop, over the month. */
  soldInAll: number;
  spentInAll: number;
  levels: Record<string, number>;
  points: Record<string, number>;
  pace: Record<Skill, number>;
}

function comparison(rules: Rules, people: Person[], rows: Row[]): Comparison {
  const { state } = rules;
  const week = rows.slice(-7);
  return {
    perActive: rows.at(-1)?.perActive ?? 0,
    supply: rows.at(-1)?.supply ?? 0,
    sold: Math.round(week.reduce((s, r) => s + r.sold, 0) / Math.max(1, week.length)),
    soldInAll: rows.reduce((s, r) => s + r.sold, 0),
    spentInAll: rows.reduce((s, r) => s + r.spent, 0),
    levels: Object.fromEntries(
      people.filter((p) => p.settles).map((p) => [p.id, levelsOf(state, p.id).level]),
    ),
    points: Object.fromEntries(
      people.filter((p) => p.settles).map((p) => [p.id, totalPoints(state, p.id)]),
    ),
    pace: Object.fromEntries(
      SKILLS.map((skill) => [skill, keenPace(state, people, skill)]),
    ) as Record<Skill, number>,
  };
}

/**
 * The eight checks RFC 0030 asks of jobs (section 14), from the month just played, a small world
 * of its own for the bounds, the household, and the ring (`jobsLab`), and the same month played
 * again with `--no-jobs` to compare levels, paces, and supply.
 */
function jobLines(rules: Rules, people: Person[], rows: Row[]) {
  const { state } = rules;
  const settled = people.filter((p) => p.settles);
  const takers = settled.filter((p) => p.habits.jobs !== "none");
  const share = (n: number, of: number) =>
    `${n} of ${of} (${Math.round((100 * n) / Math.max(1, of))}%)`;
  const sum = (map: Map<string, number>) => [...map.values()].reduce((s, n) => s + n, 0);
  const holds = (ok: boolean) => (ok ? "holds" : "misses");
  console.log("");
  console.log(
    `Jobs (RFC 0030): ${Object.entries(JOBS)
      .map(([k, v]) => `${k}=${v}`)
      .join(
        " ",
      )}. Of ${settled.length} settled residents, ${takers.filter((p) => p.habits.jobs === "skills").length} take jobs in the skills they play (${takers.filter((p) => p.habits.focus).length} of them play one skill in earnest) and ${takers.filter((p) => p.habits.jobs === "any").length} take any job they could do. In the month: ${sum(monthJobs.taken)} taken, ${sum(monthJobs.done)} finished, ${sum(monthJobs.dropped)} let go, ${sum(monthJobs.lapsed)} lapsed.`,
  );
  const before = JSON.parse(
    execFileSync(
      process.execPath,
      [fileURLToPath(import.meta.url), ...process.argv.slice(2), "--no-jobs", "--dump"],
      { encoding: "utf8", maxBuffer: 1 << 26 },
    ),
  ) as Comparison;
  const tested = jobsLab();

  // 1. The bounds.
  const mostDay = Math.max(0, ...monthJobs.byDay.values());
  const mostWeek = Math.max(0, ...monthJobs.byWeek.values());
  console.log(
    `  1. The bounds. In the month nobody finished more than ${mostDay} in a day (${holds(mostDay <= JOBS.perDay)}: at most ${JOBS.perDay}) or ${mostWeek} in a UTC week (${holds(mostWeek <= JOBS.perWeek)}: at most ${JOBS.perWeek}). On their own, an account that played all ${DAYS} days finished ${tested.daily} jobs for ${tested.daily * JOBS.points} points, turned away on ${tested.turnedAway} days, and one that played three days of each week finished ${tested.three} for ${tested.three * JOBS.points} (${holds(tested.daily === tested.three)}: the same). Their tenth job, and the title ${JOB_TITLE_INFO.helping_hand.label}, came on day ${tested.titleDay.join(" and day ")}.`,
  );

  // 2. A regular who takes jobs in the skills they play.
  const weeks = fullWeeks();
  const plain = settled.filter(
    (p) =>
      p.kind === "regular" &&
      p.habits.jobs === "skills" &&
      !p.habits.focus &&
      p.arrives <= DAYS - 15,
  );
  const perWeek = plain
    .flatMap((p) =>
      weeks
        .filter((week) => week > DAY0 + p.arrives)
        .map((week) => monthJobs.byWeek.get(`${p.id}:${week}`) ?? 0),
    )
    .sort((a, b) => a - b);
  const mean = perWeek.reduce((s, n) => s + n, 0) / Math.max(1, perWeek.length);
  const twoOrMore = perWeek.filter((n) => n >= 2).length;
  const ahead = plain
    .map((p) => {
      const level = levelsOf(state, p.id).level;
      const was = before.levels[p.id] ?? 1;
      return { gain: level - was, level, was };
    })
    .sort((a, b) => a.gain - b.gain);
  const gained = ahead.map((a) => a.gain);
  const over = gained.filter((n) => n > 1).length;
  const most = ahead.at(-1) ?? { gain: 0, level: 1, was: 1 };
  console.log(
    `  2. Regulars who take jobs in the skills they play and arrived with 2 weeks or more left (n=${plain.length}), over the whole weeks after they came (${perWeek.length} in all): ${mean.toFixed(1)} jobs a week on average, median ${percentile(perWeek, 0.5)}, two or three in ${share(twoOrMore, perWeek.length)} of their weeks (${holds(percentile(perWeek, 0.5) >= 2)}: two or three a week). Levels above the same resident with --no-jobs at month end: median ${percentile(gained, 0.5)}, p90 ${percentile(gained, 0.9)}, most ${most.gain} (level ${most.level} against ${most.was}); more than one level above: ${share(over, gained.length)} (${holds(over === 0)}: at most one).`,
  );

  // 3. Every cap every day, with every job, against the median regular.
  const early = settled.filter((p) => p.kind === "regular" && p.arrives <= 2);
  const median = (list: number[]) =>
    percentile(
      [...list].sort((a, b) => a - b),
      0.5,
    );
  const now = median(early.map((p) => levelsOf(state, p.id).level));
  const was = median(early.map((p) => before.levels[p.id] ?? 1));
  const kinds =
    CROPS.length +
    GOOD_KINDS.length +
    FURNITURE_KINDS.length +
    SWEET_KINDS.length +
    FIND_KINDS.length +
    FISH_KINDS.length;
  const ceiling = DAYS * SKILLS.length * PROGRESS.dailyCap + kinds * PROGRESS.first;
  const withJobs = ceiling + tested.daily * JOBS.points;
  const ratio = (points: number, level: number) => levelOf(points) / Math.max(1, level);
  const pointsNow = median(early.map((p) => totalPoints(state, p.id)));
  const pointsWas = median(early.map((p) => before.points[p.id] ?? 0));
  console.log(
    `  3. Month end. Every cap every day with every first is ${ceiling} points, level ${levelOf(ceiling)}; with every job (${tested.daily}) it's ${withJobs}, level ${levelOf(withJobs)}. The median regular who arrived in the first 3 days (n=${early.length}) is at level ${now} with jobs and ${was} without. So the top is ${ratio(withJobs, now).toFixed(2)} times the median regular in levels with jobs and ${ratio(ceiling, was).toFixed(2)} without (${holds(ratio(withJobs, now) <= ratio(ceiling, was))}: no further above). In points: ${withJobs} against a median of ${pointsNow} with jobs, ${(withJobs / Math.max(1, pointsNow)).toFixed(2)} times, and ${ceiling} against ${pointsWas} without, ${(ceiling / Math.max(1, pointsWas)).toFixed(2)} times.`,
  );

  // 4. Each skill in earnest, with its jobs.
  const at = (rate: number) => (rate > 0 ? Math.round(pointsFor(5) / rate) : 999);
  const days = SKILLS.map((skill) => {
    const keen = keenOn(people, skill);
    return {
      skill,
      now: at(keenPace(state, people, skill)),
      was: at(before.pace[skill] ?? 0),
      jobs: keen.reduce((n, p) => n + (monthJobs.days.get(p.id)?.length ?? 0), 0),
      keen: keen.length,
    };
  }).filter((d) => d.keen > 0);
  const span = (list: number[]) => Math.max(...list) / Math.max(1, Math.min(...list));
  const inRange = days.filter((d) => d.now >= 10 && d.now <= 20).length;
  console.log(
    `  4. Days to level 5 in a skill (${pointsFor(5)} points) at the median pace of the regulars who play it in earnest and arrived with 2 weeks or more left, with its jobs and without: ${days
      .map(
        (d) =>
          `${d.skill} ${d.now} (${d.was} without; ${d.jobs} jobs finished by ${d.keen} residents)`,
      )
      .join(
        ", ",
      )}. Inside 10 to 20 days: ${inRange} of ${days.length} (${holds(inRange === days.length)}). The slowest is ${span(days.map((d) => d.now)).toFixed(2)} times the fastest (${holds(span(days.map((d) => d.now)) <= 2)}: under twice), against ${span(days.map((d) => d.was)).toFixed(2)} without.`,
  );

  // 5. A household, and a ring.
  const { jar } = tested.household;
  console.log(
    `  5. A person and two AIs holding the day's job with neighbors, and teaching, paying, hosting, and playing each other for ${DAYS} days, finished ${tested.household.jobs} jobs that way (${holds(tested.household.jobs === 0)}: none). A jar the person made and gave to her AI, both holding Clem's job: the AI's hand-in was ${jar.aiRefused ? "refused" : "taken"} and the maker's, with the jar back, ${jar.makerDone ? "taken" : "refused"} (${holds(jar.tried && jar.aiRefused && jar.makerDone)}: only its maker's). A ring of ten fresh accounts doing all of it among themselves finished ${tested.ring.jobs[0]} to ${tested.ring.jobs.at(-1)} jobs each in the month, at most ${tested.ring.most} in a UTC week, which is ${tested.ring.most * JOBS.points} job points (${holds(tested.ring.most * JOBS.points <= JOBS.perWeek * JOBS.points)}: at most ${JOBS.perWeek * JOBS.points}).`,
  );

  // 6. Supply against the same month without jobs.
  const last = rows.at(-1);
  const week = rows.slice(-7);
  const soldNow = Math.round(week.reduce((s, r) => s + r.sold, 0) / week.length);
  const moved = (a: number, b: number) => ((a - b) / Math.max(1, b)) * 100;
  if (last) {
    const per = moved(last.perActive, before.perActive);
    console.log(
      `  6. Per active resident at month end: ${last.perActive} with jobs, ${before.perActive} without (${per.toFixed(1)}%; ${holds(Math.abs(per) < 2)}: under 2%). Supply ${last.supply} against ${before.supply} (${moved(last.supply, before.supply).toFixed(1)}%). Sold to the town in the last 7 days: ${soldNow} a day against ${before.sold} (${holds(soldNow <= before.sold)}: no higher). Over the month the town paid ${rows.reduce((s, r) => s + r.sold, 0)} for goods against ${before.soldInAll}, and residents spent ${rows.reduce((s, r) => s + r.spent, 0)} at the shop against ${before.spentInAll}.`,
    );
  }

  // 7. The board over the month.
  const table = JOB_EDITIONS[state.jobs?.edition ?? 1] ?? [];
  const boards = Array.from({ length: DAYS }, (_, d) => jobsOn({ ...state, day: DAY0 + d }));
  const noSolo = boards.filter((board) => !board.some(soloJob)).length;
  const up = new Set(boards.flat().map((job) => job.id));
  const seasons = new Set(boards.map((_, d) => seasonOf(DAY0 + d)));
  const holidays = new Set(boards.flatMap((_, d) => holidaysOf(DAY0 + d)));
  const due = table.filter(
    (job) =>
      (job.season === undefined || seasons.has(job.season)) &&
      (job.holiday === undefined || holidays.has(job.holiday)),
  );
  const never = due.filter((job) => !up.has(job.id)).map((job) => job.id);
  let thin = 0;
  for (let d = 0; d + 7 <= DAYS; d++) {
    for (const skill of SKILLS) {
      const seen = boards.slice(d, d + 7).filter((b) => b.some((job) => job.skill === skill));
      if (seen.length < 3) thin++;
    }
  }
  console.log(
    `  7. The board. Days with no job that needs nothing bought (no seed from the shop, no recipe to learn, no rod): ${noSolo} of ${DAYS} (${holds(noSolo === 0)}: none). Of the ${due.length} jobs in season this month, ${due.length - never.length} came up (${holds(never.length === 0)}: all${never.length > 0 ? `; never up: ${never.join(", ")}` : ""}). Seven-day stretches where a skill was on the board fewer than three days: ${thin} (${holds(thin === 0)}: none).`,
  );

  // 7, continued: each regular job's longest wait for the board, from every day of a year. A job
  // its lane skipped once waits two rounds of the lane less a day (`laneRound`), so a wait that
  // long fails the run.
  const year = Array.from({ length: 365 }, (_, d) => DAY0 + d);
  const waitsIn = (edition: number) =>
    state.jobs ? jobWaits({ ...state, jobs: { ...state.jobs, edition } }, year) : [];
  const editions = [...new Set([1, state.jobs?.edition ?? 1])];
  const waits = new Map(editions.map((edition) => [edition, waitsIn(edition)]));
  const tooLong = (list: JobWait[]) => list.filter(({ wait, round }) => wait >= 2 * round - 1);
  const mine = waits.get(state.jobs?.edition ?? 1) ?? [];
  const waitsOver = tooLong(mine);
  if (waitsOver.length > 0) process.exitCode = 1;
  console.log(
    `     Each regular job's longest wait for the board from any day of the year from ${dayName(DAY0)}, in edition ${state.jobs?.edition ?? 1}, against two rounds of its lane less a day, which a job its lane skipped once waits: ${waitsOver.length} that long (${waitsOver.length === 0 ? "holds" : "fails"}: none${waitsOver.length > 0 ? `; ${waitsOver.map(({ job, wait, round }) => `${job.id} ${wait} days, its round ${round}`).join(", ")}` : ""}). The longest by giver, in days${editions.length > 1 ? `, edition ${editions.join(" then ")}` : ""}:`,
  );
  const waitGivers = [...new Set(mine.map(({ job }) => job.giver))];
  for (const giver of waitGivers) {
    const longest = editions.map((edition) => {
      const theirs = (waits.get(edition) ?? []).filter(({ job }) => job.giver === giver);
      const top = theirs.reduce<JobWait | undefined>(
        (a, b) => (a && a.wait >= b.wait ? a : b),
        undefined,
      );
      return top
        ? `${pad(top.wait, 2)} (${top.job.id} from ${dayName(top.from)}, round ${top.round})`
        : "-";
    });
    console.log(`     ${giver.padEnd(8)} ${longest.join("  ->  ")}`);
  }

  // 8. How often each job is finished.
  console.log(
    "  8. Each job: days on the board, times taken, finished, let go, and lapsed, then each giver's share of takes that were finished.",
  );
  const onBoard = (id: string) => boards.filter((board) => board.some((job) => job.id === id));
  for (const job of table.filter((j) => up.has(j.id))) {
    console.log(
      `     ${job.id.padEnd(20)} ${pad(onBoard(job.id).length, 2)} days  taken ${pad(monthJobs.taken.get(job.id) ?? 0, 4)}  finished ${pad(monthJobs.done.get(job.id) ?? 0, 4)}  let go ${pad(monthJobs.dropped.get(job.id) ?? 0, 4)}  lapsed ${pad(monthJobs.lapsed.get(job.id) ?? 0, 3)}`,
    );
  }
  const givers = [...new Set(table.map((job) => job.giver))].map((giver) => {
    const mine = table.filter((job) => job.giver === giver);
    const taken = mine.reduce((n, job) => n + (monthJobs.taken.get(job.id) ?? 0), 0);
    const done = mine.reduce((n, job) => n + (monthJobs.done.get(job.id) ?? 0), 0);
    return `${giver} ${done} of ${taken} (${Math.round((100 * done) / Math.max(1, taken))}%)`;
  });
  console.log(`     Finished of taken, by giver: ${givers.join(", ")}.`);
}

const pad = (v: string | number, n: number) => String(v).padStart(n);
const percentile = (sorted: number[], q: number) =>
  sorted.length ? (sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? 0) : 0;

function report(rules: Rules) {
  const { rows, people, shortWelcomes, facts, paired, flow } = play(rules);
  if (args.dump) {
    console.log(JSON.stringify(comparison(rules, people, rows)));
    return;
  }
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
        `Last 7 days at the shop: residents sold ${avg((r) => r.sold)} a day to the town (minted) and spent ${avg((r) => r.spent)} a day (${avg((r) => r.burned - r.floorBurned)} burned, the rest to the treasury).`,
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
    if (SHOP_OPEN) floorLines(people, rows);
    if (LEVELS_ON) levelLines(rules, people, rows);
    if (JOBS_ON) jobLines(rules, people, rows);
    if (LEVELS_ON && APPRECIATION) circleLines();
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
    flowLines(rules, people, rows, flow);
  }
}

/**
 * Issue #63's coin flow: the treasury, how long welcome and starter gifts waited, what job pay
 * came to, and the median resident's purse at month end.
 */
function flowLines(
  rules: Rules,
  people: Person[],
  rows: Row[],
  flow: { welcome: Waits; starter: Waits; townsfolkWelcomed: number },
) {
  const low = rows.reduce((a, r) => (r.treasury < a.treasury ? r : a), rows[0] as Row);
  const last = rows.at(-1) as Row;
  const median = (ids: string[]) =>
    percentile(
      ids.map((id) => rules.balance(id)).sort((a, b) => a - b),
      0.5,
    );
  const settledIds = (f: (p: Person) => boolean) =>
    people.filter((p) => p.settles && f(p)).map((p) => p.id);
  const line = (w: Waits) =>
    `median ${w.median} days, p90 ${w.p90}, longest ${w.max}; ${w.waiting} still waiting at month end${w.waiting ? `, the oldest for ${w.oldest} days` : ""}`;
  const from = {
    resident: "a welcomer's own purse",
    town: "the town, in the welcome gift",
    townsfolk: "the townsfolk, in their welcome tip",
  }[STARTER_FROM];
  console.log("");
  if (SHOP_COUNTER) {
    const sorted = [...trips.tiles].sort((a, b) => a - b);
    const median = sorted.length ? (sorted[Math.floor(sorted.length / 2)] ?? 0) : 0;
    const asked = trips.made + trips.skipped + trips.nowhere;
    console.log(
      `\nThe shop's counter (RFC 0042): ${trips.made} trips made, ${trips.skipped} days nobody ` +
        `bothered (--shop-trips ${Math.round(SHOP_TRIPS * 100)}%), ${trips.nowhere} with no walk ` +
        `to it. Median walk ${median} tiles, longest ${sorted[sorted.length - 1] ?? 0}. ` +
        `${asked === 0 ? "Nobody" : `${Math.round((trips.made / asked) * 100)}% of the times a ` + `resident wanted the shop they got there`}.`,
    );
  }
  if (KILN_ON) potteryLines(people);
  if (COZY_ON) {
    console.log(
      `Cozy pieces (RFC 0044): ${cozy.made} made by ${cozy.makers.size} makers, for ${cozy.cards} coins of cards and ${cozy.cushions} of cushions.`,
    );
  }
  console.log(
    `Coin flow (issue #63): townsfolk hand out ${args["townsfolk-spend"]}% of their budgets; starter gift ${STARTER_GIFT}${STARTER_GIFT ? ` from ${from}` : ""}; job pay ${JOB_PAY}${JOB_PAY ? ` ${JOB_PAY_MINTED ? "minted" : "from the treasury"}` : ""}.`,
  );
  console.log(
    `  Treasury: ${rows[0]?.treasury ?? 0} at the end of day 0, lowest ${low.treasury} on day ${low.day}, ${last.treasury} at month end.`,
  );
  const w = flow.welcome;
  console.log(
    `  Welcome gifts (${N.welcomeGift}): ${w.paid + w.waiting} waited for a new_day; of those paid, ${line(w)}.`,
  );
  const arrivals = people.filter((p) => p.arrives < DAYS).length;
  console.log(
    `  Townsfolk welcome tips (${TOWNSFOLK_WELCOME}): ${flow.townsfolkWelcomed} of ${arrivals} newcomers got one the day they arrived.`,
  );
  if (STARTER_GIFT > 0 && STARTER_FROM === "resident") {
    const st = flow.starter;
    console.log(
      `  Starter gifts (${STARTER_GIFT}) from the welcomer: ${st.paid} of ${st.paid + st.waiting} paid, ${st.sameDay} the day the newcomer settled; ${line(st)}. The welcomer ends the month with ${rules.balance(WELCOMER)}.`,
    );
  }
  if (JOB_PAY > 0) {
    const week = rows.slice(-7);
    const minted = week.reduce((s, r) => s + r.mint, 0);
    const takers = [...jobPay.to.values()].sort((a, b) => a - b);
    const paidWeek = Math.round((jobPay.coins / Math.max(1, rows.length)) * 7);
    console.log(
      `  Job pay: ${jobPay.paid} jobs paid, ${jobPay.coins} coins (about ${Math.round(jobPay.coins / rows.length)} a day, ${paidWeek} a week), ${jobPay.skipped} skipped because the treasury held its reserve. ${takers.length} residents were paid: median ${percentile(takers, 0.5)} over the month, most ${takers.at(-1) ?? 0}.${JOB_PAY_MINTED ? ` In the last 7 days everything minted came to ${Math.round(minted / 7)} a day.` : ""}`,
    );
  }
  const all = settledIds(() => true);
  const early = settledIds((p) => p.arrives <= 6);
  const regulars = settledIds((p) => p.arrives <= 6 && p.kind === "regular");
  console.log(
    `  Median month-end purse: every settled resident ${median(all)} (n=${all.length}), those who arrived in the first week ${median(early)} (n=${early.length}), regulars among them ${median(regulars)} (n=${regulars.length}). Per active resident ${last.perActive}, supply ${last.supply}.`,
  );
}

/** RFC 0047's checks, for a `--kiln` run: clay, walks, pots, cards, finishes, and Making. */
function potteryLines(people: Person[]) {
  const potterIds = people.filter((p) => potters.get(p.id)).map((p) => p.id);
  const p = pottery;
  const firedAll = Object.values(p.fired).reduce((a, b) => a + b, 0);
  const walks = [...p.walkedTiles].sort((a, b) => a - b);
  const far = [...p.farWalks].sort((a, b) => a - b);
  const toTeapot = [...p.firstTeapot.entries()]
    .flatMap(([id, d]) => (p.firstBowl.has(id) ? [d - (p.firstBowl.get(id) ?? d)] : []))
    .sort((a, b) => a - b);
  const making5 = [...p.making5.values()].sort((a, b) => a - b);
  const finishes = Object.entries(p.finishes)
    .map(([f, n]) => `${n} ${f}`)
    .join(", ");
  console.log("");
  console.log(
    `Pottery (RFC 0047, --kiln): ${potterIds.length} potters, ${p.kilns} kilns placed (${p.stoneWalks} walks for a kiln's stone), ${p.ponds} tiles of pond dug by home for clay, ${p.days} potter-days at home.`,
  );
  console.log(
    `  Clay: ${(p.nearClay / Math.max(1, p.days)).toFixed(2)} picked up within reach of the hearth a potter-day; ${p.walks} walks for more (${Math.round((p.walks / Math.max(1, p.days)) * 100)}% of days), median ${percentile(walks, 0.5)} tiles out, ${(p.walkClay / Math.max(1, p.walks)).toFixed(2)} clay a walk. From forest or stone ground: ${far.length} walks, median ${percentile(far, 0.5)} tiles.`,
  );
  console.log(
    `  Pots: ${firedAll} fired (${Object.entries(p.fired)
      .map(([k, n]) => `${n} ${k}s`)
      .join(
        ", ",
      )}), ${(firedAll / Math.max(1, p.days)).toFixed(2)} a potter-day; ${p.glazed} loaded in a glaze. Finishes: ${finishes}.`,
  );
  console.log(
    `  Engaged potters (a kiln and water by home, clay beside water at ${POTTERY.clayByWaterChance} a tile a day): ${p.engagedDays} potter-days, ${(p.engagedClay / Math.max(1, p.engagedDays)).toFixed(2)} clay picked up near home a day, ${(p.engagedFired / Math.max(1, p.engagedDays)).toFixed(2)} pots taken out a day.`,
  );
  console.log(
    `  Cards: ${p.cards} coins burned on the vase's and the teapot's, ${(p.cards / Math.max(1, potterIds.length)).toFixed(1)} a potter. Days from a first bowl out to a first teapot loaded: median ${percentile(toTeapot, 0.5)} (n=${toTeapot.length}).`,
  );
  console.log(
    `  Making level 5: ${making5.length} potters reached it, median ${percentile(making5, 0.5)} days after their first bowl came out.`,
  );
}

report(simRules());
