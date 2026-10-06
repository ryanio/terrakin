import {
  type AuthorView,
  EVENT_RULES,
  type EventsResponse,
  type EventView,
  type HostingView,
} from "@terrakin/protocol";
import {
  canBuildOn,
  coinsOf,
  eventArea,
  eventEndsAt,
  eventMoves,
  eventOpen,
  findEvent,
  type HostedEvent,
  hostingProblem,
  inCommons,
  isTownEvent,
  plotKey,
  type ResidentId,
  sameHousehold,
  type WorldState,
} from "@terrakin/sim";
import type { SqlExec } from "./sql-store";
import { unknownAuthor } from "./town";

/**
 * Hosted events (RFC 0010) outside the sim: the views, who said they're going, and each host's
 * record. The sim schedules events, samples attendance, and settles the deposit; this keeps what
 * only the social side knows (going, blocks, resident ages) and what karma reads.
 */

const DAY_MS = 86_400_000;

/** Days the hosting record and karma look back. */
export const HOSTING_WINDOW_DAYS = 90;
/** A guest counts for at most this many hosts a UTC day. */
export const GUEST_HOSTS_PER_DAY = 2;
/** A guest counts once they're this many whole UTC days old, with a hearth. */
export const GUEST_MIN_AGE_DAYS = 3;
/** Upcoming events the Town Hall board shows. `GET /v1/events` has them all. */
const BOARD_UPCOMING = 6;

const iso = (ms: number) => new Date(ms).toISOString();

/** What the views need from the social side, read once per request. */
export interface EventContext {
  now: number;
  author: (id: string) => AuthorView | undefined;
  /** How many said they're going to each event. */
  going: (event: string) => number;
  /** Events the viewer said they're going to. */
  mine: ReadonlySet<string>;
  /** Hosts the viewer shouldn't see: blocked either way, or suspended. Never the town. */
  hidden: (host: ResidentId) => boolean;
}

const person = (ctx: EventContext, id: string) => ctx.author(id) ?? unknownAuthor(id);

export function eventView(
  state: WorldState,
  e: HostedEvent,
  ctx: EventContext,
  viewer?: string,
): EventView {
  const voided = e.voidedBy !== undefined;
  return {
    id: e.id,
    trust: "untrusted",
    kind: e.kind,
    // A called-off event's words stay in the log, but nobody has to read them here again.
    title: voided ? "Called off by a maintainer" : e.title,
    text: voided ? "" : e.text,
    status: e.status,
    host: isTownEvent(e) ? null : person(ctx, e.host),
    town: isTownEvent(e),
    faces: (e.faces ?? []).map((id) => person(ctx, id)),
    place: { px: e.px, py: e.py, commons: inCommons(state.config, e) },
    area: eventArea(state.config, e.px, e.py),
    startsAt: iso(e.startsAt),
    endsAt: iso(eventEndsAt(e)),
    minutes: e.minutes,
    deposit: e.deposit ?? 0,
    going: ctx.going(e.id),
    youreGoing: ctx.mine.has(e.id),
    ticks: e.ticks,
    attended: e.status === "ended" ? (e.attended ?? []).map((id) => person(ctx, id)) : null,
    moves: viewer ? eventMoves(state, viewer, e) : [],
  };
}

const shown = (ctx: EventContext) => (e: HostedEvent) => isTownEvent(e) || !ctx.hidden(e.host);
const soonest = (a: HostedEvent, b: HostedEvent) => a.startsAt - b.startsAt || order(a, b);
const endingFirst = (a: HostedEvent, b: HostedEvent) =>
  eventEndsAt(a) - eventEndsAt(b) || order(a, b);
const number = (e: HostedEvent) => Number(e.id.slice(2));
const order = (a: HostedEvent, b: HostedEvent) => number(a) - number(b);

/** Events on now, ending soonest first, and events to come, soonest first. */
function calendar(state: WorldState, ctx: EventContext, keep: (e: HostedEvent) => boolean) {
  const list = (state.events?.list ?? []).filter((e) => eventOpen(e) && shown(ctx)(e) && keep(e));
  return {
    live: list.filter((e) => e.status === "live").sort(endingFirst),
    upcoming: list.filter((e) => e.status === "scheduled").sort(soonest),
  };
}

