import type { FurnitureKind } from "./furniture";
import type { GroundKind } from "./ground";
import type { Crop, GoodKind, ItemKind, MadeKind, ResourceKind, StackKind } from "./items";
import type {
  ExclusiveWear,
  HairColor,
  HairStyle,
  Look,
  Pattern,
  Theme,
  WearItem,
  WearStyle,
} from "./looks";
import type { Pet, PetCoat, PetKind } from "./pets";

/** Stable id for a resident (human or agent). Assigned by the server, opaque to the sim. */
export type ResidentId = string;

export type ResidentKind = "human" | "agent";

/** The way a step goes: along the grid, or one of the four diagonals. */
export type Direction = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

/**
 * What can be placed. The first four are building blocks. `planter` holds a crop, and `kitchen`
 * and `workbench` are stations to craft at (RFC 0005). Those are placed for free. The next four are
 * decor from the town shop (RFC 0008): placing one uses one from your things, and removing it puts
 * it back. `pedestal` (free) and `frame` hold a made thing on display (RFC 0005 step 3). `hay_bale`
 * and `scarecrow` are decor the shop sells in autumn (RFC 0017). The rest are furniture made at a
 * workbench (RFC 0016), held and placed like decor. New kinds go on the end.
 */
export const BLOCK_KINDS = [
  "wood",
  "stone",
  "glass",
  "leaf",
  "planter",
  "kitchen",
  "workbench",
  "lantern",
  "frame",
  "fence",
  "bench",
  "pedestal",
  "hay_bale",
  "scarecrow",
  "table",
  "chair",
  "bookshelf",
  "barrel",
  "signpost",
  "lamp_post",
  "well",
  "stone_wall",
  "campfire",
  "flower_box",
] as const;

/** Blocks bought at the town shop. Each one placed is one fewer in your things. */
export const DECOR_BLOCKS = [
  "lantern",
  "frame",
  "fence",
  "bench",
  "hay_bale",
  "scarecrow",
] as const satisfies readonly (typeof BLOCK_KINDS)[number][];
export type DecorBlock = (typeof DECOR_BLOCKS)[number];

/**
 * Furniture (RFC 0016): made at a workbench from what residents gather and grow
 * (`FURNITURE_RECIPES` in `furniture.ts`), held in your things, and placed and taken up like decor.
 * Every piece blocks walking, like every block. New pieces go on the end, and on the end of
 * `BLOCK_KINDS`.
 */
export const FURNITURE_BLOCKS = [
  "table",
  "chair",
  "bookshelf",
  "barrel",
  "signpost",
  "lamp_post",
  "well",
  "stone_wall",
  "campfire",
  "flower_box",
] as const satisfies readonly (typeof BLOCK_KINDS)[number][];
export type FurnitureBlock = (typeof FURNITURE_BLOCKS)[number];

/** The blocks anyone can place without holding one: everything but decor and furniture. */
export const FREE_BLOCKS = [
  "wood",
  "stone",
  "glass",
  "leaf",
  "planter",
  "kitchen",
  "workbench",
  "pedestal",
] as const satisfies readonly (typeof BLOCK_KINDS)[number][];
export type FreeBlock = (typeof FREE_BLOCKS)[number];

/** The blocks a Town Hall `commons_build` may place: the four building blocks, no stations. */
export const BUILDING_BLOCKS = [
  "wood",
  "stone",
  "glass",
  "leaf",
] as const satisfies readonly (typeof BLOCK_KINDS)[number][];
export type BuildingBlock = (typeof BUILDING_BLOCKS)[number];

/** How a resident looks. Plain color words so agents and humans can pick without a palette. */
export const RESIDENT_COLORS = [
  "sun",
  "sky",
  "leaf",
  "rose",
  "plum",
  "sand",
  "coal",
  "snow",
] as const;
export type ResidentColor = (typeof RESIDENT_COLORS)[number];
export const RESIDENT_SHAPES = ["round", "square", "diamond"] as const;
export type ResidentShape = (typeof RESIDENT_SHAPES)[number];

/** Optional appearance and public note, accepted on join and by the profile command. */
export interface ProfileFields {
  color?: ResidentColor;
  shape?: ResidentShape;
  /** A short public line, e.g. who an agent plays for. Untrusted text. */
  note?: string;
  /** Look fields (RFC 0005). `null` (or `[]` for wear) clears one; absent leaves it alone. */
  theme?: Theme | null;
  pattern?: Pattern | null;
  wear?: WearItem[];
  patternMedia?: string | null;
  homeArt?: string | null;
  homeModel?: string | null;
  /** A style per garment. `null` clears every style; an item set to `null` clears its own. */
  wearStyle?: Partial<Record<WearItem, WearStyle | null>> | null;
  /** A hair style and its color (decision 0074). `null` clears one. */
  hair?: HairStyle | null;
  hairColor?: HairColor | null;
}
export type BlockKind = (typeof BLOCK_KINDS)[number];

export interface Tile {
  x: number;
  y: number;
}

export interface WorldConfig {
  /** World width in tiles. Must be a multiple of plotSize. */
  width: number;
  /** World height in tiles. Must be a multiple of plotSize. */
  height: number;
  /** Side length of a square plot, in tiles. */
  plotSize: number;
  /** How many plots one resident may own at once. */
  maxPlotsPerResident: number;
  /** Max Chebyshev distance (in tiles) at which a resident can place or remove blocks. */
  reach: number;
  /**
   * How many days a plot must have been yours before you can propose and vote in the Town Hall.
   * Absent means the default (3), so worlds made before the Town Hall hash as they always have.
   */
  townEligibleAfterDays?: number;
}

/** A resident. The look fields from `Look` are present only once set. */
export interface Resident extends Look {
  id: ResidentId;
  name: string;
  kind: ResidentKind;
  color: ResidentColor;
  shape: ResidentShape;
  note: string;
  x: number;
  y: number;
  online: boolean;
  /** Home tile on the resident's own plot, or null. `home` returns here. */
  hearth: Tile | null;
  /** Their pet (RFC 0019). Absent until they adopt one, so older logs hash as they did. */
  pet?: Pet;
}

export interface Plot {
  /** Plot coordinates (not tile coordinates). */
  px: number;
  py: number;
  ownerId: ResidentId;
  /**
   * Residents the owner shares this plot with (`share_plot`). They build here as if they owned it.
   * Present only when non-empty, so plots that were never shared hash exactly as they always have.
   */
  coOwners?: ResidentId[];
  /**
   * The day (UTC days since 1970-01-01, from `new_day`) this plot was claimed. Absent on plots
   * claimed before the world counted days, which counts as day 0.
   */
  claimedDay?: number;
  /** The day each co-owner got their share, for shares given while the world counted days. */
  sharedDay?: Record<ResidentId, number>;
  /** Marked a gallery (`set_gallery`): what's on display here is listed on the Galleries page. */
  gallery?: true;
}

export const VOTE_CHOICES = ["yes", "no", "abstain"] as const;
export type VoteChoice = (typeof VOTE_CHOICES)[number];

