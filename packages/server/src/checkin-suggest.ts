import { COLLECTION_WORDS, FIND_GROUND } from "@terrakin/protocol";
import {
  blocksOn,
  broughtTo,
  CATALOG,
  CIRCLES,
  COSTUMES,
  CROP_INFO,
  type Crop,
  canBuildOn,
  circleOf,
  countOf,
  DAY_MS,
  dateOfDay,
  dayName,
  displaysOf,
  ECONOMY,
  EVENTS,
  eventEndsAt,
  eventOpen,
  FAMILIES,
  type Family,
  type FamilyInfo,
  FIND_KINDS,
  FIND_SPAWNS,
  FIREWORKS,
  FISHING,
  FISHING_ROD,
  type FindKind,
  type FindSpawn,
  FLOORS,
  feastDay,
  feastToday,
  findsOpen,
  fireworkNight,
  foundProblem,
  type GoodKind,
  groundOn,
  HOUR_MS,
  hanukkahNight,
  holidayLastDay,
  homePlotOf,
  hostingProblem,
  type ItemKind,
  inHoliday,
  isDish,
  isTownsfolk,
  kindsIn,
  knockedToday,
  MINUTE_MS,
  nextHolidayStart,
  openDayOf,
  ownDoor,
  ownsWear,
  POND,
  PRESENTS,
  presentsFor,
  priceOf,
  purseOf,
  RECIPES,
  type Season,
  seasonOf,
  TOWN_ACTOR,
  TRICK_OR_TREAT,
  tileKey,
  trickOrTreatDay,
  trickOrTreatNights,
  WEAR_INFO,
  type WorldState,
  wrapDay,
} from "@terrakin/sim";
import type { StepLeft } from "./checkin-steps";
import { WEEKLY_TOWN_EVENTS } from "./town-events";

/**
 * What a suggestion may know of a resident's collection book (RFC 0021): whether they've ever had a
 * kind. Without a social layer there's no book, and suggestions that read it go by what they hold.
 */
export interface BookFacts {
  has(kind: ItemKind): boolean;
}

/** What a suggestion may know of the resident beyond the world: the events they said they're going to. */
export interface SocialFacts {
  going: ReadonlySet<string>;
}

/** One thing to try, suggested once on a resident's first check-in of a UTC day. */
interface TryNext {
  /** What `tryToday` says. Stable: agents may key on it. */
  id: string;
  /** Any of these accepted once counts as tried. */
  commands: readonly string[];
  /** Whether it's open in this world, and to this resident now. */
  open: (state: WorldState, viewer: string, book?: BookFacts, social?: SocialFacts) => boolean;
  /** Suggested only once one of these has been done (giving needs something made first). */
  after?: readonly string[];
  /** Back this many days after it was last suggested, in place of SUGGEST_AGAIN_DAYS. */
  againDays?: number;
  /** Its `todo` line: words from the server, or, for one that names a family, worked out. */
  line:
    | string
    | ((state: WorldState, viewer: string, book?: BookFacts, social?: SocialFacts) => string);
}

/**
 * What a line that hands out a `shop_buy` adds in a world that needs you at the counter
 * ([RFC 0042](../../../docs/rfcs/0042-actions-that-need-you-there.md)). Empty where the shop
 * serves from anywhere, so such a world's lines are what they always were.
 */
const counterNote = (state: WorldState) =>
  state.shop?.inPerson
    ? " Buying needs you at the shop's counter in this world: `you.away` in GET /v1/shop says whether you have to walk there first."
    : "";

const itemsOpen = (state: WorldState) => state.items !== undefined;

/** How many days before Halloween the check-in says candy can be made now. */
const HALLOWEEN_SOON_DAYS = 7;

/** Halloween's first day, while it's at most HALLOWEEN_SOON_DAYS away and hasn't started. */
function halloweenSoon(state: WorldState): number | undefined {
  if (state.day === undefined) return undefined;
  const first = nextHolidayStart("halloween", state.day);
  return first !== undefined && first - state.day <= HALLOWEEN_SOON_DAYS ? first : undefined;
}

/**
 * A weekly town event comes round every week, so the check-in points to one only on its day and the
 * two days before, and a one-off (the harvest night) is named first, so the weekly one never hides it.
 */
const WEEKLY_AHEAD_DAYS = 3;

/** Whether a town event's key is one of a weekly event's weeks (`sunday-gathering-2026-10-18`). */
const weeklyKey = (key: string | undefined) =>
  key !== undefined && WEEKLY_TOWN_EVENTS.some((w) => key.startsWith(`${w.key}-`));

/** How many world days ahead the check-in points to a town event the resident isn't going to. */
const TOWN_EVENT_AHEAD_DAYS = 7;

/**
 * The next town event (RFC 0010, decision 0081) that starts within TOWN_EVENT_AHEAD_DAYS and that
 * the resident hasn't said they're going to. Without the social facts nobody is going, so none.
 */
function townEventAhead(state: WorldState, viewer: string, social?: SocialFacts) {
  if (!social || state.day === undefined || isTownsfolk(state, viewer)) return undefined;
  const today = state.day;
  return (state.events?.list ?? [])
    .filter(
      (e) =>
        e.host === TOWN_ACTOR &&
        e.status === "scheduled" &&
        e.day >= today &&
        e.day < today + (weeklyKey(e.key) ? WEEKLY_AHEAD_DAYS : TOWN_EVENT_AHEAD_DAYS) &&
        !social.going.has(e.id),
    )
    .sort(
      (a, b) => Number(weeklyKey(a.key)) - Number(weeklyKey(b.key)) || a.startsAt - b.startsAt,
    )[0];
}

/** The UTC hour a first event is suggested for: evening in Europe, afternoon in the Americas. */
const HOST_HOUR = 19;
/** How long a suggested first event lasts, in minutes. */
const HOST_MINUTES = 60;

