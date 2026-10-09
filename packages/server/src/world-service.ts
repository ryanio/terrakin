import type {
  Action,
  BuildPlanSummary,
  ChatChannel,
  ErrorCode,
  ServerMessage,
  WorldEvent as WireEvent,
  WorldSnapshot,
} from "@terrakin/protocol";
import {
  absolute,
  BUILD_LIMITS,
  facingFrom,
  GAME_TIMES,
  KARMA,
  LINKS,
  PUTTER_LIMITS,
  ROUTINE_LIMITS,
} from "@terrakin/protocol";
import {
  activeTable,
  activeTables,
  asJoined,
  type BuildPlan,
  buildSummary,
  type Command,
  type Crop,
  chebyshev,
  DAY_LENGTH_MS,
  type DailyAward,
  DEFAULT_CONFIG,
  type Direction,
  EVENTS,
  entitledTo,
  eventEndsAt,
  everyGood,
  findEvent,
  findsOpen,
  GAME_RULES,
  GAMES,
  type GameTable,
  type HostedEvent,
  hasDecided,
  hashWorld,
  type Input,
  isTownsfolk,
  LOOK_MEDIA_KEYS,
  lastSlot,
  own,
  ownerPaired,
  pieceShowingMedia,
  planPutter,
  plotKey,
  prepare,
  REPLAY_VERSION,
  type RecipeName,
  type Resident,
  type ResidentKind,
  type RoutineStep,
  residentById,
  retireProblems,
  SHOP,
  STOREYS,
  type StepRoutine,
  seatOf,
  seatsHeld,
  starterOf,
  TOWN_ACTOR,
  treasuryShareOf,
  type WorldConfig,
  type WorldEvent,
  type WorldState,
  withinEarshot,
} from "@terrakin/sim";
import { closeDue, startBy, townsfolkMove } from "./games";
import { listingRefusal } from "./market";
import { Moderation } from "./moderation";
import {
  boot,
  encodeSnapshot,
  type LogFacts,
  newestVerified,
  pageRows,
  prunable,
  reportable,
  SNAPSHOT_TAIL,
  type SnapshotHeader,
  SnapshotVerifier,
  supplyHolds,
  type WorldCredit,
} from "./snapshots";
import type { Store } from "./store";
import { count, crumb, gauge, report, span } from "./telemetry";
import { cleanText, nameKey } from "./text";
import type { TownEvent } from "./town-events";
import {
  type ActionContext,
  checkLookMedia,
  cleanProfile,
  filtered,
  type LooseProfile,
  type OwnedMediaType,
  performAction,
} from "./world-actions";
import { randomBytes, toHex, WorldCredentials } from "./world-credentials";
import {
  eventsFor,
  holdBackNames,
  isPrivate,
  publicEvents,
  repeatJoins,
  toWire,
  worldSnapshot,
} from "./world-wire";

export type ActResult =
  | {
      ok: true;
      seq: number;
      events: WireEvent[];
      heard?: number;
      /** `putter` only: who it waved at, or null. */
      greeted?: string | null;
      /** `build`: what the plan did, or would do. A `commons_build` proposal: what it would build. */
      plan?: BuildPlanSummary;
      /** `add_storey`: the coins it took, or would take. */
      price?: number;
      dry?: true;
    }
  | {
      ok: false;
      /** `retryAfter`: seconds until an action's own pacing lets it through (`build`, `putter`). */
      error: { code: ErrorCode; message: string; retryAfter?: number };
      dry?: true;
    };

type Listener = (message: ServerMessage) => void;

export interface WorldServiceOptions {
  store: Store;
  config?: WorldConfig;
  /** Residents with no live socket and no REST call for this long are marked offline. */
  idleTimeoutMs?: number;
  now?: () => number;
  /**
   * Count days for the Town Hall: append `new_day` when a UTC day starts (on boot and on `tick()`),
   * and `close_proposal` once a proposal's closing day has started. Both adapters turn this on.
   * Off by default so a test world's log holds only what the test sent.
   */
  days?: boolean;
  /**
   * The townsfolk grant from config. When it differs from what the world last logged, boot appends
   * a `set_townsfolk` input, so the sim (which keeps them out of every vote) sees the same list on
   * every replay. Leave it out to keep whatever the log says.
   */
  townsfolk?: ReadonlySet<string>;
  /**
   * The edge filters (RFC 0006). Pass the same one to `SocialService`, so a resident's refusals
   * add up across chat, posts, and everything else. Default: a fresh one.
   */
  moderation?: Moderation;
  /**
   * Coins (RFC 0008): once the world counts days, append `open_economy` if it never has. Both
   * adapters turn this on. Off by default so a test world's log holds only what the test sent.
   */
  economy?: boolean;
  /**
   * Growing, making, and gathering (RFC 0005, phase 1 item 9): once the world counts days,
   * append `open_items` if it never has. Both adapters turn this on. Off by default so a test
   * world's log holds only what the test sent.
   */
  items?: boolean;
  /**
   * Gifts that can be sent back (`decline_gift`): once items are open, append `open_gifts` if it
   * never has. Both adapters turn this on. Off by default, like `items`.
   */
  gifts?: boolean;
  /**
   * Pickups on a claimed plot for its owner and co-owners only: once items are open, append
   * `own_plot_pickups` if it never has, so gathers logged before the rule replay as they were
   * made. Both adapters turn this on. Off by default, like `items`.
   */
  plotPickups?: boolean;
  /**
   * Finds on the ground (RFC 0021): once items are open, append `open_finds` if it never has, so
   * gathers logged before finds replay as they were made. Both adapters turn this on. Off by
   * default, like `items`.
   */
  finds?: boolean;
  /**
   * The Town Hall and the shop stop walkers: once the world counts days, append `solid_buildings`
   * if it never has, so walks logged before the rule replay as they were made. Both adapters turn
   * this on. Off by default, like `items`.
   */
  solidBuildings?: boolean;
  /**
   * Town Hall builds keep the game tables' spots clear (decision 0126): once the world counts days,
   * append `keep_table_spots` if it never has, so builds filed and closed before the rule replay as
   * they were made. Both adapters turn this on. Off by default, like `items`.
   */
  tableSpots?: boolean;
  /**
   * The town shop (RFC 0008, phase 2): once coins and items are open, append `open_shop` if it
   * never has. Both adapters turn this on. Off by default, like `items`.
   */
  shop?: boolean;
  /**
   * The market (RFC 0008, phase 4): once the shop is open, append `open_market` if it never has.
   * Both adapters turn this on. Off by default, like `shop`.
   */
  market?: boolean;
  /**
   * Bounties and grants (RFC 0008, phase 5): once coins are open, append `open_bounties` if it
   * never has. Both adapters turn this on. Off by default, like `market`.
   */
  bounties?: boolean;
  /**
   * Recipes you learn (RFC 0024): once the shop is open, append `open_recipes` if it never has.
   * The Worker turns it on, so terrakin.org has logged it. The Node server leaves it off, so a self-hosted world, `pnpm dev`, and the e2e servers start without it (specs open recipes themselves, decision 0181).
   */
  recipes?: boolean;
  /**
   * Cheaper holiday stock (decision 0210): once the shop is open, append `lower_holiday_prices` if
   * it never has, so purchases before it replay at decision 0107's prices. The Worker turns it on;
   * the Node server leaves it off, so a self-hosted world, `pnpm dev`, and the e2e servers keep the
   * old prices unless set.
   */
  holidayPrices?: boolean;
  /**
   * Maintainers' resident ids from config. Logged as `set_maintainers` when they differ from the
   * log, so the sim keeps townsfolk budgets away from them.
   */
  maintainers?: ReadonlySet<string>;
  /**
   * Presence that comes with acting (RFC 0014): append `implicit_presence` if the world never has.
   * From then on a REST or link call logs no `join` of its own, and the idle sweep logs one
   * `leave_idle`. Both adapters turn this on. Off by default so a test world's log holds only what
   * the test sent.
   */
  presence?: boolean;
  /** Inputs one minute's sweep replays while verifying a snapshot. Tests make it small. */
  verifySlice?: number;
  /**
   * The town's own events (RFC 0010, `TOWN_EVENTS` in town-events.ts): each is logged once as
   * `schedule_town_event` when its day comes inside the booking window. Both adapters pass the
   * calendar. Default: none, so a test world's log holds only what the test sent.
   */
  townEvents?: readonly TownEvent[];
  /**
   * Clear the old repeat joins (issue #46, decision 0230): once `socialUsers` is wired, append
   * `retire_repeat_joins` if the world never has, with the records `repeatJoinsToRetire` finds
   * then. The Worker turns it on, so terrakin.org logs it once. The Node server leaves it off, so
   * a self-hosted world, `pnpm dev`, and the e2e servers never run it unless set.
   */
  retireRepeatJoins?: boolean;
}

/** A game input the server meant to log was refused. Reported by its code, never an id. */
function gameRefused(code: string, command: string) {
  report(new Error(`${command} refused: ${code}`), "world.games", { command });
}
/**
 * A `build`'s answer: the plan the sim prepared, the one its commit makes (decision 0076). A
 * `commons_build` proposal's: what it would build if it passed now (decision 0101).
 */
const planOf = (prepared: { plan?: BuildPlan }): { plan?: BuildPlanSummary } =>
  prepared.plan ? { plan: buildSummary(prepared.plan) } : {};

/** An `add_storey`'s answer: the coins it took, or on a dry run would take (RFC 0028). */
const priceOf = (command: Command): { price?: number } =>
  command.type === "add_storey" ? { price: STOREYS.price } : {};

/**
 * A join refused for a taken name (decision 0148). For agents and their owners; the web says it
 * in its own words.
 */
const NAME_TAKEN = `Another resident already goes by that name. Pick another name. If that resident is you, keep using your saved token or link key instead of joining again, and if you lost it, ask the Terrakin team at ${absolute(LINKS.contact)}.`;

