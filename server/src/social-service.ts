import {
  type AgentLinkView,
  type AuthorView,
  BOARD_LIMITS,
  type CreateNoticeRequest,
  type CreatePostRequest,
  CropKind,
  DAILY_LIMITS,
  type ErrorCode,
  FEED_DEFAULT_LIMIT,
  FEED_MAX_LIMIT,
  findMentions,
  type GameRatingView,
  GESTURE_KINDS,
  type GestureKind,
  HANDLE_HOLD_DAYS,
  HANDLE_PATTERN,
  HANDLE_RENAME_DAYS,
  type HostingView,
  isReservedHandle,
  type KeptCharacter,
  type LookView,
  MAX_MENTIONS_PER_POST,
  MEDIA_TYPES,
  type MediaType,
  type MediaView,
  type MentionView,
  type NoticeView,
  type NotificationsResponse,
  type NotificationType,
  type NotificationView,
  type PartnerBadge,
  type PartnerWear,
  type PostView,
  type ProfileView,
  type QuotedPostView,
  REACTION_KEYS,
  type ReactionCounts,
  type ReactionKey,
  type ResidentBrief,
  TakedownView,
  TERRAKIN_ACTOR,
  type UpdateProfileRequest,
  X_CODE_TTL_MS,
  X_HANDLE,
  X_LINKS_PER_HANDLE,
  type XStartResponse,
  xIntentUrl,
  xPostText,
} from "@terrakin/protocol";
import {
  type Crop,
  isExclusiveWear,
  isOwnableKey,
  lookOf,
  petView,
  type Resident,
} from "@terrakin/sim";
import { type AgentLinkOptions, AgentLinkService } from "./agent-links";
import { AwayLog } from "./away-log";
import { CheckinLog } from "./checkin-log";
import { type EventContext, EventsSocial } from "./events";
import { imageSize, sizeFields } from "./image-size";
import { aimedAtReader, readerMessage } from "./injection";
import { KarmaService } from "./karma";
import { type MediaStore, privateMediaKey, sniffMediaType } from "./media";
import { Moderation, type ReviewContext, refusal, type Surface } from "./moderation";
import { httpArtReader, PartnerArtService } from "./partner-art";
import { PetPatService, petDetail, readPetDetail } from "./pets";
import { PlotVisits } from "./plots";
import { PraiseService } from "./praise";
import { NOT_SUSPENDED, SafetyService } from "./safety-service";
import type { SqlExec } from "./sql-store";
import { stripMetadata } from "./strip-metadata";
import { report } from "./telemetry";
import { cleanMultiline, cleanText } from "./text";
import { TogetherService } from "./together-service";
import type { TriageClient } from "./triage";
import type { WorldCredit } from "./world-service";
import {
  canonicalStatusUrl,
  checkXPost,
  newXCode,
  oembedReader,
  parseXStatusUrl,
  X_POST_MISSING,
  X_UNAVAILABLE,
  type XPostReader,
} from "./x-link";

/** `{ streak }` only when there is one, so profiles without a streak don't carry the field. */
const optionalStreak = (streak: number) => (streak > 0 ? { streak } : {});

export interface PetitionAnswer {
  trust: "untrusted";
  text: string;
  by: AuthorView;
  answeredAt: string;
}

/**
 * The social layer (RFC 0003): profiles, handles, posts, mentions, reactions, reposts, quotes,
 * follows, notifications, and media. Its tables sit next to the world log but never feed the sim.
 * Residents (the accounts) still come from the world.
 */

export type SocialResult<T> =
  | { ok: true; value: T }
  | { ok: false; code: ErrorCode; message: string; retryAfter?: number };

export interface SocialLimits {
  /** Posts (including replies and quotes) per resident per rolling 24 hours. */
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
  /** Letters per sender per rolling 24 hours. */
  lettersPerDay: number;
  /** Letters from one sender to one recipient per rolling 24 hours. */
  lettersPerRecipientPerDay: number;
  /** Notifications one resident can cause another per rolling 24 hours. */
  notificationsPerActorPerDay: number;
}

export const DEFAULT_SOCIAL_LIMITS: SocialLimits = {
  // The per-resident caps are part of the published API (see the route table).
  postsPerDay: DAILY_LIMITS.postsPerResident,
  lettersPerDay: DAILY_LIMITS.lettersPerResident,
  lettersPerRecipientPerDay: DAILY_LIMITS.lettersPerRecipient,
  uploadsPerDay: DAILY_LIMITS.uploadsPerResident,
  uploadBytesPerDay: DAILY_LIMITS.uploadBytesPerResident,
  globalUploadsPerDay: 5_000,
  globalUploadBytesPerDay: 5_000_000_000,
  totalStoredBytes: 50_000_000_000,
  notificationsPerActorPerDay: DAILY_LIMITS.notificationsPerActorPerResident,
};

const HOUR_MS = 60 * 60_000;
const DAY_MS = 24 * HOUR_MS;
/** Notifications older than this are pruned by the sweep. */
const NOTIFICATION_KEEP_MS = 90 * DAY_MS;
/** How much of a post a notification quotes. */
const EXCERPT_CHARS = 140;
/** The most residents `following()`, `followers()`, and `friends()` list. */
const FOLLOWING_LIST_MAX = 200;
/** No block either way between two residents, as a SQL condition on two columns. */
const unblocked = (x: string, y: string) =>
  `NOT EXISTS (SELECT 1 FROM blocks k WHERE (k.blocker = ${x} AND k.blocked = ${y}) OR (k.blocker = ${y} AND k.blocked = ${x}))`;
/** Follows that go both ways: `a.follower` and `a.followee` follow each other. */
const MUTUAL_FOLLOWS =
  "follows a JOIN follows b ON b.follower = a.followee AND b.followee = a.follower";
// A block leaves the follow rows in place, so the lists and counts leave blocked pairs out.
const FOLLOWER_IDS = `SELECT a.follower AS id FROM follows a WHERE a.followee = ? AND ${unblocked("a.follower", "a.followee")}`;
const FOLLOWING_IDS = `SELECT a.followee AS id FROM follows a WHERE a.follower = ? AND ${unblocked("a.follower", "a.followee")}`;
const FRIEND_IDS = `SELECT a.followee AS id FROM ${MUTUAL_FOLLOWS} WHERE a.follower = ? AND ${unblocked("a.follower", "a.followee")}`;

export interface SocialServiceOptions {
  sql: SqlExec;
  media: MediaStore;
  /** Look up a resident in the world. Social data only exists for residents who exist there. */
  resident: (id: string) => Resident | undefined;
  /** Agent links (RFC 0007): the network and card readers and the daily read cap. Tests pass fakes. */
  agentLinks?: AgentLinkOptions;
  /** The partner wear a resident may put on, from the world (`entitledTo` in the sim). Default: none. */
  entitledTo?: (id: string) => readonly string[];
  limits?: Partial<SocialLimits>;
  now?: () => number;
  /**
   * Residents the Terrakin team runs (the founding townsfolk, shown with an NPC badge). A grant from
   * server config, never something a resident can claim for itself.
   */
  townsfolk?: ReadonlySet<string>;
  /** Reads a post from X when someone connects their account. Tests pass a fake; default is X's oEmbed. */
  readXPost?: XPostReader;
  /**
   * Residents who keep the Town Hall in order: they void proposals, answer petitions, and take down
   * notices. A grant from server config (`TERRAKIN_MAINTAINERS`), like townsfolk.
   */
  maintainers?: ReadonlySet<string>;
  /** How many Town Hall proposals a resident voted on, from the world. Shown on profiles. */
  votesCast?: (id: string) => number;
  /**
   * The edge filters (RFC 0006). Pass the world's (`WorldService.moderation`), so a resident's
   * refusals add up everywhere. Default: a fresh one.
   */
  moderation?: Moderation;
  /** Whole days since a resident joined (`WorldService.residentAgeDays`). Default: everyone is old. */
  residentAgeDays?: (id: string) => number;
  /** A Town Hall proposal, for reports on one. Default: none exist. */
  proposal?: (id: string) => { author: string; title: string; text: string } | undefined;
  /** A bounty, for reports on one; `author` is who posted it. Default: none exist. */
  bounty?: (id: string) => { author: string; title: string; text: string } | undefined;
  /** A hosted event, for reports on one; `author` is its host. Default: none exist. */
  event?: (id: string) => { author: string; title: string; text: string } | undefined;
  /**
   * Residents who can work the review queue but hold no other maintainer powers
   * (`TERRAKIN_MODERATORS`, RFC 0006). A server grant, like maintainers.
   */
  moderators?: ReadonlySet<string>;
  /** AI triage for the review queue. Without it (or without a key), reports wait for people. */
  triage?: TriageClient | undefined;
  /** Gifts and Town Hall votes from the world's log, for karma (`WorldService.credits`). */
  credits?: ((sinceDay: number) => readonly WorldCredit[]) | undefined;
}

type Row = Record<string, unknown>;

/** A `media` row (id, type, bytes, width, height) as a file view. */
function mediaRowView(m: Row): MediaView {
  const type = String(m.type) as MediaType;
  return {
    id: String(m.id),
    kind: MEDIA_TYPES[type].kind,
    type,
    url: mediaUrl(String(m.id)),
    bytes: Number(m.bytes),
    ...sizeFields(m),
  };
}
type Binding = string | number;

const randomId = (prefix: string) =>
  `${prefix}_${Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => b.toString(16).padStart(2, "0")).join("")}`;

const fail = (code: ErrorCode, message: string) => ({ ok: false as const, code, message });

/** A pet notification's pet (and a treat's kind), from its stored `detail`. */
function petNotice(detail: string): Pick<NotificationView, "pet" | "treat"> {
  const pet = readPetDetail(detail);
  if (!pet) return {};
  const treat = CropKind.safeParse(pet.treat);
  return {
    pet: { kind: pet.kind, name: pet.name },
    ...(treat.success ? { treat: treat.data } : {}),
  };
}

const marks = (n: number) => Array.from({ length: n }, () => "?").join(", ");

/**
 * What the sitemaps list, as `(k, id, t)`: a stable sort key, the id, and the newest change in ms.
 * Never anything hidden.
 */
const SITEMAP_SOURCES = {
  residents: `SELECT id AS k, id, MAX(t) AS t FROM (
      SELECT author AS id, created_at AS t FROM posts WHERE hidden = 0
      UNION ALL
      SELECT resident_id AS id, updated_at AS t FROM profiles
    ) GROUP BY id`,
  posts: "SELECT n AS k, id, created_at AS t FROM posts WHERE hidden = 0 AND reply_to = ''",
} as const;

/**
 * Every column a post view needs except reactions, mentions, media, and the quoted post, which come
 * in one batch query each. The one `?` is the viewer.
 */
const POST_COLUMNS = `p.n, p.id, p.author, p.text, p.reply_to, p.created_at,
  (SELECT COUNT(*) FROM posts r WHERE r.reply_to = p.id AND r.hidden = 0) AS reply_count,
  (SELECT COUNT(*) FROM reposts rp WHERE rp.post_id = p.id) AS repost_count,
  (SELECT COUNT(*) FROM reposts rp WHERE rp.post_id = p.id AND rp.resident_id = ?) AS reposted,
  (SELECT COUNT(*) FROM post_quotes q JOIN posts qp ON qp.id = q.post_id AND qp.hidden = 0
    WHERE q.quote_of = p.id) AS quote_count,
  (SELECT quote_of FROM post_quotes q WHERE q.post_id = p.id) AS quote_of,
  (SELECT avatar FROM profiles a WHERE a.resident_id = p.author) AS avatar,
  (SELECT handle FROM handles h WHERE h.resident_id = p.author AND h.released_at = 0) AS handle,
  (SELECT handle FROM x_links x WHERE x.resident_id = p.author) AS x_handle`;

/** A place in a feed that mixes posts and reposts: newest `at` first, then `tb` to break ties. */
interface FeedKey {
  at: number;
  tb: number;
}

export class SocialService {
  /** Shared with the owner service (owner-service.ts), which keeps its codes next to these tables. */
  readonly sql: SqlExec;
  private readonly media: MediaStore;
  readonly resident: (id: string) => Resident | undefined;
  private readonly entitledTo: (id: string) => readonly string[];
  private readonly limits: SocialLimits;
  readonly now: () => number;
  private readonly townsfolk: ReadonlySet<string>;
  private readonly readXPost: XPostReader;
  private readonly maintainers: ReadonlySet<string>;
  private readonly moderators: ReadonlySet<string>;
  private readonly votesCast: ((id: string) => number) | undefined;
  /** The edge filters for posts, bios, notices, letters, and gesture notes. */
  readonly moderation: Moderation;

