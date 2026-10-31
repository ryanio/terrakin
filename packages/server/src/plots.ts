import {
  type AuthorView,
  type ErrorCode,
  PLOT_ADMIRE,
  type PlotSort,
  type PlotView,
} from "@terrakin/protocol";
import {
  blocksOn,
  canBuildOn,
  DAY_MS,
  edgesOn,
  FLOORS,
  type Furnishing,
  furnishing,
  furnishings,
  type Good,
  type GradedWalls,
  gradedWalls,
  type Input,
  knockedToday,
  MINUTE_MS,
  own,
  type Plot,
  parseKey,
  plotDistance,
  plotInBounds,
  plotKey,
  plotListing,
  potsOf,
  residentById,
  tileKey,
  trickOrTreatDay,
  utcDay,
  type WorldEvent,
  type WorldState,
} from "@terrakin/sim";
import {
  addNews,
  NEWS_FIELDS,
  newsLine,
  newsOfEvent,
  noNews,
  type PlotNews,
  someNews,
} from "./plot-news";
import type { SocialResult } from "./social-service";
import type { SqlExec } from "./sql-store";

/**
 * Plots worth visiting (RFC 0020): who visited and who admired each plot, when each last changed,
 * and what is new on it. Social data, never world state and never in the log, like praise
 * (decision 0047).
 *
 * Admiring a plot is a thank-you for a place: once a UTC day per resident per plot, only from on
 * it, or from beside it after a visit this week, never your own, your household's, or across a
 * block, and it earns nothing. Every admire is its own row, kept like praise. Visits are rows
 * too (one per visitor, plot, and day), kept only for the week the counts cover: a `visit`, or a
 * resident's own step or putter that lands on someone else's plot (decision 0092). `plot_changes`
 * keeps the newest time something on each plot changed, and `plot_news` the newest UTC day's worth
 * of what arrived there, which `plot-news.ts` turns into one public line. All of them are written
 * as the world commits (`noteCommitted`).
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
  /**
   * Whether staff hold a resident's words back (a quarantine, RFC 0006): a plot name they wrote
   * stays out of view (decision 0121). Default: nobody's are.
   */
  held?: (id: string) => boolean;
  /** Tell one of the plot's residents (the social layer's notifications, with its caps). */
  notify: (recipient: string, actor: string, plot: { px: number; py: number }) => void;
}

/** How long `GET /v1/plots` reuses the list it built, unless an admire or a visit comes first. */
export const PLOT_LIST_MS = MINUTE_MS;

/** What the plot views read from the tables: for every plot, or for one. */
export interface PlotFacts {
  /** When something on a plot last changed, and who owned it then, by plot key. */
  changed: Map<string, { owner: string; at: number }>;
  /** Distinct visitors and admirers this week, by plot key and owner (`"px,py|owner"`). */
  visitors: Map<string, number>;
  admirers: Map<string, number>;
  /** What is new on a plot in one line, and who owned it then, by plot key. */
  news: Map<string, { owner: string; line: string }>;
}

/** A resident as the plot views name them, or undefined for one who's gone. */
export type PlotAuthor = (id: string) => AuthorView | undefined;

/**
 * Who reads the plots. `hidden` leaves out a plot by its residents: a suspended owner, or someone
 * the viewer blocked.
 */
export interface PlotViewer {
  viewer?: string | undefined;
  hidden?: (plot: PlotView) => boolean;
}

/**
 * World events that change how a plot looks, on the tile each one names. A new world event that
 * changes a plot belongs here or in `PLOT_CHANGES`, and nothing will tell you: these are sets of
 * names, so a missing one compiles and quietly does nothing, unlike a `switch` on the event's type
 * ([learning](../../../docs/knowledge/learnings/2026-10-20-a-switch-on-world-events-is-checked-a-set-of-their-names-is-.md)).
 */
const CHANGES: ReadonlySet<WorldEvent["type"]> = new Set([
  "block_placed",
  "block_removed",
  "ground_laid",
  "ground_lifted",
  "planted",
  "harvested",
  "displayed",
  "find_displayed",
  "taken_down",
  "display_removed",
  "hearth_set",
]);

/** The same, on the plot each one names rather than a tile. */
const PLOT_CHANGES: ReadonlySet<WorldEvent["type"]> = new Set([
  "plot_claimed",
  "plot_sold",
  "floor_added",
  "roof_set",
  "roof_top_set",
  "roof_changed",
  "gallery_set",
]);