/** `GET /v1/events`, with an optional plot or host filter. */
export function eventsView(
  state: WorldState,
  ctx: EventContext,
  viewer: string | undefined,
  filter: { px?: number | undefined; py?: number | undefined; host?: string | undefined },
): EventsResponse {
  const at = filter.px !== undefined && filter.py !== undefined ? filter : undefined;
  const { live, upcoming } = calendar(
    state,
    ctx,
    (e) =>
      (!at || (e.px === at.px && e.py === at.py)) &&
      (filter.host === undefined || e.host === filter.host),
  );
  const view = (e: HostedEvent) => eventView(state, e, ctx, viewer);
  let you: EventsResponse["you"] = null;
  if (viewer && state.residents[viewer]) {
    const why = hostingProblem(state, viewer);
    you = {
      canHost: why === null,
      ...(why === null ? {} : { why }),
      plots: Object.values(state.plots)
        .filter((p) => canBuildOn(p, viewer))
        .sort((a, b) => a.py - b.py || a.px - b.px)
        .map(({ px, py }) => ({ px, py })),
      balance: state.economy ? coinsOf(state, viewer) : null,
    };
  }
  return {
    now: iso(ctx.now),
    live: live.map(view),
    upcoming: upcoming.map(view),
    you,
    rules: EVENT_RULES,
  };
}

/** The Town Hall board's calendar: what's on, and the next few to come. */
export function boardEvents(
  state: WorldState,
  ctx: EventContext,
  viewer?: string,
): { live: EventView[]; upcoming: EventView[] } {
  const { live, upcoming } = calendar(state, ctx, () => true);
  const view = (e: HostedEvent) => eventView(state, e, ctx, viewer);
  return { live: live.map(view), upcoming: upcoming.slice(0, BOARD_UPCOMING).map(view) };
}

/** A guest of an event that ended, and whether they count for the host's record and karma. */
export interface Guest {
  id: ResidentId;
  kind: "human" | "agent";
  counted: boolean;
}

/**
 * Which of an event's attendees count (RFC 0010): at least `GUEST_MIN_AGE_DAYS` old with a hearth,
 * and, for a resident's event, not in the host's household (`sameHousehold`: their person or AIs,
 * and their person's other AIs, decision 0031), not someone who can
 * build on the event's plot, not blocked either way with the host, and not already counted for
 * `GUEST_HOSTS_PER_DAY` other hosts that day. Everyone the sim says attended is listed.
 */
export function countGuests(
  state: WorldState,
  e: HostedEvent,
  options: {
    ageDays: (id: string) => number;
    blockedEither: (a: string, b: string) => boolean;
    /** The other hosts a guest already counted for on the event's day. */
    hostsToday: (guest: string) => ReadonlySet<string>;
  },
): Guest[] {
  const plot = state.plots[plotKey(e.px, e.py)];
  return (e.attended ?? []).flatMap((id) => {
    const r = state.residents[id];
    if (!r) return [];
    const settled = options.ageDays(id) >= GUEST_MIN_AGE_DAYS && r.hearth !== null;
    const fair =
      isTownEvent(e) ||
      (!sameHousehold(state, e.host, id) &&
        !canBuildOn(plot, id) &&
        !options.blockedEither(e.host, id) &&
        [...options.hostsToday(id)].filter((h) => h !== e.host).length < GUEST_HOSTS_PER_DAY);
    return [{ id, kind: r.kind, counted: settled && fair }];
  });
}

/** One host's best event on a day, for karma: its counted guests. */
export interface HostedDay {
  host: ResidentId;
  event: string;
  day: number;
  guests: ResidentId[];
}

/**
 * The social side of events: who said they're going, and what each ended event left for the
 * hosting record and karma. Its tables never feed the sim.
 */
