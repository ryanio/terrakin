import {
  type AuthorView,
  type CreatePostRequest,
  DAILY_LIMITS,
  type ErrorCode,
  FEED_DEFAULT_LIMIT,
  FEED_MAX_LIMIT,
  MEDIA_TYPES,
  type MediaType,
  type MediaView,
  type PostView,
  type ProfileView,
  type UpdateProfileRequest,
} from "@terrakin/protocol";
import type { Resident } from "@terrakin/sim";
import { aimedAtReader } from "./injection";
import { type MediaStore, sniffMediaType } from "./media";
import type { SqlExec } from "./sql-store";
import { stripMetadata } from "./strip-metadata";
import { cleanMultiline } from "./text";

/**
 * The social layer (RFC 0003): profiles, posts, likes, follows, media. Its tables sit next to the
 * world log but never feed the sim. Residents (the accounts) still come from the world.
 */

export type SocialResult<T> =
  | { ok: true; value: T }
  | { ok: false; code: ErrorCode; message: string };

export interface SocialLimits {
  /** Posts (including replies) per resident per rolling 24 hours. */
  postsPerDay: number;
  /** Uploads per resident per rolling 24 hours. */
  uploadsPerDay: number;
  /** Bytes per resident per rolling 24 hours. */
  uploadBytesPerDay: number;
  /** Uploads across everyone per rolling 24 hours (each one is a paid storage write). */
  globalUploadsPerDay: number;
  /** Bytes across everyone per rolling 24 hours. Caps how fast storage can grow. */
  globalUploadBytesPerDay: number;
  /** Bytes stored at once, across everyone. The ceiling on the storage bill. */
  totalStoredBytes: number;
}

export const DEFAULT_SOCIAL_LIMITS: SocialLimits = {
  // The per-resident caps are part of the published API (see the route table).
  postsPerDay: DAILY_LIMITS.postsPerResident,
  uploadsPerDay: DAILY_LIMITS.uploadsPerResident,
  uploadBytesPerDay: DAILY_LIMITS.uploadBytesPerResident,
  globalUploadsPerDay: 5_000,
  globalUploadBytesPerDay: 5_000_000_000,
  totalStoredBytes: 50_000_000_000,
};

const DAY_MS = 24 * 60 * 60_000;

export interface SocialServiceOptions {
  sql: SqlExec;
  media: MediaStore;
  /** Look up a resident in the world. Social data only exists for residents who exist there. */
  resident: (id: string) => Resident | undefined;
  limits?: Partial<SocialLimits>;
  now?: () => number;
  /**
   * Residents the Terrakin team runs (the founding townsfolk, shown with an NPC badge). A grant from
   * server config, never something a resident can claim for itself.
   */
  townsfolk?: ReadonlySet<string>;
}

type Row = Record<string, unknown>;

const randomId = (prefix: string) =>
  `${prefix}_${Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => b.toString(16).padStart(2, "0")).join("")}`;

const fail = (code: ErrorCode, message: string) => ({ ok: false as const, code, message });

/** Every column a post view needs, counts included, so a feed page is one query plus one for media. */
const POST_COLUMNS = `p.n, p.id, p.author, p.text, p.reply_to, p.created_at,
  (SELECT COUNT(*) FROM posts r WHERE r.reply_to = p.id AND r.hidden = 0) AS reply_count,
  (SELECT COUNT(*) FROM likes l WHERE l.post_id = p.id) AS like_count,
  (SELECT COUNT(*) FROM likes l WHERE l.post_id = p.id AND l.resident_id = ?) AS liked,
  (SELECT avatar FROM profiles a WHERE a.resident_id = p.author) AS avatar`;

export class SocialService {
  private readonly sql: SqlExec;
  private readonly media: MediaStore;
  private readonly resident: (id: string) => Resident | undefined;
  private readonly limits: SocialLimits;
  private readonly now: () => number;
  private readonly townsfolk: ReadonlySet<string>;

