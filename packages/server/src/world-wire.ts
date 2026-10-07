import {
  fourWayFacing,
  PROTOCOL_VERSION,
  ROUTINE_LIMITS,
  type WorldEvent as WireEvent,
  type WorldSnapshot,
} from "@terrakin/protocol";
import {
  activeTables,
  commonsPlot,
  DAY_LENGTH_MS,
  type Direction,
  displaysOf,
  eventOpen,
  findsOnDisplay,
  findsOpen,
  holidayField,
  isTownEvent,
  type PickupKind,
  parseKey,
  pickupLeft,
  plotAtTile,
  plotPickupsOwned,
  type StepRoutine,
  shopTiles,
  skyAt,
  timeOfDayAt,
  townHallTiles,
  type WorldEvent,
  type WorldState,
} from "@terrakin/sim";
import { shownPlotName } from "./plots";

/**
 * What the world sends out: an input's events as the wire shows them, who may see each, and the
 * world snapshot. `WorldService` keeps the state these read; nothing here changes it.
 */

/**
 * What an input's sim events look like on the wire. Owner-pair and maintainer lists stay on the
 * server. A gift also shows as a public `gift` event, without the amount or note, unless
 * townsfolk are on either side: their purses reset to the budget each day, so the public
 * treasury lines would give the amount away.
 */
export function toWire(events: WorldEvent[], townsfolk: readonly string[] = []): WireEvent[] {
  const out: WireEvent[] = [];
  for (const e of events) {
    if (
      e.type === "owner_pairs_set" ||
      e.type === "owner_pair_added" ||
      e.type === "owner_pair_removed" ||
      e.type === "maintainers_set" ||
      e.type === "implicit_presence_on" ||
      e.type === "event_ticked"
    ) {
      continue;
    }
    if (e.type === "inventory") {
      // A gift's note and a made thing's label are another resident's words.
      const words = e.note !== undefined || e.gained?.some((g) => g.label !== undefined);
      out.push(words ? { ...e, trust: "untrusted" } : e);
      continue;
    }
    if (e.type === "displayed") {
      // A made thing's label, or a piece's title, is its maker's words.
      out.push(e.good.label !== undefined ? { ...e, trust: "untrusted" } : e);
      continue;
    }
    if (e.type === "bounty_posted") {
      // Like proposals, the words stay out of events: they're read from GET /v1/bounties.
      const { id, poster, proposal, grant, reward, postedDay, expiresDay } = e.bounty;
      out.push({
        type: "bounty_posted",
        bounty: {
          id,
          poster,
          ...(proposal ? { proposal } : {}),
          ...(grant ? { grant } : {}),
          reward,
          postedDay,
          expiresDay,
        },
      });
      continue;
    }
    if (e.type === "pet_adopted" || e.type === "pet_renamed") {
      // A pet's name is its owner's words.
      out.push({ ...e, trust: "untrusted" });
      continue;
    }
    if (e.type === "plot_named") {
      // A plot's name is the words of whoever named it (decision 0121). A clear carries none.
      out.push(e.name === null ? e : { ...e, trust: "untrusted" });
      continue;
    }
    if (e.type === "listed") {
      // A made thing's label is its maker's words.
      const words = e.listing.goods?.some((g) => g.label !== undefined);
      out.push(words ? { ...e, trust: "untrusted" } : e);
      continue;
    }
    out.push(e.type === "coins" && e.note ? { ...e, trust: "untrusted" } : e);
    if (
      e.type === "coins" &&
      e.reason === "gift_out" &&
      e.with &&
      !townsfolk.includes(e.residentId) &&
      !townsfolk.includes(e.with)
    ) {
      out.push({ type: "gift", from: e.residentId, to: e.with });
    }
  }
  return out;
}

/**
 * While staff hold a resident's words back (a quarantine, RFC 0006), their pet's name, and a plot
 * name they write (decision 0121), stay out of the events everyone gets too, as they do out of the
 * snapshot. A held-back plot name goes out as no name.
 */
