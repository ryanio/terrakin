import {
  NEWCOMER_WEEKS,
  type NewcomerCohort,
  type NewcomerCounts,
  type NewcomersResponse,
} from "@terrakin/protocol";
import {
  isTownsfolk,
  PANTRY_STAPLES,
  type Resident,
  STARTER_SEEDS,
  type WorldState,
} from "@terrakin/sim";
import type { SqlExec } from "./sql-store";
import { nameKey } from "./text";

/**
 * The newcomer funnel behind `GET /v1/admin/newcomers` (decision 0141): for each UTC week of
 * joins, how many people and AIs reached each first step. It reads only what the server already
 * keeps: the world, `LogFacts` (each resident's join day and the command kinds they've had
 * accepted), the collection book, and the social tables. Townsfolk are left out.
 */

/** Commands that bring a resident a thing by their own hand. */
const THING_COMMANDS = ["plant", "harvest", "gather", "fish", "craft", "make_piece"];
const CLAIM_COMMANDS = ["claim", "settle"];
/** What the pantry hands everyone with a hearth, so holding it says nothing about the step. */
const PANTRY_KINDS: readonly string[] = [...STARTER_SEEDS, ...PANTRY_STAPLES];

/**
 * Everyone who has done something social: posted or replied, reacted, reposted, followed, sent a
 * gesture, praised, written a letter, or put up a notice. Hidden posts count; the act happened. The
 * waves a putter or a routine sends by itself don't.
 */
export function socialActors(sql: SqlExec): Set<string> {
  const rows = sql.exec(
    `SELECT author AS id FROM posts
     UNION SELECT resident_id FROM reactions
     UNION SELECT resident_id FROM reposts
     UNION SELECT follower FROM follows
     UNION SELECT sender FROM gestures WHERE putter = 0 AND routine = 0
     UNION SELECT giver FROM praise
     UNION SELECT sender FROM letters
     UNION SELECT author FROM notices`,
  );
  return new Set([...rows].map((r) => String(r.id)));
}

/**
 * Everyone the collection book shows holding a kind of thing the pantry doesn't hand out: a gift,
 * a buy, a harvest, a catch.
 */
export function thingHolders(sql: SqlExec): Set<string> {
  const rows = sql.exec(
    `SELECT DISTINCT resident FROM collection WHERE shelf = 'thing' AND kind NOT IN (${PANTRY_KINDS.map(() => "?").join(", ")})`,
    ...PANTRY_KINDS,
  );
  return new Set([...rows].map((r) => String(r.resident)));
}

interface NewcomerSources {
  state: WorldState;
  /** Each resident's first join day, in the order they first joined (the log's). */
  joinedDay: ReadonlyMap<string, number>;
  /** The command kinds a resident has had accepted, ever. */
  done: (id: string) => ReadonlySet<string>;
  social: ReadonlySet<string>;
  things: ReadonlySet<string>;
  /** Today, in UTC days since 1970-01-01. */
  today: number;
}

/** The Monday that starts the UTC week holding `day` (1970-01-01 was a Thursday). */
export const weekStart = (day: number) => day - ((((day + 3) % 7) + 7) % 7);

const isoDay = (day: number) => new Date(day * 86_400_000).toISOString().slice(0, 10);

const noCounts = (): NewcomerCounts => ({
  joined: 0,
  claimed: 0,
  hearth: 0,
  thing: 0,
  look: 0,
  social: 0,
  pet: 0,
});

const cohort = (week: string | null): NewcomerCohort => ({
  week,
  people: noCounts(),
  agents: noCounts(),
  sameName: 0,
});

const hasLook = (r: Resident) =>
  Boolean(r.theme || r.pattern || r.patternMedia || r.wear?.length || r.wearStyle || r.hair);

/** Which steps one resident reached, by the cheapest honest source for each. */
function stepsOf(r: Resident, s: NewcomerSources, plotHolders: ReadonlySet<string>) {
  const done = s.done(r.id);
  const did = (kinds: readonly string[]) => kinds.some((k) => done.has(k));
  return {
    claimed: plotHolders.has(r.id) || did(CLAIM_COMMANDS),
    hearth: r.hearth !== null || done.has("set_hearth"),
    thing: did(THING_COMMANDS) || s.things.has(r.id),
    look: hasLook(r),
    social: s.social.has(r.id),
    pet: r.pet !== undefined || done.has("adopt_pet"),
  };
}

function add(counts: NewcomerCounts, steps: ReturnType<typeof stepsOf>) {
  counts.joined++;
  for (const key of ["claimed", "hearth", "thing", "look", "social", "pet"] as const) {
    if (steps[key]) counts[key]++;
  }
}

/** The funnel: the last `NEWCOMER_WEEKS` weeks, newest first, and all time. */
export function newcomerFunnel(s: NewcomerSources): NewcomersResponse {
  const { state } = s;
  const plotHolders = new Set<string>();
  for (const plot of Object.values(state.plots)) {
    plotHolders.add(plot.ownerId);
    for (const id of plot.coOwners ?? []) plotHolders.add(id);
  }
  const thisWeek = weekStart(s.today);
  const weeks = Array.from({ length: NEWCOMER_WEEKS }, (_, i) => cohort(isoDay(thisWeek - 7 * i)));
  const allTime = cohort(null);
  let undated = 0;
  // Residents the join days miss (none should) come last, as if they joined most recently.
  const order = [
    ...s.joinedDay.keys(),
    ...Object.keys(state.residents).filter((id) => !s.joinedDay.has(id)),
  ];
  const names = new Set<string>();
  for (const id of order) {
    const r = state.residents[id];
    if (!r || isTownsfolk(state, id)) continue;
    const steps = stepsOf(r, s, plotHolders);
    const side = r.kind === "human" ? "people" : "agents";
    const name = nameKey(r.name);
    const repeat = names.has(name);
    names.add(name);
    const day = s.joinedDay.get(id);
    // Day 0 is a join from before the world counted days.
    const week = day ? weeks[(thisWeek - weekStart(day)) / 7] : undefined;
    if (!day) undated++;
    for (const c of week ? [week, allTime] : [allTime]) {
      add(c[side], steps);
      if (repeat) c.sameName++;
    }
  }
  return { today: isoDay(s.today), weeks, allTime, undated };
}