/**
 * `advisory` and `commons_build` (RFC 0004), and `grant` and `bounty` (RFC 0008 phase 5), which
 * pay from the treasury and are accepted only once bounties are open.
 */
export const PROPOSAL_KINDS = ["advisory", "commons_build", "grant", "bounty"] as const;
export type ProposalKind = (typeof PROPOSAL_KINDS)[number];

/**
 * `queued` waits for a free slot, `open` takes votes, and the rest are final: `passed`, `failed`
 * (quorum met, not more yes than no), `no_quorum`, `withdrawn` by its author, `voided` by a
 * maintainer.
 */
export const PROPOSAL_STATUSES = [
  "queued",
  "open",
  "passed",
  "failed",
  "no_quorum",
  "withdrawn",
  "voided",
] as const;
export type ProposalStatus = (typeof PROPOSAL_STATUSES)[number];

/** One block a `commons_build` proposal places in the Commons. */
export interface PlannedBlock {
  x: number;
  y: number;
  block: BuildingBlock;
}

/** One block a `build` places, at a tile counted from its plot's north-west corner. */
export interface PlanBlock {
  x: number;
  y: number;
  block: BlockKind;
}

/** One path or floor a `build` lays, at a tile counted from its plot's north-west corner. */
export interface PlanGround {
  x: number;
  y: number;
  ground: GroundKind;
}

export interface Proposal {
  /** `t_1`, `t_2`, ... in filing order. */
  id: string;
  author: ResidentId;
  kind: ProposalKind;
  /** Untrusted text, cleaned by the server before it was logged. */
  title: string;
  /** Untrusted text, cleaned by the server before it was logged. */
  text: string;
  /** `commons_build` only: blocks to place. */
  blocks?: PlannedBlock[];
  /** `commons_build` only: Commons blocks to take away. */
  remove?: Tile[];
  /** `grant` and `bounty` only: the coins it pays from the treasury if it passes. */
  amount?: number;
  /** `grant` only: who it pays. */
  to?: ResidentId;
  status: ProposalStatus;
  filedDay: number;
  /** Set when it opens. */
  openedDay?: number;
  /** It closes when this day starts (midnight UTC). */
  closesDay?: number;
  /** Who may vote, fixed when it opened. Sorted. */
  electorate?: ResidentId[];
  votes: Record<ResidentId, VoteChoice>;
  /** Set when it reaches a final status. */
  closedDay?: number;
  /** The maintainer who voided it. */
  voidedBy?: ResidentId;
}

export interface TownState {
  /** The number in the next proposal id. */
  nextId: number;
  /** Every proposal ever filed, in filing order. */
  proposals: Proposal[];
  /** Commons tiles the town built: tile key -> the proposal that built it. */
  built: Record<string, string>;
}

/**
 * The whole world. Plain data only, so it serializes, hashes, and clones cleanly.
 * Keys of the records are canonical strings (see keys.ts).
 */
export interface WorldState {
  config: WorldConfig;
  /** Number of commands accepted so far. Increases by exactly one per accepted command. */
  seq: number;
  residents: Record<ResidentId, Resident>;
  /** Claimed plots only, keyed by plotKey(px, py). */
  plots: Record<string, Plot>;
  /** Placed blocks, keyed by tileKey(x, y). */
  blocks: Record<string, BlockKind>;
  /**
   * The Town Hall and the shop stop walkers, from the server's `solid_buildings` on. Absent until
   * then, so older logs replay as they were made, when residents walked across both.
   */
  solidBuildings?: true;
  /**
   * Paths and floors (RFC 0016), keyed by tileKey(x, y): one per tile, under whatever block stands
   * there. Nobody walks differently for it. Absent until the first `lay` or `build` lays one.
   */
  ground?: Record<string, GroundKind>;
  /**
   * Today, in UTC days since 1970-01-01, from the server's last `new_day`. Absent until the first
   * one, like every Town Hall field below, so a world that never saw a day hashes as it always has.
   */
  day?: number;
  /** Residents the team runs. They never vote or propose. Sorted. */
  townsfolk?: ResidentId[];
  /** The last day each resident did something in the world (any action but join and leave). */
  lastActiveDay?: Record<ResidentId, number>;
  /** The Town Hall (RFC 0004). Absent until the first proposal. */
  town?: TownState;
  /**
   * Owner-linked pairs (a person and their AI, decision 0031), from `set_owner_pairs`,
   * `add_owner_pair`, and `remove_owner_pair`. Each pair is sorted and the list is sorted. Absent
   * until set, and when empty.
   */
  ownerPairs?: [ResidentId, ResidentId][];
  /**
   * The day each current owner pair first appeared, as `[a][b]` with `a < b`. A pair skips the
   * gift caps only from the day after. Pairs that appeared before coins opened, or before the
   * world counted days, are day 0. Present (maybe empty) once any owner-pair command has run.
   */
  ownerPairDays?: Record<ResidentId, Record<ResidentId, number>>;
  /** Maintainers, from `set_maintainers`. Sorted. Absent until set, and when empty. */
  maintainers?: ResidentId[];
  /**
   * Coins (RFC 0008). Absent until `open_economy`, so worlds from before coins hash as they
   * always have. Purses are private: only the treasury is public.
   */
  economy?: EconomyState;
  /**
   * Growing, making, and giving (RFC 0005). Absent until `open_items`, so worlds from before items
   * hash as they always have. Inventories are private, like purses; crops are public.
   */
  items?: ItemsState;
  /**
   * The town shop (RFC 0008, phase 2). Absent until `open_shop`, so worlds from before the shop
   * hash as they always have.
   */
  shop?: ShopState;
  /**
   * The market (RFC 0008, phase 4): residents selling to residents. Absent until `open_market`,
   * so worlds from before it hash as they always have.
   */
  market?: MarketState;
  /**
   * Partner wear each resident may put on (RFC 0007), from the server's `set_entitlements`.
   * Sorted. Absent until the first, and a resident's key goes when their list empties.
   */
  entitlements?: Record<ResidentId, ExclusiveWear[]>;
  /**
   * Bounties (RFC 0008, phase 5): jobs a resident or the town pays for once they're done, with
   * the reward held here until then. Absent until `open_bounties`, so worlds from before it hash
   * as they always have.
   */
  bounties?: BountiesState;
  /**
   * Presence comes with acting (RFC 0014): from the server's `implicit_presence` on, a known
   * resident's command while they're offline brings them back in the same input, as `join` would,
   * so REST and link calls log no separate `join`. Absent until then, so older logs replay as they
   * did.
   */
  implicitPresence?: true;
  /**
   * The routines each resident turned on (RFC 0009), at most one of each kind, in
   * `ROUTINE_KINDS` order. Absent until the first `set_routines`, and a resident's key goes when
   * they turn every routine off.
   */
  routines?: Record<ResidentId, Routine[]>;
  /**
   * What each resident's routines did on the last day one took a step: whether `walk_home` ran,
   * and how many tiles the stroll walked. Absent until the first `routine_step`. Bookkeeping with
   * no event of its own: the step's `moved` events show what happened.
   */
  routineRuns?: Record<ResidentId, RoutineRuns>;
  /**
   * Hosted events (RFC 0010): shows, classes, markets, listening sessions, and gatherings at a
   * place and a time, with attendance counted from logged samples. Absent until the first event is
   * scheduled, so worlds from before events hash as they always have.
   */
  events?: EventsState;
}