/** How many residents within earshot a putter tries to wave at before it gives up. */
const PUTTER_GREET_TRIES = 5;

/** One UTC day. The Town Hall's clock ticks once per day, at midnight UTC. */
export const DAY_MS = 86_400_000;

/** UTC days since 1970-01-01. */
export const utcDay = (ms: number) => Math.floor(ms / DAY_MS);

export type { WorldCredit } from "./snapshots";

/** Minutes between an event's attendance samples, in ms. */
const TICK_MS = EVENTS.tickMinutes * 60_000;

/** The most ended days `tick` pays appreciation for at once, after a stretch with no requests. */
const AWARD_CATCH_UP = 7;
/** How often `tick` compares every resident's partner wear with the social layer's (RFC 0007). */
export const ENTITLEMENT_CHECK_MS = 5 * 60_000;

/** One full day/night cycle, from the sim, where the time of day a cast logs is worked out. */
export { DAY_LENGTH_MS };

/** A logged switch `tick()` turns on once, from the town, when its option is set. */
interface TownSwitch {
  option: keyof Pick<
    WorldServiceOptions,
    | "presence"
    | "economy"
    | "items"
    | "gifts"
    | "plotPickups"
    | "finds"
    | "shop"
    | "solidBuildings"
    | "tableSpots"
    | "market"
    | "bounties"
    | "recipes"
    | "holidayPrices"
    | "retireRepeatJoins"
  >;
  /** Whether the world doesn't have it yet and has what it needs first. */
  due: (state: WorldState) => boolean;
  /**
   * A bare `{type}`, copied for each run, or one the service works out when it's due (undefined:
   * not yet).
   */
  command: Command | ((service: WorldService) => Command | undefined);
  /** For the error line when the sim refuses it: "Couldn't <label>: <why>". */
  label: string;
}

/** Comes before the day moves, and without days. */
const PRESENCE_SWITCH: TownSwitch = {
  option: "presence",
  due: (s) => !s.implicitPresence,
  command: { type: "implicit_presence" },
  label: "turn on implicit presence",
};

/**
 * Comes without days too, once the social layer is wired (decision 0230). It reads the social
 * tables on a request's `tick()`, so a read that throws is reported and leaves it for a later tick
 * instead of failing the request.
 */
const RETIRE_SWITCH: TownSwitch = {
  option: "retireRepeatJoins",
  due: (s) => !s.retiredRepeatJoins,
  command: (service) => {
    try {
      const ids = service.repeatJoinsToRetire();
      return ids && { type: "retire_repeat_joins", ids };
    } catch (err) {
      report(err, "world.retire");
      return undefined;
    }
  },
  label: "retire the repeat joins",
};

/** The switches `tick()` turns on once the world counts days, in this order. */
const DAY_SWITCHES: readonly TownSwitch[] = [
  {
    option: "economy",
    due: (s) => !s.economy,
    command: { type: "open_economy" },
    label: "open coins",
  },
  { option: "items", due: (s) => !s.items, command: { type: "open_items" }, label: "open items" },
  {
    option: "gifts",
    due: (s) => !!s.items && !s.items.gifts,
    command: { type: "open_gifts" },
    label: "open gift returns",
  },
  {
    option: "plotPickups",
    due: (s) => !!s.items && !s.items.plotPickupsOwned,
    command: { type: "own_plot_pickups" },
    label: "keep plot pickups for owners",
  },
  {
    option: "finds",
    due: (s) => !!s.items && !findsOpen(s),
    command: { type: "open_finds" },
    label: "put finds out",
  },
  {
    option: "shop",
    due: (s) => !s.shop && !!s.economy && !!s.items,
    command: { type: "open_shop" },
    label: "open the shop",
  },
  // After the shop's chance to open, so a new world's hall and shop turn solid together.
  {
    option: "solidBuildings",
    due: (s) => !s.solidBuildings,
    command: { type: "solid_buildings" },
    label: "make the buildings solid",
  },
  {
    option: "tableSpots",
    due: (s) => !s.tableSpotsKept,
    command: { type: "keep_table_spots" },
    label: "keep the table spots clear",
  },
  {
    option: "market",
    due: (s) => !s.market && !!s.shop,
    command: { type: "open_market" },
    label: "open the market",
  },
  {
    option: "bounties",
    due: (s) => !s.bounties && !!s.economy,
    command: { type: "open_bounties" },
    label: "open bounties",
  },
  {
    option: "recipes",
    due: (s) => !s.recipes && !!s.shop,
    command: { type: "open_recipes" },
    label: "open recipes",
  },
  {
    option: "holidayPrices",
    due: (s) => !!s.shop && !s.shop.holidayPricesLowered,
    command: { type: "lower_holiday_prices" },
    label: "lower the holiday prices",
  },
];

/**
 * Owns the one authoritative world. Every change goes through `act` or `join`/`leave`,
 * which run the sim, persist the accepted input, and broadcast the resulting events. Most actions'
 * checks are in `world-actions.ts`, what goes on the wire in `world-wire.ts`, and tokens and
 * link keys in `world-credentials.ts`.
 */
export class WorldService {
  readonly state: WorldState;
  private readonly store: Store;
  /** Bearer tokens and link keys, kept as hashes. */
  private readonly credentials: WorldCredentials;
  /** What `performAction` (world-actions.ts) reads and calls. */
  private readonly actions: ActionContext;
  /** residentId -> their live listeners. Chat goes only to residents within earshot. */
  private readonly listeners = new Map<string, Set<Listener>>();
  /** Which way each resident last stepped, for drawing only. Kept in memory: a restart forgets it. */
  private readonly facing = new Map<string, Direction>();
  /** When each resident last built a plan for real, for `BUILD_LIMITS`. In memory only. */
  private readonly builds = new Map<string, number>();
  /**
   * The routine that took each away resident's last step, and when (RFC 0009), so the snapshot
   * can say they're out on it for `ROUTINE_LIMITS.awakeMinutes`. Drawing only, like `facing`.
   */
  private readonly routineSteps = new Map<string, { routine: StepRoutine; at: number }>();
  private readonly lastSeen = new Map<string, number>();
  private readonly sockets = new Map<string, number>(); // residentId -> open socket count
  private readonly idleTimeoutMs: number;
  readonly now: () => number;
  private readonly days: boolean;
  private readonly economy: boolean;
  private readonly items: boolean;
  private readonly gifts: boolean;
  private readonly plotPickups: boolean;
  private readonly finds: boolean;
  private readonly solidBuildings: boolean;
  private readonly tableSpots: boolean;
  private readonly shop: boolean;
  private readonly market: boolean;
  private readonly bounties: boolean;
  private readonly recipes: boolean;
  private readonly holidayPrices: boolean;
  private readonly retireRepeatJoins: boolean;
  private readonly presence: boolean;
  private readonly townEvents: readonly TownEvent[];
  /** Town events whose refusal was already reported this boot, so the sweep reports each once. */
  private readonly townEventsReported = new Set<string>();
  /** The edge filters for names, notes, chat, and proposals. */
  readonly moderation: Moderation;
  /**
   * What the server reads from the log besides the world (`LogFacts`): the UTC day each resident
   * first joined (for report weight, never for the sim), the command kinds each has had accepted,
   * today's putters (decision 0049; a restart doesn't reset the daily cap), and karma's credits.
   * Built by the boot's replay, or loaded from a snapshot, and kept up as inputs commit.
   */
  private readonly facts: LogFacts;
  /** The last day `tick` counted awards up to, so it counts each day once per boot. */
  private awardsChecked: number | undefined;
  /** `hashWorld` at one `seq`. Only `run` changes the world, and each change moves `seq`. */
  private hashed = { seq: -1, hash: "" };
  /** Whether `world_log` rows line up with the world's `seq`, which snapshots rely on. */
  private readonly aligned: boolean;
  /** The `seq` of the newest snapshot written, or 0. */
  private snapshotAt = 0;
  /** The newest verified snapshot, for `GET /v1/health`. */
  private verified: { seq: number; hash: string } | undefined;
  private readonly verifier: SnapshotVerifier | undefined;

  constructor(options: WorldServiceOptions) {
    this.store = options.store;
    this.idleTimeoutMs = options.idleTimeoutMs ?? 10 * 60_000;
    this.now = options.now ?? Date.now;
    this.days = options.days ?? false;
    const grant = options.townsfolk;
    this.moderation =
      options.moderation ??
      new Moderation({ now: this.now, privileged: (id) => grant?.has(id) === true });
    // One input at a time, from the newest verified snapshot when there is one (RFC 0014), so the
    // boot holds the world and never the whole log.
    const config = options.config ?? DEFAULT_CONFIG;
    const booted = span("world.boot", "world.boot", () =>
      boot(this.store, config, utcDay(this.now())),
    );
    gauge("world.boot_inputs", booted.inputs, { from: booted.snapshot ? "snapshot" : "log" });
    // Snapshots refuse a world whose coins don't add up, so say so where it shows.
    gauge("world.supply_holds", supplyHolds(booted.state) ? 1 : 0);
    this.state = booted.state;
    this.facts = booted.facts;
    this.aligned = booted.aligned;
    const snapshots = this.store.snapshots;
    if (snapshots) {
      const headers = snapshots.list();
      this.snapshotAt = headers[0]?.seq ?? 0;
      const newest = newestVerified(headers);
      if (newest) this.verified = { seq: newest.seq, hash: newest.hash };
      this.verifier = new SnapshotVerifier(this.store, snapshots, config, options.verifySlice);
    }
    this.credentials = new WorldCredentials(this.store);
    this.actions = {
      state: this.state,
      moderation: this.moderation,
      now: () => this.now(),
      run: (input, dry) => this.run(input, dry),
      blockedEither: (a, b) => this.blockedEither(a, b),
      suspended: (id) => this.suspended(id),
      listingRefusal: (id) => this.listingRefusal(id),
      mediaType: (owner, id) => this.mediaType?.(owner, id),
      pinLookMedia: (id) => this.onLookMedia?.(id, this.lookMedia(id)),
      pinPieceMedia: (item, media) => this.onPieceMedia?.(item, media),
      runGames: () => this.runGames(),
    };
    // Nobody is connected right after a restart. Mark everyone offline so presence is honest.
    this.takeOffline(
      Object.values(this.state.residents)
        .filter((r) => r.online)
        .map((r) => r.id),
    );
    if (options.townsfolk) this.syncTownsfolk(options.townsfolk);
    if (options.maintainers) this.syncMaintainers(options.maintainers);
    this.economy = options.economy ?? false;
    this.items = options.items ?? false;
    this.gifts = options.gifts ?? false;
    this.plotPickups = options.plotPickups ?? false;
    this.finds = options.finds ?? false;
    this.solidBuildings = options.solidBuildings ?? false;
    this.tableSpots = options.tableSpots ?? false;
    this.shop = options.shop ?? false;
    this.market = options.market ?? false;
    this.bounties = options.bounties ?? false;
    this.recipes = options.recipes ?? false;
    this.holidayPrices = options.holidayPrices ?? false;
    this.retireRepeatJoins = options.retireRepeatJoins ?? false;
    this.presence = options.presence ?? false;
    this.townEvents = options.townEvents ?? [];
    // A day may have started (and proposals come due) while the server was down.
    this.tick();
  }