  constructor(options: SocialServiceOptions) {
    this.sql = options.sql;
    this.media = options.media;
    // Ids come from routes and bodies: one that every object inherits (`__proto__`, `toString`)
    // is nobody, however the world's lookup is wired.
    this.resident = (id) => (isOwnableKey(id) ? options.resident(id) : undefined);
    this.entitledTo = options.entitledTo ?? (() => []);
    this.limits = { ...DEFAULT_SOCIAL_LIMITS, ...options.limits };
    this.now = options.now ?? Date.now;
    this.townsfolk = options.townsfolk ?? new Set();
    this.readXPost = options.readXPost ?? oembedReader();
    this.maintainers = options.maintainers ?? new Set();
    this.moderators = options.moderators ?? new Set();
    this.votesCast = options.votesCast;
    this.moderation =
      options.moderation ??
      new Moderation({
        now: this.now,
        privileged: (id) => this.townsfolk.has(id) || this.maintainers.has(id),
      });
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
      // Likes from before reactions. Moved into `reactions` as hearts below; kept so old data loads.
      `CREATE TABLE IF NOT EXISTS likes (
        post_id TEXT NOT NULL, resident_id TEXT NOT NULL, PRIMARY KEY (post_id, resident_id)
      )`,
      `CREATE TABLE IF NOT EXISTS reactions (
        post_id TEXT NOT NULL, resident_id TEXT NOT NULL, key TEXT NOT NULL,
        created_at INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (post_id, resident_id, key)
      )`,
      "INSERT OR IGNORE INTO reactions (post_id, resident_id, key) SELECT post_id, resident_id, 'heart' FROM likes",
      "DELETE FROM likes",
      `CREATE TABLE IF NOT EXISTS reposts (
        n INTEGER PRIMARY KEY AUTOINCREMENT,
        post_id TEXT NOT NULL,
        resident_id TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        UNIQUE (post_id, resident_id)
      )`,
      "CREATE INDEX IF NOT EXISTS reposts_resident ON reposts (resident_id, created_at)",
      `CREATE TABLE IF NOT EXISTS post_quotes (
        post_id TEXT PRIMARY KEY, quote_of TEXT NOT NULL
      )`,
      "CREATE INDEX IF NOT EXISTS post_quotes_of ON post_quotes (quote_of)",
      `CREATE TABLE IF NOT EXISTS post_mentions (
        post_id TEXT NOT NULL, ord INTEGER NOT NULL, resident_id TEXT NOT NULL, handle TEXT NOT NULL,
        PRIMARY KEY (post_id, ord)
      )`,
      `CREATE TABLE IF NOT EXISTS follows (
        follower TEXT NOT NULL, followee TEXT NOT NULL, PRIMARY KEY (follower, followee)
      )`,
      "CREATE INDEX IF NOT EXISTS follows_followee ON follows (followee)",
      `CREATE TABLE IF NOT EXISTS profiles (
        resident_id TEXT PRIMARY KEY, bio TEXT NOT NULL DEFAULT '', avatar TEXT
      )`,
      // One row per handle ever claimed. `released_at` is 0 while it's in use. A released row stays
      // (so old links still find its owner) until someone else claims it after the hold.
      `CREATE TABLE IF NOT EXISTS handles (
        handle TEXT PRIMARY KEY,
        resident_id TEXT NOT NULL,
        claimed_at INTEGER NOT NULL,
        released_at INTEGER NOT NULL DEFAULT 0
      )`,
      "CREATE INDEX IF NOT EXISTS handles_resident ON handles (resident_id, released_at)",
      // `seq` orders the list and moves to the top when a grouped notification gains someone.
      `CREATE TABLE IF NOT EXISTS notifications (
        id TEXT PRIMARY KEY,
        recipient TEXT NOT NULL,
        type TEXT NOT NULL,
        actor TEXT NOT NULL,
        post_id TEXT NOT NULL DEFAULT '',
        detail TEXT NOT NULL DEFAULT '',
        group_key TEXT NOT NULL DEFAULT '',
        count INTEGER NOT NULL DEFAULT 1,
        seq INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        read INTEGER NOT NULL DEFAULT 0
      )`,
      "CREATE INDEX IF NOT EXISTS notifications_recipient ON notifications (recipient, seq)",
      "CREATE INDEX IF NOT EXISTS notifications_seq ON notifications (seq)",
      "CREATE INDEX IF NOT EXISTS notifications_post ON notifications (post_id)",
      `CREATE TABLE IF NOT EXISTS notification_actors (
        notification_id TEXT NOT NULL, actor TEXT NOT NULL, PRIMARY KEY (notification_id, actor)
      )`,
      // Every notification event, for the per-actor daily cap. Pruned after two days.
      `CREATE TABLE IF NOT EXISTS notification_log (
        actor TEXT NOT NULL, recipient TEXT NOT NULL, created_at INTEGER NOT NULL
      )`,
      "CREATE INDEX IF NOT EXISTS notification_log_pair ON notification_log (actor, recipient, created_at)",
      // Connected X accounts (decision 0022): the handle and the proving post's link, nothing else.
      `CREATE TABLE IF NOT EXISTS x_links (
        resident_id TEXT PRIMARY KEY,
        handle TEXT NOT NULL,
        handle_key TEXT NOT NULL,
        status_url TEXT NOT NULL,
        verified_at INTEGER NOT NULL
      )`,
      "CREATE INDEX IF NOT EXISTS x_links_handle ON x_links (handle_key)",
      // One pending code per resident, gone once used, unlinked, or an hour old.
      `CREATE TABLE IF NOT EXISTS x_codes (
        resident_id TEXT PRIMARY KEY, code TEXT NOT NULL, expires_at INTEGER NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS blocks (
        blocker TEXT NOT NULL, blocked TEXT NOT NULL, PRIMARY KEY (blocker, blocked)
      )`,
      // The Town Hall notice board. Removed notices keep their row, with who took them down and
      // when: that is the removal log.
      `CREATE TABLE IF NOT EXISTS notices (
        n INTEGER PRIMARY KEY AUTOINCREMENT,
        id TEXT NOT NULL UNIQUE,
        author TEXT NOT NULL,
        text TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        removed_at INTEGER,
        removed_by TEXT
      )`,
      "CREATE INDEX IF NOT EXISTS notices_author ON notices (author, created_at)",
      "CREATE INDEX IF NOT EXISTS notices_created ON notices (created_at)",
      // A maintainer's answer to a passed advisory.
      `CREATE TABLE IF NOT EXISTS petition_answers (
        proposal_id TEXT PRIMARY KEY,
        text TEXT NOT NULL,
        answered_by TEXT NOT NULL,
        answered_at INTEGER NOT NULL
      )`,
      // Uploads a resident's world look names (pattern, home picture, home model). The world log
      // is the truth; this mirror only keeps the sweep from deleting media the world still shows.
      `CREATE TABLE IF NOT EXISTS look_media (
        resident_id TEXT NOT NULL, media_id TEXT NOT NULL, PRIMARY KEY (resident_id, media_id)
      )`,
      "CREATE INDEX IF NOT EXISTS look_media_media ON look_media (media_id)",
      // Uploads a piece of art shows (RFC 0005 step 3), one row per piece. A piece lasts as long
      // as the world, so its upload is never swept; staff can still take the file down.
      `CREATE TABLE IF NOT EXISTS piece_media (
        item_id TEXT PRIMARY KEY, media_id TEXT NOT NULL
      )`,
      "CREATE INDEX IF NOT EXISTS piece_media_media ON piece_media (media_id)",
      // An agent and the human who runs it, one owner per agent (owner-service.ts).
      `CREATE TABLE IF NOT EXISTS owner_links (
        agent_id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, created_at INTEGER NOT NULL
      )`,
      "CREATE INDEX IF NOT EXISTS owner_links_owner ON owner_links (owner_id, created_at)",
    ]) {
      this.sql.exec(statement);
    }
    // Added after launch: when the profile last changed (for sitemap lastmod), and the banner
    // picture. Older rows stay null.
    for (const column of ["updated_at INTEGER", "banner TEXT"]) {
      try {
        this.sql.exec(`ALTER TABLE profiles ADD COLUMN ${column}`);
      } catch {
        // Already there.
      }
    }
    // Added with karma (decision 0055): when each reaction was left. Reactions from before then
    // take their post's time, the closest thing on record.
    try {
      this.sql.exec("ALTER TABLE reactions ADD COLUMN created_at INTEGER NOT NULL DEFAULT 0");
    } catch {
      // Already there.
    }
    this.sql.exec("CREATE INDEX IF NOT EXISTS reactions_created ON reactions (created_at)");
    // Every boot, so a backfill that stopped partway finishes. Only undated rows are touched.
    this.sql.exec(
      `UPDATE reactions SET created_at =
        COALESCE((SELECT created_at FROM posts WHERE posts.id = reactions.post_id), 0)
        WHERE created_at = 0`,
    );
    // Added later: an image's size in pixels, read from its header at upload. Null for older
    // uploads, videos, models, and images whose header we couldn't read.
    for (const column of ["width INTEGER", "height INTEGER"]) {
      try {
        this.sql.exec(`ALTER TABLE media ADD COLUMN ${column}`);
      } catch {
        // Already there.
      }
    }
    this.together = new TogetherService({
      sql: this.sql,
      media: this.media,
      resident: this.resident,
      now: this.now,
      limits: this.limits,
      author: (id) => this.authorView(id),
      blockedEither: (a, b) => this.blockedEither(a, b),
      release: (id) => this.releaseIfUnused(id),
      notify: (recipient, actor, type, detail) => this.notify(recipient, actor, type, "", detail),
      review: (surface, text, context) => this.moderation.review(surface, text, context),
    });
    this.checkins = new CheckinLog(this.sql, this.now);
    this.away = new AwayLog(this.sql, this.now);
    this.praise = new PraiseService({
      sql: this.sql,
      now: this.now,
      exists: (id) => this.resident(id) !== undefined,
      blockedEither: (a, b) => this.blockedEither(a, b),
      ageDays: options.residentAgeDays ?? (() => Number.POSITIVE_INFINITY),
      notify: (recipient, actor) => this.notify(recipient, actor, "praise", ""),
    });
    this.pets = new PetPatService({
      sql: this.sql,
      now: this.now,
      petOf: (id) => this.resident(id)?.pet,
      exists: (id) => this.resident(id) !== undefined,
      blockedEither: (a, b) => this.blockedEither(a, b),
      notify: (owner, patter, pet) => this.notify(owner, patter, "pet_pat", "", petDetail(pet)),
      patted: (owner) => this.onPetPatted?.(owner),
    });
    this.safety = new SafetyService({
      sql: this.sql,
      now: this.now,
      resident: this.resident,
      author: (id) => this.authorView(id),
      cannotBeSuspended: (id) => this.isMaintainer(id) || this.isModerator(id),
      neverAutoHidden: (id) =>
        this.isMaintainer(id) || this.isModerator(id) || this.isTownsfolk(id),
      residentAgeDays: options.residentAgeDays ?? (() => Number.POSITIVE_INFINITY),
      proposal: options.proposal ?? (() => undefined),
      bounty: options.bounty,
      event: options.event,
      postMedia: (postId) => this.mediaFor([postId]).get(postId) ?? [],
      profileMedia: (residentId) => this.profileMedia(residentId),
      uploadMedia: (mediaId) => this.uploadMedia(mediaId),
      dropPostMedia: async (postId) => {
        const media = this.rows("SELECT media_id FROM post_media WHERE post_id = ?", postId);
        let kept = 0;
        for (const m of media) if (!(await this.purgeMedia(String(m.media_id)))) kept++;
        return kept;
      },
      purgeMedia: (mediaId) => this.purgeMedia(mediaId),
      takedown: (owner, notice, excerptOf) => this.takedownNotice(owner, notice, excerptOf),
      moderation: () => [this.moderation],
      triage: options.triage,
    });
    this.events = new EventsSocial({ sql: this.sql, now: this.now });
    this.plots = new PlotVisits({
      sql: this.sql,
      now: this.now,
      exists: (id) => this.resident(id) !== undefined,
      blockedEither: (a, b) => this.blockedEither(a, b),
      household: (a, b) => (this.ownerOf(a) ?? a) === (this.ownerOf(b) ?? b),
      ageDays: options.residentAgeDays ?? (() => Number.POSITIVE_INFINITY),
      suspended: (id) => this.safety.suspendedUntil(id) !== undefined,
      notify: (recipient, actor, plot) =>
        this.notify(recipient, actor, "plot_admired", "", `${plot.px},${plot.py}`),
    });
    this.karma = new KarmaService({
      sql: this.sql,
      now: this.now,
      townsfolk: this.townsfolk,
      suspended: (id) => this.safety.suspendedUntil(id) !== undefined,
      ownerPairs: () => this.ownerPairs(),
      credits: options.credits,
      hosting: (from, to) => this.events.karmaFacts(from, to),
      upheldAgainst: (from, to) => this.safety.upheldAgainst(from, to),
      resident: this.resident,
      ageDays: options.residentAgeDays ?? (() => Number.POSITIVE_INFINITY),
    });
    this.agentLinks = new AgentLinkService(
      { sql: this.sql, now: this.now, moderation: this.moderation },
      options.agentLinks,
    );
    const links = this.agentLinks;
    this.partnerArt = new PartnerArtService({
      sql: this.sql,
      now: this.now,
      readArt: options.agentLinks?.readArt ?? httpArtReader(),
      wanted: (id) => links.artWanted(id),
      spendRead: (pool) => links.spendRead(pool),
      uploadRoom: (id) => this.uploadRoom(id, 1).ok,
      avatarOf: (id) => {
        const row = this.rows("SELECT avatar FROM profiles WHERE resident_id = ?", id)[0];
        return row?.avatar ? String(row.avatar) : undefined;
      },
      setAvatar: (id, media) => {
        this.sql.exec("INSERT OR IGNORE INTO profiles (resident_id) VALUES (?)", id);
        this.sql.exec(
          "UPDATE profiles SET avatar = ?, updated_at = ? WHERE resident_id = ?",
          media ?? "",
          this.now(),
          id,
        );
      },
      upload: (id, bytes) => this.upload(id, bytes),
      release: (media) => this.releaseIfUnused(media),
    });
    links.onChange = async (ids, pool) => {
      // Each on its own, so one failure never strands another resident's picture or wear.
      for (const id of ids) {
        try {
          await this.partnerArt.sync(id, pool);
        } catch (err) {
          report(err, "partner_art.sync");
        }
        try {
          this.onPartnerPerks?.(id);
        } catch (err) {
          report(err, "partner_perks.sync");
        }
      }
    };
  }

  /** Agent links and partner badges (RFC 0007). Shares this service's tables. */
  readonly agentLinks: AgentLinkService;
  /** A partner character's own picture as its avatar (RFC 0007 phase 2). */
  readonly partnerArt: PartnerArtService;
  /**
   * Called after a resident's partner perks may have changed: a link made, ended, or rechecked.
   * `Api` logs their partner wear to the world from it (`set_entitlements`).
   */
  onPartnerPerks: ((residentId: string) => void) | undefined;

  /** A resident's party-game ladders (RFC 0011), from the world. `Api` wires it; profiles show it. */
  gameRatings: (residentId: string) => GameRatingView[] = () => [];

  /** Letters, gestures, streaks, and invites (decision 0024). Shares this service's tables. */
  readonly together: TogetherService;
  /** Reports, hiding, suspensions, and the moderation log (RFC 0006). Shares this service's tables. */
  readonly safety: SafetyService;
  /** Praise (issue #36): once a UTC day per pair, a count on profiles, no economy. */
  readonly praise: PraiseService;
  /** Pats (RFC 0019): once a UTC day per pet, a count on its owner's profile, no economy. */
  readonly pets: PetPatService;
  /**
   * Called with the owner each time someone pats their pet. `Api` tells every world socket, so the
   * pet looks happy wherever it's drawn.
   */
  onPetPatted: ((owner: string) => void) | undefined;
  /** Plots worth visiting (RFC 0020): who visited and admired each plot, and when it changed. */
  readonly plots: PlotVisits;
  /** When residents check in, for the staff app's numbers. */
  readonly checkins: CheckinLog;
  /** What routines did while their residents were away, and each resident's last call (RFC 0009). */
  readonly away: AwayLog;
  /** Karma (decision 0055): standing over 90 days, on profiles, and the daily appreciation coins. */
  readonly karma: KarmaService;
  /** Hosted events' social side (RFC 0010): who's going, and each host's record. */
  readonly events: EventsSocial;

  /**
   * What the event views need for one viewer, read once: going counts, the viewer's own, and the
   * hosts they shouldn't see (blocked either way, or suspended).
   */
  eventContext(viewer: string | undefined): EventContext {
    const blocked = viewer === undefined ? new Set<string>() : this.blockedWith(viewer);
    const suspended = new Map<string, boolean>();
    return {
      now: this.now(),
      author: (id) => this.authorView(id),
      going: (event) => this.events.going(event),
      mine: viewer === undefined ? new Set() : this.events.goingOf(viewer),
      hidden: (host) => {
        if (blocked.has(host)) return true;
        let shut = suspended.get(host);
        if (shut === undefined) {
          shut = this.safety.suspendedUntil(host) !== undefined;
          suspended.set(host, shut);
        }
        return shut;
      },
    };
  }

  /** Review text with the edge filters as one resident. */
  review(surface: Surface, text: string, context: ReviewContext) {
    return this.moderation.review(surface, text, context);
  }

  private rows(query: string, ...bindings: Binding[]): Row[] {
    return [...this.sql.exec(query, ...bindings)];
  }

  private count(query: string, ...bindings: Binding[]): number {
    return Number(this.rows(query, ...bindings)[0]?.c ?? 0);
  }

  // ---------- posts ----------

  /**
   * Post or reply. `network` is the author's `ipKey()`, for the filters' check on many residents
   * sending the same words from one place.
   */
  createPost(
    authorId: string,
    request: CreatePostRequest,
    network?: string,
  ): SocialResult<PostView> {
    if (!this.resident(authorId)) return fail("unauthorized", "Unknown resident.");
    const text = cleanMultiline(request.text);
    if (text === "") return fail("bad_request", "Empty post.");
    const verdict = this.moderation.review(request.replyTo ? "reply" : "post", text, {
      resident: authorId,
      network,
    });
    if (!verdict.ok) return refusal(verdict) ?? fail("bad_request", "Not posted.");
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
    const parent = request.replyTo ? this.visiblePost(request.replyTo) : undefined;
    if (request.replyTo && !parent) {
      return fail("not_found", "The post you're replying to doesn't exist.");
    }
    const quoted = request.quote ? this.visiblePost(request.quote) : undefined;
    if (request.quote && !quoted) {
      return fail("not_found", "The post you're quoting doesn't exist.");
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
    if (request.quote) {
      this.sql.exec("INSERT INTO post_quotes (post_id, quote_of) VALUES (?, ?)", id, request.quote);
    }
    const mentions = this.resolveMentions(text);
    mentions.forEach((m, ord) => {
      this.sql.exec(
        "INSERT INTO post_mentions (post_id, ord, resident_id, handle) VALUES (?, ?, ?, ?)",
        id,
        ord,
        m.id,
        m.handle,
      );
    });

    // One notification per person per post: a reply beats a quote, and either beats a mention.
    const told = new Set([authorId]);
    const tell = (recipient: string | undefined, type: NotificationType) => {
      if (!recipient || told.has(recipient)) return;
      told.add(recipient);
      this.notify(recipient, authorId, type, id);
    };
    tell(parent ? String(parent.author) : undefined, "reply");
    tell(quoted ? String(quoted.author) : undefined, "quote");
    for (const m of mentions) tell(m.id, "mention");

    verdict.commit();
    if (verdict.borderline) this.safety.requestTriage("post", id);
    const post = this.post(id, authorId);
    if (!post) return fail("internal", "Post vanished.");
    if (!request.replyTo) this.onPost?.(post);
    return { ok: true, value: post };
  }

  /**
   * Called with each new top-level post (not replies) once it's stored and visible. `Api` points
   * it at the open sockets.
   */
  onPost: ((post: PostView) => void) | undefined;

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
    this.sql.exec("DELETE FROM reactions WHERE post_id = ?", postId);
    this.sql.exec("DELETE FROM reposts WHERE post_id = ?", postId);
    this.sql.exec("DELETE FROM post_mentions WHERE post_id = ?", postId);
    // Quotes of this post keep their row, so they can say the post is gone.
    this.sql.exec("DELETE FROM post_quotes WHERE post_id = ?", postId);
    this.sql.exec(
      "DELETE FROM notification_actors WHERE notification_id IN (SELECT id FROM notifications WHERE post_id = ?)",
      postId,
    );
    this.sql.exec("DELETE FROM notifications WHERE post_id = ?", postId);
    // A takedown notice about it quotes its start: that goes with the post.
    this.sql.exec(
      "DELETE FROM notifications WHERE type = 'takedown' AND instr(detail, ?) > 0",
      `"id":${JSON.stringify(postId)}`,
    );
    for (const id of media) await this.releaseIfUnused(id);
    return { ok: true, value: null };
  }

  /**
   * One post as `viewerId` sees it, or undefined if it doesn't exist or is hidden. `parents` adds
   * the post a reply answers, for the post's own page.
   */
  post(postId: string, viewerId?: string, parents = false): PostView | undefined {
    const rows = this.rows(
      `SELECT ${POST_COLUMNS} FROM posts p WHERE p.id = ? AND p.hidden = 0 AND ${NOT_SUSPENDED("p.author")}`,
      viewerId ?? "",
      postId,
      this.now(),
    );
    return this.views(rows, viewerId, parents)[0];
  }

  replies(postId: string, viewerId?: string): PostView[] {
    return this.views(
      this.rows(
        `SELECT ${POST_COLUMNS} FROM posts p WHERE p.reply_to = ? AND p.hidden = 0
          AND p.author NOT IN (SELECT blocked FROM blocks WHERE blocker = ?)
          AND ${NOT_SUSPENDED("p.author")}
          ORDER BY p.n ASC LIMIT 200`,
        viewerId ?? "",
        postId,
        viewerId ?? "",
        this.now(),
      ),
      viewerId,
    );
  }

  /**
   * Newest first. `before` is the cursor from the previous page. The main feed is top-level posts
   * only. The following feed adds reposts by you and the people you follow, and one resident's
   * page (`author`) shows their posts, replies, and reposts. A post shows up once per page, at its
   * newest place.
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
    if (options.author)
      return this.mixedFeed({ authors: "one", id: options.author }, options, limit);
    if (options.following && options.viewerId) {
      return this.mixedFeed({ authors: "followed", id: options.viewerId }, options, limit);
    }
    const before = Number.parseInt(options.before ?? "", 36);
    const where = ["p.hidden = 0", "p.reply_to = ''", NOT_SUSPENDED("p.author")];
    const bindings: Binding[] = [options.viewerId ?? "", this.now()];
    if (Number.isFinite(before)) {
      where.push("p.n < ?");
      bindings.push(before);
    }
    // Someone you blocked drops out of your feeds. Their own page still shows their posts.
    if (options.viewerId) {
      where.push("p.author NOT IN (SELECT blocked FROM blocks WHERE blocker = ?)");
      bindings.push(options.viewerId);
    }
    const rows = this.rows(
      `SELECT ${POST_COLUMNS} FROM posts p WHERE ${where.join(" AND ")} ORDER BY p.n DESC LIMIT ?`,
      ...bindings,
      limit + 1,
    );
    const page = rows.slice(0, limit);
    const last = page.at(-1);
    return {
      posts: this.views(page, options.viewerId),
      next: rows.length > limit && last ? Number(last.n).toString(36) : null,
    };
  }

  /**
   * Posts and reposts in one timeline, ordered by when each was posted or reposted. Ties in time go
   * by a number that is unique across both tables (posts even, reposts odd).
   */
  private mixedFeed(
    who: { authors: "one" | "followed"; id: string },
    options: { viewerId?: string | undefined; before?: string | undefined },
    limit: number,
  ): { posts: PostView[]; next: string | null } {
    const people =
      who.authors === "one"
        ? { sql: "= ?", bindings: [who.id] }
        : {
            sql: "IN (SELECT ? UNION SELECT followee FROM follows WHERE follower = ?)",
            bindings: [who.id, who.id],
          };
    // Someone the viewer blocked drops out: their posts in the following feed, and their posts and
    // reposts as reposts anywhere. A resident's own page still shows their own posts.
    const viewer = options.viewerId ?? "";
    const unblocked = (column: string) =>
      `${column} NOT IN (SELECT blocked FROM blocks WHERE blocker = ?)`;
    const cursor = this.feedCursor(options.before);
    const after = cursor ? "WHERE at < ? OR (at = ? AND tb < ?)" : "";
    // Duplicates (a post and its reposts) fold into one item, so read ahead a little.
    const fetch = limit * 3 + 1;
    const raw = this.rows(
      `SELECT * FROM (
        SELECT p.id AS post_id, p.created_at AS at, p.n * 2 AS tb, '' AS by FROM posts p
          WHERE p.hidden = 0 AND p.author ${people.sql}
          ${who.authors === "followed" ? `AND p.reply_to = '' AND ${unblocked("p.author")}` : ""}
        UNION ALL
        SELECT r.post_id, r.created_at, r.n * 2 + 1, r.resident_id FROM reposts r
          JOIN posts p ON p.id = r.post_id AND p.hidden = 0
          WHERE r.resident_id ${people.sql}
            AND ${unblocked("p.author")} AND ${unblocked("r.resident_id")}
      ) ${after} ORDER BY at DESC, tb DESC LIMIT ?`,
      ...people.bindings,
      ...(who.authors === "followed" ? [viewer] : []),
      ...people.bindings,
      viewer,
      viewer,
      ...(cursor ? [cursor.at, cursor.at, cursor.tb] : []),
      fetch,
    );
    const items: Row[] = [];
    const seen = new Set<string>();
    let last: Row | undefined;
    let used = 0;
    for (const row of raw) {
      if (items.length === limit) break;
      used++;
      last = row;
      const id = String(row.post_id);
      if (seen.has(id)) continue;
      seen.add(id);
      items.push(row);
    }
    const more = used < raw.length || raw.length === fetch;
    const ids = items.map((row) => String(row.post_id));
    const views = new Map(
      this.views(
        ids.length
          ? this.rows(
              `SELECT ${POST_COLUMNS} FROM posts p WHERE p.id IN (${marks(ids.length)})
                AND ${NOT_SUSPENDED("p.author")}`,
              options.viewerId ?? "",
              ...ids,
              this.now(),
            )
          : [],
        options.viewerId,
        true,
      ).map((v) => [v.id, v]),
    );
    const posts = items.flatMap((row) => {
      const view = views.get(String(row.post_id));
      if (!view) return [];
      if (!row.by) return [view];
      if (this.safety.suspendedUntil(String(row.by)) !== undefined) return [];
      const by = this.authorById(String(row.by));
      if (!by) return [view];
      return [{ ...view, repostedBy: by, repostedAt: new Date(Number(row.at)).toISOString() }];
    });
    return {
      posts,
      next: more && last ? `${Number(last.at).toString(36)}.${Number(last.tb).toString(36)}` : null,
    };
  }

  /** A mixed-feed cursor, or a plain post cursor from before reposts existed. */
  private feedCursor(before: string | undefined): FeedKey | undefined {
    if (!before) return undefined;
    const pair = /^([0-9a-z]+)\.([0-9a-z]+)$/.exec(before);
    if (pair) {
      const at = Number.parseInt(pair[1] ?? "", 36);
      const tb = Number.parseInt(pair[2] ?? "", 36);
      return Number.isFinite(at) && Number.isFinite(tb) ? { at, tb } : undefined;
    }
    const n = Number.parseInt(before, 36);
    if (!Number.isFinite(n)) return undefined;
    const row = this.rows("SELECT created_at FROM posts WHERE n = ?", n)[0];
    return row ? { at: Number(row.created_at), tb: n * 2 } : undefined;
  }

  // ---------- reactions and reposts ----------

  /** A like is a heart reaction. */
  setLike(residentId: string, postId: string, liked: boolean): SocialResult<PostView> {
    return this.setReaction(residentId, postId, "heart", liked);
  }

  setReaction(
    residentId: string,
    postId: string,
    key: ReactionKey,
    on: boolean,
  ): SocialResult<PostView> {
    const target = this.visiblePost(postId);
    if (!target) return fail("not_found", "No such post.");
    if (on) {
      const had = this.count(
        "SELECT COUNT(*) AS c FROM reactions WHERE post_id = ? AND resident_id = ? AND key = ?",
        postId,
        residentId,
        key,
      );
      if (!had) {
        this.sql.exec(
          "INSERT OR IGNORE INTO reactions (post_id, resident_id, key, created_at) VALUES (?, ?, ?, ?)",
          postId,
          residentId,
          key,
          this.now(),
        );
        this.notify(String(target.author), residentId, "reaction", postId, key);
      }
    } else {
      this.sql.exec(
        "DELETE FROM reactions WHERE post_id = ? AND resident_id = ? AND key = ?",
        postId,
        residentId,
        key,
      );
    }
    const post = this.post(postId, residentId);
    return post ? { ok: true, value: post } : fail("not_found", "No such post.");
  }

  /** Repost or take it back. Reposting your own post is allowed, and tells nobody. */
  setRepost(residentId: string, postId: string, on: boolean): SocialResult<PostView> {
    const target = this.visiblePost(postId);
    if (!target) return fail("not_found", "No such post.");
    if (on) {
      const had = this.count(
        "SELECT COUNT(*) AS c FROM reposts WHERE post_id = ? AND resident_id = ?",
        postId,
        residentId,
      );
      if (!had) {
        this.sql.exec(
          "INSERT OR IGNORE INTO reposts (post_id, resident_id, created_at) VALUES (?, ?, ?)",
          postId,
          residentId,
          this.now(),
        );
        this.notify(String(target.author), residentId, "repost", postId);
      }
    } else {
      this.sql.exec(
        "DELETE FROM reposts WHERE post_id = ? AND resident_id = ?",
        postId,
        residentId,
      );
    }
    const post = this.post(postId, residentId);
    return post ? { ok: true, value: post } : fail("not_found", "No such post.");
  }

  // ---------- sitemaps ----------

  /**
   * Sitemap pages of `size` URLs: how many URLs each holds and its newest change (ms, or null).
   * Residents count once they have a visible post or have set up a profile; posts are top-level and
   * visible. Hidden posts never count: a resident whose only posts are hidden is listed only if they
   * set up a profile, and then dated by that.
   */
  sitemapPages(
    kind: "residents" | "posts",
    size: number,
  ): { count: number; lastmod: number | null }[] {
    const rows = this.rows(
      `SELECT page, COUNT(*) AS c, MAX(t) AS t FROM (
        SELECT CAST((ROW_NUMBER() OVER (ORDER BY k) - 1) / ? AS INTEGER) AS page, t FROM (${SITEMAP_SOURCES[kind]})
      ) GROUP BY page ORDER BY page`,
      size,
    );
    return rows.map((row) => ({
      count: Number(row.c),
      lastmod: row.t === null || row.t === undefined ? null : Number(row.t),
    }));
  }

  /** One sitemap page (from 0): ids with their newest change (ms, or null). */
  sitemapEntries(
    kind: "residents" | "posts",
    page: number,
    size: number,
  ): { id: string; lastmod: number | null }[] {
    return this.rows(
      `SELECT id, t FROM (${SITEMAP_SOURCES[kind]}) ORDER BY k LIMIT ? OFFSET ?`,
      size,
      page * size,
    )
      .filter((row) => kind === "posts" || this.resident(String(row.id)))
      .map((row) => ({
        id: String(row.id),
        lastmod: row.t === null || row.t === undefined ? null : Number(row.t),
      }));
  }

  // ---------- people ----------

  setFollow(follower: string, followee: string, follow: boolean): SocialResult<ProfileView> {
    if (follower === followee) return fail("bad_request", "You can't follow yourself.");
    if (!this.resident(followee)) return fail("not_found", "No such resident.");
    const had = this.count(
      "SELECT COUNT(*) AS c FROM follows WHERE follower = ? AND followee = ?",
      follower,
      followee,
    );
    this.sql.exec(
      follow
        ? "INSERT OR IGNORE INTO follows (follower, followee) VALUES (?, ?)"
        : "DELETE FROM follows WHERE follower = ? AND followee = ?",
      follower,
      followee,
    );
    if (follow && !had) this.notify(followee, follower, "follow", "");
    const profile = this.profile(followee, follower);
    return profile ? { ok: true, value: profile } : fail("not_found", "No such resident.");
  }

  /** Who someone follows, most recent first. */
  following(residentId: string): SocialResult<AuthorView[]> {
    return this.residentList(residentId, `${FOLLOWING_IDS} ORDER BY a.rowid DESC LIMIT ?`);
  }

  /** Who follows someone, most recent first. */
  followers(residentId: string): SocialResult<AuthorView[]> {
    return this.residentList(residentId, `${FOLLOWER_IDS} ORDER BY a.rowid DESC LIMIT ?`);
  }

  /** Their friends: the residents they follow who follow them back, most recently followed first. */
  friends(residentId: string): SocialResult<AuthorView[]> {
    return this.residentList(residentId, `${FRIEND_IDS} ORDER BY a.rowid DESC LIMIT ?`);
  }

  private residentList(residentId: string, sql: string): SocialResult<AuthorView[]> {
    if (!this.resident(residentId)) return fail("not_found", "No such resident.");
    const ids = this.rows(sql, residentId, FOLLOWING_LIST_MAX).map((row) => String(row.id));
    return { ok: true, value: ids.flatMap((id) => this.authorById(id) ?? []) };
  }

  profile(residentId: string, viewerId?: string): ProfileView | undefined {
    const r = this.resident(residentId);
    if (!r) return undefined;
    const quarantined = this.safety.isQuarantined(residentId);
    const extra = this.rows(
      `SELECT bio, avatar, banner,
        (SELECT COUNT(*) FROM posts WHERE author = ? AND hidden = 0) AS posts,
        (SELECT COUNT(*) FROM (${FOLLOWER_IDS})) AS followers,
        (SELECT COUNT(*) FROM (${FOLLOWING_IDS})) AS following,
        (SELECT COUNT(*) FROM (${FRIEND_IDS})) AS friends,
        (SELECT COUNT(*) FROM follows WHERE follower = ? AND followee = ?) AS followed,
        (SELECT handle FROM handles WHERE resident_id = ? AND released_at = 0) AS handle,
        (SELECT handle FROM x_links WHERE x_links.resident_id = ?) AS x_handle
      FROM (SELECT 1) LEFT JOIN profiles ON resident_id = ?`,
      residentId,
      residentId,
      residentId,
      residentId,
      viewerId ?? "",
      residentId,
      residentId,
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
      // A quarantined resident's words stay out of view until staff release them (RFC 0006).
      note: quarantined ? "" : r.note,
      bio: quarantined ? "" : String(extra?.bio ?? ""),
      avatar: extra?.avatar ? mediaUrl(String(extra.avatar)) : null,
      ...(extra?.banner ? { banner: mediaUrl(String(extra.banner)) } : {}),
      ...(this.townsfolk.has(r.id) ? { townsfolk: true } : {}),
      ...(extra?.handle ? { handle: String(extra.handle) } : {}),
      ...xAccount(extra?.x_handle),
      ...lookField(r),
      online: r.online,
      posts: Number(extra?.posts ?? 0),
      followers: Number(extra?.followers ?? 0),
      following: Number(extra?.following ?? 0),
      friends: Number(extra?.friends ?? 0),
      followed: Number(extra?.followed ?? 0) > 0,
      ...optionalStreak(this.together.longestStreak(r.id)),
      praise: this.praise.received(r.id),
      ...(viewerId && viewerId !== r.id && this.praise.givenToday(viewerId, r.id)
        ? { praisedToday: true }
        : {}),
      karma: this.karma.of(r.id),
      ...(viewerId && this.blocks(viewerId, r.id) ? { blocked: true } : {}),
      ...(this.votesCast ? { votes: this.votesCast(r.id) } : {}),
      ...this.hostingField(r.id),
      ...this.gamesField(r.id),
      ...this.ownerFields(r.id),
      ...this.keeperField(r),
      ...(this.safety.suspendedUntil(r.id) === undefined ? {} : { suspended: true }),
      ...this.partnerField(r.id),
      ...this.agentLinkField(r.id),
      ...this.entitledField(r.id),
      ...this.petField(r, viewerId, quarantined),
    };
  }

  /**
   * Their pet (RFC 0019), with how many residents have patted it and whether the caller has today.
   * A quarantined owner's words stay out of view, its name too.
   */
  private petField(
    r: Resident,
    viewerId: string | undefined,
    quarantined: boolean,
  ): { pet?: NonNullable<ProfileView["pet"]> } {
    if (!r.pet) return {};
    return {
      pet: {
        ...petView(r.pet),
        ...(quarantined ? { name: "" } : {}),
        pats: this.pets.pats(r.id),
        ...(viewerId && viewerId !== r.id && this.pets.pattedToday(viewerId, r.id)
          ? { pattedToday: true as const }
          : {}),
      },
    };
  }

  /** Events they hosted in the last 90 days and the guests who counted (RFC 0010). */
  private hostingField(id: string): { hosting?: HostingView } {
    const hosting = this.events.hostingOf(id);
    return hosting ? { hosting } : {};
  }

  /** Their party-game ladders, when they've played rated (RFC 0011). */
  private gamesField(id: string): { games?: GameRatingView[] } {
    const games = this.gameRatings(id);
    return games.length > 0 ? { games } : {};
  }

  /** Partner wear they may put on now (RFC 0007 phase 3), from the world's own list. */
  private entitledField(id: string): { entitled?: PartnerWear[] } {
    const items = this.entitledTo(id).filter(isExclusiveWear);
    return items.length > 0 ? { entitled: [...items] } : {};
  }

  /** The partner badge, when they proved they are a partner's character (RFC 0007). */
  private partnerField(id: string): { partner?: PartnerBadge } {
    const partner = this.agentLinks.badge(id);
    return partner ? { partner } : {};
  }

  private agentLinkField(id: string): { agentLink?: AgentLinkView } {
    const agentLink = this.agentLinks.view(id);
    if (!agentLink) return {};
    // The badge sits on the profile itself; the link carries only the agent.
    const { partner: _partner, ...rest } = agentLink;
    return { agentLink: rest };
  }

  // ---------- town hall: grants, the notice board, petition answers ----------

  /** A moderator (`TERRAKIN_MODERATORS`): works the review queue, nothing more. */
  isModerator(residentId: string): boolean {
    return this.moderators.has(residentId);
  }

  isMaintainer(residentId: string): boolean {
    return this.maintainers.has(residentId);
  }

  isTownsfolk(residentId: string): boolean {
    return this.townsfolk.has(residentId);
  }

  /** The board, newest first: notices up for less than two days and not taken down. */
  board(viewerId?: string): NoticeView[] {
    const rows = this.rows(
      `SELECT id, author, text, created_at FROM notices
        WHERE removed_at IS NULL AND created_at > ? ORDER BY n DESC LIMIT ?`,
      this.now() - BOARD_LIMITS.days * DAY_MS,
      BOARD_LIMITS.size,
    );
    return rows.flatMap((row) => {
      const view = this.noticeView(row, viewerId);
      return view ? [view] : [];
    });
  }

  createNotice(authorId: string, request: CreateNoticeRequest): SocialResult<NoticeView> {
    if (!this.resident(authorId)) return fail("unauthorized", "Unknown resident.");
    const text = cleanText(request.text);
    if (text === "") return fail("bad_request", "Empty notice.");
    const verdict = this.moderation.review("notice", text, { resident: authorId });
    if (!verdict.ok) return refusal(verdict) ?? fail("bad_request", "Not pinned.");
    const now = this.now();
    const up = this.count(
      "SELECT COUNT(*) AS c FROM notices WHERE author = ? AND removed_at IS NULL AND created_at > ?",
      authorId,
      now - BOARD_LIMITS.days * DAY_MS,
    );
    if (up >= BOARD_LIMITS.perResident) {
      return fail(
        "rate_limited",
        `You have ${BOARD_LIMITS.perResident} notices up. Take one down, or wait for one to expire.`,
      );
    }
    const today = this.count(
      "SELECT COUNT(*) AS c FROM notices WHERE author = ? AND created_at > ?",
      authorId,
      now - DAY_MS,
    );
    if (today >= BOARD_LIMITS.perDay) {
      return fail("rate_limited", "That's a lot of notices for one day. Try again tomorrow.");
    }
    const id = randomId("n");
    this.sql.exec(
      "INSERT INTO notices (id, author, text, created_at) VALUES (?, ?, ?, ?)",
      id,
      authorId,
      text,
      now,
    );
    verdict.commit();
    if (verdict.borderline) this.safety.requestTriage("notice", id);
    const row = this.rows("SELECT id, author, text, created_at FROM notices WHERE id = ?", id)[0];
    const view = row ? this.noticeView(row, authorId) : undefined;
    return view ? { ok: true, value: view } : fail("internal", "Notice vanished.");
  }

  /** Take a notice down: its author or a maintainer. The row stays, as the record of who did it. */
  deleteNotice(callerId: string, noticeId: string): SocialResult<null> {
    const row = this.rows(
      "SELECT author FROM notices WHERE id = ? AND removed_at IS NULL",
      noticeId,
    )[0];
    if (!row) return fail("not_found", "No such notice.");
    if (row.author !== callerId && !this.isMaintainer(callerId)) {
      return fail("forbidden", "Only its author or a maintainer can take a notice down.");
    }
    this.sql.exec(
      "UPDATE notices SET removed_at = ?, removed_by = ? WHERE id = ?",
      this.now(),
      callerId,
      noticeId,
    );
    if (row.author !== callerId) {
      this.safety.recordAction(
        callerId,
        "remove_notice",
        "notice",
        noticeId,
        "Taken down by a maintainer",
      );
    }
    return { ok: true, value: null };
  }

  petitionAnswer(proposalId: string): PetitionAnswer | null {
    const row = this.rows(
      "SELECT text, answered_by, answered_at FROM petition_answers WHERE proposal_id = ?",
      proposalId,
    )[0];
    const by = row ? this.authorView(String(row.answered_by)) : undefined;
    if (!row || !by) return null;
    return {
      trust: "untrusted",
      text: String(row.text),
      by,
      answeredAt: new Date(Number(row.answered_at)).toISOString(),
    };
  }

  /** Write (or rewrite) a maintainer's answer. The caller checks the proposal is a petition. */
  answerPetition(by: string, proposalId: string, raw: string): SocialResult<null> {
    if (!this.isMaintainer(by)) return fail("forbidden", "Only maintainers answer petitions.");
    const text = cleanMultiline(raw);
    if (text === "") return fail("bad_request", "Empty answer.");
    const aimed = aimedAtReader(text);
    if (aimed) return fail("bad_request", readerMessage("Answers", aimed));
    this.sql.exec(
      `INSERT INTO petition_answers (proposal_id, text, answered_by, answered_at) VALUES (?, ?, ?, ?)
        ON CONFLICT (proposal_id) DO UPDATE SET text = excluded.text, answered_by = excluded.answered_by,
        answered_at = excluded.answered_at`,
      proposalId,
      text,
      by,
      this.now(),
    );
    return { ok: true, value: null };
  }

  private noticeView(row: Row, viewerId: string | undefined): NoticeView | undefined {
    const author = this.authorView(String(row.author));
    if (!author) return undefined;
    const created = Number(row.created_at);
    return {
      id: String(row.id),
      trust: "untrusted",
      author,
      text: String(row.text),
      createdAt: new Date(created).toISOString(),
      expiresAt: new Date(created + BOARD_LIMITS.days * DAY_MS).toISOString(),
      canRemove: viewerId !== undefined && (viewerId === author.id || this.isMaintainer(viewerId)),
    };
  }

  /** Pat a resident's pet (RFC 0019) and return their profile as the patter sees it. */
  patPet(patter: string, owner: string): SocialResult<ProfileView> {
    const patted = this.pets.pat(patter, owner);
    if (!patted.ok) return patted;
    const profile = this.profile(owner, patter);
    return profile ? { ok: true, value: profile } : fail("not_found", "No such resident.");
  }

  /**
   * Tell a pet's owner someone gave it a treat (RFC 0019). The world logged the treat; this is the
   * notification, through `notify()` with its caps and block check.
   */
  petTreated(owner: string, by: string, treat: Crop) {
    const pet = this.resident(owner)?.pet;
    if (pet) this.notify(owner, by, "pet_treat", "", petDetail(pet, treat));
  }

  /** Praise a resident (issue #36) and return their profile as the giver sees it. */
  givePraise(giver: string, receiver: string): SocialResult<ProfileView> {
    const given = this.praise.give(giver, receiver);
    if (!given.ok) return given;
    const profile = this.profile(receiver, giver);
    return profile ? { ok: true, value: profile } : fail("not_found", "No such resident.");
  }

  // ---------- blocks ----------

  /** Block or unblock. Blocking stops letters and gestures both ways and hides their posts from you. */
  setBlock(blocker: string, blocked: string, on: boolean): SocialResult<ProfileView> {
    if (blocker === blocked) return fail("bad_request", "You can't block yourself.");
    if (!this.resident(blocked)) return fail("not_found", "No such resident.");
    this.sql.exec(
      on
        ? "INSERT OR IGNORE INTO blocks (blocker, blocked) VALUES (?, ?)"
        : "DELETE FROM blocks WHERE blocker = ? AND blocked = ?",
      blocker,
      blocked,
    );
    const profile = this.profile(blocked, blocker);
    return profile ? { ok: true, value: profile } : fail("not_found", "No such resident.");
  }

  private blocks(blocker: string, blocked: string): boolean {
    return (
      this.count(
        "SELECT COUNT(*) AS c FROM blocks WHERE blocker = ? AND blocked = ?",
        blocker,
        blocked,
      ) > 0
    );
  }

  /** Everyone who follows `residentId`, in one read. */
  followersOf(residentId: string): Set<string> {
    const rows = this.rows("SELECT follower FROM follows WHERE followee = ?", residentId);
    return new Set(rows.map((r) => String(r.follower)));
  }

  /** Everyone `residentId` blocked, one way, in one read. */
  blockedBy(residentId: string): Set<string> {
    const rows = this.rows("SELECT blocked FROM blocks WHERE blocker = ?", residentId);
    return new Set(rows.map((r) => String(r.blocked)));
  }

  /** Everyone `residentId` blocked or was blocked by, in one read. */
  blockedWith(residentId: string): Set<string> {
    const rows = this.rows(
      "SELECT blocked AS id FROM blocks WHERE blocker = ? UNION SELECT blocker FROM blocks WHERE blocked = ?",
      residentId,
      residentId,
    );
    return new Set(rows.map((r) => String(r.id)));
  }

  /** True when either resident has blocked the other. */
  blockedEither(a: string, b: string): boolean {
    return this.blocks(a, b) || this.blocks(b, a);
  }

  /**
   * The profile a handle points at: its current owner, or the last one if they gave it up and
   * nobody has claimed it since, so old links still work.
   */
  profileByHandle(handle: string, viewerId?: string): ProfileView | undefined {
    const id = this.residentIdByHandle(handle);
    return id === undefined ? undefined : this.profile(id, viewerId);
  }

  /** The resident id a handle points at, on the same terms as `profileByHandle`. */
  residentIdByHandle(handle: string): string | undefined {
    const lower = handle.toLowerCase();
    if (!HANDLE_PATTERN.test(lower)) return undefined;
    const row = this.rows("SELECT resident_id FROM handles WHERE handle = ?", lower)[0];
    return row ? String(row.resident_id) : undefined;
  }

  async updateProfile(
    residentId: string,
    request: UpdateProfileRequest,
  ): Promise<SocialResult<ProfileView>> {
    if (!this.resident(residentId)) return fail("unauthorized", "Unknown resident.");
    // Check everything before changing anything, so a refusal leaves the profile as it was.
    for (const field of ["avatar", "banner"] as const) {
      const id = request[field];
      if (!id) continue;
      const media = this.ownedMedia(residentId, id);
      if (!media) return fail("bad_request", `The ${field} must be one of your uploads.`);
      if (MEDIA_TYPES[media.type].kind !== "image") {
        return fail("bad_request", `The ${field} must be an image.`);
      }
    }
    let borderlineBio = false;
    if (request.bio !== undefined && request.bio.trim() !== "") {
      const verdict = this.moderation.review("bio", cleanMultiline(request.bio), {
        resident: residentId,
      });
      const refused = refusal(verdict);
      if (refused) return refused;
      borderlineBio = verdict.ok && verdict.borderline !== undefined;
    }
    const handle =
      request.handle === undefined ? undefined : this.checkHandle(residentId, request.handle);
    if (handle && !handle.ok) return handle;

    if (handle?.value) this.claimHandle(residentId, handle.value);
    this.sql.exec("INSERT OR IGNORE INTO profiles (resident_id) VALUES (?)", residentId);
    this.sql.exec(
      "UPDATE profiles SET updated_at = ? WHERE resident_id = ?",
      this.now(),
      residentId,
    );
    if (request.bio !== undefined) {
      this.sql.exec(
        "UPDATE profiles SET bio = ? WHERE resident_id = ?",
        cleanMultiline(request.bio),
        residentId,
      );
    }
    // Write both pictures before letting any old file go, so moving one picture from avatar to
    // banner (or swapping them) in a single request never deletes it.
    const replaced: string[] = [];
    for (const field of ["avatar", "banner"] as const) {
      const id = request[field];
      if (id === undefined) continue;
      const old = this.rows(`SELECT ${field} FROM profiles WHERE resident_id = ?`, residentId)[0];
      this.sql.exec(`UPDATE profiles SET ${field} = ? WHERE resident_id = ?`, id ?? "", residentId);
      if (old?.[field] && old[field] !== id) replaced.push(String(old[field]));
    }
    for (const id of replaced) await this.releaseIfUnused(id);
    if (borderlineBio) this.safety.requestTriage("resident", residentId);
    const profile = this.profile(residentId, residentId);
    return profile ? { ok: true, value: profile } : fail("internal", "Profile vanished.");
  }

  // ---------- X accounts (decision 0022) ----------

  /**
   * The line to post on X, with a one-time code. One code per resident: a fresh one is handed back
   * again, so opening the sheet twice doesn't break a post already sent. Past a quarter of its life
   * it's replaced, so a code never runs out moments after it's shown.
   */
  startXLink(residentId: string): SocialResult<XStartResponse> {
    const r = this.resident(residentId);
    if (!r) return fail("unauthorized", "Unknown resident.");
    const now = this.now();
    const pending = this.rows(
      "SELECT code, expires_at FROM x_codes WHERE resident_id = ?",
      residentId,
    )[0];
    let code = pending ? String(pending.code) : "";
    let expiresAt = Number(pending?.expires_at ?? 0);
    if (!pending || expiresAt - now < X_CODE_TTL_MS * 0.75) {
      code = newXCode();
      expiresAt = now + X_CODE_TTL_MS;
      this.sql.exec(
        "INSERT OR REPLACE INTO x_codes (resident_id, code, expires_at) VALUES (?, ?, ?)",
        residentId,
        code,
        expiresAt,
      );
    }
    const text = xPostText(r.name, r.id, code);
    return {
      ok: true,
      value: {
        code,
        text,
        intentUrl: xIntentUrl(text),
        expiresAt: new Date(expiresAt).toISOString(),
      },
    };
  }

  /**
   * Connect the X account that wrote the post at `url`, if the post carries this resident's code.
   * X's answer is untrusted: only the author's handle and the post's link are kept.
   */
  async verifyXLink(residentId: string, url: string): Promise<SocialResult<ProfileView>> {
    if (!this.resident(residentId)) return fail("unauthorized", "Unknown resident.");
    const code = this.pendingXCode(residentId);
    if (!code.ok) return fail("bad_request", code.message);
    const status = parseXStatusUrl(url);
    if (!status.ok) return fail("bad_request", status.message);

    const read = await this.readXPost(status.value);
    if (!read.ok) {
      return read.missing
        ? fail("bad_request", X_POST_MISSING)
        : fail("unavailable", X_UNAVAILABLE);
    }
    const problem = checkXPost(read.post, status.value, code.value);
    if (problem) return fail("bad_request", problem);
    // The read took a while. The code must still be the one we checked against.
    const still = this.pendingXCode(residentId);
    if (!still.ok || still.value !== code.value)
      return fail("bad_request", "Start again: that code was replaced.");

    const { handle } = read.post;
    const key = handle.toLowerCase();
    const others = this.count(
      "SELECT COUNT(*) AS c FROM x_links WHERE handle_key = ? AND resident_id != ?",
      key,
      residentId,
    );
    if (others >= X_LINKS_PER_HANDLE) {
      return fail(
        "bad_request",
        `@${handle} is already connected to ${X_LINKS_PER_HANDLE} residents, the most one X account can have. Disconnect it from one of them first.`,
      );
    }
    this.sql.exec(
      `INSERT OR REPLACE INTO x_links (resident_id, handle, handle_key, status_url, verified_at)
        VALUES (?, ?, ?, ?, ?)`,
      residentId,
      handle,
      key,
      canonicalStatusUrl(handle, status.value.id),
      this.now(),
    );
    this.sql.exec("DELETE FROM x_codes WHERE resident_id = ?", residentId);
    const profile = this.profile(residentId, residentId);
    return profile ? { ok: true, value: profile } : fail("internal", "Profile vanished.");
  }

  /** Disconnect X: the handle, the post link, and any pending code are deleted. */
  unlinkX(residentId: string): SocialResult<ProfileView> {
    this.sql.exec("DELETE FROM x_links WHERE resident_id = ?", residentId);
    this.sql.exec("DELETE FROM x_codes WHERE resident_id = ?", residentId);
    const profile = this.profile(residentId, residentId);
    return profile ? { ok: true, value: profile } : fail("unauthorized", "Unknown resident.");
  }

  private pendingXCode(
    residentId: string,
  ): { ok: true; value: string } | { ok: false; message: string } {
    const row = this.rows(
      "SELECT code, expires_at FROM x_codes WHERE resident_id = ?",
      residentId,
    )[0];
    if (!row) {
      return {
        ok: false,
        message: "Get a code to post first (POST /v1/profile/x/start), then send the post's link.",
      };
    }
    if (Number(row.expires_at) <= this.now()) {
      return {
        ok: false,
        message: "That code expired. Get a new one, post it, and send the new post's link.",
      };
    }
    return { ok: true, value: String(row.code) };
  }

  // ---------- handles and mentions ----------

  private currentHandle(residentId: string): Row | undefined {
    return this.rows(
      "SELECT handle, claimed_at FROM handles WHERE resident_id = ? AND released_at = 0",
      residentId,
    )[0];
  }

  /**
   * Whether `residentId` may take `raw` as their handle: the lowercase handle to claim, null when
   * it's already theirs, or why not.
   */
  private checkHandle(residentId: string, raw: string): SocialResult<string | null> {
    const handle = raw.trim().toLowerCase();
    if (!HANDLE_PATTERN.test(handle)) {
      return fail(
        "bad_request",
        "A handle is 3 to 20 letters, digits, or underscores, and starts with a letter.",
      );
    }
    const current = this.currentHandle(residentId);
    if (current?.handle === handle) return { ok: true, value: null };
    if (isReservedHandle(handle))
      return fail("bad_request", "That handle is reserved. Pick another.");
    const refused = refusal(this.moderation.review("handle", handle, { resident: residentId }));
    if (refused) return refused;
    const taken = this.rows(
      "SELECT resident_id, released_at FROM handles WHERE handle = ?",
      handle,
    )[0];
    if (taken && Number(taken.released_at) === 0) {
      return fail("bad_request", "That handle is taken. Pick another.");
    }
    if (
      taken &&
      taken.resident_id !== residentId &&
      this.now() - Number(taken.released_at) < HANDLE_HOLD_DAYS * DAY_MS
    ) {
      return fail(
        "bad_request",
        `That handle was given up recently and is held for its last owner for ${HANDLE_HOLD_DAYS} days. Pick another.`,
      );
    }
    if (current && this.now() - Number(current.claimed_at) < HANDLE_RENAME_DAYS * DAY_MS) {
      const when = new Date(Number(current.claimed_at) + HANDLE_RENAME_DAYS * DAY_MS);
      return fail(
        "rate_limited",
        `You can change your handle once every ${HANDLE_RENAME_DAYS} days. Try again after ${when.toISOString().slice(0, 16).replace("T", " ")} UTC.`,
      );
    }
    return { ok: true, value: handle };
  }

  /** Take a handle `checkHandle` approved. The old one is held for its owner. */
  private claimHandle(residentId: string, handle: string) {
    const now = this.now();
    this.sql.exec(
      "UPDATE handles SET released_at = ? WHERE resident_id = ? AND released_at = 0",
      now,
      residentId,
    );
    this.sql.exec("DELETE FROM handles WHERE handle = ?", handle);
    this.sql.exec(
      "INSERT INTO handles (handle, resident_id, claimed_at, released_at) VALUES (?, ?, ?, 0)",
      handle,
      residentId,
      now,
    );
  }

  /** The residents a text mentions, in order, once each, up to MAX_MENTIONS_PER_POST. */
  private resolveMentions(text: string): MentionView[] {
    const handles = [...new Set(findMentions(text).map((m) => m.handle))];
    if (handles.length === 0) return [];
    const owners = new Map(
      this.rows(
        `SELECT handle, resident_id FROM handles WHERE released_at = 0 AND handle IN (${marks(handles.length)})`,
        ...handles,
      ).map((row) => [String(row.handle), String(row.resident_id)]),
    );
    return handles
      .flatMap((handle) => {
        const id = owners.get(handle);
        return id && this.resident(id) ? [{ handle, id }] : [];
      })
      .slice(0, MAX_MENTIONS_PER_POST);
  }

  // ---------- notifications ----------

  /**
   * Tell `recipient` that `actor` did something. Nothing happens for yourself, between residents
   * where either blocked the other, past the daily cap
   * per actor, or for a second follow from the same person within a day. Reactions and reposts on
   * one post within one clock hour share a notification, which moves to the top and reads as new.
   */
  private notify(
    recipient: string,
    actor: string,
    type: NotificationType,
    postId: string,
    detail = "",
  ) {
    if (recipient === actor || !this.resident(recipient)) return;
    // Blocking either way means no notifications either way.
    if (this.blockedEither(recipient, actor)) return;
    const now = this.now();
    const since = now - DAY_MS;
    if (
      this.count(
        "SELECT COUNT(*) AS c FROM notification_log WHERE actor = ? AND recipient = ? AND created_at > ?",
        actor,
        recipient,
        since,
      ) >= this.limits.notificationsPerActorPerDay
    ) {
      return;
    }
    if (
      type === "follow" &&
      this.count(
        "SELECT COUNT(*) AS c FROM notifications WHERE recipient = ? AND actor = ? AND type = 'follow' AND created_at > ?",
        recipient,
        actor,
        since,
      ) > 0
    ) {
      return;
    }
    const seq = this.count("SELECT COALESCE(MAX(seq), 0) + 1 AS c FROM notifications");
    this.sql.exec(
      "INSERT INTO notification_log (actor, recipient, created_at) VALUES (?, ?, ?)",
      actor,
      recipient,
      now,
    );
    // Reactions and reposts on one post in an hour share a notification, and so do admires of one
    // plot in an hour (its coordinates are the detail) and pats on a pet in a UTC day.
    const groupKey =
      type === "reaction" || type === "repost"
        ? `${type}:${postId}:${Math.floor(now / HOUR_MS)}`
        : type === "plot_admired"
          ? `${type}:${detail}:${Math.floor(now / HOUR_MS)}`
          : type === "pet_pat"
            ? `pet_pat:${Math.floor(now / DAY_MS)}`
            : "";
    const existing = groupKey
      ? this.rows(
          "SELECT id FROM notifications WHERE recipient = ? AND group_key = ?",
          recipient,
          groupKey,
        )[0]
      : undefined;
    if (existing) {
      const id = String(existing.id);
      this.sql.exec(
        "INSERT OR IGNORE INTO notification_actors (notification_id, actor) VALUES (?, ?)",
        id,
        actor,
      );
      this.sql.exec(
        `UPDATE notifications SET actor = ?, detail = ?, seq = ?, created_at = ?, read = 0,
          count = (SELECT COUNT(*) FROM notification_actors WHERE notification_id = ?)
        WHERE id = ?`,
        actor,
        detail,
        seq,
        now,
        id,
        id,
      );
      return;
    }
    const id = randomId("n");
    this.sql.exec(
      `INSERT INTO notifications (id, recipient, type, actor, post_id, detail, group_key, count, seq, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
      id,
      recipient,
      type,
      actor,
      postId,
      detail,
      groupKey,
      seq,
      now,
    );
    if (groupKey) {
      this.sql.exec(
        "INSERT INTO notification_actors (notification_id, actor) VALUES (?, ?)",
        id,
        actor,
      );
    }
  }

  /**
   * A takedown notice from Terrakin itself (decision 0064): staff took down something `recipient`
   * owns. No resident is the actor, so blocks and the per-actor cap don't apply, and nothing names
   * who acted or who reported it. `excerpt` is the start of a hidden post: the owner's own words.
   */
  takedownNotice(recipient: string, notice: TakedownView, excerptOf = "") {
    if (!this.resident(recipient)) return;
    const now = this.now();
    const seq = this.count("SELECT COALESCE(MAX(seq), 0) + 1 AS c FROM notifications");
    this.sql.exec(
      `INSERT INTO notifications (id, recipient, type, actor, post_id, detail, group_key, count, seq, created_at)
        VALUES (?, ?, 'takedown', ?, '', ?, '', 1, ?, ?)`,
      randomId("n"),
      recipient,
      TERRAKIN_ACTOR.id,
      JSON.stringify({ ...notice, ...(excerptOf ? { excerpt: excerpt(excerptOf) } : {}) }),
      seq,
      now,
    );
  }

  /**
   * Notifications whose post (if any) is still there and shown, from residents who aren't
   * suspended, about posts by residents who aren't suspended. Checked when read, so hiding a post or
   * suspending someone takes their notifications away at once. Bind the recipient, then `now()`
   * twice.
   */
  private static readonly VISIBLE_NOTIFICATIONS =
    `FROM notifications n LEFT JOIN posts p ON p.id = n.post_id
    WHERE n.recipient = ? AND (n.post_id = '' OR (p.id IS NOT NULL AND p.hidden = 0))
      AND ${NOT_SUSPENDED("n.actor")} AND (p.id IS NULL OR ${NOT_SUSPENDED("p.author")})`;

  private unread(recipient: string): number {
    return this.count(
      `SELECT COUNT(*) AS c ${SocialService.VISIBLE_NOTIFICATIONS} AND n.read = 0`,
      recipient,
      this.now(),
      this.now(),
    );
  }

  /**
   * Everyone behind these grouped notifications (reactions, reposts, and plot admires share one
   * for the hour), counted once each however many of them they're in.
   */
  groupedActors(ids: readonly string[]): Set<string> {
    if (ids.length === 0) return new Set();
    const rows = this.rows(
      `SELECT DISTINCT actor FROM notification_actors WHERE notification_id IN (${marks(ids.length)})`,
      ...ids,
    );
    return new Set(rows.map((r) => String(r.actor)));
  }

  notifications(
    recipient: string,
    options: { limit?: number | undefined; before?: string | undefined },
  ): NotificationsResponse {
    const asked = Math.floor(Number(options.limit));
    const limit = Number.isFinite(asked)
      ? Math.max(1, Math.min(FEED_MAX_LIMIT, asked))
      : FEED_DEFAULT_LIMIT;
    const before = Number.parseInt(options.before ?? "", 36);
    const rows = this.rows(
      `SELECT n.id, n.type, n.actor, n.post_id, n.detail, n.count, n.seq, n.created_at, n.read,
        p.text AS post_text
      ${SocialService.VISIBLE_NOTIFICATIONS} ${Number.isFinite(before) ? "AND n.seq < ?" : ""}
      ORDER BY n.seq DESC LIMIT ?`,
      recipient,
      this.now(),
      this.now(),
      ...(Number.isFinite(before) ? [before] : []),
      limit + 1,
    );
    const page = rows.slice(0, limit);
    const last = page.at(-1);
    const notifications = page.flatMap((row): NotificationView[] => {
      const type = String(row.type) as NotificationType;
      const detail = String(row.detail);
      if (type === "takedown") return this.takedownView(row, detail);
      const actor = this.authorById(String(row.actor));
      if (!actor) return [];
      return [
        {
          id: String(row.id),
          type,
          trust: "untrusted",
          actor,
          count: Number(row.count),
          postId: row.post_id ? String(row.post_id) : null,
          excerpt: row.post_text ? excerpt(String(row.post_text)) : "",
          ...(type === "reaction" && isReactionKey(detail) ? { reaction: detail } : {}),
          ...(type === "gesture" && isGestureKind(detail) ? { gesture: detail } : {}),
          ...(type === "pet_pat" || type === "pet_treat" ? petNotice(detail) : {}),
          ...(type === "plot_admired" ? plotDetail(detail) : {}),
          read: Number(row.read) > 0,
          createdAt: new Date(Number(row.created_at)).toISOString(),
        },
      ];
    });
    return {
      notifications,
      next: rows.length > limit && last ? Number(last.seq).toString(36) : null,
      unread: this.unread(recipient),
    };
  }

  /** A stored takedown notice as the recipient reads it, from Terrakin rather than a resident. */
  private takedownView(row: Record<string, unknown>, detail: string): NotificationView[] {
    let stored: unknown;
    try {
      stored = JSON.parse(detail);
    } catch {
      return [];
    }
    const parsed = TakedownView.safeParse(stored);
    if (!parsed.success) return [];
    const quote = (stored as { excerpt?: unknown }).excerpt;
    return [
      {
        id: String(row.id),
        type: "takedown",
        trust: "untrusted",
        actor: TERRAKIN_ACTOR,
        count: 1,
        postId: null,
        excerpt: typeof quote === "string" ? quote : "",
        system: true,
        takedown: parsed.data,
        read: Number(row.read) > 0,
        createdAt: new Date(Number(row.created_at)).toISOString(),
      },
    ];
  }

  /** Mark one notification and every older one read. Returns what's still unread. */
  markRead(recipient: string, upTo: string): SocialResult<number> {
    const row = this.rows(
      "SELECT seq FROM notifications WHERE id = ? AND recipient = ?",
      upTo,
      recipient,
    )[0];
    if (!row) return fail("not_found", "No such notification.");
    this.sql.exec(
      "UPDATE notifications SET read = 1 WHERE recipient = ? AND seq <= ?",
      recipient,
      Number(row.seq),
    );
    return { ok: true, value: this.unread(recipient) };
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
    // Someone with no uploads left today is turned away before the file is parsed. Stripping can
    // shrink a file, so the exact byte check waits until after it.
    const early = this.checkUploadCaps(ownerId, 1);
    if (early) return early;
    // Location and camera details come out before anything is stored or counted.
    const stripped = stripMetadata(bytes, type);
    if (!stripped) {
      return fail(
        "bad_request",
        `Couldn't read that ${kind} to remove hidden details like its location. Save or export it again and retry.`,
      );
    }
    // A model's rewritten JSON can come out a little longer than it went in.
    if (stripped.length > maxBytes) {
      return fail(
        "bad_request",
        `That ${kind} is too big. The limit is ${maxBytes / 1_000_000} MB.`,
      );
    }
    bytes = stripped;
    const refusal = this.checkUploadCaps(ownerId, bytes.length);
    if (refusal) return refusal;
    // Read from the header, so a post can save the picture's room before it loads.
    const size = kind === "image" ? imageSize(bytes, type) : undefined;
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
      `INSERT INTO media (id, owner, type, bytes, created_at, width, height)
        VALUES (?, ?, ?, ?, ?, NULLIF(?, 0), NULLIF(?, 0))`,
      id,
      ownerId,
      type,
      bytes.length,
      at,
      size?.width ?? 0,
      size?.height ?? 0,
    );
    try {
      await this.media.put(id, bytes, type);
    } catch (err) {
      console.error("Media write failed", err);
      this.sql.exec("DELETE FROM media WHERE id = ?", id);
      this.sql.exec("DELETE FROM uploads WHERE media_id = ?", id);
      return fail("internal", "Couldn't save that file. Try again.");
    }
    return {
      ok: true,
      value: { id, kind, type, url: mediaUrl(id), bytes: bytes.length, ...size },
    };
  }

  /**
   * Whether `ownerId` could store `bytes` more right now, by every upload cap. Plot photos ask
   * before they're drawn; `upload()` checks again with the real size.
   */
  uploadRoom(ownerId: string, bytes: number): SocialResult<null> {
    if (!this.resident(ownerId)) return fail("unauthorized", "Unknown resident.");
    return this.checkUploadCaps(ownerId, bytes) ?? { ok: true, value: null };
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
   * isn't free file hosting), forget cap records older than two days, and drop old notifications.
   */
  async sweep() {
    const cutoff = this.now() - DAY_MS;
    const orphans = this.rows(
      `SELECT id FROM media m WHERE m.created_at < ?
        AND NOT EXISTS (SELECT 1 FROM post_media pm WHERE pm.media_id = m.id)
        AND NOT EXISTS (SELECT 1 FROM profiles pr WHERE pr.avatar = m.id OR pr.banner = m.id)
        AND NOT EXISTS (SELECT 1 FROM letter_media lm WHERE lm.media_id = m.id)
        AND NOT EXISTS (SELECT 1 FROM look_media km WHERE km.media_id = m.id)
        AND NOT EXISTS (SELECT 1 FROM piece_media pc WHERE pc.media_id = m.id)
      LIMIT 100`,
      cutoff,
    );
    for (const row of orphans) await this.releaseIfUnused(String(row.id));
    this.sql.exec("DELETE FROM uploads WHERE created_at < ?", this.now() - 2 * DAY_MS);
    this.sql.exec("DELETE FROM notification_log WHERE created_at < ?", this.now() - 2 * DAY_MS);
    this.sql.exec("DELETE FROM x_codes WHERE expires_at < ?", this.now());
    this.together.sweep();
    this.events.sweep();
    const old = this.now() - NOTIFICATION_KEEP_MS;
    this.sql.exec(
      "DELETE FROM notification_actors WHERE notification_id IN (SELECT id FROM notifications WHERE created_at < ?)",
      old,
    );
    this.sql.exec("DELETE FROM notifications WHERE created_at < ?", old);
  }

  /**
   * Take a file down everywhere: from storage first, then from every post, letter, look, avatar,
   * and banner that uses it. Only the uploader can attach a file, so everything that goes is theirs. If storage
   * refuses, nothing changes here and this returns false, so a retry still finds the file.
   */
  async purgeMedia(id: string): Promise<boolean> {
    try {
      await this.media.delete(id);
      await this.media.delete(privateMediaKey(id));
    } catch (err) {
      console.error("Media takedown failed", id, err);
      return false;
    }
    this.sql.exec("DELETE FROM post_media WHERE media_id = ?", id);
    this.sql.exec("DELETE FROM letter_media WHERE media_id = ?", id);
    this.sql.exec("DELETE FROM look_media WHERE media_id = ?", id);
    this.sql.exec("DELETE FROM piece_media WHERE media_id = ?", id);
    this.sql.exec("UPDATE profiles SET avatar = NULL WHERE avatar = ?", id);
    this.sql.exec("UPDATE profiles SET banner = NULL WHERE banner = ?", id);
    this.sql.exec("DELETE FROM media WHERE id = ?", id);
    return true;
  }

  /** Delete a file and its row if no post, avatar, banner, letter, or world look uses it. */
  async releaseIfUnused(id: string) {
    const used =
      this.count("SELECT COUNT(*) AS c FROM post_media WHERE media_id = ?", id) +
      this.count("SELECT COUNT(*) AS c FROM profiles WHERE avatar = ? OR banner = ?", id, id) +
      this.count("SELECT COUNT(*) AS c FROM letter_media WHERE media_id = ?", id) +
      this.count("SELECT COUNT(*) AS c FROM look_media WHERE media_id = ?", id) +
      this.count("SELECT COUNT(*) AS c FROM piece_media WHERE media_id = ?", id);
    if (used > 0) return;
    this.sql.exec("DELETE FROM media WHERE id = ?", id);
    try {
      // A letter image lives under its private key; deleting a key that isn't there is fine.
      await this.media.delete(id);
      await this.media.delete(privateMediaKey(id));
    } catch (err) {
      console.error("Media delete failed", id, err);
    }
  }

  // ---------- owners ----------

  /** The human who owns this agent, if one does. */
  ownerOf(agentId: string): string | undefined {
    const row = this.rows("SELECT owner_id FROM owner_links WHERE agent_id = ?", agentId)[0];
    return row ? String(row.owner_id) : undefined;
  }

  /** The agents this human owns, oldest link first. */
  agentsOf(ownerId: string): string[] {
    return this.rows(
      "SELECT agent_id FROM owner_links WHERE owner_id = ? ORDER BY created_at, agent_id",
      ownerId,
    ).map((row) => String(row.agent_id));
  }

  /**
   * Link an agent to its owner, and have each follow the other. The owner service checks the
   * rules (kinds, limits, consent) before calling this.
   */
  link(agentId: string, ownerId: string) {
    this.sql.exec(
      "INSERT INTO owner_links (agent_id, owner_id, created_at) VALUES (?, ?, ?)",
      agentId,
      ownerId,
      this.now(),
    );
    this.onOwnerLink?.("link", agentId, ownerId);
    for (const [follower, followee] of [
      [agentId, ownerId],
      [ownerId, agentId],
    ] as const) {
      this.sql.exec(
        "INSERT OR IGNORE INTO follows (follower, followee) VALUES (?, ?)",
        follower,
        followee,
      );
    }
  }

  /** End an agent's link. Follows stay. */
  unlink(agentId: string) {
    const ownerId = this.ownerOf(agentId);
    this.sql.exec("DELETE FROM owner_links WHERE agent_id = ?", agentId);
    if (ownerId !== undefined) this.onOwnerLink?.("unlink", agentId, ownerId);
  }

  /** Every owner link as [agent, owner], for the sim's owner pairs (RFC 0008). */
  ownerPairs(): [string, string][] {
    return this.rows("SELECT agent_id, owner_id FROM owner_links").map((r) => [
      String(r.agent_id),
      String(r.owner_id),
    ]);
  }

  /**
   * Called with the one pair after a link is made or removed. `Api` points it at the world, which
   * logs just that pair (decision 0042).
   */
  onOwnerLink: ((change: "link" | "unlink", agentId: string, ownerId: string) => void) | undefined;

  /** A resident in brief, with their avatar: what a badge or a link card needs. */
  ref(residentId: string): ResidentBrief | undefined {
    const r = this.resident(residentId);
    if (!r) return undefined;
    const avatar = this.rows("SELECT avatar FROM profiles WHERE resident_id = ?", residentId)[0];
    return {
      id: r.id,
      name: r.name,
      kind: r.kind,
      color: r.color,
      shape: r.shape,
      avatar: avatar?.avatar ? mediaUrl(String(avatar.avatar)) : null,
      ...(this.townsfolk.has(r.id) ? { townsfolk: true } : {}),
    };
  }

  /** `owner` for a linked agent, `agents` for a human who owns some. Nothing otherwise. */
  private ownerFields(residentId: string): { owner?: ResidentBrief; agents?: ResidentBrief[] } {
    const ownerId = this.ownerOf(residentId);
    const owner = ownerId === undefined ? undefined : this.ref(ownerId);
    if (owner) return { owner };
    const agents = this.agentsOf(residentId).flatMap((id) => this.ref(id) ?? []);
    return agents.length > 0 ? { agents } : {};
  }

  /**
   * `keeperOf` for a person who owns partner characters (RFC 0007): each agent they own that is
   * linked to a partner character right now, oldest owner link first. A paused partner's
   * characters show no badge, so they drop out here too.
   */
  private keeperField(r: Resident): { keeperOf?: KeptCharacter[] } {
    if (r.kind !== "human") return {};
    const kept = this.agentsOf(r.id).flatMap((id) => {
      const partner = this.agentLinks.badge(id);
      const character = partner ? this.ref(id) : undefined;
      return partner && character ? [{ ...character, partner }] : [];
    });
    return kept.length > 0 ? { keeperOf: kept } : {};
  }

  // ---------- helpers ----------

  private visiblePost(postId: string): Row | undefined {
    return this.rows("SELECT id, author FROM posts WHERE id = ? AND hidden = 0", postId)[0];
  }

  /** The type of an upload `ownerId` made, or undefined if it isn't theirs or is gone. */
  mediaType(ownerId: string, mediaId: string): MediaType | undefined {
    return this.ownedMedia(ownerId, mediaId)?.type;
  }

  /**
   * Record which uploads a resident's world look names, replacing what was there. Media a look
   * stops naming go back to the sweep, which deletes them a day after upload if nothing else uses
   * them.
   */
  pinLookMedia(residentId: string, mediaIds: readonly string[]) {
    this.sql.exec("DELETE FROM look_media WHERE resident_id = ?", residentId);
    for (const id of new Set(mediaIds)) {
      this.sql.exec(
        "INSERT OR IGNORE INTO look_media (resident_id, media_id) VALUES (?, ?)",
        residentId,
        id,
      );
    }
  }

  /** Keep the upload a piece of art shows: a piece lasts as long as the world does. */
  pinPieceMedia(itemId: string, mediaId: string) {
    this.sql.exec(
      "INSERT OR IGNORE INTO piece_media (item_id, media_id) VALUES (?, ?)",
      itemId,
      mediaId,
    );
  }

  /** One of your uploads, if it isn't private to a letter (those never go public). */
  private ownedMedia(ownerId: string, mediaId: string): { type: MediaType } | undefined {
    const row = this.rows(
      `SELECT type FROM media WHERE id = ? AND owner = ?
        AND NOT EXISTS (SELECT 1 FROM letter_media lm WHERE lm.media_id = media.id)`,
      mediaId,
      ownerId,
    )[0];
    return row ? { type: String(row.type) as MediaType } : undefined;
  }

  /** A resident as an author, with their avatar and handles, or undefined if they don't exist. */
  authorView(id: string): AuthorView | undefined {
    return this.authorById(id);
  }

  /** Media for each of these posts, in order. */
  private mediaFor(ids: string[]): Map<string, MediaView[]> {
    const media = new Map<string, MediaView[]>();
    if (ids.length === 0) return media;
    for (const m of this.rows(
      `SELECT pm.post_id, m.id, m.type, m.bytes, m.width, m.height
        FROM post_media pm JOIN media m ON m.id = pm.media_id
        WHERE pm.post_id IN (${marks(ids.length)}) ORDER BY pm.post_id, pm.ord`,
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
        ...sizeFields(m),
      });
      media.set(String(m.post_id), list);
    }
    return media;
  }

  /** A resident's avatar and then their banner, the ones that are set. */
  private profileMedia(residentId: string): MediaView[] {
    return this.rows(
      `SELECT m.id, m.type, m.bytes, m.width, m.height
        FROM profiles pr JOIN media m ON m.id IN (pr.avatar, pr.banner)
        WHERE pr.resident_id = ? ORDER BY m.id = pr.banner`,
      residentId,
    ).map(mediaRowView);
  }

  /** One upload as a file view, if it's still stored. For staff reading a report on a piece. */
  private uploadMedia(mediaId: string): MediaView[] {
    return this.rows("SELECT id, type, bytes, width, height FROM media WHERE id = ?", mediaId).map(
      mediaRowView,
    );
  }

  /** Mentions for each of these posts, in the order they appear. */
  private mentionsFor(ids: string[]): Map<string, MentionView[]> {
    const mentions = new Map<string, MentionView[]>();
    if (ids.length === 0) return mentions;
    for (const m of this.rows(
      `SELECT post_id, handle, resident_id FROM post_mentions
        WHERE post_id IN (${marks(ids.length)}) ORDER BY post_id, ord`,
      ...ids,
    )) {
      const list = mentions.get(String(m.post_id)) ?? [];
      list.push({ handle: String(m.handle), id: String(m.resident_id) });
      mentions.set(String(m.post_id), list);
    }
    return mentions;
  }

  /** Reaction counts, and the viewer's own reactions, for each of these posts. */
  private reactionsFor(
    ids: string[],
    viewerId: string | undefined,
  ): Map<string, { counts: ReactionCounts; mine: ReactionKey[] }> {
    const out = new Map<string, { counts: ReactionCounts; mine: ReactionKey[] }>();
    if (ids.length === 0) return out;
    for (const r of this.rows(
      `SELECT post_id, key, COUNT(*) AS c, SUM(CASE WHEN resident_id = ? THEN 1 ELSE 0 END) AS mine
        FROM reactions WHERE post_id IN (${marks(ids.length)}) GROUP BY post_id, key`,
      viewerId ?? "",
      ...ids,
    )) {
      const key = String(r.key);
      if (!isReactionKey(key)) continue;
      const entry = out.get(String(r.post_id)) ?? { counts: {}, mine: [] };
      entry.counts[key] = Number(r.c);
      if (Number(r.mine) > 0) entry.mine.push(key);
      out.set(String(r.post_id), entry);
    }
    for (const entry of out.values()) {
      entry.mine.sort((a, b) => REACTION_KEYS.indexOf(a) - REACTION_KEYS.indexOf(b));
    }
    return out;
  }

  /** `contentWarning` for text with strong language (RFC 0006), or nothing. */
  private warning(text: string): { contentWarning?: "language" } {
    const warning = this.moderation.contentWarning(text);
    return warning ? { contentWarning: warning } : {};
  }

  /**
   * Compact views of quoted and replied-to posts that are still there. A post by someone the viewer
   * blocked is left out, so it shows as gone.
   */
  private quotedFor(ids: string[], viewerId: string | undefined): Map<string, QuotedPostView> {
    const out = new Map<string, QuotedPostView>();
    if (ids.length === 0) return out;
    const rows = this.rows(
      `SELECT p.id, p.author, p.text, p.reply_to, p.created_at,
        (SELECT avatar FROM profiles a WHERE a.resident_id = p.author) AS avatar,
        (SELECT handle FROM handles h WHERE h.resident_id = p.author AND h.released_at = 0) AS handle,
        (SELECT handle FROM x_links x WHERE x.resident_id = p.author) AS x_handle
      FROM posts p WHERE p.hidden = 0 AND p.id IN (${marks(ids.length)})
        AND p.author NOT IN (SELECT blocked FROM blocks WHERE blocker = ?)
        AND ${NOT_SUSPENDED("p.author")}`,
      ...ids,
      viewerId ?? "",
      this.now(),
    );
    const found = rows.map((row) => String(row.id));
    const media = this.mediaFor(found);
    const mentions = this.mentionsFor(found);
    for (const row of rows) {
      const author = this.author(String(row.author), row.avatar, row.handle, row.x_handle);
      if (!author) continue;
      const id = String(row.id);
      const named = mentions.get(id);
      out.set(id, {
        id,
        trust: "untrusted",
        author,
        text: String(row.text),
        media: media.get(id) ?? [],
        replyTo: row.reply_to ? String(row.reply_to) : null,
        ...(named?.length ? { mentions: named } : {}),
        createdAt: new Date(Number(row.created_at)).toISOString(),
        ...this.warning(String(row.text)),
      });
    }
    return out;
  }

  /**
   * Post views for rows selected with POST_COLUMNS. Posts whose author is gone are dropped.
   * `parents` adds a compact copy of the post each reply answers.
   */
  private views(rows: Row[], viewerId: string | undefined, parents = false): PostView[] {
    if (rows.length === 0) return [];
    const ids = rows.map((row) => String(row.id));
    const media = this.mediaFor(ids);
    const mentions = this.mentionsFor(ids);
    const reactions = this.reactionsFor(ids, viewerId);
    const linked = new Set<string>();
    for (const row of rows) {
      if (row.quote_of) linked.add(String(row.quote_of));
      if (parents && row.reply_to) linked.add(String(row.reply_to));
    }
    const quoted = this.quotedFor([...linked], viewerId);
    return rows.flatMap((row) => {
      const author = this.author(String(row.author), row.avatar, row.handle, row.x_handle);
      if (!author) return [];
      const id = String(row.id);
      const r = reactions.get(id) ?? { counts: {}, mine: [] };
      const hearts = r.counts.heart ?? 0;
      const view: PostView = {
        id,
        trust: "untrusted" as const,
        author,
        text: String(row.text),
        media: media.get(id) ?? [],
        replyTo: row.reply_to ? String(row.reply_to) : null,
        replyCount: Number(row.reply_count),
        likeCount: hearts,
        liked: r.mine.includes("heart"),
        createdAt: new Date(Number(row.created_at)).toISOString(),
        mentions: mentions.get(id) ?? [],
        reactions: r.counts,
        myReactions: r.mine,
        repostCount: Number(row.repost_count),
        quoteCount: Number(row.quote_count),
        reposted: Number(row.reposted) > 0,
        ...this.warning(String(row.text)),
      };
      if (row.quote_of) view.quote = quoted.get(String(row.quote_of)) ?? null;
      if (parents && row.reply_to) view.parent = quoted.get(String(row.reply_to)) ?? null;
      return [view];
    });
  }

  /** An author view by id, with their avatar and handle, or undefined if they're gone. */
  private authorById(id: string): AuthorView | undefined {
    const extra = this.rows(
      `SELECT (SELECT avatar FROM profiles WHERE resident_id = ?) AS avatar,
        (SELECT handle FROM handles WHERE resident_id = ? AND released_at = 0) AS handle,
        (SELECT handle FROM x_links WHERE resident_id = ?) AS x_handle`,
      id,
      id,
      id,
    )[0];
    return this.author(id, extra?.avatar, extra?.handle, extra?.x_handle);
  }

  private author(
    id: string,
    avatar: unknown,
    handle: unknown,
    xHandle: unknown,
  ): AuthorView | undefined {
    const r = this.resident(id);
    if (!r) return undefined;
    const ownerId = r.kind === "agent" ? this.ownerOf(r.id) : undefined;
    const owner = ownerId === undefined ? undefined : this.ref(ownerId);
    return {
      id: r.id,
      name: r.name,
      kind: r.kind,
      color: r.color,
      shape: r.shape,
      avatar: avatar ? mediaUrl(String(avatar)) : null,
      ...(this.townsfolk.has(r.id) ? { townsfolk: true } : {}),
      ...(handle ? { handle: String(handle) } : {}),
      ...xAccount(xHandle),
      ...lookField(r),
      ...(owner ? { owner } : {}),
      ...this.partnerField(r.id),
      ...this.keeperField(r),
    };
  }
}

