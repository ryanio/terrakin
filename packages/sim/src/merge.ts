import { isRunning } from "./bounties";
import type { StackKind } from "./catalog";
import { refuse } from "./check";
import { isMaintainer, isTownsfolk, movePurse } from "./economy";
import { plotHasAnything } from "./floors";
import { activeTables } from "./games";
import { addStack, ITEMS, inventory, inventoryEvent, inventorySize } from "./items";
import { plotKey } from "./keys";
import { mergeProgress } from "./levels";
import { own, residentById } from "./own";
import { knownRecipes } from "./recipes";
import type { Rejection, ResidentId, WorldEvent, WorldState } from "./types";
import { plotsOwnedBy } from "./world";

/**
 * Merging a duplicate record into the one that stays (issue #46, decision 0239). Before names were
 * unique (decision 0148) one resident could end up with several records, and a few of those were
 * used, so `retire_repeat_joins` kept them. `merge_resident {from, into}`, which only TOWN_ACTOR
 * sends and the server logs only on a maintainer's word, takes `from` out of the world for good:
 * its coins and things go to `into`, the plots it owns are released, and `join` refuses it from
 * then on.
 *
 * It moves what is the resident's own (coins, things, shop wear, learned recipes, having had the
 * welcome gift) and drops what only counts toward a day or a routine. Anything `from` is part of
 * with others while it runs (an owner link, a shared plot, a listing, a bounty, an event, a game, an
 * open proposal, something on display) refuses the merge, so a maintainer settles it first.
 * History that names `from` (ledger lines, finished games, closed proposals, a made thing's maker)
 * stays as it was.
 */

type Mutation = () => WorldEvent[];

/** Drop `id`'s entry from a record kept per resident, if it has one. */
function dropKey<T>(record: Record<string, T> | undefined, id: ResidentId) {
  if (record && Object.hasOwn(record, id)) delete record[id];
}

/** Why `from` can't be merged into `into` now, or null. */
function mergeProblem(state: WorldState, from: ResidentId, into: ResidentId): Rejection | null {
  const dup = residentById(state, from);
  const kept = residentById(state, into);
  if (!dup) return refuse("unknown_resident", "The record to merge isn't a resident.");
  if (!kept) return refuse("unknown_resident", "The record to keep isn't a resident.");
  if (from === into) return refuse("not_eligible", "A record can't be merged into itself.");
  if (dup.kind !== kept.kind) {
    return refuse("not_eligible", "A person and an AI are never the same resident.");
  }
  if (isTownsfolk(state, from) || isTownsfolk(state, into)) {
    return refuse("not_eligible", "Townsfolk records are never merged.");
  }
  if (dup.online) return refuse("not_eligible", "The record to merge is in the world right now.");
  if (dup.pet) return refuse("not_eligible", "The record to merge has a pet.");
  if (isMaintainer(state, from))
    return refuse("not_eligible", "The record to merge is a maintainer.");
  if (state.ownerPairs?.some((pair) => pair.includes(from))) {
    return refuse("not_eligible", "The record to merge is in an owner link. Unlink it first.");
  }
  for (const plot of Object.values(state.plots)) {
    if (plot.coOwners?.includes(from)) {
      return refuse("not_eligible", "The record to merge shares someone else's plot.");
    }
    if (plot.ownerId !== from) continue;
    if ((plot.coOwners?.length ?? 0) > 0) {
      return refuse("not_eligible", "The record to merge shares its plot with someone.");
    }
    // Every floor (RFC 0028), the ground floor's blocks and paths included.
    if (plotHasAnything(state, plot.px, plot.py)) {
      return refuse(
        "plot_has_blocks",
        "The record to merge has blocks or paths on its plot. Its plot is released only empty.",
      );
    }
  }
  if (Object.values(state.market?.listings ?? {}).some((l) => l.seller === from)) {
    return refuse("not_eligible", "The record to merge has a lot in the market.");
  }
  if (
    state.bounties?.list.some((b) => isRunning(b) && (b.poster === from || b.claimant === from))
  ) {
    return refuse("not_eligible", "The record to merge has a bounty running.");
  }
  if (
    state.events?.list.some(
      (e) => e.host === from && (e.status === "scheduled" || e.status === "live"),
    )
  ) {
    return refuse("not_eligible", "The record to merge is hosting an event.");
  }
  if (activeTables(state).some((t) => t.seats.some((s) => s.resident === from))) {
    return refuse("not_eligible", "The record to merge has a seat at a game table.");
  }
  if (
    state.town?.proposals.some(
      (p) => (p.status === "queued" || p.status === "open") && (p.author === from || p.to === from),
    )
  ) {
    return refuse("not_eligible", "The record to merge is named in an open proposal.");
  }
  const items = state.items;
  if (
    Object.values(items?.displays ?? {}).some((d) => d.by === from) ||
    items?.heldAside?.some((d) => d.by === from)
  ) {
    return refuse("not_eligible", "The record to merge has something on display or held aside.");
  }
  if (
    items &&
    inventorySize(items.inventories[from]) + inventorySize(items.inventories[into]) >
      ITEMS.inventoryMax
  ) {
    return refuse(
      "inventory_full",
      `The record to keep hasn't room for the duplicate's things: a resident holds at most ${ITEMS.inventoryMax}.`,
    );
  }
  return null;
}