/** What kind of event a host puts on (RFC 0010). */
export const EVENT_KINDS = ["show", "class", "market", "listening", "gathering"] as const;
export type EventKind = (typeof EVENT_KINDS)[number];

/** `scheduled` waits for its start, `live` is on now, and `ended` and `cancelled` are final. */
export const EVENT_STATUSES = ["scheduled", "live", "ended", "cancelled"] as const;
export type EventStatus = (typeof EVENT_STATUSES)[number];

/** An event at a place and a time (RFC 0010). */
export interface HostedEvent {
  /** `e_1`, `e_2`, ... from the counter. */
  id: string;
  /** Who hosts it: a resident, or TOWN_ACTOR for a town event. */
  host: ResidentId;
  kind: EventKind;
  /** Untrusted text, cleaned by the server before it was logged. */
  title: string;
  /** Untrusted text, cleaned by the server before it was logged. May be empty. */
  text: string;
  /** The plot it's on, in plot coordinates: the host's own or shared plot, or the Commons. */
  px: number;
  py: number;
  /** The UTC day it starts on, from `startsAt`. */
  day: number;
  /**
   * When it starts, in ms since 1970-01-01 UTC, on a whole minute. The sim compares it only with
   * other events' times, never with a clock: the server logs the start, the samples, and the end.
   */
  startsAt: number;
  minutes: number;
  status: EventStatus;
  /** The day it was scheduled. */
  scheduledDay: number;
  /** Attendance samples taken while it was live. */
  ticks: number;
  /** The last 5-minute mark sampled (1 is 5 minutes in). Absent before the first sample. */
  slot?: number;
  /** How many samples each resident was there for. Dropped once it ends. */
  seen?: Record<ResidentId, number>;
  /** Coins a Commons booking holds until it ends or is cancelled. Absent when none. */
  deposit?: number;
  /** A town event's key from the server's config, so it's logged once. */
  key?: string;
  /** Townsfolk a town event names as its face. Sorted. Absent when none. */
  faces?: ResidentId[];
  /** Who attended, sorted, once it ended. */
  attended?: ResidentId[];
  /** The day it ended or was cancelled. */
  closedDay?: number;
  /** The maintainer who called it off (`void_event`), as the log names them. */
  voidedBy?: string;
}

export interface EventsState {
  /** The number in the next event's id. */
  nextId: number;
  /** Events in the order they were scheduled: every one still to come or live, and recent finished ones. */
  list: HostedEvent[];
}

/**
 * Routines a resident can turn on (RFC 0009), from a fixed menu. The server's runner takes their
 * steps while the resident is offline: `walk_home` goes home once a day at its hour, `stroll`
 * walks a short loop on their own plot, and `greet` waves at residents who come near their hearth
 * (in the social tables, never the sim).
 */
export const ROUTINE_KINDS = ["walk_home", "stroll", "greet"] as const;
export type RoutineKind = (typeof ROUTINE_KINDS)[number];
/** The routines that take steps in the world. `greet` only waves. */
export const STEP_ROUTINES = ["walk_home", "stroll"] as const satisfies readonly RoutineKind[];
export type StepRoutine = (typeof STEP_ROUTINES)[number];

/** A routine turned on. `hour` is a UTC hour, 0 to 23; `max` is how many residents a day. */
export type Routine =
  | { kind: "walk_home"; hour: number }
  | { kind: "stroll"; hour: number }
  | { kind: "greet"; max: number };

/** What a resident's routines did on `day`. */
export interface RoutineRuns {
  day: number;
  /** `walk_home` ran. */
  walk_home?: true;
  /** Tiles the stroll walked. */
  stroll?: number;
}

/**
 * What one `routine_step` does as its resident: `home` for `walk_home`, and for `stroll` one leg of
 * the walk, its steps checked like a `putter`'s.
 */
export type RoutineStep = { type: "home" } | { type: "putter"; steps: Direction[] };

/**
 * `open` waits for someone to take it, `claimed` is being worked on, `done` is the claimant
 * saying it's finished, and the rest are final: `paid`, `cancelled` (by its poster or a
 * maintainer), and `expired`.
 */
export const BOUNTY_STATUSES = ["open", "claimed", "done", "paid", "cancelled", "expired"] as const;
export type BountyStatus = (typeof BOUNTY_STATUSES)[number];

/** A job someone pays for when it's done. Its reward is held here until it pays or ends. */
export interface Bounty {
  /** `b_1`, `b_2`, ... from the counter. */
  id: string;
  /** Who posted it, or for a town bounty, who proposed it. */
  poster: ResidentId;
  /** A town bounty's proposal. Its reward came from the treasury and a maintainer confirms it. */
  proposal?: string;
  /**
   * A passed Town Hall grant: held for its resident (`claimant`) from the start, marked done, and
   * paid once a maintainer releases it. Never open to claims.
   */
  grant?: true;
  /** Untrusted text, cleaned by the server before it was logged. */
  title: string;
  /** Untrusted text, cleaned by the server before it was logged. May be empty. */
  text: string;
  reward: number;
  status: BountyStatus;
  postedDay: number;
  /** An open or claimed bounty expires when this day starts. */
  expiresDay: number;
  /** Who is working on it, while it's claimed or done, and who was paid. */
  claimant?: ResidentId;
  claimedDay?: number;
  /** When the claimant said it was done. */
  doneDay?: number;
  /** When it reached a final status. */
  closedDay?: number;
  /** The maintainer who confirmed a town bounty or voided a bounty. */
  by?: string;
}

export interface BountiesState {
  /** The number in the next bounty's id. */
  nextId: number;
  /** Bounties in posting order: every one still running, and the newest finished ones. */
  list: Bounty[];
}

/** Something a resident put up for sale. The things are held here, in escrow, until it ends. */
export interface Listing {
  /** `l_1`, `l_2`, ... from the market's counter. */
  id: string;
  seller: ResidentId;
  kind: ItemKind;
  /** How many in the lot. The price is for the whole lot. */
  count: number;
  /** The made things in the lot, with their makers and labels. Absent for things that stack. */
  goods?: Good[];
  price: number;
  /** The day it was listed. */
  day: number;
  /**
   * Staff took it down while the seller's things were full, so the lot waits here, out of the
   * market, until the seller takes it back with `unlist_item`. Absent on every open listing.
   */
  takenDown?: true;
}

export interface MarketState {
  /** The number in the next listing's id. */
  nextId: number;
  /** Open listings by id. */
  listings: Record<string, Listing>;
}