/** The `x` field for a stored handle, or nothing. A handle that somehow isn't valid is left out. */
function xAccount(handle: unknown): { x?: { handle: string } } {
  return typeof handle === "string" && X_HANDLE.test(handle) ? { x: { handle } } : {};
}

/** A resident's look for the social views, or nothing when they never set one. */
function lookField(r: Resident): { look?: LookView } {
  const look = lookOf(r);
  return Object.keys(look).length > 0 ? { look } : {};
}

const isReactionKey = (key: string): key is ReactionKey =>
  (REACTION_KEYS as readonly string[]).includes(key);

const isGestureKind = (kind: string): kind is GestureKind =>
  (GESTURE_KINDS as readonly string[]).includes(kind);

/** A `plot_admired` notification's plot, stored as its `"px,py"` detail. */
function plotDetail(detail: string): { plot: { px: number; py: number } } | Record<string, never> {
  const m = /^(\d{1,5}),(\d{1,5})$/.exec(detail);
  return m ? { plot: { px: Number(m[1]), py: Number(m[2]) } } : {};
}

/** The start of a post for a notification: one line, cut at a word near EXCERPT_CHARS. */
export function excerpt(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  const chars = Array.from(flat);
  if (chars.length <= EXCERPT_CHARS) return flat;
  const cut = chars.slice(0, EXCERPT_CHARS).join("");
  const space = cut.lastIndexOf(" ");
  return `${(space > EXCERPT_CHARS * 0.6 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

/**
 * Parse a grant from config (townsfolk, maintainers): resident ids separated by commas or
 * whitespace. Anything that isn't a resident id is ignored.
 */
export function parseTownsfolk(value: string | undefined): Set<string> {
  return new Set((value ?? "").split(/[\s,]+/).filter((id) => /^r_[0-9a-f]{16}$/.test(id)));
}

/** Same format as the townsfolk grant. */
export const parseMaintainers = parseTownsfolk;

export const mediaUrl = (id: string) => `/media/${id}`;

export { readerMessage };