  /** The command types a resident has had accepted, ever (for the check-in's suggestions). */
  doneCommands(residentId: string): ReadonlySet<string> {
    return this.facts.done.get(residentId) ?? new Set();
  }

  /** Log the maintainers list when config changed it. */
  private syncMaintainers(grant: ReadonlySet<string>) {
    const ids = [...grant].sort();
    if (ids.join(",") === (this.state.maintainers ?? []).join(",")) return;
    this.run({ actor: TOWN_ACTOR, command: { type: "set_maintainers", ids } });
  }

  /**
   * Log the whole owner-linked pair list when it differs from the world's (decision 0031), so
   * gifts between a person and their AI skip the daily caps. `Api` calls this once at boot, to
   * catch up on any change the log missed; each link and unlink after that logs just its own pair
   * with `addOwnerPair` and `removeOwnerPair` (decision 0042).
   */
  syncOwnerPairs(links: readonly [string, string][]) {
    const pairs = links
      .map(([a, b]): [string, string] => (a < b ? [a, b] : [b, a]))
      .sort(([a, b], [c, d]) => (a === c ? (b < d ? -1 : b > d ? 1 : 0) : a < c ? -1 : 1));
    const key = (list: readonly (readonly string[])[]) => list.map((p) => p.join("+")).join(",");
    if (key(pairs) === key(this.state.ownerPairs ?? [])) return;
    this.run({ actor: TOWN_ACTOR, command: { type: "set_owner_pairs", pairs } });
  }

  /** Log one new owner pair. Nothing is logged when the world already has it. */
  addOwnerPair(a: string, b: string) {
    if (a === b || ownerPaired(this.state, a, b)) return;
    const done = this.run({ actor: TOWN_ACTOR, command: { type: "add_owner_pair", pair: [a, b] } });
    if (!done.ok) console.error(`Couldn't add an owner pair: ${done.error.message}`);
  }

  /**
   * Log a resident's partner wear when it differs from the world's (RFC 0007 phase 3): a link made
   * or ended, or a promo starting or ending. The sim takes off anything they may no longer wear.
   */
  syncEntitlements(residentId: string, items: readonly string[]) {
    const next = [...new Set(items)].sort();
    if (next.join(",") === entitledTo(this.state, residentId).join(",")) return;
    const done = this.run({
      actor: TOWN_ACTOR,
      command: { type: "set_entitlements", residentId, items: next },
    });
    if (!done.ok) {
      report(new Error(`set_entitlements refused: ${done.error.code}`), "world.entitlements", {
        command: "set_entitlements",
      });
    }
  }

  /**
   * Every linked resident's partner wear now, from the social layer. `tick` compares it with the
   * world's at most every `ENTITLEMENT_CHECK_MS`, so a promo starts and ends on time without a
   * request from the residents it touches.
   */
  entitlements: (() => ReadonlyMap<string, readonly string[]>) | undefined;
  private entitlementsCheckedAt = Number.NEGATIVE_INFINITY;

  /** Bring every resident's partner wear in line. `force` skips the wait between checks. */
  reconcileEntitlements(force = false) {
    const want = this.entitlements;
    if (!want) return;
    const now = this.now();
    if (!force && now - this.entitlementsCheckedAt < ENTITLEMENT_CHECK_MS) return;
    this.entitlementsCheckedAt = now;
    let wanted: ReadonlyMap<string, readonly string[]>;
    try {
      wanted = want();
    } catch (err) {
      report(err, "world.entitlements");
      return;
    }
    const ids = new Set([...wanted.keys(), ...Object.keys(this.state.entitlements ?? {})]);
    for (const id of [...ids].sort()) this.syncEntitlements(id, wanted.get(id) ?? []);
  }

  /** Log one owner pair ending. Nothing is logged when the world doesn't have it. */
  removeOwnerPair(a: string, b: string) {
    if (!ownerPaired(this.state, a, b)) return;
    const done = this.run({
      actor: TOWN_ACTOR,
      command: { type: "remove_owner_pair", pair: [a, b] },
    });
    if (!done.ok) console.error(`Couldn't remove an owner pair: ${done.error.message}`);
  }

  /**
   * Why a resident can't list in the market yet (time in Terrakin, karma), or null. Both live
   * outside the sim. On its own this checks time in Terrakin; `Api` adds karma from the social
   * layer.
   */
  listingRefusal: (residentId: string) => string | null = (id) =>
    listingRefusal(this.state, id, { ageDays: this.residentAgeDays(id), tier: "newcomer" });

  /** Hears each admire as it happens, for karma (decision 0059): who admired whose work, and when. */
  onAdmired: ((admirer: string, maker: string, day: number) => void) | undefined;

  /** Hears each treat a pet gets (RFC 0019), so its owner can be told. */
  onPetTreated: ((owner: string, by: string, kind: Crop) => void) | undefined;
  /** Someone taught a resident a recipe (RFC 0024): the social layer tells the learner. */
  onRecipeTaught: ((learner: string, teacher: string, recipe: RecipeName) => void) | undefined;

  /**
   * Hears each trick-or-treater's knock (RFC 0022), with everyone who lives at the door, so they
   * can be told.
   */
  onTrickOrTreated:
    | ((knocker: string, plot: { px: number; py: number }, residents: string[]) => void)
    | undefined;
  /**
   * Hears every input the world commits, with its events, after it's logged and broadcast:
   * plots to visit (RFC 0020) keep when each plot changed and who visited it. A failure here is
   * reported and never undoes or fails the action.
   */
  onCommitted: ((input: Input, events: readonly WorldEvent[]) => void) | undefined;
  /**
   * Hears each resident `createResident` makes, after their first `join` is logged: a brand new
   * record, never someone coming back. Greetings (decision 0237) queue from it. A failure here is
   * reported and the join stands.
   */
  onNewResident: ((residentId: string) => void) | undefined;

  /** Whether a resident is suspended, from the social layer. Their stall can't sell meanwhile. */
  suspended: (residentId: string) => boolean = () => false;

  /** Whether two residents block each other, from the social layer. Gifts can't cross a block. */
  blockedEither: (a: string, b: string) => boolean = () => false;

  /**
   * Send a putter's wave from one resident to another, through the social layer's gestures.
   * True when it went; false when blocks, gesture limits, or today's putter wave for the pair
   * stopped it. Without a social layer nobody is greeted.
   */
  greet: (from: string, to: string) => boolean = () => false;

  /**
   * Appreciation coins for a day that has ended (decision 0055), counted by the social layer.
   * `tick` logs them once a day as `daily_awards`. Without a social layer nothing is logged.
   */
  dailyAwards: ((day: number) => DailyAward[]) | undefined;

  /** A resident's id from their handle, from the social layer, for a town event's faces. */
  residentByHandle: ((handle: string) => string | undefined) | undefined;

  /**
   * Hears each event that ended (RFC 0010), with the day it ended on, for the hosting record and
   * karma. The world keeps who attended; the social layer decides who counts.
   */
  onEventEnded: ((event: HostedEvent, day: number) => void) | undefined;

  /** Gifts and votes from `sinceDay` on, for karma. */
  credits(sinceDay: number): WorldCredit[] {
    return this.facts.credits.filter((c) => c.day >= sinceDay);
  }

  // ---------- the town's clock ----------

  /** Log the townsfolk list when config changed it, so the sim keeps them out of votes. */
  syncTownsfolk(grant: ReadonlySet<string>) {
    const ids = [...grant].sort();
    if (ids.join(",") === (this.state.townsfolk ?? []).join(",")) return;
    this.run({ actor: TOWN_ACTOR, command: { type: "set_townsfolk", ids } });
  }

  /**
   * Move the world's day forward to today (UTC), close proposals whose closing day has started,
   * and keep the game tables' clock. Cheap when nothing is due, so the adapters call it on every
   * request and once a minute. Each step is a logged input, so replay never needs the clock.
   */
  tick() {
    this.tickDays();
    this.runGames();
  }

  /** Log `sw` from the town when its option is on and the world is due it. */
  private switchOn(sw: TownSwitch) {
    if (!this[sw.option] || !sw.due(this.state)) return;
    const command = typeof sw.command === "function" ? sw.command(this) : { ...sw.command };
    if (!command) return;
    const on = this.run({ actor: TOWN_ACTOR, command });
    if (!on.ok) console.error(`Couldn't ${sw.label}: ${on.error.message}`);
  }

