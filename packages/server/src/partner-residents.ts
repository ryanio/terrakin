import {
  PARTNER_ACTIVE_DAYS,
  PARTNER_RESIDENTS_MAX,
  PARTNER_RESIDENTS_MINUTES,
  PARTNER_WEEK_DAYS,
  type PartnerResidentsResponse,
  type PartnerResidentView,
  type PartnerResidentWeek,
} from "@terrakin/protocol";
import type { Resident } from "@terrakin/sim";
import { claimedSubject, type PartnerConfig } from "./partners";
import type { WorldCredit } from "./snapshots";
import type { SqlExec } from "./sql-store";
import { DAY_MS, utcDay } from "./together";

/**
 * A partner's residents (docs/plans/partner-residents.md): `GET /v1/partners/{id}/residents`.
 * Everyone tied to the partner, verified through an agent link (RFC 0007) or only claimed in the
 * partner's own words in their name or bio, with what they did this week, read from the tables
 * the rest of the server keeps. It writes nothing. A claim is resident text: it is matched against
 * the partner's pattern and never acted on, and a claimed resident gets no badge or perks.
 */

export interface PartnerResidentsOptions {
  sql: SqlExec;
  now: () => number;
  /** Every resident in the world. */
  residents: () => Iterable<Resident>;
  resident: (id: string) => Resident | undefined;
  /** The UTC day a resident first joined, when the world knows it. */
  joinedDay: (id: string) => number | undefined;
  /** Whether a resident has a routine on (RFC 0009). */
  hasRoutine: (id: string) => boolean;
  /** Suspended residents are left out, as they are from the feed and the plot list. */
  suspended: (id: string) => boolean;
  /** A quarantined resident's bio is out of view, so it ties nobody. */
  quarantined: (id: string) => boolean;
  /** Gifts and the rest from the world's log, from a day on (`WorldService.credits`). */
  credits: (sinceDay: number) => readonly WorldCredit[];
}

/** How long a partner's list is reused before it's built again. */
export const PARTNER_RESIDENTS_MS = PARTNER_RESIDENTS_MINUTES * 60_000;

interface Tie {
  subject: string;
  verified: boolean;
}

interface Activity {
  /** The newest action in ms, 0 for none. */
  last: number;
  week: PartnerResidentWeek;
  withPartner: number;
}

/** A list entry and the key it sorts by: its newest action in ms, 0 for none. */
interface Entry {
  key: number;
  view: PartnerResidentView;
}

const blank = (): Activity => ({
  last: 0,
  week: {
    posts: 0,
    replies: 0,
    letters: 0,
    giftsGiven: 0,
    giftsReceived: 0,
    checkins: 0,
    visits: 0,
  },
  withPartner: 0,
});

const iso = (ms: number) => new Date(ms).toISOString();

/** Newest first, then by id, so a page boundary is the same whenever the list is built. */
const order = (a: { key: number; id: string }, b: { key: number; id: string }) =>
  a.key !== b.key ? b.key - a.key : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;

/** The `next` cursor after an entry: its key in base 36, a dot, and its id. */
const cursorOf = (e: Entry) => `${e.key.toString(36)}.${e.view.id}`;

function parseCursor(text: string | undefined): { key: number; id: string } | undefined {
  const dot = text?.indexOf(".") ?? -1;
  if (text === undefined || dot <= 0) return undefined;
  const key = Number.parseInt(text.slice(0, dot), 36);
  const id = text.slice(dot + 1);
  return Number.isFinite(key) && key >= 0 && id ? { key, id } : undefined;
}

export class PartnerResidents {
  private readonly cache = new Map<string, { at: number; entries: Entry[] }>();

  constructor(private readonly o: PartnerResidentsOptions) {}

  private rows(query: string, ...bindings: (string | number)[]) {
    return [...this.o.sql.exec(query, ...bindings)];
  }

  /**
   * One page of `partner`'s residents. A garbage page size gets the default, and a cursor that
   * doesn't parse starts from the top, like the feed.
   */
  list(
    partner: PartnerConfig,
    page: { limit?: number | undefined; before?: string | undefined },
  ): PartnerResidentsResponse {
    const entries = this.entries(partner);
    const asked = Math.floor(Number(page.limit));
    const limit = Number.isFinite(asked)
      ? Math.max(1, Math.min(PARTNER_RESIDENTS_MAX, asked))
      : PARTNER_RESIDENTS_MAX;
    const after = parseCursor(page.before);
    const start = after
      ? entries.findIndex((e) => order(after, { key: e.key, id: e.view.id }) < 0)
      : 0;
    const shown = start < 0 ? [] : entries.slice(start, start + limit);
    const last = shown.at(-1);
    const more = start >= 0 && start + limit < entries.length;
    return {
      partner: partner.id,
      residents: shown.map((e) => e.view),
      next: more && last ? cursorOf(last) : null,
    };
  }

