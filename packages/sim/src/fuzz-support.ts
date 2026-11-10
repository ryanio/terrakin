import { apply, prepare } from "./apply";
import { CATALOG, CROPS } from "./catalog";
import { DAY_MS, HOUR_MS } from "./clock";
import { LANDS_ISLAND } from "./fixtures/lands-log";
import { GRADES } from "./grades";
import { GROUND_KINDS } from "./ground";
import { hashWorld } from "./hash";
import { jobsOn } from "./jobs";
import { HAIR_COLORS, HAIR_STYLES, PATTERNS, THEMES, WEAR_ITEMS } from "./looks";
import { PET_COATS, PET_KINDS } from "./pets";
import { GLAZES } from "./pottery";
import { SHOP_CATALOG } from "./shop";
import { holdingProblems, supplyProblems } from "./test-support";
import { TIMES_OF_DAY } from "./time-of-day";
import { TURNS } from "./turns";
import {
  BLOCK_KINDS,
  CIRCLE_TITLES,
  CLIMBS,
  COMMONS_BLOCKS,
  type Command,
  type CommandType,
  EVENT_KINDS,
  FIREWORK_COLORS,
  GAME_KINDS,
  GAME_PACES,
  type Input,
  JOB_TITLES,
  PROPOSAL_KINDS,
  RESIDENT_COLORS,
  RESIDENT_SHAPES,
  ROOF_STYLES,
  ROOF_TOPS,
  SERVER_COMMANDS,
  SIDES,
  STEP_ROUTINES,
  TITLES,
  TOWN_ACTOR,
  VOTE_CHOICES,
  type WorldEvent,
  type WorldState,
} from "./types";
import { WEATHERS } from "./weather";

/**
 * The seeded fuzz (`fuzz.test.ts`): random commands thrown at a real world, with every invariant
 * in `AGENTS.md` checked after each one. Test support only: no rule imports it.
 */

/** mulberry32: a small seeded PRNG, floats in [0, 1). */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const DIRS = ["n", "s", "e", "w", "ne", "nw", "se", "sw"] as const;
const HOSTILE_IDS = ["__proto__", "constructor", "toString", "hasOwnProperty", "", "nobody"];
const HOSTILE_NUMS = [-1, 0, 0.5, -0.5, 1.5, 1e9, -1e9, Number.MAX_SAFE_INTEGER, 2 ** 31];
const HOSTILE_TEXT = [
  "",
  " ",
  "x".repeat(4000),
  "__proto__",
  "<b>hi</b>",
  "\u0000",
  "🦊".repeat(30),
];
const KINDS = Object.keys(CATALOG);
const SEEDS = KINDS.filter((k) => CATALOG[k as keyof typeof CATALOG].role === "seed");
const RECIPE_KINDS = KINDS.filter((k) => CATALOG[k as keyof typeof CATALOG].recipe !== undefined);
const SKUS = [...Object.keys(SHOP_CATALOG), ...RECIPE_KINDS.map((k) => `recipe:${k}`)];
const USEFUL = ["wood", "stone", "glass", "leaf", "clay"];
const SHOWN_TITLES = [...TITLES, ...JOB_TITLES, ...CIRCLE_TITLES];
const SERVER = new Set<string>(SERVER_COMMANDS);
const coats = Object.values(PET_COATS).flat() as string[];

/** What a generator reads: the world as it stands, who is acting, and the dice. */
class Gen {
  readonly rng: () => number;
  readonly state: WorldState;
  readonly actor: string;
  constructor(rng: () => number, state: WorldState, actor: string) {
    this.rng = rng;
    this.state = state;
    this.actor = actor;
  }

  chance(p: number) {
    return this.rng() < p;
  }
  int(lo: number, hi: number) {
    return lo + Math.floor(this.rng() * (hi - lo + 1));
  }
  pick<T>(list: readonly T[]): T {
    return list[Math.floor(this.rng() * list.length)] as T;
  }
  /** `good` most of the time, else a hostile value of the same JSON type. */
  or<T>(good: () => T, hostile: () => unknown, p = 0.12): T {
    return (this.chance(p) ? hostile() : good()) as T;
  }
  /** One of a fixed list of words, or now and then a word no list holds. */
  word<T extends string>(list: readonly T[]): T {
    return this.or(
      () => this.pick(list),
      () => this.pick(["", "nope", "__proto__", "constructor"]),
      0.08,
    );
  }
  num(lo: number, hi: number) {
    return this.or(
      () => this.int(lo, hi),
      () => this.pick(HOSTILE_NUMS),
    );
  }
  count() {
    return this.num(1, 4);
  }
  text(max = 30) {
    return this.or(
      () => `fz ${this.int(0, 99999)}`.slice(0, max),
      () => this.pick(HOSTILE_TEXT),
    );
  }

  get me() {
    return Object.hasOwn(this.state.residents, this.actor)
      ? this.state.residents[this.actor]
      : undefined;
  }
  residents() {
    return Object.keys(this.state.residents);
  }
  resident() {
    return this.or(
      () => {
        const ids = this.residents();
        return ids.length > 0 ? this.pick(ids) : "ada";
      },
      () => this.pick([...HOSTILE_IDS, TOWN_ACTOR, this.actor]),
    );
  }
  residentList() {
    return Array.from({ length: this.int(0, 3) }, () => this.resident());
  }
  /** An id from `ids` most of the time, else a hostile one. */
  id(ids: readonly string[]) {
    return this.or(
      () => (ids.length > 0 ? this.pick(ids) : this.pick(HOSTILE_IDS)),
      () => this.pick(HOSTILE_IDS),
      0.1,
    );
  }