/**
 * The plot a resident could host a first event at for free, when they could host one now: their
 * home plot, theirs to build on, by the sim's own `hostingProblem`. Townsfolk never host.
 */
function hostPlot(state: WorldState, viewer: string) {
  if (state.day === undefined || isTownsfolk(state, viewer)) return undefined;
  if (hostingProblem(state, viewer) !== null) return undefined;
  const plot = homePlotOf(state, viewer);
  return plot && canBuildOn(plot, viewer) ? plot : undefined;
}

/**
 * When the first-event line suggests starting: HOST_HOUR UTC on the first day from tomorrow on
 * when nothing on the calendar overlaps it, anywhere, so it never splits the town's evening.
 * Tomorrow's evening is always more than an hour away, and the search stays inside the booking
 * window.
 */
function hostStart(state: WorldState): number {
  const today = state.day ?? 0;
  const open = (state.events?.list ?? []).filter(eventOpen);
  const at = (day: number) => day * DAY_MS + HOST_HOUR * HOUR_MS;
  for (let day = today + 1; day <= today + EVENTS.aheadDays; day++) {
    const start = at(day);
    const end = start + HOST_MINUTES * MINUTE_MS;
    if (!open.some((e) => e.startsAt < end && eventEndsAt(e) > start)) return start;
  }
  return at(today + 1);
}

/**
 * The plot a resident calls home, when it could take an upstairs today (RFC 0028): theirs to build
 * on, with room for one more, and the coins for it in their purse.
 */
function loftPlot(state: WorldState, viewer: string) {
  const plot = homePlotOf(state, viewer);
  if (!plot || !canBuildOn(plot, viewer) || (plot.floors ?? 0) >= FLOORS.max) return undefined;
  return (purseOf(state, viewer)?.balance ?? 0) >= FLOORS.price ? plot : undefined;
}

/**
 * The plot a resident calls home while its upstairs has nothing to stand on (RFC 0028): theirs to
 * build on, with a floor added and no flooring laid on it, so nobody can walk up there yet. The
 * 200 coins are spent by then, so this is the one line that says what the rest of a loft takes.
 */
function bareLoft(state: WorldState, viewer: string) {
  const plot = homePlotOf(state, viewer);
  const floors = plot?.floors ?? 0;
  if (!plot || floors < 1 || !canBuildOn(plot, viewer)) return undefined;
  const s = state.config.plotSize;
  const ground = plot.px * s;
  // The staircase, if one already stands: then the line is about the tile it comes up through,
  // the one tile flooring is refused on, rather than about building stairs they have.
  let stairs: { x: number; y: number } | undefined;
  for (let floor = 1; floor <= floors; floor++) {
    const up = groundOn(state, floor);
    for (let y = plot.py * s; y < (plot.py + 1) * s; y++) {
      for (let x = ground; x < ground + s; x++) {
        if (up[tileKey(x, y)] !== undefined) return undefined;
      }
    }
  }
  const below = blocksOn(state, 0);
  for (let y = plot.py * s; y < (plot.py + 1) * s && !stairs; y++) {
    for (let x = ground; x < ground + s; x++) {
      if (below[tileKey(x, y)] === "stairs") {
        stairs = { x, y };
        break;
      }
    }
  }
  return { plot, stairs };
}

/**
 * What the check-in says about Halloween's costumes: what they are, what they cost here, and how to
 * put the witch hat on with what the resident wears now, since `wear` is the whole outfit.
 */
function costumeLine(state: WorldState, viewer: string): string {
  const prices = COSTUMES.map((c) => priceOf(state, c));
  const others = (state.residents[viewer]?.wear ?? []).filter((w) => WEAR_INFO[w].slot !== "hat");
  const wear = JSON.stringify([...others, "witch_hat"]).replaceAll(",", ", ");
  const last = dayName(holidayLastDay("halloween", state.day ?? 0));
  return `It's Halloween until ${last}: the town shop sells costumes (a witch hat, cat ears, a pumpkin head, a ghost sheet, and bat wings, ${Math.min(...prices)} to ${Math.max(...prices)} coins, yours for good). Ask your owner which one they'd like you to wear, then buy it ({"type": "shop_buy", "sku": "witch_hat"}) and put it on with the rest of what you wear: {"type": "profile", "wear": ${wear}}, since \`wear\` is your whole outfit. On ${trickOrTreatNights()} (UTC), go trick-or-treating.${counterNote(state)}`;
}

/**
 * Everything of a crop, from the catalog: the seed that grows it, the crop, and the made goods
 * whose recipe needs it (`RECIPES`, so not furniture or sweets).
 */
const cropKinds = (crop: Crop): ReadonlySet<string> =>
  new Set([
    CROP_INFO[crop].seed,
    crop,
    ...(Object.keys(RECIPES) as GoodKind[]).filter((k) => (RECIPES[k].needs[crop] ?? 0) > 0),
  ]);

/** Everything pumpkin: autumn's seeds, its crop, and what the kitchen makes from it (RFC 0017). */
export const PUMPKIN_KINDS = cropKinds("pumpkin");

/** Everything cranberry: winter's seeds, its crop, and what the kitchen makes from it. */
export const CRANBERRY_KINDS = cropKinds("cranberry");

/**
 * Whether a resident has any of a season's crop, held or growing (`kinds`, its seeds, the crop,
 * and what's made from it): they've found it.
 */
function hasCrop(
  state: WorldState,
  viewer: string,
  crop: string,
  kinds: ReadonlySet<string>,
): boolean {
  const inv = state.items?.inventories[viewer];
  if (Object.keys(inv?.stacks ?? {}).some((k) => kinds.has(k))) return true;
  if (inv?.goods.some((g) => kinds.has(g.kind))) return true;
  return Object.values(state.items?.crops ?? {}).some((c) => c.by === viewer && c.crop === crop);
}

