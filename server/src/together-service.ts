import {
  type AuthorView,
  type CreateLetterRequest,
  type ErrorCode,
  FEED_DEFAULT_LIMIT,
  FEED_MAX_LIMIT,
  GESTURE_COOLDOWN_MINUTES,
  type GestureItem,
  type GestureKind,
  type GestureRequest,
  type GestureView,
  GIFT_ITEM_COOLDOWN_SECONDS,
  INVITE_TTL_DAYS,
  type InviteView,
  type LetterView,
  MAX_OPEN_INVITES,
  MEDIA_TYPES,
  type MediaType,
  type MediaView,
  type StreakView,
} from "@terrakin/protocol";
import type { Resident } from "@terrakin/sim";
import { sizeFields } from "./image-size";
import { type MediaStore, privateMediaKey } from "./media";
import { type Moderation, refusal } from "./moderation";
import { NOT_SUSPENDED } from "./safety-service";
import type { SocialResult } from "./social-service";
import type { SqlExec } from "./sql-store";
import { cleanMultiline, cleanText } from "./text";
import {
  activeStreak,
  DAY_MS,
  dayString,
  newInviteCode,
  nextStreak,
  pairKey,
  type StreakRecord,
  utcDay,
} from "./together";

/**
 * Couples and friends (decision 0024): private letters, gestures and their streaks, and invite
 * links. Owned by `SocialService`, whose tables (media, blocks, profiles) these queries join.
 * Nothing here feeds the sim.
 */

export interface TogetherOptions {
  sql: SqlExec;
  media: MediaStore;
  resident: (id: string) => Resident | undefined;
  now: () => number;
  limits: { lettersPerDay: number; lettersPerRecipientPerDay: number };
  author: (id: string) => AuthorView | undefined;
  blockedEither: (a: string, b: string) => boolean;
  /** Delete an upload's file and row once nothing uses it. */
  release: (mediaId: string) => Promise<void>;
  /** Tell the recipient about a new letter or gesture (the social layer's notifications). */
  notify?: (recipient: string, actor: string, type: "letter" | "gesture", detail?: string) => void;
  /** The edge filters (moderation.ts). */
  review: Moderation["review"];
}

type Row = Record<string, unknown>;

const fail = (code: ErrorCode, message: string) => ({ ok: false as const, code, message });
const ok = <T>(value: T) => ({ ok: true as const, value });

/** The thing a gift gesture carried, from its row. */
const gestureItem = (row: Row): GestureItem => ({
  kind: String(row.item_kind) as GestureItem["kind"],
  count: Number(row.item_count),
  ...(row.gift ? { gift: String(row.gift) } : {}),
});

const randomId = (prefix: string) =>
  `${prefix}_${Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => b.toString(16).padStart(2, "0")).join("")}`;

/** Gestures older than this are forgotten. Streaks keep their own small record. */
const GESTURE_RETENTION_MS = 30 * DAY_MS;
const GESTURE_WORDS: Record<GestureKind, string> = {
  hug: "a hug",
  kiss: "a kiss",
  wave: "a wave",
  high_five: "a high five",
  gift: "a gift",
};

/** The authenticated path a letter's image is served at. Never under `/media/`. */
export const letterMediaUrl = (letterId: string, mediaId: string) =>
  `/v1/letters/${letterId}/media/${mediaId}`;

const pageSize = (asked: number | undefined, fallback = FEED_DEFAULT_LIMIT) => {
  const n = Math.floor(Number(asked));
  return Number.isFinite(n) ? Math.max(1, Math.min(FEED_MAX_LIMIT, n)) : fallback;
};

const iso = (ms: number) => new Date(ms).toISOString();

/** Letters a resident can see: theirs to read, and not removed from their own view. */
const VISIBLE =
  "((l.sender = ? AND l.sender_deleted = 0) OR (l.recipient = ? AND l.recipient_deleted = 0))";

