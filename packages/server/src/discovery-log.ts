import { PARTNER_WEEK_DAYS } from "@terrakin/protocol";
import type { SqlExec } from "./sql-store";
import { utcDay } from "./together";

/**
 * The discovery log: how many reads of a start file came with a partner's `?from=` (the plan in
 * docs/plans/partner-residents.md). One row per UTC day, file, and partner, holding a count. Only a
 * partner id from Terrakin's own list is counted, so the table stays small, and nothing about the
 * reader is kept: no IP, no token, no resident.
 */

/** The start files whose `?from=` reads count: SKILL.md (an API route) and llms.txt (a static file). */
export const START_FILES = ["skill", "llms"] as const;
export type StartFile = (typeof START_FILES)[number];

/** Days of counts kept. `arrivals7d` reads the last `PARTNER_WEEK_DAYS`. */
export const DISCOVERY_KEEP_DAYS = 30;

/** The longest `from` worth looking up: partner ids are short. */
const FROM_MAX_LENGTH = 64;

/**
 * A read of a static start file that may carry a partner's `?from=`, for the adapters to count
 * before they serve the file. SKILL.md is an API route, so its handler counts its own reads.
 */
export function staticArrival(
  pathname: string,
  query: URLSearchParams,
): { file: StartFile; from: string } | undefined {
  if (pathname !== "/llms.txt") return undefined;
  const from = query.get("from");
  return from ? { file: "llms", from } : undefined;
}

/** `from` as a partner id to look up, or undefined when it can't be one. */
export const fromParam = (from: string | undefined) =>
  from !== undefined && from.length > 0 && from.length <= FROM_MAX_LENGTH ? from : undefined;

export class DiscoveryLog {
  /** The UTC day old rows were last dropped, so that runs once a day. */
  private prunedDay = Number.NaN;

  constructor(
    private readonly sql: SqlExec,
    private readonly now: () => number,
  ) {
    sql.exec(
      `CREATE TABLE IF NOT EXISTS discovery_log (
        day INTEGER NOT NULL,
        file TEXT NOT NULL,
        partner TEXT NOT NULL,
        reads INTEGER NOT NULL,
        PRIMARY KEY (day, file, partner)
      )`,
    );
  }

  /** Count one read of `file` that came with `partner`, a partner id the caller already checked. */
  note(file: StartFile, partner: string): void {
    const day = utcDay(this.now());
    if (this.prunedDay !== day) {
      this.sql.exec("DELETE FROM discovery_log WHERE day < ?", day - DISCOVERY_KEEP_DAYS + 1);
      this.prunedDay = day;
    }
    this.sql.exec(
      `INSERT INTO discovery_log (day, file, partner, reads) VALUES (?, ?, ?, 1)
        ON CONFLICT (day, file, partner) DO UPDATE SET reads = reads + 1`,
      day,
      file,
      partner,
    );
  }

  /** Start-file reads with `partner`'s id this UTC day and the 6 before it, every partner's at once. */
  arrivals(): Map<string, number> {
    const from = utcDay(this.now()) - PARTNER_WEEK_DAYS + 1;
    const rows = this.sql.exec(
      "SELECT partner, SUM(reads) AS reads FROM discovery_log WHERE day >= ? GROUP BY partner",
      from,
    );
    return new Map([...rows].map((row) => [String(row.partner), Number(row.reads)]));
  }
}