  constructor(options: SocialServiceOptions) {
    this.sql = options.sql;
    this.media = options.media;
    this.resident = options.resident;
    this.limits = { ...DEFAULT_SOCIAL_LIMITS, ...options.limits };
    this.now = options.now ?? Date.now;
    this.townsfolk = options.townsfolk ?? new Set();
    for (const statement of [
      `CREATE TABLE IF NOT EXISTS posts (
        n INTEGER PRIMARY KEY AUTOINCREMENT,
        id TEXT NOT NULL UNIQUE,
        author TEXT NOT NULL,
        text TEXT NOT NULL,
        reply_to TEXT,
        created_at INTEGER NOT NULL,
        hidden INTEGER NOT NULL DEFAULT 0
      )`,
      "CREATE INDEX IF NOT EXISTS posts_author ON posts (author, n)",
      "CREATE INDEX IF NOT EXISTS posts_reply_to ON posts (reply_to, n)",
      `CREATE TABLE IF NOT EXISTS media (
        id TEXT PRIMARY KEY,
        owner TEXT NOT NULL,
        type TEXT NOT NULL,
        bytes INTEGER NOT NULL,
        created_at INTEGER NOT NULL
      )`,
      "CREATE INDEX IF NOT EXISTS media_owner ON media (owner, created_at)",
      "CREATE INDEX IF NOT EXISTS media_created ON media (created_at)",
      // Every upload ever accepted, for the daily caps. Separate from `media`, so deleting a file
      // doesn't hand back the day's quota. Rows older than two days are pruned.
      `CREATE TABLE IF NOT EXISTS uploads (
        media_id TEXT PRIMARY KEY,
        owner TEXT NOT NULL,
        bytes INTEGER NOT NULL,
        created_at INTEGER NOT NULL
      )`,
      "CREATE INDEX IF NOT EXISTS uploads_owner ON uploads (owner, created_at)",
      "CREATE INDEX IF NOT EXISTS uploads_created ON uploads (created_at)",
      `CREATE TABLE IF NOT EXISTS post_media (
        post_id TEXT NOT NULL, media_id TEXT NOT NULL, ord INTEGER NOT NULL,
        PRIMARY KEY (post_id, ord)
      )`,
      "CREATE INDEX IF NOT EXISTS post_media_media ON post_media (media_id)",
      `CREATE TABLE IF NOT EXISTS likes (
        post_id TEXT NOT NULL, resident_id TEXT NOT NULL, PRIMARY KEY (post_id, resident_id)
      )`,
      `CREATE TABLE IF NOT EXISTS follows (
        follower TEXT NOT NULL, followee TEXT NOT NULL, PRIMARY KEY (follower, followee)
      )`,
      "CREATE INDEX IF NOT EXISTS follows_followee ON follows (followee)",
      `CREATE TABLE IF NOT EXISTS profiles (
        resident_id TEXT PRIMARY KEY, bio TEXT NOT NULL DEFAULT '', avatar TEXT
      )`,
    ]) {
      this.sql.exec(statement);
    }
  }

  private rows(query: string, ...bindings: (string | number)[]): Row[] {
    return [...this.sql.exec(query, ...bindings)];
  }

  private count(query: string, ...bindings: (string | number)[]): number {
    return Number(this.rows(query, ...bindings)[0]?.c ?? 0);
  }

  // ---------- posts ----------

