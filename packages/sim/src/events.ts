import { coinCount as coins, isWhole, refuse } from "./check";
import { DAY_MS, MINUTE_MS } from "./clock";
import { isTownsfolk, movePurse, sameHousehold } from "./economy";
import { setFloor, standingFloor } from "./floors";
import { plotKey, tileKey } from "./keys";
import { own, residentById } from "./own";
import { townEligibility } from "./town";
import type {
  Command,
  EventStatus,
  EventsState,
  HostedEvent,
  Rejection,
  ResidentId,
  Tile,
  WorldConfig,
  WorldEvent,
  WorldState,
} from "./types";
import { EVENT_KINDS, TOWN_ACTOR } from "./types";
import { visitTile } from "./visit";
import { worldGround } from "./walk";
import { canBuildOn, chebyshev, commonsPlot, isCommons, plotCenter, plotInBounds } from "./world";

/**
 * Hosted events (RFC 0010): a resident, or the town, puts on an event at a place and a time, and
 * the sim counts who was there.
 *
 * The sim never reads a clock. The server logs an event's life as town inputs from its minute
 * sweep: `event_start` when its time comes, `event_tick` at each 5-minute mark while it's live,
 * and `event_end` when it's over. At each tick the sim adds one for every resident who is online
 * and standing in the event's area, so attendance replays from the log like everything else.
 * Nothing here runs until the first event is scheduled, so older worlds hash as they always have.
 */

/**
 * The numbers (RFC 0010). Replay checks logged events against them, so changing one that a logged
 * input already met needs a logged switch, the way `set_shop_share` does for the shop.
 */
export const EVENTS = {
  /** Titles, in characters. */
  titleMax: 80,
  /** Texts, in characters. */
  textMax: 500,
  /** The shortest event, in minutes. */
  minutesMin: 15,
  /** The longest event a resident hosts, in minutes. */
  minutesMax: 180,
  /**
   * The longest town event, in minutes: long enough for one evening that spans Europe and the
   * Americas (decision 0081).
   */
  townMinutesMax: 720,
  /** Minutes between attendance samples. */
  tickMinutes: 5,
  /** Minutes kept free between two events at one place. */
  gapMinutes: 15,
  /** An event starts today, or up to this many UTC days ahead. */
  aheadDays: 14,
  /** Events one host may have on the calendar (scheduled or live) at once. */
  scheduledMax: 2,
  /** One Commons event per host in any stretch of this many days. */
  commonsEveryDays: 7,
  /** Coins a Commons booking holds until the event ends or is called off. */
  deposit: 10,
  /** Attendees from outside the host's household that bring the deposit back. */
  refundAt: 3,
  /** Tiles around the plot that count as being at the event, on every side. */
  ring: 2,
  /** Samples a resident must be seen at to have attended... */
  attendTicks: 2,
  /** ...or one in this many of the samples taken, if that's more... */
  attendShare: 3,
  /**
   * ...counting at most the samples of the longest resident event (35 in 180 minutes), so a long
   * town event asks for an hour, as a three-hour one does (decision 0081).
   */
  attendTicksCap: 35,
  /** Townsfolk a town event may name as its face. */
  facesMax: 3,
  /** Ended and cancelled events stay in the world this many days after their day. */
  keepDays: 30,
} as const;

/** A town event's key from the server's config. */
const KEY_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;

type Mutation = () => WorldEvent[];
export type EventsChecked = Mutation | Rejection;

/** An event by id, wherever it is in the list. */
export const findEvent = (state: WorldState, id: unknown): HostedEvent | undefined =>
  typeof id === "string" ? state.events?.list.find((e) => e.id === id) : undefined;

/** Still on the calendar: scheduled or live. */
export const eventOpen = (e: HostedEvent) => e.status === "scheduled" || e.status === "live";

/** The town hosts it: no deposit, no host limits, no hosting record. */
export const isTownEvent = (e: HostedEvent) => e.host === TOWN_ACTOR;

/** When an event ends, in ms. */
export const eventEndsAt = (e: Pick<HostedEvent, "startsAt" | "minutes">) =>
  e.startsAt + e.minutes * MINUTE_MS;

/** The UTC day a time falls on. */
export const eventDayOf = (startsAt: number) => Math.floor(startsAt / DAY_MS);

