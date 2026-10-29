import {
  type ErrorCode,
  levelName,
  type PhotoMoment,
  type PhotoMomentKind,
  type PhotoScene,
  PORTRAIT_SUBJECTS,
  SCENE_PHOTO_LIMITS,
  type ScenePhotoRequest,
} from "@terrakin/protocol";
import {
  CATALOG,
  type Crop,
  DAY_LENGTH_MS,
  DAY_MS,
  dayPhase,
  eventArea,
  findEvent,
  type Input,
  type ItemKind,
  inArea,
  isCommons,
  isTownsfolk,
  MINUTE_MS,
  own,
  plotKey,
  plotOf,
  potName,
  residentById,
  skyAt,
  TOWN_ACTOR,
  utcDay,
  WEAR_INFO,
  type WorldEvent,
  type WorldState,
} from "@terrakin/sim";
import { stampOf } from "./plot-photo";
import { shownPlotName } from "./plots";
import type { SqlExec } from "./sql-store";

/**
 * Scene photos (RFC 0049): which scene a request asks for, checked against the world, and the
 * counts that hold the bill down. Nothing here draws or opens a browser: `Api.takeScenePhoto` runs
 * these checks first, then reserves a render, then asks the renderer.
 */

/** What the subject checks need from the social layer. */
export interface SceneDeps {
  now: number;
  /** Either has blocked the other. */
  blockedEither: (a: string, b: string) => boolean;
  /** They follow each other. */
  friends: (a: string, b: string) => boolean;
  /** Suspended residents are left out of every photo. */
  suspended: (id: string) => boolean;
  /** Staff removed this resident's pictures: their plot answers as unclaimed. */
  picturesRemoved: (id: string) => boolean;
  /** Staff hold back this resident's words: a plot name they gave stays out. */
  held: (id: string) => boolean;
  /** The caller's own unused moment, from the last hour. */
  moment: (id: string) => StoredMoment | undefined;
}

export type SceneResult =
  | { ok: true; scene: PhotoScene; place?: { px: number; py: number }; moment?: string }
  | { ok: false; code: ErrorCode; message: string };

const refuse = (code: ErrorCode, message: string): SceneResult => ({ ok: false, code, message });

/** How many residents nearest the subject keep their tags first, beside the subject. */
const FIRST_NEAREST = SCENE_PHOTO_LIMITS.maxTags;

/**
 * The scene `request` asks `viewer` for, from the world now, or the refusal. The checks are the
 * RFC's: a plot must be claimed and not the Commons, an event must be one you host or joined while
 * it runs or in the hour after, a friend must follow you back and be out and about, and a moment
 * must be yours and unused. Everyone away, suspended, or blocked either way is left out.
 */