export interface ShopState {
  /** Shop wear each resident bought. Theirs to wear for good. Sorted. Absent until their first. */
  wardrobe: Record<ResidentId, WearItem[]>;
  /** Today's counters for the town's buy orders. Reset at each `new_day`. */
  today: ShopToday;
  /**
   * The treasury's share of shop spending, in percent, from the last `set_shop_share`. Absent
   * until one, meaning the share the shop opened with (50).
   */
  treasuryShare?: number;
}

export interface ShopToday {
  /** What each resident sold to the town today, by kind. */
  sold: Record<ResidentId, Partial<Record<ItemKind, number>>>;
}

/** A made thing. It keeps its maker and the day it was made wherever it goes. */
export interface Good {
  /** `i_1`, `i_2`, ... from the world's counter. */
  id: string;
  kind: MadeKind;
  maker: ResidentId;
  madeDay: number;
  /**
   * The maker's label, or a piece's title. Untrusted text, cleaned by the server before it was
   * logged.
   */
  label?: string;
  /** A piece only: the maker's upload it shows (`m_...`, served at `/media/<id>`). */
  media?: string;
  /** A piece only: the upload is a `.glb` model, not a picture. */
  model?: true;
  /** How many times residents admired it on display, wherever it went since. Absent at 0. */
  admired?: number;
}

/** A made thing on a `pedestal` or a `frame`, out of its holder's things until it's taken down. */
export interface Display {
  good: Good;
  /** Who put it up. It goes back to them when it's taken down. */
  by: ResidentId;
  /** The day it went up. */
  day: number;
}

/** What one resident holds. */
export interface Inventory {
  /** Counts of things that stack. A kind at 0 is absent. */
  stacks: Partial<Record<StackKind, number>>;
  /** Made things, in the order they arrived. */
  goods: Good[];
}

/** A crop in a planter. */
export interface Planting {
  crop: Crop;
  /** Who planted it. Anyone who can build on the plot may harvest it. */
  by: ResidentId;
  plantedDay: number;
  /** It's ready once this day starts. */
  readyDay: number;
}

export interface ItemsToday {
  /** Things each resident gave today, outside owner pairs. */
  given: Record<ResidentId, number>;
  /** Things each resident received in gifts today, outside owner pairs. */
  received: Record<ResidentId, number>;
  /** Things each resident made today. */
  crafted: Record<ResidentId, number>;
  /** The made things each resident admired today, by id. Absent until the day's first admire. */
  admired?: Record<ResidentId, string[]>;
}

/**
 * A gift its recipient may still send back (`decline_gift`). Kept for `ITEMS.declineDays` days,
 * from `open_gifts` on, and dropped when it's sent back.
 */
export interface GiftRecord {
  /** `gift_1`, `gift_2`, ... from `items.nextGift`. */
  id: string;
  from: ResidentId;
  to: ResidentId;
  kind: ItemKind;
  count: number;
  /** The made things' ids. Absent for things that stack. */
  goods?: string[];
  /** The day it was given. */
  day: number;
}

export interface ItemsState {
  /** The number in the next made thing's id. */
  nextId: number;
  /** Each resident's things. Absent until they first hold something. */
  inventories: Record<ResidentId, Inventory>;
  /** Crops growing in planters, keyed by tileKey(x, y). */
  crops: Record<string, Planting>;
  /** The last day each resident had the pantry. Absent until their first. */
  pantry: Record<ResidentId, number>;
  /** Today's counters for the daily caps. Reset at each `new_day`. */
  today: ItemsToday;
  /**
   * Gifts that can still be sent back, by id. Absent until `open_gifts`, so worlds from before it
   * hash as they always have.
   */
  gifts?: Record<string, GiftRecord>;
  /** The number in the next gift's id. Set with `gifts`. */
  nextGift?: number;
  /** Made things on display, keyed by tileKey(x, y). Absent until the first `display`. */
  displays?: Record<string, Display>;
  /**
   * Tiles picked clean today, by tileKey(x, y) to the day they were gathered. Absent until the
   * first `gather`, so worlds from before gathering replay as they always have. `new_day`
   * forgets yesterday's, since each tile grows one pickup back a day.
   */
  gathered?: Record<string, number>;
  /**
   * On a claimed plot, only its owner and co-owners may `gather`. Absent until the server logs
   * `own_plot_pickups`, so gathers logged before it replay as they were made.
   */
  plotPickupsOwned?: true;
  /**
   * Things taken down from display while whoever put them up had no room for them, oldest first.
   * Each waits for `by` and comes back with their first input that leaves room for it. Absent
   * until the first one.
   */
  heldAside?: Display[];
}

/** Why an inventory changed. */
export const INVENTORY_REASONS = [
  /** The first pantry: starter seeds and staples. */
  "starter",
  /** The daily pantry: sugar and jars. */
  "pantry",
  "plant",
  "harvest",
  /** A fallen branch or a loose stone, picked up with `gather`. */
  "gather",
  "craft",
  "gift_in",
  "gift_out",
  /** Bought at the town shop. */
  "bought",
  /** Sold to the town. */
  "sold",
  /** A decor or furniture block placed in the world. */
  "placed",
  /** A decor or furniture block taken back up. */
  "picked_up",
  /** Put up for sale in the market, so held there until it sells or is taken back. */
  "listed",
  /** Taken back from the market unsold. */
  "unlisted",
  /** Bought from another resident in the market. */
  "market",
  /** Back because staff took a listing or a display down. */
  "taken_down",
  /** A gift you sent back to its giver. */
  "declined",
  /** A gift of yours that its recipient sent back. */
  "returned",
  /** Put on display on a pedestal or a frame. */
  "displayed",
  /** Taken down from display, back into your things. */
  "off_display",
  /** Held aside for you while your things were full, and back now that they have room. */
  "held",
  /** What a path or floor took, laid with `lay` (RFC 0016). */
  "laid",
  /** What a lifted path or floor gave back. */
  "lifted",
  /** A plan built with `build`: what it used and gave back, net. */
  "built",
  /** Given to a pet as a treat (RFC 0019). */
  "treat",
] as const;
export type InventoryReason = (typeof INVENTORY_REASONS)[number];

/** Why coins moved. Every ledger line and coin event carries one. */
export const COIN_REASONS = [
  /** The treasury's opening balance, minted by `open_economy`. */
  "opening",
  /** The treasury's daily mint at `new_day`. */
  "mint",
  /** Minted the first time each day a resident stands on their own hearth. */
  "allowance",
  /** Minted on top of the allowance on a streak of days in a row. */
  "streak",
  /** From the treasury, for a resident's first plot. */
  "welcome",
  "gift_in",
  "gift_out",
  /** A townsfolk resident's daily budget, from the treasury. */
  "budget",
  /** A townsfolk resident's unspent coins, back to the treasury at `new_day`. */
  "budget_return",
  /** Spent at the town shop. A small share goes to the treasury and the rest is burned. */
  "shop",
  /** Paid by the town for something sold to it. Minted. */
  "sold",
  /** Minted for residents who reacted to your posts on a day, logged by `daily_awards`. */
  "appreciation",
  /** The fee for putting something up in the market. Burned. */
  "listing_fee",
  /** Paid to another resident for something in the market. */
  "market_buy",
  /** Paid for something you sold in the market, less the market fee. */
  "market_sale",
  /** The market's share of a sale, to the treasury. */
  "market_fee",
  /** Out of a purse, or the treasury, into a bounty until it pays or ends. */
  "bounty_held",
  /** Back from a bounty that was cancelled or expired, to its poster or the treasury. */
  "bounty_returned",
  /** Paid for a bounty you finished. */
  "bounty",
  /** From the treasury, by a passed Town Hall grant. */
  "grant",
  /** Out of a purse and held while an event in the Commons is booked (RFC 0010). */
  "event_deposit",
  /** A Commons booking's deposit back: enough people came, or it was cancelled in time. */
  "event_refund",
  /** A new coat for your pet (RFC 0019). Burned. */
  "groom",
] as const;
export type CoinReason = (typeof COIN_REASONS)[number];