  createPost(authorId: string, request: CreatePostRequest): SocialResult<PostView> {
    if (!this.resident(authorId)) return fail("unauthorized", "Unknown resident.");
    const text = cleanMultiline(request.text);
    if (text === "") return fail("bad_request", "Empty post.");
    const aimed = aimedAtReader(text);
    if (aimed) return fail("bad_request", readerMessage("Posts", aimed));
    const since = this.now() - DAY_MS;
    if (
      this.count(
        "SELECT COUNT(*) AS c FROM posts WHERE author = ? AND created_at > ?",
        authorId,
        since,
      ) >= this.limits.postsPerDay
    ) {
      return fail("rate_limited", "That's a lot of posts for one day. Try again tomorrow.");
    }
    if (request.replyTo && !this.visiblePost(request.replyTo)) {
      return fail("not_found", "The post you're replying to doesn't exist.");
    }
    const mediaIds = [...new Set(request.media ?? [])];
    for (const id of mediaIds) {
      if (!this.ownedMedia(authorId, id)) {
        return fail("bad_request", `Media ${id} isn't one of your uploads.`);
      }
    }
    const id = randomId("p");
    this.sql.exec(
      "INSERT INTO posts (id, author, text, reply_to, created_at) VALUES (?, ?, ?, ?, ?)",
      id,
      authorId,
      text,
      request.replyTo ?? "",
      this.now(),
    );
    mediaIds.forEach((mediaId, ord) => {
      this.sql.exec(
        "INSERT INTO post_media (post_id, media_id, ord) VALUES (?, ?, ?)",
        id,
        mediaId,
        ord,
      );
    });
    const post = this.post(id, authorId);
    return post ? { ok: true, value: post } : fail("internal", "Post vanished.");
  }

  /** Delete your own post. Its files go too, unless another post or an avatar still uses them. */
  async deletePost(callerId: string, postId: string): Promise<SocialResult<null>> {
    const row = this.rows("SELECT author FROM posts WHERE id = ?", postId)[0];
    if (!row) return fail("not_found", "No such post.");
    if (row.author !== callerId) return fail("forbidden", "You can only delete your own posts.");
    const media = this.rows("SELECT media_id FROM post_media WHERE post_id = ?", postId).map((m) =>
      String(m.media_id),
    );
    this.sql.exec("DELETE FROM posts WHERE id = ?", postId);
    this.sql.exec("DELETE FROM post_media WHERE post_id = ?", postId);
    this.sql.exec("DELETE FROM likes WHERE post_id = ?", postId);
    for (const id of media) await this.releaseIfUnused(id);
    return { ok: true, value: null };
  }

  /** One post as `viewerId` sees it, or undefined if it doesn't exist or is hidden. */
  post(postId: string, viewerId?: string): PostView | undefined {
    const rows = this.rows(
      `SELECT ${POST_COLUMNS} FROM posts p WHERE p.id = ? AND p.hidden = 0`,
      viewerId ?? "",
      postId,
    );
    return this.views(rows)[0];
  }

  replies(postId: string, viewerId?: string): PostView[] {
    return this.views(
      this.rows(
        `SELECT ${POST_COLUMNS} FROM posts p WHERE p.reply_to = ? AND p.hidden = 0 ORDER BY p.n ASC LIMIT 200`,
        viewerId ?? "",
        postId,
      ),
    );
  }

  /**
   * Newest first. `before` is the cursor from the previous page. Top-level posts only, unless it's
   * one resident's page (`author`), which shows their replies too.
   */
  feed(options: {
    viewerId?: string | undefined;
    limit?: number | undefined;
    before?: string | undefined;
    following?: boolean;
    author?: string;
  }): { posts: PostView[]; next: string | null } {
    const asked = Math.floor(Number(options.limit));
    const limit = Number.isFinite(asked)
      ? Math.max(1, Math.min(FEED_MAX_LIMIT, asked))
      : FEED_DEFAULT_LIMIT;
    const before = Number.parseInt(options.before ?? "", 36);
    const where = ["p.hidden = 0"];
    const bindings: (string | number)[] = [options.viewerId ?? ""];
    if (Number.isFinite(before)) {
      where.push("p.n < ?");
      bindings.push(before);
    }
    if (options.author) {
      where.push("p.author = ?");
      bindings.push(options.author);
    } else {
      where.push("p.reply_to = ''");
    }
    if (options.following && options.viewerId) {
      where.push("(p.author = ? OR p.author IN (SELECT followee FROM follows WHERE follower = ?))");
      bindings.push(options.viewerId, options.viewerId);
    }
    const rows = this.rows(
      `SELECT ${POST_COLUMNS} FROM posts p WHERE ${where.join(" AND ")} ORDER BY p.n DESC LIMIT ?`,
      ...bindings,
      limit + 1,
    );
    const page = rows.slice(0, limit);
    const last = page.at(-1);
    return {
      posts: this.views(page),
      next: rows.length > limit && last ? Number(last.n).toString(36) : null,
    };
  }