/** Whether a season's crop is one to suggest: its seeds on sale today, to a gardener with none. */
const seasonCropOpen = (
  state: WorldState,
  viewer: string,
  season: Season,
  crop: string,
  kinds: ReadonlySet<string>,
) =>
  state.shop !== undefined &&
  state.day !== undefined &&
  seasonOf(state.day) === season &&
  !isTownsfolk(state, viewer) &&
  !hasCrop(state, viewer, crop, kinds);
/** Something someone else put on display, to admire: a made thing, since a find has no maker. */
const othersDisplay = (state: WorldState, viewer: string) =>
  Object.values(displaysOf(state)).some((d) => d.by !== viewer);

/** Whether a resident has ever had a find: from their book, or without one, what they hold now. */
function hasFound(state: WorldState, viewer: string, book?: BookFacts): boolean {
  if (book) return FIND_KINDS.some((k) => book.has(k));
  const stacks = state.items?.inventories[viewer]?.stacks ?? {};
  return FIND_KINDS.some((k) => (stacks[k] ?? 0) > 0);
}

/**
 * The first family of finds a resident is one kind short of finishing, when that kind lies on the
 * ground today (it's in season): the family, its badge, and the find. Undefined otherwise.
 */
function oneFindShort(
  day: number,
  book: BookFacts,
): { family: Family; badge: string; kind: FindKind; spawn: FindSpawn } | undefined {
  const season = seasonOf(day);
  for (const family of Object.keys(FAMILIES) as Family[]) {
    if ((FAMILIES[family] as FamilyInfo).parent !== "find") continue;
    const missing = kindsIn(family).filter((k) => !book.has(k));
    if (missing.length !== 1) continue;
    const kind = missing[0] as FindKind;
    const spawn = (FIND_SPAWNS as readonly FindSpawn[]).find((f) => f.kind === kind);
    const badge = COLLECTION_WORDS[family].badge;
    if (!spawn || !badge || (spawn.seasons && !spawn.seasons.includes(season))) continue;
    return { family, badge, kind, spawn };
  }
  return undefined;
}
/**
 * Whether `id` holds a menorah or has one standing on their home plot, on any floor (RFC 0034).
 */
function hasMenorah(state: WorldState, id: string): boolean {
  if ((state.items?.inventories[id]?.stacks.menorah ?? 0) > 0) return true;
  const home = homePlotOf(state, id);
  if (!home) return false;
  const s = state.config.plotSize;
  for (let floor = 0; floor <= (home.floors ?? 0); floor++) {
    const blocks = blocksOn(state, floor);
    for (let y = home.py * s; y < (home.py + 1) * s; y++) {
      for (let x = home.px * s; x < (home.px + 1) * s; x++) {
        if (blocks[tileKey(x, y)] === "menorah") return true;
      }
    }
  }
  return false;
}

/** Whether `id` holds something a kitchen made for the feast's table (RFC 0034). */
function holdsDish(state: WorldState, id: string): boolean {
  const inv = state.items?.inventories[id];
  if (!inv) return false;
  return (
    inv.goods.some((g) => isDish(g.kind)) ||
    Object.entries(inv.stacks).some(([kind, n]) => (n ?? 0) > 0 && isDish(kind))
  );
}

/**
 * Founding's cost against `viewer`'s purse, and the way to the rest (issue #69): "Founding costs
 * 25 coins, and you have 8. Your allowance, 10 a day at your hearth (15 on a streak), gets you
 * there in about 2 days. ..."
 */
export function foundingCost(state: WorldState, viewer: string): string {
  const have = purseOf(state, viewer)?.balance ?? 0;
  const short = CIRCLES.fee - have;
  const daily = ECONOMY.allowance;
  const rest =
    short <= 0
      ? `Founding costs ${CIRCLES.fee} coins, and you have ${have}.`
      : `Founding costs ${CIRCLES.fee} coins, and you have ${have}. Your allowance, ${daily} a day at your hearth (${daily + ECONOMY.streakBonus} on a streak), gets you there in about ${Math.ceil(short / daily)} ${short > daily ? "days" : "day"}.`;
  return `${rest} Members can chip in toward it while it forms ({"type": "chip_in_circle", ...}), and if it doesn't form within ${CIRCLES.formDays} days, all but ${CIRCLES.trialBurn} coins come back.`;
}

/** Something a pedestal or frame can show in your things: a made thing, or a find. */
const holdsShowable = (state: WorldState, viewer: string) => {
  const inv = state.items?.inventories[viewer];
  return (inv?.goods.length ?? 0) > 0 || FIND_KINDS.some((k) => (inv?.stacks[k] ?? 0) > 0);
};
/** An open proposal you're on the roll for and haven't voted on yet. */
const votable = (state: WorldState, viewer: string) =>
  !isTownsfolk(state, viewer) &&
  (state.town?.proposals ?? []).some(
    (p) =>
      p.status === "open" &&
      (p.electorate?.includes(viewer) ?? false) &&
      !Object.hasOwn(p.votes, viewer),
  );

/**
 * The parts of Terrakin a newcomer might never find on their own, in the order they build on each
 * other: the first one open, untried, and not suggested in the last SUGGEST_AGAIN_DAYS (or its own
 * `againDays`) is picked.
 * Only sim actions count as tried, since those are what the world log remembers. A suggestion is
 * never a reason to spend coins or message someone the owner wouldn't.
 */
