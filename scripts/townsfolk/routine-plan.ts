/**
 * Whether one townsfolk resident's routines (RFC 0009) need setting, from the list
 * `GET /v1/routines` answers with. Pure, so the tests feed it fixtures; seed.ts does the reading and
 * the writing.
 */
import type { Action, RoutineView } from "../../packages/protocol/src/index";

export type SetRoutinesAction = Extract<Action, { type: "set_routines" }>;

/** What a routines step should do. */
export type RoutinesStep =
  /** They have exactly the persona's routines on. Nothing to send. */
  | { kind: "done"; routines: RoutineView[] }
  /** Send `action`, the persona's whole list. `from` is what they have on now. */
  | { kind: "set"; from: RoutineView[]; want: RoutineView[]; action: SetRoutinesAction };

/** A routine's one setting: its UTC hour, or how many residents a day it waves at. */
const setting = (r: RoutineView) => (r.kind === "greet" ? r.max : r.hour);

/**
 * `want` is the persona's list and `current` the server's. The server keeps at most one routine of
 * each kind, in its own order, so the two match when every wanted routine is on with the same
 * setting and nothing else is. `set_routines` replaces the whole list, so that is what it sends;
 * sending the list they already have would only be refused (`already_set`).
 */
export function planRoutines(
  want: readonly RoutineView[],
  current: readonly RoutineView[],
): RoutinesStep {
  const on = (w: RoutineView) =>
    current.some((c) => c.kind === w.kind && setting(c) === setting(w));
  if (want.length === current.length && want.every(on)) {
    return { kind: "done", routines: [...current] };
  }
  return {
    kind: "set",
    from: [...current],
    want: [...want],
    action: { type: "set_routines", routines: [...want] },
  };
}

/** Routines in plain words: "walk home at 18:00 UTC, wave at up to 3 passers-by a day". */
export function describeRoutines(list: readonly RoutineView[]): string {
  if (list.length === 0) return "none";
  return list
    .map((r) =>
      r.kind === "greet"
        ? `wave at up to ${r.max} passers-by a day`
        : `${r.kind === "walk_home" ? "walk home" : "stroll"} at ${String(r.hour).padStart(2, "0")}:00 UTC`,
    )
    .join(", ");
}

/** One line for the run's output. */
export function describeRoutinesStep(step: RoutinesStep, send: boolean): string {
  if (step.kind === "done") return `routines already set: ${describeRoutines(step.routines)}`;
  return `routines: ${describeRoutines(step.from)} now, ${send ? "setting" : "would set"} ${describeRoutines(step.want)}`;
}
