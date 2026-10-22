import {
  fourWayFacing,
  PROTOCOL_VERSION,
  ROUTINE_LIMITS,
  type WorldEvent as WireEvent,
  type WorldSnapshot,
} from "@terrakin/protocol";
import {
  activeTables,
  blocksOn,
  circleById,
  circleName,
  commonsPlot,
  DAY_LENGTH_MS,
  type Direction,
  displaysOf,
  eventOpen,
  FLOORS,
  findsOnDisplay,
  findsOpen,
  floorField,
  groundOn,
  holidaysField,
  isTownEvent,
  isTownsfolk,
  type PickupKind,
  pageEditionOf,
  pageOn,
  parseKey,
  pickupLeft,
  plotAtTile,
  plotPickupsOwned,
  presentsWaiting,
  RECIPE_PAGE,
  type RecipeName,
  type Resident,
  residentById,
  type StepRoutine,
  shopTiles,
  shownCircleName,
  skyAt,
  timeOfDayAt,
  townHallTiles,
  type WorldEvent,
  type WorldState,
} from "@terrakin/sim";
import { shownPlotName } from "./plots";
import { nameKey } from "./text";

/**
 * What the world sends out: an input's events as the wire shows them, who may see each, and the
 * world snapshot. `WorldService` keeps the state these read; nothing here changes it.
 */

/**
 * What an input's sim events look like on the wire. Owner-pair and maintainer lists stay on the
 * server, and so do `event_credited`, the guest list the server sent the sim (RFC 0029), two of
 * jobs' events (RFC 0030): `job_total`, a merge's bookkeeping (the count is on the profile), and
 * `job_edition_set`, since the board is read from `GET /v1/jobs` and never mirrored,
 * `page_edition_set`, since the snapshot's `pageEdition` is what a client draws pages from
 * (RFC 0024), and `circle_nights`, a merge's bookkeeping for circle nights attended (RFC 0033). A
 * gift also shows as a public `gift` event, without the amount or note, unless townsfolk are on
 * either side: their purses reset to the budget each day, so the public treasury lines would give
 * the amount away. A `land_opened` goes out as the snapshot's `lands` names its tiles (RFC 0038),
 * so one reader draws water and bridges one way.
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
      e.type === "event_ticked" ||
      e.type === "event_credited" ||
      e.type === "job_total" ||
      e.type === "job_edition_set" ||
      e.type === "page_edition_set" ||
      e.type === "circle_nights"
    ) {
      continue;
    }
    if (e.type === "ways_opened" || e.type === "ways_closed") {
      out.push({ ...e, tiles: e.tiles.map(([x, y]) => ({ x, y })) });
      continue;
    }
    if (e.type === "land_opened") {
      // Plot slots and bridge tiles are `[x, y]` pairs in the sim and named coordinates on the
      // wire, as the snapshot's `lands` has them.
      const { streets, ...rest } = e;
      out.push({
        ...rest,
        plots: e.plots.map(([px, py]) => ({ px, py })),
        bridge: e.bridge.map(([x, y]) => ({ x, y })),
        square: { px: e.square[0], py: e.square[1] },
        ...(streets ? { streets: streets.map(([px, py]) => ({ px, py })) } : {}),
      });
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
    if (
      e.type === "circle_founded" ||
      (e.type === "circle_named" && e.name !== null) ||
      (e.type === "circle_hall" && e.name !== undefined) ||
      (e.type === "circle_invited" && e.note !== undefined)
    ) {
      // A circle's name is its stewards' words, and an invite's note the steward's own to its
      // invitee (RFC 0033, issue #73). A takedown carries no name.
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
export function holdBackNames(
  events: WireEvent[],
  hidden: (id: string) => boolean,
  state?: WorldState,
): WireEvent[] {
  return events.map((e) => {
    // A circle's name while its writer's words are held back goes by the circle's id (RFC 0033).
    if (e.type === "circle_founded" && hidden(e.founder)) {
      return { ...e, name: circleName({ id: e.circle }) };
    }
    if (e.type === "circle_named" && e.by !== null && hidden(e.by)) {
      const { trust: _words, ...rest } = e;
      return { ...rest, name: null };
    }
    if (e.type === "circle_hall" && e.name !== undefined) {
      const k = state ? circleById(state, e.circle) : undefined;
      if (k) return { ...e, name: shownCircleName(k, hidden) };
    }
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

/** The events that belong to one resident alone, by type. */
const PRIVATE_EVENTS = [
  "coins",
  "inventory",
  "wear_bought",
  "routines_set",
  "recipe_learned",
  "progress",
  "job_taken",
  "job_progress",
  "job_done",
  "job_dropped",
] as const satisfies readonly WireEvent["type"][];

