import { oneTimeSwitch, refuse } from "./check";
import { isTownsfolk } from "./economy";
import { residentById } from "./own";
import type { Rejection, ResidentId, WorldEvent, WorldState } from "./types";

/**
 * Clearing the old repeat joins (issue #46, decision 0230). Before names were unique at join
 * (decision 0148), one resident could end up with several records, most of them made by a fetcher
 * retrying a join link and never used. `retire_repeat_joins {ids}`, which only TOWN_ACTOR sends,
 * takes those records out of the world once. The server picks the ids; the sim takes only records
 * that are still untouched and still share a name and kind with a resident who stays, and refuses
 * the whole input otherwise, so a wrong list can't remove anyone who used their record.
 */

/** A name compared the way the sim can do it the same on every runtime: ASCII letters fold case. */
const folded = (name: string) => name.replace(/[A-Z]/g, (c) => c.toLowerCase());

/**
 * The world with every place a record may sit without having been used left out: the record
 * itself, a purse at 0 with no ledger, empty things, today's newcomers, and the residents who
 * knew every recipe when recipes opened. `retireProblem` checks the purse and things really are
 * empty.
 */
function withoutRecords(state: WorldState, ids: ReadonlySet<string>): WorldState {
  const keep = <T>(record: Record<string, T>) =>
    Object.fromEntries(Object.entries(record).filter(([id]) => !ids.has(id)));
  const { economy, items, recipes } = state;
  return {
    ...state,
    residents: keep(state.residents),
    ...(economy
      ? {
          economy: {
            ...economy,
            coins: keep(economy.coins),
            ledgers: keep(economy.ledgers),
            today: {
              ...economy.today,
              newcomers: economy.today.newcomers.filter((id) => !ids.has(id)),
            },
          },
        }
      : {}),
    ...(items ? { items: { ...items, inventories: keep(items.inventories) } } : {}),
    ...(recipes
      ? { recipes: { ...recipes, everything: recipes.everything.filter((id) => !ids.has(id)) } }
      : {}),
  };
}

/**
 * Why `id` can't be retired along with the rest of `retiring`, or null when it can: a record that
 * isn't a resident, or that someone used. Used means online, a hearth, a pet, coins or a ledger
 * line, anything in its things, or its id anywhere else in the world: a day it acted, the townsfolk
 * or maintainers list, a plot, an owner pair, a vote, a gift, an event, a routine, a table.
 * `mentioned` is the ids the rest of the world names. It also needs a resident who isn't
 * townsfolk, isn't being retired, and has the same name and kind (a person and an AI are never
 * repeats of each other), so a group of records always keeps one.
 */
function retireProblem(
  state: WorldState,
  id: ResidentId,
  retiring: ReadonlySet<string>,
  mentioned: ReadonlySet<string>,
): string | null {
  const r = residentById(state, id);
  if (!r) return "A listed record isn't a resident.";
  if (r.online || r.hearth !== null || r.pet)
    return "A listed record is in the world or has a home.";
  const econ = state.economy;
  if (econ && ((econ.coins[id] ?? 0) !== 0 || (econ.ledgers[id]?.length ?? 0) > 0)) {
    return "A listed record has had coins.";
  }
  const things = state.items?.inventories[id];
  if (things && (Object.keys(things.stacks).length > 0 || things.goods.length > 0)) {
    return "A listed record holds things.";
  }
  if (mentioned.has(id)) return "A listed record is named elsewhere in the world.";
  const name = folded(r.name);
  const namesake = Object.values(state.residents).some(
    (other) =>
      other.id !== id &&
      !retiring.has(other.id) &&
      !isTownsfolk(state, other.id) &&
      other.kind === r.kind &&
      folded(other.name) === name,
  );
  return namesake ? null : "Nobody of the same kind who stays has the name of a listed record.";
}

/**
 * Each id in `ids` that `retire_repeat_joins` would refuse, with why, in id order. Empty when the
 * whole list can go. The server leaves these out before it logs the list.
 */
export function retireProblems(
  state: WorldState,
  ids: readonly ResidentId[],
): { id: ResidentId; problem: string }[] {
  if (ids.length === 0) return [];
  const retiring = new Set(ids);
  const text = JSON.stringify(withoutRecords(state, retiring));
  const mentioned = new Set(ids.filter((id) => text.includes(JSON.stringify(id))));
  return [...retiring].sort().flatMap((id) => {
    const problem = retireProblem(state, id, retiring, mentioned);
    return problem === null ? [] : [{ id, problem }];
  });
}

/**
 * `retire_repeat_joins {ids}` (decision 0230), which only TOWN_ACTOR sends, once: every id leaves
 * the world, with its empty purse, its empty things, and its place among today's newcomers and
 * the residents who knew every recipe. Refused whole (`unknown_resident`, or `not_eligible` for a
 * record someone used) when any id doesn't qualify. `state.retiredRepeatJoins` keeps the ids,
 * sorted, and turns the switch off; `join` refuses them from then on.
 */
export function checkRetireRepeatJoins(
  state: WorldState,
  command: { ids: ResidentId[] },
): (() => WorldEvent[]) | Rejection {
  const { ids } = command;
  if (!Array.isArray(ids) || !ids.every((id) => typeof id === "string")) {
    return refuse("unknown_resident", "List the records to retire by id.");
  }
  const retiring = new Set(ids);
  if (retiring.size !== ids.length) {
    return refuse("unknown_resident", "List each record to retire once.");
  }
  const sorted = [...ids].sort();
  return oneTimeSwitch({
    on: state.retiredRepeatJoins,
    already: "The repeat joins were already retired in this world.",
    notYet: () => {
      const first = retireProblems(state, ids)[0];
      if (!first) return null;
      const code = residentById(state, first.id) ? "not_eligible" : "unknown_resident";
      return refuse(code, first.problem);
    },
    turnOn: () => {
      const { economy, items, recipes } = state;
      for (const id of sorted) {
        delete state.residents[id];
        if (economy) {
          delete economy.coins[id];
          delete economy.ledgers[id];
        }
        if (items) delete items.inventories[id];
      }
      if (economy) {
        economy.today.newcomers = economy.today.newcomers.filter((id) => !retiring.has(id));
      }
      if (recipes) recipes.everything = recipes.everything.filter((id) => !retiring.has(id));
      state.retiredRepeatJoins = sorted;
    },
    event: { type: "repeat_joins_retired", ids: sorted },
  });
}

/** Whether `id` is a record `retire_repeat_joins` took out of the world. */
export const isRetired = (state: WorldState, id: ResidentId): boolean =>
  state.retiredRepeatJoins?.includes(id) ?? false;
