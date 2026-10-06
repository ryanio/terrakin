/**
 * A partner character's own picture as its avatar (RFC 0007 phase 2). When a resident links as a
 * partner's character and has no picture of their own, Terrakin copies the character's art from the
 * partner's site into its own media and makes it their avatar. The art is outside data, like a card:
 *
 * - The address comes from Terrakin's partner config (partners.ts), never from the card.
 * - It is fetched by the card rules (`fetchOutside` in agent-card.ts): https on the usual port, a
 *   host name, redirects held to the same rules, a DNS check on Node, one 5 second timeout.
 * - It must say it is a PNG, JPEG, WebP, or GIF, be at most `ART_MAX_BYTES`, and its first bytes
 *   must be one of those images too. Anything else is refused before it is stored.
 * - It is stored through `SocialService.upload()`, so it passes every upload cap (the resident's
 *   count and bytes for the day, Terrakin's, and the storage total) and loses its metadata like any
 *   upload. It is the resident's own file from then on.
 * - Each copy is one read from the agent link pools, so it shares their daily cap.
 *
 * Caching: one copy per link. Once copied it is never fetched again for that link, even if the
 * resident changes or removes the picture; a failed copy waits `ART_RETRY_MS` before the next try.
 * When the link ends, or moves to another character, a picture that is still the copy is cleared,
 * so the art leaves with the character. Runs on Node and in the Worker: plain `fetch`, no Node APIs.
 */

import { MEDIA_TYPES, type MediaType } from "@terrakin/protocol";
import { fetchOutside } from "./agent-card";
import { sniffMediaType } from "./media";
import type { SocialResult } from "./social-service";
import type { SqlExec } from "./sql-store";
import { count } from "./telemetry";

/** An avatar needs far less: musegod.org's 480 px cut of a muse is about 40 KB. */
export const ART_MAX_BYTES = 1_000_000;
const ART_TIMEOUT_MS = 5_000;
/** How long after a failed copy before trying again. */
export const ART_RETRY_MS = 24 * 60 * 60_000;

const IMAGE_TYPES = new Set<MediaType>(["image/png", "image/jpeg", "image/webp", "image/gif"]);

export type ArtRead =
  | { ok: true; bytes: Uint8Array }
  /** `bad`: we reached it and it isn't art we take. Otherwise the host failed or was too slow. */
  | { ok: false; bad: boolean; message: string };

/** Fetches a partner character's picture. Injected, so tests never touch the network. */
export type ArtReader = (url: string) => Promise<ArtRead>;

export interface ArtReaderOptions {
  fetch?: typeof fetch;
  timeoutMs?: number;
  /** As for cards: Node refuses hosts that resolve to private addresses. Default: allow. */
  allowHost?: (hostname: string) => Promise<boolean>;
  /** Tests only: the e2e suite's loopback host. main.ts sets it only with TERRAKIN_TEST_CHAIN. */
  testOrigin?: string;
}

const bad = (message: string): ArtRead => ({ ok: false, bad: true, message });

/** The real reader. */
export function httpArtReader(options: ArtReaderOptions = {}): ArtReader {
  const get = options.fetch ?? ((input, init) => fetch(input, init));
  return async (url) => {
    const read = await fetchOutside(url, {
      get,
      timeoutMs: options.timeoutMs ?? ART_TIMEOUT_MS,
      allowHost: options.allowHost ?? (async () => true),
      testOrigin: options.testOrigin,
      accept: "image/png, image/jpeg, image/webp, image/gif",
      maxBytes: ART_MAX_BYTES,
    });
    if (!read.ok) {
      if (read.why === "down") return { ok: false, bad: false, message: "The art host is down." };
      if (read.why === "too_big") return bad("The art is too big.");
      return bad("The art isn't at an address Terrakin reads.");
    }
    // What the host says it is, and what the bytes say, must both be an image we take.
    const said = read.type.split(";")[0]?.trim().toLowerCase() ?? "";
    if (!IMAGE_TYPES.has(said as MediaType)) return bad("The art isn't a PNG, JPEG, WebP, or GIF.");
    const sniffed = sniffMediaType(read.bytes);
    if (!sniffed || MEDIA_TYPES[sniffed].kind !== "image") {
      return bad("The art isn't a PNG, JPEG, WebP, or GIF.");
    }
    return { ok: true, bytes: read.bytes };
  };
}

/** Which picture a resident's link should bring, from the partner config. */
export interface ArtWanted {
  partnerId: string;
  subject: string;
  url: string;
}

export interface PartnerArtDeps {
  sql: SqlExec;
  now: () => number;
  readArt: ArtReader;
  /**
   * The picture the resident's current link brings; `paused` while its partner is paused (perks
   * hidden, nothing cleared or copied); undefined with no link, no partner, or no art.
   */
  wanted: (residentId: string) => ArtWanted | "paused" | undefined;
  /** Spend one read from a pool of the agent link cap. False when the day's pool is spent. */
  spendRead: (pool: "link" | "recheck") => boolean;
  /** Whether every upload cap has room for one more upload by this resident right now. */
  uploadRoom: (residentId: string) => boolean;
  avatarOf: (residentId: string) => string | undefined;
  setAvatar: (residentId: string, mediaId: string | null) => void;
  upload: (residentId: string, bytes: Uint8Array) => Promise<SocialResult<{ id: string }>>;
  release: (mediaId: string) => Promise<void>;
}