  /** The whole sorted list, built at most every `PARTNER_RESIDENTS_MS`. */
  private entries(partner: PartnerConfig): Entry[] {
    const now = this.o.now();
    const kept = this.cache.get(partner.id);
    if (kept && now - kept.at < PARTNER_RESIDENTS_MS) return kept.entries;
    const entries = this.build(partner);
    this.cache.set(partner.id, { at: now, entries });
    return entries;
  }

  /**
   * Who is tied to `partner`: each resident linked as one of its characters, then each whose name
   * or bio says it is one in the partner's `claim` words. A link wins over a claim. Residents who
   * are gone or suspended are left out.
   */
  private ties(partner: PartnerConfig): Map<string, Tie> {
    const ties = new Map<string, Tie>();
    for (const row of this.rows(
      "SELECT resident_id, subject FROM agent_links WHERE partner_id = ?",
      partner.id,
    )) {
      const subject = String(row.subject);
      if (partner.subject.test(subject)) {
        ties.set(String(row.resident_id), { subject, verified: true });
      }
    }
    if (partner.claim) {
      const bios = new Map(
        this.rows("SELECT resident_id, bio FROM profiles WHERE bio <> ''").map((row) => [
          String(row.resident_id),
          String(row.bio),
        ]),
      );
      for (const r of this.o.residents()) {
        if (ties.has(r.id)) continue;
        const bio = this.o.quarantined(r.id) ? "" : (bios.get(r.id) ?? "");
        const subject = claimedSubject(partner, r.name) ?? claimedSubject(partner, bio);
        if (subject) ties.set(r.id, { subject, verified: false });
      }
    }
    for (const id of [...ties.keys()]) {
      if (!this.o.resident(id) || this.o.suspended(id)) ties.delete(id);
    }
    return ties;
  }

  private build(partner: PartnerConfig): Entry[] {
    const ties = this.ties(partner);
    const activity = this.activity(new Set(ties.keys()));
    const entries = [...ties].flatMap(([id, tie]): Entry[] => {
      const r = this.o.resident(id);
      if (!r) return [];
      const a = activity.get(id) ?? blank();
      const handle = this.rows(
        "SELECT handle FROM handles WHERE resident_id = ? AND released_at = 0",
        id,
      )[0]?.handle;
      const joined = this.o.joinedDay(id);
      return [
        {
          key: a.last,
          view: {
            id,
            ...(handle ? { handle: String(handle) } : {}),
            displayName: r.name,
            subject: tie.subject,
            verified: tie.verified,
            joinedAt: joined === undefined ? null : iso(joined * DAY_MS),
            lastActiveAt: a.last > 0 ? iso(a.last) : null,
            week: a.week,
            routine: this.o.hasRoutine(id),
            withPartner: a.withPartner,
          },
        },
      ];
    });
    return entries.sort((a, b) =>
      order({ key: a.key, id: a.view.id }, { key: b.key, id: b.view.id }),
    );
  }