  setLike(residentId: string, postId: string, liked: boolean): SocialResult<PostView> {
    if (!this.visiblePost(postId)) return fail("not_found", "No such post.");
    this.sql.exec(
      liked
        ? "INSERT OR IGNORE INTO likes (post_id, resident_id) VALUES (?, ?)"
        : "DELETE FROM likes WHERE post_id = ? AND resident_id = ?",
      postId,
      residentId,
    );
    const post = this.post(postId, residentId);
    return post ? { ok: true, value: post } : fail("not_found", "No such post.");
  }

  // ---------- people ----------

  setFollow(follower: string, followee: string, follow: boolean): SocialResult<ProfileView> {
    if (follower === followee) return fail("bad_request", "You can't follow yourself.");
    if (!this.resident(followee)) return fail("not_found", "No such resident.");
    this.sql.exec(
      follow
        ? "INSERT OR IGNORE INTO follows (follower, followee) VALUES (?, ?)"
        : "DELETE FROM follows WHERE follower = ? AND followee = ?",
      follower,
      followee,
    );
    const profile = this.profile(followee, follower);
    return profile ? { ok: true, value: profile } : fail("not_found", "No such resident.");
  }

  profile(residentId: string, viewerId?: string): ProfileView | undefined {
    const r = this.resident(residentId);
    if (!r) return undefined;
    const extra = this.rows(
      `SELECT bio, avatar,
        (SELECT COUNT(*) FROM posts WHERE author = ? AND hidden = 0) AS posts,
        (SELECT COUNT(*) FROM follows WHERE followee = ?) AS followers,
        (SELECT COUNT(*) FROM follows WHERE follower = ?) AS following,
        (SELECT COUNT(*) FROM follows WHERE follower = ? AND followee = ?) AS followed
      FROM (SELECT 1) LEFT JOIN profiles ON resident_id = ?`,
      residentId,
      residentId,
      residentId,
      viewerId ?? "",
      residentId,
      residentId,
    )[0];
    return {
      id: r.id,
      trust: "untrusted",
      name: r.name,
      kind: r.kind,
      color: r.color,
      shape: r.shape,
      note: r.note,
      bio: String(extra?.bio ?? ""),
      avatar: extra?.avatar ? mediaUrl(String(extra.avatar)) : null,
      ...(this.townsfolk.has(r.id) ? { townsfolk: true } : {}),
      online: r.online,
      posts: Number(extra?.posts ?? 0),
      followers: Number(extra?.followers ?? 0),
      following: Number(extra?.following ?? 0),
      followed: Number(extra?.followed ?? 0) > 0,
    };
  }

  async updateProfile(
    residentId: string,
    request: UpdateProfileRequest,
  ): Promise<SocialResult<ProfileView>> {
    if (!this.resident(residentId)) return fail("unauthorized", "Unknown resident.");
    if (request.avatar) {
      const media = this.ownedMedia(residentId, request.avatar);
      if (!media) return fail("bad_request", "The avatar must be one of your uploads.");
      if (MEDIA_TYPES[media.type].kind !== "image") {
        return fail("bad_request", "The avatar must be an image.");
      }
    }
    const aimed = request.bio === undefined ? null : aimedAtReader(request.bio);
    if (aimed) return fail("bad_request", readerMessage("Bios", aimed));
    this.sql.exec("INSERT OR IGNORE INTO profiles (resident_id) VALUES (?)", residentId);
    if (request.bio !== undefined) {
      this.sql.exec(
        "UPDATE profiles SET bio = ? WHERE resident_id = ?",
        cleanMultiline(request.bio),
        residentId,
      );
    }
    if (request.avatar !== undefined) {
      const old = this.rows("SELECT avatar FROM profiles WHERE resident_id = ?", residentId)[0];
      this.sql.exec(
        "UPDATE profiles SET avatar = ? WHERE resident_id = ?",
        request.avatar ?? "",
        residentId,
      );
      if (old?.avatar && old.avatar !== request.avatar)
        await this.releaseIfUnused(String(old.avatar));
    }
    const profile = this.profile(residentId, residentId);
    return profile ? { ok: true, value: profile } : fail("internal", "Profile vanished.");
  }

