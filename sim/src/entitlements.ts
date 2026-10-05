/**
 * Partner wear (RFC 0007 phase 3). Some wear is a partner's exclusive: only residents the server
 * entitled may put it on. The server works out who from its partner config and the server clock
 * (a link made or ended, a promo starting or ending) and logs `set_entitlements` as `TOWN_ACTOR`,
 * so replay never needs the chain or the clock. Worlds that never log one hash as before.
 *
 * Cosmetic only: an entitlement lets a resident wear something, and nothing else. It isn't in
 * their things, so it can't be given, sold, or listed.
 */

import { refuse } from "./check";
import { type ExclusiveWear, isExclusiveWear, lookOf, sortWear, type WearItem } from "./looks";
import type { Command, Rejection, ResidentId, WorldEvent, WorldState } from "./types";

/** The longest list `set_entitlements` takes, repeats included. */
export const MAX_ENTITLEMENT_LIST = 16;

/** The partner wear a resident may put on now. */
export const entitledTo = (state: WorldState, residentId: ResidentId): readonly ExclusiveWear[] =>
  state.entitlements?.[residentId] ?? [];

/** The first partner piece in `wear` the resident may not put on, or undefined. */
export function unentitled(
  state: WorldState,
  residentId: ResidentId,
  wear: readonly unknown[],
): ExclusiveWear | undefined {
  const mine = entitledTo(state, residentId);
  return wear.find((w): w is ExclusiveWear => isExclusiveWear(w) && !mine.includes(w));
}

type Mutation = () => WorldEvent[];

/**
 * `set_entitlements {residentId, items}`: replace a resident's list. Partner wear they have on and
 * no longer may wear comes off in the same input, with a `profile_changed` so clients redraw them.
 */
export function checkSetEntitlements(
  state: WorldState,
  command: Extract<Command, { type: "set_entitlements" }>,
): Mutation | Rejection {
  const { residentId, items } = command;
  if (typeof residentId !== "string" || residentId === "") {
    return refuse("unknown_resident", "Entitlements name a resident.");
  }
  if (!Array.isArray(items) || items.length > MAX_ENTITLEMENT_LIST) {
    return refuse("unknown_item", "Entitlements are a short list of partner wear.");
  }
  const bad = items.find((w) => !isExclusiveWear(w));
  if (bad !== undefined) return refuse("unknown_item", "Only partner wear takes an entitlement.");
  const next = [...new Set(items as ExclusiveWear[])].sort();
  const now = entitledTo(state, residentId);
  if (next.join(",") === [...now].join(",")) {
    return refuse("already_have", "They already have exactly these.");
  }
  const r = state.residents[residentId];
  const keep = (r?.wear ?? []).filter((w: WearItem) => !isExclusiveWear(w) || next.includes(w));
  const strip = r?.wear !== undefined && keep.length !== r.wear.length;
  return () => {
    const all = { ...(state.entitlements ?? {}) };
    if (next.length > 0) all[residentId] = next;
    else delete all[residentId];
    if (Object.keys(all).length > 0) state.entitlements = all;
    else delete state.entitlements;
    const events: WorldEvent[] = [{ type: "entitlements_set", residentId, items: next }];
    if (r && strip) {
      if (keep.length > 0) r.wear = sortWear(keep);
      else delete r.wear;
      events.push({
        type: "profile_changed",
        residentId,
        color: r.color,
        shape: r.shape,
        note: r.note,
        ...lookOf(r),
      });
    }
    return events;
  };
}