/** One movement in a purse or the treasury. */
export interface LedgerLine {
  /** The `seq` of the input that moved the coins. */
  seq: number;
  day: number;
  /** Positive in, negative out. */
  amount: number;
  reason: CoinReason;
  /** The other resident: who gave or got the gift, or who the treasury paid. */
  with?: ResidentId;
  /** A gift's note. Untrusted text, cleaned by the server before it was logged. */
  note?: string;
}

export interface EconomyState {
  /** The town's own coins. Never negative. */
  treasury: number;
  /**
   * Every coin ever made. `sum(coins) + treasury + bountyHeld + eventHeld == minted - burned`,
   * always.
   */
  minted: number;
  /** Every coin ever destroyed: most of what's spent at the town shop. */
  burned: number;
  /** Each resident's purse. Absent means 0. */
  coins: Record<ResidentId, number>;
  /** Each resident's last `ledgerMax` ledger lines, oldest first. */
  ledgers: Record<ResidentId, LedgerLine[]>;
  /** The treasury's last `ledgerMax` ledger lines, oldest first. */
  treasuryLedger: LedgerLine[];
  /** The last day each resident got their allowance, and how many days in a row that makes. */
  allowance: Record<ResidentId, { day: number; streak: number }>;
  /**
   * Residents who had their welcome gift, or a plot when the economy opened, so they never get
   * one. Sorted.
   */
  welcomed: ResidentId[];
  /**
   * Residents owed a welcome gift the treasury couldn't pay in full when they settled, in the order
   * they settled. Paid in that order at `new_day`, before townsfolk budgets.
   */
  owed: ResidentId[];
  /** Today's counters for the gift caps. Reset at each `new_day`. */
  today: EconomyToday;
  /** The last day `daily_awards` paid for. Absent until the first. */
  awardedDay?: number;
}

export interface EconomyToday {
  /** Coins each resident gave today, outside owner pairs. */
  given: Record<ResidentId, number>;
  /** Coins each resident received in gifts today, outside owner pairs. */
  received: Record<ResidentId, number>;
  /** Coins each resident got from townsfolk today. */
  fromTownsfolk: Record<ResidentId, number>;
  /** Residents who first joined the world today. They can receive gifts but not give. Sorted. */
  newcomers: ResidentId[];
}

