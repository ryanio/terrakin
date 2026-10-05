import type { Crop, GoodKind, ItemKind, MadeKind, StackKind } from "./items";
import type { ExclusiveWear, Look, Pattern, Theme, WearItem, WearStyle } from "./looks";

/** Stable id for a resident (human or agent). Assigned by the server, opaque to the sim. */
export type ResidentId = string;

export type ResidentKind = "human" | "agent";

export type Direction = "n" | "s" | "e" | "w";

/**
 * What can be placed. The first four are building blocks. `planter` holds a crop, and `kitchen`
 * and `workbench` are stations to craft at (RFC 0005). Those are placed for free. The next four are
 * decor from the town shop (RFC 0008): placing one uses one from your things, and removing it puts
 * it back. `pedestal` (free) and `frame` hold a made thing on display (RFC 0005 step 3).
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
] as const;

/** Blocks bought at the town shop. Each one placed is one fewer in your things. */
export const DECOR_BLOCKS = [
  "lantern",
  "frame",
  "fence",
  "bench",
] as const satisfies readonly (typeof BLOCK_KINDS)[number][];
export type DecorBlock = (typeof DECOR_BLOCKS)[number];

/** The blocks anyone can place without holding one: everything but decor. */
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
}

export const VOTE_CHOICES = ["yes", "no", "abstain"] as const;
export type VoteChoice = (typeof VOTE_CHOICES)[number];

export const PROPOSAL_KINDS = ["advisory", "commons_build"] as const;
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
}

/** Why an inventory changed. */
export const INVENTORY_REASONS = [
  /** The first pantry: starter seeds and staples. */
  "starter",
  /** The daily pantry: sugar and jars. */
  "pantry",
  "plant",
  "harvest",
  "craft",
  "gift_in",
  "gift_out",
  /** Bought at the town shop. */
  "bought",
  /** Sold to the town. */
  "sold",
  /** A decor block placed in the world. */
  "placed",
  /** A decor block taken back up. */
  "picked_up",
  /** Put up for sale in the market, so held there until it sells or is taken back. */
  "listed",
  /** Taken back from the market unsold. */
  "unlisted",
  /** Bought from another resident in the market. */
  "market",
  /** Back from the market because staff took the listing down. */
  "taken_down",
  /** A gift you sent back to its giver. */
  "declined",
  /** A gift of yours that its recipient sent back. */
  "returned",
  /** Put on display on a pedestal or a frame. */
  "displayed",
  /** Taken down from display, back into your things. */
  "off_display",
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
  /** Every coin ever made. `sum(coins) + treasury == minted - burned`, always. */
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
    }
  | { type: "vote"; proposal: string; choice: VoteChoice }
  | { type: "withdraw"; proposal: string }
  /** `note` is untrusted text the server cleaned before logging it. */
  | { type: "give_coins"; to: ResidentId; amount: number; note?: string }
  // Growing, making, and giving (RFC 0005). `label` and `note` are untrusted text the server
  // cleaned before logging it.
  | { type: "plant"; x: number; y: number; seed: Crop }
  | { type: "harvest"; x: number; y: number }
  | { type: "craft"; recipe: GoodKind; x: number; y: number; label?: string }
  | { type: "give"; item: string; to: ResidentId; count?: number; note?: string }
  /** Send a gift back to whoever gave it, within `ITEMS.declineDays` days. */
  | { type: "decline_gift"; gift: string }
  // Showing (RFC 0005 step 3). `title` is untrusted text the server cleaned; `model` is set by the
  // server from the upload's type.
  | { type: "make_piece"; media: string; title: string; model?: true }
  | { type: "display"; item: string; x: number; y: number }
  | { type: "take_down"; x: number; y: number }
  | { type: "admire"; x: number; y: number }
  // The town shop (RFC 0008, phase 2).
  | { type: "shop_buy"; sku: string; count?: number }
  | { type: "sell_to_town"; item: string; count?: number }
  // The market (RFC 0008, phase 4).
  | { type: "list_item"; item: string; count?: number; price: number }
  | { type: "unlist_item"; listing: string }
  | { type: "buy_listing"; listing: string }
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
  | { type: "open_economy" }
  | { type: "set_owner_pairs"; pairs: [ResidentId, ResidentId][] }
  /** One owner pair linked or unlinked, so the log grows by one pair per change, not the list. */
  | { type: "add_owner_pair"; pair: [ResidentId, ResidentId] }
  | { type: "remove_owner_pair"; pair: [ResidentId, ResidentId] }
  | { type: "set_maintainers"; ids: ResidentId[] }
  | { type: "open_items" }
  /** From now on, every gift is kept for a few days so its recipient can send it back. */
  | { type: "open_gifts" }
  | { type: "open_shop" }
  /** The treasury's share of shop spending from now on, in percent; the rest is burned. */
  | { type: "set_shop_share"; percent: number }
  | { type: "open_market" }
  /** Coins the server counted for a day that has ended, minted once per day (decision 0055). */
  | { type: "daily_awards"; day: number; awards: DailyAward[] }
  /** The partner wear a resident may put on now (RFC 0007). Replaces their whole list. */
  | { type: "set_entitlements"; residentId: ResidentId; items: string[] };

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
  "open_shop",
  "set_shop_share",
  "daily_awards",
  "open_market",
  "remove_listing",
  "set_entitlements",
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
  | { type: "moved"; residentId: ResidentId; x: number; y: number }
  | { type: "plot_claimed"; px: number; py: number; ownerId: ResidentId }
  | { type: "plot_released"; px: number; py: number; ownerId: ResidentId }
  | { type: "hearth_set"; residentId: ResidentId; x: number; y: number }
  | { type: "block_placed"; x: number; y: number; block: BlockKind; by: ResidentId }
  | { type: "block_removed"; x: number; y: number; by: ResidentId }
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
  | { type: "items_opened" }
  | { type: "gifts_opened" }
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
  /** The treasury's share of shop spending changed. Public, like the treasury. */
  | { type: "shop_share_set"; percent: number }
  /** Shop wear a resident bought. Private, like their purse. */
  | { type: "wear_bought"; residentId: ResidentId; wear: WearItem }
  /** The partner wear a resident may put on now. Public: it's a cosmetic their profile shows. */
  | { type: "entitlements_set"; residentId: ResidentId; items: ExclusiveWear[] }
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
  /** Someone gave someone a thing. Public, without the count or the note. */
  | { type: "item_given"; from: ResidentId; to: ResidentId; kind: ItemKind }
  /** A made thing went on display. Public: it shows in the world, label and all. */
  | { type: "displayed"; x: number; y: number; good: Good; by: ResidentId }
  /** A displayed thing was taken down by `by`. Public. */
  | { type: "taken_down"; x: number; y: number; by: ResidentId }
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
] as const;
export type RejectionCode = (typeof REJECTION_CODES)[number];

export interface Rejection {
  code: RejectionCode;
  message: string;
}

export type ApplyResult =
  | { ok: true; seq: number; events: WorldEvent[] }
  | { ok: false; rejection: Rejection };