/**
 * The claimed plots an input's events changed, each once, with that input's news on each. A
 * `plot_named` isn't here: a name is the plot's words rather than a change to the place, and it's
 * already on the card.
 */
function plotsChangedBy(
  state: WorldState,
  events: readonly WorldEvent[],
): { plot: Plot; news: PlotNews }[] {
  const size = state.config.plotSize;
  const found = new Map<string, PlotNews>();
  const on = (key: string, event: WorldEvent) => {
    const news = found.get(key) ?? noNews();
    found.set(key, news);
    for (const [field, count] of Object.entries(newsOfEvent(event) ?? {})) {
      news[field as keyof PlotNews] += count;
    }
  };
  for (const e of events) {
    if (PLOT_CHANGES.has(e.type) && "px" in e && "py" in e) on(plotKey(e.px, e.py), e);
    else if (CHANGES.has(e.type) && "x" in e && "y" in e) {
      on(plotKey(Math.floor(e.x / size), Math.floor(e.y / size)), e);
    }
  }
  return [...found].flatMap(([key, news]) => {
    const plot = own(state.plots, key);
    return plot ? [{ plot, news }] : [];
  });
}

/**
 * A plot's name as everyone sees it (decision 0121): undefined when it has none, or while staff
 * hold back the words of whoever named it (a quarantine, RFC 0006).
 */
