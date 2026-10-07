import type { Input } from "../types";
import { TOWN_ACTOR } from "../types";
import { RECIPES_CONFIG, RECIPES_LOG } from "./recipes-log";

/**
 * The recipes world with lessons and recipe pages (RFC 0024, phase 3). Finds come out, and Fran
 * and Gus move in after recipes opened, both landing on the Commons. Fran picks lemonade and the
 * well and teaches Gus lemonade. Clem becomes townsfolk, and the next day Gus walks over to him and
 * Clem teaches him tomato sauce. Five days on, Fran walks to a recipe page lying at (14, 20) and
 * gathers it, which teaches her pumpkin pie. `recipes.test.ts` replays it and checks the hash
 * pinned below, so once recipes are live a change to teaching, the townsfolk's week, the page
 * rate, the page list, or the page roll that would replay the real log differently fails loudly.
 */
export const LESSONS_CONFIG = RECIPES_CONFIG;

const DAY = 20_000;
const town = (command: Input["command"]): Input => ({ actor: TOWN_ACTOR, command });
const fran = (command: Input["command"]): Input => ({ actor: "fran", command });
const gus = (command: Input["command"]): Input => ({ actor: "gus", command });
const steps = (who: (c: Input["command"]) => Input, dirs: string) =>
  [...dirs].map((dir) => who({ type: "move", dir: dir as "n" | "e" | "s" | "w" }));

export const LESSONS_LOG: Input[] = [
  ...RECIPES_LOG,
  // Day 20017.
  town({ type: "open_finds" }),
  fran({ type: "join", name: "Fran", kind: "human" }),
  gus({ type: "join", name: "Gus", kind: "human" }),
  fran({ type: "pick_recipe", recipe: "lemonade" }),
  fran({ type: "pick_recipe", recipe: "well" }),
  fran({ type: "teach", recipe: "lemonade", to: "gus" }),
  town({ type: "set_townsfolk", ids: ["clem"] }),
  town({ type: "new_day", day: DAY + 18 }),
  // Clem stands at (19, 19). Gus walks to (16, 16), within reach of him.
  ...steps(gus, "eeeessss"),
  { actor: "clem", command: { type: "teach", recipe: "tomato_sauce", to: "gus" } },
  town({ type: "new_day", day: DAY + 23 }),
  // A pumpkin pie page lies at (14, 20) today.
  ...steps(fran, "eessssssss"),
  fran({ type: "gather", x: 14, y: 20 }),
  town({ type: "new_day", day: DAY + 24 }),
];

/** `hashWorld(replay(LESSONS_CONFIG, LESSONS_LOG))`, pinned when lessons and pages landed. */
export const LESSONS_HASH = "db51e59f";