  /** A tile: near the actor, on a block near them, anywhere, or off the world. */
  tile(): { x: number; y: number } {
    const { width, height } = this.state.config;
    const me = this.me;
    const r = this.rng();
    if (me && r < 0.45) {
      return { x: me.x + this.int(-3, 3), y: me.y + this.int(-3, 3) };
    }
    if (me && r < 0.7) {
      const near = Object.keys(this.state.blocks)
        .map((k) => k.split(",").map(Number) as [number, number])
        .filter(([x, y]) => Math.abs(x - me.x) <= 4 && Math.abs(y - me.y) <= 4);
      if (near.length > 0) {
        const [x, y] = this.pick(near);
        return { x, y };
      }
    }
    if (r < 0.9) return { x: this.int(0, width - 1), y: this.int(0, height - 1) };
    return { x: this.pick([-1, width, 0.5, 1e6]), y: this.pick([-1, height, 2.5, 1e6]) };
  }
  /** A tile from a record keyed by `tileKey`, or `tile()` when it has none. */
  keyedTile(record: Record<string, unknown> | undefined): { x: number; y: number } {
    const keys = Object.keys(record ?? {}).filter((k) => /^-?\d+,-?\d+$/.test(k));
    if (keys.length === 0 || this.chance(0.3)) return this.tile();
    const [x, y] = this.pick(keys).split(",").map(Number) as [number, number];
    return { x, y };
  }
  floor(): number | undefined {
    if (this.chance(0.6)) return undefined;
    return this.or(
      () => this.int(0, 2),
      () => this.pick([-1, 1.5, 99]),
    );
  }
  /** Plot coordinates: one the actor owns, any plot, any slot, or off the grid. */
  plot(): { px: number; py: number } {
    const plots = Object.values(this.state.plots);
    const mine = plots.filter((p) => p.ownerId === this.actor);
    const r = this.rng();
    if (mine.length > 0 && r < 0.5) return this.pick(mine);
    if (plots.length > 0 && r < 0.75) return this.pick(plots);
    const { width, height, plotSize } = this.state.config;
    if (r < 0.92) {
      return {
        px: this.int(0, Math.floor(width / plotSize) - 1),
        py: this.int(0, Math.floor(height / plotSize) - 1),
      };
    }
    return { px: this.pick([-1, 0.5, 1e6]), py: this.pick([-1, 0.5, 1e6]) };
  }
  /** A tile counted from a plot's corner, for a plan. */
  planTile() {
    const side = this.state.config.plotSize;
    const floor = this.floor();
    return {
      x: this.num(0, side - 1),
      y: this.num(0, side - 1),
      ...(floor === undefined ? {} : { floor }),
    };
  }
  planList<T>(make: () => T, most = 4): T[] {
    return Array.from({ length: this.int(0, most) }, make);
  }
  /** Something the actor holds (a made good by id, or a stack by kind), or any kind. */
  item(): string {
    const inventories = this.state.items?.inventories ?? {};
    const inv = Object.hasOwn(inventories, this.actor) ? inventories[this.actor] : undefined;
    const r = this.rng();
    if (inv && inv.goods.length > 0 && r < 0.4) return this.pick(inv.goods).id;
    const stacks = Object.keys(inv?.stacks ?? {});
    if (stacks.length > 0 && r < 0.75) return this.pick(stacks);
    if (r < 0.92) return this.pick(KINDS);
    return this.pick(HOSTILE_IDS);
  }
  goodId(): string {
    const all = Object.values(this.state.items?.inventories ?? {}).flatMap((inv) => inv.goods);
    return this.id(all.map((g) => g.id));
  }
  /** A kind worth holding: a seed, a material, or anything at all. */
  grantKind() {
    return this.chance(0.5) ? this.pick([...SEEDS, ...USEFUL]) : this.kind();
  }
  kind() {
    return this.or(
      () => this.pick(KINDS),
      () => this.pick([...HOSTILE_IDS, "unicorn"]),
    );
  }
  block() {
    return this.word(BLOCK_KINDS);
  }
  grade() {
    return this.chance(0.7) ? undefined : this.word(GRADES);
  }
  dirs(most = 6) {
    return Array.from({ length: this.int(0, most) }, () => this.word(DIRS));
  }
  day() {
    return this.state.day ?? 20_000;
  }
  /** A clock reading in ms: some time in the next few days, on a whole minute. */
  at() {
    return this.or(
      () => (this.day() + this.int(0, 3)) * DAY_MS + this.int(0, 23) * HOUR_MS,
      () => this.pick([-1, 0, 1.5, 1e15]),
    );
  }
  listings() {
    return Object.keys(this.state.market?.listings ?? {});
  }
  bounties() {
    return (this.state.bounties?.list ?? []).map((b) => b.id);
  }
  events() {
    return (this.state.events?.list ?? []).map((e) => e.id);
  }
  tables() {
    return Object.keys(this.state.games?.tables ?? {});
  }
  proposals() {
    return (this.state.town?.proposals ?? []).map((p) => p.id);
  }
  circles() {
    return Object.keys(this.state.circles?.list ?? {});
  }
  jobs() {
    try {
      return jobsOn(this.state).map((j) => j.id);
    } catch {
      return [];
    }
  }
  /** A roll the server logs, out of 10,000. */
  roll() {
    return this.num(0, 9_999);
  }
  pair(): [string, string] {
    return [this.resident(), this.resident()];
  }
  townTiles(): [number, number][] {
    return this.planList(() => {
      const t = this.tile();
      return [t.x, t.y] as [number, number];
    }, 3);
  }
}

type Gens = { [T in CommandType]: (g: Gen) => Omit<Extract<Command, { type: T }>, "type"> };

/**
 * One generator per command type. The mapped type makes the compiler refuse a `Command` with no
 * generator, so a new command fails the sim's typecheck until it gets one here. Generators fill
 * fields from the world most of the time and with hostile values now and then; the casts are
 * where a hostile value is a deliberate lie about its type.
 */