  private tickDays() {
    this.reconcileEntitlements();
    this.switchOn(PRESENCE_SWITCH);
    this.switchOn(RETIRE_SWITCH);
    if (!this.days) return;
    const today = utcDay(this.now());
    if (this.state.day === undefined || today > this.state.day) {
      const started = this.run({ actor: TOWN_ACTOR, command: { type: "new_day", day: today } });
      // A new day is the snapshot's natural boundary: the next boot replays at most a day.
      if (started.ok) this.takeSnapshot();
    }
    const day = this.state.day;
    if (day === undefined) return;
    for (const sw of DAY_SWITCHES) this.switchOn(sw);
    // The treasury's share of shop spending follows the sim's number, logged when it changes so
    // earlier purchases replay at the share they were made at.
    if (this.shop && this.state.shop && treasuryShareOf(this.state) !== SHOP.treasuryShare) {
      const set = this.run({
        actor: TOWN_ACTOR,
        command: { type: "set_shop_share", percent: SHOP.treasuryShare },
      });
      if (!set.ok) console.error(`Couldn't set the shop's share: ${set.error.message}`);
    }
    this.awardDays(day);
    const due = (this.state.town?.proposals ?? []).filter(
      (p) => p.status === "open" && p.closesDay !== undefined && p.closesDay <= day,
    );
    for (const p of due) {
      const closed = this.run({
        actor: TOWN_ACTOR,
        command: { type: "close_proposal", proposal: p.id },
      });
      if (!closed.ok) console.error(`Couldn't close ${p.id}: ${closed.error.message}`);
    }
    this.runEvents();
  }

  // ---------- hosted events (RFC 0010) ----------

  /**
   * Start every event whose time has come, and end every one whose time is up. An event whose whole
   * time passed while the server slept starts and ends at once, with nobody sampled. Samples and the
   * town's calendar are the minute sweep's (`sweepEvents`), never a boot's or a request's: right
   * after a boot everyone is offline, so a sample then would count nobody.
   */
  private runEvents() {
    const now = this.now();
    for (const e of [...(this.state.events?.list ?? [])]) {
      if (e.status === "scheduled" && now >= e.startsAt) {
        this.eventInput({ type: "event_start", event: e.id });
      }
      if (e.status === "live" && now >= eventEndsAt(e)) {
        this.eventInput({ type: "event_end", event: e.id });
      }
    }
  }

  /** Log one of an event's own inputs, and report a refusal: the event would be stuck. */
  private eventInput(command: Command) {
    const done = this.run({ actor: TOWN_ACTOR, command });
    if (!done.ok) {
      report(new Error(`${command.type} refused: ${done.error.code}`), "world.events", {
        command: command.type,
      });
    }
  }

  /**
   * Log each town event from config once its day is inside the booking window and while it's still
   * to come. The sim refuses one whose `key` it already has, so this is safe to run every minute.
   */
  private scheduleTownEvents(now: number) {
    const today = this.state.day;
    if (today === undefined) return;
    for (const t of this.townEvents) {
      if (this.state.events?.list.some((e) => e.key === t.key)) continue;
      const startsAt = Date.parse(t.startsAt);
      if (!(startsAt > now) || utcDay(startsAt) > today + EVENTS.aheadDays) continue;
      const faces = (t.faces ?? []).flatMap((handle) => {
        const id = this.residentByHandle?.(handle);
        return id && this.state.townsfolk?.includes(id) ? [id] : [];
      });
      const done = this.run({
        actor: TOWN_ACTOR,
        command: {
          type: "schedule_town_event",
          key: t.key,
          kind: t.kind,
          title: t.title,
          text: t.text,
          startsAt,
          minutes: t.minutes,
          ...(faces.length > 0 ? { faces } : {}),
        },
      });
      if (!done.ok && !this.townEventsReported.has(t.key)) {
        this.townEventsReported.add(t.key);
        report(new Error(`schedule_town_event refused: ${done.error.code}`), "world.events", {
          command: "schedule_town_event",
        });
      }
    }
  }

  /**
   * The minute sweep's part in events: log the town's events that are due on the calendar, then
   * sample attendance at every live event whose next 5-minute mark has come. A mark the server
   * missed (asleep, or down) is skipped, never made up.
   */
  sweepEvents() {
    const now = this.now();
    this.scheduleTownEvents(now);
    for (const e of [...(this.state.events?.list ?? [])]) {
      if (e.status !== "live" || now >= eventEndsAt(e)) continue;
      const slot = Math.min(Math.floor((now - e.startsAt) / TICK_MS), lastSlot(e.minutes));
      if (slot >= 1 && slot > (e.slot ?? 0)) {
        this.eventInput({ type: "event_tick", event: e.id, slot });
      }
    }
  }

  /**
   * When the world should next be awake for its events, or undefined: in a minute while one is
   * live (so samples land on time and REST guests stay online between calls), else when the next
   * one starts. The Worker sets its alarm from this.
   */
  nextEventWake(): number | undefined {
    const now = this.now();
    let next: number | undefined;
    for (const e of this.state.events?.list ?? []) {
      const at =
        e.status === "live" ? now + 60_000 : e.status === "scheduled" ? e.startsAt : undefined;
      if (at !== undefined && (next === undefined || at < next)) next = at;
    }
    return next === undefined ? undefined : Math.max(next, now + 60_000);
  }

  /**
   * A maintainer merges the duplicate record `from` into `into`, the record that stays (decision
   * 0239). `dry` checks it with the sim and changes nothing.
   */
  mergeResident(from: string, into: string, dry = false): ActResult {
    return this.run({ actor: TOWN_ACTOR, command: { type: "merge_resident", from, into } }, dry);
  }

  /** A maintainer calls off an event that hasn't ended. Logged as a world input naming them. */
  voidEvent(event: string, by: string, resident?: string): ActResult {
    return this.run({
      actor: TOWN_ACTOR,
      command: { type: "void_event", event, by, ...(resident ? { resident } : {}) },
    });
  }

  /**
   * Log appreciation coins for yesterday, and for any day since the last one paid that had no
   * request after it ended (at most `AWARD_CATCH_UP` days back). Counted once per boot; a day
   * with nothing to pay logs nothing. Before the first award ever, only yesterday is counted.
   */
  private awardDays(today: number) {
    const econ = this.state.economy;
    const last = today - 1;
    if (!econ || !this.dailyAwards || this.awardsChecked === last) return;
    if (econ.awardedDay !== undefined && econ.awardedDay >= last) return;
    this.awardsChecked = last;
    const first = Math.max(
      last - AWARD_CATCH_UP + 1,
      econ.awardedDay === undefined ? last : econ.awardedDay + 1,
    );
    for (let day = first; day <= last; day++) this.awardDay(day);
  }

  private awardDay(day: number) {
    const count = this.dailyAwards;
    if (!count) return;
    let awards: DailyAward[];
    try {
      awards = count(day);
    } catch (err) {
      report(err, "world.daily_awards", { command: "daily_awards" });
      return;
    }
    if (awards.length === 0) return;
    const done = this.run({ actor: TOWN_ACTOR, command: { type: "daily_awards", day, awards } });
    if (!done.ok) {
      // A refused list pays nobody that day, so it has to reach someone.
      report(new Error(`daily_awards refused: ${done.error.code}`), "world.daily_awards", {
        command: "daily_awards",
      });
    }
  }

  // ---------- the game tables' clock (RFC 0011) ----------

  /** Set while `runGames` logs, so what it logs can't start it again. */
  private gamesRunning = false;

  /**
   * The tables' clock. A table that waited too long to start closes, a slow table still short of
   * players gets townsfolk in the seats it needs, townsfolk seats choose, and a round closes once
   * every seat has decided, once only away seats are left to and they've had their wait, or once
   * its window ends (`closeDue`), with `at` the time the next round opens. All of it is logged, so replay never reads the clock. `tick` runs it on every request
   * and sweep, the adapters every second, and an accepted `decide` or `start_game` right away.
   */
  runGames() {
    if (this.gamesRunning || !this.state.games) return;
    this.gamesRunning = true;
    try {
      const now = this.now();
      for (const t of activeTables(this.state)) {
        if (t.status === "open") this.tendOpenTable(t, now);
        else this.tendRounds(t.id, now);
      }
    } finally {
      this.gamesRunning = false;
    }
  }

  /**
   * An open table closes once it has waited `GAME_TIMES.waitMinutes`, or once nobody but townsfolk
   * sits there (the sim closes it when the last player stands; this catches someone made townsfolk
   * while seated). A slow one short of players gets townsfolk.
   */
  private tendOpenTable(t: GameTable, now: number) {
    if (now >= startBy(t) || starterOf(this.state, t) === undefined) {
      const closed = this.run({ actor: TOWN_ACTOR, command: { type: "close_table", table: t.id } });
      if (!closed.ok) gameRefused(closed.error.code, "close_table");
      return;
    }
    const waited = now - t.openedAt >= GAME_TIMES.townsfolkAfterMinutes * 60_000;
    if (t.pace === "slow" && waited) this.fillWithTownsfolk(t);
  }

  /**
   * Townsfolk sit in the seats a slow table still needs to start, never more, so they never take a
   * seat a person or an agent wants. They play unrated. Each sits as themselves, logged like anyone.
   */
  private fillWithTownsfolk(t: GameTable) {
    const need = GAME_RULES[t.game].minSeats - t.seats.length;
    if (need <= 0) return;
    const free = (this.state.townsfolk ?? []).filter(
      (id) =>
        residentById(this.state, id) !== undefined &&
        !seatOf(t, id) &&
        seatsHeld(this.state, id) < GAMES.seatsMax &&
        !t.seats.some((s) => this.blockedEither(id, s.resident)),
    );
    for (const id of free.slice(0, need)) {
      if (!this.arrive(id, "sit").ok) continue;
      const sat = this.run({ actor: id, command: { type: "sit", table: t.id, at: this.now() } });
      if (!sat.ok) gameRefused(sat.error.code, "sit");
    }
  }

