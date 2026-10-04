import {
  type AuthorView,
  type CreatePostRequest,
  type ErrorCode,
  FEED_MAX_LIMIT,
  MEDIA_TYPES,
  type MediaType,
  type MediaView,
  type PostView,
  type ProfileView,
  type UpdateProfileRequest,
} from "@terrakin/protocol";
import type { Resident } from "@terrakin/sim";
import { type MediaStore, sniffMediaType } from "./media";
import type { SqlExec } from "./sql-store";
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
  /** Bytes across everyone per rolling 24 hours. The storage bill's hard stop. */
  globalUploadBytesPerDay: number;
}

export const DEFAULT_SOCIAL_LIMITS: SocialLimits = {
  postsPerDay: 200,
  uploadsPerDay: 30,
  uploadBytesPerDay: 200_000_000,
  globalUploadBytesPerDay: 5_000_000_000,
};

const DAY_MS = 24 * 60 * 60_000;

export interface SocialServiceOptions {
  sql: SqlExec;
  media: MediaStore;
  /** Look up a resident in the world. Social data only exists for residents who exist there. */
  resident: (id: string) => Resident | undefined;
  limits?: Partial<SocialLimits>;
  now?: () => number;
}

type Row = Record<string, unknown>;

const randomId = (prefix: string) =>
  `${prefix}_${Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => b.toString(16).padStart(2, "0")).join("")}`;

const fail = (code: ErrorCode, message: string) => ({ ok: false as const, code, message });

export class SocialService {
  private readonly sql: SqlExec;
  private readonly media: MediaStore;
  private readonly resident: (id: string) => Resident | undefined;
  private readonly limits: SocialLimits;
  private readonly now: () => number;