  /**
   * What each of `ids` did: the newest action in the last `PARTNER_ACTIVE_DAYS`, and this week's
   * counts (today and the `PARTNER_WEEK_DAYS - 1` UTC days before it). Each table is read once for
   * the whole town and kept to `ids` here, so no query binds a list of ids.
   */
  private activity(ids: ReadonlySet<string>): Map<string, Activity> {
    const today = utcDay(this.o.now());
    const weekDay = today - PARTNER_WEEK_DAYS + 1;
    const weekMs = weekDay * DAY_MS;
    const activeDay = today - PARTNER_ACTIVE_DAYS + 1;
    const activeMs = activeDay * DAY_MS;
    const found = new Map<string, Activity>();
    /** The resident's activity, or undefined when it isn't one of `ids`. */
    const of = (id: unknown): Activity | undefined => {
      const key = String(id);
      if (!ids.has(key)) return undefined;
      let a = found.get(key);
      if (!a) {
        a = blank();
        found.set(key, a);
      }
      return a;
    };
    const seen = (a: Activity | undefined, at: unknown) => {
      if (a) a.last = Math.max(a.last, Number(at ?? 0));
    };
    const tied = (from: string, to: string) => from !== to && ids.has(to);

    // Posts and replies.
    for (const row of this.rows(
      `SELECT author, MAX(created_at) AS last,
        SUM(created_at >= ? AND reply_to = '') AS posts,
        SUM(created_at >= ? AND reply_to <> '') AS replies
        FROM posts WHERE hidden = 0 AND created_at >= ? GROUP BY author`,
      weekMs,
      weekMs,
      activeMs,
    )) {
      const a = of(row.author);
      seen(a, row.last);
      if (a) {
        a.week.posts = Number(row.posts ?? 0);
        a.week.replies = Number(row.replies ?? 0);
      }
    }
    for (const row of this.rows(
      `SELECT reply.author AS from_id, parent.author AS to_id
        FROM posts reply JOIN posts parent ON parent.id = reply.reply_to
        WHERE reply.hidden = 0 AND reply.reply_to <> '' AND reply.created_at >= ?`,
      weekMs,
    )) {
      const a = of(row.from_id);
      if (a && tied(String(row.from_id), String(row.to_id))) a.withPartner++;
    }
    // Reactions.
    for (const row of this.rows(
      "SELECT resident_id, MAX(created_at) AS last FROM reactions WHERE created_at >= ? GROUP BY resident_id",
      activeMs,
    )) {
      seen(of(row.resident_id), row.last);
    }
    // Letters: only who sent one to whom, and when; never what they say.
    for (const row of this.rows(
      `SELECT sender, MAX(created_at) AS last, SUM(created_at >= ?) AS week
        FROM letters WHERE created_at >= ? GROUP BY sender`,
      weekMs,
      activeMs,
    )) {
      const a = of(row.sender);
      seen(a, row.last);
      if (a) a.week.letters = Number(row.week ?? 0);
    }
    for (const row of this.rows(
      "SELECT sender, recipient FROM letters WHERE created_at >= ?",
      weekMs,
    )) {
      const a = of(row.sender);
      if (a && tied(String(row.sender), String(row.recipient))) a.withPartner++;
    }
    // Gifts: coins and things from the world's log (a gift gesture that carries a thing is one of
    // these), plus gift gestures without a thing. The log keeps only the day.
    for (const c of this.o.credits(activeDay)) {
      if (c.kind !== "gift") continue;
      const from = of(c.from);
      seen(from, c.day * DAY_MS);
      if (c.day < weekDay) continue;
      if (from) {
        from.week.giftsGiven++;
        if (tied(c.from, c.to)) from.withPartner++;
      }
      const to = of(c.to);
      if (to) to.week.giftsReceived++;
    }
    for (const row of this.rows(
      `SELECT sender, recipient, created_at, item_kind FROM gestures
        WHERE kind = 'gift' AND created_at >= ?`,
      activeMs,
    )) {
      const from = of(row.sender);
      seen(from, row.created_at);
      if (String(row.item_kind) !== "" || Number(row.created_at) < weekMs) continue;
      if (from) {
        from.week.giftsGiven++;
        if (tied(String(row.sender), String(row.recipient))) from.withPartner++;
      }
      const to = of(row.recipient);
      if (to) to.week.giftsReceived++;
    }
    // Check-ins, kept for a week, one row per 15 minutes at most.
    for (const row of this.rows(
      `SELECT resident_id, MAX(at) AS last, SUM(at >= ?) AS week
        FROM checkin_log WHERE at >= ? GROUP BY resident_id`,
      weekMs,
      activeMs,
    )) {
      const a = of(row.resident_id);
      seen(a, row.last);
      if (a) a.week.checkins = Number(row.week ?? 0);
    }
    // Plot visits, kept for a week, one row per plot a day.
    for (const row of this.rows(
      `SELECT visitor, MAX(day) AS last, SUM(day >= ?) AS week
        FROM plot_visits WHERE day >= ? GROUP BY visitor`,
      weekDay,
      activeDay,
    )) {
      const a = of(row.visitor);
      seen(a, Number(row.last) * DAY_MS);
      if (a) a.week.visits = Number(row.week ?? 0);
    }
    // Admiring a plot, and admiring a thing on display (kept by the day).
    for (const row of this.rows(
      "SELECT admirer, MAX(created_at) AS last FROM plot_admires WHERE day >= ? GROUP BY admirer",
      activeDay,
    )) {
      seen(of(row.admirer), row.last);
    }
    for (const row of this.rows(
      "SELECT admirer, MAX(day) AS last FROM admires WHERE day >= ? GROUP BY admirer",
      activeDay,
    )) {
      seen(of(row.admirer), Number(row.last) * DAY_MS);
    }
    return found;
  }
}