  /**
   * Townsfolk seats choose, then the round closes if it's due. Again, up to the game's last
   * round, in case more than one round is due at once.
   */
  private tendRounds(id: string, now: number) {
    const game = activeTable(this.state, id)?.game;
    if (!game) return;
    for (let i = 0; i < GAME_RULES[game].roundsMax; i++) {
      const t = activeTable(this.state, id);
      if (t?.status !== "playing") return;
      for (const s of t.seats) {
        if (!isTownsfolk(this.state, s.resident) || hasDecided(t, s.resident)) continue;
        if (!this.arrive(s.resident, "decide").ok) continue;
        const move = townsfolkMove(t, s.resident);
        const done = this.run({
          actor: s.resident,
          command: { type: "decide", table: t.id, round: t.round, move },
        });
        if (!done.ok) gameRefused(done.error.code, "decide");
      }
      if (!closeDue(t, now)) return;
      const closed = this.run({
        actor: TOWN_ACTOR,
        command: { type: "close_round", table: t.id, round: t.round, at: now },
      });
      if (!closed.ok) {
        gameRefused(closed.error.code, "close_round");
        return;
      }
    }
  }

  /**
   * A maintainer confirms a town bounty is done. Logged as a world input naming them, with the
   * resident they also are when the server knows it, for the sim's household check.
   */
  confirmTownBounty(bounty: string, to: string, by: string, resident?: string): ActResult {
    return this.run({
      actor: TOWN_ACTOR,
      command: { type: "confirm_town_bounty", bounty, to, by, ...(resident ? { resident } : {}) },
    });
  }

  /** A maintainer sends a town bounty's claimant back. Logged like `confirmTownBounty`. */
  reopenBounty(bounty: string, by: string, resident?: string): ActResult {
    return this.run({
      actor: TOWN_ACTOR,
      command: { type: "reopen_bounty", bounty, by, ...(resident ? { resident } : {}) },
    });
  }

  /** A maintainer cancels a bounty that hasn't paid. Logged like `confirmTownBounty`. */
  voidBounty(bounty: string, by: string, resident?: string): ActResult {
    return this.run({
      actor: TOWN_ACTOR,
      command: { type: "void_bounty", bounty, by, ...(resident ? { resident } : {}) },
    });
  }

  /** A maintainer voids a proposal. Logged as a world input naming them. */
  voidProposal(proposal: string, by: string): ActResult {
    return this.run({ actor: TOWN_ACTOR, command: { type: "void_proposal", proposal, by } });
  }

  /**
   * Coins from the treasury and stacks of things for a resident (decision 0147). Only the Node
   * server's test route calls it, which needs `TERRAKIN_TEST_CLOCK=1` and a loopback caller.
   */
  testGrant(to: string, coins: number | undefined, stacks: Record<string, number> | undefined) {
    return this.run({
      actor: TOWN_ACTOR,
      command: {
        type: "test_grant",
        to,
        ...(coins === undefined ? {} : { coins }),
        ...(stacks === undefined ? {} : { stacks }),
      },
    });
  }

  /**
   * Recipes you learn (RFC 0024), switched on now rather than at the next tick, so a test can make
   * residents before and after it. Only the Node server's test route calls it, like `testGrant`.
   */
  testOpenRecipes() {
    return this.run({ actor: TOWN_ACTOR, command: { type: "open_recipes" } });
  }

  /**
   * Staff take a listing down (decision 0056). Logged as a world input without who did it: that's
   * in the moderation log, which staff's sign-in emails never leave.
   */
  removeListing(listing: string): ActResult {
    return this.run({ actor: TOWN_ACTOR, command: { type: "remove_listing", listing } });
  }

  /**
   * Staff take a made thing off display, and with `picture` a piece's picture everywhere (decision
   * 0059). Logged without who did it, like `removeListing`. With `dry`, only checked.
   */
  removeDisplay(item: string, picture: boolean, dry = false): ActResult {
    return this.run(
      {
        actor: TOWN_ACTOR,
        command: { type: "remove_display", item, ...(picture ? { picture: true as const } : {}) },
      },
      dry,
    );
  }

  /**
   * Staff take plot (px, py)'s name down (decision 0121). Logged without who did it, like
   * `removeListing`.
   */
  clearPlotName(px: number, py: number): ActResult {
    return this.run({ actor: TOWN_ACTOR, command: { type: "clear_plot_name", px, py } });
  }

  /**
   * Staff cleared the picture from every piece made from an upload (decision 0065: pieces must
   * stop pointing at a file a hidden post or deleted profile pictures took down). One
   * `remove_display {picture}` through the log clears them all; the chosen piece comes off
   * display if it's up, like the staff route. `undefined` when the log refused; nothing changed.
   */
  removePiecePictures(mediaId: string): { removed: string[] } | undefined {
    const piece = pieceShowingMedia(this.state, mediaId);
    if (!piece) return { removed: [] };
    const done = this.removeDisplay(piece, true);
    if (!done.ok) return undefined;
    const removed = done.events.flatMap((e) => (e.type === "picture_removed" ? e.items : []));
    return { removed: [...new Set([piece, ...removed])] };
  }

  /**
   * Whole UTC days since a resident first joined, as of today or as of `onDay`. Residents from
   * before days were counted are old.
   */
  residentAgeDays(residentId: string, onDay = utcDay(this.now())): number {
    const joined = this.facts.joinedDay.get(residentId);
    return joined === undefined ? 0 : onDay - joined;
  }

  /** The UTC day a resident first joined, or undefined when the log doesn't say. */
  joinedDay(residentId: string): number | undefined {
    return this.facts.joinedDay.get(residentId);
  }

  /** Every resident's first join day, in the order they first joined (0: before days counted). */
  joinedDays(): ReadonlyMap<string, number> {
    return this.facts.joinedDay;
  }

  // ---------- identity ----------

  createSession(
    request: { name: string; kind: ResidentKind } & LooseProfile,
  ): ActResult & { residentId?: string; token?: string } {
    const result = this.createResident(request);
    if (!result.ok || !result.residentId) return result;
    const { residentId } = result;
    const token = this.issueToken(residentId);
    return { ...result, residentId, token };
  }

  /**
   * The refusal for a join with a name another resident has, townsfolk included, or undefined.
   * Names are unique (decision 0148, issue #46), so one resident keeps one record even after
   * losing their token or link key, compared on `nameKey`. Decided here, before anything is
   * logged, so old logs replay unchanged: their joins were each fine when they were logged.
   */
  nameTaken(name: string): { code: "name_taken"; message: string } | undefined {
    const wanted = nameKey(cleanText(name));
    return Object.values(this.state.residents).some((r) => nameKey(r.name) === wanted)
      ? { code: "name_taken", message: NAME_TAKEN }
      : undefined;
  }

  /** A new resident in the world, with no bearer token. `GET /v1/join` gives it a link key instead. */
  createResident(
    request: { name: string; kind: ResidentKind } & LooseProfile,
  ): ActResult & { residentId?: string } {
    const residentId = `r_${toHex(randomBytes(8))}`;
    const { name, kind, ...profile } = request;
    const refused =
      filtered(this.moderation, "name", cleanText(name), {}) ??
      filtered(this.moderation, "note", profile.note && cleanText(profile.note), {});
    if (refused) return refused;
    const taken = this.nameTaken(name);
    if (taken) return { ok: false, error: taken };
    // A brand-new resident owns no uploads, so any media here is refused.
    const media = checkLookMedia(this.actions.mediaType, residentId, profile);
    if (media) return media;
    const result = this.run({
      actor: residentId,
      command: { type: "join", name: cleanText(name), kind, ...cleanProfile(profile) },
    });
    if (!result.ok) return result;
    // `run` noted the world's day. A world that doesn't count days uses the clock's, which a
    // restart forgets.
    if (this.state.day === undefined) this.facts.joinedDay.set(residentId, utcDay(this.now()));
    this.touch(residentId);
    try {
      this.onNewResident?.(residentId);
    } catch (err) {
      report(err, "world.new_resident");
    }
    return { ...result, residentId };
  }

  // ---------- look media (RFC 0005) ----------

  private mediaType: OwnedMediaType | undefined;
  private onLookMedia: ((residentId: string, mediaIds: string[]) => void) | undefined;
  private onPieceMedia: ((itemId: string, mediaId: string) => void) | undefined;

  /**
   * Connect the uploads the look fields may name. `type` answers which of a resident's uploads
   * exist and what they are; `pinned` hears a resident's look media after each accepted change,
   * so the upload sweep never deletes media the world still shows. Without this, look media are
   * refused.
   */
  useMedia(
    type: OwnedMediaType,
    pinned: (residentId: string, mediaIds: string[]) => void,
    piece?: (itemId: string, mediaId: string) => void,
  ) {
    this.mediaType = type;
    this.onLookMedia = pinned;
    this.onPieceMedia = piece;
  }

  /**
   * Every piece of art in the world and the upload it shows, wherever it is: in someone's things,
   * on display, held aside, or in the market. For pinning them all after a restart.
   */
  allPieceMedia(): [string, string][] {
    return everyGood(this.state).flatMap(({ good: g }) =>
      g.media ? [[g.id, g.media] as [string, string]] : [],
    );
  }

  /** The upload ids a resident's look names. */
  lookMedia(residentId: string): string[] {
    const r = this.state.residents[residentId];
    if (!r) return [];
    return LOOK_MEDIA_KEYS.flatMap((key) => (r[key] ? [r[key]] : []));
  }

  /** Every resident's look media, for pinning them all after a restart. */
  allLookMedia(): Map<string, string[]> {
    const all = new Map<string, string[]>();
    for (const id of Object.keys(this.state.residents)) {
      const media = this.lookMedia(id);
      if (media.length > 0) all.set(id, media);
    }
    return all;
  }