export const TRY_NEXT: readonly TryNext[] = [
  {
    // Halloween's nights (RFC 0022): on October 31 and November 1, for a resident with a home who
    // hasn't knocked tonight and has a neighbor to knock on. No command counts as tried, so it
    // comes back next year, and each night is its own, so it comes back for November 1 too.
    id: "trick_or_treat",
    commands: [],
    againDays: 1,
    open: (state, viewer) =>
      itemsOpen(state) &&
      trickOrTreatDay(state.day) &&
      !isTownsfolk(state, viewer) &&
      state.residents[viewer]?.hearth != null &&
      knockedToday(state, viewer).length === 0 &&
      Object.values(state.plots).some((p) => !ownDoor(state, viewer, p)),
    line: `It's a Halloween night (${trickOrTreatNights()}, UTC): go trick-or-treating. Visit a neighbor ({"type": "visit", "px": <px>, "py": <py>}; GET /v1/plots lists them) and knock: {"type": "trick_or_treat", "px": <px>, "py": <py>}. Each knock gets a candy from whoever is home, their candy bowl, or the town. Once a door, up to ${TRICK_OR_TREAT.doorsPerDay} doors tonight. Tell your owner how the night went.`,
  },
  {
    // The Thanksgiving feast on its day, scheduled or on (RFC 0034), for a resident who holds a
    // dish and hasn't brought one. The day's suggestion is picked at its first check-in, so it's
    // open all day and says when the feast starts. No command counts as tried.
    id: "feast",
    commands: [],
    againDays: 1,
    open: (state, viewer) => {
      const feast = feastToday(state);
      return (
        feast !== undefined &&
        !broughtTo(feast, viewer) &&
        !isTownsfolk(state, viewer) &&
        holdsDish(state, viewer)
      );
    },
    line: (state) => {
      const feast = feastToday(state);
      const id = feast?.id ?? "<event>";
      const when =
        feast?.status === "live"
          ? "is on in the Commons now"
          : `is in the Commons today from ${new Date(feast?.startsAt ?? 0).toISOString().slice(11, 16)} UTC`;
      return `The Thanksgiving feast ${when}. Go while it's on ({"type": "join_event", "event": "${id}"}) and bring one dish you made for the town's table: {"type": "bring_dish", "item": "<a made thing's id, like i_12, or a sweet's kind, like candy>"}. It leaves your things for good, so ask your owner which one to bring.`;
    },
  },
  {
    // Hanukkah (RFC 0034), once a Hanukkah, for a resident with a home who has no menorah in their
    // things or on their plot. Nothing counts as tried, so it comes back next year.
    id: "menorah",
    commands: [],
    open: (state, viewer) =>
      state.shop !== undefined &&
      state.day !== undefined &&
      inHoliday("hanukkah", state.day) &&
      !isTownsfolk(state, viewer) &&
      state.residents[viewer]?.hearth != null &&
      !hasMenorah(state, viewer),
    line: (state) =>
      `It's Hanukkah, night ${hanukkahNight(state.day ?? 0)} of 8. Ask your owner whether they'd like a menorah ({"type": "shop_buy", "sku": "menorah"}, ${priceOf(state, "menorah")} coins while Hanukkah runs), then place it by your hearth: it lights one more candle each night. A kitchen makes jelly doughnuts from 2 strawberries and a bag of sugar any day.${counterNote(state)}`,
  },
  {
    // Christmas (RFC 0034): in the ten days before it, December 15 to 24, wrap a present for
    // someone your owner is close to. Once a season: nothing counts as tried, so it comes back next
    // year. Wrapping opens on December 1; the hint waits for the run-up, so it doesn't crowd out
    // winter's first suggestions.
    id: "wrap_presents",
    commands: [],
    open: (state, viewer) =>
      state.items !== undefined &&
      state.day !== undefined &&
      wrapDay(state.day) &&
      dateOfDay(state.day).date >= PRESENTS.openFrom - 10 &&
      dateOfDay(state.day).date < PRESENTS.openFrom &&
      !isTownsfolk(state, viewer) &&
      (state.items.inventories[viewer]?.goods.length ?? 0) +
        Object.keys(state.items.inventories[viewer]?.stacks ?? {}).length >
        0,
    line: (state) =>
      `${dateOfDay(state.day ?? 0).date === 24 ? "It's Christmas Eve: a present wrapped today opens tomorrow." : "It's December: presents can be wrapped until the 25th."} Ask your owner whether they'd like to give someone they're close to something you hold, wrapped: {"type": "give", "item": "<an id or a kind>", "to": "<residentId>", "wrapped": true}. It waits for them, unopened, until December ${PRESENTS.openFrom}.`,
  },
  {
    // Presents waiting that can be opened now (RFC 0034), every day until they're opened.
    id: "open_presents",
    commands: [],
    againDays: 1,
    open: (state, viewer) =>
      state.day !== undefined &&
      presentsFor(state, viewer).some((p) => openDayOf(p.day) <= (state.day as number)),
    line: (state, viewer) => {
      const ready = presentsFor(state, viewer).filter(
        (p) => openDayOf(p.day) <= (state.day as number),
      );
      const { month, date } = dateOfDay(state.day ?? 0);
      const christmas = month === 12 && date === PRESENTS.openFrom ? "It's Christmas Day. " : "";
      return `${christmas}You have ${ready.length === 1 ? "a present" : `${ready.length} presents`} to open (GET /v1/inventory lists them, never what's in them). Open them with your owner if you can: {"type": "open_present", "present": "${ready[0]?.id ?? "<id>"}"}. Tell them who each was from, and thank the giver.`;
    },
  },
  {
    // New Year's Eve and Day (RFC 0034): fireworks, every night they're on.
    id: "fireworks",
    commands: [],
    againDays: 1,
    open: (state, viewer) =>
      state.items !== undefined &&
      fireworkNight(state.day) &&
      !isTownsfolk(state, viewer) &&
      state.residents[viewer]?.hearth != null,
    line: `It's a fireworks night (December 31 or January 1, UTC). Set one off over your own plot or the Commons, within ${FIREWORKS.reach} tiles of you: {"type": "set_off_firework", "x": <x>, "y": <y>, "color": "gold"}. The shop sells them over New Year's. Up to ${FIREWORKS.perNight} a night. The town gathers in the Commons at midnight UTC; tell your owner what time that is for them.`,
  },
  {
    // Thanksgiving's Thursday (RFC 0034): thank a neighbor. Praise is a social call, not a
    // command, so nothing counts as tried; it's open one day a year.
    id: "give_thanks",
    commands: [],
    open: (state, viewer) =>
      state.day !== undefined &&
      inHoliday("thanksgiving", state.day) &&
      feastDay(state.day) === state.day &&
      !isTownsfolk(state, viewer) &&
      Object.keys(state.residents).some((id) => id !== viewer && !isTownsfolk(state, id)),
    line: `It's Thanksgiving. Thank a neighbor who made this year better: POST /v1/residents/<id>/praise, once a day for each. Ask your owner who they'd like to thank.`,
  },
  {
    // A town event coming up this week that the resident isn't going to (RFC 0010): by id and
    // time, never its words. Saying you're going is a social row, not a command, so nothing
    // counts as tried; it comes back every few days until they're going or it starts, and from
    // then the going path takes over (the day-before line, then the event_started notice).
    id: "town_event",
    commands: [],
    againDays: 3,
    open: (state, viewer, _book, social) => townEventAhead(state, viewer, social) !== undefined,
    line: (state, viewer, _book, social) => {
      const e = townEventAhead(state, viewer, social);
      if (!e) return "";
      return `The town hosts its own event ${e.id} in the Commons, starting ${new Date(e.startsAt).toISOString()}. Read it with GET /v1/events/${e.id} and tell your owner. If they'd like you there, say you're going with POST /v1/events/${e.id}/going: the check-in then reminds you the day before, and a notice tells you when it starts.`;
    },
  },
  {
    // The week before Halloween (RFC 0022), to a resident with a hearth who holds no candy:
    // candy is made at a kitchen any day, so there's some ready for trick-or-treaters. Making
    // candy closes it, and it comes back next year.
    id: "halloween_soon",
    commands: [],
    open: (state, viewer) =>
      itemsOpen(state) &&
      halloweenSoon(state) !== undefined &&
      !isTownsfolk(state, viewer) &&
      state.residents[viewer]?.hearth != null &&
      (state.items?.inventories[viewer]?.stacks.candy ?? 0) === 0,
    line: (state) => {
      const first = halloweenSoon(state) ?? state.day ?? 0;
      return `Halloween starts ${dayName(first)}: the town shop sells costumes and spooky decor until ${dayName(holidayLastDay("halloween", first))}, and ${trickOrTreatNights()} (UTC) are for trick-or-treating. Candy can be made now, any day: at a kitchen by your hearth, a pumpkin and a bag of sugar make five ({"type": "craft", "recipe": "candy", "x": <x>, "y": <y>}). Ask your owner whether they'd like some ready for trick-or-treaters.`;
    },
  },
  {
    // Halloween's costumes (RFC 0022), for a resident who owns none: no command counts as tried,
    // and owning one closes it.
    id: "costume",
    commands: [],
    open: (state, viewer) =>
      state.shop !== undefined &&
      state.day !== undefined &&
      inHoliday("halloween", state.day) &&
      !isTownsfolk(state, viewer) &&
      !COSTUMES.some((c) => ownsWear(state, viewer, c)),
    line: costumeLine,
  },
  {
    // A first event (RFC 0010), to a resident who could host one and never has: at their own
    // plot, which is free, unlike the Commons' deposit. Scheduling one counts as tried. The line
    // asks the owner first and names the exact call, at a time that overlaps nothing on the
    // calendar.
    id: "host_event",
    commands: ["schedule_event"],
    open: (state, viewer) => hostPlot(state, viewer) !== undefined,
    line: (state, viewer) => {
      const plot = hostPlot(state, viewer);
      const at = plot ? `"px": ${plot.px}, "py": ${plot.py}` : '"px": <px>, "py": <py>';
      const when = new Date(hostStart(state)).toISOString();
      return `Host a small event at your own plot: it's free there (only the Commons holds a deposit), and an hour with a few neighbors is plenty. Ask your owner first, and pick the kind, title, and words with them. Then {"type": "schedule_event", "kind": "gathering", "title": "<a title>", "text": "<what to bring>", ${at}, "startsAt": "${when}", "minutes": ${HOST_MINUTES}} (kind is show, class, market, listening, or gathering; add "dry": true to check it first). It goes on the Town Hall board, and each neighbor who comes and stays counts toward your hosting record.`;
    },
  },
  {
    id: "plant",
    commands: ["plant"],
    open: itemsOpen,
    line: 'Plant something: place a planter on your plot ({"type": "place", "x": <x>, "y": <y>, "block": "planter"}), then {"type": "plant", "x": <x>, "y": <y>, "seed": "flower"}.',
  },
  {
    id: "gather",
    commands: ["gather"],
    open: itemsOpen,
    line: 'Gather a branch or a stone: `pickups` in GET /v1/world says where they lie today. Then {"type": "gather", "x": <x>, "y": <y>} on your plot, the Commons, or unclaimed land, or {"type": "gather"} to pick up everything within reach of where you stand.',
  },
  {
    // Finds (RFC 0021), for someone whose collection book has none yet. No command counts as
    // tried: it comes back a month later until they've found one.
    id: "forage",
    commands: [],
    open: (state, viewer, book) => findsOpen(state) && !hasFound(state, viewer, book),
    line: 'Go foraging on a walk: besides branches and stones, the ground holds finds now and then, like acorns and mushrooms in forests, seashells on the sand, and crystals on stony ground, a few only in their season and some rare. `pickups` in GET /v1/world lists what lies where today, by kind. Pick one up with {"type": "gather", "x": <x>, "y": <y>} where you may gather, and tell your owner when you find a rare one. GET /v1/collection is your collection book.',
  },
  {
    // A pet is for good, so the line asks the owner first (RFC 0019).
    id: "pet",
    commands: ["adopt_pet"],
    open: (state, viewer) => {
      const me = state.residents[viewer];
      return me?.hearth != null && me.pet === undefined && !isTownsfolk(state, viewer);
    },
    line: 'Adopt a pet: ask your owner what kind they\'d like (cat, dog, rabbit, hedgehog, duck, frog, fox, or tortoise), which coat, and what to call it. It\'s free and for good: {"type": "adopt_pet", "kind": "cat", "coat": "ginger", "name": "<a name>"}. When you visit neighbors, pat their pets with POST /v1/residents/{id}/pet/pat.',
  },
  {
    id: "craft",
    commands: ["craft"],
    open: itemsOpen,
    after: ["harvest"],
    line: "Make something from your harvest: place a kitchen or a workbench on your plot, then craft herb tea, jam, or a bouquet. The recipes are in the catalog of GET /v1/inventory.",
  },
  {
    // Autumn's crop, for a gardener who has none: no command counts as tried, so it comes back a
    // month later while autumn lasts, and never once they have pumpkin seeds, pumpkins, or either.
    id: "pumpkins",
    commands: [],
    open: (state, viewer) => seasonCropOpen(state, viewer, "autumn", "pumpkin", PUMPKIN_KINDS),
    after: ["harvest"],
    line: (state) =>
      `It's autumn: the town shop sells pumpkin seeds until November 30, and the town buys pumpkins, pumpkin pie, and pumpkin soup every day of it. If your owner would like some, buy a few ({"type": "shop_buy", "sku": "pumpkin_seed", "count": 2}) and plant them like any seed. They take 5 days.${counterNote(state)}`,
  },
  {
    // Winter's crop, the same way: back a month later while winter lasts, until they have some.
    id: "cranberries",
    commands: [],
    open: (state, viewer) => seasonCropOpen(state, viewer, "winter", "cranberry", CRANBERRY_KINDS),
    after: ["harvest"],
    line: (state) =>
      `It's winter: the town shop sells cranberry seeds until the last day of February, and the town buys cranberries, cranberry jam, and hot cranberry punch every day of it. If your owner would like some, buy a few ({"type": "shop_buy", "sku": "cranberry_seed", "count": 2}) and plant them like any seed. They take 4 days, and a kitchen makes jam from 3 of them, a bag of sugar, and a jar.${counterNote(state)}`,
  },
  {
    id: "build",
    commands: ["build", "lay"],
    open: (state, viewer) => Object.values(state.plots).some((p) => canBuildOn(p, viewer)),
    line: 'Make your plot look lived in: lay a path out of your door in one call, {"type": "build", "px": <px>, "py": <py>, "ground": [{"x": 3, "y": 6, "ground": "dirt"}, {"x": 3, "y": 7, "ground": "dirt"}]}. Add "dry": true to price a bigger plan first; SKILL.md has a few to copy.',
  },
  {
    // Fishing (RFC 0023), once they've gathered, since a rod takes wood and a pond stone. A cast
    // counts as tried.
    id: "fish",
    commands: ["fish"],
    open: itemsOpen,
    after: ["gather"],
    line: `Go fishing: make a fishing rod at a workbench from ${countOf("wood", RECIPES[FISHING_ROD].needs.wood ?? 0)} ({"type": "craft", "recipe": "${FISHING_ROD}", "x": <x>, "y": <y>}), dig a pond on your plot ({"type": "place", "x": <x>, "y": <y>, "block": "pond"}, ${countOf("stone", POND.stone)} a tile), stand right beside it, and cast with {"type": "fish"}. What bites depends on the season, the time of day, and the weather (\`timeOfDay\` and \`weather\` here say what it's like now): a rainy night brings up fish a sunny noon never does. ${FISHING.castsPerDay} casts a day. Tell your owner when you catch something rare.`,
  },
  {
    // An upstairs (RFC 0028), to someone with a home, the coins, and no upstairs yet. It spends
    // coins, so the line asks the owner first and prices it with a dry run.
    id: "upstairs",
    commands: ["add_floor"],
    open: (state, viewer) => loftPlot(state, viewer) !== undefined,
    after: ["build_starter_home", "build", "place"],
    line: (state, viewer) => {
      const plot = loftPlot(state, viewer);
      const at = plot ? `"px": ${plot.px}, "py": ${plot.py}` : '"px": <px>, "py": <py>';
      return `Your home can have an upstairs: {"type": "add_floor", ${at}} adds an upstairs for ${FLOORS.price} coins (add "dry": true to see the price and spend nothing). Ask your owner first, since it spends coins they may want for something else. What it buys is empty air: a loft takes flooring laid on floor 1 and stairs up from the ground floor, the stairs first, since the tile they come up through stays clear. "Building up" in SKILL.md has one build plan that does both.`;
    },
  },
  {
    // An upstairs with nothing to stand on (RFC 0028): the coins are already spent, so this says
    // what the rest takes, in the order that works. No command counts as tried, since `lay` and
    // `place` are everyday calls; laying any flooring up there closes it.
    id: "loft",
    commands: [],
    // A week, not the usual month: the whole job of this line is to unstick someone who has
    // already paid, and an upstairs nobody can walk on is worth saying again sooner than that.
    againDays: 7,
    open: (state, viewer) => bareLoft(state, viewer) !== undefined,
    line: (state, viewer) => {
      const loft = bareLoft(state, viewer);
      const where = loft ? `px ${loft.plot.px}, py ${loft.plot.py}` : "your home plot";
      const { stairs } = loft ?? {};
      const climb = stairs
        ? `Your stairs at x ${stairs.x}, y ${stairs.y} come up through that tile on floor 1, so floor the tiles round it and leave that one clear.`
        : `Stairs are {"type": "place", "x": <x>, "y": <y>, "block": "stairs"} on the ground floor, ${FLOORS.stairsWood} wood, and they go in first: the tile they come up through stays clear.`;
      return `Your upstairs (${where}) has no flooring, so nobody can walk up there yet. Flooring is {"type": "lay", "x": <x>, "y": <y>, "floor": 1, "ground": "dirt"} on a tile with a wall under it, within ${FLOORS.span} tiles on the floor below (dirt, sand, moss, and fallen leaves cost nothing). ${climb} One {"type": "build"} plan orders the whole loft for you, and "Building up" in SKILL.md has one to copy.`;
    },
  },
  {
    // Plots worth visiting (RFC 0020): open once someone else lives here too.
    id: "visit",
    commands: ["visit"],
    open: (state, viewer) => Object.values(state.plots).some((p) => !canBuildOn(p, viewer)),
    line: 'Visit a neighbor: GET /v1/plots lists the plots people live on, newest change first. Jump to one with {"type": "visit", "px": <px>, "py": <py>} and look around. If your owner would like it, admire it with POST /v1/plots/<px>/<py>/admire, and tell them about a plot worth seeing.',
  },
  {
    // Only with something to show, a made thing or a find: furniture stacks, and goes on the plot.
    id: "display",
    commands: ["display"],
    open: (state, viewer) => itemsOpen(state) && holdsShowable(state, viewer),
    line: 'Put something you made on display: place a pedestal on your plot, then {"type": "display", "item": "<id>", "x": <x>, "y": <y>}.',
  },
  {
    id: "give",
    commands: ["give"],
    open: itemsOpen,
    after: ["craft"],
    line: "If a friend has a day that matters and your owner would like it, give them something you made: give, or a gift gesture.",
  },
  {
    id: "admire",
    commands: ["admire"],
    open: (state, viewer) => itemsOpen(state) && othersDisplay(state, viewer),
    line: 'Look at what others have on display: GET /v1/galleries. Admire what you like with {"type": "admire", "x": <x>, "y": <y>}.',
  },
  {
    id: "gallery",
    commands: ["set_gallery"],
    open: itemsOpen,
    after: ["display"],
    line: 'Open your plot as a gallery, so others find what you have on display: {"type": "set_gallery", "px": <px>, "py": <py>, "open": true}.',
  },
  {
    // A collector one find from a family's badge, when that find lies somewhere this season.
    id: "finish_family",
    commands: [],
    open: (state, _viewer, book) =>
      book !== undefined &&
      findsOpen(state) &&
      state.day !== undefined &&
      oneFindShort(state.day, book) !== undefined,
    line: (state, _viewer, book) => {
      const short = book && state.day !== undefined ? oneFindShort(state.day, book) : undefined;
      if (!short) return "";
      const name = CATALOG[short.kind].name.toLowerCase();
      const only = short.spawn.seasons ? `, only in ${short.spawn.seasons.join(" and ")}` : "";
      return `You're one find from "${short.badge}" in your collection book: ${name}. It lies ${FIND_GROUND[short.spawn.biome]} now and then${only}. \`pickups\` in GET /v1/world lists what lies where today; pick one up with {"type": "gather", "x": <x>, "y": <y>} where you may gather, and tell your owner when you do.`;
    },
  },
  {
    // Only while there's something to vote on. A proposal is the owner's idea, never a suggestion.
    id: "town_hall",
    commands: ["vote", "propose"],
    open: votable,
    line: "Look in at the Town Hall: GET /v1/town. Tell your owner what's open, and vote the way they'd want.",
  },
  {
    id: "shop",
    commands: ["sell_to_town", "shop_buy"],
    open: (state) => state.shop !== undefined,
    line: (state: WorldState) =>
      `Look at the town shop: GET /v1/shop lists what the town is buying today and what's for sale. Sell or buy only if your owner would like.${counterNote(state)}`,
  },
  {
    // The town's jobs (RFC 0030), introduced once: open while jobs are open here, to a resident
    // with a hearth. Taking one counts as tried, so the board is never suggested again. The line
    // names no job: which kinds, if any, is the owner's to say.
    id: "jobs",
    commands: ["take_job"],
    open: (state, viewer) =>
      state.jobs !== undefined &&
      state.residents[viewer]?.hearth != null &&
      !isTownsfolk(state, viewer),
    line: 'The town has three small jobs a day, asked by the townsfolk: GET /v1/jobs. One pays 10 points in its skill and never coins, and at most three count in a week. They\'re optional: ask your owner once which kinds they\'d enjoy and keep that in your notes, then take one only when it fits ({"type": "take_job", "job": "<id>"}).',
  },
  {
    // Circles (RFC 0033), introduced once: open while circles are open here, to a resident who
    // could found one, or could but for coins, and is in none. Founding or joining counts as
    // tried. The line says the cost against their purse and the way to the rest (issue #69), and
    // is about neighbors the owner already knows, never a stranger's invite.
    id: "circle",
    commands: ["found_circle", "join_circle"],
    open: (state, viewer) => {
      if (state.circles === undefined || circleOf(state, viewer) !== undefined) return false;
      const problem = foundProblem(state, viewer);
      return problem === null || problem.code === "not_enough_coins";
    },
    line: (state, viewer) =>
      `A circle is a small group that meets once a week for a circle night at one member's plot: GET /v1/circles. If your owner has neighbors here they already know and would like to see every week, ask whether they'd like to found one together. ${foundingCost(state, viewer)} It's their call.`,
  },
  {
    id: "market",
    commands: ["list_item", "buy_listing"],
    open: (state) => state.market !== undefined,
    line: "Look around the market: GET /v1/market. Tell your owner if something there would suit them; list or buy only if they'd like. Before listing, see what the town buys today in GET /v1/shop, since it pays at once for those, and price from what others ask for the same kind (GET /v1/market?kind=<kind>).",
  },
  {
    id: "bounties",
    commands: ["claim_bounty", "post_bounty"],
    open: (state) => state.bounties !== undefined,
    line: "Read the open bounties: GET /v1/bounties. Tell your owner about any that fit them; take one on only if they want to.",
  },
  {
    id: "games",
    commands: ["open_table", "sit"],
    open: (state) => state.day !== undefined,
    line: 'Play a party game, if your owner would like: GET /v1/games lists tables taking seats. Sit at a slow one with {"type": "sit", "table": "<id>"}, or open your own with {"type": "open_table", "game": "lowest_lantern", "pace": "slow"}. Each round, decide the way your owner would play.',
  },
];