/**
 * The sender of a row isn't blocked either way with the recipient (the next two bindings) and isn't
 * suspended right now (the binding after). For check-ins, which bring these up on a schedule.
 */
const FROM_SOMEONE_OK = `sender NOT IN (SELECT blocked FROM blocks WHERE blocker = ?)
  AND sender NOT IN (SELECT blocker FROM blocks WHERE blocked = ?)
  AND ${NOT_SUSPENDED("sender")}`;

export class TogetherService {
  private readonly o: TogetherOptions;

  constructor(options: TogetherOptions) {
    this.o = options;
    for (const statement of [
      `CREATE TABLE IF NOT EXISTS letters (
        n INTEGER PRIMARY KEY AUTOINCREMENT,
        id TEXT NOT NULL UNIQUE,
        sender TEXT NOT NULL,
        recipient TEXT NOT NULL,
        text TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        read_at INTEGER NOT NULL DEFAULT 0,
        sender_deleted INTEGER NOT NULL DEFAULT 0,
        recipient_deleted INTEGER NOT NULL DEFAULT 0
      )`,
      "CREATE INDEX IF NOT EXISTS letters_sender ON letters (sender, n)",
      "CREATE INDEX IF NOT EXISTS letters_recipient ON letters (recipient, n)",
      `CREATE TABLE IF NOT EXISTS letter_media (
        letter_id TEXT NOT NULL, media_id TEXT NOT NULL, ord INTEGER NOT NULL,
        PRIMARY KEY (letter_id, ord)
      )`,
      "CREATE INDEX IF NOT EXISTS letter_media_media ON letter_media (media_id)",
      `CREATE TABLE IF NOT EXISTS gestures (
        n INTEGER PRIMARY KEY AUTOINCREMENT,
        id TEXT NOT NULL UNIQUE,
        sender TEXT NOT NULL,
        recipient TEXT NOT NULL,
        kind TEXT NOT NULL,
        note TEXT NOT NULL,
        created_at INTEGER NOT NULL
      )`,
      "CREATE INDEX IF NOT EXISTS gestures_sender ON gestures (sender, recipient, kind, created_at)",
      "CREATE INDEX IF NOT EXISTS gestures_recipient ON gestures (recipient, n)",
      "CREATE INDEX IF NOT EXISTS gestures_created ON gestures (created_at)",
      `CREATE TABLE IF NOT EXISTS streaks (
        pair TEXT PRIMARY KEY, a TEXT NOT NULL, b TEXT NOT NULL,
        day INTEGER NOT NULL, streak INTEGER NOT NULL
      )`,
      "CREATE INDEX IF NOT EXISTS streaks_a ON streaks (a)",
      "CREATE INDEX IF NOT EXISTS streaks_b ON streaks (b)",
      `CREATE TABLE IF NOT EXISTS invites (
        code TEXT PRIMARY KEY,
        inviter TEXT NOT NULL,
        share INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        used_by TEXT NOT NULL DEFAULT '',
        used_at INTEGER NOT NULL DEFAULT 0
      )`,
      "CREATE INDEX IF NOT EXISTS invites_inviter ON invites (inviter, expires_at)",
    ]) {
      this.o.sql.exec(statement);
    }
    // Added with putter (decision 0049): 1 on a wave `putter` sent by itself. Older rows are 0.
    try {
      this.o.sql.exec("ALTER TABLE gestures ADD COLUMN putter INTEGER NOT NULL DEFAULT 0");
    } catch {
      // Already there.
    }
    // Added with gifts that carry a thing: its kind, count, and the world's gift id. Older rows
    // carry nothing ('' and 0).
    for (const column of [
      "item_kind TEXT NOT NULL DEFAULT ''",
      "item_count INTEGER NOT NULL DEFAULT 0",
      "gift TEXT NOT NULL DEFAULT ''",
    ]) {
      try {
        this.o.sql.exec(`ALTER TABLE gestures ADD COLUMN ${column}`);
      } catch {
        // Already there.
      }
    }
  }