  // ---------- link keys (decision 0020) ----------

  /**
   * Make a new link key for a resident and turn off the one they had. Returns the key, which is
   * shown once and never stored or logged; only its hash is kept.
   */
  mintLinkKey(residentId: string): string {
    return this.credentials.mintLinkKey(residentId);
  }

  /** Turn off a resident's link key. Returns whether there was one. */
  revokeLinkKey(residentId: string): boolean {
    return this.credentials.revokeLinkKey(residentId);
  }

  /** Resolve a link key to a resident id, or undefined if it's unknown or turned off. */
  authenticateLinkKey(key: string): string | undefined {
    return this.called(this.credentials.linkKeyResident(key));
  }

  /**
   * Hears every authenticated call, by token or link key, with its resident. Routines pause after
   * days with none and the next one starts them again (RFC 0009); `Api` wires it to the away log.
   */
  onCall: ((residentId: string) => void) | undefined;

  /**
   * Tell `onCall` about a resident's call. A failure there (a storage error writing the day) is
   * reported and never turns the call away: authentication answers the same either way.
   */
  private called(residentId: string | undefined): string | undefined {
    if (residentId === undefined) return residentId;
    try {
      this.onCall?.(residentId);
    } catch (err) {
      report(err, "world.call");
    }
    return residentId;
  }

  /** A new bearer token for an existing resident. Only its hash is kept. */
  issueToken(residentId: string): string {
    return this.credentials.issueToken(residentId);
  }

  /**
   * Make every token this resident holds stop working, now and after a restart, and close their
   * live connections. Persisted first, so a failed write leaves the old tokens working rather
   * than half revoked.
   */
  revokeTokens(residentId: string) {
    this.credentials.revokeTokens(residentId);
  }

  /** Whether this resident has a live socket open with one of their tokens. */
  connected(residentId: string): boolean {
    return this.credentials.connected(residentId);
  }

  /** The hashes of every token and the link key this resident holds now. */
  credentialHashes(residentId: string): string[] {
    return this.credentials.credentialHashes(residentId);
  }

  /** Whether this resident holds a bearer token now. */
  holdsToken(residentId: string): boolean {
    return this.credentials.holdsToken(residentId);
  }

  /**
   * Who a bearer token or link key belongs to, without counting it as a call: for working out why
   * a credential sent the wrong way didn't work.
   */
  peekCredential(secret: string): { residentId: string; as: "token" | "linkKey" } | undefined {
    const linkKey = this.credentials.linkKeyResident(secret);
    if (linkKey !== undefined) return { residentId: linkKey, as: "linkKey" };
    const token = this.credentials.tokenResident(secret);
    return token === undefined ? undefined : { residentId: token, as: "token" };
  }

  /** Run `close` if this resident's tokens are revoked. Returns a function that stops watching. */
  watchRevocation(residentId: string, close: () => void): () => void {
    return this.credentials.watchRevocation(residentId, close);
  }

  /** Resolve a bearer token to a resident id, or undefined if unknown. */
  authenticate(token: string): string | undefined {
    return this.called(this.credentials.tokenResident(token));
  }

  /**
   * A REST or link caller is about to do `action`. Once the world has `implicit_presence`, the
   * action itself brings them back online if it's accepted, so this only notes they're here.
   * Before that, or to chat (only residents online speak and hear), they come online now with a
   * logged `join` (`ensureOnline`). Live sockets keep their explicit `join`: someone opening the
   * app should appear before they act.
   */
  arrive(residentId: string, action: Action["type"]): ActResult {
    if (action === "chat" || !this.state.implicitPresence) return this.ensureOnline(residentId);
    this.touch(residentId);
    if (!residentById(this.state, residentId)) {
      return { ok: false, error: { code: "unauthorized", message: "Unknown resident." } };
    }
    return { ok: true, seq: this.state.seq, events: [] };
  }

  /** Bring a known resident back online if they went idle or the server restarted. */
  ensureOnline(residentId: string): ActResult {
    this.touch(residentId);
    const r = this.state.residents[residentId];
    if (!r) return { ok: false, error: { code: "unauthorized", message: "Unknown resident." } };
    if (r.online) return { ok: true, seq: this.state.seq, events: [] };
    return this.run({ actor: residentId, command: { type: "join", name: r.name, kind: r.kind } });
  }

  leave(residentId: string): ActResult {
    if (!this.state.residents[residentId]?.online)
      return { ok: true, seq: this.state.seq, events: [] };
    return this.run({ actor: residentId, command: { type: "leave" } });
  }

  // ---------- actions ----------

  /**
   * Do one action, or with `dry: true` only check it: every check a real call makes (text filters
   * included, so a refused text still counts as a strike), then the sim's `prepare()`. A dry run
   * never persists, commits, or broadcasts, and answers with the current `seq`.
   */
  act(residentId: string, action: Action): ActResult {
    const { dry, ...rest } = action;
    if (!dry) return this.perform(residentId, rest as Action, false);
    if (action.type === "chat") {
      return {
        ok: false,
        dry: true,
        error: {
          code: "bad_request",
          message: "Chat has no dry run. Send it without dry when you mean to say it.",
        },
      };
    }
    return { ...this.perform(residentId, rest as Action, true), dry: true };
  }

  private perform(residentId: string, action: Action, dry: boolean): ActResult {
    this.touch(residentId);
    if (action.type === "chat") return this.chat(residentId, action.text, action.channel);
    if (action.type === "putter") return this.putter(residentId, dry);
    if (action.type === "build") {
      // Drop absent lists: the sim's types forbid explicit undefined.
      const { px, py, blocks, ground, remove, lift } = action;
      const command: Command = {
        type: "build",
        px,
        py,
        ...(blocks ? { blocks } : {}),
        ...(ground ? { ground } : {}),
        ...(remove ? { remove } : {}),
        ...(lift ? { lift } : {}),
      };
      return this.build(residentId, command, dry);
    }
    return performAction(this.actions, residentId, action, dry);
  }

  // ---------- build (RFC 0016) ----------

  /**
   * A plan built in one input, spaced `BUILD_LIMITS.secondsBetween` apart per resident since one
   * can broadcast an event for every tile of a plot. The answer carries the plan `prepare` hands
   * back (`run` adds it), the one the sim commits. A dry run plans and checks, and counts nothing.
   */
  private build(residentId: string, command: Command, dry: boolean): ActResult {
    if (command.type !== "build") throw new Error("build takes a build");
    if (!dry) {
      const last = this.builds.get(residentId);
      const wait = last === undefined ? 0 : last + BUILD_LIMITS.secondsBetween * 1000 - this.now();
      if (wait > 0) {
        const seconds = Math.ceil(wait / 1000);
        return {
          ok: false,
          error: {
            code: "rate_limited",
            message: `You built a moment ago. Try again in ${seconds} ${seconds === 1 ? "second" : "seconds"}.`,
            retryAfter: seconds,
          },
        };
      }
    }
    const result = this.run({ actor: residentId, command }, dry);
    if (result.ok && !dry) this.builds.set(residentId, this.now());
    return result;
  }

  // ---------- putter (decision 0049) ----------

  /**
   * A short walk the sim's planner picks, then a wave at the nearest online resident within
   * earshot. Limited to once a minute and `PUTTER_LIMITS.perDay` a UTC day, counting only accepted
   * putters. The logged command carries the planned steps, so replay never runs the planner. A dry
   * run plans and checks the walk but greets nobody and uses up nothing.
   */
  private putter(residentId: string, dry: boolean): ActResult {
    const limited = this.putterLimited(residentId);
    if (limited) return limited;
    // Plan from where the resident will be: someone offline comes back with the putter itself
    // (implicit presence), and a dry run checks them as if they had, like `check()` does.
    const state = asJoined(this.state, residentId);
    // Never walk up to someone blocked either way: the wave would be refused, and the walk alone
    // would follow them around.
    const avoid = new Set(
      Object.values(state.residents)
        .filter((r) => r.online && r.id !== residentId && this.blockedEither(residentId, r.id))
        .map((r) => r.id),
    );
    const steps = planPutter(state, residentId, avoid);
    const result = this.run({ actor: residentId, command: { type: "putter", steps } }, dry);
    if (!result.ok || dry) return result;
    const now = this.now();
    const today = utcDay(now);
    const used = this.facts.putters.get(residentId);
    const count = used?.day === today ? used.count + 1 : 1;
    this.facts.putters.set(residentId, { at: now, day: today, count });
    return { ...result, greeted: this.greetNearby(residentId) };
  }

  // ---------- routines (RFC 0009) ----------

  /**
   * One step of an away resident's routine, logged from the town as `routine_step`. The sim checks
   * it like any input (they turned it on, they're away, it hasn't used up today, and the step's
   * own rules), so the runner in `routines.ts` can't take a step the resident didn't choose.
   */
  routineStep(resident: string, routine: StepRoutine, step: RoutineStep): ActResult {
    return this.run({
      actor: TOWN_ACTOR,
      command: { type: "routine_step", resident, routine, step },
    });
  }

  /**
   * Hears each accepted command that walked an online resident somewhere (a move, a putter, going
   * home), with their id, after it's logged. `Api` wires it to routines' `greet`. It must not
   * throw; whatever it does can't undo the walk.
   */
  onWalked: ((residentId: string) => void) | undefined;

