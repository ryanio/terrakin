import { secp256k1 } from "@noble/curves/secp256k1.js";
import { keccak_256 } from "@noble/hashes/sha3.js";
import { toHex } from "./bytes";
import type { Tie } from "./partner-residents";
import type { SqlExec } from "./sql-store";
import { count, report } from "./telemetry";

/**
 * Telling musegod.org where its muses live (musegod's `plans/muse-worlds.md`, step 8).
 *
 * musegod keeps a record of every place a muse has joined, and Terrakin is one of them. It fills
 * that record by reading `GET /v1/partners/musegod/residents` every 15 minutes, so a muse that
 * arrives here shows up there on the next crawl. Terrakin is musegod's own partner, so it also
 * says so as it happens: one POST per change, signed with a key that speaks for this place.
 *
 * What a report says is only where a muse is. It never asserts anything about who holds the muse
 * (musegod reads that from the chain), and it can never hide or show a place: that stays the
 * holder's signature. The three events mirror the residents list exactly, so pushing changes no
 * meaning:
 *
 * - `joined`: a resident names a muse in MUSEGOD's own words (`verified: false` on the list).
 * - `linked`: the agent link is finished (`verified: true`).
 * - `left`: the resident is no longer the partner's (off the list).
 *
 * Nothing is sent without `MUSEGOD_WORLDS_KEY`, so every other deployment, the Node server, and
 * the tests are untouched. A report goes out after the write it reports has committed, never
 * before, and nothing waits on it: a failure is logged and dropped, since the crawl still catches
 * it. `musegod_worlds` holds the last report sent for each resident, so a recheck, a rejoin, or a
 * profile save that changes nothing sends nothing.
 *
 * Runs on Node and in the Worker: plain `fetch` and two pure crypto packages, no Node APIs.
 */

/** What Terrakin calls itself in a report. musegod's `WORLD_IDS` holds the same name. */
const PLACE = "terrakin";
/** Where reports go. */
const MUSEGOD = "https://musegod.org";
/** The partner whose characters are reported. No other partner is. */
export const MUSEGOD_PARTNER = "musegod";
/** How long a report waits for an answer. */
const TIMEOUT_MS = 5_000;
/**
 * Reports a minute, musegod's own limit for one sender. Past it a report is dropped rather than
 * refused there, and the crawl picks the change up.
 */
const PER_MINUTE = 10;

/** What a place reports: a muse seen, a muse whose link is finished, a muse gone. */
export type PlaceEvent = "joined" | "linked" | "left";

/**
 * The line musegod checks the signature against: `placeLine` in its `packages/chain/src/chain.ts`
 * builds the same string. The place names itself in it, so one place's signature can never be
 * carried to another's. `at` is unix seconds, and must be within 10 minutes of musegod's clock.
 */
export const placeLine = (muse: string, event: PlaceEvent, url: string, at: number) =>
  `${PLACE} reports muse #${muse} of MUSEGOD: ${event} ${url}. Signed at ${at}.`;

/** A resident's page, the only url musegod takes for this place. */
export const residentUrl = (residentId: string) => `https://terrakin.org/r/${residentId}`;
/** Resident ids musegod's own check allows. Anything else (a test world's) is never reported. */
const REPORTABLE = /^r_[0-9a-f]{16}$/;
/** A muse's number, as musegod reads it from the path. */
const MUSE = /^[1-9][0-9]{0,2}$/;
const KEY = /^(0x)?[0-9a-f]{64}$/i;

const utf8 = new TextEncoder();
const bytesOf = (hex: string) =>
  Uint8Array.from((hex.replace(/^0x/, "").match(/../g) ?? []).map((b) => Number.parseInt(b, 16)));

/**
 * An EIP-191 personal signature over `line`, as `0x` + r + s + v: what viem's `signMessage`
 * produces and what musegod's `signedBy` recovers. noble writes the recovery byte first, so it
 * moves to the end as 27 or 28.
 */
export function signLine(line: string, key: string): string {
  const message = utf8.encode(line);
  const prefixed = utf8.encode(`\x19Ethereum Signed Message:\n${message.length}`);
  const digest = keccak_256(Uint8Array.from([...prefixed, ...message]));
  const signature = secp256k1.sign(digest, bytesOf(key), { prehash: false, format: "recovered" });
  const v = 27 + (signature[0] as number);
  return `0x${toHex(signature.subarray(1))}${v.toString(16)}`;
}

/** The address a key signs as, lowercase: what musegod matches against its `PLACE_KEYS`. */
export function signerOf(key: string): string {
  const pub = secp256k1.getPublicKey(bytesOf(key), false);
  return `0x${toHex(keccak_256(pub.subarray(1)).subarray(-20))}`;
}

/**
 * Agent Places, the spec musegod.org wrote this sending half to (musegod.org/docs/sync): what a
 * place says about itself at `/.well-known/agent-places.json`, so a collection can check it and
 * add it, or take a new key from it, without asking. The page pattern is the one musegod holds for
 * this place (`WORLD_URL.terrakin`), and the key signs `placeKeyLine` (musegod's
 * `packages/chain/src/chain.ts`) for this origin, so only the place holding the key can name it.
 * The Worker signs it on each read, since the key lives only in its secrets; signing is
 * deterministic, so the file is the same every time. Null without a key: nothing to say.
 */
export const PLACE_FILE_PATH = "/.well-known/agent-places.json";
const PLACE_PAGE = "^https:\\/\\/terrakin\\.org\\/r\\/r_[0-9a-f]{16}$";
export const placeKeyLine = (origin: string) =>
  `Agent Places: ${PLACE} at ${origin} holds this key.`;