export type Command =
  | ({ type: "join"; name: string; kind: ResidentKind } & ProfileFields)
  | ({ type: "profile" } & ProfileFields)
  | { type: "leave" }
  | { type: "move"; dir: Direction }
  /**
   * A short walk, up to `PUTTER.steps` moves. Residents send `putter` with no steps; the server
   * fills them in from `planPutter` before logging, so replay never runs the planner.
   */
  | { type: "putter"; steps: Direction[] }
  | { type: "claim" }
  | { type: "release" }
  | { type: "set_hearth"; x: number; y: number }
  | { type: "home" }
  | { type: "place"; x: number; y: number; block: BlockKind }
  | { type: "remove"; x: number; y: number }
  /** Lay a path or floor on a tile, within reach (RFC 0016). */
  | { type: "lay"; x: number; y: number; ground: GroundKind }
  /** Lift the path or floor off a tile, within reach. What it took comes back. */
  | { type: "lift"; x: number; y: number }
  /**
   * A plan built on plot (px, py) in one input, from anywhere (RFC 0016): `remove` and `lift` go
   * first, then `blocks`, then `ground`. Tiles count from the plot's north-west corner.
   */
  | {
      type: "build";
      px: number;
      py: number;
      blocks?: PlanBlock[];
      ground?: PlanGround[];
      remove?: Tile[];
      lift?: Tile[];
    }
  | { type: "settle"; px: number; py: number }
  | { type: "build_starter_home"; walls?: BlockKind; windows?: BlockKind }
  | { type: "share_plot"; with: ResidentId }
  | { type: "unshare_plot"; with: ResidentId }
  | {
      type: "propose";
      kind: ProposalKind;
      title: string;
      text: string;
      blocks?: PlannedBlock[];
      remove?: Tile[];
      /** `grant` and `bounty`: the coins it pays from the treasury. */
      amount?: number;
      /** `grant`: who it pays. */
      to?: ResidentId;
    }
  | { type: "vote"; proposal: string; choice: VoteChoice }
  | { type: "withdraw"; proposal: string }
  /** `note` is untrusted text the server cleaned before logging it. */
  | { type: "give_coins"; to: ResidentId; amount: number; note?: string }
  // Growing, making, and giving (RFC 0005). `label` and `note` are untrusted text the server
  // cleaned before logging it.
  | { type: "plant"; x: number; y: number; seed: Crop }
  | { type: "harvest"; x: number; y: number }
  /** Pick up a fallen branch or a loose stone on the tile, within reach. */
  | { type: "gather"; x: number; y: number }
  /** A good (signed, with an id) or a piece of furniture (it stacks, and takes no label). */
  | { type: "craft"; recipe: GoodKind | FurnitureKind; x: number; y: number; label?: string }
  | { type: "give"; item: string; to: ResidentId; count?: number; note?: string }
  /** Send a gift back to whoever gave it, within `ITEMS.declineDays` days. */
  | { type: "decline_gift"; gift: string }
  // Showing (RFC 0005 step 3). `title` is untrusted text the server cleaned; `model` is set by the
  // server from the upload's type.
  | { type: "make_piece"; media: string; title: string; model?: true }
  | { type: "display"; item: string; x: number; y: number }
  | { type: "take_down"; x: number; y: number }
  | { type: "admire"; x: number; y: number }
  | { type: "set_gallery"; px: number; py: number; open: boolean }
  // The town shop (RFC 0008, phase 2).
  | { type: "shop_buy"; sku: string; count?: number }
  | { type: "sell_to_town"; item: string; count?: number }
  /** Turn routines on and off (RFC 0009): the whole list, `[]` for all off. */
  | { type: "set_routines"; routines: Routine[] }
  // The market (RFC 0008, phase 4).
  | { type: "list_item"; item: string; count?: number; price: number }
  | { type: "unlist_item"; listing: string }
  | { type: "buy_listing"; listing: string }
  // Bounties (RFC 0008, phase 5). `title` and `text` are untrusted text the server cleaned.
  | { type: "post_bounty"; title: string; text?: string; reward: number }
  | { type: "claim_bounty"; bounty: string }
  | { type: "drop_bounty"; bounty: string }
  | { type: "complete_bounty"; bounty: string }
  /** The poster pays `to`, who must be the claimant. */
  | { type: "confirm_bounty"; bounty: string; to: ResidentId }
  | { type: "cancel_bounty"; bounty: string }
  // Hosted events (RFC 0010). `title` and `text` are untrusted text the server cleaned. `startsAt`
  // is ms since 1970-01-01 UTC, on a whole minute.
  | {
      type: "schedule_event";
      kind: EventKind;
      title: string;
      text?: string;
      px: number;
      py: number;
      startsAt: number;
      minutes: number;
    }
  | { type: "cancel_event"; event: string }
  /** While it's live: a free tile in the event's area. */
  | { type: "join_event"; event: string }
  // Pets (RFC 0019). `name` is untrusted text the server cleaned before logging it.
  | { type: "adopt_pet"; kind: PetKind; coat: PetCoat; name: string }
  | { type: "rename_pet"; name: string }
  | { type: "groom_pet"; coat: PetCoat }
  /** One of the actor's produce to `owner`'s pet, which is happy until the day ends. */
  | { type: "treat_pet"; owner: ResidentId; item: Crop }
  // Only the server sends these, as TOWN_ACTOR.
  | { type: "new_day"; day: number }
  | { type: "set_townsfolk"; ids: ResidentId[] }
  | { type: "close_proposal"; proposal: string }
  | { type: "void_proposal"; proposal: string; by: ResidentId }
  /**
   * Staff took a listing down (decision 0056). The lot goes back to its seller, or waits in the
   * market out of view when their things are full. Who did it is in the moderation log, not here.
   */
  | { type: "remove_listing"; listing: string }
  /**
   * Staff took a made thing off display, by its id (decision 0059). It goes back to whoever put it
   * up, or is held aside for them when their things are full. With `picture`, the thing is a piece
   * and its picture goes too, from every piece that shows the same upload, wherever it is (and the
   * piece needn't be on display). Who did it is in the moderation log, not here.
   */
  | { type: "remove_display"; item: string; picture?: true }
  | { type: "open_economy" }
  | { type: "set_owner_pairs"; pairs: [ResidentId, ResidentId][] }
  /** One owner pair linked or unlinked, so the log grows by one pair per change, not the list. */
  | { type: "add_owner_pair"; pair: [ResidentId, ResidentId] }
  | { type: "remove_owner_pair"; pair: [ResidentId, ResidentId] }
  | { type: "set_maintainers"; ids: ResidentId[] }
  | { type: "open_items" }
  /** From now on, every gift is kept for a few days so its recipient can send it back. */
  | { type: "open_gifts" }
  /** From now on, only a claimed plot's owner and co-owners may gather on it. */
  | { type: "own_plot_pickups" }
  /** From now on, nobody walks onto the Town Hall or the shop. Anyone on one steps off. */
  | { type: "solid_buildings" }
  | { type: "open_shop" }
  /** The treasury's share of shop spending from now on, in percent; the rest is burned. */
  | { type: "set_shop_share"; percent: number }
  | { type: "open_market" }
  | { type: "open_bounties" }
  /**
   * A maintainer confirms a town bounty is done and pays `to`, who must be the claimant. In these
   * three, `by` is who the maintainer is in the log (a resident id, or an opaque `staff_` id), and
   * `resident`, when the server knows it, is the resident they also are, checked against the
   * bounty's household rule (decision 0062).
   */
  | {
      type: "confirm_town_bounty";
      bounty: string;
      to: ResidentId;
      by: string;
      resident?: ResidentId;
    }
  /** A maintainer cancels a bounty that hasn't paid. Its reward goes back where it came from. */
  | { type: "void_bounty"; bounty: string; by: string; resident?: ResidentId }
  /** A maintainer sends a town bounty's claimant back: it isn't done. It's open again. */
  | { type: "reopen_bounty"; bounty: string; by: string; resident?: ResidentId }
  /** Coins the server counted for a day that has ended, minted once per day (decision 0055). */
  | { type: "daily_awards"; day: number; awards: DailyAward[] }
  /** The partner wear a resident may put on now (RFC 0007). Replaces their whole list. */
  | { type: "set_entitlements"; residentId: ResidentId; items: string[] }
  /** From now on, acting brings a known resident back online in the same input (RFC 0014). */
  | { type: "implicit_presence" }
  /** Everyone in `ids` went idle: each goes offline, as with `leave`. One input per idle sweep. */
  | { type: "leave_idle"; ids: ResidentId[] }
  /**
   * One step of an offline resident's routine, which the server's runner decided to take (RFC
   * 0009). The sim checks that they turned it on, are offline, and haven't used it up today, then
   * runs `step` as them, with every check their own command would meet.
   */
  | { type: "routine_step"; resident: ResidentId; routine: StepRoutine; step: RoutineStep }
  /**
   * The town hosts an event in the Commons (RFC 0010): from the server's own calendar, once, by
   * `key`. No deposit, no host limits, and `faces` may name townsfolk as its face.
   */
  | {
      type: "schedule_town_event";
      key: string;
      kind: EventKind;
      title: string;
      text?: string;
      startsAt: number;
      minutes: number;
      faces?: ResidentId[];
    }
  /** An event's start time came. */
  | { type: "event_start"; event: string }
  /** An attendance sample at the event's `slot`th 5-minute mark. Marks the server missed are skipped. */
  | { type: "event_tick"; event: string; slot: number }
  /** An event's end time came: attendance and the deposit are settled. */
  | { type: "event_end"; event: string }
  /**
   * A maintainer calls off an event that hasn't ended. A Commons deposit goes back. `by` is who the
   * maintainer is in the log, and `resident`, when the server knows it, the resident they also
   * are: one in the host's household is refused, as for bounties (decision 0062).
   */
  | { type: "void_event"; event: string; by: string; resident?: ResidentId };

/** One resident's award in `daily_awards`. */
export interface DailyAward {
  to: ResidentId;
  amount: number;
  reason: "appreciation";
}

export type CommandType = Command["type"];

/**
 * The actor on inputs the server appends itself: day changes, the townsfolk list, closes, voids,
 * opening the economy, and the owner-pair and maintainer lists. No resident has this id (the server's ids look like `r_0123456789abcdef`).
 */
export const TOWN_ACTOR = "town";

/** Commands only TOWN_ACTOR may send. */
export const SERVER_COMMANDS = [
  "new_day",
  "set_townsfolk",
  "close_proposal",
  "void_proposal",
  "open_economy",
  "set_owner_pairs",
  "add_owner_pair",
  "remove_owner_pair",
  "set_maintainers",
  "open_items",
  "open_gifts",
  "own_plot_pickups",
  "solid_buildings",
  "open_shop",
  "set_shop_share",
  "daily_awards",
  "open_market",
  "remove_listing",
  "remove_display",
  "set_entitlements",
  "open_bounties",
  "confirm_town_bounty",
  "void_bounty",
  "reopen_bounty",
  "implicit_presence",
  "leave_idle",
  "routine_step",
  "schedule_town_event",
  "event_start",
  "event_tick",
  "event_end",
  "void_event",
] as const satisfies readonly CommandType[];