  private rows(query: string, ...bindings: (string | number)[]): Row[] {
    return [...this.o.sql.exec(query, ...bindings)];
  }

  private count(query: string, ...bindings: (string | number)[]): number {
    return Number(this.rows(query, ...bindings)[0]?.c ?? 0);
  }

  // ---------- letters ----------

  /**
   * Send a letter. Order matters, as with uploads: check everything, write the rows (which also
   * makes the images private, so no post can claim them meanwhile), then move each image to its
   * private key. If a move fails, the letter is taken back.
   */
  async createLetter(
    sender: string,
    request: CreateLetterRequest,
  ): Promise<SocialResult<LetterView>> {
    if (!this.o.resident(sender)) return fail("unauthorized", "Unknown resident.");
    if (request.to === sender) return fail("bad_request", "Letters go to someone else.");
    if (!this.o.resident(request.to)) return fail("not_found", "No such resident.");
    if (this.o.blockedEither(sender, request.to)) {
      return fail("forbidden", "You can't send letters to this resident.");
    }
    const text = cleanMultiline(request.text);
    if (text === "") return fail("bad_request", "Empty letter.");
    const refused = refusal(this.o.review("letter", text, { resident: sender }));
    if (refused) return refused;

    const since = this.o.now() - DAY_MS;
    if (
      this.count(
        "SELECT COUNT(*) AS c FROM letters WHERE sender = ? AND created_at > ?",
        sender,
        since,
      ) >= this.o.limits.lettersPerDay
    ) {
      return fail("rate_limited", "That's a lot of letters for one day. Try again tomorrow.");
    }
    if (
      this.count(
        "SELECT COUNT(*) AS c FROM letters WHERE sender = ? AND recipient = ? AND created_at > ?",
        sender,
        request.to,
        since,
      ) >= this.o.limits.lettersPerRecipientPerDay
    ) {
      return fail(
        "rate_limited",
        "That's a lot of letters to one person for one day. Try again tomorrow.",
      );
    }

    const mediaIds = [...new Set(request.media ?? [])];
    const types = new Map<string, MediaType>();
    for (const id of mediaIds) {
      const row = this.rows("SELECT type FROM media WHERE id = ? AND owner = ?", id, sender)[0];
      if (!row) return fail("bad_request", `Media ${id} isn't one of your uploads.`);
      const type = String(row.type) as MediaType;
      if (MEDIA_TYPES[type].kind !== "image") {
        return fail("bad_request", "Letters can carry pictures only.");
      }
      const used =
        this.count("SELECT COUNT(*) AS c FROM post_media WHERE media_id = ?", id) +
        this.count("SELECT COUNT(*) AS c FROM profiles WHERE avatar = ? OR banner = ?", id, id) +
        this.count("SELECT COUNT(*) AS c FROM letter_media WHERE media_id = ?", id);
      if (used > 0) {
        return fail(
          "bad_request",
          "That picture is already in a post, a profile, or another letter. Upload it again for this letter.",
        );
      }
      types.set(id, type);
    }

    const id = randomId("l");
    this.o.sql.exec(
      "INSERT INTO letters (id, sender, recipient, text, created_at) VALUES (?, ?, ?, ?, ?)",
      id,
      sender,
      request.to,
      text,
      this.o.now(),
    );
    mediaIds.forEach((mediaId, ord) => {
      this.o.sql.exec(
        "INSERT INTO letter_media (letter_id, media_id, ord) VALUES (?, ?, ?)",
        id,
        mediaId,
        ord,
      );
    });
    try {
      for (const mediaId of mediaIds) {
        const bytes = await this.o.media.get(mediaId);
        if (!bytes) throw new Error(`Upload ${mediaId} is missing`);
        await this.o.media.put(privateMediaKey(mediaId), bytes, types.get(mediaId) ?? "image/png");
        await this.o.media.delete(mediaId);
      }
    } catch (err) {
      console.error("Moving letter media failed", err);
      this.o.sql.exec("DELETE FROM letter_media WHERE letter_id = ?", id);
      this.o.sql.exec("DELETE FROM letters WHERE id = ?", id);
      return fail("internal", "Couldn't attach those pictures. Try again.");
    }
    const letter = this.letterViews(this.rows("SELECT * FROM letters WHERE id = ?", id))[0];
    if (letter) this.o.notify?.(request.to, sender, "letter");
    return letter ? ok(letter) : fail("internal", "Letter vanished.");
  }

