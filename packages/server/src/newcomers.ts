import {
  NEWCOMER_WEEKS,
  type NewcomerCohort,
  type NewcomerCounts,
  type NewcomersResponse,
} from "@terrakin/protocol";
import {
  isTownsfolk,
  jobsDone,
  PANTRY_STAPLES,
  type Resident,
  STARTER_SEEDS,
  type WorldState,
  weekStart,
} from "@terrakin/sim";
import { plotNamed } from "./checkin-steps";
import { idsFrom, type SqlExec } from "./sql-store";
import { nameKey } from "./text";
import { dayString } from "./together";

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
  return idsFrom(sql, [
    "SELECT author FROM posts",
    "SELECT resident_id FROM reactions",
    "SELECT resident_id FROM reposts",
    "SELECT follower FROM follows",
    "SELECT sender FROM gestures WHERE putter = 0 AND routine = 0",
    "SELECT giver FROM praise",
    "SELECT sender FROM letters",
    "SELECT author FROM notices",
  ]);
}

/** Everyone holding a handle right now. One given up is released, so the name is free again. */
export function handleHolders(sql: SqlExec): Set<string> {
  return idsFrom(sql, ["SELECT resident_id FROM handles WHERE released_at = 0"]);
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
  handles: ReadonlySet<string>;
  /** Today, in UTC days since 1970-01-01. */
  today: number;
}

const noCounts = (): NewcomerCounts => ({
  joined: 0,
  claimed: 0,
  hearth: 0,
  thing: 0,
  plotName: 0,
  look: 0,
  social: 0,
  handle: 0,
  hearthAndThing: 0,
  pet: 0,
  job: 0,
  upstairs: 0,
  roof: 0,
});

const cohort = (week: string | null): NewcomerCohort => ({
  week,
  people: noCounts(),
  agents: noCounts(),
  sameName: 0,
});

const hasLook = (r: Resident) =>
  Boolean(r.theme || r.pattern || r.patternMedia || r.wear?.length || r.wearStyle || r.hair);

/**
 * Everyone a plot counts for, read in one pass: who holds one at all, who holds one with a floor
 * above the ground floor, and who holds one with a roof up. Each is owners and co-owners alike,
 * the sim's own `canBuildOn`, so a co-owner counts for a plot someone else paid to raise.
 */
interface PlotHolders {
  any: ReadonlySet<string>;
  upstairs: ReadonlySet<string>;
  roof: ReadonlySet<string>;
}

/** Which steps one resident reached, by the cheapest honest source for each. */
function stepsOf(r: Resident, s: NewcomerSources, plots: PlotHolders) {
  const done = s.done(r.id);
  const did = (kinds: readonly string[]) => kinds.some((k) => done.has(k));
  const hearth = r.hearth !== null || done.has("set_hearth");
  const thing = did(THING_COMMANDS) || s.things.has(r.id);
  return {
    claimed: plots.any.has(r.id) || did(CLAIM_COMMANDS),
    hearth,
    thing,
    hearthAndThing: hearth && thing,
    // The check-in's own rule for the `plot_name` step, so the page and the step agree.
    plotName: plotNamed(s.state, r.id, done),
    look: hasLook(r),
    social: s.social.has(r.id),
    handle: s.handles.has(r.id),
    pet: r.pet !== undefined || done.has("adopt_pet"),
    // A finished job's count can sit on a record the job was merged into, whose own log never
    // took one, so the sim's count counts beside the command (decision 0276).
    job: jobsDone(s.state, r.id) > 0 || done.has("take_job"),
    // The 200 coins an upstairs costs (RFC 0028), and the roof it gave the town to look at
    // (RFC 0041). Both read the world first, like `claimed` and `plotName`, and fall back to the
    // command, so a floor or a roof on a plot since released or taken down still counts.
    upstairs: plots.upstairs.has(r.id) || done.has("add_floor"),
    roof: plots.roof.has(r.id) || done.has("set_roof"),
  };
}

/**
 * Every step but `joined`, read off what `stepsOf` returned rather than a list kept beside it: a
 * step this list forgot would count zero and look like a real answer.
 */
function add(counts: NewcomerCounts, steps: ReturnType<typeof stepsOf>) {
  counts.joined++;
  for (const [key, reached] of Object.entries(steps) as [keyof typeof steps, boolean][]) {
    if (reached) counts[key]++;
  }
}

/** The funnel: the last `NEWCOMER_WEEKS` weeks, newest first, and all time. */
export function newcomerFunnel(s: NewcomerSources): NewcomersResponse {
  const { state } = s;
  const plots: { [K in keyof PlotHolders]: Set<string> } = {
    any: new Set(),
    upstairs: new Set(),
    roof: new Set(),
  };
  for (const plot of Object.values(state.plots)) {
    // `floors` is absent at 0 and `roof` while the home has none, which is what every plot looked
    // like before either shipped (the sim's `Plot`).
    const sets = [plots.any];
    if (plot.floors) sets.push(plots.upstairs);
    if (plot.roof) sets.push(plots.roof);
    for (const set of sets) {
      set.add(plot.ownerId);
      for (const id of plot.coOwners ?? []) set.add(id);
    }
  }
  const thisWeek = weekStart(s.today);
  const weeks = Array.from({ length: NEWCOMER_WEEKS }, (_, i) =>
    cohort(dayString(thisWeek - 7 * i)),
  );
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
    const steps = stepsOf(r, s, plots);
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
  return { today: dayString(s.today), weeks, allTime, undated };
}