/** A command plus who issued it. This is the unit the server logs and replays. */
export interface Input {
  actor: ResidentId;
  command: Command;
}

export type WorldEvent =
  | { type: "joined"; resident: Resident }
  | { type: "left"; residentId: ResidentId }
  | ({
      type: "profile_changed";
      residentId: ResidentId;
      color: ResidentColor;
      shape: ResidentShape;
      note: string;
      /** The whole look after the change: a field that's absent here is unset. */
    } & Look)
  /** `routine` marks a step an offline resident's routine took (RFC 0009). */
  | { type: "moved"; residentId: ResidentId; x: number; y: number; routine?: StepRoutine }
  | { type: "plot_claimed"; px: number; py: number; ownerId: ResidentId }
  | { type: "plot_released"; px: number; py: number; ownerId: ResidentId }
  | { type: "hearth_set"; residentId: ResidentId; x: number; y: number }
  | { type: "block_placed"; x: number; y: number; block: BlockKind; by: ResidentId }
  | { type: "block_removed"; x: number; y: number; by: ResidentId }
  /** A path or floor went down on a tile (RFC 0016). Public. */
  | { type: "ground_laid"; x: number; y: number; ground: GroundKind; by: ResidentId }
  /** The path or floor on a tile was lifted. Public. */
  | { type: "ground_lifted"; x: number; y: number; by: ResidentId }
  | { type: "plot_shared"; px: number; py: number; residentId: ResidentId }
  | { type: "plot_unshared"; px: number; py: number; residentId: ResidentId }
  | { type: "hearth_cleared"; residentId: ResidentId }
  | { type: "day_started"; day: number }
  | { type: "townsfolk_set"; ids: ResidentId[] }
  | { type: "proposal_queued"; proposal: string; author: ResidentId; kind: ProposalKind }
  | {
      type: "proposal_opened";
      proposal: string;
      author: ResidentId;
      kind: ProposalKind;
      closesDay: number;
      electorate: number;
      quorum: number;
    }
  | {
      type: "vote_cast";
      proposal: string;
      residentId: ResidentId;
      choice: VoteChoice;
      yes: number;
      no: number;
      abstain: number;
    }
  | {
      type: "proposal_closed";
      proposal: string;
      status: ProposalStatus;
      yes: number;
      no: number;
      abstain: number;
    }
  | {
      type: "town_built";
      proposal: string;
      placed: PlannedBlock[];
      removed: Tile[];
      skipped: Tile[];
    }
  | { type: "economy_opened"; treasury: number }
  /**
   * Coins moved in or out of one resident's purse. Private: it belongs to `residentId` alone, and
   * the server sends it only to them. A gift makes two, one for each side.
   */
  | {
      type: "coins";
      residentId: ResidentId;
      /** Positive in, negative out. */
      amount: number;
      /** The purse after the move. */
      balance: number;
      reason: CoinReason;
      /** The other side of a gift. */
      with?: ResidentId;
      note?: string;
    }
  /** Coins moved in or out of the treasury. Public, like the treasury's history. */
  | {
      type: "treasury";
      amount: number;
      /** The treasury after the move. */
      balance: number;
      reason: CoinReason;
      /** Who a welcome gift went to. Budgets and their returns are one line for all townsfolk. */
      residentId?: ResidentId;
    }
  | { type: "owner_pairs_set"; pairs: [ResidentId, ResidentId][] }
  | { type: "owner_pair_added"; pair: [ResidentId, ResidentId] }
  | { type: "owner_pair_removed"; pair: [ResidentId, ResidentId] }
  | { type: "maintainers_set"; ids: ResidentId[] }
  /** `implicit_presence` turned on. Stays on the server: clients draw nothing from it. */
  | { type: "implicit_presence_on" }
  | { type: "items_opened" }
  | { type: "gifts_opened" }
  | { type: "plot_pickups_owned" }
  /** `solid_buildings` turned on: the Town Hall and the shop stop walkers from now on. */
  | { type: "buildings_solid" }
  | { type: "shop_opened" }
  | { type: "market_opened" }
  /** Something went up for sale. Public: the market is. Made things carry their makers' labels. */
  | { type: "listed"; listing: Listing }
  /** A listing was taken back unsold. Public. */
  | { type: "unlisted"; listing: string; seller: ResidentId }
  /** Staff took a listing down. Public, like the listing was. */
  | { type: "listing_removed"; listing: string; seller: ResidentId }
  /** A listing sold. Public, without the buyer: what someone buys is theirs to tell. */
  | {
      type: "listing_sold";
      listing: string;
      seller: ResidentId;
      kind: ItemKind;
      count: number;
      price: number;
    }
  | { type: "bounties_opened" }
  /** A bounty opened: a resident's, or the town's from a passed proposal. Public. */
  | { type: "bounty_posted"; bounty: Bounty }
  | { type: "bounty_claimed"; bounty: string; claimant: ResidentId }
  /** A claim ended without pay: the claimant let go, or the poster (or a maintainer) sent them back. */
  | {
      type: "bounty_dropped";
      bounty: string;
      claimant: ResidentId;
      by: "claimant" | "poster" | "maintainer";
    }
  /** The claimant says it's done. It pays once the poster, or a maintainer, confirms. */
  | { type: "bounty_done"; bounty: string; claimant: ResidentId }
  /** A bounty paid its claimant. Public: the town sees who was paid. */
  | { type: "bounty_paid"; bounty: string; claimant: ResidentId; reward: number }
  /** A bounty ended unpaid and its reward went back where it came from. */
  | { type: "bounty_closed"; bounty: string; status: "cancelled" | "expired" }
  /** A passed grant paid its resident from the treasury. Public. */
  | { type: "grant_paid"; proposal: string; to: ResidentId; amount: number }
  /** A passed grant or bounty the treasury couldn't spare (or whose resident can't have it) moved nothing. */
  | { type: "proposal_unpaid"; proposal: string; amount: number }
  /** The treasury's share of shop spending changed. Public, like the treasury. */
  | { type: "shop_share_set"; percent: number }
  /** Shop wear a resident bought. Private, like their purse. */
  | { type: "wear_bought"; residentId: ResidentId; wear: WearItem }
  /** The partner wear a resident may put on now. Public: it's a cosmetic their profile shows. */
  | { type: "entitlements_set"; residentId: ResidentId; items: ExclusiveWear[] }
  /** A resident's routines now, the whole list. Private: it belongs to `residentId` alone. */
  | { type: "routines_set"; residentId: ResidentId; routines: Routine[] }
  /** A seed went into a planter. Public: crops show in the world. */
  | {
      type: "planted";
      x: number;
      y: number;
      crop: Crop;
      by: ResidentId;
      plantedDay: number;
      readyDay: number;
    }
  /** A crop came out of a planter. Public. */
  | { type: "harvested"; x: number; y: number; crop: Crop; by: ResidentId }
  /** Someone picked up a fallen branch or a loose stone. Public. */
  | { type: "gathered"; x: number; y: number; kind: ResourceKind; by: ResidentId }
  /** Someone gave someone a thing. Public, without the count or the note. */
  | { type: "item_given"; from: ResidentId; to: ResidentId; kind: ItemKind }
  /** A made thing went on display. Public: it shows in the world, label and all. */
  | { type: "displayed"; x: number; y: number; good: Good; by: ResidentId }
  /** A displayed thing was taken down by `by`. Public. */
  | { type: "taken_down"; x: number; y: number; by: ResidentId }
  /** Staff took a made thing off display. `by` put it up. Public, like the display was. */
  | { type: "display_removed"; x: number; y: number; item: string; by: ResidentId }
  /** Staff removed these pieces' picture: they keep their titles and show none. Public. */
  | { type: "picture_removed"; items: string[] }
  /** A plot was marked a gallery, or stopped being one, by `by`. Public. */
  | { type: "gallery_set"; px: number; py: number; open: boolean; by: ResidentId }
  /** `by` admired what's on display: the thing, its maker, and its count after. Public. */
  | {
      type: "admired";
      x: number;
      y: number;
      item: string;
      maker: ResidentId;
      by: ResidentId;
      admired: number;
    }
  /**
   * An event went on the calendar (RFC 0010): where and when, never its words (read those from
   * `GET /v1/events`). `host` is TOWN_ACTOR for a town event, which says `town: true` too. Public.
   */
  | {
      type: "event_scheduled";
      event: string;
      host: ResidentId;
      kind: EventKind;
      px: number;
      py: number;
      startsAt: number;
      minutes: number;
      town?: true;
    }
  /** An event is on now. Public. */
  | { type: "event_started"; event: string }
  /** An attendance sample: who was there this time. Stays on the server: clients draw nothing from it. */
  | { type: "event_ticked"; event: string; ticks: number; present: ResidentId[] }
  /** An event ended: who attended (sorted), and what happened to a Commons deposit. Public. */
  | {
      type: "event_ended";
      event: string;
      attended: ResidentId[];
      deposit?: "refunded" | "burned";
    }
  /** An event was called off before it ended, and what happened to a Commons deposit. Public. */
  | { type: "event_cancelled"; event: string; deposit?: "refunded" | "burned" }
  /** A pet came home with `residentId` (RFC 0019). Public: it lives in the world. */
  | { type: "pet_adopted"; residentId: ResidentId; pet: Pet }
  /**
   * `residentId`'s pet has a new name. Public. `day` is the world's day it was renamed, which the
   * once-a-day limit reads: absent in a world that doesn't count days.
   */
  | { type: "pet_renamed"; residentId: ResidentId; name: string; day?: number }
  /** `residentId`'s pet has a new coat. Public. */
  | { type: "pet_groomed"; residentId: ResidentId; coat: PetCoat }
  /** `by` gave `residentId`'s pet a treat of `kind`: it's happy until the day ends. Public. */
  | { type: "pet_treated"; residentId: ResidentId; by: ResidentId; kind: Crop }

  /**
   * One resident's things changed. Private: it belongs to `residentId` alone, and the server sends
   * it only to them. A gift makes two, one for each side.
   */
  | {
      type: "inventory";
      residentId: ResidentId;
      reason: InventoryReason;
      /** Stacks that changed: signed `amount`, and the `count` held after. */
      changes?: { kind: StackKind; amount: number; count: number }[];
      /** Made things that arrived. */
      gained?: Good[];
      /** Ids of made things that left. */
      lost?: string[];
      /** The other side of a gift. */
      with?: ResidentId;
      note?: string;
      /** The gift's id, once gifts can be sent back: `decline_gift` takes it. */
      gift?: string;
    };

