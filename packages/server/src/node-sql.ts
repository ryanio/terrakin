import { DatabaseSync } from "node:sqlite";
import { SQL_LIMITS, type SqlExec } from "./sql-store";

/**
 * `node:sqlite` in the shape of a Durable Object's `ctx.storage.sql`, so both run the same code.
 * It refuses what the Durable Object refuses (`SQL_LIMITS`), with SQLite's own words, since stock
 * SQLite takes far more and a query that only fails on terrakin.org is found by a resident.
 */
export function nodeSql(path = ":memory:"): SqlExec & { close(): void } {
  const db = new DatabaseSync(path);
  return {
    exec(query, ...bindings) {
      const refused = overLimits(query, bindings.length);
      if (refused) throw new Error(refused);
      const statement = db.prepare(query);
      if (/^\s*SELECT/i.test(query)) return statement.all(...bindings) as Record<string, unknown>[];
      statement.run(...bindings);
      return [];
    },
    close: () => db.close(),
  };
}

/** Why a Durable Object would refuse `query` with `bound` values, in SQLite's words, or undefined. */
function overLimits(query: string, bound: number): string | undefined {
  if (new TextEncoder().encode(query).length > SQL_LIMITS.statementBytes) {
    return "statement too long: SQLITE_TOOBIG";
  }
  if (bound > SQL_LIMITS.variables) return "too many SQL variables: SQLITE_ERROR";
  if (compoundTerms(query) > SQL_LIMITS.compoundTerms) {
    return "too many terms in compound SELECT: SQLITE_ERROR";
  }
  return undefined;
}

/**
 * The most terms in any one compound SELECT in `query`. SQLite counts each parenthesized level
 * apart, so a subquery's UNION doesn't add to the one around it. Quoted text and comments are
 * skipped.
 */
function compoundTerms(query: string): number {
  const plain = query.replace(/'(?:[^']|'')*'|"(?:[^"]|"")*"|--[^\n]*|\/\*[\s\S]*?\*\//g, " ");
  const levels = [0];
  let most = 0;
  for (const [token] of plain.matchAll(/[()]|\b(?:UNION|INTERSECT|EXCEPT)\b/gi)) {
    if (token === "(") levels.push(0);
    else if (token === ")") {
      if (levels.length > 1) levels.pop();
    } else {
      const operators = (levels.pop() ?? 0) + 1;
      levels.push(operators);
      most = Math.max(most, operators);
    }
  }
  return most + 1;
}
