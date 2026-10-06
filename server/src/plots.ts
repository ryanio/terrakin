import {
  type AuthorView,
  type ErrorCode,
  PLOT_ADMIRE,
  type PlotSort,
  type PlotView,
} from "@terrakin/protocol";
import {
  canBuildOn,
  displaysOf,
  type Input,
  own,
  type Plot,
  parseKey,
  plotDistance,
  plotInBounds,
  plotKey,
  residentById,
  type WorldEvent,
  type WorldState,
} from "@terrakin/sim";
import type { SocialResult } from "./social-service";
import type { SqlExec } from "./sql-store";
import { DAY_MS, utcDay } from "./together";

/**
 * Plots worth visiting (RFC 0020): who visited and who admired each plot, and when each last
 * changed. Social data, never world state and never in the log, like praise (decision 0047).
 *
 * Admiring a plot is a thank-you for a place: once a UTC day per resident per plot, only from on
 * it, or from beside it after a visit this week, never your own, your household's, or across a
 * block, and it earns nothing. Every admire is its own row, kept like praise. Visits are rows
 * too (one per visitor, plot, and day), kept only for the week the counts cover. `plot_changes`
 * keeps the newest time something on each plot changed, written as the world commits
 * (`noteCommitted`).
 */

export interface PlotVisitsOptions {
  sql: SqlExec;
  now: () => number;
  exists: (id: string) => boolean;
  blockedEither: (a: string, b: string) => boolean;
  /** Whether two residents are one household: a person and an AI they claimed, or two of their AIs. */
  household: (a: string, b: string) => boolean;
  /** Whole UTC days since a resident joined (`WorldService.residentAgeDays`). */
  ageDays: (id: string) => number;
  /** A suspended owner's plot is closed for now, like their gallery and their stall. */
  suspended: (id: string) => boolean;
  /** Tell one of the plot's residents (the social layer's notifications, with its caps). */
  notify: (recipient: string, actor: string, plot: { px: number; py: number }) => void;
}

/** What the plot views read from the tables, for one viewer. */
export interface PlotFacts {
  /** When something on a plot last changed, and who owned it then, by plot key. */
  changed: Map<string, { owner: string; at: number }>;
  /** Distinct visitors and admirers this week, by plot key and owner (`"px,py|owner"`). */
  visitors: Map<string, number>;
  admirers: Map<string, number>;
  /** Plots the viewer admired today, by plot key. */
  admiredToday: Set<string>;
}

/** World events that change how a plot looks, and the tile (or plot) each one is on. */
const CHANGES: ReadonlySet<WorldEvent["type"]> = new Set([
  "block_placed",
  "block_removed",
  "ground_laid",
  "ground_lifted",
  "planted",
  "harvested",
  "displayed",
  "taken_down",
  "display_removed",
  "hearth_set",
]);

/** The claimed plots an input's events changed, each once. */
export function plotsChangedBy(state: WorldState, events: readonly WorldEvent[]): Plot[] {
  const size = state.config.plotSize;
  const keys = new Set<string>();
  for (const e of events) {
    if (e.type === "plot_claimed") keys.add(plotKey(e.px, e.py));
    else if (CHANGES.has(e.type) && "x" in e && "y" in e) {
      keys.add(plotKey(Math.floor(e.x / size), Math.floor(e.y / size)));
    }
  }
  return [...keys].flatMap((key) => {
    const plot = own(state.plots, key);
    return plot ? [plot] : [];
  });
}

const fail = (code: ErrorCode, message: string, retryAfter?: number) => ({
  ok: false as const,
  code,
  message,
  ...(retryAfter === undefined ? {} : { retryAfter }),
});

/** The plot (px, py) if someone lives on it. */
function plotAt(state: WorldState, px: number, py: number): Plot | undefined {
  return plotInBounds(state.config, px, py) ? own(state.plots, plotKey(px, py)) : undefined;
}

const weekKey = (px: number, py: number, owner: string) => `${plotKey(px, py)}|${owner}`;

