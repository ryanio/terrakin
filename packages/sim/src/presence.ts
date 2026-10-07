import { oneTimeSwitch, refuse } from "./check";
import { residentById } from "./own";
import type { Command, Rejection, Resident, WorldEvent, WorldState } from "./types";

/**
 * Presence that comes with acting (RFC 0014, step 4). Once the server logs `implicit_presence`, a
 * known resident's command while they're offline brings them back in the same input (`prepare` in
 * `apply.ts` does it, with `join`'s own rules), and `leave_idle` takes everyone the server's idle
 * sweep found in one input. A check-in then logs one input instead of `join`, the action, and
 * `leave`. Before the switch nothing here runs, so older logs replay as they did.
 */

type Mutation = () => WorldEvent[];
export type PresenceChecked = Mutation | Rejection;

/** `implicit_presence`, from TOWN_ACTOR: turn the rule on, once. */
export function checkImplicitPresence(state: WorldState): PresenceChecked {
  return oneTimeSwitch({
    on: state.implicitPresence,
    already: "Acting already brings residents back online.",
    turnOn: () => {
      state.implicitPresence = true;
    },
    event: { type: "implicit_presence_on" },
  });
}

/**
 * `leave_idle`, from TOWN_ACTOR: every resident in `ids` goes offline, as with `leave`. Each must
 * be a resident who is online, named once.
 */
export function checkLeaveIdle(
  state: WorldState,
  command: Extract<Command, { type: "leave_idle" }>,
): PresenceChecked {
  const { ids } = command;
  if (!Array.isArray(ids) || ids.length === 0) {
    return refuse("unknown_resident", "Name at least one resident to take offline.");
  }
  if (new Set(ids).size !== ids.length) {
    return refuse("unknown_resident", "Name each resident once.");
  }
  const going: Resident[] = [];
  for (const id of ids) {
    const r = residentById(state, id);
    if (!r) return refuse("unknown_resident", `There's no resident ${String(id)}.`);
    if (!r.online) return refuse("not_joined", `${r.id} is already offline.`);
    going.push(r);
  }
  return () =>
    going.map((r) => {
      r.online = false;
      return { type: "left", residentId: r.id };
    });
}