/**
 * The suggestions in TRY_NEXT that a resident has tried or that are open to them now, in order,
 * with whether they've tried each, for `GET /v1/first-visit`. Only ones a command counts as tried,
 * since the rest have no done to show. Reads only.
 */
export function tryStates(
  state: WorldState,
  viewer: string,
  done: ReadonlySet<string>,
  book?: BookFacts,
): { id: string; done: boolean }[] {
  return TRY_NEXT.flatMap((t) => {
    if (t.commands.length === 0) return [];
    const tried = t.commands.some((c) => done.has(c));
    return tried || t.open(state, viewer, book) ? [{ id: t.id, done: tried }] : [];
  });
}

/** Days after it was last suggested before a suggestion that wasn't taken up comes back. */
export const SUGGEST_AGAIN_DAYS = 30;

/**
 * Days before a first-visit step added after the resident joined comes back as the suggestion, if
 * they haven't done it: on the same weekday a week later. It's part of setting up, so it comes back
 * sooner than the rest (decision 0129).
 */
const STEP_AGAIN_DAYS = 7;

/** Where the check-in keeps which suggestion each resident got (CheckinLog in production). */
export interface Suggestions {
  /** Whether the resident got a suggestion on `day`, and the day they last got each since `fromDay`. */
  suggested(
    residentId: string,
    day: number,
    fromDay: number,
  ): { today: boolean; days: Map<string, number> };
  suggest(residentId: string, id: string, day: number): void;
}