export const REJECTION_CODES = [
  "not_joined",
  "already_joined",
  "invalid_name",
  "invalid_profile",
  "out_of_bounds",
  "blocked",
  "plot_is_commons",
  "plot_owned",
  "plot_limit",
  "plot_has_blocks",
  "out_of_reach",
  "not_your_plot",
  "tile_occupied",
  "no_block",
  "no_hearth",
  "already_home",
  "no_plot",
  "unknown_resident",
  "already_shared",
  "share_limit",
  "not_shared",
  "not_eligible",
  "proposal_limit",
  "invalid_proposal",
  "unknown_proposal",
  "proposal_not_open",
  "not_your_proposal",
  "already_voted",
  "server_only",
  "not_due",
  "economy_closed",
  "already_open",
  "invalid_amount",
  "invalid_gift",
  "not_enough_coins",
  "gift_limit",
  "nowhere_to_go",
  "items_closed",
  "unknown_item",
  "no_planter",
  "no_crop",
  "not_ready",
  /** Nothing lies on that tile to pick up: no spawn, already gathered today, or built over. */
  "nothing_to_gather",
  "no_station",
  "not_enough_items",
  "inventory_full",
  "craft_limit",
  "invalid_label",
  "shop_closed",
  "not_buying",
  "sell_limit",
  "already_have",
  "not_owned",
  "market_closed",
  "unknown_listing",
  "own_listing",
  "listing_limit",
  "unknown_gift",
  "invalid_piece",
  "no_display",
  "nothing_displayed",
  "not_entitled",
  "already_admired",
  "bounties_closed",
  "unknown_bounty",
  "invalid_bounty",
  "bounty_not_open",
  "own_bounty",
  "not_your_bounty",
  "bounty_limit",
  "already_set",
  /** The shop sells that only in another season (RFC 0017). */
  "out_of_season",
  /** No path or floor on that tile to lift (RFC 0016). */
  "no_ground",
  /** A `build` plan that doesn't fit: empty, too long, a tile off the plot, or one listed twice. */
  "invalid_plan",
  /** A routine step for a routine its resident hasn't turned on (RFC 0009). */
  "not_set",
  /** A routine step while its resident is in the world: routines run only while they're away. */
  "awake",
  /** That routine already ran today, or the stroll already walked its tiles. */
  "ran_today",
  /** A routine list or a routine step that doesn't fit the menu. */
  "invalid_routine",
  "unknown_event",
  "invalid_event",
  /** Another event is at that place then, or within 15 minutes of it. */
  "event_clash",
  /** A host's limits: events booked at once, or Commons events a week. */
  "event_limit",
  "event_not_live",
  /** It has already started, ended, or been called off. */
  "event_closed",
  "not_your_event",
  /** A pet's kind, coat, or name isn't one the sim takes (RFC 0019). */
  "invalid_pet",
  /** That resident has no pet. */
  "no_pet",
  /** A pet's once-a-day limit: a rename, or a treat. */
  "pet_limit",
] as const;
export type RejectionCode = (typeof REJECTION_CODES)[number];

export interface Rejection {
  code: RejectionCode;
  message: string;
}

export type ApplyResult =
  | { ok: true; seq: number; events: WorldEvent[] }
  | { ok: false; rejection: Rejection };
