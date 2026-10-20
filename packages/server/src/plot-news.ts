import { PLOT_ADMIRE } from "@terrakin/protocol";
import type { RoofTop, WorldEvent } from "@terrakin/sim";

/**
 * What is new on a plot, as the Visit page says it (RFC 0020): one public line of what changed
 * there lately, in our own words, written from counts and codes alone and never from anything a
 * resident wrote, the way a plot photo's story line is (decision 0307).
 *
 * The counts are one UTC day's changes on one plot, tallied as the world commits inputs, so a day
 * of building reads as one line rather than as its last block. Only what arrived counts: a wall
 * taken down or a roof removed is no news, so an input that only takes things away leaves the day
 * before it standing.
 *
 * Everything it can say is already public in the world snapshot, which lists plots, blocks,
 * crops, displays, and roofs for anyone. It never says who did it, never counts what went into
 * anyone's things, and never quotes a name, a label, or a note.
 */

/** A UTC day's news on one plot. Counts and flags only, each the number that arrived that day. */
export interface PlotNews {
  /** Opened as a gallery (`set_gallery`). */
  gallery: number;
  /** A roof went up (RFC 0041). A roof taken down is no news. */
  roof: number;
  /** Floors added above the ground floor (RFC 0028). */
  floors: number;
  /** The plot was claimed. */
  claimed: number;
  /** Blocks placed, on every floor, decor and stations included. */
  blocks: number;
  /** Seeds planted. */
  planted: number;
  /** Something new on the roof's ridge (RFC 0041). A ridge left bare is no news. */
  ridge: number;
  /** Things put on display, made things and finds alike. */
  displays: number;
  /** Tiles of path or flooring laid. */
  paths: number;
  /** Crops picked. */
  picked: number;
}

/** The fields of a day's news, so the table and its reads name them once. */
export const NEWS_FIELDS = [
  "gallery",
  "roof",
  "floors",
  "claimed",
  "blocks",
  "planted",
  "ridge",
  "displays",
  "paths",
  "picked",
] as const satisfies readonly (keyof PlotNews)[];

/** A day with nothing on it. */
export const noNews = (): PlotNews => ({
  gallery: 0,
  roof: 0,
  floors: 0,
  claimed: 0,
  blocks: 0,
  planted: 0,
  ridge: 0,
  displays: 0,
  paths: 0,
  picked: 0,
});

/** Whether a day holds anything worth a line. */
export const someNews = (news: PlotNews): boolean => NEWS_FIELDS.some((f) => news[f] > 0);

/** Two tallies of the same plot and the same day, added together. */
export function addNews(a: PlotNews, b: PlotNews): PlotNews {
  const sum = noNews();
  for (const field of NEWS_FIELDS) sum[field] = a[field] + b[field];
  return sum;
}

/**
 * What one event adds to the plot it happened on, or nothing. Events that take something away
 * (a block removed, ground lifted, a display taken down, a roof or a gallery closed) count for
 * nothing: the line is a reason to come and look.
 */
export function newsOfEvent(event: WorldEvent): Partial<PlotNews> | undefined {
  switch (event.type) {
    case "plot_claimed":
      return { claimed: 1 };
    case "gallery_set":
      return event.open ? { gallery: 1 } : undefined;
    case "roof_set":
      return event.style === "flat" ? undefined : { roof: 1 };
    // A ridge alone is its own event (decision 0337), so a vane on a roof that went up weeks ago
    // is never counted as the roof going up. A ridge left bare carries no `top` and is no news.
    case "roof_top_set":
      return event.top === undefined ? undefined : { ridge: 1 };
    case "floor_added":
      return { floors: 1 };
    case "block_placed":
      return { blocks: 1 };
    case "ground_laid":
      return { paths: 1 };
    case "planted":
      return { planted: 1 };
    case "harvested":
      return { picked: 1 };
    case "displayed":
    case "find_displayed":
      return { displays: 1 };
    default:
      return undefined;
  }
}

/** What stands on a roof's ridge, in the words SKILL.md gives each one (RFC 0041). */
const RIDGE_WORDS: Record<RoofTop, string> = {
  vane: "a weather vane",
  flag: "a flag",
  nest: "a bird's nest",
};

/** "a block" / "4 blocks", for the few things a line counts. */
function some(count: number, one: string, many: string): string {
  return count === 1 ? `a ${one}` : `${count} ${many}`;
}

/**
 * What a day's news is called, in the order a home changes most visibly: the first that happened
 * is the whole line, since a card has one line for it beside the drawing and two things joined
 * with "and" wrap on a phone.
 */
function whatHappened(news: PlotNews, top: RoofTop | undefined): string | undefined {
  if (news.gallery > 0) return "opened as a gallery";
  if (news.roof > 0) return "a roof went up";
  // "Upstairs" is what a floor is called in what people read (decision 0252).
  if (news.floors > 0) {
    return news.floors === 1 ? "an upstairs went up" : `${news.floors} floors went up`;
  }
  if (news.claimed > 0) return "someone moved in";
  if (news.blocks > 0) return `${some(news.blocks, "new block", "new blocks")} went up`;
  if (news.planted > 0) return `${some(news.planted, "bed", "beds")} planted`;
  // Below the building: a ridge is one tile of ornament, however far it is seen from. `top` is
  // what stands there now, so a ridge set and cleared the same day falls through, and with nothing
  // else that day the card goes back to saying how lately the plot changed.
  if (news.ridge > 0 && top) return `${RIDGE_WORDS[top]} on the ridge`;
  if (news.displays > 0) return `${some(news.displays, "new thing", "new things")} on display`;
  if (news.paths > 0) return `${some(news.paths, "path", "paths")} laid`;
  if (news.picked > 0) return `${some(news.picked, "crop", "crops")} picked`;
  return undefined;
}

/**
 * How many UTC days of news a line says. Older than this, a card says how lately the plot changed
 * instead. The same week the visitor and admirer counts cover, so a card reads as one week.
 */
const NEWS_DAYS = PLOT_ADMIRE.weekDays;

/** Sunday first, as `getUTCDay` counts them. UTC day 0 was a Thursday, so day + 4 lands right. */
const WEEKDAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

/**
 * When a day's news happened, in words rather than a count: today, yesterday, or the weekday,
 * which reads for the week the line covers and no longer. Nothing past that week.
 */
function whenWords(day: number, today: number): string | undefined {
  const ago = today - day;
  if (ago < 0 || ago >= NEWS_DAYS) return undefined;
  if (ago === 0) return "today";
  if (ago === 1) return "yesterday";
  return `on ${WEEKDAYS[(day + 4) % 7]}`;
}

/**
 * The line a card says: "A roof went up on Tuesday", "3 beds planted today". `top` is what stands
 * on the plot's ridge now, which names a ridge line. Nothing for a day with nothing on it, or news
 * older than the week (`NEWS_DAYS`), when the card falls back to saying how lately the plot
 * changed.
 */
export function newsLine(
  news: PlotNews,
  day: number,
  today: number,
  top?: RoofTop | undefined,
): string | undefined {
  const what = whatHappened(news, top);
  const when = whenWords(day, today);
  if (what === undefined || when === undefined) return undefined;
  return `${what[0]?.toUpperCase()}${what.slice(1)} ${when}`;
}