export class PlotVisits {
  constructor(private readonly o: PlotVisitsOptions) {
    for (const statement of [
      // One row per admire, kept for good, like praise. The key is the once-a-day rule.
      `CREATE TABLE IF NOT EXISTS plot_admires (
        admirer TEXT NOT NULL,
        px INTEGER NOT NULL,
        py INTEGER NOT NULL,
        owner TEXT NOT NULL,
        day INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        PRIMARY KEY (admirer, px, py, day)
      )`,
      "CREATE INDEX IF NOT EXISTS plot_admires_day ON plot_admires (day)",
      "CREATE INDEX IF NOT EXISTS plot_admires_admirer ON plot_admires (admirer, day)",
      // One row per visitor, plot, and day, kept for the week the counts cover.
      `CREATE TABLE IF NOT EXISTS plot_visits (
        visitor TEXT NOT NULL,
        px INTEGER NOT NULL,
        py INTEGER NOT NULL,
        owner TEXT NOT NULL,
        day INTEGER NOT NULL,
        PRIMARY KEY (visitor, px, py, day)
      )`,
      "CREATE INDEX IF NOT EXISTS plot_visits_day ON plot_visits (day)",
      // The newest time something on each plot changed, and who owned it then.
      `CREATE TABLE IF NOT EXISTS plot_changes (
        px INTEGER NOT NULL,
        py INTEGER NOT NULL,
        owner TEXT NOT NULL,
        changed_at INTEGER NOT NULL,
        PRIMARY KEY (px, py)
      )`,
    ]) {
      o.sql.exec(statement);
    }
  }

  private count(query: string, ...bindings: (string | number)[]): number {
    return Number([...this.o.sql.exec(query, ...bindings)][0]?.c ?? 0);
  }

  /** The first UTC day this week's counts cover. */
  private weekFrom(): number {
    return utcDay(this.o.now()) - PLOT_ADMIRE.weekDays + 1;
  }

  /**
   * After the world commits an input: note when each plot it changed changed, and a visit. A visit
   * by someone in the plot's household isn't counted.
   */
  noteCommitted(state: WorldState, input: Input, events: readonly WorldEvent[]): void {
    const now = this.o.now();
    for (const plot of plotsChangedBy(state, events)) {
      this.o.sql.exec(
        `INSERT INTO plot_changes (px, py, owner, changed_at) VALUES (?, ?, ?, ?)
          ON CONFLICT (px, py) DO UPDATE SET owner = excluded.owner, changed_at = excluded.changed_at`,
        plot.px,
        plot.py,
        plot.ownerId,
        now,
      );
    }
    const { actor, command } = input;
    if (command.type !== "visit" || !events.some((e) => e.type === "moved")) return;
    const plot = plotAt(state, command.px, command.py);
    if (
      !plot ||
      [plot.ownerId, ...(plot.coOwners ?? [])].some((id) => this.o.household(actor, id))
    ) {
      return;
    }
    const day = utcDay(now);
    this.o.sql.exec("DELETE FROM plot_visits WHERE day < ?", this.weekFrom());
    this.o.sql.exec(
      "INSERT OR IGNORE INTO plot_visits (visitor, px, py, owner, day) VALUES (?, ?, ?, ?, ?)",
      actor,
      plot.px,
      plot.py,
      plot.ownerId,
      day,
    );
  }

  /** Whether `visitor` visited the plot this week while its owner had it: one lookup on the key. */
  private visitedThisWeek(visitor: string, plot: Plot): boolean {
    return (
      this.count(
        `SELECT EXISTS (SELECT 1 FROM plot_visits
          WHERE visitor = ? AND px = ? AND py = ? AND day >= ? AND owner = ?) AS c`,
        visitor,
        plot.px,
        plot.py,
        this.weekFrom(),
        plot.ownerId,
      ) > 0
    );
  }

  /** Seconds until the next UTC day, when the daily limits reset. */
  private untilTomorrow(): number {
    const now = this.o.now();
    return Math.max(1, Math.ceil((DAY_MS - (now % DAY_MS)) / 1000));
  }