const GENS: Gens = {
  join: (g) => ({ name: g.text(20), kind: g.word(["human", "agent"] as const) }),
  profile: (g) => ({
    ...(g.chance(0.3) ? { color: g.word(RESIDENT_COLORS) } : {}),
    ...(g.chance(0.3) ? { shape: g.word(RESIDENT_SHAPES) } : {}),
    ...(g.chance(0.3) ? { note: g.text(80) } : {}),
    ...(g.chance(0.2) ? { theme: g.chance(0.2) ? null : g.word(THEMES) } : {}),
    ...(g.chance(0.2) ? { pattern: g.chance(0.2) ? null : g.word(PATTERNS) } : {}),
    ...(g.chance(0.2) ? { wear: [g.word(WEAR_ITEMS)] } : {}),
    ...(g.chance(0.1) ? { hair: g.word(HAIR_STYLES), hairColor: g.word(HAIR_COLORS) } : {}),
    ...(g.chance(0.2) ? { title: g.chance(0.3) ? null : g.word(SHOWN_TITLES) } : {}),
  }),
  leave: () => ({}),
  move: (g) => ({ dir: g.chance(0.1) ? g.word(CLIMBS) : g.word(DIRS) }),
  putter: (g) => ({ steps: g.dirs() }),
  rest: (g) => ({ ...g.tile(), floor: g.floor() }),
  claim: () => ({}),
  release: () => ({}),
  set_hearth: (g) => g.tile(),
  home: () => ({}),
  place: (g) => ({
    ...g.tile(),
    floor: g.floor(),
    block: g.block(),
    ...(g.chance(0.3) ? { side: g.word(SIDES) } : {}),
    grade: g.grade(),
    ...(g.chance(0.2) ? { turn: g.word(TURNS.map(String)) as never } : {}),
    ...(g.chance(0.05) ? { item: g.goodId() } : {}),
  }),
  turn: (g) => ({ ...g.tile(), floor: g.floor(), turn: g.pick(TURNS) }),
  remove: (g) => ({
    ...g.tile(),
    floor: g.floor(),
    ...(g.chance(0.3) ? { side: g.word(SIDES) } : {}),
  }),
  lay: (g) => ({ ...g.tile(), floor: g.floor(), ground: g.word(GROUND_KINDS) }),
  lift: (g) => ({ ...g.keyedTile(g.state.ground), floor: g.floor() }),
  add_floor: (g) => g.plot(),
  grow_lot: (g) => g.plot(),
  set_roof: (g) => ({
    ...g.plot(),
    style: g.word(ROOF_STYLES),
    material: g.block(),
    ...(g.chance(0.3) ? { top: g.word(ROOF_TOPS) } : {}),
    grade: g.grade(),
  }),
  build: (g) => ({
    ...g.plot(),
    blocks: g.planList(() => ({ ...g.planTile(), block: g.block() })),
    ground: g.planList(() => ({ ...g.planTile(), ground: g.word(GROUND_KINDS) })),
    remove: g.planList(() => g.planTile(), 2),
    lift: g.planList(() => g.planTile(), 2),
    edges: g.planList(() => ({ ...g.planTile(), side: g.word(SIDES), block: g.block() })),
    removeEdges: g.planList(() => ({ ...g.planTile(), side: g.word(SIDES) }), 2),
  }),
  slim_walls: (g) => ({
    ...g.plot(),
    remove: g.planList(() => g.planTile(), 2),
    edges: g.planList(() => ({ ...g.planTile(), side: g.word(SIDES), block: g.block() })),
  }),
  town_slim: (g) => ({
    ...g.plot(),
    remove: g.planList(() => g.planTile(), 2),
    edges: g.planList(() => ({ ...g.planTile(), side: g.word(SIDES), block: g.block() })),
  }),
  settle: (g) => g.plot(),
  visit: (g) => ({ ...g.plot(), ...(g.chance(0.3) ? g.tile() : {}) }),
  build_starter_home: (g) => ({
    ...(g.chance(0.3) ? { walls: g.block() } : {}),
    ...(g.chance(0.3) ? { windows: g.block() } : {}),
  }),
  share_plot: (g) => ({ with: g.resident() }),
  unshare_plot: (g) => ({ with: g.resident() }),
  propose: (g) => ({
    kind: g.word(PROPOSAL_KINDS),
    title: g.text(),
    text: g.text(200),
    ...(g.chance(0.4)
      ? { blocks: g.planList(() => ({ ...g.tile(), block: g.word(COMMONS_BLOCKS) })) }
      : {}),
    ...(g.chance(0.4) ? { amount: g.num(1, 200), to: g.resident() } : {}),
  }),
  vote: (g) => ({ proposal: g.id(g.proposals()), choice: g.word(VOTE_CHOICES) }),
  withdraw: (g) => ({ proposal: g.id(g.proposals()) }),
  give_coins: (g) => ({
    to: g.resident(),
    amount: g.num(1, 50),
    ...(g.chance(0.3) ? { note: g.text() } : {}),
  }),
  plant: (g) => ({ ...g.tile(), seed: g.word(CROPS) }),
  harvest: (g) => ({
    ...g.keyedTile(g.state.items?.crops),
    ...(g.chance(0.3) ? { roll: g.roll() } : {}),
  }),
  gather: (g) => (g.chance(0.5) ? {} : g.tile()),
  craft: (g) => ({
    recipe: g.word(RECIPE_KINDS) as never,
    ...g.tile(),
    ...(g.chance(0.2) ? { label: g.text() } : {}),
    ...(g.chance(0.2) ? { glaze: g.word(GLAZES) } : {}),
    ...(g.chance(0.3) ? { grade: "fine" as const, roll: g.roll() } : { grade: g.grade() }),
  }),
  give: (g) => ({
    item: g.item(),
    to: g.resident(),
    ...(g.chance(0.5) ? { count: g.count() } : {}),
    ...(g.chance(0.2) ? { note: g.text() } : {}),
    wrapped: g.chance(0.1) ? true : undefined,
    grade: g.grade(),
  }),
  open_present: (g) => ({ present: g.id(Object.keys(g.state.items?.presents ?? {})) }),
  set_off_firework: (g) => ({ ...g.tile(), color: g.word(FIREWORK_COLORS) }),
  decline_gift: (g) => ({ gift: g.id(Object.keys(g.state.items?.gifts ?? {})) }),
  make_piece: (g) => ({
    media: g.or(
      () =>
        `m_${g
          .int(0, 2 ** 30)
          .toString(16)
          .padStart(8, "0")}${"0".repeat(8)}`,
      () => g.pick(HOSTILE_TEXT),
    ),
    title: g.text(),
    ...(g.chance(0.2) ? { model: true as const } : {}),
  }),
  display: (g) => ({ item: g.item(), ...g.tile() }),
  take_down: (g) => g.keyedTile(g.state.items?.displays),
  admire: (g) => g.keyedTile(g.state.items?.displays),
  put_on: (g) => ({ ...g.tile(), floor: g.floor(), item: g.item() }),
  take_off: (g) => ({ ...g.keyedTile(g.state.items?.tops), floor: g.floor() }),
  hang: (g) => ({ ...g.tile(), side: g.word(SIDES), floor: g.floor(), item: g.item() }),
  unhang: (g) => ({ ...g.tile(), side: g.word(SIDES), floor: g.floor() }),
  set_gallery: (g) => ({ ...g.plot(), open: g.chance(0.5) }),
  name_plot: (g) => ({ ...g.plot(), name: g.chance(0.2) ? null : g.text() }),
  shop_buy: (g) => ({ sku: g.word(SKUS), ...(g.chance(0.5) ? { count: g.count() } : {}) }),
  pick_recipe: (g) => ({ recipe: g.word(RECIPE_KINDS) }),
  teach: (g) => ({ recipe: g.word(RECIPE_KINDS), to: g.resident() }),
  sell_to_town: (g) => ({ item: g.item(), ...(g.chance(0.5) ? { count: g.count() } : {}) }),
  set_routines: (g) => ({
    routines: g.planList(
      () =>
        g.pick([
          { kind: "walk_home" as const, hour: g.num(0, 23) },
          { kind: "stroll" as const, hour: g.num(0, 23) },
          { kind: "greet" as const, max: g.num(0, 5) },
        ]),
      3,
    ),
  }),
  list_item: (g) => ({
    item: g.item(),
    ...(g.chance(0.5) ? { count: g.count() } : {}),
    price: g.num(1, 100),
    grade: g.grade(),
  }),
  list_plot: (g) => ({ ...g.plot(), price: g.num(1, 1000) }),
  unlist_plot: (g) => g.plot(),
  buy_plot: (g) => {
    const listed = Object.values(g.state.plotMarket?.listings ?? {});
    const l = listed.length > 0 && g.chance(0.8) ? g.pick(listed) : undefined;
    if (!l) return { ...g.plot(), price: g.num(1, 1000), listed: g.num(1, 500) };
    return {
      px: l.px,
      py: l.py,
      price: g.or(
        () => l.price,
        () => l.price - 1,
      ),
      listed: l.listed,
    };
  },
  unlist_item: (g) => ({ listing: g.id(g.listings()) }),
  buy_listing: (g) => ({ listing: g.id(g.listings()) }),
  post_bounty: (g) => ({
    title: g.text(),
    ...(g.chance(0.5) ? { text: g.text(200) } : {}),
    reward: g.num(1, 80),
  }),
  claim_bounty: (g) => ({ bounty: g.id(g.bounties()) }),
  drop_bounty: (g) => ({ bounty: g.id(g.bounties()) }),
  complete_bounty: (g) => ({ bounty: g.id(g.bounties()) }),
  confirm_bounty: (g) => ({ bounty: g.id(g.bounties()), to: g.resident() }),
  cancel_bounty: (g) => ({ bounty: g.id(g.bounties()) }),
  schedule_event: (g) => ({
    kind: g.word(EVENT_KINDS),
    title: g.text(),
    ...(g.chance(0.5) ? { text: g.text(200) } : {}),
    ...g.plot(),
    startsAt: g.at(),
    minutes: g.num(15, 120),
    circle: g.chance(0.2) ? g.id(g.circles()) : undefined,
  }),
  cancel_event: (g) => ({ event: g.id(g.events()) }),
  join_event: (g) => ({ event: g.id(g.events()), ...(g.chance(0.3) ? g.tile() : {}) }),
  adopt_pet: (g) => {
    const kind = g.word(PET_KINDS);
    const own = Object.hasOwn(PET_COATS, kind) ? PET_COATS[kind] : coats;
    return { kind, coat: g.word(own) as never, name: g.text(20) };
  },
  rename_pet: (g) => ({ name: g.text(20) }),
  groom_pet: (g) => ({ coat: g.word(coats) as never }),
  treat_pet: (g) => ({ owner: g.resident(), item: g.word(CROPS) as never }),
  walk_pet: () => ({}),
  open_table: (g) => ({
    game: g.word(GAME_KINDS),
    pace: g.word(GAME_PACES),
    salt: g.or(
      () =>
        Array.from({ length: 4 }, () =>
          g
            .int(0, 2 ** 30)
            .toString(16)
            .padStart(8, "0"),
        ).join(""),
      () => g.pick(HOSTILE_TEXT),
    ),
    at: g.at(),
  }),
  sit: (g) => ({ table: g.id(g.tables()), at: g.at() }),
  stand: (g) => ({ table: g.id(g.tables()) }),
  start_game: (g) => ({
    table: g.id(g.tables()),
    at: g.at(),
    ...(g.chance(0.3) ? { free: true as const } : {}),
  }),
  decide: (g) => {
    const table = g.id(g.tables());
    const round = Object.hasOwn(g.state.games?.tables ?? {}, table)
      ? (g.state.games?.tables[table]?.round ?? 0)
      : 0;
    return {
      table,
      round: g.or(
        () => round,
        () => g.pick(HOSTILE_NUMS),
      ),
      move: g.num(0, 9),
    };
  },
  trick_or_treat: (g) => g.plot(),
  fish: (g) => ({ roll: g.roll(), weather: g.word(WEATHERS), timeOfDay: g.word(TIMES_OF_DAY) }),
  take_job: (g) => ({ job: g.id(g.jobs()) }),
  drop_job: () => ({}),
  hand_in: (g) => ({ item: g.chance(0.3) ? undefined : g.item() }),
  bring_dish: (g) => ({ item: g.item() }),
  found_circle: (g) => ({ name: g.text(24) }),
  invite_to_circle: (g) => ({
    resident: g.resident(),
    ...(g.chance(0.3) ? { note: g.text() } : {}),
  }),
  cancel_circle_invite: (g) => ({ resident: g.resident() }),
  join_circle: (g) => ({ circle: g.id(g.circles()) }),
  decline_circle_invite: (g) => ({ circle: g.id(g.circles()) }),
  leave_circle: () => ({}),
  chip_in_circle: (g) => ({ circle: g.id(g.circles()), coins: g.num(1, 100) }),
  remove_from_circle: (g) => ({ resident: g.resident() }),
  set_circle_steward: (g) => ({ resident: g.resident(), steward: g.chance(0.5) }),
  name_circle: (g) => ({ name: g.text(24) }),
  set_circle_hall: (g) => (g.chance(0.2) ? { px: null, py: null } : g.plot()),
  new_day: (g) => ({
    day: g.or(
      () => g.day() + g.pick([1, 1, 1, 2]),
      () => g.day() + g.pick([0, -1, 0.5, 400]),
    ),
  }),
  set_townsfolk: (g) => ({ ids: g.residentList() }),
  close_proposal: (g) => ({ proposal: g.id(g.proposals()) }),
  void_proposal: (g) => ({ proposal: g.id(g.proposals()), by: g.resident() }),
  remove_listing: (g) => ({ listing: g.id(g.listings()) }),
  remove_display: (g) => ({
    item: g.goodId(),
    ...(g.chance(0.3) ? { picture: true as const } : {}),
  }),
  clear_plot_name: (g) => g.plot(),
  rename_resident: (g) => ({ resident: g.resident(), name: g.text(20) }),
  clear_block: (g) => ({
    ...g.keyedTile(g.state.blocks),
    ...(g.chance(0.3) ? { side: g.word(SIDES) } : {}),
  }),
  open_way: (g) => ({ tiles: g.townTiles() }),
  close_way: (g) => ({ tiles: g.townTiles() }),
  rebuild_home: (g) => ({
    ...g.plot(),
    blocks: g.planList(() => ({ x: g.num(0, 7), y: g.num(0, 7), block: g.block() })),
    remove: g.planList(() => ({ x: g.num(0, 7), y: g.num(0, 7) }), 2),
  }),
  open_economy: () => ({}),
  set_owner_pairs: (g) => ({ pairs: g.planList(() => g.pair(), 2) }),
  add_owner_pair: (g) => ({ pair: g.pair() }),
  remove_owner_pair: (g) => ({ pair: g.pair() }),
  set_maintainers: (g) => ({ ids: g.residentList() }),
  award_grant: (g) => ({
    to: g.resident(),
    coins: g.num(1, 50),
    by: g.text(),
    resident: g.resident(),
  }),
  test_grant: (g) => ({
    to: g.resident(),
    ...(g.chance(0.7) ? { coins: g.num(20, 300) } : {}),
    ...(g.chance(0.7)
      ? { stacks: Object.fromEntries(g.planList(() => [g.grantKind(), g.num(1, 12)] as const, 4)) }
      : {}),
  }),
  open_items: () => ({}),
  open_gifts: () => ({}),
  own_plot_pickups: () => ({}),
  open_way_pickups: () => ({}),
  open_finds: () => ({}),
  solid_buildings: () => ({}),
  keep_table_spots: () => ({}),
  starter_doors: () => ({}),
  starter_edges: () => ({}),
  plot_reach: () => ({}),
  walls_on_lines: () => ({}),
  close_rule_gaps: () => ({}),
  regrid: () => ({}),
  slim_homes: () => ({}),
  open_shop: () => ({}),
  set_shop_share: (g) => ({ percent: g.num(0, 100) }),
  lower_holiday_prices: () => ({}),
  raise_inventory: () => ({}),
  shop_in_person: () => ({}),
  propose_in_person: () => ({}),
  schedule_in_person: () => ({}),
  attend_at_ten: () => ({}),
  name_sales: () => ({}),
  open_land: (g) => {
    const { width, height, plotSize } = g.state.config;
    const px = Math.floor(width / plotSize);
    return {
      land: g.or(
        () => `isle_${g.int(0, 9)}`,
        () => g.pick(HOSTILE_IDS),
      ),
      name: g.text(20),
      width: g.num(16, 64),
      height: g.num(16, 48),
      plots: [
        [px, 0],
        [px, 1],
        [px + 1, 0],
      ],
      bridge: g.planList(() => [g.int(0, width + 16), g.int(0, height)] as [number, number], 3),
      square: [px * plotSize + g.int(0, 8), g.int(0, 16)],
      ...(g.chance(0.2) ? { streets: [[px + 1, 1] as [number, number]] } : {}),
    };
  },
  open_market: () => ({}),
  open_plot_market: (g) => ({ maxPlotsPerResident: g.num(1, 4) }),
  remove_plot_listing: (g) => g.plot(),
  open_recipes: () => ({}),
  retire_repeat_joins: (g) => ({ ids: g.residentList() }),
  merge_resident: (g) => ({ from: g.resident(), into: g.resident() }),
  open_levels: (g) => ({
    firsts: g.planList(() => ({ resident: g.resident(), kinds: [g.kind()] }), 2),
  }),
  credit_event: (g) => ({
    event: g.id(g.events()),
    guests: g.residentList(),
    ...(g.chance(0.3) ? { cups: g.residentList() } : {}),
  }),
  open_jobs: () => ({}),
  open_clay: (g) => (g.chance(0.5) ? { water: true as const } : {}),
  open_grades: () => ({}),
  set_job_edition: (g) => ({ edition: g.num(1, 4) }),
  set_page_edition: (g) => ({ edition: g.num(1, 3) }),
  open_circles: () => ({}),
  clear_circle_name: (g) => ({ circle: g.id(g.circles()) }),
  disband_circle: (g) => ({ circle: g.id(g.circles()), by: g.text() }),
  open_bounties: () => ({}),
  confirm_town_bounty: (g) => ({
    bounty: g.id(g.bounties()),
    to: g.resident(),
    by: g.text(),
    ...(g.chance(0.7) ? { resident: g.resident() } : {}),
  }),
  void_bounty: (g) => ({
    bounty: g.id(g.bounties()),
    by: g.text(),
    ...(g.chance(0.7) ? { resident: g.resident() } : {}),
  }),
  reopen_bounty: (g) => ({
    bounty: g.id(g.bounties()),
    by: g.text(),
    ...(g.chance(0.7) ? { resident: g.resident() } : {}),
  }),
  daily_awards: (g) => ({
    day: g.or(
      () => g.day() - g.int(0, 2),
      () => g.pick(HOSTILE_NUMS),
    ),
    awards: g.planList(
      () => ({ to: g.resident(), amount: g.num(1, 10), reason: "appreciation" as const }),
      3,
    ),
  }),
  set_entitlements: (g) => ({
    residentId: g.resident(),
    items: g.planList(() => g.word(WEAR_ITEMS), 2),
  }),
  implicit_presence: () => ({}),
  leave_idle: (g) => ({ ids: g.residentList() }),
  routine_step: (g) => ({
    resident: g.resident(),
    routine: g.word(STEP_ROUTINES),
    step: g.chance(0.5) ? { type: "home" as const } : { type: "putter" as const, steps: g.dirs() },
  }),
  schedule_town_event: (g) => ({
    key: g.or(
      () => `key_${g.int(0, 9)}`,
      () => g.pick(HOSTILE_IDS),
    ),
    kind: g.word(EVENT_KINDS),
    title: g.text(),
    startsAt: g.at(),
    minutes: g.num(15, 120),
    ...(g.chance(0.3) ? { faces: g.residentList() } : {}),
  }),
  town_presents: (g) => ({ to: g.residentList() }),
  event_start: (g) => ({ event: g.id(g.events()) }),
  event_tick: (g) => ({ event: g.id(g.events()), slot: g.num(0, 12) }),
  event_end: (g) => ({ event: g.id(g.events()) }),
  void_event: (g) => ({
    event: g.id(g.events()),
    by: g.text(),
    ...(g.chance(0.7) ? { resident: g.resident() } : {}),
  }),
  close_round: (g) => {
    const table = g.id(g.tables());
    const round = Object.hasOwn(g.state.games?.tables ?? {}, table)
      ? (g.state.games?.tables[table]?.round ?? 0)
      : 0;
    return {
      table,
      round: g.or(
        () => round,
        () => g.pick(HOSTILE_NUMS),
      ),
      at: g.at(),
    };
  },
  close_table: (g) => ({ table: g.id(g.tables()) }),
};

