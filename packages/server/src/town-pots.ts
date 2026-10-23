import type { Finish, Glaze, GoodKind, JobGiver } from "@terrakin/sim";
import type { SqlExec } from "./sql-store";

/**
 * The town's shelf of pots (RFC 0047): each pot handed in for a townsfolk's job, by its codes, its
 * maker, and whose job it was. A handed-in thing leaves the world; this keeps what the town shows
 * of it, so a job finished is seen at the shop. One row per hand-in, never a label.
 */

/** How many pots the shop's shelf shows, newest first. */
const TOWN_POTS_SHOWN = 6;

export interface TownPot {
  /** The input that handed it in. */
  seq: number;
  giver: JobGiver;
  maker: string;
  kind: GoodKind;
  glaze: Glaze;
  finish: Finish;
  day: number;
}

export class TownPots {
  constructor(private readonly sql: SqlExec) {
    this.sql.exec(`CREATE TABLE IF NOT EXISTS town_pots (
      seq INTEGER PRIMARY KEY,
      giver TEXT NOT NULL,
      maker TEXT NOT NULL,
      kind TEXT NOT NULL,
      glaze TEXT NOT NULL,
      finish TEXT NOT NULL,
      day INTEGER NOT NULL
    )`);
  }

  /** A pot handed in. The same input twice is one row. */
  add(pot: TownPot) {
    this.sql.exec(
      "INSERT OR IGNORE INTO town_pots (seq, giver, maker, kind, glaze, finish, day) VALUES (?, ?, ?, ?, ?, ?, ?)",
      pot.seq,
      pot.giver,
      pot.maker,
      pot.kind,
      pot.glaze,
      pot.finish,
      pot.day,
    );
  }

  /** The newest pots on the shelf, newest first. */
  newest(limit = TOWN_POTS_SHOWN): TownPot[] {
    return [...this.sql.exec("SELECT * FROM town_pots ORDER BY seq DESC LIMIT ?", limit)].map(
      (r) => ({
        seq: Number(r.seq),
        giver: String(r.giver) as JobGiver,
        maker: String(r.maker),
        kind: String(r.kind) as GoodKind,
        glaze: String(r.glaze) as Glaze,
        finish: String(r.finish) as Finish,
        day: Number(r.day),
      }),
    );
  }
}