export function shownPlotName(
  plot: Pick<Plot, "name" | "namedBy" | "ownerId">,
  hidden: (residentId: string) => boolean,
): string | undefined {
  if (plot.name === undefined) return undefined;
  return hidden(plot.namedBy ?? plot.ownerId) ? undefined : plot.name;
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
      "CREATE INDEX IF NOT EXISTS plot_admires_plot ON plot_admires (px, py, day)",
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
      "CREATE INDEX IF NOT EXISTS plot_visits_plot ON plot_visits (px, py, day)",
      // The newest time something on each plot changed, and who owned it then.
      `CREATE TABLE IF NOT EXISTS plot_changes (
        px INTEGER NOT NULL,
        py INTEGER NOT NULL,
        owner TEXT NOT NULL,
        changed_at INTEGER NOT NULL,
        PRIMARY KEY (px, py)
      )`,
      // The newest UTC day's worth of what arrived on each plot, and who owned it then, which
      // `plot-news.ts` turns into one public line. One row per plot, whoever is looking.
      `CREATE TABLE IF NOT EXISTS plot_news (
        px INTEGER NOT NULL,
        py INTEGER NOT NULL,
        owner TEXT NOT NULL,
        day INTEGER NOT NULL,
        ${NEWS_FIELDS.map((field) => `${field} INTEGER NOT NULL`).join(", ")},
        PRIMARY KEY (px, py)
      )`,
    ]) {
      o.sql.exec(statement);
    }
    // `CREATE TABLE IF NOT EXISTS` does nothing to a table that already exists, so a field added
    // to `NEWS_FIELDS` after a world's first boot never reaches its `plot_news`, and every read
    // and write naming it fails with `no such column`. That is how `ridge` took terrakin.org's
    // `GET /v1/plots/{px}/{py}` down (decision 0337 shipped the field, and nothing added the
    // column). Add whatever is missing, every boot: a new count starts at 0 for every plot,
    // which is what "nothing of that arrived" means anyway.
    for (const field of NEWS_FIELDS) {
      try {
        o.sql.exec(`ALTER TABLE plot_news ADD COLUMN ${field} INTEGER NOT NULL DEFAULT 0`);
      } catch {
        // Already there.
      }
    }
  }

  /** The list `GET /v1/plots` last built, before any viewer's parts, and when. */
  private listed: { at: number; views: PlotView[] } | null = null;

  /**
   * Visits already written today, as `visitor|px,py`, so a walk across a plot costs one write a
   * day, not a lookup a step. Forgotten when the UTC day changes, and on a restart, when the
   * table's key keeps a visit from counting twice anyway.
   */
  private visited = { day: -1, keys: new Set<string>() };

  private count(query: string, ...bindings: (string | number)[]): number {
    return Number([...this.o.sql.exec(query, ...bindings)][0]?.c ?? 0);
  }

  /** The first UTC day this week's counts cover. */
  private weekFrom(): number {
    return utcDay(this.o.now()) - PLOT_ADMIRE.weekDays + 1;
  }

  /**
   * After the world commits an input: note when each plot it changed changed, and a visit: a
   * `visit`, or a resident's own `move` or `putter` step that lands on someone else's plot
   * (decision 0092). A routine's steps are the town's input, so they never count.
   */
  noteCommitted(state: WorldState, input: Input, events: readonly WorldEvent[]): void {
    const now = this.o.now();
    const today = utcDay(now);
    for (const { plot, news } of plotsChangedBy(state, events)) {
      this.o.sql.exec(
        `INSERT INTO plot_changes (px, py, owner, changed_at) VALUES (?, ?, ?, ?)
          ON CONFLICT (px, py) DO UPDATE SET owner = excluded.owner, changed_at = excluded.changed_at`,
        plot.px,
        plot.py,
        plot.ownerId,
        now,
      );
      this.noteNews(plot, news, today);
    }
    const { actor, command } = input;
    const day = utcDay(now);
    if (command.type === "visit") {
      const plot = plotAt(state, command.px, command.py);
      if (plot && events.some((e) => e.type === "moved")) this.noteVisit(actor, plot, day, false);
      return;
    }
    if (command.type !== "move" && command.type !== "putter") return;
    const size = state.config.plotSize;
    for (const e of events) {
      if (e.type !== "moved" || e.residentId !== actor) continue;
      const plot = plotAt(state, Math.floor(e.x / size), Math.floor(e.y / size));
      if (plot) this.noteVisit(actor, plot, day, true);
    }
  }

  /** The news on a plot's row, with the day and owner it was written for, or undefined. */
  private newsRow(plot: Plot): { owner: string; day: number; news: PlotNews } | undefined {
    const row = [
      ...this.o.sql.exec(
        `SELECT owner, day, ${NEWS_FIELDS.join(", ")} FROM plot_news WHERE px = ? AND py = ?`,
        plot.px,
        plot.py,
      ),
    ][0];
    if (!row) return undefined;
    const news = noNews();
    for (const field of NEWS_FIELDS) news[field] = Number(row[field]);
    return { owner: String(row.owner), day: Number(row.day), news };
  }

  /**
   * Keep what arrived on a plot today: added to the row when it already holds this plot's own
   * today, and in place of it otherwise, so a line reads as a day's work rather than its last
   * block, and a day that only took things away leaves the day before it standing.
   */
  private noteNews(plot: Plot, news: PlotNews, today: number): void {
    if (!someNews(news)) return;
    const was = this.newsRow(plot);
    const day =
      was && was.owner === plot.ownerId && was.day === today ? addNews(was.news, news) : news;
    this.o.sql.exec(
      `INSERT INTO plot_news (px, py, owner, day, ${NEWS_FIELDS.join(", ")})
        VALUES (?, ?, ?, ?, ${NEWS_FIELDS.map(() => "?").join(", ")})
        ON CONFLICT (px, py) DO UPDATE SET owner = excluded.owner, day = excluded.day,
          ${NEWS_FIELDS.map((field) => `${field} = excluded.${field}`).join(", ")}`,
      plot.px,
      plot.py,
      plot.ownerId,
      today,
      ...NEWS_FIELDS.map((field) => day[field]),
    );
  }

  /**
   * A visit to `plot` on UTC `day`: one row per visitor, plot, and day, never for the plot's own
   * household (its owner, a resident it's shared with, or a person and their AIs). A walk-in also
   * never counts across a block or on a suspended owner's plot, which `visit` refuses before it's
   * logged.
   */
  private noteVisit(visitor: string, plot: Plot, day: number, walked: boolean) {
    if (canBuildOn(plot, visitor)) return;
    if (this.visited.day !== day) this.visited = { day, keys: new Set() };
    const key = `${visitor}|${plotKey(plot.px, plot.py)}`;
    if (this.visited.keys.has(key)) return;
    const residents = [plot.ownerId, ...(plot.coOwners ?? [])];
    if (residents.some((id) => this.o.household(visitor, id))) return;
    if (
      walked &&
      (this.o.suspended(plot.ownerId) || residents.some((id) => this.o.blockedEither(visitor, id)))
    ) {
      return;
    }
    this.o.sql.exec("DELETE FROM plot_visits WHERE day < ?", this.weekFrom());
    this.o.sql.exec(
      "INSERT OR IGNORE INTO plot_visits (visitor, px, py, owner, day) VALUES (?, ?, ?, ?, ?)",
      visitor,
      plot.px,
      plot.py,
      plot.ownerId,
      day,
    );
    this.visited.keys.add(key);
    // The visitor may be new this week: the list counts again.
    this.listed = null;
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
    this.listed = null;
    for (const id of residents) this.o.notify(id, admirer, { px, py });
    return { ok: true, value: null };
  }

  /**
   * This week's counts and the newest changes, for every plot, or for `only`. It takes the world
   * because a ridge line names what stands on the plot's ridge now (RFC 0041).
   */
  facts(state: WorldState, only?: { px: number; py: number }): PlotFacts {
    const where = only ? " AND px = ? AND py = ?" : "";
    const at = only ? [only.px, only.py] : [];
    const tally = (table: "plot_admires" | "plot_visits", who: "admirer" | "visitor") => {
      const counts = new Map<string, number>();
      for (const row of this.o.sql.exec(
        `SELECT px, py, owner, COUNT(DISTINCT ${who}) AS c FROM ${table}
          WHERE day >= ?${where} GROUP BY px, py, owner`,
        this.weekFrom(),
        ...at,
      )) {
        counts.set(weekKey(Number(row.px), Number(row.py), String(row.owner)), Number(row.c));
      }
      return counts;
    };
    const changed = new Map<string, { owner: string; at: number }>();
    for (const row of this.o.sql.exec(
      `SELECT px, py, owner, changed_at FROM plot_changes${only ? " WHERE px = ? AND py = ?" : ""}`,
      ...at,
    )) {
      changed.set(plotKey(Number(row.px), Number(row.py)), {
        owner: String(row.owner),
        at: Number(row.changed_at),
      });
    }
    // The line is written here, with the clock the whole read shares, so the views stay pure and
    // "today" can't change halfway down a page of cards.
    const today = utcDay(this.o.now());
    // The pots standing on each plot (RFC 0047), with the day each was set down, so a day that set
    // down one names it.
    const size = state.config.plotSize;
    const pots = new Map<string, { day: number; good: Good }[]>();
    for (const { x, y, pot } of potsOf(state)) {
      const key = plotKey(Math.floor(x / size), Math.floor(y / size));
      pots.set(key, [...(pots.get(key) ?? []), { day: pot.day, good: pot.good }]);
    }
    const news = new Map<string, { owner: string; line: string }>();
    for (const row of this.o.sql.exec(
      `SELECT px, py, owner, day, ${NEWS_FIELDS.join(", ")} FROM plot_news${
        only ? " WHERE px = ? AND py = ?" : ""
      }`,
      ...at,
    )) {
      const counts = noNews();
      for (const field of NEWS_FIELDS) counts[field] = Number(row[field]);
      const key = plotKey(Number(row.px), Number(row.py));
      const day = Number(row.day);
      const setDown = (pots.get(key) ?? []).filter((p) => p.day === day);
      const pot = setDown.length === 1 ? setDown[0]?.good : undefined;
      const line = newsLine(counts, day, today, own(state.plots, key)?.roof?.top, pot);
      if (line === undefined) continue;
      news.set(key, { owner: String(row.owner), line });
    }
    return {
      changed,
      visitors: tally("plot_visits", "visitor"),
      admirers: tally("plot_admires", "admirer"),
      news,
    };
  }

  /** The plots `viewer` admired today, by plot key. */
  admiredToday(viewer: string): Set<string> {
    const keys = new Set<string>();
    for (const row of this.o.sql.exec(
      "SELECT px, py FROM plot_admires WHERE admirer = ? AND day = ?",
      viewer,
      utcDay(this.o.now()),
    )) {
      keys.add(plotKey(Number(row.px), Number(row.py)));
    }
    return keys;
  }

  /**
   * Every plot someone lives on, as `GET /v1/plots` lists them for `who`, in `sort` order. The
   * views are built at most once a minute (`PLOT_LIST_MS`), and again after an admire or a visit,
   * so a busy home wall costs one build a minute. What's the viewer's (`hidden`, `admiredToday`)
   * is read on every call.
   */
  list(state: WorldState, author: PlotAuthor, sort: PlotSort, who: PlotViewer = {}): PlotView[] {
    const now = this.o.now();
    if (!this.listed || now - this.listed.at >= PLOT_LIST_MS) {
      this.listed = { at: now, views: plotViews(state, this.facts(state), author) };
    }
    return this.forViewer(state, this.listed.views, who).sort(ORDER[sort]);
  }

  /**
   * Plot (px, py), as `GET /v1/plots/{px}/{py}` and an admire's answer show it: read fresh, from
   * that plot's rows and tiles only.
   */
  one(
    state: WorldState,
    author: PlotAuthor,
    px: number,
    py: number,
    who: PlotViewer = {},
  ): PlotView | undefined {
    const only = { px, py };
    return this.forViewer(state, plotViews(state, this.facts(state, only), author, only), who)[0];
  }

  /**
   * The views as `who` reads them: without the plots `hidden` leaves out, with each plot's name as
   * the world has it now (decision 0121), so a new name never waits for the list to be built
   * again, and with `admiredToday` and on Halloween night `knockedToday` (RFC 0022), from the
   * world's own knocks.
   */
  private forViewer(state: WorldState, views: readonly PlotView[], who: PlotViewer): PlotView[] {
    const viewer = who.viewer;
    const today = viewer === undefined ? undefined : this.admiredToday(viewer);
    const knocked =
      viewer !== undefined && trickOrTreatDay(state.day)
        ? new Set(knockedToday(state, viewer))
        : undefined;
    return views.flatMap((view) => {
      if (who.hidden?.(view)) return [];
      const key = plotKey(view.px, view.py);
      const name = this.nameOf(state, view);
      return [
        {
          ...view,
          ...(name === undefined ? {} : { name, trust: "untrusted" as const }),
          ...(today ? { admiredToday: today.has(key) } : {}),
          ...(today && knocked ? { knockedToday: knocked.has(key) } : {}),
        },
      ];
    });
  }

  /**
   * A plot's name as the world has it now, while the plot is still the one the view shows (same
   * owner), unless staff hold back the words of whoever named it.
   */
  private nameOf(state: WorldState, view: PlotView): string | undefined {
    const plot = own(state.plots, plotKey(view.px, view.py));
    if (!plot || plot.ownerId !== view.owner.id) return undefined;
    return shownPlotName(plot, this.o.held ?? (() => false));
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
 * Plots someone lives on, as the plot routes show them: whose it is, when it last changed, what is
 * new on it, this week's visitors and admirers, and what's on it on every floor, from the world and
 * `facts`. Every plot, or only
 * `only`, which looks at that plot's own tiles rather than every block in the world. Unsorted, and
 * without the viewer's parts. Nothing here is private: the world snapshot already shows plots,
 * blocks, and displays, the counts never say who, and the line is our words from counts alone.
 */
function plotViews(
  state: WorldState,
  facts: PlotFacts,
  author: PlotAuthor,
  only?: { px: number; py: number },
): PlotView[] {
  const size = state.config.plotSize;
  // Made things and finds alike: everything standing on a pedestal or hanging in a frame.
  const shown = state.items?.displays ?? {};
  const blocks = new Map<string, number>();
  const displays = new Map<string, number>();
  // The ground floor and every floor above it (RFC 0028).
  const floors = Array.from({ length: FLOORS.max + 1 }, (_, floor) => blocksOn(state, floor));
  if (only) {
    let onDisplay = 0;
    for (const tile of plotTiles(state, only.px, only.py)) {
      if (own(shown, tile) !== undefined) onDisplay++;
    }
    blocks.set(plotKey(only.px, only.py), blocksOnPlot(state, only.px, only.py));
    displays.set(plotKey(only.px, only.py), onDisplay);
  } else {
    const add = (counts: Map<string, number>, tile: string) => {
      const [x, y] = parseKey(tile);
      const at = plotKey(Math.floor(x / size), Math.floor(y / size));
      counts.set(at, (counts.get(at) ?? 0) + 1);
    };
    for (const layer of floors) for (const tile of Object.keys(layer)) add(blocks, tile);
    for (const tile of Object.keys(shown)) add(displays, tile);
  }
  // How furnished each home is (RFC 0050): the one plot's own tiles, or one pass over the world.
  const furnished = only
    ? new Map([[plotKey(only.px, only.py), furnishing(state, only.px, only.py)]])
    : furnishings(state);
  // Its walls between tiles (RFC 0050): one pass over the world's lines either way.
  const lines = edgeCounts(state);
  // Its graded walls (RFC 0051): one pass over the world's grades either way, which are few.
  const graded = gradedWalls(state);
  const one = only ? own(state.plots, plotKey(only.px, only.py)) : undefined;
  // For sale (RFC 0039): on the one plot's read only, since the list is built once a minute.
  const forSale = only ? plotListing(state, only.px, only.py) : undefined;
  const plots = only ? (one ? [one] : []) : Object.values(state.plots);
  const views: PlotView[] = [];
  for (const plot of plots) {
    const key = plotKey(plot.px, plot.py);
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
    // What is new is this plot's own: a line written while someone else owned it says nothing
    // about the home standing here now.
    const fresh = facts.news.get(key);
    views.push({
      px: plot.px,
      py: plot.py,
      owner,
      coOwners: (plot.coOwners ?? []).flatMap((id) => {
        const a = author(id);
        return a ? [a] : [];
      }),
      changedAt: at === undefined ? null : new Date(at).toISOString(),
      ...(fresh?.owner === plot.ownerId ? { news: fresh.line } : {}),
      visitors: facts.visitors.get(week) ?? 0,
      admirers: facts.admirers.get(week) ?? 0,
      blocks: blocks.get(key) ?? 0,
      edges: lines.get(key) ?? 0,
      ...(plot.floors ? { floors: plot.floors } : {}),
      displays: displays.get(key) ?? 0,
      ...furnishedView(furnished.get(key)),
      ...wallsView(graded.get(key)),
      ...lastSoldView(plot),
      ...(forSale
        ? { listing: { price: forSale.price, day: forSale.day, listed: forSale.listed } }
        : {}),
      ...(plot.gallery ? { gallery: true as const } : {}),
    });
  }
  return views;
}

/**
 * A plot's `walls` counts (RFC 0051), or nothing when it has no graded wall. The plot market's
 * listings read it too.
 */
export function wallsView(w: GradedWalls | undefined): Pick<PlotView, "walls"> {
  return w && w.fine + w.masterwork > 0
    ? { walls: { fine: w.fine, masterwork: w.masterwork } }
    : {};
}

/**
 * Walls, windows, hedges and doors on the lines between tiles (RFC 0050), on every floor, counted
 * for each plot by the tile a line is keyed by, as graded walls are (`gradedWalls`).
 */
export function edgeCounts(state: WorldState): Map<string, number> {
  const size = state.config.plotSize;
  const counts = new Map<string, number>();
  for (let floor = 0; floor <= FLOORS.max; floor++) {
    for (const key of Object.keys(edgesOn(state, floor))) {
      const [x, y] = parseKey(key);
      const at = plotKey(Math.floor(x / size), Math.floor(y / size));
      counts.set(at, (counts.get(at) ?? 0) + 1);
    }
  }
  return counts;
}

/** What a plot last sold for and when (RFC 0039), or nothing when it never changed hands. */
export function lastSoldView(plot: Plot): Pick<PlotView, "lastSold"> {
  return plot.boughtFor === undefined || plot.boughtDay === undefined
    ? {}
    : { lastSold: { price: plot.boughtFor, day: plot.boughtDay } };
}

/** A plot's `furnished` counts, or nothing when it has none to show. */
export function furnishedView(f: Furnishing | undefined): Pick<PlotView, "furnished"> {
  if (!f) return {};
  const onShow = f.onSurfaces + f.onWalls + f.onDisplay;
  if (f.pieces === 0 && onShow === 0) return {};
  return { furnished: { pieces: f.pieces, onShow, kinds: f.kinds } };
}

/** Every tile key of plot (px, py). */
function plotTiles(state: WorldState, px: number, py: number): string[] {
  const size = state.config.plotSize;
  const tiles: string[] = [];
  for (let y = py * size; y < (py + 1) * size; y++) {
    for (let x = px * size; x < (px + 1) * size; x++) tiles.push(tileKey(x, y));
  }
  return tiles;
}

/** Blocks on plot (px, py), on every floor, decor and stations included (RFC 0028). */
export function blocksOnPlot(state: WorldState, px: number, py: number): number {
  const floors = Array.from({ length: FLOORS.max + 1 }, (_, floor) => blocksOn(state, floor));
  let placed = 0;
  for (const tile of plotTiles(state, px, py)) {
    for (const layer of floors) if (own(layer, tile) !== undefined) placed++;
  }
  return placed;
}