export function sceneFor(
  state: WorldState,
  viewer: string,
  request: ScenePhotoRequest,
  deps: SceneDeps,
): SceneResult {
  const me = residentById(state, viewer);
  if (!me) return refuse("unauthorized", "Unknown resident.");
  // An event's guests stand all round the host's plot, so its photo is wide unless asked.
  const framing = request.framing ?? (request.subject === "event" ? "wide" : "near");
  if (framing === "portrait" && !(PORTRAIT_SUBJECTS as readonly string[]).includes(request.subject))
    return refuse(
      "bad_request",
      'A portrait is of one resident: use it with `"subject": "me"` or `"friend"`. Leave out framing for `near`, or send `wide`.',
    );
  const S = state.config.plotSize;
  const plotCenter = (px: number, py: number) => ({
    x: px * S + (S - 1) / 2,
    y: py * S + (S - 1) / 2,
  });
  const placeAt = (x: number, y: number) => {
    const { px, py } = plotOf(state.config, x, y);
    return isCommons(state, px, py) || !own(state.plots, plotKey(px, py)) ? undefined : { px, py };
  };

  let focus: PhotoScene["focus"];
  let place: { px: number; py: number } | undefined;
  let subjectId: string | undefined;
  let lead: string[] = [];
  let holding: string | undefined;
  let momentId: string | undefined;
  let momentLine: string | undefined;
  let finalFraming = framing;

  switch (request.subject) {
    case "me": {
      focus = { x: me.x, y: me.y, id: me.id };
      subjectId = me.id;
      place = placeAt(me.x, me.y);
      break;
    }
    case "plot": {
      const { px, py } = request;
      if (px >= state.config.width / S || py >= state.config.height / S)
        return refuse("plot_unclaimed", `There's no plot at ${px}, ${py}.`);
      if (isCommons(state, px, py))
        return refuse(
          "plot_is_commons",
          `Plot ${px}, ${py} is the Commons. Photograph a claimed plot, or yourself there with \`"subject": "me"\`.`,
        );
      const plot = own(state.plots, plotKey(px, py));
      if (!plot || deps.picturesRemoved(plot.ownerId))
        return refuse("plot_unclaimed", `Nobody has claimed plot ${px}, ${py}.`);
      focus = plotCenter(px, py);
      place = { px, py };
      break;
    }
    case "event": {
      const e = findEvent(state, request.event);
      if (!e || e.status === "cancelled" || e.status === "scheduled")
        return refuse(
          "not_at_event",
          "That event isn't running, so there's nothing to photograph. Take one while it's live or in the hour after it ends.",
        );
      const endedAt = e.startsAt + e.minutes * MINUTE_MS;
      if (e.status === "ended" && deps.now > endedAt + SCENE_PHOTO_LIMITS.afterEventMs)
        return refuse("not_at_event", "That event ended over an hour ago.");
      const area = eventArea(state.config, e.px, e.py);
      const there =
        e.host === viewer ||
        (e.seen !== undefined && (own(e.seen, viewer) ?? 0) > 0) ||
        (e.attended ?? []).includes(viewer) ||
        (e.status === "live" && me.online && inArea(area, me.x, me.y));
      if (!there)
        return refuse(
          "not_at_event",
          "Only its host and the residents who joined it can photograph an event. Join it first with join_event.",
        );
      if (e.host !== TOWN_ACTOR && e.host !== viewer && deps.blockedEither(viewer, e.host))
        return refuse("not_at_event", "That event isn't one you can photograph.");
      focus = plotCenter(e.px, e.py);
      place = isCommons(state, e.px, e.py) ? undefined : { px: e.px, py: e.py };
      if (e.host !== TOWN_ACTOR) lead = [e.host];
      break;
    }
    case "friend": {
      const them = residentById(state, request.id);
      if (
        !them ||
        them.id === viewer ||
        !deps.friends(viewer, them.id) ||
        deps.blockedEither(viewer, them.id) ||
        deps.suspended(them.id)
      )
        return refuse(
          "not_friends",
          'You can photograph a friend: someone you follow who follows you back. Use `"subject": "me"` for yourself.',
        );
      if (!them.online)
        return refuse(
          "away",
          "They're away right now, asleep at home or out on a routine, and a photo only shows someone who's there. Try when they're back.",
        );
      focus = { x: them.x, y: them.y, id: them.id };
      subjectId = them.id;
      place = placeAt(them.x, them.y);
      break;
    }
    case "moment": {
      const m = deps.moment(request.moment);
      if (!m)
        return refuse(
          "not_found",
          "No moment of yours by that id from the last hour. `GET /v1/photos/moments` lists them.",
        );
      if (m.used)
        return refuse(
          "already_taken",
          "You already took a photo of that moment. Each is taken once.",
        );
      focus = { x: m.x, y: m.y, id: me.id };
      subjectId = me.id;
      place = placeAt(m.x, m.y);
      momentId = m.id;
      momentLine = momentWords(m.kind, m.thing);
      if (m.item) holding = m.item;
      // A new look is shown whole: a costume reveal shows the costume.
      if (m.kind === "new_look") finalFraming = "portrait";
      break;
    }
  }

  // Who may be in it: online, not suspended, not blocked either way, and the subject whatever.
  const shownIds: { id: string; d: number }[] = [];
  for (const r of Object.values(state.residents)) {
    const isSubject = r.id === subjectId || r.id === viewer;
    if (!isSubject && !r.online) continue;
    if (r.id !== viewer && (deps.suspended(r.id) || deps.blockedEither(viewer, r.id))) continue;
    shownIds.push({ id: r.id, d: Math.hypot(r.x - focus.x, r.y - focus.y) });
  }
  shownIds.sort((a, b) => a.d - b.d || (a.id < b.id ? -1 : 1));
  const shown = shownIds.map((s) => s.id);
  const first = [
    ...new Set([
      ...(subjectId ? [subjectId] : []),
      ...lead.filter((id) => shown.includes(id)),
      ...shown.slice(0, FIRST_NEAREST),
    ]),
  ];

  const plot = place ? own(state.plots, plotKey(place.px, place.py)) : undefined;
  const title = plot ? shownPlotName(plot, deps.held) : undefined;
  const stamp = [
    ...(momentLine ? [momentLine] : []),
    place ? `Plot ${place.px}, ${place.py}` : "The Commons",
    ...stampOf(state, dayPhase(deps.now, DAY_LENGTH_MS), skyAt(deps.now, state.day).weather),
  ].join(" · ");

  return {
    ok: true,
    scene: {
      framing: finalFraming,
      names: request.names === true,
      focus,
      ...(place ? { plot: place } : {}),
      shown,
      first,
      nowMs: deps.now,
      dayLengthMs: DAY_LENGTH_MS,
      stamp,
      ...(title === undefined ? {} : { title }),
      ...(holding ? { holding } : {}),
    },
    ...(place ? { place } : {}),
    ...(momentId ? { moment: momentId } : {}),
  };
}

