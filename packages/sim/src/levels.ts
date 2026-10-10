import { CROPS, FIND_KINDS, FISH_KINDS, FURNITURE_KINDS, GOOD_KINDS, SWEET_KINDS } from "./catalog";
import { oneTimeSwitch, refuse } from "./check";
import { isTownsfolk, sameHousehold } from "./economy";
import { findEvent } from "./events";
import { EARNED_WEAR, type EarnedWear, isEarnedWear } from "./looks";
import { own, residentById } from "./own";
import { seasonSpan, weekStart } from "./season";
import { townEligibility } from "./town";
import type {
  Command,
  GameTable,
  ProgressState,
  Rejection,
  ResidentId,
  Skill,
  SkillPoints,
  Title,
  WorldEvent,
  WorldState,
} from "./types";
import { SKILLS, TITLES } from "./types";

/**
 * Levels and skills (RFC 0029). A deed earns points in its skill, counted by the deed's own input:
 * a harvest, a craft, a find or a fish, a lesson, a paid bounty, a rated game, and guests at an
 * event. Each skill counts up to `PROGRESS.dailyCap` points a UTC day, and the first time a
 * resident harvests, makes, finds, or catches a kind earns `PROGRESS.first` more, outside the cap.
 * A level is read from points (`levelOf`) and never stored, so it can't disagree with them. A
 * skill's level unlocks a title and a garment, which show and do nothing else.
 *
 * Points are not coins: nothing here mints, burns, or moves one. Nothing runs until the server
 * logs `open_levels`, which creates `state.progress`, so every older log replays as it was made.
 */

/**
 * The numbers, tuned with `scripts/economy-sim.ts` (decision 0246). Once levels are open in a live
 * world, changing one changes how logged inputs replay, so it needs a logged switch.
 */
export const PROGRESS = {
  /** Points a skill counts in one UTC day. A deed past it still happens and adds none. */
  dailyCap: 20,
  /** The first harvest, craft, find, or catch of a kind, on top of the deed and outside the cap. */
  first: 10,
  /** Going from level n to n + 1 takes this many points times n. */
  step: 20,
  /** Growing: a harvest. */
  harvest: 2,
  /** Making: a craft, however many it makes. */
  craft: 2,
  /** Foraging: a find picked up, recipe pages included. Wood and stone earn nothing. */
  find: 4,
  /** Foraging: a fish caught. An old boot earns nothing. */
  fish: 2,
  /** Hosting: a lesson taught to a resident with a hearth, outside the teacher's household. */
  lesson: 8,
  /** Hosting: a bounty you were paid for. */
  bounty: 6,
  /** A resident's bounty counts only for a reward of at least this many coins. */
  bountyMinReward: 5,
  /**
   * Hosting: each counted guest at an event you hosted, one event a UTC day. The daily cap ends it
   * at ten guests.
   */
  guest: 2,
  /** Hosting: being a counted guest at an event, once a UTC day. */
  attend: 8,
  /** Playing: a rated game finished. */
  game: 6,
  /** Playing: finishing first in it, ties included, on top of `game`. */
  win: 2,
} as const;

/** The skill levels that unlock a skill's title, its garment, and its second title. */
export const UNLOCKS = { title: 3, wear: 5, master: 10 } as const;

/** Each title's words, and the skill level that unlocks it. Words are fixed, never resident text. */
export const TITLE_INFO: Record<Title, { label: string; skill: Skill; level: number }> = {
  gardener: { label: "Gardener", skill: "growing", level: UNLOCKS.title },
  maker: { label: "Maker", skill: "making", level: UNLOCKS.title },
  forager: { label: "Forager", skill: "foraging", level: UNLOCKS.title },
  host: { label: "Host", skill: "hosting", level: UNLOCKS.title },
  player: { label: "Player", skill: "playing", level: UNLOCKS.title },
  master_gardener: { label: "Master gardener", skill: "growing", level: UNLOCKS.master },
  master_maker: { label: "Master maker", skill: "making", level: UNLOCKS.master },
  master_forager: { label: "Master forager", skill: "foraging", level: UNLOCKS.master },
  grand_host: { label: "Grand host", skill: "hosting", level: UNLOCKS.master },
  champion: { label: "Champion", skill: "playing", level: UNLOCKS.master },
};