/** A suggestion for today: its id, its line, and whether it's a first-visit step. */
export interface Suggestion {
  id: string;
  line: string;
  step: boolean;
}

/** Something the check-in may suggest, as the one rule below reads it. */
interface Candidate {
  id: string;
  step: boolean;
  /** Whether it was suggested too lately to come again today. */
  recent: boolean;
  /** Whether it's open to the resident now. */
  open: () => boolean;
  line: () => string;
}

/** The first candidate, in order, that wasn't suggested too lately and is open, with its line. */
function firstOpen(order: readonly Candidate[]): Suggestion | null {
  const picked = order.find((c) => !c.recent && c.open());
  return picked ? { id: picked.id, line: picked.line(), step: picked.step } : null;
}

/**
 * TRY_NEXT as candidates: each is open when it's open in this world and to this resident, they
 * haven't tried it, and they've done one of its prerequisites. `recent` says which were suggested
 * too lately.
 */
function tryNextCandidates(
  state: WorldState,
  viewer: string,
  done: ReadonlySet<string>,
  recent: (id: string, againDays: number) => boolean,
  book?: BookFacts,
  social?: SocialFacts,
): Candidate[] {
  return TRY_NEXT.map((t) => ({
    id: t.id,
    step: false,
    recent: recent(t.id, t.againDays ?? SUGGEST_AGAIN_DAYS),
    open: () =>
      t.open(state, viewer, book, social) &&
      !t.commands.some((c) => done.has(c)) &&
      (t.after === undefined || t.after.some((c) => done.has(c))),
    line: () => (typeof t.line === "string" ? t.line : t.line(state, viewer, book, social)),
  }));
}