export class EventsSocial {
  constructor(private readonly o: { sql: SqlExec; now: () => number }) {
    for (const statement of [
      `CREATE TABLE IF NOT EXISTS event_going (
        event_id TEXT NOT NULL,
        resident_id TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        PRIMARY KEY (event_id, resident_id)
      )`,
      "CREATE INDEX IF NOT EXISTS event_going_resident ON event_going (resident_id)",
      // One row per event that ended, the town's included, so "events held" counts the empty ones.
      `CREATE TABLE IF NOT EXISTS hosted_events (
        event_id TEXT PRIMARY KEY,
        host TEXT NOT NULL,
        day INTEGER NOT NULL
      )`,
      "CREATE INDEX IF NOT EXISTS hosted_events_host ON hosted_events (host, day)",
      // Everyone who attended an ended event, and whether they counted.
      `CREATE TABLE IF NOT EXISTS event_guests (
        event_id TEXT NOT NULL,
        host TEXT NOT NULL,
        guest TEXT NOT NULL,
        kind TEXT NOT NULL,
        day INTEGER NOT NULL,
        counted INTEGER NOT NULL,
        PRIMARY KEY (event_id, guest)
      )`,
      "CREATE INDEX IF NOT EXISTS event_guests_host ON event_guests (host, day)",
      "CREATE INDEX IF NOT EXISTS event_guests_guest ON event_guests (guest, day)",
    ]) {
      o.sql.exec(statement);
    }
  }

  private rows(query: string, ...bindings: (string | number)[]) {
    return [...this.o.sql.exec(query, ...bindings)];
  }

  /** How many said they're going to `event`. */
  going(event: string): number {
    return Number(
      this.rows("SELECT COUNT(*) AS c FROM event_going WHERE event_id = ?", event)[0]?.c ?? 0,
    );
  }

  /** The events `resident` said they're going to. */
  goingOf(resident: string): Set<string> {
    return new Set(
      this.rows("SELECT event_id FROM event_going WHERE resident_id = ?", resident).map((r) =>
        String(r.event_id),
      ),
    );
  }

  /** Say `resident` is going, or take it back. Repeats change nothing. */
  setGoing(event: string, resident: string, going: boolean) {
    if (going) {
      this.o.sql.exec(
        "INSERT OR IGNORE INTO event_going (event_id, resident_id, created_at) VALUES (?, ?, ?)",
        event,
        resident,
        this.o.now(),
      );
    } else {
      this.o.sql.exec(
        "DELETE FROM event_going WHERE event_id = ? AND resident_id = ?",
        event,
        resident,
      );
    }
  }

  /** The hosts a guest already counted for on `day`. */
  hostsCounted(guest: string, day: number): Set<string> {
    return new Set(
      this.rows(
        "SELECT host FROM event_guests WHERE guest = ? AND day = ? AND counted = 1",
        guest,
        day,
      ).map((r) => String(r.host)),
    );
  }

  /**
   * Keep what an ended event left: one row for each guest, then one for the event. Once per event:
   * the event's row goes last, so a record a crash cut short has none, and recording it again
   * fills in only what's missing.
   */
  recordEnded(e: HostedEvent, day: number, guests: readonly Guest[]) {
    for (const g of guests) {
      this.o.sql.exec(
        `INSERT OR IGNORE INTO event_guests (event_id, host, guest, kind, day, counted)
          VALUES (?, ?, ?, ?, ?, ?)`,
        e.id,
        e.host,
        g.id,
        g.kind,
        day,
        g.counted ? 1 : 0,
      );
    }
    this.o.sql.exec(
      "INSERT OR IGNORE INTO hosted_events (event_id, host, day) VALUES (?, ?, ?)",
      e.id,
      e.host,
      day,
    );
  }

  /**
   * The ended events still in the world without a record, in the order they ended: one that ended
   * before anything was listening (a boot's own catch-up), or whose record a crash cut short.
   */
  unrecorded(state: WorldState): HostedEvent[] {
    const ended = (state.events?.list ?? []).filter((e) => e.status === "ended");
    if (ended.length === 0) return [];
    const kept = new Set(
      this.rows(
        "SELECT event_id FROM hosted_events WHERE day >= ?",
        Math.min(...ended.map((e) => e.closedDay ?? 0)),
      ).map((r) => String(r.event_id)),
    );
    return ended.filter((e) => !kept.has(e.id)).sort(endingFirst);
  }