/** Every command type the fuzz knows, in the union's order. */
export const COMMAND_TYPES = Object.keys(GENS) as CommandType[];

/** How often a type is drawn against the rest: moving, building, and funding come up most. */
const WEIGHT: Partial<Record<CommandType, number>> = {
  move: 10,
  home: 3,
  putter: 3,
  test_grant: 6,
  new_day: 3,
  place: 6,
  remove: 3,
  lay: 3,
  craft: 4,
  shop_buy: 5,
  sell_to_town: 3,
  give: 3,
  give_coins: 3,
  list_item: 3,
  buy_listing: 3,
  plant: 3,
  harvest: 2,
  gather: 3,
  build: 3,
  join: 2,
  settle: 2,
  claim: 2,
};
const weightOf = (t: CommandType) => WEIGHT[t] ?? (SERVER.has(t) ? 0.6 : 1.5);
const WEIGHTED = COMMAND_TYPES.map((t) => ({ t, w: weightOf(t) }));
const TOTAL = WEIGHTED.reduce((sum, { w }) => sum + w, 0);

/**
 * Who would send a command of this type: a circle's members for circle commands, a bounty's
 * poster or claimant, an event's host, a seated player, a pet's owner, someone holding a job, or
 * else someone who owns a plot. Empty when nobody fits.
 */
