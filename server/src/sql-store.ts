import type { Input } from "@terrakin/sim";
import type { LinkKeyRecord, SessionRecord, Store } from "./store";

/**
 * The slice of a synchronous SQLite API that `SqlStore` needs. Cloudflare Durable Objects
 * (`ctx.storage.sql`) have this shape, and tests adapt `node:sqlite` to it.
 */
export interface SqlExec {
  exec(query: string, ...bindings: (string | number)[]): Iterable<Record<string, unknown>>;
}

/**
 * The same append-only log as `JsonlStore`, in SQLite rows. One row per accepted input, in order,
 * and one row per session (token hash only, never the token).
 */
export class SqlStore implements Store {
  constructor(private readonly sql: SqlExec) {
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
  }

  loadLog(): Input[] {
    return [...this.sql.exec("SELECT input FROM world_log ORDER BY seq")].map(
      (row) => JSON.parse(String(row.input)) as Input,
    );
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
}