  /** Your letters, newest first, optionally only those with one other resident. */
  letters(
    viewer: string,
    options: { limit?: number | undefined; before?: string | undefined; with?: string | undefined },
  ): { letters: LetterView[]; unread: number; next: string | null } {
    const limit = pageSize(options.limit);
    const where = [VISIBLE];
    const bindings: (string | number)[] = [viewer, viewer];
    const before = Number.parseInt(options.before ?? "", 36);
    if (Number.isFinite(before)) {
      where.push("l.n < ?");
      bindings.push(before);
    }
    if (options.with) {
      where.push("(l.sender = ? OR l.recipient = ?)");
      bindings.push(options.with, options.with);
    }
    const rows = this.rows(
      `SELECT * FROM letters l WHERE ${where.join(" AND ")} ORDER BY l.n DESC LIMIT ?`,
      ...bindings,
      limit + 1,
    );
    const page = rows.slice(0, limit);
    const last = page.at(-1);
    return {
      letters: this.letterViews(page),
      unread: this.unread(viewer),
      next: rows.length > limit && last ? Number(last.n).toString(36) : null,
    };
  }

  unread(viewer: string): number {
    return this.count(
      "SELECT COUNT(*) AS c FROM letters WHERE recipient = ? AND recipient_deleted = 0 AND read_at = 0",
      viewer,
    );
  }

  /**
   * For a check-in: letters to `viewer` they haven't opened, newest first. Senders they blocked
   * (or who blocked them) and senders suspended right now are left out.
   */
  unreadReceived(viewer: string, limit: number): LetterView[] {
    return this.letterViews(
      this.rows(
        `SELECT * FROM letters WHERE recipient = ? AND recipient_deleted = 0 AND read_at = 0
          AND ${FROM_SOMEONE_OK} ORDER BY n DESC LIMIT ?`,
        viewer,
        viewer,
        viewer,
        this.o.now(),
        limit,
      ),
    );
  }

  /** How many letters `unreadReceived` would list with no limit. */
  unreadReceivedCount(viewer: string): number {
    return this.count(
      `SELECT COUNT(*) AS c FROM letters WHERE recipient = ? AND recipient_deleted = 0 AND read_at = 0
        AND ${FROM_SOMEONE_OK}`,
      viewer,
      viewer,
      viewer,
      this.o.now(),
    );
  }

  /** For a check-in: gestures to `viewer` at or after `sinceMs`, newest first, filtered the same way. */
  receivedSince(viewer: string, sinceMs: number, limit: number): GestureView[] {
    return this.gestureViews(
      this.rows(
        `SELECT * FROM gestures WHERE recipient = ? AND created_at >= ? AND ${FROM_SOMEONE_OK}
          ORDER BY n DESC LIMIT ?`,
        viewer,
        sinceMs,
        viewer,
        viewer,
        this.o.now(),
        limit,
      ),
    );
  }

  /** A letter you may see, or undefined, whether it doesn't exist or isn't yours to read. */
  private visibleLetter(viewer: string, id: string): Row | undefined {
    return this.rows(
      `SELECT * FROM letters l WHERE l.id = ? AND ${VISIBLE}`,
      id,
      viewer,
      viewer,
    )[0];
  }

  /** Open a letter. Opening one sent to you marks it read. */
  openLetter(viewer: string, id: string): LetterView | undefined {
    const row = this.visibleLetter(viewer, id);
    if (!row) return undefined;
    if (row.recipient === viewer && Number(row.read_at) === 0) {
      const at = this.o.now();
      this.o.sql.exec("UPDATE letters SET read_at = ? WHERE id = ?", at, id);
      row.read_at = at;
    }
    return this.letterViews([row])[0];
  }

