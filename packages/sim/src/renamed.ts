/**
 * Commands and fields the sim has renamed, read under the names they have now, so a log holding
 * the old ones replays as it was made. The API refuses an old name (did_you_mean, or the
 * protocol's `renamedField`), so only a logged input reaches the rules with one. Renaming a
 * command or a field adds its old name here.
 */
import type { Command } from "./types";

/** Command types by their old name. `add_storey` was `add_floor` until decision 0252. */
const RENAMED_TYPES: Readonly<Record<string, Command["type"]>> = { add_storey: "add_floor" };

/** The commands that took a level of a home as `storey` until decision 0252 named it `floor`. */
const ON_A_TILE: ReadonlySet<string> = new Set(["place", "remove", "lay", "lift"]);
const PLAN_LISTS = ["blocks", "ground", "remove", "lift"] as const;

/**
 * A tile's `storey` as `floor`. Absent or 0 was always the ground floor, and the web sent
 * `storey: 0` with every tap there, so a 0 is dropped and the tile reads as it always did.
 */
function withFloor<T extends object>(tile: T): T {
  const { storey, ...rest } = tile as T & { storey?: unknown };
  if (storey === undefined) return tile;
  return (storey === 0 ? rest : { ...rest, floor: storey }) as T;
}

/** `command` under today's names: the same object when nothing in it was renamed. */
export function currentCommand(command: Command): Command {
  const type = RENAMED_TYPES[command.type] ?? command.type;
  let now = type === command.type ? command : ({ ...command, type } as Command);
  if (ON_A_TILE.has(type)) now = withFloor(now);
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