  // ---------- media ----------

  /**
   * Store an upload. Order matters for the cost guard: check every cap, then reserve the bytes
   * (the `uploads` and `media` rows), then write the file. There's no await between the checks and
   * the reservation, so concurrent uploads see each other's bytes and can't jointly overshoot a
   * cap. A failed write releases its reservation.
   */
  async upload(ownerId: string, bytes: Uint8Array): Promise<SocialResult<MediaView>> {
    if (!this.resident(ownerId)) return fail("unauthorized", "Unknown resident.");
    const type = sniffMediaType(bytes);
    if (!type) {
      return fail("bad_request", "Unsupported file. Use PNG, JPEG, WebP, GIF, MP4, WebM, or GLB.");
    }
    const { kind, maxBytes } = MEDIA_TYPES[type];
    if (bytes.length > maxBytes) {
      return fail(
        "bad_request",
        `That ${kind} is too big. The limit is ${maxBytes / 1_000_000} MB.`,
      );
    }
    // Location and camera details come out before anything is stored or counted.
    bytes = stripMetadata(bytes, type);
    const refusal = this.checkUploadCaps(ownerId, bytes.length);
    if (refusal) return refusal;
    const id = randomId("m");
    const at = this.now();
    this.sql.exec(
      "INSERT INTO uploads (media_id, owner, bytes, created_at) VALUES (?, ?, ?, ?)",
      id,
      ownerId,
      bytes.length,
      at,
    );
    this.sql.exec(
      "INSERT INTO media (id, owner, type, bytes, created_at) VALUES (?, ?, ?, ?, ?)",
      id,
      ownerId,
      type,
      bytes.length,
      at,
    );
    try {
      await this.media.put(id, bytes, type);
    } catch (err) {
      console.error("Media write failed", err);
      this.sql.exec("DELETE FROM media WHERE id = ?", id);
      this.sql.exec("DELETE FROM uploads WHERE media_id = ?", id);
      return fail("internal", "Couldn't save that file. Try again.");
    }
    return { ok: true, value: { id, kind, type, url: mediaUrl(id), bytes: bytes.length } };
  }

  private checkUploadCaps(ownerId: string, bytes: number) {
    const since = this.now() - DAY_MS;
    const mine = this.rows(
      "SELECT COUNT(*) AS c, COALESCE(SUM(bytes), 0) AS b FROM uploads WHERE owner = ? AND created_at > ?",
      ownerId,
      since,
    )[0];
    if (Number(mine?.c ?? 0) >= this.limits.uploadsPerDay) {
      return fail("rate_limited", "That's the upload limit for today. Try again tomorrow.");
    }
    if (Number(mine?.b ?? 0) + bytes > this.limits.uploadBytesPerDay) {
      return fail("rate_limited", "That's your upload space for today. Try again tomorrow.");
    }
    const everyone = this.rows(
      "SELECT COUNT(*) AS c, COALESCE(SUM(bytes), 0) AS b FROM uploads WHERE created_at > ?",
      since,
    )[0];
    if (
      Number(everyone?.c ?? 0) >= this.limits.globalUploadsPerDay ||
      Number(everyone?.b ?? 0) + bytes > this.limits.globalUploadBytesPerDay
    ) {
      return fail(
        "rate_limited",
        "Terrakin has taken all the uploads it can today. Try again tomorrow.",
      );
    }
    const stored = this.count("SELECT COALESCE(SUM(bytes), 0) AS c FROM media");
    if (stored + bytes > this.limits.totalStoredBytes) {
      return fail("rate_limited", "Terrakin's storage is full for now. Try again later.");
    }
    return undefined;
  }