/**
 * Purse moves, inventory changes, wear bought at the shop, routines turned on or off, recipes
 * learned (RFC 0024), points earned (RFC 0029), and a job taken, moved, finished, or let go (RFC
 * 0030): each belongs to one resident alone.
 */
export const isPrivate = (
  e: WireEvent,
): e is Extract<WireEvent, { type: (typeof PRIVATE_EVENTS)[number] }> =>
  (PRIVATE_EVENTS as readonly string[]).includes(e.type);

/** Who may hear an event that isn't for everyone and isn't one resident's alone, or undefined. */
export type Audience = (e: WireEvent) => readonly string[] | undefined;

const everyone: Audience = () => undefined;

/** Who could hear a circle's events, by circle: undefined for a formed one, which is everyone's. */
export type CircleRoster = ReadonlyMap<
  string,
  { few?: readonly string[]; stewards: readonly string[] }
>;

/** Who hears each circle's events now, read before a commit that may disband one (RFC 0033). */
export function circleRoster(state: WorldState): CircleRoster {
  const roster = new Map<string, { few?: readonly string[]; stewards: readonly string[] }>();
  for (const k of Object.values(state.circles?.list ?? {})) {
    roster.set(k.id, {
      stewards: [...k.stewards],
      ...(k.status === "formed"
        ? {}
        : { few: [...Object.keys(k.members), ...Object.keys(k.invites ?? {})] }),
    });
  }
  return roster;
}

/**
 * Who hears a circle's event (RFC 0033), or undefined when everyone does. An invite, and its
 * closing, go to the invitee and the circle's stewards. A forming circle's events go to its
 * members, the residents it invited, and the resident the event names, so someone who just left
 * still hears it. A formed circle's go to everyone. Read from the world after the commit, and for
 * a circle the commit disbanded, from `before`, so a forming one stays with its few to its end.
 */
export function circleAudience(state: WorldState, before: CircleRoster = new Map()): Audience {
  const now = circleRoster(state);
  return (e) => {
    const id = "circle" in e ? e.circle : undefined;
    if (!e.type.startsWith("circle_") || typeof id !== "string") return undefined;
    const k = now.get(id) ?? before.get(id);
    if (!k) return undefined;
    const named = "residentId" in e && typeof e.residentId === "string" ? [e.residentId] : [];
    if (e.type === "circle_invited" || e.type === "circle_uninvited") {
      return [...new Set([...named, ...k.stewards])];
    }
    if (!k.few) return undefined;
    return [...new Set([...named, ...k.few])];
  };
}

/**
 * What everyone may see: no purse moves, no inventory changes, and nothing `audience` keeps to a
 * few. Never empty, so every client's `seq` keeps counting.
 */
export function publicEvents(events: WireEvent[], audience: Audience = everyone): WireEvent[] {
  const shown = events.filter((e) => !isPrivate(e) && audience(e) === undefined);
  return shown.length > 0 ? shown : [{ type: "quiet" }];
}

/**
 * What one resident may see: everything public, plus their own purse and inventory changes, and
 * what `audience` lets them hear. A lesson's `recipe_learned` goes to its teacher too (RFC 0024):
 * both of them were there.
 */
export function eventsFor(
  events: WireEvent[],
  viewer: string,
  audience: Audience = everyone,
): WireEvent[] {
  return events.filter((e) => {
    if (isPrivate(e)) {
      return e.residentId === viewer || (e.type === "recipe_learned" && e.from === viewer);
    }
    const few = audience(e);
    return few === undefined || few.includes(viewer);
  });
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
  /** Residents a count leaves out (`repeatJoins`). */
  repeatJoins: readonly string[];
}