export function holdBackNames(events: WireEvent[], hidden: (id: string) => boolean): WireEvent[] {
  return events.map((e) => {
    if ((e.type === "pet_adopted" || e.type === "pet_renamed") && hidden(e.residentId)) {
      return e.type === "pet_adopted" ? { ...e, pet: { ...e.pet, name: "" } } : { ...e, name: "" };
    }
    if (e.type === "joined" && e.resident.pet && hidden(e.resident.id)) {
      return { ...e, resident: { ...e.resident, pet: { ...e.resident.pet, name: "" } } };
    }
    if (e.type === "plot_named" && e.name !== null && hidden(e.by)) {
      const { trust: _words, ...rest } = e;
      return { ...rest, name: null };
    }
    return e;
  });
}

/**
 * Purse moves, inventory changes, wear bought at the shop, and routines turned on or off: each
 * belongs to one resident alone.
 */
export const isPrivate = (
  e: WireEvent,
): e is Extract<WireEvent, { type: "coins" | "inventory" | "wear_bought" | "routines_set" }> =>
  e.type === "coins" ||
  e.type === "inventory" ||
  e.type === "wear_bought" ||
  e.type === "routines_set";

/**
 * What everyone may see: no purse moves and no inventory changes. Never empty, so every client's
 * `seq` keeps counting.
 */
export function publicEvents(events: WireEvent[]): WireEvent[] {
  const shown = events.filter((e) => !isPrivate(e));
  return shown.length > 0 ? shown : [{ type: "quiet" }];
}

/** What one resident may see: everything public, plus their own purse and inventory changes. */
export function eventsFor(events: WireEvent[], viewer: string): WireEvent[] {
  return events.filter((e) => !isPrivate(e) || e.residentId === viewer);
}

/** What the snapshot draws from the server's memory besides the world: never logged. */
export interface SnapshotExtras {
  /** The clock the time of day, the weather, and the season are read from. */
  nowMs: number;
  /** `hashWorld` of the state, at its `seq`. */
  hash: string;
  /** Which way each resident last stepped, any of eight ways. */
  facing: ReadonlyMap<string, Direction>;
  /** The routine that took each away resident's last step, and when. */
  routineSteps: ReadonlyMap<string, { routine: StepRoutine; at: number }>;
  /** Notes held back from view (a quarantine, RFC 0006). */
  noteHidden: (residentId: string) => boolean;
}