/** The skill each earned garment comes from, at `UNLOCKS.wear`. */
export const EARNED_WEAR_SKILL: Record<EarnedWear, Skill> = {
  sun_hat: "growing",
  tool_belt: "making",
  field_vest: "foraging",
  party_sash: "hosting",
  winners_rosette: "playing",
};

/** A skill's name in people's words: "Growing". */
export const skillName = (skill: Skill) => `${skill[0]?.toUpperCase()}${skill.slice(1)}`;

/** One thing a skill's level unlocks: a title to show, or a garment to wear. */
export interface Unlock {
  skill: Skill;
  level: number;
  title?: Title;
  wear?: EarnedWear;
}

/** Everything a skill unlocks, lowest level first: its title, its garment, its second title. */
export function skillUnlocks(skill: Skill): Unlock[] {
  const titles = TITLES.filter((title) => TITLE_INFO[title].skill === skill).map(
    (title): Unlock => ({ skill, level: TITLE_INFO[title].level, title }),
  );
  const wear = EARNED_WEAR.filter((item) => EARNED_WEAR_SKILL[item] === skill).map(
    (item): Unlock => ({ skill, level: UNLOCKS.wear, wear: item }),
  );
  return [...titles, ...wear].sort((a, b) => a.level - b.level);
}

type Mutation = () => WorldEvent[];

// ---------- the curve ----------

/** The points level `level` starts at: 0 for level 1, then `step` more for each level than the last. */
export const pointsFor = (level: number): number => (PROGRESS.step * level * (level - 1)) / 2;

/** The level `points` make: 1 with none, and no top. Whole numbers only, so every engine agrees. */
export function levelOf(points: number): number {
  let level = 1;
  while (pointsFor(level + 1) <= points) level += 1;
  return level;
}

const totalOf = (points: SkillPoints | undefined): number =>
  SKILLS.reduce((sum, skill) => sum + (points?.[skill] ?? 0), 0);

/** A resident's points by skill. Private, like a purse. Empty before levels open. */
export const pointsOf = (state: WorldState, id: ResidentId): SkillPoints =>
  own(state.progress?.points, id) ?? {};

/** A resident's level, from all their points, and each skill's level from its own. Public. */
export function levelsOf(
  state: WorldState,
  id: ResidentId,
): { level: number; skills: Record<Skill, number> } {
  const points = pointsOf(state, id);
  const skills = Object.fromEntries(
    SKILLS.map((skill) => [skill, levelOf(points[skill] ?? 0)]),
  ) as Record<Skill, number>;
  return { level: levelOf(totalOf(points)), skills };
}

/** The kinds a resident has had a first for, sorted. Private. */
export const firstsOf = (state: WorldState, id: ResidentId): readonly string[] =>
  own(state.progress?.firsts, id) ?? [];

/** The title a resident shows, if any. Public. */
export const titleOf = (state: WorldState, id: ResidentId): Title | undefined =>
  own(state.progress?.titles, id);

/** What a resident's skill levels have unlocked so far, in skill order: what `profile` would take. */
export function unlockedBy(state: WorldState, id: ResidentId): Unlock[] {
  const { skills } = levelsOf(state, id);
  return SKILLS.flatMap((skill) => skillUnlocks(skill).filter((u) => u.level <= skills[skill]));
}

// ---------- what counts ----------

const isOneOf = (list: readonly string[], kind: unknown): kind is string =>
  typeof kind === "string" && list.includes(kind);

/**
 * The skill a kind's first counts in, or undefined for a kind that has none: a crop's is its
 * harvest (Growing), a good's, a piece of furniture's, or a sweet's its craft (Making), and a
 * find's or a fish's its pickup or catch (Foraging). A kind is in one family, so a first is one
 * skill's.
 */
export function firstSkill(kind: unknown): Skill | undefined {
  if (isOneOf(CROPS, kind)) return "growing";
  if (isOneOf(GOOD_KINDS, kind) || isOneOf(FURNITURE_KINDS, kind) || isOneOf(SWEET_KINDS, kind)) {
    return "making";
  }
  if (isOneOf(FIND_KINDS, kind) || isOneOf(FISH_KINDS, kind)) return "foraging";
  return undefined;
}