/**
 * Who a resident count leaves out (decision 0148): untouched records that share a name and a kind
 * with another resident, almost always the same person joining again before names were unique
 * (issue #46). A person and an AI with one name are never a group: they're likely an owner and
 * their AI (decision 0230). Where someone in a group has done something, every untouched record
 * in it is left out; where nobody has, all but the first to join. Townsfolk aren't residents here.
 */
export function repeatJoins(state: WorldState, untouched: (r: Resident) => boolean): string[] {
  const byName = new Map<string, Resident[]>();
  for (const r of Object.values(state.residents)) {
    if (isTownsfolk(state, r.id)) continue;
    const name = `${r.kind}:${nameKey(r.name)}`;
    byName.set(name, [...(byName.get(name) ?? []), r]);
  }
  return [...byName.values()].flatMap((same) => {
    if (same.length < 2) return [];
    const idle = same.filter(untouched);
    const left = idle.length === same.length ? idle.slice(1) : idle;
    return left.map((r) => r.id);
  });
}

/** How many presents wait for each resident (RFC 0034), in id order. Absent when none do. */
function presentsWaitingField(state: WorldState) {
  const presents = Object.entries(presentsWaiting(state))
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([residentId, count]) => ({ residentId, count }));
  return presents.length > 0 ? { presents } : {};
}

/**
 * The halls of formed circles (RFC 0033), each with its circle's name, a resident's words, for
 * the map to draw under the plot's own name. Absent when there are none, so a world without
 * circles snapshots as it always did.
 */
function hallsField(state: WorldState, held: (id: string) => boolean) {
  const halls = Object.values(state.circles?.list ?? {}).flatMap((k) =>
    k.status === "formed" && k.hall
      ? [
          {
            px: k.hall.px,
            py: k.hall.py,
            circle: k.id,
            name: shownCircleName(k, held),
            trust: "untrusted" as const,
          },
        ]
      : [],
  );
  return halls.length > 0 ? { halls } : {};
}

/**
 * The lands beyond downtown (RFC 0038): the rectangle downtown is, and each open land with its
 * name, its claimable plot slots, and the bridge tiles that reach it. Absent in a world that never
 * opened one, which is every world so far, so such a world's snapshot is exactly what it was. A
 * reader works out the water from these facts, the way the rules do (the sim's `seaFrom`): its
 * square is ground too, so a counter is never drawn in the sea.
 */
function landsField(state: WorldState) {
  const lands = state.lands;
  if (!lands) return {};
  return {
    lands: {
      home: { ...lands.home },
      list: lands.list.map((l) => ({
        id: l.id,
        name: l.name,
        plots: l.plots.map(([px, py]) => ({ px, py })),
        bridge: l.bridge.map(([x, y]) => ({ x, y })),
        square: { px: l.square[0], py: l.square[1] },
        ...(l.streets ? { streets: l.streets.map(([px, py]) => ({ px, py })) } : {}),
      })),
    },
  };
}

/**
 * Public ways (RFC 0046), north to south, then west to east, once there are any: a world that never
 * laid one reads as it always did.
 */
function waysField(state: WorldState) {
  if (!state.ways) return {};
  const ways = Object.keys(state.ways)
    .map((key) => {
      const [x, y] = key.split(",").map(Number) as [number, number];
      return { x, y };
    })
    .sort((a, b) => a.y - b.y || a.x - b.x);
  return { ways };
}

