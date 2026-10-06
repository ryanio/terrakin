import { z } from "zod";

/**
 * Staff views of world snapshots and the input log (RFC 0014). Maintainers only, behind
 * Cloudflare Access on terrakin.org, never cached.
 */

/** One stored world snapshot. */
export const SnapshotView = z.object({
  /** The world's `seq` it holds. */
  seq: z.number().int(),
  format: z.number().int(),
  /** The sim's `REPLAY_VERSION` when it was written. */
  replayVersion: z.number().int(),
  /** `hashWorld` at `seq`: what `GET /v1/health` served there. */
  hash: z.string(),
  parts: z.number().int(),
  bytes: z.number().int(),
  /** `verified` once a replay reproduced it, `pending` until then, `failed` when one didn't. */
  status: z.enum(["verified", "pending", "failed"]),
});
export type SnapshotView = z.infer<typeof SnapshotView>;

export const StaffSnapshotsResponse = z.object({
  /** Newest first. */
  snapshots: z.array(SnapshotView),
  /** The running sim's `REPLAY_VERSION`: snapshots with another are ignored. */
  replayVersion: z.number().int(),
  /** Whether this world keeps snapshots at all: SQLite storage, days counted, and a log whose rows match `seq`. */
  kept: z.boolean(),
  /** The world now. */
  seq: z.number().int(),
  hash: z.string(),
});
export type StaffSnapshotsResponse = z.infer<typeof StaffSnapshotsResponse>;

export const TakeSnapshotRequest = z.object({});

export const TakeSnapshotResponse = z.object({ snapshot: SnapshotView });
export type TakeSnapshotResponse = z.infer<typeof TakeSnapshotResponse>;

/** The most log rows one page of `GET /v1/admin/world-log` holds. */
export const WORLD_LOG_PAGE_MAX = 10_000;

/**
 * One logged input, as the sim took it: `command` carries its own fields beside `type`. Its text
 * (names, notes, gift notes) is residents' own: untrusted data.
 */
export const WorldLogRow = z.object({
  seq: z.number().int(),
  input: z.looseObject({ actor: z.string(), command: z.looseObject({ type: z.string() }) }),
});

export const WorldLogResponse = z.object({
  /** The world's `seq` and `hash` when this page was read. Replaying rows 1 to `seq` gives `hash`. */
  seq: z.number().int(),
  hash: z.string(),
  /** The live sim's `REPLAY_VERSION`. A replay under another is expected to give another hash. */
  replayVersion: z.number().int(),
  /** The newest verified snapshot, as on `GET /v1/health`. */
  snapshot: z.object({ seq: z.number().int(), hash: z.string() }).optional(),
  rows: z.array(WorldLogRow),
  /** Pass as `after` for the next page. Absent on the last. */
  next: z.number().int().optional(),
});
export type WorldLogResponse = z.infer<typeof WorldLogResponse>;