function likelyActors(state: WorldState, type: CommandType): string[] {
  const circles = Object.values(state.circles?.list ?? {});
  if (type.includes("circle")) {
    return circles.flatMap((c) => [...Object.keys(c.members), ...Object.keys(c.invites ?? {})]);
  }
  if (type.includes("bounty")) {
    return (state.bounties?.list ?? []).flatMap((b) => [
      b.poster,
      ...(b.claimant ? [b.claimant] : []),
    ]);
  }
  if (type.includes("event") || type === "bring_dish") {
    return (state.events?.list ?? []).map((e) => e.host);
  }
  if (["sit", "stand", "start_game", "decide"].includes(type)) {
    return Object.values(state.games?.tables ?? {}).flatMap((t) => t.seats.map((s) => s.resident));
  }
  if (type.includes("pet")) {
    return Object.values(state.residents)
      .filter((r) => r.pet)
      .map((r) => r.id);
  }
  if (type === "hand_in" || type === "drop_job") return Object.keys(state.jobs?.held ?? {});
  if (type === "withdraw" || type === "vote") {
    return (state.town?.proposals ?? []).map((p) => p.author);
  }
  if (type === "open_present") return Object.values(state.items?.presents ?? {}).map((p) => p.to);
  if (type === "decline_gift") return Object.values(state.items?.gifts ?? {}).map((p) => p.to);
  if (type === "unlist_item")
    return Object.values(state.market?.listings ?? {}).map((l) => l.seller);
  return Object.values(state.plots).map((p) => p.ownerId);
}