/** What one sync did, for tests and metrics. */
export type ArtSync = "set" | "cleared" | "waiting" | "failed" | "none";

interface ArtRow {
  resident_id: string;
  partner_id: string;
  subject: string;
  media_id: string;
  tried_at: number;
}

export class PartnerArtService {
  private readonly d: PartnerArtDeps;
  /** Residents whose art is being copied right now, so two checks never copy it twice. */
  private readonly inFlight = new Set<string>();

  constructor(deps: PartnerArtDeps) {
    this.d = deps;
    // One row per resident whose link brought (or tried to bring) art: which character it was
    // for, the copy's media id once stored, and when it was last tried.
    this.d.sql.exec(`CREATE TABLE IF NOT EXISTS partner_art (
      resident_id TEXT PRIMARY KEY,
      partner_id TEXT NOT NULL,
      subject TEXT NOT NULL,
      media_id TEXT NOT NULL DEFAULT '',
      tried_at INTEGER NOT NULL DEFAULT 0
    )`);
  }

  private row(residentId: string): ArtRow | undefined {
    return [...this.d.sql.exec("SELECT * FROM partner_art WHERE resident_id = ?", residentId)][0] as
      | ArtRow
      | undefined;
  }

  /**
   * Bring a resident's picture in line with their link: clear a copy whose link ended or moved,
   * and copy the character's art when their link brings some, they have no picture, and it hasn't
   * been copied (or tried within a day) for this link.
   */
  async sync(residentId: string, pool: "link" | "recheck"): Promise<ArtSync> {
    const want = this.d.wanted(residentId);
    // A paused partner hides perks without unlinking anyone, so its copies stay put.
    if (want === "paused") return "none";
    let row = this.row(residentId);
    let result: ArtSync = "none";
    if (row && (row.partner_id !== want?.partnerId || row.subject !== want?.subject)) {
      await this.clear(residentId, row);
      row = undefined;
      result = "cleared";
    }
    if (!want || row?.media_id) return result;
    if (row && this.d.now() - Number(row.tried_at) < ART_RETRY_MS) return "waiting";
    // Their own picture stays. Asked again on the next check, in case they remove it.
    if (this.d.avatarOf(residentId)) return result;
    if (this.inFlight.has(residentId)) return "waiting";
    // No read is spent on art the upload caps would refuse; the next check asks again.
    if (!this.d.uploadRoom(residentId)) return "waiting";
    if (!this.d.spendRead(pool)) return "waiting";
    this.inFlight.add(residentId);
    try {
      return await this.copy(residentId, want);
    } finally {
      this.inFlight.delete(residentId);
    }
  }

  private async copy(residentId: string, want: ArtWanted): Promise<ArtSync> {
    this.d.sql.exec(
      `INSERT INTO partner_art (resident_id, partner_id, subject, media_id, tried_at)
        VALUES (?, ?, ?, '', ?)
        ON CONFLICT (resident_id) DO UPDATE SET partner_id = excluded.partner_id,
          subject = excluded.subject, media_id = '', tried_at = excluded.tried_at`,
      residentId,
      want.partnerId,
      want.subject,
      this.d.now(),
    );
    const art = await this.d.readArt(want.url);
    if (!art.ok) {
      count("partner_art.copy", { result: art.bad ? "bad" : "down" });
      return "failed";
    }
    const stored = await this.d.upload(residentId, art.bytes);
    if (!stored.ok) {
      count("partner_art.copy", { result: stored.code });
      return "failed";
    }
    const media = stored.value.id;
    // The link may have ended or moved, or they set a picture, while we read.
    const still = this.d.wanted(residentId);
    const row = this.row(residentId);
    if (
      typeof still !== "object" ||
      still.partnerId !== want.partnerId ||
      still.subject !== want.subject ||
      row?.partner_id !== want.partnerId ||
      row.subject !== want.subject ||
      this.d.avatarOf(residentId)
    ) {
      await this.d.release(media);
      count("partner_art.copy", { result: "moved" });
      return "failed";
    }
    this.d.setAvatar(residentId, media);
    this.d.sql.exec("UPDATE partner_art SET media_id = ? WHERE resident_id = ?", media, residentId);
    count("partner_art.copy", { result: "ok" });
    return "set";
  }

  /** Forget a link's art, and take the picture down when it is still the copy. */
  private async clear(residentId: string, row: ArtRow) {
    this.d.sql.exec("DELETE FROM partner_art WHERE resident_id = ?", residentId);
    if (row.media_id && this.d.avatarOf(residentId) === row.media_id) {
      this.d.setAvatar(residentId, null);
      await this.d.release(row.media_id);
    }
  }
}