/** One thing a resident did: the skill it counts in, its points, and the kind it may be a first of. */
interface Deed {
  skill: Skill;
  points: number;
  first?: string;
}

/**
 * What one skill gains from an input: the points to add, how many of them count toward today's
 * cap, and the kinds that became firsts.
 */
interface Gain {
  skill: Skill;
  points: number;
  counted: number;
  firsts: string[];
}

/**
 * Add `gains` to a resident's points and say so: a private `progress` for each skill, then a
 * public `level_reached` for each skill level, and for the resident's own level, that went up.
 * `season` is the season the points count in, absent for the one-time credit and a merge.
 */
function addPoints(
  progress: ProgressState,
  id: ResidentId,
  gains: readonly Gain[],
  season?: string,
): WorldEvent[] {
  const points = { ...(own(progress.points, id) ?? {}) };
  const before = { ...points };
  const events: WorldEvent[] = [];
  for (const { skill, points: added, counted, firsts } of gains) {
    points[skill] = (points[skill] ?? 0) + added;
    let today = own(progress.today, id)?.[skill] ?? 0;
    if (counted > 0) {
      today += counted;
      progress.today ??= {};
      progress.today[id] = { ...(own(progress.today, id) ?? {}), [skill]: today };
    }
    if (firsts.length > 0) {
      progress.firsts[id] = [...(own(progress.firsts, id) ?? []), ...firsts].sort();
    }
    if (season !== undefined) {
      progress.seasons ??= {};
      const board = own(progress.seasons, season) ?? {};
      const mine = own(board, id) ?? {};
      board[id] = { ...mine, [skill]: (mine[skill] ?? 0) + added };
      progress.seasons[season] = board;
    }
    events.push({
      type: "progress",
      residentId: id,
      skill,
      points: added,
      ...(firsts.length > 0 ? { firsts: [...firsts] } : {}),
      total: points[skill] ?? 0,
      today,
    });
  }
  progress.points[id] = points;
  for (const { skill } of gains) {
    const level = levelOf(points[skill] ?? 0);
    if (level > levelOf(before[skill] ?? 0)) {
      events.push({ type: "level_reached", residentId: id, skill, level });
    }
  }
  const level = levelOf(totalOf(points));
  if (level > levelOf(totalOf(before))) {
    events.push({ type: "level_reached", residentId: id, level });
  }
  return events;
}

/**
 * What `deeds` add to a resident's points now, as a commit, or null when they add nothing: before
 * levels open, for townsfolk (who never earn), and when every point is past today's cap and no
 * deed is a first. A skill's deeds count up to what's left of its cap; a first counts once per
 * kind and resident, whatever the cap says.
 */
function earning(state: WorldState, id: ResidentId, deeds: readonly Deed[]): Mutation | null {
  const progress = state.progress;
  if (!progress) return null;
  if (!residentById(state, id) || isTownsfolk(state, id)) return null;
  const had = own(progress.firsts, id) ?? [];
  const today = own(progress.today, id);
  const seen: string[] = [];
  const gains: Gain[] = [];
  for (const skill of SKILLS) {
    const mine = deeds.filter((d) => d.skill === skill);
    const room = Math.max(0, PROGRESS.dailyCap - (today?.[skill] ?? 0));
    const counted = Math.min(
      room,
      mine.reduce((sum, d) => sum + d.points, 0),
    );
    const firsts: string[] = [];
    for (const { first } of mine) {
      if (first === undefined || had.includes(first) || seen.includes(first)) continue;
      seen.push(first);
      firsts.push(first);
    }
    const points = counted + firsts.length * PROGRESS.first;
    if (points > 0) gains.push({ skill, points, counted, firsts });
  }
  if (gains.length === 0) return null;
  // Levels open only once items are, and items only once the world counts days.
  const season = String(seasonSpan(state.day as number).start);
  return () => addPoints(progress, id, gains, season);
}