/**
 * One input: a command type by weight, then an actor (the town for a server command and a
 * resident otherwise, with each sent by the wrong side now and then), then the fields. The input
 * goes through JSON, as the server logs it, so an absent field is absent.
 */
function generate(rng: () => number, state: WorldState, joined: number): Input {
  let roll = rng() * TOTAL;
  let type: CommandType = "move";
  for (const { t, w } of WEIGHTED) {
    roll -= w;
    if (roll < 0) {
      type = t;
      break;
    }
  }
  const ids = Object.keys(state.residents);
  const pickId = () => (ids.length > 0 ? (ids[Math.floor(rng() * ids.length)] as string) : "ada");
  let actor: string;
  const r = rng();
  if (SERVER.has(type)) actor = r < 0.9 ? TOWN_ACTOR : pickId();
  else if (type === "join" && r < 0.7) actor = `fz${joined}`;
  else if (r < 0.92) actor = pickId();
  else if (r < 0.96) actor = TOWN_ACTOR;
  // A hostile actor is one nobody has, or a key every object inherits, which `join` refuses.
  else actor = HOSTILE_IDS[Math.floor(rng() * HOSTILE_IDS.length)] as string;
  const resident = !SERVER.has(type) && type !== "join" && r < 0.92;
  const likely = resident && rng() < 0.6 ? likelyActors(state, type) : [];
  if (likely.length > 0) actor = likely[Math.floor(rng() * likely.length)] as string;
  const fields = GENS[type](new Gen(rng, state, actor));
  return JSON.parse(JSON.stringify({ actor, command: { type, ...fields } })) as Input;
}