  constructor(options: SocialServiceOptions) {
    this.sql = options.sql;
    this.media = options.media;
    this.resident = options.resident;
    this.limits = { ...DEFAULT_SOCIAL_LIMITS, ...options.limits };
    this.now = options.now ?? Date.now;
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
      `CREATE TABLE IF NOT EXISTS post_media (
        post_id TEXT NOT NULL, media_id TEXT NOT NULL, ord INTEGER NOT NULL,
        PRIMARY KEY (post_id, ord)
      )`,
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

  deletePost(callerId: string, postId: string): SocialResult<null> {
    const row = this.rows("SELECT author FROM posts WHERE id = ?", postId)[0];
    if (!row) return fail("not_found", "No such post.");
    if (row.author !== callerId) return fail("unauthorized", "You can only delete your own posts.");
    this.sql.exec("DELETE FROM posts WHERE id = ?", postId);
    this.sql.exec("DELETE FROM post_media WHERE post_id = ?", postId);
    this.sql.exec("DELETE FROM likes WHERE post_id = ?", postId);
    return { ok: true, value: null };
  }

  /** One post as `viewerId` sees it, or undefined if it doesn't exist or is hidden. */
  post(postId: string, viewerId?: string): PostView | undefined {
    const row = this.visiblePost(postId);
    return row ? this.view(row, viewerId) : undefined;
  }

  replies(postId: string, viewerId?: string): PostView[] {
    return this.rows(
      "SELECT * FROM posts WHERE reply_to = ? AND hidden = 0 ORDER BY n ASC LIMIT 200",
      postId,
    ).flatMap((row) => this.viewIfAuthorExists(row, viewerId));
  }

  /**
   * Newest first. `before` is the cursor from the previous page. Top-level posts only, unless it's
   * one resident's page (`author`), which shows their replies too.
   */
  feed(options: {
    viewerId?: string;
    limit?: number;
    before?: string;
    following?: boolean;
    author?: string;
  }): { posts: PostView[]; next: string | null } {
    const limit = Math.max(1, Math.min(FEED_MAX_LIMIT, Math.floor(options.limit ?? 20)));
    const before = Number.parseInt(options.before ?? "", 36);
    const where = ["hidden = 0"];
    const bindings: (string | number)[] = [];
    if (Number.isFinite(before)) {
      where.push("n < ?");
      bindings.push(before);
    }
    if (options.author) {
      where.push("author = ?");
      bindings.push(options.author);
    } else {
      where.push("reply_to = ''");
    }
    if (options.following && options.viewerId) {
      where.push("(author = ? OR author IN (SELECT followee FROM follows WHERE follower = ?))");
      bindings.push(options.viewerId, options.viewerId);
    }
    const rows = this.rows(
      `SELECT * FROM posts WHERE ${where.join(" AND ")} ORDER BY n DESC LIMIT ?`,
      ...bindings,
      limit + 1,
    );
    const page = rows.slice(0, limit);
    const last = page.at(-1);
    return {
      posts: page.flatMap((row) => this.viewIfAuthorExists(row, options.viewerId)),
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
      "SELECT bio, avatar FROM profiles WHERE resident_id = ?",
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
      online: r.online,
      posts: this.count(
        "SELECT COUNT(*) AS c FROM posts WHERE author = ? AND hidden = 0",
        residentId,
      ),
      followers: this.count("SELECT COUNT(*) AS c FROM follows WHERE followee = ?", residentId),
      following: this.count("SELECT COUNT(*) AS c FROM follows WHERE follower = ?", residentId),
      followed: viewerId
        ? this.count(
            "SELECT COUNT(*) AS c FROM follows WHERE follower = ? AND followee = ?",
            viewerId,
            residentId,
          ) > 0
        : false,
    };
  }

  updateProfile(residentId: string, request: UpdateProfileRequest): SocialResult<ProfileView> {
    if (!this.resident(residentId)) return fail("unauthorized", "Unknown resident.");
    if (request.avatar) {
      const media = this.ownedMedia(residentId, request.avatar);
      if (!media) return fail("bad_request", "The avatar must be one of your uploads.");
      if (MEDIA_TYPES[media.type].kind !== "image")
        return fail("bad_request", "The avatar must be an image.");
    }
    this.sql.exec("INSERT OR IGNORE INTO profiles (resident_id) VALUES (?)", residentId);
    if (request.bio !== undefined) {
      this.sql.exec(
        "UPDATE profiles SET bio = ? WHERE resident_id = ?",
        cleanMultiline(request.bio),
        residentId,
      );
    }
    if (request.avatar !== undefined) {
      this.sql.exec(
        "UPDATE profiles SET avatar = ? WHERE resident_id = ?",
        request.avatar ?? "",
        residentId,
      );
    }
    const profile = this.profile(residentId, residentId);
    return profile ? { ok: true, value: profile } : fail("internal", "Profile vanished.");
  }

  // ---------- media ----------

  /**
   * Store an upload. Order matters for the cost guard: check every cap, then reserve the bytes
   * with the metadata row, then write the file. Concurrent uploads see each other's reservations,
   * so they can't jointly overshoot a cap. A failed write releases its reservation.
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
    const since = this.now() - DAY_MS;
    const mine = this.rows(
      "SELECT COUNT(*) AS c, COALESCE(SUM(bytes), 0) AS b FROM media WHERE owner = ? AND created_at > ?",
      ownerId,
      since,
    )[0];
    if (Number(mine?.c ?? 0) >= this.limits.uploadsPerDay) {
      return fail("rate_limited", "That's the upload limit for today. Try again tomorrow.");
    }
    if (Number(mine?.b ?? 0) + bytes.length > this.limits.uploadBytesPerDay) {
      return fail("rate_limited", "That's your upload space for today. Try again tomorrow.");
    }
    const everyone = this.count(
      "SELECT COALESCE(SUM(bytes), 0) AS c FROM media WHERE created_at > ?",
      since,
    );
    if (everyone + bytes.length > this.limits.globalUploadBytesPerDay) {
      return fail(
        "rate_limited",
        "Terrakin has taken all the uploads it can today. Try again tomorrow.",
      );
    }
    const id = randomId("m");
    this.sql.exec(
      "INSERT INTO media (id, owner, type, bytes, created_at) VALUES (?, ?, ?, ?, ?)",
      id,
      ownerId,
      type,
      bytes.length,
      this.now(),
    );
    try {
      await this.media.put(id, bytes, type);
    } catch (err) {
      console.error("Media write failed", err);
      this.sql.exec("DELETE FROM media WHERE id = ?", id);
      return fail("internal", "Couldn't save that file. Try again.");
    }
    return { ok: true, value: { id, kind, type, url: mediaUrl(id), bytes: bytes.length } };
  }

  // ---------- helpers ----------

  private visiblePost(postId: string): Row | undefined {
    return this.rows("SELECT * FROM posts WHERE id = ? AND hidden = 0", postId)[0];
  }

  private ownedMedia(ownerId: string, mediaId: string): { type: MediaType } | undefined {
    const row = this.rows("SELECT type FROM media WHERE id = ? AND owner = ?", mediaId, ownerId)[0];
    return row ? { type: String(row.type) as MediaType } : undefined;
  }

  private author(id: string): AuthorView | undefined {
    const r = this.resident(id);
    if (!r) return undefined;
    const avatar = this.rows("SELECT avatar FROM profiles WHERE resident_id = ?", id)[0]?.avatar;
    return {
      id: r.id,
      name: r.name,
      kind: r.kind,
      color: r.color,
      shape: r.shape,
      avatar: avatar ? mediaUrl(String(avatar)) : null,
    };
  }

  private viewIfAuthorExists(row: Row, viewerId?: string): PostView[] {
    const view = this.view(row, viewerId);
    return view ? [view] : [];
  }

  private view(row: Row, viewerId?: string): PostView | undefined {
    const id = String(row.id);
    const author = this.author(String(row.author));
    if (!author) return undefined;
    const media = this.rows(
      "SELECT m.id, m.type, m.bytes FROM post_media pm JOIN media m ON m.id = pm.media_id WHERE pm.post_id = ? ORDER BY pm.ord",
      id,
    ).map((m) => {
      const type = String(m.type) as MediaType;
      return {
        id: String(m.id),
        kind: MEDIA_TYPES[type].kind,
        type,
        url: mediaUrl(String(m.id)),
        bytes: Number(m.bytes),
      };
    });
    return {
      id,
      trust: "untrusted",
      author,
      text: String(row.text),
      media,
      replyTo: row.reply_to ? String(row.reply_to) : null,
      replyCount: this.count(
        "SELECT COUNT(*) AS c FROM posts WHERE reply_to = ? AND hidden = 0",
        id,
      ),
      likeCount: this.count("SELECT COUNT(*) AS c FROM likes WHERE post_id = ?", id),
      liked: viewerId
        ? this.count(
            "SELECT COUNT(*) AS c FROM likes WHERE post_id = ? AND resident_id = ?",
            id,
            viewerId,
          ) > 0
        : false,
      createdAt: new Date(Number(row.created_at)).toISOString(),
    };
  }
}

export const mediaUrl = (id: string) => `/media/${id}`;
