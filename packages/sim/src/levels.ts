import { CROPS, FIND_KINDS, FISH_KINDS, FURNITURE_KINDS, GOOD_KINDS, SWEET_KINDS } from "./catalog";
import { oneTimeSwitch, refuse } from "./check";
import { isTownsfolk, sameHousehold } from "./economy";
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
  WorldEvent,
  WorldState,
} from "./types";
import { SKILLS } from "./types";

/**
 * Levels and skills (RFC 0029). A deed earns points in its skill, counted by the deed's own input:
 * a harvest, a craft, a find or a fish, a lesson, a paid bounty, a rated game. Each skill counts up
 * to `PROGRESS.dailyCap` points a UTC day, and the first time a resident harvests, makes, finds, or
 * catches a kind earns `PROGRESS.first` more, outside the cap. A level is read from points
 * (`levelOf`) and never stored, so it can't disagree with them.
 *
 * Points are not coins: nothing here mints, burns, or moves one. Nothing runs until the server
 * logs `open_levels`, which creates `state.progress`, so every older log replays as it was made.
 */

/**
 * The numbers. Once levels are open in a live world, changing one changes how logged inputs
 * replay, so it needs a logged switch.
 */
export const PROGRESS = {
  /** Points a skill counts in one UTC day. A deed past it still happens and adds none. */
  dailyCap: 20,
  /** The first harvest, craft, find, or catch of a kind, on top of the deed and outside the cap. */
  first: 10,
  /** Going from level n to n + 1 takes this many points times n. */
  step: 25,
  /** Growing: a harvest. */
  harvest: 2,
  /** Making: a craft, however many it makes. */
  craft: 2,
  /** Foraging: a find picked up, recipe pages included. Wood and stone earn nothing. */
  find: 4,
  /** Foraging: a fish caught. An old boot earns nothing. */
  fish: 2,
  /** Hosting: a lesson taught to a resident with a hearth, outside the teacher's household. */
  lesson: 4,
  /** Hosting: a bounty you were paid for. */
  bounty: 6,
  /** A resident's bounty counts only for a reward of at least this many coins. */
  bountyMinReward: 5,
  /** Playing: a rated game finished. */
  game: 2,
  /** Playing: finishing first in it, ties included, on top of `game`. */
  win: 2,
} as const;

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

/** What one skill gains from an input: points under the cap, and the kinds that were firsts. */
interface Gain {
  skill: Skill;
  counted: number;
  firsts: string[];
}

/**
 * Add `gains` to a resident's points and say so: a private `progress` for each skill, then a
 * public `level_reached` for each skill level, and for the resident's own level, that went up.
 * `season` is the season the points count in, absent for the one-time credit.
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
  for (const { skill, counted, firsts } of gains) {
    const added = counted + firsts.length * PROGRESS.first;
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
  if (level > levelOf(totalOf(before)))
    events.push({ type: "level_reached", residentId: id, level });
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
  if (!progress || state.day === undefined) return null;
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
    if (counted > 0 || firsts.length > 0) gains.push({ skill, counted, firsts });
  }
  if (gains.length === 0) return null;
  const season = String(seasonSpan(state.day).start);
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
  const monday = weekStart(state.day ?? 0);
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
 * Playing: a game that just ended with `places`. Each seat rated at `start_game` (decision 0096)
 * earns for finishing it, and more for finishing first, ties included. Other seats earn nothing.
 */
export function gameEarns(
  state: WorldState,
  table: GameTable,
  places: Readonly<Record<ResidentId, number>>,
): Mutation | null {
  const earnings = table.seats
    .filter((seat) => seat.rated)
    .map((seat) =>
      earning(state, seat.resident, [
        { skill: "playing", points: PROGRESS.game },
        ...(own(places, seat.resident) === 1
          ? [{ skill: "playing" as const, points: PROGRESS.win }]
          : []),
      ]),
    )
    .filter((e) => e !== null);
  return earnings.length > 0 ? () => earnings.flatMap((e) => e()) : null;
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
    notYet: () =>
      state.items && state.day !== undefined
        ? creditProblem(state, firsts)
        : refuse("not_due", "Levels open once growing, making, and gathering are open."),
    turnOn: () => {
      state.progress = { points: {}, firsts: {} };
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
        if (mine.length > 0) gains.push({ skill, counted: 0, firsts: mine });
      }
      events.push(...addPoints(progress, resident, gains));
    }
    return events;
  };
}

/** At `new_day`: today's counts toward each skill's cap start again. Null when there are none. */
export function levelsNewDay(state: WorldState): Mutation | null {
  const progress = state.progress;
  if (!progress?.today) return null;
  return () => {
    delete progress.today;
    return [];
  };
}