/** The world as `GET /v1/world` and a socket's `welcome` show it. */
export function worldSnapshot(state: WorldState, extras: SnapshotExtras): WorldSnapshot {
  const { nowMs, hash, facing, routineSteps, noteHidden, repeatJoins } = extras;
  // Made things on display, and finds on display (RFC 0021), each in their own list.
  const shown = displaysOf(state);
  const finds = findsOnDisplay(state);
  const view = (r: Resident) => {
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
  };
  const townsfolk = (state.townsfolk ?? []).flatMap((id) => {
    const r = residentById(state, id);
    return r ? [view(r)] : [];
  });
  // Every floor's blocks and flooring, the ground floor's first, `floor` on the rest (RFC 0028).
  // With no floors these are the ground floor's alone, as they always were.
  const floors = Array.from({ length: FLOORS.max + 1 }, (_, floor) => floor);
  const blocks = floors.flatMap((floor) =>
    Object.entries(blocksOn(state, floor)).map(([key, block]) => {
      const [x, y] = parseKey(key);
      return { x, y, ...floorField(floor), block };
    }),
  );
  const ground = floors.flatMap((floor) =>
    Object.entries(groundOn(state, floor)).map(([key, kind]) => {
      const [x, y] = parseKey(key);
      return { x, y, ...floorField(floor), ground: kind };
    }),
  );
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
    ...holidaysField(state.day),
    config: {
      width: state.config.width,
      height: state.config.height,
      plotSize: state.config.plotSize,
      maxPlotsPerResident: state.config.maxPlotsPerResident,
      reach: state.config.reach,
    },
    commons: commonsPlot(state),
    ...landsField(state),
    ...waysField(state),
    residents: Object.values(state.residents).flatMap((r) =>
      isTownsfolk(state, r.id) ? [] : [view(r)],
    ),
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
        ...(p.floors ? { floors: p.floors } : {}),
        // Its roof (RFC 0041), which a client draws over the walls it reads from the snapshot.
        ...(p.roof ? { roof: { ...p.roof } } : {}),
      };
    }),
    blocks,
    ...(ground.length > 0 ? { ground } : {}),
    ...(state.day === undefined ? {} : { day: state.day }),
    townHall: townHallTiles(state),
    ...(state.shop ? { shop: shopTiles(state) } : {}),
    ...(state.solidBuildings ? { solidBuildings: true as const } : {}),
    ...(state.tableSpotsKept ? { tableSpotsKept: true as const } : {}),
    ...(state.starterDoors ? { starterDoors: true as const } : {}),
    ...(state.shop?.inPerson ? { shopInPerson: true as const } : {}),
    ...(state.proposeInPerson ? { proposeInPerson: true as const } : {}),
    ...(state.scheduleInPerson ? { scheduleInPerson: true as const } : {}),
    ...(state.town
      ? {
          townBuilt: Object.entries(state.town.built).map(([key, proposal]) => {
            const [x, y] = parseKey(key);
            return { x, y, proposal };
          }),
        }
      : {}),
    ...(state.townsfolk?.length ? { townsfolk: [...state.townsfolk] } : {}),
    // Kept apart so a count of `residents` never includes them.
    ...(townsfolk.length > 0 ? { townsfolkResidents: townsfolk } : {}),
    ...(repeatJoins.length > 0 ? { repeatJoins: [...repeatJoins] } : {}),
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
    ...(state.recipes ? { recipesOpen: true as const } : {}),
    ...(state.recipes?.pages ? { pageEdition: state.recipes.pages } : {}),
    ...(state.progress ? { levelsOpen: true as const } : {}),
    ...(state.jobs ? { jobsOpen: true as const } : {}),
    ...(state.circles ? { circlesOpen: true as const } : {}),
    ...(state.plotMarket ? { plotMarketOpen: true as const } : {}),
    ...hallsField(state, noteHidden),
    ...presentsWaitingField(state),
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

/** One thing lying on the ground today, as the snapshot lists it. */
interface PickupView {
  x: number;
  y: number;
  kind: PickupKind;
  recipe?: RecipeName;
  ownersOnly?: true;
}

/**
 * Every fallen branch, loose stone, find, and recipe page (with the recipe it teaches) still lying
 * in the world today, row by row. Once the owners-only rule is on, one on a claimed plot says so.
 */
function pickupsToday(state: WorldState): PickupView[] {
  const owned = plotPickupsOwned(state);
  const day = state.day ?? 0;
  const edition = pageEditionOf(state);
  const out: PickupView[] = [];
  for (let y = 0; y < state.config.height; y++) {
    for (let x = 0; x < state.config.width; x++) {
      const kind = pickupLeft(state, x, y);
      if (!kind) continue;
      const recipe = kind === RECIPE_PAGE ? pageOn(x, y, day, edition) : null;
      out.push({
        x,
        y,
        kind,
        ...(recipe ? { recipe } : {}),
        ...(owned && plotAtTile(state, x, y) ? { ownersOnly: true as const } : {}),
      });
    }
  }
  return out;
}
