import type { Input } from "@terrakin/sim";
import type { SessionRecord, Store } from "./store";

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
}