/**
 * `merge_resident {from, into}` (decision 0239), which only TOWN_ACTOR sends: `from` leaves the
 * world for good. Its plots go back to the world (`plot_released`), its coins move to `into` with a
 * `merged` ledger line, its things too (an `inventory` with reason `merged`), its shop wear and
 * learned recipes join `into`'s, and having had the welcome gift carries over. Everyone sees
 * `resident_merged`. `state.mergedResidents` keeps `from` against `into` (absent until the first
 * merge) and `join` refuses `from` from then on.
 */
export function checkMergeResident(
  state: WorldState,
  command: { from: ResidentId; into: ResidentId },
): Mutation | Rejection {
  const { from, into } = command;
  const problem = mergeProblem(state, from, into);
  if (problem) return problem;
  const at = { seq: state.seq + 1, day: state.day ?? 0 };
  const released = plotsOwnedBy(state, from);
  const knew = new Set(knownRecipes(state, into));
  return () => {
    const events: WorldEvent[] = [];
    for (const plot of released) {
      delete state.plots[plotKey(plot.px, plot.py)];
      events.push({ type: "plot_released", px: plot.px, py: plot.py, ownerId: from });
    }
    const econ = state.economy;
    if (econ) {
      const coins = econ.coins[from] ?? 0;
      delete econ.coins[from];
      delete econ.ledgers[from];
      if (coins > 0) events.push(movePurse(econ, into, coins, "merged", at));
      dropKey(econ.allowance, from);
      // One welcome gift for the merged resident: a duplicate that had it means `into` never
      // waits for one, and a gift owed only to the duplicate isn't paid twice.
      const welcomed = econ.welcomed.includes(from);
      if (welcomed) {
        econ.welcomed = [...new Set([...econ.welcomed.filter((id) => id !== from), into])].sort();
      }
      econ.owed = econ.owed.filter((id) => id !== from && !(welcomed && id === into));
      dropKey(econ.today.given, from);
      dropKey(econ.today.received, from);
      dropKey(econ.today.fromTownsfolk, from);
      econ.today.newcomers = econ.today.newcomers.filter((id) => id !== from);
    }
    const items = state.items;
    if (items) {
      const theirs = own(items.inventories, from);
      delete items.inventories[from];
      const stacks = Object.entries(theirs?.stacks ?? {}) as [StackKind, number][];
      const goods = theirs?.goods ?? [];
      if (stacks.length > 0 || goods.length > 0) {
        const inv = inventory(items, into);
        const changes = stacks.map(([kind, count]) => addStack(inv, kind, count));
        inv.goods.push(...goods);
        events.push(inventoryEvent(into, "merged", changes, { gained: goods }));
      }
      dropKey(items.pantry, from);
      for (const counts of Object.values(items.today)) dropKey(counts, from);
      for (const [id, gift] of Object.entries(items.gifts ?? {})) {
        if (gift.from === from || gift.to === from) delete items.gifts?.[id];
      }
    }
    const shop = state.shop;
    if (shop) {
      const wear = own(shop.wardrobe, from) ?? [];
      delete shop.wardrobe[from];
      const had = own(shop.wardrobe, into) ?? [];
      const gained = wear.filter((w) => !had.includes(w));
      if (gained.length > 0) shop.wardrobe[into] = [...had, ...gained].sort();
      for (const w of gained) events.push({ type: "wear_bought", residentId: into, wear: w });
      dropKey(shop.today.sold, from);
    }
    const recipes = state.recipes;
    if (recipes) {
      const learned = own(recipes.learned, from);
      delete recipes.learned[from];
      if (learned?.length) {
        recipes.learned[into] = [
          ...new Set([...(own(recipes.learned, into) ?? []), ...learned]),
        ].sort();
      }
      if (recipes.everything.includes(from)) {
        recipes.everything = [
          ...new Set([...recipes.everything.filter((id) => id !== from), into]),
        ].sort();
      }
      dropKey(recipes.picks, from);
      dropKey(recipes.townsfolkTaught, from);
      for (const recipe of knownRecipes(state, into)) {
        if (!knew.has(recipe)) {
          events.push({ type: "recipe_learned", residentId: into, recipe, how: "merged" });
        }
      }
    }
    // Levels (RFC 0029): points and firsts are the resident's own, so they move.
    events.push(...mergeProgress(state, from, into));
    for (const ladder of Object.values(state.games?.ratings ?? {})) dropKey(ladder, from);
    dropKey(state.games?.today.rated, from);
    dropKey(state.knocks?.by, from);
    dropKey(state.lastActiveDay, from);
    dropKey(state.routines, from);
    dropKey(state.routineRuns, from);
    dropKey(state.entitlements, from);
    delete state.residents[from];
    state.mergedResidents ??= {};
    // A record merged earlier into this one now points at the one that stays.
    for (const [gone, kept] of Object.entries(state.mergedResidents)) {
      if (kept === from) state.mergedResidents[gone] = into;
    }
    state.mergedResidents[from] = into;
    events.push({ type: "resident_merged", from, into });
    return events;
  };
}

/** The record `id` was merged into, if `merge_resident` took it out of the world. */
export const mergedInto = (state: WorldState, id: ResidentId): ResidentId | undefined =>
  own(state.mergedResidents, id);
