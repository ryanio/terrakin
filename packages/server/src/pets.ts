import { type ErrorCode, PAT_LIMITS, PetKind } from "@terrakin/protocol";
import type { Crop, Pet } from "@terrakin/sim";
import { z } from "zod";
import type { SocialResult } from "./social-service";
import type { SqlExec } from "./sql-store";
import { DAY_MS, utcDay } from "./together";

/**
 * Pats (RFC 0019): a resident pats another's pet, at most once a UTC day per pet. Social data like
 * praise (decision 0047), never world state and never in the log, and nothing comes with it: no
 * coins, no karma. Each pat is its own row (patter, owner, day, time), so a pet's count of the
 * residents who ever patted it is a `COUNT(DISTINCT patter)`. A resident has one pet, for good, so
 * a pet is named by its owner.
 */

export interface PetPatOptions {
  sql: SqlExec;
  now: () => number;
  /** A resident's pet, from the world, or undefined when they have none (or don't exist). */
  petOf: (id: string) => Pet | undefined;
  exists: (id: string) => boolean;
  blockedEither: (a: string, b: string) => boolean;
  /** Tell the owner (the social layer's notifications, with its caps and block check). */
  notify: (owner: string, patter: string, pet: Pet) => void;
  /** Let every screen showing the pet know it was patted. Who patted isn't passed on. */
  patted?: (owner: string) => void;
}

const fail = (code: ErrorCode, message: string, retryAfter?: number) => ({
  ok: false as const,
  code,
  message,
  ...(retryAfter === undefined ? {} : { retryAfter }),
});

export class PetPatService {
  constructor(private readonly o: PetPatOptions) {
    for (const statement of [
      // One row per pat, kept for good. The key is the once-a-day-per-pet rule.
      `CREATE TABLE IF NOT EXISTS pet_pats (
        patter TEXT NOT NULL,
        owner TEXT NOT NULL,
        day INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        PRIMARY KEY (patter, owner, day)
      )`,
      "CREATE INDEX IF NOT EXISTS pet_pats_owner ON pet_pats (owner, patter)",
      "CREATE INDEX IF NOT EXISTS pet_pats_patter_day ON pet_pats (patter, day)",
    ]) {
      o.sql.exec(statement);
    }
  }

  private count(query: string, ...bindings: (string | number)[]): number {
    return Number([...this.o.sql.exec(query, ...bindings)][0]?.c ?? 0);
  }

  /** Seconds until the next UTC day, when the daily pat limits reset. */
  private untilTomorrow(): number {
    const now = this.o.now();
    return Math.max(1, Math.ceil((DAY_MS - (now % DAY_MS)) / 1000));
  }

  /** Pat `owner`'s pet as `patter`. Checks everything first and writes one row. */
  pat(patter: string, owner: string): SocialResult<null> {
    if (!this.o.exists(patter)) return fail("unauthorized", "Unknown resident.");
    if (!this.o.exists(owner)) return fail("not_found", "No such resident.");
    if (patter === owner) {
      return fail("bad_request", "That's your own pet. Pats are for visitors; yours knows.");
    }
    const pet = this.o.petOf(owner);
    if (!pet) return fail("not_found", "They don't have a pet yet.");
    if (this.o.blockedEither(patter, owner)) {
      return fail("forbidden", "You can't pat this resident's pet.");
    }
    const day = utcDay(this.o.now());
    const wait = this.untilTomorrow();
    if (this.pattedToday(patter, owner)) {
      return fail(
        "rate_limited",
        "You patted that pet today. You can again after midnight UTC.",
        wait,
      );
    }
    if (
      this.count("SELECT COUNT(*) AS c FROM pet_pats WHERE patter = ? AND day = ?", patter, day) >=
      PAT_LIMITS.perPatterPerDay
    ) {
      return fail(
        "rate_limited",
        `You've patted ${PAT_LIMITS.perPatterPerDay} pets today. You can again after midnight UTC.`,
        wait,
      );
    }
    this.o.sql.exec(
      "INSERT INTO pet_pats (patter, owner, day, created_at) VALUES (?, ?, ?, ?)",
      patter,
      owner,
      day,
      this.o.now(),
    );
    this.o.notify(owner, patter, pet);
    this.o.patted?.(owner);
    return { ok: true, value: null };
  }

  /** How many residents have patted `owner`'s pet, each counted once, all time. */
  pats(owner: string): number {
    return this.count("SELECT COUNT(DISTINCT patter) AS c FROM pet_pats WHERE owner = ?", owner);
  }

  /** Whether `patter` already patted `owner`'s pet today (UTC). */
  pattedToday(patter: string, owner: string): boolean {
    return (
      this.count(
        "SELECT COUNT(*) AS c FROM pet_pats WHERE patter = ? AND owner = ? AND day = ?",
        patter,
        owner,
        utcDay(this.o.now()),
      ) > 0
    );
  }
}

/** What a pet notification keeps in its `detail`: the pet as it was, and a treat's kind. */
const PetDetail = z.object({
  kind: PetKind,
  name: z.string(),
  treat: z.string().optional(),
});

/** A pet notification's `detail`: the pet's kind and name then, and for a treat, what it was. */
export function petDetail(pet: Pick<Pet, "kind" | "name">, treat?: Crop): string {
  return JSON.stringify({ kind: pet.kind, name: pet.name, ...(treat ? { treat } : {}) });
}

/** Read a pet notification's `detail` back. Undefined when it can't be read. */
export function readPetDetail(
  detail: string,
): { kind: PetKind; name: string; treat?: string | undefined } | undefined {
  try {
    const parsed = PetDetail.safeParse(JSON.parse(detail));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}