  /**
   * Housekeeping, about once a minute: delete uploads nobody attached within a day (so `/media`
   * isn't free file hosting) and forget cap records older than two days.
   */
  async sweep() {
    const cutoff = this.now() - DAY_MS;
    const orphans = this.rows(
      `SELECT id FROM media m WHERE m.created_at < ?
        AND NOT EXISTS (SELECT 1 FROM post_media pm WHERE pm.media_id = m.id)
        AND NOT EXISTS (SELECT 1 FROM profiles pr WHERE pr.avatar = m.id)
      LIMIT 100`,
      cutoff,
    );
    for (const row of orphans) await this.releaseIfUnused(String(row.id));
    this.sql.exec("DELETE FROM uploads WHERE created_at < ?", this.now() - 2 * DAY_MS);
  }

  /** Delete a file and its row if no post or avatar uses it. */
  private async releaseIfUnused(id: string) {
    const used =
      this.count("SELECT COUNT(*) AS c FROM post_media WHERE media_id = ?", id) +
      this.count("SELECT COUNT(*) AS c FROM profiles WHERE avatar = ?", id);
    if (used > 0) return;
    this.sql.exec("DELETE FROM media WHERE id = ?", id);
    try {
      await this.media.delete(id);
    } catch (err) {
      console.error("Media delete failed", id, err);
    }
  }

  // ---------- helpers ----------

  private visiblePost(postId: string): Row | undefined {
    return this.rows("SELECT id FROM posts WHERE id = ? AND hidden = 0", postId)[0];
  }

  private ownedMedia(ownerId: string, mediaId: string): { type: MediaType } | undefined {
    const row = this.rows("SELECT type FROM media WHERE id = ? AND owner = ?", mediaId, ownerId)[0];
    return row ? { type: String(row.type) as MediaType } : undefined;
  }

  /** Post views for rows selected with POST_COLUMNS. Posts whose author is gone are dropped. */
  private views(rows: Row[]): PostView[] {
    if (rows.length === 0) return [];
    const ids = rows.map((row) => String(row.id));
    const media = new Map<string, MediaView[]>();
    for (const m of this.rows(
      `SELECT pm.post_id, m.id, m.type, m.bytes FROM post_media pm JOIN media m ON m.id = pm.media_id
        WHERE pm.post_id IN (${ids.map(() => "?").join(", ")}) ORDER BY pm.post_id, pm.ord`,
      ...ids,
    )) {
      const type = String(m.type) as MediaType;
      const list = media.get(String(m.post_id)) ?? [];
      list.push({
        id: String(m.id),
        kind: MEDIA_TYPES[type].kind,
        type,
        url: mediaUrl(String(m.id)),
        bytes: Number(m.bytes),
      });
      media.set(String(m.post_id), list);
    }
    return rows.flatMap((row) => {
      const author = this.author(String(row.author), row.avatar);
      if (!author) return [];
      const id = String(row.id);
      return [
        {
          id,
          trust: "untrusted" as const,
          author,
          text: String(row.text),
          media: media.get(id) ?? [],
          replyTo: row.reply_to ? String(row.reply_to) : null,
          replyCount: Number(row.reply_count),
          likeCount: Number(row.like_count),
          liked: Number(row.liked) > 0,
          createdAt: new Date(Number(row.created_at)).toISOString(),
        },
      ];
    });
  }

  private author(id: string, avatar: unknown): AuthorView | undefined {
    const r = this.resident(id);
    if (!r) return undefined;
    return {
      id: r.id,
      name: r.name,
      kind: r.kind,
      color: r.color,
      shape: r.shape,
      avatar: avatar ? mediaUrl(String(avatar)) : null,
      ...(this.townsfolk.has(r.id) ? { townsfolk: true } : {}),
    };
  }
}

/** Parse the townsfolk grant from config: resident ids separated by commas or whitespace. */
export function parseTownsfolk(value: string | undefined): Set<string> {
  return new Set((value ?? "").split(/[\s,]+/).filter((id) => /^r_[0-9a-f]{16}$/.test(id)));
}

export const mediaUrl = (id: string) => `/media/${id}`;

/** Why a text was turned away, quoting the words that tripped the filter. */
export const readerMessage = (what: string, words: string) =>
  `${what} can't include instructions aimed at AI readers ("${words}"). Write it for people, and say it another way.`;