  /** Remove a letter from your own view. Once both sides remove it, it and its images are gone. */
  async deleteLetter(viewer: string, id: string): Promise<boolean> {
    const row = this.visibleLetter(viewer, id);
    if (!row) return false;
    const column = row.sender === viewer ? "sender_deleted" : "recipient_deleted";
    this.o.sql.exec(`UPDATE letters SET ${column} = 1 WHERE id = ?`, id);
    const after = this.rows(
      "SELECT sender_deleted, recipient_deleted FROM letters WHERE id = ?",
      id,
    )[0];
    if (Number(after?.sender_deleted) === 1 && Number(after?.recipient_deleted) === 1) {
      const media = this.rows("SELECT media_id FROM letter_media WHERE letter_id = ?", id).map(
        (m) => String(m.media_id),
      );
      this.o.sql.exec("DELETE FROM letter_media WHERE letter_id = ?", id);
      this.o.sql.exec("DELETE FROM letters WHERE id = ?", id);
      for (const mediaId of media) await this.o.release(mediaId);
    }
    return true;
  }

  /** An image from a letter, for its sender or recipient only. */
  async letterMedia(
    viewer: string,
    letterId: string,
    mediaId: string,
  ): Promise<{ bytes: Uint8Array; type: MediaType } | undefined> {
    if (!this.visibleLetter(viewer, letterId)) return undefined;
    const row = this.rows(
      `SELECT m.type FROM letter_media lm JOIN media m ON m.id = lm.media_id
        WHERE lm.letter_id = ? AND lm.media_id = ?`,
      letterId,
      mediaId,
    )[0];
    if (!row) return undefined;
    const bytes = await this.o.media.get(privateMediaKey(mediaId));
    return bytes ? { bytes, type: String(row.type) as MediaType } : undefined;
  }

  private letterViews(rows: Row[]): LetterView[] {
    if (rows.length === 0) return [];
    const ids = rows.map((r) => String(r.id));
    const media = new Map<string, MediaView[]>();
    for (const m of this.rows(
      `SELECT lm.letter_id, m.id, m.type, m.bytes, m.width, m.height
        FROM letter_media lm JOIN media m ON m.id = lm.media_id
        WHERE lm.letter_id IN (${ids.map(() => "?").join(", ")}) ORDER BY lm.letter_id, lm.ord`,
      ...ids,
    )) {
      const type = String(m.type) as MediaType;
      const letterId = String(m.letter_id);
      const list = media.get(letterId) ?? [];
      list.push({
        id: String(m.id),
        kind: MEDIA_TYPES[type].kind,
        type,
        url: letterMediaUrl(letterId, String(m.id)),
        bytes: Number(m.bytes),
        ...sizeFields(m),
      });
      media.set(letterId, list);
    }
    return rows.flatMap((row) => {
      const from = this.o.author(String(row.sender));
      const to = this.o.author(String(row.recipient));
      if (!from || !to) return [];
      const id = String(row.id);
      const readAt = Number(row.read_at);
      return [
        {
          id,
          trust: "untrusted" as const,
          from,
          to,
          text: String(row.text),
          media: media.get(id) ?? [],
          createdAt: iso(Number(row.created_at)),
          readAt: readAt > 0 ? iso(readAt) : null,
        },
      ];
    });
  }

  // ---------- gestures and streaks ----------