  /** Admire plot (px, py) as `admirer`. Checks everything first, writes one row, and tells them. */
  admire(state: WorldState, admirer: string, px: number, py: number): SocialResult<null> {
    if (!this.o.exists(admirer)) return fail("unauthorized", "Unknown resident.");
    const plot = plotAt(state, px, py);
    if (!plot) return fail("not_found", "Nobody lives on that plot.");
    if (this.o.suspended(plot.ownerId)) return fail("not_found", "That plot is closed for now.");
    if (canBuildOn(plot, admirer)) {
      return fail("own_plot", "That's your own plot. Admire your neighbors' instead.");
    }
    const residents = [plot.ownerId, ...(plot.coOwners ?? [])];
    if (residents.some((id) => this.o.household(admirer, id))) {
      return fail(
        "forbidden",
        "That plot is your own household's: a person and their AIs don't admire each other's.",
      );
    }
    if (residents.some((id) => this.o.blockedEither(admirer, id))) {
      return fail("forbidden", "You can't admire this plot.");
    }
    const me = residentById(state, admirer);
    const away = me ? plotDistance(state.config, me, px, py) : Number.POSITIVE_INFINITY;
    const visit = `{"type": "visit", "px": ${px}, "py": ${py}}`;
    if (away > PLOT_ADMIRE.nearTiles) {
      return fail(
        "out_of_reach",
        `Stand on the plot or beside it to admire it. Visit it first: ${visit}.`,
      );
    }
    // Beside a plot takes a visit this week, so a neighbor can't admire it from their own edge.
    // On it is enough: whoever stands there came, and \`visit\` refuses a plot you're already on.
    if (away > 0 && !this.visitedThisWeek(admirer, plot)) {
      return fail(
        "out_of_reach",
        `To admire this plot from beside it, visit it first: ${visit}. Standing on it works too.`,
      );
    }
    const day = utcDay(this.o.now());
    const wait = this.untilTomorrow();
    if (this.o.ageDays(admirer) < PLOT_ADMIRE.minAgeDays) {
      return fail(
        "rate_limited",
        "You can admire plots from your second day here. Try again after midnight UTC.",
        wait,
      );
    }
    if (
      this.count(
        "SELECT COUNT(*) AS c FROM plot_admires WHERE admirer = ? AND px = ? AND py = ? AND day = ?",
        admirer,
        px,
        py,
        day,
      ) > 0
    ) {
      return fail(
        "already_admired",
        "You admired this plot today. You can again after midnight UTC.",
      );
    }
    if (
      this.count(
        "SELECT COUNT(*) AS c FROM plot_admires WHERE admirer = ? AND day = ?",
        admirer,
        day,
      ) >= PLOT_ADMIRE.perAdmirerPerDay
    ) {
      return fail(
        "rate_limited",
        `You've admired ${PLOT_ADMIRE.perAdmirerPerDay} plots today. You can again after midnight UTC.`,
        wait,
      );
    }
    this.o.sql.exec(
      "INSERT INTO plot_admires (admirer, px, py, owner, day, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      admirer,
      px,
      py,
      plot.ownerId,
      day,
      this.o.now(),
    );
    for (const id of residents) this.o.notify(id, admirer, { px, py });
    return { ok: true, value: null };
  }

