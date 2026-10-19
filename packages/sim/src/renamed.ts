/**
 * Commands and fields the sim has renamed, read under the names they have now, so a log holding
 * the old ones replays as it was made. The API refuses an old name (did_you_mean, or the
 * protocol's `renamedField`), so only a logged input reaches the rules with one. Renaming a
 * command or a field adds its old name here.
 */
import type { Command } from "./types";

/**
 * Command types by their old name. `add_storey` was `add_floor` until decision 0252, and every
 * kindred command became a circle one when kindreds were renamed Circles (decision 0318).
 */
const RENAMED_TYPES: Readonly<Record<string, Command["type"]>> = {
  add_storey: "add_floor",
  open_kindreds: "open_circles",
  found_kindred: "found_circle",
  invite_to_kindred: "invite_to_circle",
  cancel_kindred_invite: "cancel_circle_invite",
  join_kindred: "join_circle",
  decline_kindred_invite: "decline_circle_invite",
  leave_kindred: "leave_circle",
  chip_in_kindred: "chip_in_circle",
  remove_from_kindred: "remove_from_circle",
  set_kindred_steward: "set_circle_steward",
  name_kindred: "name_circle",
  set_kindred_hall: "set_circle_hall",
  clear_kindred_name: "clear_circle_name",
  disband_kindred: "disband_circle",
};

/** The commands that took a level of a home as `storey` until decision 0252 named it `floor`. */
const ON_A_TILE: ReadonlySet<string> = new Set(["place", "remove", "lay", "lift"]);
const PLAN_LISTS = ["blocks", "ground", "remove", "lift"] as const;

/** Title ids by their old name. `kindred_regular` became `circle_regular` with decision 0318. */
const RENAMED_TITLES: Readonly<Record<string, string>> = { kindred_regular: "circle_regular" };

/** The commands that name a circle, which they took as `kindred` until decision 0318. */
const NAMES_A_CIRCLE: ReadonlySet<string> = new Set([
  "join_circle",
  "decline_circle_invite",
  "chip_in_circle",
  "clear_circle_name",
  "disband_circle",
  "schedule_event",
]);

/**
 * A tile's `storey` as `floor`. Absent or 0 was always the ground floor, and the web sent
 * `storey: 0` with every tap there, so a 0 is dropped and the tile reads as it always did.
 */
function withFloor<T extends object>(tile: T): T {
  const { storey, ...rest } = tile as T & { storey?: unknown };
  if (storey === undefined) return tile;
  return (storey === 0 ? rest : { ...rest, floor: storey }) as T;
}

/**
 * A circle named as `kindred`, under the `k_1` ids it was given before decision 0318. Ids are made
 * during replay from the circle's number, so the same log now builds `c_1` where it built `k_1`.
 * A `schedule_event` that names no circle is an ordinary event, so an absent field stays absent.
 */
function withCircle<T extends object>(command: T): T {
  const { kindred, ...rest } = command as T & { kindred?: unknown };
  if (kindred === undefined) return command;
  return {
    ...rest,
    circle: typeof kindred === "string" ? kindred.replace(/^k_/, "c_") : kindred,
  } as T;
}

/**
 * A `profile`'s `title` under today's name. A title id is a renamed value inside a logged field, so
 * it belongs here with the commands and fields: the sim refuses an id it doesn't know
 * (`checkTitle`), and a refusal on replay throws.
 */
function withTitle<T extends object>(command: T): T {
  const { title } = command as T & { title?: unknown };
  if (typeof title !== "string" || !Object.hasOwn(RENAMED_TITLES, title)) return command;
  return { ...command, title: RENAMED_TITLES[title] } as T;
}

/** `command` under today's names: the same object when nothing in it was renamed. */
export function currentCommand(command: Command): Command {
  const type =
    (Object.hasOwn(RENAMED_TYPES, command.type) ? RENAMED_TYPES[command.type] : undefined) ??
    command.type;
  let now = type === command.type ? command : ({ ...command, type } as Command);
  if (ON_A_TILE.has(type)) now = withFloor(now);
  if (NAMES_A_CIRCLE.has(type)) now = withCircle(now);
  if (type === "profile") now = withTitle(now);
  if (type === "build") {
    const plan = now as Command & Partial<Record<(typeof PLAN_LISTS)[number], object[]>>;
    for (const name of PLAN_LISTS) {
      const list = plan[name];
      if (!list?.some((t) => "storey" in t)) continue;
      now = { ...now, [name]: list.map(withFloor) } as Command;
    }
  }
  return now;
}