/** The events a deed's points make in its commit, or none when it earned nothing. */
export const earned = (points: Mutation | null): WorldEvent[] => (points ? points() : []);

/** Growing: a harvest of `crop`. */
export const harvestEarns = (state: WorldState, id: ResidentId, crop: string) =>
  earning(state, id, [{ skill: "growing", points: PROGRESS.harvest, first: crop }]);

/** Making: a craft of `recipe`, a good, a piece of furniture, or a sweet. */
export const craftEarns = (state: WorldState, id: ResidentId, recipe: string) =>
  earning(state, id, [{ skill: "making", points: PROGRESS.craft, first: recipe }]);

/**
 * Foraging: what one `gather` picked up. A find counts, and a recipe page counts with no first (a
 * page isn't a kind you hold); wood and stone lie everywhere and earn nothing.
 */
export function gatherEarns(state: WorldState, id: ResidentId, kinds: readonly string[]) {
  const deeds: Deed[] = [];
  for (const kind of kinds) {
    if (isOneOf(FIND_KINDS, kind)) {
      deeds.push({ skill: "foraging", points: PROGRESS.find, first: kind });
    } else if (kind === "recipe_page") deeds.push({ skill: "foraging", points: PROGRESS.find });
  }
  return earning(state, id, deeds);
}

/** Foraging: a cast that caught `caught`. A boot, or nothing, earns nothing. */
export const catchEarns = (state: WorldState, id: ResidentId, caught: string) =>
  isOneOf(FISH_KINDS, caught)
    ? earning(state, id, [{ skill: "foraging", points: PROGRESS.fish, first: caught }])
    : null;

/**
 * Hosting: a lesson `teacher` gave `learner`. It counts when the learner has a hearth and isn't in
 * the teacher's household. The learner earns nothing for learning.
 */
export function lessonEarns(state: WorldState, teacher: ResidentId, learner: ResidentId) {
  const them = residentById(state, learner);
  if (!them?.hearth || sameHousehold(state, teacher, learner)) return null;
  return earning(state, teacher, [{ skill: "hosting", points: PROGRESS.lesson }]);
}

/**
 * Hosting: a resident's bounty its poster just paid `claimant` for. It counts when the poster is
 * outside the claimant's household and could vote in the Town Hall, the reward is at least
 * `PROGRESS.bountyMinReward`, and no bounty from that poster counted for that claimant this UTC
 * week. The week's pairs are kept in `progress.week`, written only when points were added.
 */
export function bountyEarns(
  state: WorldState,
  poster: ResidentId,
  claimant: ResidentId,
  reward: number,
): Mutation | null {
  const progress = state.progress;
  if (!progress) return null;
  if (sameHousehold(state, poster, claimant)) return null;
  if (!townEligibility(state, poster).eligible) return null;
  if (reward < PROGRESS.bountyMinReward) return null;
  const monday = weekStart(state.day as number);
  const week = progress.week?.start === monday ? progress.week : undefined;
  if (own(week?.bounties, claimant)?.includes(poster)) return null;
  const counts = earning(state, claimant, [{ skill: "hosting", points: PROGRESS.bounty }]);
  if (!counts) return null;
  return () => {
    const events = counts();
    if (progress.week?.start !== monday) progress.week = { start: monday, bounties: {} };
    const paid = own(progress.week.bounties, claimant) ?? [];
    progress.week.bounties[claimant] = [...paid, poster].sort();
    return events;
  };
}

/**
 * Hosting: a town bounty or a released grant a maintainer just paid `claimant` for. It counts
 * every time, since a maintainer confirmed it from outside the deal.
 */
export const townBountyEarns = (state: WorldState, claimant: ResidentId) =>
  earning(state, claimant, [{ skill: "hosting", points: PROGRESS.bounty }]);

/**
 * Playing: a game that just ended with `places`, after `rounds` (each seat's choice a round, `null`
 * where it made none) and with `away` the seats away at the end. A seat rated at `start_game`
 * (decision 0096) earns for finishing a game it played: one where it decided at least one round.
 * Finishing first earns more, ties included, unless the game ended because every seat was away,
 * which nobody won. A seat that sat down and never chose earns nothing, wherever the default left
 * it on the board.
 */
