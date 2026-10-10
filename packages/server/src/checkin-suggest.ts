import { COLLECTION_WORDS, FIND_GROUND } from "@terrakin/protocol";
import {
  CATALOG,
  COSTUMES,
  CROP_INFO,
  type Crop,
  canBuildOn,
  countOf,
  dayName,
  displaysOf,
  FAMILIES,
  type Family,
  type FamilyInfo,
  FIND_KINDS,
  FIND_SPAWNS,
  FISHING,
  FISHING_ROD,
  type FindKind,
  type FindSpawn,
  FLOORS,
  findsOpen,
  type GoodKind,
  holidayLastDay,
  holidayOf,
  homePlotOf,
  type ItemKind,
  isTownsfolk,
  kindsIn,
  knockedToday,
  ownDoor,
  ownsWear,
  POND,
  priceOf,
  purseOf,
  RECIPES,
  type Season,
  seasonOf,
  TRICK_OR_TREAT,
  trickOrTreatDay,
  trickOrTreatNights,
  WEAR_INFO,
  type WorldState,
} from "@terrakin/sim";
import type { StepLeft } from "./checkin-steps";

/**
 * What a suggestion may know of a resident's collection book (RFC 0021): whether they've ever had a
 * kind. Without a social layer there's no book, and suggestions that read it go by what they hold.
 */
export interface BookFacts {
  has(kind: ItemKind): boolean;
}

/** One thing to try, suggested once on a resident's first check-in of a UTC day. */
interface TryNext {
  /** What `tryToday` says. Stable: agents may key on it. */
  id: string;
  /** Any of these accepted once counts as tried. */
  commands: readonly string[];
  /** Whether it's open in this world, and to this resident now. */
  open: (state: WorldState, viewer: string, book?: BookFacts) => boolean;
  /** Suggested only once one of these has been done (giving needs something made first). */
  after?: readonly string[];
  /** Its `todo` line: words from the server, or, for one that names a family, worked out. */
  line: string | ((state: WorldState, viewer: string, book?: BookFacts) => string);
}

const itemsOpen = (state: WorldState) => state.items !== undefined;

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
 * What the check-in says about Halloween's costumes: what they are, what they cost here, and how to
 * put the witch hat on with what the resident wears now, since `wear` is the whole outfit.
 */
function costumeLine(state: WorldState, viewer: string): string {
  const prices = COSTUMES.map((c) => priceOf(state, c));
  const others = (state.residents[viewer]?.wear ?? []).filter((w) => WEAR_INFO[w].slot !== "hat");
  const wear = JSON.stringify([...others, "witch_hat"]).replaceAll(",", ", ");
  const last = dayName(holidayLastDay("halloween", state.day ?? 0));
  return `It's Halloween until ${last}: the town shop sells costumes (a witch hat, cat ears, a pumpkin head, a ghost sheet, and bat wings, ${Math.min(...prices)} to ${Math.max(...prices)} coins, yours for good). Ask your owner which one they'd like you to wear, then buy it ({"type": "shop_buy", "sku": "witch_hat"}) and put it on with the rest of what you wear: {"type": "profile", "wear": ${wear}}, since \`wear\` is your whole outfit. On ${trickOrTreatNights()} (UTC), go trick-or-treating.`;
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
 * other: the first one open, untried, and not suggested in the last SUGGEST_AGAIN_DAYS is picked.
 * Only sim actions count as tried, since those are what the world log remembers. A suggestion is
 * never a reason to spend coins or message someone the owner wouldn't.
 */
export const TRY_NEXT: readonly TryNext[] = [
  {
    // Halloween's nights (RFC 0022): on October 31 and November 1, for a resident with a home who
    // hasn't knocked tonight and has a neighbor to knock on. No command counts as tried, so it
    // comes back next year.
    id: "trick_or_treat",
    commands: [],
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
    // Halloween's costumes (RFC 0022), for a resident who owns none: no command counts as tried,
    // and owning one closes it.
    id: "costume",
    commands: [],
    open: (state, viewer) =>
      state.shop !== undefined &&
      state.day !== undefined &&
      holidayOf(state.day) === "halloween" &&
      !isTownsfolk(state, viewer) &&
      !COSTUMES.some((c) => ownsWear(state, viewer, c)),
    line: costumeLine,
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
    line: 'It\'s autumn: the town shop sells pumpkin seeds until November 30, and the town buys pumpkins, pumpkin pie, and pumpkin soup every day of it. If your owner would like some, buy a few ({"type": "shop_buy", "sku": "pumpkin_seed", "count": 2}) and plant them like any seed. They take 5 days.',
  },
  {
    // Winter's crop, the same way: back a month later while winter lasts, until they have some.
    id: "cranberries",
    commands: [],
    open: (state, viewer) => seasonCropOpen(state, viewer, "winter", "cranberry", CRANBERRY_KINDS),
    after: ["harvest"],
    line: 'It\'s winter: the town shop sells cranberry seeds until the last day of February, and the town buys cranberries, cranberry jam, and hot cranberry punch every day of it. If your owner would like some, buy a few ({"type": "shop_buy", "sku": "cranberry_seed", "count": 2}) and plant them like any seed. They take 4 days, and a kitchen makes jam from 3 of them, a bag of sugar, and a jar.',
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
      return `Your home can have an upstairs: {"type": "add_floor", ${at}} adds an upstairs for ${FLOORS.price} coins (add "dry": true to see the price and spend nothing). Ask your owner first, since it spends coins they may want for something else. "Building up" in SKILL.md goes on from there to a loft with stairs.`;
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
    line: "Look at the town shop: GET /v1/shop lists what the town is buying today and what's for sale. Sell or buy only if your owner would like.",
  },
  {
    id: "market",
    commands: ["list_item", "buy_listing"],
    open: (state) => state.market !== undefined,
    line: "Look around the market: GET /v1/market. Tell your owner if something there would suit them; list or buy only if they'd like.",
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
  recent: (id: string) => boolean,
  book?: BookFacts,
): Candidate[] {
  return TRY_NEXT.map((t) => ({
    id: t.id,
    step: false,
    recent: recent(t.id),
    open: () =>
      t.open(state, viewer, book) &&
      !t.commands.some((c) => done.has(c)) &&
      (t.after === undefined || t.after.some((c) => done.has(c))),
    line: () => (typeof t.line === "string" ? t.line : t.line(state, viewer, book)),
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
): { id: string; line: string } | null {
  const picked = firstOpen(tryNextCandidates(state, viewer, done, (id) => recent.has(id), book));
  return picked && { id: picked.id, line: picked.line };
}

/**
 * Today's suggestion, or null: the first in one order that wasn't suggested too lately and is open
 * to the resident. First come the steps their first visit gained after they joined (`later`),
 * each back STEP_AGAIN_DAYS after it was last suggested and open only on a check-in that isn't
 * `quiet`, so on its own a step never turns `unchanged` into a full answer (decision 0129). Then
 * comes TRY_NEXT, each back SUGGEST_AGAIN_DAYS after it was last suggested, unless
 * `stepsOnly` (the link check-in's choice, since the rest name API calls). `days` is the day
 * each was last suggested, from `today - SUGGEST_AGAIN_DAYS` on. Reads only.
 */
export function pickSuggestion(o: {
  state: WorldState;
  viewer: string;
  done: ReadonlySet<string>;
  book: BookFacts;
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
          (id) => lastDay(id) > o.today - SUGGEST_AGAIN_DAYS,
          o.book,
        )),
  ]);
}
