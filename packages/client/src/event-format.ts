/**
 * Pure helpers for hosted events (RFC 0010): what a kind is called, when an event is in the
 * viewer's own time, how long it runs, the Schedule sheet's start times, and where the world draws
 * an event's lanterns. The server decides every event; these only describe what it said.
 */
import type { EventView, HostingView } from "@terrakin/protocol";
import type { EventKind } from "@terrakin/sim";
import { plural } from "@terrakin/ui/format";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** What each kind is called on a card and in the Schedule sheet. */
export const KIND_WORDS: Record<EventKind, string> = {
  show: "Show",
  class: "Class",
  market: "Market",
  listening: "Listening session",
  gathering: "Gathering",
};

/** "1 hour", "90 minutes", "9 hours". */
export function lengthWords(minutes: number): string {
  if (minutes % 60 === 0) return plural(minutes / 60, "hour", "hours");
  return plural(minutes, "minute", "minutes");
}

/** The calendar day of `ms` in `timeZone`, as "YYYY-MM-DD", to compare days. */
function dayIn(ms: number, timeZone?: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(ms);
}

/** "19:00" in `timeZone` (the viewer's, unless a test names one). */
function clockWords(ms: number, timeZone?: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(ms);
}

/**
 * When an event starts, in the viewer's own time: "Today 19:00", "Tomorrow 18:00", or "Sat 31 Oct,
 * 18:00". `now` is the server's time, so a slow or wrong clock on the phone doesn't move it.
 */
export function whenWords(startsAt: string, now: number, timeZone?: string): string {
  const ms = Date.parse(startsAt);
  const clock = clockWords(ms, timeZone);
  const day = dayIn(ms, timeZone);
  if (day === dayIn(now, timeZone)) return `Today ${clock}`;
  if (day === dayIn(now + DAY, timeZone)) return `Tomorrow ${clock}`;
  const date = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    weekday: "short",
    day: "numeric",
    month: "short",
  }).format(ms);
  return `${date}, ${clock}`;
}

/** How soon: "Starts in 40 minutes", "Starts in 2 hours", or, once it's on, "On until 21:00". */
export function soonWords(
  e: Pick<EventView, "startsAt" | "endsAt" | "status">,
  now: number,
  timeZone?: string,
) {
  if (e.status === "live") return `On until ${clockWords(Date.parse(e.endsAt), timeZone)}`;
  const ms = Date.parse(e.startsAt) - now;
  if (ms <= MINUTE) return "Starting now";
  if (ms < 90 * MINUTE) return `Starts in ${plural(Math.round(ms / MINUTE), "minute", "minutes")}`;
  if (ms < 2 * DAY) return `Starts in ${plural(Math.round(ms / HOUR), "hour", "hours")}`;
  return `Starts in ${plural(Math.round(ms / DAY), "day", "days")}`;
}

/** Where it is, from the host's side: "In the Commons", or at the host's plot. */
export function placeWords(e: Pick<EventView, "place" | "host">): string {
  if (e.place.commons) return "In the Commons";
  return e.host ? `At ${e.host.name}'s plot` : `At plot ${e.place.px}, ${e.place.py}`;
}

/**
 * Where the Schedule sheet starts: the first whole hour at least two hours from `now`, so it's
 * past the hour's notice the server asks for even after a while in the sheet.
 */
export function defaultStart(now: number): number {
  return Math.ceil((now + 2 * HOUR) / HOUR) * HOUR;
}

const pad = (n: number) => String(n).padStart(2, "0");

/** `ms` as a `datetime-local` input's value, in the viewer's own time. */
export function toLocalInput(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** A `datetime-local` value, in the viewer's own time, as ms; NaN when it isn't one. */
export function fromLocalInput(value: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!m) return Number.NaN;
  const [y, mo, d, h, mi] = m.slice(1).map(Number) as [number, number, number, number, number];
  return new Date(y, mo - 1, d, h, mi).getTime();
}

/** Lengths the Schedule sheet offers, in minutes. */
export const LENGTHS = [30, 60, 90, 120, 180] as const;

/** An event as the world map knows it: where, when, and whether it's on. */
export interface EventMark {
  id: string;
  px: number;
  py: number;
  status: "scheduled" | "live";
  startsAt: number;
  town?: true;
}

/** A lantern to draw on the map. `lit` while its event is on. */
export interface Lantern {
  x: number;
  y: number;
  lit: boolean;
}

/**
 * The lanterns the map draws for events: one on an event's plot on its UTC day, lit while it's on,
 * on the first open corner of the plot (blocks and buildings taken into account), and, while the
 * town's own event is on in the Commons, a ring of lit lanterns along its edge. Drawing only.
 */
export function eventLanterns(
  marks: Iterable<EventMark>,
  world: {
    plotSize: number;
    day: number | undefined;
    /** A block or a building stands there. */
    taken: (x: number, y: number) => boolean;
  },
): Lantern[] {
  const out: Lantern[] = [];
  const seen = new Set<string>();
  const put = (x: number, y: number, lit: boolean) => {
    const key = `${x},${y}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ x, y, lit });
  };
  const s = world.plotSize;
  for (const e of marks) {
    const today = world.day !== undefined && Math.floor(e.startsAt / DAY) === world.day;
    if (e.status !== "live" && !today) continue;
    const lit = e.status === "live";
    const x0 = e.px * s;
    const y0 = e.py * s;
    if (lit && e.town) {
      // Festive: every other tile along the Commons' edge that's open.
      for (let i = 0; i < s; i++) {
        for (const [x, y] of [
          [x0 + i, y0],
          [x0 + i, y0 + s - 1],
          [x0, y0 + i],
          [x0 + s - 1, y0 + i],
        ] as const) {
          if ((x + y) % 2 === 0 && !world.taken(x, y)) put(x, y, true);
        }
      }
      continue;
    }
    const corners = [
      [x0, y0],
      [x0 + s - 1, y0],
      [x0, y0 + s - 1],
      [x0 + s - 1, y0 + s - 1],
    ] as const;
    const open = corners.find(([x, y]) => !world.taken(x, y));
    if (open) put(open[0], open[1], lit);
  }
  return out;
}

/** A host's record on their profile: "Hosted 6 events, 41 guests (30 people, 11 AIs)". */
export function hostingWords(h: HostingView): string {
  const held = `Hosted ${plural(h.events, "event", "events")}`;
  if (h.guests === 0) return held;
  const split = [
    h.people > 0 ? plural(h.people, "person", "people") : null,
    h.agents > 0 ? plural(h.agents, "AI", "AIs") : null,
  ].filter(Boolean);
  return `${held}, ${plural(h.guests, "guest", "guests")} (${split.join(", ")})`;
}
