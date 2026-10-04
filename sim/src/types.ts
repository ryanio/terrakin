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
}

export interface Resident {
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
  | { type: "unshare_plot"; with: ResidentId };

export type CommandType = Command["type"];

/** A command plus who issued it. This is the unit the server logs and replays. */
export interface Input {
  actor: ResidentId;
  command: Command;
}

export type WorldEvent =
  | { type: "joined"; resident: Resident }
  | { type: "left"; residentId: ResidentId }
  | {
      type: "profile_changed";
      residentId: ResidentId;
      color: ResidentColor;
      shape: ResidentShape;
      note: string;
    }
  | { type: "moved"; residentId: ResidentId; x: number; y: number }
  | { type: "plot_claimed"; px: number; py: number; ownerId: ResidentId }
  | { type: "plot_released"; px: number; py: number; ownerId: ResidentId }
  | { type: "hearth_set"; residentId: ResidentId; x: number; y: number }
  | { type: "block_placed"; x: number; y: number; block: BlockKind; by: ResidentId }
  | { type: "block_removed"; x: number; y: number; by: ResidentId }
  | { type: "plot_shared"; px: number; py: number; residentId: ResidentId }
  | { type: "plot_unshared"; px: number; py: number; residentId: ResidentId }
  | { type: "hearth_cleared"; residentId: ResidentId };

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
] as const;
export type RejectionCode = (typeof REJECTION_CODES)[number];

export interface Rejection {
  code: RejectionCode;
  message: string;
}

export type ApplyResult =
  | { ok: true; seq: number; events: WorldEvent[] }
  | { ok: false; rejection: Rejection };
