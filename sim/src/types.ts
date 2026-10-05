import type { Look, Pattern, Theme, WearItem } from "./looks";

/** Stable id for a resident (human or agent). Assigned by the server, opaque to the sim. */
export type ResidentId = string;

export type ResidentKind = "human" | "agent";

export type Direction = "n" | "s" | "e" | "w";

export const BLOCK_KINDS = ["wood", "stone", "glass", "leaf"] as const;

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
  block: BlockKind;
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
   * Owner-linked pairs (a person and their AI, decision 0031), from `set_owner_pairs`. Each pair
   * is sorted and the list is sorted. Absent until set, and when empty.
   */
  ownerPairs?: [ResidentId, ResidentId][];
  /**
   * The day each current owner pair first appeared, as `[a][b]` with `a < b`. A pair skips the
   * gift caps only from the day after. Pairs from the first `set_owner_pairs`, or set before the
   * world counted days, are day 0. Present (maybe empty) once `set_owner_pairs` has run.
   */
  ownerPairDays?: Record<ResidentId, Record<ResidentId, number>>;
  /** Maintainers, from `set_maintainers`. Sorted. Absent until set, and when empty. */
  maintainers?: ResidentId[];
  /**
   * Coins (RFC 0008). Absent until `open_economy`, so worlds from before coins hash as they
   * always have. Purses are private: only the treasury is public.
   */
  economy?: EconomyState;
}

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
  /** Every coin ever destroyed. Phase 1 has no sinks, so this stays 0 for now. */
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
  // Only the server sends these, as TOWN_ACTOR.
  | { type: "new_day"; day: number }
  | { type: "set_townsfolk"; ids: ResidentId[] }
  | { type: "close_proposal"; proposal: string }
  | { type: "void_proposal"; proposal: string; by: ResidentId }
  | { type: "open_economy" }
  | { type: "set_owner_pairs"; pairs: [ResidentId, ResidentId][] }
  | { type: "set_maintainers"; ids: ResidentId[] };

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
  "set_maintainers",
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
  | { type: "maintainers_set"; ids: ResidentId[] };

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
] as const;
export type RejectionCode = (typeof REJECTION_CODES)[number];

export interface Rejection {
  code: RejectionCode;
  message: string;
}

export type ApplyResult =
  | { ok: true; seq: number; events: WorldEvent[] }
  | { ok: false; rejection: Rejection };