  /** This week's counts, the newest changes, and what `viewer` admired today. */
  facts(viewer?: string): PlotFacts {
    const from = this.weekFrom();
    const tally = (table: "plot_admires" | "plot_visits", who: "admirer" | "visitor") => {
      const counts = new Map<string, number>();
      for (const row of this.o.sql.exec(
        `SELECT px, py, owner, COUNT(DISTINCT ${who}) AS c FROM ${table} WHERE day >= ? GROUP BY px, py, owner`,
        from,
      )) {
        counts.set(weekKey(Number(row.px), Number(row.py), String(row.owner)), Number(row.c));
      }
      return counts;
    };
    const changed = new Map<string, { owner: string; at: number }>();
    for (const row of this.o.sql.exec("SELECT px, py, owner, changed_at FROM plot_changes")) {
      changed.set(plotKey(Number(row.px), Number(row.py)), {
        owner: String(row.owner),
        at: Number(row.changed_at),
      });
    }
    const admiredToday = new Set<string>();
    if (viewer !== undefined) {
      for (const row of this.o.sql.exec(
        "SELECT px, py FROM plot_admires WHERE admirer = ? AND day = ?",
        viewer,
        utcDay(this.o.now()),
      )) {
        admiredToday.add(plotKey(Number(row.px), Number(row.py)));
      }
    }
    return {
      changed,
      visitors: tally("plot_visits", "visitor"),
      admirers: tally("plot_admires", "admirer"),
      admiredToday,
    };
  }
}

/** How the views order plots: newest change, or most admirers this week. */
const ORDER: Record<PlotSort, (a: PlotView, b: PlotView) => number> = {
  recent: (a, b) =>
    (b.changedAt ?? "").localeCompare(a.changedAt ?? "") ||
    b.visitors - a.visitors ||
    a.py - b.py ||
    a.px - b.px,
  admired: (a, b) =>
    b.admirers - a.admirers || b.visitors - a.visitors || a.py - b.py || a.px - b.px,
};

/**
 * Every plot someone lives on, as `GET /v1/plots` shows them: whose it is, when it last changed,
 * this week's visitors and admirers, and what's on it, from the world and the tables. `hidden`
 * leaves out a plot by any of its residents (a suspended owner, or someone blocked either way
 * with the viewer). Nothing here is private: the world snapshot already shows plots, blocks,
 * and displays, and the counts never say who.
 */
export function plotViews(
  state: WorldState,
  facts: PlotFacts,
  author: (id: string) => AuthorView | undefined,
  options: {
    viewer?: string | undefined;
    hidden?: (plot: Plot) => boolean;
    sort?: PlotSort;
    /** Just this plot, for `GET /v1/plots/{px}/{py}` and an admire's answer. */
    only?: { px: number; py: number };
  },
): PlotView[] {
  const size = state.config.plotSize;
  const blocks = new Map<string, number>();
  for (const key of Object.keys(state.blocks)) {
    const [x, y] = parseKey(key);
    const at = plotKey(Math.floor(x / size), Math.floor(y / size));
    blocks.set(at, (blocks.get(at) ?? 0) + 1);
  }
  const displays = new Map<string, number>();
  for (const key of Object.keys(displaysOf(state))) {
    const [x, y] = parseKey(key);
    const at = plotKey(Math.floor(x / size), Math.floor(y / size));
    displays.set(at, (displays.get(at) ?? 0) + 1);
  }
  const views: PlotView[] = [];
  const { only } = options;
  for (const [key, plot] of Object.entries(state.plots)) {
    if (only && (plot.px !== only.px || plot.py !== only.py)) continue;
    if (options.hidden?.(plot)) continue;
    const owner = author(plot.ownerId);
    if (!owner) continue;
    const change = facts.changed.get(key);
    const at =
      change?.owner === plot.ownerId
        ? change.at
        : plot.claimedDay === undefined
          ? undefined
          : plot.claimedDay * DAY_MS;
    const week = weekKey(plot.px, plot.py, plot.ownerId);
    views.push({
      px: plot.px,
      py: plot.py,
      owner,
      coOwners: (plot.coOwners ?? []).flatMap((id) => {
        const a = author(id);
        return a ? [a] : [];
      }),
      changedAt: at === undefined ? null : new Date(at).toISOString(),
      visitors: facts.visitors.get(week) ?? 0,
      admirers: facts.admirers.get(week) ?? 0,
      ...(options.viewer === undefined ? {} : { admiredToday: facts.admiredToday.has(key) }),
      blocks: blocks.get(key) ?? 0,
      displays: displays.get(key) ?? 0,
      ...(plot.gallery ? { gallery: true as const } : {}),
    });
  }
  return views.sort(ORDER[options.sort ?? "recent"]);
}