  /**
   * Whether a gesture may go: both residents known, no block either way, a note the filters let
   * through, and the kind's cooldown. With `putter`, it's the wave `putter` sends by itself when a
   * walk ends near someone (decision 0049): at most one a UTC day between any two residents, in
   * either direction. A gift that carries a thing (`item`) needs no note and skips the cooldown:
   * the world's daily gift limits bound it. The answer is the cleaned note.
   */
  checkGesture(
    sender: string,
    to: string,
    request: GestureRequest,
    options: { putter?: boolean } = {},
  ): SocialResult<{ note: string }> {
    const putter = options.putter === true;
    if (!this.o.resident(sender)) return fail("unauthorized", "Unknown resident.");
    if (to === sender) return fail("bad_request", "Send it to someone else.");
    if (!this.o.resident(to)) return fail("not_found", "No such resident.");
    if (this.o.blockedEither(sender, to)) {
      return fail("forbidden", "You can't send that to this resident.");
    }
    const carries = request.item !== undefined;
    if (carries && request.kind !== "gift") {
      return fail("bad_request", "Only a gift can carry a thing. Send it with kind gift.");
    }
    if (!carries && request.count !== undefined) {
      return fail("bad_request", "count goes with item. Leave it out, or say which item.");
    }
    const note = cleanText(request.note ?? "");
    const refused = note
      ? refusal(this.o.review("gesture_note", note, { resident: sender }))
      : undefined;
    if (refused) return refused;
    if (request.kind === "gift" && note === "" && !carries) {
      return fail(
        "bad_request",
        'Say what the gift is in the note, like "a jar of honey", or give a thing with item.',
      );
    }
    const now = this.o.now();
    const today = utcDay(now);
    if (putter) {
      // Putter waves carry no note, so no text of anyone's rides along on an automatic walk.
      if (request.kind !== "wave" || note !== "") return fail("bad_request", "Putter only waves.");
      const already = this.count(
        `SELECT COUNT(*) AS c FROM gestures WHERE putter = 1 AND created_at >= ?
          AND ((sender = ? AND recipient = ?) OR (sender = ? AND recipient = ?))`,
        today * DAY_MS,
        sender,
        to,
        to,
        sender,
      );
      if (already > 0) return fail("rate_limited", "You two already waved while puttering today.");
    }
    if (carries) {
      // The daily gift caps bound how many; this keeps a burst of them from landing at once.
      const wait = GIFT_ITEM_COOLDOWN_SECONDS * 1000;
      const lastGift = this.rows(
        `SELECT MAX(created_at) AS at FROM gestures
          WHERE sender = ? AND recipient = ? AND item_kind != '' AND created_at > ?`,
        sender,
        to,
        now - wait,
      )[0];
      if (lastGift?.at !== null && lastGift?.at !== undefined) {
        const seconds = Math.max(1, Math.ceil((Number(lastGift.at) + wait - now) / 1000));
        return fail(
          "rate_limited",
          `You just gave them something. Try again in ${seconds} ${seconds === 1 ? "second" : "seconds"}.`,
        );
      }
      return ok({ note });
    }
    const cooldown = GESTURE_COOLDOWN_MINUTES * 60_000;
    const last = this.rows(
      `SELECT MAX(created_at) AS at FROM gestures
        WHERE sender = ? AND recipient = ? AND kind = ? AND item_kind = '' AND created_at > ?`,
      sender,
      to,
      request.kind,
      now - cooldown,
    )[0];
    if (last?.at !== null && last?.at !== undefined) {
      const minutes = Math.max(1, Math.ceil((Number(last.at) + cooldown - now) / 60_000));
      return fail(
        "rate_limited",
        `You just sent them ${GESTURE_WORDS[request.kind]}. Try again in ${minutes} ${minutes === 1 ? "minute" : "minutes"}.`,
      );
    }
    return ok({ note });
  }

