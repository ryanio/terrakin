import type { Input } from "@terrakin/sim";
import type { SnapshotHeader, SnapshotStore, Verified } from "./snapshots";
import type { LinkKeyRecord, SessionRecord, Store } from "./store";

/**
 * The slice of a synchronous SQLite API that `SqlStore` needs. Cloudflare Durable Objects
 * (`ctx.storage.sql`) have this shape, and tests adapt `node:sqlite` to it.
 */
export interface SqlExec {
  exec(query: string, ...bindings: (string | number)[]): Iterable<Record<string, unknown>>;
}

/**
 * Run `fn` in one SQLite transaction: all of its writes land or none do. A Durable Object refuses
 * `BEGIN`, so the Worker passes `ctx.storage.transactionSync`.
 */
export type Transaction = <T>(fn: () => T) => T;

/** A transaction with `BEGIN` and `COMMIT`, for `node:sqlite`. */
const beginCommit =
  (sql: SqlExec): Transaction =>
  (fn) => {
    sql.exec("BEGIN");
    try {
      const out = fn();
      sql.exec("COMMIT");
      return out;
    } catch (err) {
      sql.exec("ROLLBACK");
      throw err;
    }
  };

/**
 * The same append-only log as `JsonlStore`, in SQLite rows. One row per accepted input, in order,
 * and one row per session (token hash only, never the token). World snapshots (RFC 0014) live in
 * two tables next to the log.
 */
export class SqlStore implements Store {
  readonly snapshots: SnapshotStore;

  constructor(
    private readonly sql: SqlExec,
    transaction: Transaction = beginCommit(sql),
  ) {
    sql.exec(
      "CREATE TABLE IF NOT EXISTS world_log (seq INTEGER PRIMARY KEY AUTOINCREMENT, input TEXT NOT NULL)",
    );
    sql.exec(
      "CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, resident_id TEXT NOT NULL)",
    );
    // One row per resident with a link key (decision 0020). Turning a key off deletes the row.
    sql.exec(
      "CREATE TABLE IF NOT EXISTS link_keys (resident_id TEXT PRIMARY KEY, key_hash TEXT NOT NULL)",
    );
    sql.exec("CREATE INDEX IF NOT EXISTS sessions_resident ON sessions (resident_id)");
    this.snapshots = new SqlSnapshots(sql, transaction);
  }

  loadLog(): Input[] {
    return [...this.sql.exec("SELECT input FROM world_log ORDER BY seq")].map(
      (row) => JSON.parse(String(row.input)) as Input,
    );
  }

  /** One row at a time from the cursor: the parsed log is never in memory all at once. */
  eachInput(after: number, visit: (input: Input, seq: number) => void, until = Infinity) {
    const last = Number.isFinite(until) ? until : Number.MAX_SAFE_INTEGER;
    const rows = this.sql.exec(
      "SELECT seq, input FROM world_log WHERE seq > ? AND seq <= ? ORDER BY seq",
      after,
      last,
    );
    for (const row of rows) visit(JSON.parse(String(row.input)) as Input, Number(row.seq));
  }

  appendInput(input: Input) {
    this.sql.exec("INSERT INTO world_log (input) VALUES (?)", JSON.stringify(input));
  }

  loadSessions(): SessionRecord[] {
    return [...this.sql.exec("SELECT token_hash, resident_id FROM sessions")].map((row) => ({
      tokenHash: String(row.token_hash),
      residentId: String(row.resident_id),
    }));
  }

  appendSession(session: SessionRecord) {
    this.sql.exec(
      "INSERT INTO sessions (token_hash, resident_id) VALUES (?, ?)",
      session.tokenHash,
      session.residentId,
    );
  }

  loadLinkKeys(): LinkKeyRecord[] {
    return [...this.sql.exec("SELECT resident_id, key_hash FROM link_keys")].map((row) => ({
      residentId: String(row.resident_id),
      keyHash: String(row.key_hash),
    }));
  }

  saveLinkKey({ residentId, keyHash }: LinkKeyRecord) {
    if (keyHash === null) {
      this.sql.exec("DELETE FROM link_keys WHERE resident_id = ?", residentId);
      return;
    }
    this.sql.exec(
      "INSERT INTO link_keys (resident_id, key_hash) VALUES (?, ?) ON CONFLICT (resident_id) DO UPDATE SET key_hash = excluded.key_hash",
      residentId,
      keyHash,
    );
  }

  revokeSessions(residentId: string) {
    this.sql.exec("DELETE FROM sessions WHERE resident_id = ?", residentId);
  }
}

/**
 * Snapshots in two tables: `world_snapshot`, one row per snapshot, and `world_snapshot_part`, its
 * body cut into parts of at most `PART_BYTES`, since a Durable Object row holds at most 2 MB.
 */
class SqlSnapshots implements SnapshotStore {
  constructor(
    private readonly sql: SqlExec,
    private readonly transaction: Transaction,
  ) {
    sql.exec(`CREATE TABLE IF NOT EXISTS world_snapshot (
      seq INTEGER PRIMARY KEY,
      format INTEGER NOT NULL,
      replay_version INTEGER NOT NULL,
      hash TEXT NOT NULL,
      sha256 TEXT NOT NULL,
      parts INTEGER NOT NULL,
      bytes INTEGER NOT NULL,
      verified INTEGER NOT NULL
    )`);
    sql.exec(`CREATE TABLE IF NOT EXISTS world_snapshot_part (
      seq INTEGER NOT NULL,
      part INTEGER NOT NULL,
      body TEXT NOT NULL,
      PRIMARY KEY (seq, part)
    )`);
  }

  list(): SnapshotHeader[] {
    const rows = this.sql.exec(
      "SELECT seq, format, replay_version, hash, sha256, parts, bytes, verified FROM world_snapshot ORDER BY seq DESC",
    );
    return [...rows].map((row) => ({
      seq: Number(row.seq),
      format: Number(row.format),
      replayVersion: Number(row.replay_version),
      hash: String(row.hash),
      sha256: String(row.sha256),
      parts: Number(row.parts),
      bytes: Number(row.bytes),
      verified: Number(row.verified) as Verified,
    }));
  }

  body(seq: number): string {
    const rows = this.sql.exec(
      "SELECT body FROM world_snapshot_part WHERE seq = ? ORDER BY part",
      seq,
    );
    return [...rows].map((row) => String(row.body)).join("");
  }

  save(header: SnapshotHeader, parts: readonly string[], drop: readonly number[]) {
    this.transaction(() => {
      for (const seq of [...drop, header.seq]) this.remove(seq);
      for (const [part, body] of parts.entries()) {
        this.sql.exec(
          "INSERT INTO world_snapshot_part (seq, part, body) VALUES (?, ?, ?)",
          header.seq,
          part,
          body,
        );
      }
      this.sql.exec(
        "INSERT INTO world_snapshot (seq, format, replay_version, hash, sha256, parts, bytes, verified) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        header.seq,
        header.format,
        header.replayVersion,
        header.hash,
        header.sha256,
        header.parts,
        header.bytes,
        header.verified,
      );
    });
  }

  mark(seq: number, verified: 1 | -1, drop: readonly number[]) {
    this.transaction(() => {
      this.sql.exec("UPDATE world_snapshot SET verified = ? WHERE seq = ?", verified, seq);
      for (const old of drop) this.remove(old);
    });
  }

  private remove(seq: number) {
    this.sql.exec("DELETE FROM world_snapshot_part WHERE seq = ?", seq);
    this.sql.exec("DELETE FROM world_snapshot WHERE seq = ?", seq);
  }
}