  /** A host's record over the last `HOSTING_WINDOW_DAYS` days, or undefined when there's none. */
  hostingOf(host: string): HostingView | undefined {
    const from = Math.floor(this.o.now() / DAY_MS) - HOSTING_WINDOW_DAYS;
    const events = Number(
      this.rows(
        "SELECT COUNT(*) AS c FROM hosted_events WHERE host = ? AND day >= ?",
        host,
        from,
      )[0]?.c ?? 0,
    );
    if (events === 0) return undefined;
    const kinds = this.rows(
      `SELECT kind, COUNT(DISTINCT guest) AS c FROM event_guests
        WHERE host = ? AND day >= ? AND counted = 1 GROUP BY kind`,
      host,
      from,
    );
    const of = (kind: string) => Number(kinds.find((r) => r.kind === kind)?.c ?? 0);
    const people = of("human");
    const agents = of("agent");
    return { events, guests: people + agents, people, agents };
  }

  /**
   * What karma reads for the days `[from, to)`: each host's best event a day (the most counted
   * guests, then the earliest), and each host a guest counted for on a day.
   */
  karmaFacts(
    fromDay: number,
    toDay: number,
  ): { hosted: HostedDay[]; attended: { from: string; host: string; day: number }[] } {
    const rows = this.rows(
      `SELECT event_id, host, guest, day FROM event_guests
        WHERE counted = 1 AND day >= ? AND day < ? ORDER BY day, event_id, guest`,
      fromDay,
      toDay,
    );
    const byEvent = new Map<string, HostedDay>();
    const attended = new Map<string, { from: string; host: string; day: number }>();
    for (const r of rows) {
      const event = String(r.event_id);
      const host = String(r.host);
      const guest = String(r.guest);
      const day = Number(r.day);
      const e = byEvent.get(event) ?? { host, event, day, guests: [] };
      e.guests.push(guest);
      byEvent.set(event, e);
      attended.set(`${guest} ${host} ${day}`, { from: guest, host, day });
    }
    const best = new Map<string, HostedDay>();
    for (const e of byEvent.values()) {
      const key = `${e.host} ${e.day}`;
      const had = best.get(key);
      const n = (id: string) => Number(id.slice(2));
      if (
        !had ||
        e.guests.length > had.guests.length ||
        (e.guests.length === had.guests.length && n(e.event) < n(had.event))
      ) {
        best.set(key, e);
      }
    }
    return { hosted: [...best.values()], attended: [...attended.values()] };
  }

  /** Forget who's going to events long gone: rows older than the hosting window. */
  sweep() {
    const cutoff = this.o.now() - HOSTING_WINDOW_DAYS * DAY_MS;
    this.o.sql.exec("DELETE FROM event_going WHERE created_at < ?", cutoff);
  }
}

/**
 * What a check-in shows about events: the ones the viewer said they're going to that start within
 * `withinMs`, the viewer's own coming up that soon, and every event on now, soonest first.
 */
export function checkinEvents(
  state: WorldState,
  ctx: EventContext,
  viewer: string,
  withinMs: number,
): { soon: HostedEvent[]; hosting: HostedEvent[]; live: HostedEvent[] } {
  const { live, upcoming } = calendar(state, ctx, () => true);
  const near = upcoming.filter((e) => e.startsAt - ctx.now <= withinMs);
  return {
    soon: near.filter((e) => ctx.mine.has(e.id)),
    hosting: near.filter((e) => e.host === viewer),
    live,
  };
}

/**
 * An event's words and its host, for reports on one. Undefined when there's no such event, and for
 * a town event, whose words are the team's own.
 */
export function eventWords(
  state: WorldState,
  id: string,
): { author: string; title: string; text: string } | undefined {
  const e = findEvent(state, id);
  return e && !isTownEvent(e) ? { author: e.host, title: e.title, text: e.text } : undefined;
}