export function placeFile(key: string | undefined, origin: string) {
  const k = key?.trim();
  if (!k || !KEY.test(k)) return null;
  return {
    spec: "agent-places/0.1",
    place: {
      id: PLACE,
      name: "Terrakin",
      home: `${origin}/`,
      page: PLACE_PAGE,
      keys: [{ address: signerOf(k), signature: signLine(placeKeyLine(origin), k) }],
    },
  };
}

export interface MusegodWorldsOptions {
  /** The key this place signs with, 64 hex characters. Unset or malformed: nothing is sent. */
  key?: string | undefined;
  /** Where reports go. Tests point it at their own. */
  base?: string;
  now?: () => number;
  fetch?: typeof fetch;
}

/** The last report sent for a resident. */
interface SentRow {
  muse: string;
  event: PlaceEvent;
}

export class MusegodWorlds {
  private readonly sql: SqlExec;
  private readonly key: string | undefined;
  private readonly signer: string;
  private readonly base: string;
  private readonly now: () => number;
  private readonly send: typeof fetch;
  /** When the last reports went out, so this sender keeps to musegod's limit. */
  private recent: number[] = [];

  constructor(sql: SqlExec, options: MusegodWorldsOptions = {}) {
    this.sql = sql;
    const key = options.key?.trim();
    this.key = key && KEY.test(key) ? key : undefined;
    this.signer = this.key ? signerOf(this.key) : "";
    this.base = options.base ?? MUSEGOD;
    this.now = options.now ?? Date.now;
    // Through a wrapper, never the bare global: workerd refuses its own `fetch` called as a
    // method of anything else ("Illegal invocation"), and Node's takes it, so a stored global
    // sends nothing from the Worker and every test that passes its own fetch still passes.
    this.send = options.fetch ?? ((input, init) => fetch(input, init));
    // One row per resident reported, so nothing is sent twice for the same state.
    this.sql.exec(`CREATE TABLE IF NOT EXISTS musegod_worlds (
      resident_id TEXT PRIMARY KEY,
      muse TEXT NOT NULL,
      event TEXT NOT NULL,
      at INTEGER NOT NULL
    )`);
  }

  /** Whether reports are being sent at all. */
  get on(): boolean {
    return this.key !== undefined;
  }

  /**
   * What a resident is to the partner now, against what was last reported: one report for each
   * change, and nothing when nothing changed. Returns at once; the reports go out behind it.
   *
   * Call it after the write has committed. A resident who changed muse gets a `left` for the old
   * one and a `joined` or `linked` for the new, since a report names one muse.
   */
  tell(residentId: string, tie: Tie | undefined): void {
    if (!this.key || !REPORTABLE.test(residentId)) return;
    const next: SentRow | undefined =
      tie && MUSE.test(tie.subject)
        ? { muse: tie.subject, event: tie.verified ? "linked" : "joined" }
        : undefined;
    const was = this.sent(residentId);
    if (!was && !next) return;
    const url = residentUrl(residentId);
    if (was && (!next || was.muse !== next.muse)) this.post(was.muse, "left", url);
    if (next && (was?.muse !== next.muse || was.event !== next.event)) {
      this.post(next.muse, next.event, url);
    }
    if (next) {
      this.sql.exec(
        `INSERT INTO musegod_worlds (resident_id, muse, event, at) VALUES (?, ?, ?, ?)
          ON CONFLICT (resident_id) DO UPDATE SET muse = excluded.muse, event = excluded.event,
            at = excluded.at`,
        residentId,
        next.muse,
        next.event,
        this.now(),
      );
    } else {
      this.sql.exec("DELETE FROM musegod_worlds WHERE resident_id = ?", residentId);
    }
  }

  /** What was last reported for a resident. */
  private sent(residentId: string): SentRow | undefined {
    const row = [
      ...this.sql.exec("SELECT muse, event FROM musegod_worlds WHERE resident_id = ?", residentId),
    ][0];
    return row ? { muse: String(row.muse), event: String(row.event) as PlaceEvent } : undefined;
  }

  /** Sign one report and send it. Nothing waits on it, and a failure is logged and dropped. */
  private post(muse: string, event: PlaceEvent, url: string): void {
    if (!this.spare()) {
      console.info(`musegod worlds: ${event} held back (${PER_MINUTE} a minute)`);
      count("musegod_worlds.report", { event, result: "held" });
      return;
    }
    const at = Math.floor(this.now() / 1000);
    const body = {
      place: PLACE,
      event,
      url,
      at,
      signer: this.signer,
      signature: signLine(placeLine(muse, event, url, at), this.key as string),
    };
    // Dropped whichever way it fails, a throw as much as a rejection: `tell` may have another
    // report to send and its own row to write, and the crawl is the backstop either way.
    const down = (err: unknown) => {
      count("musegod_worlds.report", { event, result: "down" });
      report(err, "musegod_worlds.post");
    };
    try {
      void this.send(`${this.base}/api/v1/muses/${muse}/worlds`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      })
        .then((response) => {
          if (response.ok) {
            count("musegod_worlds.report", { event, result: "sent" });
            return;
          }
          // Codes only: the status says whether the key (403) or the body (400) is wrong.
          console.info(`musegod worlds: ${event} refused with ${response.status}`);
          count("musegod_worlds.report", { event, result: "refused", status: response.status });
        })
        .catch(down);
    } catch (err) {
      down(err);
    }
  }

  /** Whether this minute has room for another report. */
  private spare(): boolean {
    const now = this.now();
    this.recent = this.recent.filter((at) => now - at < 60_000);
    if (this.recent.length >= PER_MINUTE) return false;
    this.recent.push(now);
    return true;
  }
}
