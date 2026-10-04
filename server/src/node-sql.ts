import { DatabaseSync } from "node:sqlite";
import type { SqlExec } from "./sql-store";

/** `node:sqlite` in the shape of a Durable Object's `ctx.storage.sql`, so both run the same code. */
export function nodeSql(path = ":memory:"): SqlExec & { close(): void } {
  const db = new DatabaseSync(path);
  return {
    exec(query, ...bindings) {
      const statement = db.prepare(query);
      if (/^\s*SELECT/i.test(query)) return statement.all(...bindings) as Record<string, unknown>[];
      statement.run(...bindings);
      return [];
    },
    close: () => db.close(),
  };
}