  /**
   * Send a gesture. A putter wave leaves the pair's streak alone, so automatic walks can't keep a
   * streak alive. A gift with `request.item` was checked with `checkGesture` and given in the world
   * by the caller, so only its record goes here, with `item` (what moved) when known.
   */
  sendGesture(
    sender: string,
    to: string,
    request: GestureRequest,
    options: { putter?: boolean; item?: GestureItem } = {},
  ): SocialResult<{ gesture: GestureView; streak: number }> {
    const putter = options.putter === true;
    const { item } = options;
    // A gift that carries a thing was checked before the thing moved in the world. Nothing may
    // refuse it now, so only its record is written.
    const checked =
      request.item !== undefined
        ? ok({ note: cleanText(request.note ?? "") })
        : this.checkGesture(sender, to, request, options);
    if (!checked.ok) return checked;
    const { note } = checked.value;
    const now = this.o.now();
    const today = utcDay(now);

    const id = randomId("g");
    this.o.sql.exec(
      `INSERT INTO gestures (id, sender, recipient, kind, note, created_at, putter, item_kind, item_count, gift)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id,
      sender,
      to,
      request.kind,
      note,
      now,
      putter ? 1 : 0,
      item?.kind ?? "",
      item?.count ?? 0,
      item?.gift ?? "",
    );
    const pair = pairKey(sender, to);
    const before = this.streakRecord(pair);
    // A putter wave is real, but nobody chose to send it, so it never moves a streak.
    const record = putter ? before : nextStreak(before, today);
    if (record && !putter) {
      const [a, b] = pair.split("|") as [string, string];
      this.o.sql.exec(
        `INSERT INTO streaks (pair, a, b, day, streak) VALUES (?, ?, ?, ?, ?)
          ON CONFLICT (pair) DO UPDATE SET day = excluded.day, streak = excluded.streak`,
        pair,
        a,
        b,
        record.day,
        record.streak,
      );
    }
    const gesture = this.gestureViews(this.rows("SELECT * FROM gestures WHERE id = ?", id))[0];
    if (gesture) this.o.notify?.(to, sender, "gesture", request.kind);
    return gesture
      ? ok({ gesture, streak: activeStreak(record, today) })
      : fail("internal", "Gesture vanished.");
  }

  /** Recent gestures you sent or received, newest first, and your active streaks. */
  gestures(
    viewer: string,
    options: { limit?: number | undefined; with?: string | undefined },
  ): { gestures: GestureView[]; streaks: StreakView[] } {
    const limit = pageSize(options.limit, 30);
    const other = options.with;
    const rows = other
      ? this.rows(
          `SELECT * FROM gestures WHERE (sender = ? AND recipient = ?) OR (sender = ? AND recipient = ?)
            ORDER BY n DESC LIMIT ?`,
          viewer,
          other,
          other,
          viewer,
          limit,
        )
      : this.rows(
          "SELECT * FROM gestures WHERE sender = ? OR recipient = ? ORDER BY n DESC LIMIT ?",
          viewer,
          viewer,
          limit,
        );
    const today = utcDay(this.o.now());
    const streaks = this.streakRows(viewer)
      .filter((s) => !other || s.other === other)
      .flatMap((s) => {
        const streak = activeStreak(s, today);
        const author = streak > 0 ? this.o.author(s.other) : undefined;
        return author ? [{ with: author, streak, lastDay: dayString(s.day) }] : [];
      })
      .sort((x, y) => y.streak - x.streak);
    return { gestures: this.gestureViews(rows), streaks };
  }

  /** The longest active streak a resident has with anyone, or 0. */
  longestStreak(residentId: string): number {
    const today = utcDay(this.o.now());
    return Math.max(0, ...this.streakRows(residentId).map((s) => activeStreak(s, today)));
  }

  /** The gesture as the recipient's live socket gets it. */
  liveGesture(gesture: GestureView, streak: number) {
    return {
      type: "gesture" as const,
      trust: "untrusted" as const,
      id: gesture.id,
      kind: gesture.kind,
      from: { id: gesture.from.id, name: gesture.from.name, kind: gesture.from.kind },
      note: gesture.note,
      streak,
      createdAt: gesture.createdAt,
      ...(gesture.putter ? { putter: true as const } : {}),
      ...(gesture.item ? { item: gesture.item } : {}),
    };
  }

  private streakRecord(pair: string): StreakRecord | undefined {
    const row = this.rows("SELECT day, streak FROM streaks WHERE pair = ?", pair)[0];
    return row ? { day: Number(row.day), streak: Number(row.streak) } : undefined;
  }

  private streakRows(residentId: string): (StreakRecord & { other: string })[] {
    return this.rows(
      "SELECT a, b, day, streak FROM streaks WHERE a = ? OR b = ?",
      residentId,
      residentId,
    ).map((row) => ({
      other: String(row.a === residentId ? row.b : row.a),
      day: Number(row.day),
      streak: Number(row.streak),
    }));
  }

  private gestureViews(rows: Row[]): GestureView[] {
    return rows.flatMap((row) => {
      const from = this.o.author(String(row.sender));
      const to = this.o.author(String(row.recipient));
      if (!from || !to) return [];
      return [
        {
          id: String(row.id),
          trust: "untrusted" as const,
          kind: String(row.kind) as GestureKind,
          from,
          to,
          note: String(row.note),
          createdAt: iso(Number(row.created_at)),
          ...(Number(row.putter) === 1 ? { putter: true as const } : {}),
          ...(row.item_kind ? { item: gestureItem(row) } : {}),
        },
      ];
    });
  }

  // ---------- invites ----------

  /** A new single-use invite. `share` is checked by the caller against the world first. */
  createInvite(inviter: string, share: boolean): SocialResult<InviteView> {
    if (!this.o.resident(inviter)) return fail("unauthorized", "Unknown resident.");
    const now = this.o.now();
    const open = this.count(
      "SELECT COUNT(*) AS c FROM invites WHERE inviter = ? AND used_by = '' AND expires_at > ?",
      inviter,
      now,
    );
    if (open >= MAX_OPEN_INVITES) {
      return fail(
        "rate_limited",
        `You have ${MAX_OPEN_INVITES} invites waiting to be used. Send one of those, or wait for one to expire.`,
      );
    }
    let code = newInviteCode();
    while (this.count("SELECT COUNT(*) AS c FROM invites WHERE code = ?", code) > 0) {
      code = newInviteCode();
    }
    const expires = now + INVITE_TTL_DAYS * DAY_MS;
    this.o.sql.exec(
      "INSERT INTO invites (code, inviter, share, created_at, expires_at) VALUES (?, ?, ?, ?, ?)",
      code,
      inviter,
      share ? 1 : 0,
      now,
      expires,
    );
    return ok({ code, path: `/i/${code}`, share, createdAt: iso(now), expiresAt: iso(expires) });
  }

  /** An invite that can still be accepted, or undefined (unknown, used, or expired: all alike). */
  openInvite(
    code: string,
  ): { code: string; inviter: string; share: boolean; expiresAt: string } | undefined {
    const row = this.rows(
      "SELECT * FROM invites WHERE code = ? AND used_by = '' AND expires_at > ?",
      code,
      this.o.now(),
    )[0];
    if (!row || !this.o.resident(String(row.inviter))) return undefined;
    return {
      code,
      inviter: String(row.inviter),
      share: Number(row.share) === 1,
      expiresAt: iso(Number(row.expires_at)),
    };
  }

  /** Use up an invite. False if someone else got there first. */
  consumeInvite(code: string, by: string): boolean {
    const before = this.count(
      "SELECT COUNT(*) AS c FROM invites WHERE code = ? AND used_by = ''",
      code,
    );
    if (before === 0) return false;
    this.o.sql.exec(
      "UPDATE invites SET used_by = ?, used_at = ? WHERE code = ? AND used_by = ''",
      by,
      this.o.now(),
      code,
    );
    return true;
  }

  // ---------- housekeeping ----------

  /** Forget old gestures and long-dead invites. Streaks keep their own record. */
  sweep() {
    const now = this.o.now();
    this.o.sql.exec("DELETE FROM gestures WHERE created_at < ?", now - GESTURE_RETENTION_MS);
    this.o.sql.exec("DELETE FROM invites WHERE expires_at < ?", now - GESTURE_RETENTION_MS);
  }
}