export function gameEarns(
  state: WorldState,
  table: GameTable,
  rounds: readonly Readonly<Record<ResidentId, number | null>>[],
  places: Readonly<Record<ResidentId, number>>,
  away: readonly ResidentId[],
): Mutation | null {
  const played = (id: ResidentId) => rounds.some((moves) => typeof own(moves, id) === "number");
  const won = away.length < table.seats.length;
  const earnings = table.seats
    .filter((seat) => seat.rated && played(seat.resident))
    .map((seat) =>
      earning(state, seat.resident, [
        { skill: "playing", points: PROGRESS.game },
        ...(won && own(places, seat.resident) === 1
          ? [{ skill: "playing" as const, points: PROGRESS.win }]
          : []),
      ]),
    )
    .filter((e) => e !== null);
  return earnings.length > 0 ? () => earnings.flatMap((e) => e()) : null;
}

// ---------- titles and earned wear ----------

/**
 * What a `profile`'s `title` does: nothing when it's absent or already so, a rejection for a title
 * that doesn't exist (`invalid_profile`) or whose skill level the resident hasn't reached
 * (`not_earned`), else a commit that shows it (`null` shows none) with a public `title_changed`.
 */
export function checkTitle(
  state: WorldState,
  id: ResidentId,
  title: unknown,
): Mutation | Rejection | undefined {
  if (title === undefined) return undefined;
  const progress = state.progress;
  const now = titleOf(state, id) ?? null;
  if (title !== null) {
    if (!isOneOf(TITLES, title)) return refuse("invalid_profile", "Unknown title.");
    const { label, skill, level } = TITLE_INFO[title as Title];
    // Before levels open every skill is at level 1, so this refuses every title then too.
    const mine = levelsOf(state, id).skills[skill];
    if (mine < level) {
      return refuse(
        "not_earned",
        `${label} comes with ${skillName(skill)} ${level}, and you're at ${skillName(skill)} ${mine}.`,
      );
    }
  }
  if (title === now || !progress) return undefined;
  return () => {
    const titles = { ...(progress.titles ?? {}) };
    if (title === null) delete titles[id];
    else titles[id] = title as Title;
    if (Object.keys(titles).length > 0) progress.titles = titles;
    else delete progress.titles;
    return [{ type: "title_changed", residentId: id, title: title as Title | null }];
  };
}

/**
 * The first earned garment in `wear` whose skill level the resident hasn't reached, as a
 * `not_earned` rejection, or null. `join` and `profile` call it for everything in a wear list.
 */
export function unearnedWear(
  state: WorldState,
  id: ResidentId,
  wear: readonly unknown[],
): Rejection | null {
  // Before levels open every skill is at level 1, so every earned garment is refused then too.
  const levels = levelsOf(state, id).skills;
  for (const item of wear) {
    if (!isEarnedWear(item)) continue;
    const skill = EARNED_WEAR_SKILL[item];
    if (levels[skill] >= UNLOCKS.wear) continue;
    return refuse(
      "not_earned",
      `That's earned at ${skillName(skill)} ${UNLOCKS.wear}, and you're at ${skillName(skill)} ${levels[skill]}.`,
    );
  }
  return null;
}

// ---------- server inputs ----------

/**
 * Why `open_levels`'s one-time credit can't be taken, or null: a list of `{resident, kinds}`, each
 * resident in the world, not townsfolk, and named once, each with at least one kind, every kind
 * one a first counts (`firstSkill`) and named once.
 */
