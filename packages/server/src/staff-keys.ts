import { createHash } from "node:crypto";
import type { RouteSpec, StaffKeyScope, StaffKeyView } from "@terrakin/protocol";
import { DAY_MS } from "@terrakin/sim";
import { randomBytes, toBase64Url, toHex } from "./bytes";
import type { SqlExec } from "./sql-store";

/**
 * Staff keys (RFC 0026): a key a staff member makes in the staff app for their own AI, so it can
 * call the staff routes from the command line. A key acts as whoever made it, never beyond their
 * current role or the key's scope, and every action it takes is logged as them with the key's
 * name. Only its SHA-256 is kept. It works until it expires or is revoked, and stops the moment
 * its maker is no longer staff. A key can never make keys or export the world log.
 */

/** What a staff actor carries after its maker when a key acted: `access:ana@x.org|key:sk_1a`. */
const KEY_MARK = "|key:";
/** Every key starts with this, so a key sent anywhere else is recognized and never taken as a token. */
export const STAFF_KEY_PREFIX = "tks_";

/**
 * Routes a key never reaches: keys themselves, and the whole-world log export. Everything else a
 * `role` key may call, as far as its maker's role goes.
 */
const KEY_NEVER = new Set(["getStaffKeys", "createStaffKey", "revokeStaffKey", "getWorldLog"]);
/**
 * What a `read` key sees, named one by one, so a new staff route is never readable by default.
 * `staff-keys.test.ts` pins every scope against the whole route table.
 */
const READ_ROUTES = new Set([
  "getAdminOverview",
  "getReports",
  "getModerationLog",
  "getTownsfolkActivity",
  "getNewcomers",
  "getStaffBounties",
]);
/** What `rekey` adds to reading. */
const REKEY_ROUTES = new Set(["createStaffRekeyCode"]);

/** Last-used times are written at most this often per key. */
const TOUCH_EVERY_MS = 60_000;

const hash = (secret: string) => createHash("sha256").update(secret).digest("hex");

/** Who acted, without the key: the staff member a keyed actor stands for. */
export function staffOwner(actor: string): string {
  const at = actor.indexOf(KEY_MARK);
  return at < 0 ? actor : actor.slice(0, at);
}

/** The key a staff actor used, if any. */
export function staffKeyId(actor: string): string | undefined {
  const at = actor.indexOf(KEY_MARK);
  return at < 0 ? undefined : actor.slice(at + KEY_MARK.length);
}

/** Whether a key with this scope may call this route. The maker's role is checked as well. */
export function keyAllows(scope: StaffKeyScope, route: Pick<RouteSpec, "id" | "method">): boolean {
  if (KEY_NEVER.has(route.id)) return false;
  if (scope === "role") return true;
  if (READ_ROUTES.has(route.id)) return true;
  return scope === "rekey" && REKEY_ROUTES.has(route.id);
}

interface KeyRow {
  id: string;
  owner: string;
  name: string;
  scope: StaffKeyScope;
  createdAt: number;
  expiresAt: number;
  lastUsedAt: number | null;
  revokedAt: number | null;
}

export class StaffKeys {
  private readonly touched = new Map<string, number>();

  constructor(
    private readonly sql: SqlExec,
    private readonly now: () => number,
  ) {
    sql.exec(`CREATE TABLE IF NOT EXISTS staff_keys (
      id TEXT PRIMARY KEY,
      key_hash TEXT NOT NULL UNIQUE,
      owner TEXT NOT NULL,
      name TEXT NOT NULL,
      scope TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      last_used_at INTEGER,
      revoked_at INTEGER
    )`);
  }

  /** A new key for `owner`. Returns the row and the key, shown once. */
  mint(owner: string, name: string, scope: StaffKeyScope, days: number) {
    const secret = `${STAFF_KEY_PREFIX}${toBase64Url(randomBytes(32))}`;
    const id = `sk_${toHex(randomBytes(6))}`;
    const at = this.now();
    this.sql.exec(
      `INSERT INTO staff_keys (id, key_hash, owner, name, scope, created_at, expires_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)`,
      id,
      hash(secret),
      owner,
      name,
      scope,
      at,
      at + days * DAY_MS,
    );
    const row = this.row(id);
    if (!row) throw new Error("staff key vanished");
    return { row, secret };
  }

  /**
   * The working key for a secret: known, not revoked, not expired. Marks it used (at most once a
   * minute). Undefined for anything else.
   */
  find(secret: string): KeyRow | undefined {
    if (!secret.startsWith(STAFF_KEY_PREFIX)) return undefined;
    const raw = [...this.sql.exec("SELECT id FROM staff_keys WHERE key_hash = ?", hash(secret))][0];
    const row = raw ? this.row(String(raw.id)) : undefined;
    const now = this.now();
    if (!row || row.revokedAt !== null || row.expiresAt <= now) return undefined;
    if (now - (this.touched.get(row.id) ?? 0) >= TOUCH_EVERY_MS) {
      this.touched.set(row.id, now);
      this.sql.exec("UPDATE staff_keys SET last_used_at = ? WHERE id = ?", now, row.id);
    }
    return row;
  }

  /** Keys made by `owner`, or every key, newest first. */
  list(owner?: string): KeyRow[] {
    const rows =
      owner === undefined
        ? this.sql.exec("SELECT id FROM staff_keys ORDER BY created_at DESC")
        : this.sql.exec(
            "SELECT id FROM staff_keys WHERE owner = ? ORDER BY created_at DESC",
            owner,
          );
    return [...rows].flatMap((r) => this.row(String(r.id)) ?? []);
  }

  /** Turn a key off now. Revoking it again changes nothing. */
  revoke(id: string): KeyRow | undefined {
    this.sql.exec(
      "UPDATE staff_keys SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL",
      this.now(),
      id,
    );
    return this.row(id);
  }

  /** A key's name, for log lines. */
  name(id: string): string | undefined {
    return this.row(id)?.name;
  }

  row(id: string): KeyRow | undefined {
    const r = [...this.sql.exec("SELECT * FROM staff_keys WHERE id = ?", id)][0];
    if (!r) return undefined;
    const opt = (v: unknown) => (v === null || v === undefined ? null : Number(v));
    return {
      id: String(r.id),
      owner: String(r.owner),
      name: String(r.name),
      scope: String(r.scope) as StaffKeyScope,
      createdAt: Number(r.created_at),
      expiresAt: Number(r.expires_at),
      lastUsedAt: opt(r.last_used_at),
      revokedAt: opt(r.revoked_at),
    };
  }
}

/** A key as the staff app lists it, for `viewer`. */
export function staffKeyView(
  row: KeyRow,
  viewer: string,
  ownerView: StaffKeyView["ownerView"],
): StaffKeyView {
  const iso = (ms: number | null) => (ms === null ? null : new Date(ms).toISOString());
  return {
    id: row.id,
    name: row.name,
    scope: row.scope,
    owner: row.owner,
    ownerView,
    mine: row.owner === staffOwner(viewer),
    createdAt: new Date(row.createdAt).toISOString(),
    expiresAt: new Date(row.expiresAt).toISOString(),
    lastUsedAt: iso(row.lastUsedAt),
    revokedAt: iso(row.revokedAt),
  };
}

/** A keyed actor: the maker, then the key. */
export const keyedActor = (owner: string, keyId: string) => `${owner}${KEY_MARK}${keyId}`;