  /** The refusal when a resident has puttered too recently or too often today. */
  private putterLimited(residentId: string): ActResult | undefined {
    const used = this.facts.putters.get(residentId);
    if (!used) return undefined;
    const now = this.now();
    if (used.day === utcDay(now) && used.count >= PUTTER_LIMITS.perDay) {
      return {
        ok: false,
        error: {
          code: "rate_limited",
          message: `You've puttered ${PUTTER_LIMITS.perDay} times today, the most in one day. Try again after midnight UTC.`,
          retryAfter: Math.ceil(((used.day + 1) * DAY_MS - now) / 1000),
        },
      };
    }
    const wait = used.at + PUTTER_LIMITS.secondsBetween * 1000 - now;
    if (wait > 0) {
      const seconds = Math.ceil(wait / 1000);
      return {
        ok: false,
        error: {
          code: "rate_limited",
          message: `You puttered a moment ago. Try again in ${seconds} ${seconds === 1 ? "second" : "seconds"}.`,
          retryAfter: seconds,
        },
      };
    }
    return undefined;
  }

  /** Wave at the nearest online resident within earshot who can take one. Their id, or null. */
  private greetNearby(residentId: string): string | null {
    const me = this.state.residents[residentId];
    if (!me) return null;
    const near = Object.values(this.state.residents)
      .filter((r) => r.online && r.id !== residentId && withinEarshot(me, r))
      .sort((a, b) => chebyshev(me, a) - chebyshev(me, b) || (a.id < b.id ? -1 : 1))
      .slice(0, PUTTER_GREET_TRIES);
    for (const r of near) {
      try {
        if (this.greet(residentId, r.id)) return r.id;
      } catch (err) {
        // The walk already happened; a failed wave shouldn't turn it into an error.
        report(err, "world.putter_greet", { command: "putter" });
        return null;
      }
    }
    return null;
  }

  private chat(residentId: string, raw: string, channel: ChatChannel = "nearby"): ActResult {
    const r = this.state.residents[residentId];
    if (!r?.online)
      return { ok: false, error: { code: "not_joined", message: "Join the world first." } };
    const text = cleanText(raw);
    if (text === "")
      return { ok: false, error: { code: "bad_request", message: "Empty message." } };
    const refused = filtered(this.moderation, "chat", text, { resident: residentId });
    if (refused) return refused;
    const message: ServerMessage = {
      type: "chat",
      trust: "untrusted",
      from: { id: r.id, name: r.name, kind: r.kind },
      text,
      channel,
      seq: this.state.seq,
    };
    // Only residents with a live connection receive chat: online, and nearby unless it's `world`.
    // The speaker always gets their own message back.
    let heard = 0;
    for (const [id, set] of this.listeners) {
      const other = this.state.residents[id];
      if (!other?.online) continue;
      if (channel === "nearby" && !withinEarshot(r, other)) continue;
      if (id !== residentId) heard++;
      for (const listener of set) listener(message);
    }
    return { ok: true, seq: this.state.seq, events: [], heard };
  }

  /**
   * The only path that changes the world. Order matters: check, persist, then commit. If the
   * write fails, the world is untouched, so memory never gets ahead of the log.
   */
  private run(input: Input, dry = false): ActResult {
    const command = input.command.type;
    if (dry) {
      const result = this.check(input);
      count("world.dry_run", { command, outcome: result.ok ? "ok" : result.error.code });
      return result;
    }
    return span(
      "world.run",
      "sim",
      () => {
        const result = this.runTraced(input);
        const outcome = result.ok ? "ok" : result.error.code;
        crumb("world", command, { outcome });
        count("world.command", { command, outcome });
        return result;
      },
      { command },
    );
  }

  /**
   * A dry run: the sim's checks and nothing else. A resident marked offline (idle, or signed out
   * elsewhere) is checked as if they had come back, the way a real call would bring them back,
   * against a view of the world (`asJoined`) that leaves this one untouched.
   */
  private check(input: Input): ActResult {
    const prepared = prepare(asJoined(this.state, input.actor), input);
    if (!prepared.ok) return { ok: false, error: prepared.rejection };
    return {
      ok: true,
      seq: this.state.seq,
      events: [],
      ...planOf(prepared),
      ...priceOf(input.command),
    };
  }

  private runTraced(input: Input): ActResult {
    const prepared = prepare(this.state, input);
    if (!prepared.ok) return { ok: false, error: prepared.rejection };
    try {
      this.store.appendInput(input);
    } catch (err) {
      console.error("Failed to persist input; world unchanged", err);
      report(err, "world.persist", { command: input.command.type });
      return { ok: false, error: { code: "internal", message: "Couldn't save that. Try again." } };
    }
    // Who walks: the actor, or the away resident a routine's step is for.
    const command = input.command;
    const walker = command.type === "routine_step" ? command.resident : input.actor;
    const was = this.state.residents[walker];
    // Who a retirement takes out that was a person, read before the commit forgets them.
    const people = new Set(
      command.type === "retire_repeat_joins"
        ? command.ids.filter((id) => residentById(this.state, id)?.kind === "human")
        : [],
    );
    let at = was && { x: was.x, y: was.y };
    const { seq, events } = prepared.commit();
    let walked = false;
    for (const e of events) {
      // Coming back with the action can move them first (their spot was built on).
      if (e.type === "joined" && e.resident.id === walker) {
        at = { x: e.resident.x, y: e.resident.y };
        this.routineSteps.delete(walker);
        continue;
      }
      if (e.type !== "moved" || e.residentId !== walker || !at) continue;
      walked = true;
      const dir = facingFrom(e.x - at.x, e.y - at.y);
      if (dir) this.facing.set(e.residentId, dir);
      at = { x: e.x, y: e.y };
    }
    if (command.type === "routine_step") {
      this.routineSteps.set(walker, { routine: command.routine, at: this.now() });
    }
    this.facts.note(input, this.state.day ?? 0);
    for (const e of events) {
      if (e.type === "admired") this.onAdmired?.(e.by, e.maker, this.state.day ?? 0);
      if (e.type === "event_ended") {
        const ended = findEvent(this.state, e.event);
        try {
          if (ended) this.onEventEnded?.(ended, this.state.day ?? 0);
        } catch (err) {
          // The world already moved on; the hosting record misses this one.
          report(err, "world.event_ended", { command: input.command.type });
        }
      }
      if (e.type === "pet_treated") this.onPetTreated?.(e.residentId, e.by, e.kind);
      if (e.type === "repeat_joins_retired") this.forgetRetired(e.ids, people);
      if (e.type === "resident_merged") this.forgetMerged(e.from, e.into);
      if (e.type === "recipe_learned" && e.how === "taught" && e.from) {
        try {
          this.onRecipeTaught?.(e.residentId, e.from, e.recipe);
        } catch (err) {
          // The lesson stands; the learner's notice misses it.
          report(err, "world.recipe_taught", { command: input.command.type });
        }
      }
      if (e.type === "trick_or_treated") {
        const plot = own(this.state.plots, plotKey(e.px, e.py));
        const residents = plot ? [plot.ownerId, ...(plot.coOwners ?? [])] : [];
        try {
          this.onTrickOrTreated?.(e.by, { px: e.px, py: e.py }, residents);
        } catch (err) {
          // The candy moved; the owner's notice misses this knock.
          report(err, "world.trick_or_treated", { command: input.command.type });
        }
      }
    }
    const wire = holdBackNames(toWire(events, this.state.townsfolk), this.noteHidden);
    for (const event of publicEvents(wire)) this.broadcast({ type: "event", seq, event });
    // Purse moves and inventory changes go only to their owner (purses and inventories are
    // private).
    for (const event of wire) {
      if (!isPrivate(event)) continue;
      this.notify(event.residentId, { type: "event", seq, event });
      // A lesson's teacher hears it too (RFC 0024): they were there.
      if (event.type === "recipe_learned" && event.from && event.from !== event.residentId) {
        this.notify(event.from, { type: "event", seq, event });
      }
    }
    try {
      this.onCommitted?.(input, events);
    } catch (err) {
      report(err, "world.on_committed", { command: input.command.type });
    }
    // Someone here walked: an away neighbor's routine may wave at them.
    if (walked && walker === input.actor && this.state.residents[walker]?.online) {
      try {
        this.onWalked?.(walker);
      } catch (err) {
        report(err, "world.walked", { command: command.type });
      }
    }
    return {
      ok: true,
      seq,
      events: eventsFor(wire, input.actor),
      ...planOf(prepared),
      ...priceOf(command),
    };
  }

  // ---------- presence ----------

  socketOpened(residentId: string) {
    this.sockets.set(residentId, (this.sockets.get(residentId) ?? 0) + 1);
    this.touch(residentId);
  }

  socketClosed(residentId: string) {
    const left = (this.sockets.get(residentId) ?? 1) - 1;
    if (left > 0) {
      this.sockets.set(residentId, left);
      return;
    }
    this.sockets.delete(residentId);
    this.leave(residentId);
  }

  /** Mark residents offline if they have no socket and haven't called the API recently. */
  sweepIdle() {
    const cutoff = this.now() - this.idleTimeoutMs;
    this.takeOffline(
      Object.values(this.state.residents)
        .filter((r) => r.online && !this.sockets.has(r.id))
        .filter((r) => (this.lastSeen.get(r.id) ?? 0) < cutoff)
        .map((r) => r.id),
    );
    // Forget offline residents so this map stays the size of the online population.
    for (const id of this.lastSeen.keys()) {
      if (!this.state.residents[id]?.online) this.lastSeen.delete(id);
    }
    // Routine steps older than the drawing's window no longer show anyone out on a routine.
    const awake = this.now() - ROUTINE_LIMITS.awakeMinutes * 60_000;
    for (const [id, step] of this.routineSteps) if (step.at < awake) this.routineSteps.delete(id);
    // Putters from before today no longer limit anything.
    const today = utcDay(this.now());
    const { facts } = this;
    for (const [id, used] of facts.putters) if (used.day < today) facts.putters.delete(id);
    // Gifts and votes older than karma's window no longer count.
    const from = today - KARMA.windowDays;
    if ((facts.credits[0]?.day ?? from) < from) {
      facts.credits = facts.credits.filter((c) => c.day >= from);
    }
  }