function creditProblem(state: WorldState, firsts: unknown): Rejection | null {
  if (!Array.isArray(firsts)) {
    return refuse("unknown_resident", "The credit is a list of residents with their kinds.");
  }
  const named = new Set<string>();
  for (const entry of firsts as unknown[]) {
    const { resident, kinds } = (entry ?? {}) as { resident?: unknown; kinds?: unknown };
    if (typeof resident !== "string" || !residentById(state, resident)) {
      return refuse("unknown_resident", "The credit names someone who isn't a resident.");
    }
    if (named.has(resident)) {
      return refuse("unknown_resident", "The credit names each resident once.");
    }
    named.add(resident);
    if (isTownsfolk(state, resident)) {
      return refuse("not_eligible", "Townsfolk never earn points, so the credit leaves them out.");
    }
    if (!Array.isArray(kinds) || kinds.length === 0) {
      return refuse("unknown_item", "The credit lists at least one kind for each resident.");
    }
    if (kinds.some((kind) => firstSkill(kind) === undefined)) {
      return refuse(
        "unknown_item",
        "The credit names only kinds a first counts: crops, made kinds, finds, and fish.",
      );
    }
    if (new Set(kinds).size !== kinds.length) {
      return refuse("unknown_item", "The credit names each of a resident's kinds once.");
    }
  }
  return null;
}

/**
 * `open_levels {firsts}`, which only TOWN_ACTOR sends, once: from now on deeds earn points. It
 * needs growing, making, and gathering open. `firsts` is the one-time credit for what residents
 * did before (RFC 0029, section 12): each kind listed is worth a first's points in its skill and
 * goes in that resident's firsts, so doing it again later is no first. The credit counts toward
 * no day's cap and no season.
 */
export function checkOpenLevels(
  state: WorldState,
  command: Extract<Command, { type: "open_levels" }>,
): Mutation | Rejection {
  const { firsts } = command;
  const open = oneTimeSwitch({
    on: state.progress,
    already: "Levels are already open.",
    // Items open only once the world counts days, so with items there's a day.
    notYet: () =>
      state.items
        ? creditProblem(state, firsts)
        : refuse("not_due", "Levels open once growing, making, and gathering are open."),
    turnOn: () => {
      state.progress = { opened: state.day as number, points: {}, firsts: {} };
    },
    event: { type: "levels_opened" },
  });
  if (typeof open !== "function") return open;
  return () => {
    const events = open();
    const progress = state.progress as ProgressState;
    for (const { resident, kinds } of firsts) {
      const gains: Gain[] = [];
      for (const skill of SKILLS) {
        const mine = kinds.filter((kind) => firstSkill(kind) === skill).sort();
        if (mine.length > 0) {
          gains.push({ skill, points: mine.length * PROGRESS.first, counted: 0, firsts: mine });
        }
      }
      events.push(...addPoints(progress, resident, gains));
    }
    return events;
  };
}

/**
 * `credit_event {event, guests}`, which only TOWN_ACTOR sends: Hosting points for an event that
 * ended. The server counts guests (ages, blocks, and two hosts a day are its to know) and sends
 * the list; the sim takes it only if every guest attended by its own samples (`event_end` kept
 * them in `attended`, which never holds the host), none is in the host's household or townsfolk,
 * and none is named twice. So a wrong list can leave a guest out and never add one. An event is
 * credited once, and only one that ended on or after the day levels opened (`progress.opened`).
 *
 * The host earns `PROGRESS.guest` a guest, for one event a UTC day, and each guest
 * `PROGRESS.attend`, once a UTC day, both under Hosting's daily cap. Who was counted today is in
 * `progress.hostedToday` and `guestToday`, written only when points were added. A town event has
 * no host to earn.
 */