/**
 * The last 5-minute mark an event of `minutes` samples. Marks are 1, 2, ... (5, 10, ... minutes
 * in), always before the end: a 15-minute event samples twice, a 3-hour one 35 times.
 */
export const lastSlot = (minutes: number) => Math.ceil(minutes / EVENTS.tickMinutes) - 1;

/** Samples a resident must have been seen at to have attended, given how many were taken. */
export function attendNeeded(ticks: number): number {
  const counted = Math.min(ticks, EVENTS.attendTicksCap);
  return Math.max(EVENTS.attendTicks, Math.ceil(counted / EVENTS.attendShare));
}

/** Coins held for Commons bookings still on the calendar. Part of the supply identity. */
export function eventHeld(state: WorldState): number {
  let held = 0;
  for (const e of state.events?.list ?? []) if (eventOpen(e)) held += e.deposit ?? 0;
  return held;
}

/** Tiles from (x0, y0) to (x1, y1), both included. */
export interface Area {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** Where being at an event counts: plot (px, py) and `EVENTS.ring` tiles around it, inside the world. */
export function eventArea(config: WorldConfig, px: number, py: number): Area {
  const s = config.plotSize;
  return {
    x0: Math.max(0, px * s - EVENTS.ring),
    y0: Math.max(0, py * s - EVENTS.ring),
    x1: Math.min(config.width - 1, (px + 1) * s - 1 + EVENTS.ring),
    y1: Math.min(config.height - 1, (py + 1) * s - 1 + EVENTS.ring),
  };
}

export const inArea = (a: Area, x: number, y: number) =>
  x >= a.x0 && x <= a.x1 && y >= a.y0 && y <= a.y1;

/** Whether tile (x, y) is in the event's area. */
export const inEventArea = (
  config: WorldConfig,
  e: Pick<HostedEvent, "px" | "py">,
  x: number,
  y: number,
) => inArea(eventArea(config, e.px, e.py), x, y);

/** Whether an event is in the Commons. */
export const inCommons = (config: WorldConfig, e: Pick<HostedEvent, "px" | "py">) =>
  isCommons(config, e.px, e.py);

/** The events still on the calendar at plot (px, py), oldest first. */
export const eventsAt = (state: WorldState, px: number, py: number): HostedEvent[] =>
  (state.events?.list ?? []).filter((e) => eventOpen(e) && e.px === px && e.py === py);

const STATUS_WORDS: Record<EventStatus, string> = {
  scheduled: "hasn't started",
  live: "has already started",
  ended: "has ended",
  cancelled: "was called off",
};

/** The event by id, or why not. */
function known(state: WorldState, id: unknown): HostedEvent | Rejection {
  const e = findEvent(state, id);
  return e ?? refuse("unknown_event", "No event has that id. See GET /v1/events.");
}

/** The open clash at a place: an event on then, or within `gapMinutes` either side. */
function clashAt(
  state: WorldState,
  px: number,
  py: number,
  startsAt: number,
  minutes: number,
): HostedEvent | undefined {
  const gap = EVENTS.gapMinutes * MINUTE_MS;
  const ends = startsAt + minutes * MINUTE_MS;
  return eventsAt(state, px, py).find(
    (e) => startsAt < eventEndsAt(e) + gap && e.startsAt < ends + gap,
  );
}

/**
 * The parts every schedule checks, from either a resident or the town: kind, words, length, and a
 * start on a whole minute from today up to `aheadDays` ahead. The cleaned words and the start's
 * day, or why not.
 */
function eventFields(
  state: WorldState,
  command: { kind: unknown; title: unknown; text?: unknown; startsAt: unknown; minutes: unknown },
  minutesMax: number,
): { title: string; text: string; day: number } | Rejection {
  const today = state.day;
  if (today === undefined) return refuse("not_due", "Events open once the world counts days.");
  if (!(EVENT_KINDS as readonly unknown[]).includes(command.kind)) {
    return refuse("invalid_event", "An event is a show, class, market, listening, or gathering.");
  }
  const title = typeof command.title === "string" ? command.title.trim() : "";
  const text = typeof command.text === "string" ? command.text.trim() : "";
  if (title.length < 1 || title.length > EVENTS.titleMax) {
    return refuse("invalid_event", `A title is 1 to ${EVENTS.titleMax} characters.`);
  }
  if (command.text !== undefined && typeof command.text !== "string") {
    return refuse("invalid_event", "The text is words.");
  }
  if (text.length > EVENTS.textMax) {
    return refuse("invalid_event", `The text is at most ${EVENTS.textMax} characters.`);
  }
  const { minutes, startsAt } = command;
  if (!isWhole(minutes) || minutes < EVENTS.minutesMin || minutes > minutesMax) {
    return refuse("invalid_event", `An event lasts ${EVENTS.minutesMin} to ${minutesMax} minutes.`);
  }
  if (!isWhole(startsAt) || startsAt < 0 || startsAt % MINUTE_MS !== 0) {
    return refuse("invalid_event", "Start on a whole minute, like 2026-10-11T19:00:00Z.");
  }
  const day = eventDayOf(startsAt);
  if (day < today || day > today + EVENTS.aheadDays) {
    return refuse(
      "invalid_event",
      `An event starts today, or up to ${EVENTS.aheadDays} days ahead (UTC days).`,
    );
  }
  return { title, text, day };
}

function ensureEvents(state: WorldState): EventsState {
  state.events ??= { nextId: 1, list: [] };
  return state.events;
}

/** The event `event_scheduled` describes, without its words. */
function scheduled(e: HostedEvent): WorldEvent {
  return {
    type: "event_scheduled",
    event: e.id,
    host: e.host,
    kind: e.kind,
    px: e.px,
    py: e.py,
    startsAt: e.startsAt,
    minutes: e.minutes,
    ...(isTownEvent(e) ? { town: true as const } : {}),
  };
}

/**
 * Settle a Commons deposit: back to the host's purse, or burned. The coin event (private to the
 * host) when it went back, and the word for the public event. Nothing when there's no deposit.
 */
function settleDeposit(
  state: WorldState,
  e: HostedEvent,
  back: boolean,
  seq: number,
): { coins: WorldEvent[]; deposit?: "refunded" | "burned" } {
  const econ = state.economy;
  const held = e.deposit ?? 0;
  if (held <= 0 || !econ) return { coins: [] };
  if (!back) {
    econ.burned += held;
    return { coins: [], deposit: "burned" };
  }
  const at = { seq, day: state.day ?? 0 };
  return { coins: [movePurse(econ, e.host, held, "event_refund", at)], deposit: "refunded" };
}

/** Call an event off, settling its deposit, and say so. For the commit only. */
function callOff(state: WorldState, e: HostedEvent, refund: boolean): WorldEvent[] {
  const settled = settleDeposit(state, e, refund, state.seq + 1);
  e.status = "cancelled";
  e.closedDay = state.day ?? 0;
  delete e.seen;
  return [
    {
      type: "event_cancelled",
      event: e.id,
      ...(settled.deposit ? { deposit: settled.deposit } : {}),
    },
    ...settled.coins,
  ];
}

/**
 * What `release` or `unshare_plot` does to the events on a plot leaving someone's hands: every
 * event on the calendar there (only `host`'s, when given) is called off. Worked out before anything
 * changes; null when there's nothing to call off.
 */
export function eventsLeavingPlot(
  state: WorldState,
  px: number,
  py: number,
  host?: ResidentId,
): Mutation | null {
  const going = eventsAt(state, px, py).filter((e) => host === undefined || e.host === host);
  if (going.length === 0) return null;
  return () => going.flatMap((e) => callOff(state, e, true));
}

/**
 * What `new_day` does to events: ended and cancelled ones whose day is more than `keepDays` before
 * the new day leave the world. Null when none do. No event: clients only draw events on the
 * calendar, and they dropped these when they finished.
 */
export function eventsNewDay(state: WorldState, day: number): Mutation | null {
  const events = state.events;
  if (!events) return null;
  const stale = (e: HostedEvent) => !eventOpen(e) && e.day < day - EVENTS.keepDays;
  if (!events.list.some(stale)) return null;
  return () => {
    events.list = events.list.filter((e) => !stale(e));
    return [];
  };
}

// ---------- residents ----------

/**
 * Why `id` can't host an event right now, or null: the Town Hall's eligibility (a plot at least 3
 * days old, a hearth, active in the last 7 days, not townsfolk) and a host's limits. Read-only, for
 * views; `schedule_event` checks the same and more.
 */
export function hostingProblem(state: WorldState, id: ResidentId): string | null {
  if (!residentById(state, id)) return "Join the world first.";
  const ok = townEligibility(state, id);
  if (!ok.eligible) return ok.message;
  const open = (state.events?.list ?? []).filter((e) => e.host === id && eventOpen(e)).length;
  if (open >= EVENTS.scheduledMax) {
    return `You have ${EVENTS.scheduledMax} events on the calendar. Let one happen, or call one off.`;
  }
  return null;
}

/**
 * `schedule_event {kind, title, text?, px, py, startsAt, minutes}`: a resident who could take part
 * in the Town Hall puts on an event at their own or shared plot, or in the Commons, whose booking
 * holds a deposit until it ends.
 */
export function checkScheduleEvent(
  state: WorldState,
  actor: ResidentId,
  command: Extract<Command, { type: "schedule_event" }>,
): EventsChecked {
  const ok = townEligibility(state, actor);
  if (!ok.eligible) {
    return refuse(
      "not_eligible",
      `To host, you need what voting in the Town Hall needs. ${ok.message}`,
    );
  }
  const fields = eventFields(state, command, EVENTS.minutesMax);
  if ("code" in fields) return fields;
  const { px, py, startsAt, minutes } = command;
  const today = state.day ?? 0;
  if (!plotInBounds(state.config, px, py)) {
    return refuse("invalid_event", "That plot is outside the world.");
  }
  const commons = isCommons(state.config, px, py);
  if (!commons && !canBuildOn(state.plots[plotKey(px, py)], actor)) {
    return refuse("not_your_plot", "Host on your own plot, one shared with you, or the Commons.");
  }
  const mine = (state.events?.list ?? []).filter((e) => e.host === actor);
  if (mine.filter(eventOpen).length >= EVENTS.scheduledMax) {
    return refuse(
      "event_limit",
      `You can have ${EVENTS.scheduledMax} events on the calendar at once. Let one happen, or call one off with cancel_event.`,
    );
  }
  if (
    commons &&
    mine.some(
      (e) =>
        e.status !== "cancelled" &&
        inCommons(state.config, e) &&
        Math.abs(e.day - fields.day) < EVENTS.commonsEveryDays,
    )
  ) {
    return refuse(
      "event_limit",
      `One Commons event per host in any ${EVENTS.commonsEveryDays} days. Your own plot is free any time.`,
    );
  }
  const taken = clashAt(state, px, py, startsAt, minutes);
  if (taken) {
    return refuse(
      "event_clash",
      `${taken.id} is on there then. Leave ${EVENTS.gapMinutes} minutes between events: see GET /v1/events?px=${px}&py=${py}.`,
    );
  }
  const econ = state.economy;
  if (commons) {
    if (!econ) {
      return refuse(
        "economy_closed",
        `The Commons holds a ${EVENTS.deposit}-coin deposit, and coins aren't open yet.`,
      );
    }
    const have = econ.coins[actor] ?? 0;
    if (have < EVENTS.deposit) {
      return refuse(
        "not_enough_coins",
        `Booking the Commons holds a ${EVENTS.deposit}-coin deposit, back when ${EVENTS.refundAt} or more come. You have ${coins(have)}. Your own plot is free.`,
      );
    }
  }
  const at = { seq: state.seq + 1, day: today };
  return () => {
    const events = ensureEvents(state);
    const e: HostedEvent = {
      id: `e_${events.nextId}`,
      host: actor,
      kind: command.kind,
      title: fields.title,
      text: fields.text,
      px,
      py,
      day: fields.day,
      startsAt,
      minutes,
      status: "scheduled",
      scheduledDay: today,
      ticks: 0,
      seen: {},
      ...(commons ? { deposit: EVENTS.deposit } : {}),
    };
    events.nextId += 1;
    events.list.push(e);
    const out: WorldEvent[] = [scheduled(e)];
    if (commons && econ) {
      out.push(movePurse(econ, actor, -EVENTS.deposit, "event_deposit", at));
    }
    return out;
  };
}

/**
 * `cancel_event {event}`: its host calls off an event that hasn't started. A Commons deposit goes
 * back when it's called off before the event's day, and is burned on the day itself.
 */
export function checkCancelEvent(
  state: WorldState,
  actor: ResidentId,
  command: Extract<Command, { type: "cancel_event" }>,
): EventsChecked {
  const e = known(state, command.event);
  if ("code" in e) return e;
  if (e.host !== actor) return refuse("not_your_event", "Only its host can call an event off.");
  if (e.status !== "scheduled") {
    return refuse("event_closed", `${e.id} ${STATUS_WORDS[e.status]}.`);
  }
  const refund = (state.day ?? 0) < e.day;
  return () => callOff(state, e, refund);
}

/** Tiles nobody may land on: hearths, and where another online resident stands on the ground. */
function takenTiles(state: WorldState, actor: ResidentId): Set<string> {
  const taken = new Set<string>();
  for (const r of Object.values(state.residents)) {
    if (r.online && r.id !== actor && standingFloor(r) === 0) taken.add(tileKey(r.x, r.y));
    if (r.hearth) taken.add(tileKey(r.hearth.x, r.hearth.y));
  }
  return taken;
}

/**
 * Where `join_event` put a resident before inputs carried their tile, and still does when one
 * comes without it: the free tile nearest the plot's middle, inside the area, by distance, then
 * north to south, then west to east. Free means nothing stands there (a block, the Town Hall, the
 * shop), no other online resident does, and it isn't a hearth. On a plot with a starter hut, that's
 * inside the hut, by the hearth.
 */
function landingFor(state: WorldState, e: HostedEvent, actor: ResidentId): Tile | undefined {
  const area = eventArea(state.config, e.px, e.py);
  const middle = plotCenter(state.config, e.px, e.py);
  const ground = worldGround(state);
  const taken = takenTiles(state, actor);
  const tiles: Tile[] = [];
  for (let y = area.y0; y <= area.y1; y++) {
    for (let x = area.x0; x <= area.x1; x++) tiles.push({ x, y });
  }
  tiles.sort((a, b) => chebyshev(a, middle) - chebyshev(b, middle) || a.y - b.y || a.x - b.x);
  return tiles.find((t) => !ground.obstacle(t.x, t.y) && !taken.has(tileKey(t.x, t.y)));
}

/**
 * Where the server lands a guest at `e`, to log with their `join_event`: on a plot someone lives
 * on, where `visit` lands a visitor (`visitTile`: the plot's edge, by a path or in front of the
 * door), never inside the host's hut; in the Commons, which has no door, the free tile nearest the
 * middle of the square. Replay never runs it: the sim checks the logged tile.
 */
export function joinTile(state: WorldState, actor: ResidentId, e: HostedEvent): Tile | undefined {
  const onPlot = state.plots[plotKey(e.px, e.py)] ? visitTile(state, actor, e.px, e.py) : undefined;
  return onPlot ?? landingFor(state, e, actor);
}

/**
 * `join_event {event, x?, y?}`: while it's live, go there in one step, onto a free tile in its area:
 * the logged one (`joinTile`'s), or in older logs the one `landingFor` picks. A resident already
 * there is refused (`already_joined`), unless this input brings them back online (`rejoining`):
 * then they stay where they stand.
 */
export function checkJoinEvent(
  state: WorldState,
  actor: ResidentId,
  command: Extract<Command, { type: "join_event" }>,
  rejoining: boolean,
): EventsChecked {
  const e = known(state, command.event);
  if ("code" in e) return e;
  if (e.status !== "live") {
    return refuse(
      "event_not_live",
      `${e.id} isn't on right now: it ${STATUS_WORDS[e.status]}. GET /v1/events/${e.id} says when it is.`,
    );
  }
  const me = residentById(state, actor);
  if (!me) return refuse("not_joined", "Join the world first.");
  if (inEventArea(state.config, e, me.x, me.y)) {
    if (rejoining) return () => [];
    return refuse(
      "already_joined",
      `You're already at ${e.id}. Stay online to be counted: keep your socket open, or call again every few minutes.`,
    );
  }
  const { x, y } = command;
  let to: Tile | undefined;
  if (x === undefined && y === undefined) {
    to = landingFor(state, e, actor);
  } else {
    if (!isWhole(x) || !isWhole(y) || !inEventArea(state.config, e, x, y)) {
      return refuse("out_of_bounds", `That tile isn't at ${e.id}.`);
    }
    if (worldGround(state).obstacle(x, y)) return refuse("blocked", "Something is in the way.");
    if (takenTiles(state, actor).has(tileKey(x, y))) {
      return refuse("tile_occupied", "Someone is standing there, or it's someone's hearth.");
    }
    to = { x, y };
  }
  if (!to) return refuse("nowhere_to_go", `There's no free spot at ${e.id} right now.`);
  // A jump, so it lands on the ground floor (RFC 0028).
  return () => {
    me.x = to.x;
    me.y = to.y;
    setFloor(me, 0);
    return [{ type: "moved", residentId: actor, x: to.x, y: to.y }];
  };
}

// ---------- the server's inputs ----------

/**
 * `schedule_town_event {key, kind, title, text?, startsAt, minutes, faces?}`, which only TOWN_ACTOR
 * sends: the town puts on an event in the Commons from its own calendar. No deposit, no host
 * limits, up to `townMinutesMax`, and once per `key`. `faces` names townsfolk as its face.
 */
export function checkScheduleTownEvent(
  state: WorldState,
  command: Extract<Command, { type: "schedule_town_event" }>,
): EventsChecked {
  const { key, startsAt, minutes } = command;
  if (typeof key !== "string" || !KEY_PATTERN.test(key)) {
    return refuse("invalid_event", "A town event's key is lowercase letters, digits, and dashes.");
  }
  if (state.events?.list.some((e) => e.key === key)) {
    return refuse("already_set", `The town event ${key} is already on the calendar.`);
  }
  const fields = eventFields(state, command, EVENTS.townMinutesMax);
  if ("code" in fields) return fields;
  const faces = command.faces ?? [];
  if (!Array.isArray(faces) || faces.length > EVENTS.facesMax) {
    return refuse("invalid_event", `A town event names up to ${EVENTS.facesMax} townsfolk.`);
  }
  if (new Set(faces).size !== faces.length) {
    return refuse("invalid_event", "Name each of the townsfolk once.");
  }
  for (const id of faces) {
    if (!residentById(state, id) || !isTownsfolk(state, id)) {
      return refuse("invalid_event", "A town event's faces are townsfolk.");
    }
  }
  const { px, py } = commonsPlot(state.config);
  const taken = clashAt(state, px, py, startsAt, minutes);
  if (taken) {
    return refuse(
      "event_clash",
      `${taken.id} is on in the Commons then. Leave ${EVENTS.gapMinutes} minutes between events.`,
    );
  }
  const today = state.day ?? 0;
  const sorted = [...faces].sort();
  return () => {
    const events = ensureEvents(state);
    const e: HostedEvent = {
      id: `e_${events.nextId}`,
      host: TOWN_ACTOR,
      kind: command.kind,
      title: fields.title,
      text: fields.text,
      px,
      py,
      day: fields.day,
      startsAt,
      minutes,
      status: "scheduled",
      scheduledDay: today,
      ticks: 0,
      seen: {},
      key,
      ...(sorted.length > 0 ? { faces: sorted } : {}),
    };
    events.nextId += 1;
    events.list.push(e);
    return [scheduled(e)];
  };
}

/** `event_start {event}`, from TOWN_ACTOR: a scheduled event's time came. Never before its day. */
export function checkEventStart(
  state: WorldState,
  command: Extract<Command, { type: "event_start" }>,
): EventsChecked {
  const e = known(state, command.event);
  if ("code" in e) return e;
  if (e.status !== "scheduled") return refuse("event_closed", `${e.id} ${STATUS_WORDS[e.status]}.`);
  if ((state.day ?? 0) < e.day) return refuse("not_due", `${e.id} starts on day ${e.day}.`);
  return () => {
    e.status = "live";
    return [{ type: "event_started", event: e.id }];
  };
}

/** Who counts at a sample: online residents in the area, never the host or townsfolk. Sorted. */
function presentAt(state: WorldState, e: HostedEvent): ResidentId[] {
  const area = eventArea(state.config, e.px, e.py);
  return Object.values(state.residents)
    .filter(
      (r) => r.online && r.id !== e.host && !isTownsfolk(state, r.id) && inArea(area, r.x, r.y),
    )
    .map((r) => r.id)
    .sort();
}

/**
 * `event_tick {event, slot}`, from TOWN_ACTOR: an attendance sample at the `slot`th 5-minute mark of
 * a live event. Each mark is sampled at most once, in order, and only marks before the end exist;
 * the server skips the ones it missed.
 */
export function checkEventTick(
  state: WorldState,
  command: Extract<Command, { type: "event_tick" }>,
): EventsChecked {
  const e = known(state, command.event);
  if ("code" in e) return e;
  if (e.status !== "live") {
    return refuse("event_not_live", `${e.id} isn't on: it ${STATUS_WORDS[e.status]}.`);
  }
  const { slot } = command;
  if (!isWhole(slot) || slot <= (e.slot ?? 0)) {
    return refuse("not_due", `${e.id} has already been sampled there.`);
  }
  if (slot > lastSlot(e.minutes)) return refuse("not_due", `${e.id} has no mark that late.`);
  const present = presentAt(state, e);
  return () => {
    const seen = e.seen ?? {};
    for (const id of present) seen[id] = (own(seen, id) ?? 0) + 1;
    e.seen = seen;
    e.ticks += 1;
    e.slot = slot;
    return [{ type: "event_ticked", event: e.id, ticks: e.ticks, present }];
  };
}

/** Who attended: seen at `attendNeeded` samples, never the host or townsfolk. Sorted. */
export function attendedOf(state: WorldState, e: HostedEvent): ResidentId[] {
  const need = attendNeeded(e.ticks);
  return Object.entries(e.seen ?? {})
    .filter(([id, n]) => n >= need && id !== e.host && !isTownsfolk(state, id))
    .map(([id]) => id)
    .sort();
}

/**
 * `event_end {event}`, from TOWN_ACTOR: a live event's time is up. Its attendance is settled, and a
 * Commons deposit goes back when `refundAt` attendees came from outside the host's household
 * (`sameHousehold`: their person or AIs, and their person's other AIs), and is burned otherwise.
 */
export function checkEventEnd(
  state: WorldState,
  command: Extract<Command, { type: "event_end" }>,
): EventsChecked {
  const e = known(state, command.event);
  if ("code" in e) return e;
  if (e.status !== "live") {
    return refuse("event_not_live", `${e.id} isn't on: it ${STATUS_WORDS[e.status]}.`);
  }
  const attended = attendedOf(state, e);
  const guests = attended.filter((id) => !sameHousehold(state, e.host, id)).length;
  const refund = guests >= EVENTS.refundAt;
  return () => {
    const settled = settleDeposit(state, e, refund, state.seq + 1);
    e.status = "ended";
    e.closedDay = state.day ?? 0;
    e.attended = attended;
    delete e.seen;
    return [
      {
        type: "event_ended",
        event: e.id,
        attended: [...attended],
        ...(settled.deposit ? { deposit: settled.deposit } : {}),
      },
      ...settled.coins,
    ];
  };
}

/**
 * `void_event {event, by, resident?}`, from TOWN_ACTOR for a maintainer: an event that hasn't
 * ended is called off, and a Commons deposit goes back. `by` is who the log names. A `resident`
 * (the maintainer's own, when the server knows it) in the host's household is refused, so nobody
 * calls off their own event to keep a deposit the end would burn.
 */
export function checkVoidEvent(
  state: WorldState,
  command: Extract<Command, { type: "void_event" }>,
): EventsChecked {
  const e = known(state, command.event);
  if ("code" in e) return e;
  if (!eventOpen(e)) return refuse("event_closed", `${e.id} ${STATUS_WORDS[e.status]}.`);
  const { by, resident } = command;
  if (typeof by !== "string" || by === "") {
    return refuse("server_only", "Say which maintainer called it off.");
  }
  if (resident !== undefined) {
    if (typeof resident !== "string" || resident === "") {
      return refuse("server_only", "A maintainer's resident is a resident id.");
    }
    if (sameHousehold(state, resident, e.host)) {
      return refuse(
        "not_eligible",
        "A maintainer can't call off an event they, or their own AI or person, are hosting.",
      );
    }
  }
  return () => {
    e.voidedBy = by;
    return callOff(state, e, true);
  };
}

// ---------- reading ----------

/** What a resident can send about one event. */
export const EVENT_MOVES = ["join_event", "cancel_event"] as const;
export type EventMove = (typeof EVENT_MOVES)[number];

/** The moves `id` could make on an event now: join it while it's live, call off their own. */
export function eventMoves(state: WorldState, id: ResidentId, e: HostedEvent): EventMove[] {
  const me = residentById(state, id);
  if (!me) return [];
  const moves: EventMove[] = [];
  if (e.status === "live" && !(me.online && inEventArea(state.config, e, me.x, me.y))) {
    moves.push("join_event");
  }
  if (e.status === "scheduled" && e.host === id) moves.push("cancel_event");
  return moves;
}