/**
 * The first in TRY_NEXT that fits, with its line, or null. `recent` holds the ones suggested in
 * the last SUGGEST_AGAIN_DAYS, and `book` is the resident's collection book, for the suggestions
 * that read it. Reads only.
 */
export function pickTryNext(
  state: WorldState,
  viewer: string,
  done: ReadonlySet<string>,
  recent: Pick<ReadonlySet<string>, "has">,
  book?: BookFacts,
  social?: SocialFacts,
): { id: string; line: string } | null {
  const picked = firstOpen(
    tryNextCandidates(state, viewer, done, (id) => recent.has(id), book, social),
  );
  return picked && { id: picked.id, line: picked.line };
}

/**
 * Today's suggestion, or null: the first in one order that wasn't suggested too lately and is open
 * to the resident. First come the steps their first visit gained after they joined (`later`),
 * each back STEP_AGAIN_DAYS after it was last suggested and open only on a check-in that isn't
 * `quiet`, so on its own a step never turns `unchanged` into a full answer (decision 0129). Then
 * comes TRY_NEXT, each back SUGGEST_AGAIN_DAYS (or its own `againDays`) after it was last
 * suggested, unless `stepsOnly` (the link check-in's choice, since the rest name API calls).
 * `days` is the day each was last suggested, from `today - SUGGEST_AGAIN_DAYS` on. Reads only.
 */
export function pickSuggestion(o: {
  state: WorldState;
  viewer: string;
  done: ReadonlySet<string>;
  book: BookFacts;
  social: SocialFacts;
  later: readonly StepLeft[];
  quiet: boolean;
  stepsOnly: boolean;
  today: number;
  days: ReadonlyMap<string, number>;
}): Suggestion | null {
  const lastDay = (id: string) => o.days.get(id) ?? -Infinity;
  return firstOpen([
    ...o.later.map((s) => ({
      id: s.step,
      step: true,
      recent: lastDay(s.step) > o.today - STEP_AGAIN_DAYS,
      open: () => !o.quiet,
      line: () => s.line,
    })),
    ...(o.stepsOnly
      ? []
      : tryNextCandidates(
          o.state,
          o.viewer,
          o.done,
          (id, againDays) => lastDay(id) > o.today - againDays,
          o.book,
          o.social,
        )),
  ]);
}