export function checkCreditEvent(
  state: WorldState,
  command: Extract<Command, { type: "credit_event" }>,
): Mutation | Rejection {
  const progress = state.progress;
  if (!progress) return refuse("not_due", "Levels aren't open in this world yet.");
  const e = findEvent(state, command.event);
  if (!e) return refuse("unknown_event", "No event has that id.");
  if (e.status !== "ended") return refuse("not_due", `${e.id} hasn't ended.`);
  if ((e.closedDay ?? 0) < progress.opened) {
    return refuse(
      "not_eligible",
      `${e.id} ended before levels opened, so it earns nobody anything.`,
    );
  }
  if (e.credited) return refuse("already_set", `${e.id}'s guests were already counted.`);
  const { guests } = command;
  if (!Array.isArray(guests) || !guests.every((id) => typeof id === "string")) {
    return refuse("invalid_event", "List the guests by id.");
  }
  if (new Set(guests).size !== guests.length) {
    return refuse("invalid_event", "List each guest once.");
  }
  const attended = e.attended ?? [];
  for (const id of guests) {
    if (!attended.includes(id)) {
      return refuse("not_eligible", "A listed guest didn't attend by the event's own samples.");
    }
    if (sameHousehold(state, e.host, id)) {
      return refuse("not_eligible", "A listed guest is in the host's household.");
    }
    if (isTownsfolk(state, id)) {
      return refuse("not_eligible", "Townsfolk are never counted guests.");
    }
  }
  const host =
    guests.length > 0 && !progress.hostedToday?.includes(e.host)
      ? earning(state, e.host, [{ skill: "hosting", points: guests.length * PROGRESS.guest }])
      : null;
  const came = guests.flatMap((id) => {
    if (progress.guestToday?.includes(id)) return [];
    const points = earning(state, id, [{ skill: "hosting", points: PROGRESS.attend }]);
    return points ? [{ id, points }] : [];
  });
  return () => {
    e.credited = true;
    const events: WorldEvent[] = [{ type: "event_credited", event: e.id, guests: [...guests] }];
    if (host) {
      events.push(...host());
      progress.hostedToday = [...(progress.hostedToday ?? []), e.host].sort();
    }
    for (const { id, points } of came) {
      events.push(...points());
      progress.guestToday = [...(progress.guestToday ?? []), id].sort();
    }
    return events;
  };
}

/** At `new_day`: today's counts toward each skill's cap, and who an event counted, start again. */
export function levelsNewDay(state: WorldState): Mutation | null {
  const progress = state.progress;
  if (!progress?.today && !progress?.hostedToday && !progress?.guestToday) return null;
  return () => {
    delete progress.today;
    delete progress.hostedToday;
    delete progress.guestToday;
    return [];
  };
}

/** `list` without `id`, or undefined when that leaves it empty. */
const without = (list: readonly ResidentId[] | undefined, id: ResidentId) => {
  const rest = (list ?? []).filter((other) => other !== id);
  return rest.length > 0 ? rest : undefined;
};

/**
 * What `merge_resident` does to levels: `from`'s points join `into`'s skill by skill, with a
 * private `progress` for each and a `level_reached` where a level went up, their firsts are joined,
 * and `from`'s points in each season move too. What only counts toward a day or a week (today's
 * counts, who an event counted, the bounty week's entry) and the title `from` showed are dropped.
 */
export function mergeProgress(state: WorldState, from: ResidentId, into: ResidentId): WorldEvent[] {
  const progress = state.progress;
  if (!progress) return [];
  const theirs = own(progress.points, from) ?? {};
  const had = own(progress.firsts, into) ?? [];
  const news = (own(progress.firsts, from) ?? []).filter((kind) => !had.includes(kind));
  const gains: Gain[] = [];
  for (const skill of SKILLS) {
    const points = theirs[skill] ?? 0;
    const firsts = news.filter((kind) => firstSkill(kind) === skill);
    if (points > 0 || firsts.length > 0) gains.push({ skill, points, counted: 0, firsts });
  }
  delete progress.points[from];
  delete progress.firsts[from];
  const events = gains.length > 0 ? addPoints(progress, into, gains) : [];
  for (const board of Object.values(progress.seasons ?? {})) {
    const moved = own(board, from);
    if (!moved) continue;
    delete board[from];
    const mine = { ...(own(board, into) ?? {}) };
    for (const skill of SKILLS) {
      if (moved[skill]) mine[skill] = (mine[skill] ?? 0) + moved[skill];
    }
    board[into] = mine;
  }
  if (progress.today && Object.hasOwn(progress.today, from)) {
    delete progress.today[from];
    if (Object.keys(progress.today).length === 0) delete progress.today;
  }
  for (const key of ["hostedToday", "guestToday"] as const) {
    const rest = without(progress[key], from);
    if (rest) progress[key] = rest;
    else delete progress[key];
  }
  if (progress.week && Object.hasOwn(progress.week.bounties, from)) {
    delete progress.week.bounties[from];
  }
  if (progress.titles && Object.hasOwn(progress.titles, from)) {
    delete progress.titles[from];
    if (Object.keys(progress.titles).length === 0) delete progress.titles;
  }
  return events;
}
