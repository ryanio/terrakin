import { refuse } from "./check";
import { floorField } from "./floors";
import { isFurnitureKind } from "./furniture";
import { own } from "./own";
import type {
  BlockKind,
  Command,
  FloorLayer,
  Rejection,
  ResidentId,
  WorldEvent,
  WorldState,
} from "./types";

/**
 * Which way a piece of furniture faces. A piece is made facing south, its front to the bottom of
 * the map; `turn` turns it clockwise, seen from above, by 90, 180 or 270 degrees, as a design
 * turns: at 90 it faces west, at 180 north, at 270 east.
 *
 * A turn is a property of a placed piece, never a kind, and no rule reads it: walking, resting,
 * surfaces, costs and counts all read the kind. It's drawing only, kept in the world so every view
 * and every visitor sees a room the way its owner set it out.
 *
 * Facing south is never stored. Absent means 0 in state, commands, events and on the wire, so
 * every piece placed before turns faces as it always did and an old log hashes the same.
 */

export const TURNS = [0, 90, 180, 270] as const;
export type Turn = (typeof TURNS)[number];
/** A turn past facing south: the only turns ever written down. */
export type PastSouth = Exclude<Turn, 0>;

export const isTurn = (t: unknown): t is Turn => (TURNS as readonly unknown[]).includes(t);

/** Whether a block turns: every piece of furniture but the low stone wall, which joins its neighbours. */
export const isTurnable = (block: BlockKind | undefined): boolean =>
  isFurnitureKind(block) && block !== "stone_wall";

/** `turn` for an event or a snapshot: present only past facing south. */
export const turnField = (turn: Turn | undefined): { turn?: PastSouth } =>
  turn === undefined || turn === 0 ? {} : { turn };

const NO_TURNS: Readonly<Record<string, PastSouth>> = Object.freeze({});

/** The turned pieces on one floor, keyed by `tileKey`: the ground floor's for 0. */
function turnsOn(state: WorldState, floor: number): Readonly<Record<string, PastSouth>> {
  if (floor === 0) return state.turns ?? NO_TURNS;
  return own<FloorLayer>(state.floors, String(floor))?.turns ?? NO_TURNS;
}

/** Which way the piece at `key` on `floor` faces: 0 when it was never turned. */
export function turnAt(state: WorldState, key: string, floor = 0): Turn {
  const turns = turnsOn(state, floor);
  return Object.hasOwn(turns, key) ? (turns[key] as PastSouth) : 0;
}

/**
 * Write which way the piece at `key` on `floor` faces, in a commit: past 0 it's kept, 0 drops the
 * key, and a record left empty goes too, so a world with no turned pieces hashes as before.
 * Whatever puts a block down or takes one up calls this in the same commit.
 */
export function setTurn(state: WorldState, floor: number, key: string, turn: Turn) {
  const layer: { turns?: Record<string, PastSouth> } | undefined =
    floor === 0 ? state : state.floors?.[String(floor)];
  if (turn === 0) {
    if (!layer?.turns || !Object.hasOwn(layer.turns, key)) return;
    delete layer.turns[key];
    if (Object.keys(layer.turns).length === 0) delete layer.turns;
    return;
  }
  if (!layer) throw new Error(`floor ${floor} has no layer`);
  layer.turns ??= {};
  layer.turns[key] = turn;
}

const TURN_WORDS = `A turn is ${TURNS.join(", ")}: degrees clockwise from facing south.`;

/** Whether `turn` from a `place` may be used on `block`, and the turn it names: 0 for absent. */
export function turnFor(block: BlockKind, turn: unknown): Turn | Rejection {
  if (turn === undefined) return 0;
  if (!isTurn(turn)) return refuse("not_turnable", TURN_WORDS);
  if (turn !== 0 && !isTurnable(block)) {
    return refuse("not_turnable", "Only furniture turns, and not a low stone wall.");
  }
  return turn;
}

/**
 * `turn`: face the piece at (x, y) on `floor` the way `turn` says. The where-rules (reach, a plot
 * you build on, one not for sale, the floor) are `place`'s, checked before this.
 */
export function checkTurn(
  state: WorldState,
  actor: ResidentId,
  command: Extract<Command, { type: "turn" }>,
  floor: number,
  blocks: Readonly<Record<string, BlockKind>>,
  key: string,
): (() => WorldEvent[]) | Rejection {
  const block = blocks[key];
  if (block === undefined) return refuse("no_block", "Nothing to turn there.");
  if (!isTurnable(block)) {
    return refuse("not_turnable", "Only furniture turns, and not a low stone wall.");
  }
  const { turn } = command;
  if (!isTurn(turn)) return refuse("not_turnable", TURN_WORDS);
  if (turnAt(state, key, floor) === turn) {
    return refuse("already_there", `That ${block.replace(/_/g, " ")} already faces that way.`);
  }
  const { x, y } = command;
  return () => {
    setTurn(state, floor, key, turn);
    return [{ type: "block_turned", x, y, ...floorField(floor), turn, by: actor }];
  };
}