/** A moment as the stamp says it: our own words and a catalog name, never a resident's. */
export function momentWords(kind: PhotoMomentKind, thing: string | undefined): string {
  const it = thing ?? "";
  switch (kind) {
    case "made":
      return thing ? `Made ${article(it)}` : "Made something";
    case "fired":
      return thing ? `Fresh from the kiln: ${article(it)}` : "Fresh from the kiln";
    case "sold":
      return thing ? `Sold ${article(it)} at the market` : "A sale at the market";
    case "new_look":
      return thing ? `New look: ${it}` : "A new look";
    case "level":
      return thing ? `Reached ${it}` : "A new level";
    case "hosted":
      return "Hosted an event";
    case "harvest":
      return thing ? `First ${it} harvest` : "A first harvest";
  }
}

/** A moment before it's kept: whose, what, and where it happened. */
export type MomentDraft = Omit<StoredMoment, "id" | "at" | "used">;

/** Look changes that make a new look: what you wear, your hair, your colors and prints. */
const LOOK_FIELDS = [
  "wear",
  "wearStyle",
  "hair",
  "hairColor",
  "theme",
  "pattern",
  "patternMedia",
  "color",
  "shape",
] as const;

const kindName = (kind: string) => CATALOG[kind as ItemKind]?.name.toLowerCase() ?? kind;

/**
 * The moments one committed input made (RFC 0049), from its events alone: something made at a
 * workbench or kitchen, a pot out of a kiln, a sale at the market, a new look, a level, an event
 * hosted to its end, and a first harvest of a kind (`firstHarvest` asks the collection book,
 * before it counts this input). Every word is a catalog name or our own, never a resident's.
 * Townsfolk have none.
 */