/** The world as `GET /v1/world` and a socket's `welcome` show it. */
export function worldSnapshot(state: WorldState, extras: SnapshotExtras): WorldSnapshot {
  const { nowMs, hash, facing, routineSteps, noteHidden } = extras;
  // Made things on display, and finds on display (RFC 0021), each in their own list.
  const shown = displaysOf(state);
  const finds = findsOnDisplay(state);
  return {
    v: PROTOCOL_VERSION,
    seq: state.seq,
    hash,
    // The sim never sees a clock; this is presentation state, anchored by the server. So are the
    // weather and the season it reads off the same clock (decision 0073).
    time: { nowMs, dayLengthMs: DAY_LENGTH_MS },
    ...skyAt(nowMs, state.day),
    // The time of day on the same clock, which a cast logs (RFC 0023).
    timeOfDay: timeOfDayAt(nowMs, DAY_LENGTH_MS),
    ...holidayField(state.day),
    config: {
      width: state.config.width,
      height: state.config.height,
      plotSize: state.config.plotSize,
      maxPlotsPerResident: state.config.maxPlotsPerResident,
      reach: state.config.reach,
    },
    commons: commonsPlot(state.config),
    residents: Object.values(state.residents).map((r) => {
      const faced = facing.get(r.id);
      // Away and out on a routine for a few minutes after its last step (RFC 0009).
      const step = r.online ? undefined : routineSteps.get(r.id);
      const out = step && nowMs - step.at < ROUTINE_LIMITS.awakeMinutes * 60_000;
      const hidden = noteHidden(r.id);
      return {
        ...r,
        ...(hidden ? { note: "" } : {}),
        // A quarantined owner's pet keeps its name out of view too (RFC 0019).
        ...(hidden && r.pet ? { pet: { ...r.pet, name: "" } } : {}),
        // Kept any of eight ways, sent as one of the four `facing` has always been.
        ...(faced ? { facing: fourWayFacing(faced) } : {}),
        ...(out ? { routine: step.routine } : {}),
      };
    }),
    plots: Object.values(state.plots).map((p) => {
      const name = shownPlotName(p, noteHidden);
      return {
        px: p.px,
        py: p.py,
        ownerId: p.ownerId,
        ...(p.coOwners ? { coOwners: [...p.coOwners] } : {}),
        ...(p.claimedDay === undefined ? {} : { claimedDay: p.claimedDay }),
        ...(p.gallery ? { gallery: true as const } : {}),
        // Its residents' words (decision 0121).
        ...(name === undefined ? {} : { name, trust: "untrusted" as const }),
      };
    }),
    blocks: Object.entries(state.blocks).map(([key, block]) => {
      const [x, y] = parseKey(key);
      return { x, y, block };
    }),
    ...(state.ground && Object.keys(state.ground).length > 0
      ? {
          ground: Object.entries(state.ground).map(([key, ground]) => {
            const [x, y] = parseKey(key);
            return { x, y, ground };
          }),
        }
      : {}),
    ...(state.day === undefined ? {} : { day: state.day }),
    townHall: townHallTiles(state.config),
    ...(state.shop ? { shop: shopTiles(state.config) } : {}),
    ...(state.solidBuildings ? { solidBuildings: true as const } : {}),
    ...(state.tableSpotsKept ? { tableSpotsKept: true as const } : {}),
    ...(state.town
      ? {
          townBuilt: Object.entries(state.town.built).map(([key, proposal]) => {
            const [x, y] = parseKey(key);
            return { x, y, proposal };
          }),
        }
      : {}),
    ...(state.townsfolk?.length ? { townsfolk: [...state.townsfolk] } : {}),
    ...(Object.keys(shown).length > 0
      ? {
          displays: Object.entries(shown).map(([key, d]) => {
            const [x, y] = parseKey(key);
            const words = d.good.label !== undefined ? { trust: "untrusted" as const } : {};
            return { x, y, good: { ...d.good }, by: d.by, day: d.day, ...words };
          }),
        }
      : {}),
    ...(finds.length > 0 ? { displayedFinds: finds } : {}),
    ...(state.items && Object.keys(state.items.crops).length > 0
      ? {
          crops: Object.entries(state.items.crops).map(([key, c]) => {
            const [x, y] = parseKey(key);
            return { x, y, crop: c.crop, plantedDay: c.plantedDay, readyDay: c.readyDay };
          }),
        }
      : {}),
    ...(state.items?.gathered && Object.keys(state.items.gathered).length > 0
      ? {
          gathered: Object.keys(state.items.gathered).map((key) => {
            const [x, y] = parseKey(key);
            return { x, y };
          }),
        }
      : {}),
    ...(state.items && state.day !== undefined ? { pickups: pickupsToday(state) } : {}),
    ...(plotPickupsOwned(state) ? { plotPickupsOwned: true as const } : {}),
    ...(findsOpen(state) ? { findsOpen: true as const } : {}),
    ...(state.events?.list.some(eventOpen)
      ? {
          events: state.events.list.filter(eventOpen).map((e) => ({
            id: e.id,
            host: e.host,
            px: e.px,
            py: e.py,
            status: e.status as "scheduled" | "live",
            startsAt: e.startsAt,
            minutes: e.minutes,
            ...(isTownEvent(e) ? { town: true as const } : {}),
          })),
        }
      : {}),
    // Where tables stand, and nothing about the play: choices stay sealed (RFC 0011).
    ...(state.games && Object.keys(state.games.tables).length > 0
      ? {
          tables: activeTables(state).map((t) => ({
            id: t.id,
            game: t.game,
            pace: t.pace,
            status: t.status,
            x: t.place.x,
            y: t.place.y,
          })),
        }
      : {}),
  };
}

/**
 * Every fallen branch, loose stone, and find still lying in the world today, row by row. Once the
 * owners-only rule is on, one on a claimed plot says so.
 */
function pickupsToday(
  state: WorldState,
): { x: number; y: number; kind: PickupKind; ownersOnly?: true }[] {
  const owned = plotPickupsOwned(state);
  const out: { x: number; y: number; kind: PickupKind; ownersOnly?: true }[] = [];
  for (let y = 0; y < state.config.height; y++) {
    for (let x = 0; x < state.config.width; x++) {
      const kind = pickupLeft(state, x, y);
      if (!kind) continue;
      out.push(
        owned && plotAtTile(state, x, y) ? { x, y, kind, ownersOnly: true } : { x, y, kind },
      );
    }
  }
  return out;
}
