import type { Input } from "../types";
import { TOWN_ACTOR } from "../types";
import { LESSONS_CONFIG, LESSONS_LOG } from "./lessons-log";

/**
 * The recipes world moved to the second edition of the recipe page list (decision 0310), as the
 * server does: right after a `new_day`, never in the middle of one, since it changes which tiles
 * hold a page from then on. Two days later Fran walks north to (14, 7), where edition 2 has a
 * corn bread page and edition 1 has nothing at all, and gathers it.
 *
 * `recipes.test.ts` replays it to the hash pinned below, so a change to the second edition's list
 * or its order, which would replay the live log differently once it's switched on, fails loudly.
 */
export const PAGE_EDITION_CONFIG = LESSONS_CONFIG;

/** Day 20025, the day after the lessons log ends. */
const DAY = 20_025;
const town = (command: Input["command"]): Input => ({ actor: TOWN_ACTOR, command });
const fran = (command: Input["command"]): Input => ({ actor: "fran", command });
const steps = (who: (c: Input["command"]) => Input, dirs: string) =>
  [...dirs].map((dir) => who({ type: "move", dir: dir as "n" | "e" | "s" | "w" }));

export const PAGE_EDITION_LOG: Input[] = [
  ...LESSONS_LOG,
  town({ type: "new_day", day: DAY }),
  town({ type: "set_page_edition", edition: 2 }),
  town({ type: "new_day", day: DAY + 1 }),
  town({ type: "new_day", day: DAY + 2 }),
  // Fran stands at (14, 20) and walks to (14, 10), within reach of the page at (14, 7).
  ...steps(fran, "nnnnnnnnnn"),
  fran({ type: "gather", x: 14, y: 7 }),
];

/** `hashWorld(replay(PAGE_EDITION_CONFIG, PAGE_EDITION_LOG))`, pinned when edition 2 landed. */
export const PAGE_EDITION_HASH = "534612be";