/** Where a value in the world is not plain JSON: undefined, a non-finite number, or a class. */
function plainProblem(value: unknown, path = "state"): string | null {
  if (value === undefined) return `${path} is undefined`;
  if (value === null || typeof value === "string" || typeof value === "boolean") return null;
  if (typeof value === "number") return Number.isFinite(value) ? null : `${path} is ${value}`;
  if (typeof value !== "object") return `${path} is a ${typeof value}`;
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      const wrong = plainProblem(value[i], `${path}[${i}]`);
      if (wrong) return wrong;
    }
    return null;
  }
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) return `${path} is not a plain object`;
  for (const [k, v] of Object.entries(value)) {
    const wrong = plainProblem(v, `${path}.${k}`);
    if (wrong) return wrong;
  }
  return null;
}

/** What went wrong with one input. `check` names the invariant. */
interface Problem {
  check: string;
  detail: string;
}

/** What one input did: whether it was accepted, and anything it broke. */
interface Stepped {
  accepted: boolean;
  /** The rejection code, when refused. */
  code?: string;
  problems: Problem[];
  /** The world after the input: `state` itself, or a fresh copy when the input threw. */
  state: WorldState;
}

/**
 * Run one input against `state` and check every invariant around it: `prepare` mutates nothing, a
 * refusal changes nothing and says why, an acceptance raises `seq` by one, the world stays plain
 * JSON that hashes the same after a round trip, coins and counts hold, and the same input on a
 * JSON copy of the world before it gives the same events and the same world.
 */
function step(state: WorldState, input: Input): Stepped {
  const problems: Problem[] = [];
  const add = (check: string, detail: string) => problems.push({ check, detail });
  const snapshot = JSON.stringify(state);
  const before = hashWorld(state);
  const seq = state.seq;
  const fresh = () => JSON.parse(snapshot) as WorldState;
  let prepared: ReturnType<typeof prepare>;
  try {
    prepared = prepare(state, input);
  } catch (e) {
    add("throws", `prepare threw: ${(e as Error).message}`);
    return { accepted: false, problems, state: fresh() };
  }
  if (hashWorld(state) !== before) add("prepare_mutates", "prepare changed the world");
  if (!prepared.ok) {
    // Read as unknown: the types promise a code and a message, and this checks the promise.
    const { code, message }: { code?: unknown; message?: unknown } = prepared.rejection ?? {};
    if (typeof code !== "string" || code === "") add("rejection", "a refusal with no code");
    if (typeof message !== "string" || message.trim() === "") {
      add("rejection", `refusal ${String(code)} has no message`);
    }
    if (hashWorld(state) !== before) {
      add("refusal_mutates", `refusal ${String(code)} changed the world`);
    }
    return { accepted: false, code: String(code), problems, state };
  }
  let events: WorldEvent[];
  try {
    const done = prepared.commit();
    events = done.events;
    if (done.seq !== seq + 1) add("seq", `commit answered seq ${done.seq} after ${seq}`);
  } catch (e) {
    add("throws", `commit threw: ${(e as Error).message}`);
    return { accepted: false, problems, state: fresh() };
  }
  if (state.seq !== seq + 1) add("seq", `seq went from ${seq} to ${state.seq}`);
  const notPlain = plainProblem(state) ?? plainProblem(events, "events");
  if (notPlain) add("plain_json", notPlain);
  const after = hashWorld(state);
  if (hashWorld(JSON.parse(JSON.stringify(state))) !== after) {
    add("plain_json", "a JSON round trip hashes differently");
  }
  for (const line of supplyProblems(state)) add("supply", line);
  for (const line of holdingProblems(state)) add("holdings", line);
  const copy = fresh();
  try {
    const again = prepare(copy, input);
    if (!again.ok) add("snapshot", `a JSON copy refused it: ${again.rejection.code}`);
    else {
      const done = again.commit();
      if (JSON.stringify(done.events) !== JSON.stringify(events)) {
        add("snapshot", "a JSON copy gave different events");
      }
      if (hashWorld(copy) !== after) add("snapshot", "a JSON copy reached a different world");
    }
  } catch (e) {
    add("snapshot", `a JSON copy threw: ${(e as Error).message}`);
  }
  return { accepted: true, problems, state };
}