  /**
   * Take residents offline: one `leave_idle` for them all once the world has implicit presence
   * (RFC 0014), else a `leave` each.
   */
  private takeOffline(ids: string[]) {
    if (ids.length === 0) return;
    if (!this.state.implicitPresence) {
      for (const id of ids) this.leave(id);
      return;
    }
    const done = this.run({ actor: TOWN_ACTOR, command: { type: "leave_idle", ids: ids.sort() } });
    if (!done.ok) {
      report(new Error(`leave_idle refused: ${done.error.code}`), "world.leave_idle", {
        command: "leave_idle",
      });
    }
  }

  // ---------- snapshots (RFC 0014) ----------

  /**
   * Save the world as it is now, with the server's facts, when the store keeps snapshots. Only for
   * a world that counts days, whose join days come from the log alone, and whose log rows line up
   * with its `seq`. A failure is reported and changes nothing.
   */
  takeSnapshot(): SnapshotHeader | { refused: "not_kept" | "taken" | "supply" | "failed" } {
    const snapshots = this.store.snapshots;
    if (!snapshots || !this.snapshotsKept()) return { refused: "not_kept" };
    if (this.snapshotAt === this.state.seq) return { refused: "taken" };
    if (!supplyHolds(this.state)) {
      // It would never pass a boot's checks. Say so instead of writing it.
      report(new Error("Coin supply doesn't add up; no snapshot taken"), "world.snapshot");
      return { refused: "supply" };
    }
    try {
      return span(
        "world.snapshot",
        "world.snapshot",
        () => {
          const today = utcDay(this.now());
          const server = this.facts.section(today, today - KARMA.windowDays);
          const { header, parts } = encodeSnapshot(this.state, this.hash(), server);
          snapshots.save(header, parts, prunable([header, ...snapshots.list()]));
          this.snapshotAt = header.seq;
          gauge("world.snapshot_bytes", header.bytes);
          return header;
        },
        { seq: this.state.seq },
      );
    } catch (err) {
      report(reportable(err), "world.snapshot");
      return { refused: "failed" };
    }
  }

  /** Whether this world takes snapshots: it keeps them, counts days, and its log rows line up. */
  snapshotsKept(): boolean {
    return this.store.snapshots !== undefined && this.days && this.aligned;
  }

  /** Every stored snapshot's header, newest first, for staff. */
  snapshotHeaders(): SnapshotHeader[] {
    return this.store.snapshots?.list() ?? [];
  }

  /**
   * One page of the input log for staff (RFC 0014): rows after `after`, up to `until` (at most the
   * world's `seq` now), at most `limit` of them and about `LOG_PAGE_BYTES` of JSON, with the
   * world's `seq` and `hash` as it is now and the sim's `REPLAY_VERSION`.
   */
  logPage(after: number, until: number | undefined, limit: number) {
    const seq = this.state.seq;
    const last = Math.min(until ?? seq, seq);
    const end = Math.min(last, after + limit);
    const { rows, full } = pageRows(this.store, after, end);
    // A page that filled up goes on after its last row; any other, after `end`.
    const stop = full ? (rows.at(-1)?.seq ?? end) : end;
    return {
      seq,
      hash: this.hash(),
      replayVersion: REPLAY_VERSION,
      ...(this.verified ? { snapshot: { ...this.verified } } : {}),
      rows,
      ...(stop < last ? { next: stop } : {}),
    };
  }

  /**
   * The minute sweep's snapshot work: take one when the log has grown `SNAPSHOT_TAIL` inputs past
   * the newest, then replay one slice toward verifying the oldest unverified one.
   */
  keepSnapshots() {
    if (this.state.seq - this.snapshotAt >= SNAPSHOT_TAIL) this.takeSnapshot();
    if (!this.verifier || !this.aligned) return;
    try {
      const passed = this.verifier.step();
      if (passed && passed.seq > (this.verified?.seq ?? -1)) {
        this.verified = { seq: passed.seq, hash: passed.hash };
      }
    } catch (err) {
      report(reportable(err), "world.snapshot_verify");
    }
  }

  /** The newest verified snapshot's `seq` and world hash, if there is one. */
  snapshotInfo(): { seq: number; hash: string } | undefined {
    return this.verified;
  }

  private touch(residentId: string) {
    this.lastSeen.set(residentId, this.now());
  }

  // ---------- views ----------

  subscribe(residentId: string, listener: Listener): () => void {
    let set = this.listeners.get(residentId);
    if (!set) {
      set = new Set();
      this.listeners.set(residentId, set);
    }
    set.add(listener);
    return () => {
      set.delete(listener);
      // Only drop the entry if it's still ours: a newer socket may have made a fresh set.
      if (set.size === 0 && this.listeners.get(residentId) === set) {
        this.listeners.delete(residentId);
      }
    };
  }

  /**
   * Send a message to every world socket that isn't part of the world's history: someone patted a
   * pet (RFC 0019). Nothing here is logged, and it carries no `seq`.
   */
  announce(message: Extract<ServerMessage, { type: "pet_patted" }>) {
    this.broadcast(message);
  }

  /** Send a message to one resident's open sockets only, like a gesture meant for them. */
  notify(residentId: string, message: ServerMessage) {
    for (const listener of this.listeners.get(residentId) ?? []) listener(message);
  }

  private broadcast(message: ServerMessage) {
    for (const set of this.listeners.values()) for (const listener of set) listener(message);
  }

  /** Notes held back from view (a quarantine, RFC 0006): the snapshot shows them empty. */
  noteHidden: (residentId: string) => boolean = () => false;

  hash(): string {
    if (this.hashed.seq !== this.state.seq) {
      this.hashed = { seq: this.state.seq, hash: hashWorld(this.state) };
    }
    return this.hashed.hash;
  }

  /** Residents online, leaving out the townsfolk like `residents` in the snapshot. */
  onlineCount(): number {
    return Object.values(this.state.residents).filter(
      (r) => r.online && !isTownsfolk(this.state, r.id),
    ).length;
  }

  snapshot(): WorldSnapshot {
    return worldSnapshot(this.state, {
      nowMs: this.now(),
      hash: this.hash(),
      facing: this.facing,
      routineSteps: this.routineSteps,
      noteHidden: (id) => this.noteHidden(id),
      repeatJoins: repeatJoins(this.state, (r) => this.untouched(r)),
    });
  }

  /**
   * Everyone who used their record outside the world (posts, follows, a handle, links, and the
   * rest in `socialUsers` in repeat-joins.ts). `Api` wires it; until then no repeat join is retired.
   */
  socialUsers: (() => ReadonlySet<string>) | undefined;

  /**
   * Hears each record `retire_repeat_joins` took out of the world, and again at every start, so
   * the social layer forgets it (decision 0230), with the ones that were people, when known (a
   * person's credentials say so in their own words). `Api` wires it.
   */
  onRetired: ((ids: readonly string[], people: ReadonlySet<string>) => void) | undefined;

  /**
   * Hears each record `merge_resident` took out of the world, and again at every start, so the
   * social layer moves what it can to the record that stays and forgets the rest (decision 0239).
   * `Api` wires it.
   */
  onMerged: ((from: string, into: string) => void) | undefined;

  /**
   * The records `retire_repeat_joins` should take out now (issue #46, decision 0230): the
   * snapshot's `repeatJoins` rule, untouched records of a shared name, where untouched also means
   * nothing in `socialUsers`, less any the sim would refuse (`retireProblems`: coins, things, or
   * their id anywhere else in the world, a plot included). Sorted. Undefined until `socialUsers`
   * is wired, so the switch never runs on what the world alone can see.
   */
  repeatJoinsToRetire(): string[] | undefined {
    const used = this.socialUsers?.();
    if (!used) return undefined;
    let ids = repeatJoins(this.state, (r) => this.untouched(r) && !used.has(r.id));
    // Leaving an id out only keeps more namesakes, but check the shorter list again until the sim
    // would take it whole, so the logged input is never refused.
    for (;;) {
      const refused = new Set(retireProblems(this.state, ids).map((p) => p.id));
      if (refused.size === 0) return ids.sort();
      ids = ids.filter((id) => !refused.has(id));
    }
  }

  /**
   * Everything outside the world a retired record held (decision 0230): what `onRetired` clears
   * in the social layer, then its tokens and link key, and what this service keeps about it in
   * memory. Running it again changes nothing, so `Api` runs it at start for every retired id.
   * `people` are the ones that were people: the world no longer knows them after the commit.
   */
  forgetRetired(ids: readonly string[], people: ReadonlySet<string> = new Set()) {
    try {
      this.onRetired?.(ids, people);
    } catch (err) {
      report(err, "world.retired");
    }
    for (const id of ids) this.forgetGone(id);
  }

  /**
   * Everything outside the world a merged record held (decision 0239): what `onMerged` moves or
   * clears in the social layer, then its tokens and link key, and what this service keeps about it
   * in memory. Running it again changes nothing, so `Api` runs it at start for every merged record.
   */
  forgetMerged(from: string, into: string) {
    try {
      this.onMerged?.(from, into);
    } catch (err) {
      report(err, "world.merged");
    }
    this.forgetGone(from);
  }

  /** A record that left the world: its credentials off and its in-memory state dropped. */
  private forgetGone(id: string) {
    if (this.credentials.credentialHashes(id).length > 0) {
      this.credentials.revokeTokens(id);
      this.credentials.revokeLinkKey(id);
    }
    this.facing.delete(id);
    this.routineSteps.delete(id);
    this.builds.delete(id);
    this.lastSeen.delete(id);
    this.sockets.delete(id);
  }

  /**
   * Offline, with no hearth, and nothing accepted since joining but coming and going: a record
   * someone made and never used (decision 0148).
   */
  private untouched(r: Resident): boolean {
    if (r.online || r.hearth !== null) return false;
    const done = this.facts.done.get(r.id) ?? new Set<string>();
    return [...done].every((kind) => kind === "join" || kind === "leave");
  }
}