export function momentsOf(
  state: WorldState,
  input: Input,
  events: readonly WorldEvent[],
  firstHarvest: (resident: string, crop: Crop) => boolean,
): MomentDraft[] {
  const out: MomentDraft[] = [];
  const at = (id: string) => residentById(state, id);
  const add = (
    resident: string,
    m: Omit<MomentDraft, "resident" | "x" | "y">,
    x?: number,
    y?: number,
  ) => {
    const r = at(resident);
    if (!r || isTownsfolk(state, resident)) return;
    out.push({ resident, ...m, x: x ?? r.x, y: y ?? r.y });
  };
  for (const e of events) {
    if (e.type === "inventory" && e.reason === "craft" && e.gained?.[0]) {
      const good = e.gained[0];
      add(e.residentId, { kind: "made", thing: kindName(good.kind), item: good.kind });
    } else if (e.type === "kiln_emptied") {
      add(e.by, { kind: "fired", thing: potName(e.pot, true), item: e.pot.kind }, e.x, e.y);
    } else if (e.type === "listing_sold") {
      add(e.seller, { kind: "sold", thing: kindName(e.kind), item: e.kind });
    } else if (e.type === "wear_bought") {
      add(e.residentId, {
        kind: "new_look",
        thing: WEAR_INFO[e.wear]?.label.toLowerCase() ?? e.wear,
      });
    } else if (e.type === "profile_changed" && input.command.type === "profile") {
      const command: Partial<Record<string, unknown>> = { ...input.command };
      if (LOOK_FIELDS.some((f) => command[f] !== undefined))
        add(e.residentId, { kind: "new_look" });
    } else if (e.type === "level_reached") {
      add(e.residentId, {
        kind: "level",
        thing: levelName({ skill: e.skill, level: e.level }),
      });
    } else if (e.type === "event_ended") {
      const ev = findEvent(state, e.event);
      if (!ev || ev.host === TOWN_ACTOR) continue;
      const S = state.config.plotSize;
      add(
        ev.host,
        { kind: "hosted" },
        ev.px * S + Math.floor(S / 2),
        ev.py * S + Math.floor(S / 2),
      );
    } else if (e.type === "harvested" && firstHarvest(e.by, e.crop)) {
      add(e.by, { kind: "harvest", thing: kindName(e.crop), item: e.crop }, e.x, e.y);
    }
  }
  // One of each kind an input makes: a level-up names a skill and the overall level together,
  // and the photo of one is the photo of both.
  const seen = new Set<string>();
  return out.filter((m) => {
    const key = `${m.resident}:${m.kind}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

const article = (thing: string) => (/^[aeiou]/i.test(thing) ? `an ${thing}` : `a ${thing}`);

// ---------- counts and moments, in the social database ----------

/** A moment as kept: where it happened, and what to hold. */
export interface StoredMoment {
  id: string;
  resident: string;
  kind: PhotoMomentKind;
  thing?: string;
  /** The catalog kind to hold or stand beside. */
  item?: string;
  x: number;
  y: number;
  at: number;
  used: boolean;
}

/** The town's row in `scene_photo_days`: every render that day, whoever took it. */
const TOWN = "";
/** The row of renders that failed that day, given back to the town but counted here. */
const FAILED = "#failed";

/**
 * Scene photo counts by UTC day (the town's and each resident's) and each resident's moments from
 * the last hour. Kept in the social database, never the world log: they're the server's bookkeeping,
 * and a restart must not hand out a fresh day's renders.
 */
export class ScenePhotoBook {
  constructor(
    private readonly sql: SqlExec,
    private readonly now: () => number,
  ) {
    sql.exec(`CREATE TABLE IF NOT EXISTS scene_photo_days (
      day INTEGER NOT NULL,
      resident TEXT NOT NULL,
      count INTEGER NOT NULL,
      PRIMARY KEY (day, resident)
    )`);
    sql.exec(`CREATE TABLE IF NOT EXISTS photo_moments (
      id TEXT PRIMARY KEY,
      resident TEXT NOT NULL,
      kind TEXT NOT NULL,
      thing TEXT,
      item TEXT,
      x INTEGER NOT NULL,
      y INTEGER NOT NULL,
      at INTEGER NOT NULL,
      used INTEGER NOT NULL DEFAULT 0
    )`);
    sql.exec(
      "CREATE INDEX IF NOT EXISTS photo_moments_by_resident ON photo_moments (resident, at)",
    );
  }

  private count(day: number, resident: string): number {
    const row = [
      ...this.sql.exec(
        "SELECT count FROM scene_photo_days WHERE day = ? AND resident = ?",
        day,
        resident,
      ),
    ][0];
    return Number(row?.count ?? 0);
  }

  private add(day: number, resident: string, by: number) {
    this.sql.exec(
      `INSERT INTO scene_photo_days (day, resident, count) VALUES (?, ?, MAX(0, ?))
        ON CONFLICT (day, resident) DO UPDATE SET count = MAX(0, count + ?)`,
      day,
      resident,
      by,
      by,
    );
  }

  /** Renders the town has used today, reserved ones included. */
  townToday(): number {
    return this.count(utcDay(this.now()), TOWN);
  }

  /** Scene photos `resident` has taken today. */
  residentToday(resident: string): number {
    return this.count(utcDay(this.now()), resident);
  }

  /**
   * Take one of today's renders for the town, or false when they're spent. No await between the
   * read and the write, so two requests can't both take the last one.
   */
  reserve(): { ok: true; day: number } | { ok: false } {
    const day = utcDay(this.now());
    if (this.count(day, TOWN) >= SCENE_PHOTO_LIMITS.perDay) return { ok: false };
    this.add(day, TOWN, 1);
    // Old days go: only today's count is ever read.
    this.sql.exec("DELETE FROM scene_photo_days WHERE day < ?", day - 1);
    return { ok: true, day };
  }

  /** Give back a reserved render whose photo failed: it counts against nobody. */
  release(day: number) {
    this.add(day, TOWN, -1);
  }

  /**
   * Count a photo against the resident taking it, with the town's slot, so requests at once can't
   * each pass the resident's day. `untaken` gives it back when no photo came of it.
   */
  taken(resident: string, day: number) {
    this.add(day, resident, 1);
  }

  untaken(resident: string, day: number) {
    this.add(day, resident, -1);
  }

  /** A render failed: its slot went back, and it counts against the day's failures. */
  failed(day: number) {
    this.add(day, FAILED, 1);
  }

  failedToday(): number {
    return this.count(utcDay(this.now()), FAILED);
  }

  /** Seconds to the next UTC midnight, when the day's renders come back. */
  secondsToTomorrow(): number {
    const now = this.now();
    return Math.max(1, Math.ceil(((utcDay(now) + 1) * DAY_MS - now) / 1000));
  }

  /** Keep a moment for an hour, as of now. Moments older than that go as new ones come. */
  keepMoment(draft: MomentDraft) {
    const bytes = crypto.getRandomValues(new Uint8Array(8));
    const id = `mo_${[...bytes].map((b) => b.toString(16).padStart(2, "0")).join("")}`;
    const m = { ...draft, id, at: this.now() };
    this.sql.exec(
      "DELETE FROM photo_moments WHERE at < ?",
      this.now() - SCENE_PHOTO_LIMITS.momentMs,
    );
    this.sql.exec(
      "INSERT OR REPLACE INTO photo_moments (id, resident, kind, thing, item, x, y, at, used) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)",
      m.id,
      m.resident,
      m.kind,
      m.thing ?? "",
      m.item ?? "",
      m.x,
      m.y,
      m.at,
    );
  }

  /** `resident`'s moments from the last hour, newest first, used ones too. */
  private rowsFor(resident: string): StoredMoment[] {
    const since = this.now() - SCENE_PHOTO_LIMITS.momentMs;
    return [
      ...this.sql.exec(
        "SELECT * FROM photo_moments WHERE resident = ? AND at >= ? ORDER BY at DESC, id DESC LIMIT 50",
        resident,
        since,
      ),
    ].map((r) => ({
      id: String(r.id),
      resident: String(r.resident),
      kind: String(r.kind) as PhotoMomentKind,
      ...(r.thing ? { thing: String(r.thing) } : {}),
      ...(r.item ? { item: String(r.item) } : {}),
      x: Number(r.x),
      y: Number(r.y),
      at: Number(r.at),
      used: Number(r.used) === 1,
    }));
  }

  /** The moments still to photograph, as `GET /v1/photos/moments` lists them. */
  moments(resident: string): PhotoMoment[] {
    return this.rowsFor(resident)
      .filter((m) => !m.used)
      .map((m) => ({
        id: m.id,
        kind: m.kind,
        ...(m.thing === undefined ? {} : { thing: m.thing }),
        at: m.at,
      }));
  }

  /** One of `resident`'s moments from the last hour, used or not. */
  moment(resident: string, id: string): StoredMoment | undefined {
    return this.rowsFor(resident).find((m) => m.id === id);
  }

  /** A moment's photo is under way (`used`), or came to nothing and the moment is free again. */
  useMoment(id: string, used: boolean) {
    this.sql.exec("UPDATE photo_moments SET used = ? WHERE id = ?", used ? 1 : 0, id);
  }
}