/**
 * A defect the fuzz found and the sim keeps for now, because fixing it changes a rule on a live
 * world. `matches` names the exact inputs that set it off, read against the world before them;
 * the run never sends one, and counts it instead.
 */
interface KnownFailure {
  name: string;
  matches: (input: Input, state: WorldState) => boolean;
}

/** The defects the fuzz has found that the sim keeps for now. */
export const KNOWN_FAILURES: readonly KnownFailure[] = [];

/** One failure, with what it takes to reproduce it from the starting world. */
interface Failure {
  seed: number;
  start: string;
  step: number;
  input: Input;
  problem: Problem;
  /** The accepted inputs before it that it still needs, after shrinking. */
  needs: Input[];
}

/** What a seeded run did. */
interface Run {
  failures: Failure[];
  known: Record<string, number>;
  accepted: Input[];
  generated: Set<CommandType>;
  acceptedTypes: Set<CommandType>;
  /** Refusals by command type and code, for tuning the generators. */
  codes: Record<string, Record<string, number>>;
  final: WorldState;
}

const matchesProblem = (stepped: Stepped, problem: Problem) =>
  stepped.problems.some((p) => p.check === problem.check);

/**
 * The accepted inputs a failure still needs: drop each one, from the last back, and keep it out
 * when the failing input still breaks the same check without it. Crude, and cheap at these sizes.
 */
function shrink(start: string, prefix: Input[], input: Input, problem: Problem): Input[] {
  const fails = (inputs: Input[]) => {
    const state = JSON.parse(start) as WorldState;
    for (const i of inputs) {
      try {
        const prepared = prepare(state, i);
        if (prepared.ok) prepared.commit();
      } catch {
        return false;
      }
    }
    return matchesProblem(step(state, input), problem);
  };
  let kept = prefix;
  for (let i = kept.length - 1; i >= 0; i--) {
    const without = [...kept.slice(0, i), ...kept.slice(i + 1)];
    if (fails(without)) kept = without;
  }
  return kept;
}

/**
 * Throw `steps` generated inputs at a copy of `start` from `seed`, checking each with `step`.
 * Inputs a known failure describes are counted and skipped; a failure is shrunk and stops the run,
 * since what follows a broken world proves nothing.
 */
export function fuzz(opts: {
  seed: number;
  start: WorldState;
  startName: string;
  steps: number;
  known: readonly KnownFailure[];
}): Run {
  const rng = mulberry32(opts.seed);
  const start = JSON.stringify(opts.start);
  let state = JSON.parse(start) as WorldState;
  const run: Run = {
    failures: [],
    known: {},
    accepted: [],
    generated: new Set(),
    acceptedTypes: new Set(),
    codes: {},
    final: state,
  };
  for (let i = 0; i < opts.steps; i++) {
    const input = generate(rng, state, i);
    run.generated.add(input.command.type);
    const known = opts.known.find((k) => k.matches(input, state));
    if (known) {
      run.known[known.name] = (run.known[known.name] ?? 0) + 1;
      continue;
    }
    const stepped = step(state, input);
    state = stepped.state;
    if (stepped.accepted) {
      run.accepted.push(input);
      run.acceptedTypes.add(input.command.type);
    } else if (stepped.code !== undefined) {
      const row = run.codes[input.command.type] ?? {};
      row[stepped.code] = (row[stepped.code] ?? 0) + 1;
      run.codes[input.command.type] = row;
    }
    for (const problem of stepped.problems) {
      const prefix = stepped.accepted ? run.accepted.slice(0, -1) : [...run.accepted];
      run.failures.push({
        seed: opts.seed,
        start: opts.startName,
        step: i,
        input,
        problem,
        needs: shrink(start, prefix, input, problem),
      });
    }
    if (run.failures.length > 0) break;
  }
  run.final = state;
  return run;
}

/** A failure as lines someone can paste into a test to reproduce it. */
export function describeFailure(f: Failure): string {
  return [
    `seed ${f.seed} from ${f.start}, step ${f.step}: ${f.problem.check}: ${f.problem.detail}`,
    `  input: ${JSON.stringify(f.input)}`,
    `  after ${f.needs.length} accepted inputs on top of ${f.start}:`,
    ...f.needs.map((i) => `    ${JSON.stringify(i)}`),
  ].join("\n");
}

/**
 * Turn on every system a world has not opened and hand each resident coins and things, through
 * the town's own inputs, so the fuzz reaches deep state. Returns the inputs it accepted.
 */
export function deepen(state: WorldState): Input[] {
  const day = (state.day ?? 20_000) + 1;
  const town = (command: Command): Input => ({ actor: TOWN_ACTOR, command });
  const inputs: Input[] = [
    town({ type: "new_day", day }),
    town({ type: "open_economy" }),
    town({ type: "open_items" }),
    town({ type: "open_gifts" }),
    town({ type: "open_shop" }),
    town({ type: "open_market" }),
    town({ type: "open_levels", firsts: [] }),
    town({ type: "open_jobs" }),
    town(LANDS_ISLAND),
    town({ type: "open_plot_market", maxPlotsPerResident: 2 }),
    town({ type: "open_recipes" }),
    town({ type: "open_bounties" }),
    town({ type: "open_circles" }),
    town({ type: "open_grades" }),
    town({ type: "open_clay" }),
    town({ type: "open_finds" }),
  ];
  const seeds = Object.fromEntries(SEEDS.slice(0, 3).map((k) => [k, 2]));
  for (const id of Object.keys(state.residents)) {
    const stacks = { wood: 20, stone: 20, glass: 8, clay: 6, ...seeds };
    inputs.push(town({ type: "test_grant", to: id, coins: 200, stacks }));
  }
  return inputs.filter((input) => apply(state, input).ok);
}
