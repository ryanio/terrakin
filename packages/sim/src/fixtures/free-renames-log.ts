import type { Input } from "../types";
import { TOWN_ACTOR } from "../types";
import { PLOT_NAMES_CONFIG, PLOT_NAMES_LOG } from "./plot-names-log";

/**
 * The plot names world with free renames (decision 0121). Its first part is the plot names log,
 * whose names all came under the once-a-day limit alone and still hash as they did. Then, on the
 * same day: Ada changes the name Cy gave their shared plot, which takes one of its two free
 * renames; Bob fixes his twice and has none left; Cy names her plot (the day after staff took its
 * name down, so it needs no free rename), changes it, and takes it down; Clem names his bare plot
 * and changes it, then releases it and claims it again, with both free renames back. The next day
 * Bob renames with none left, and Ada uses the shared plot's last one. `plot-names.test.ts`
 * checks the hash pinned below, so a change to how a logged rename is checked or kept fails
 * loudly.
 */
export const FREE_RENAMES_CONFIG = PLOT_NAMES_CONFIG;

const name = (actor: string, px: number, py: number, value: string | null): Input => ({
  actor,
  command: { type: "name_plot", px, py, name: value },
});

export const FREE_RENAMES_LOG: Input[] = [
  ...PLOT_NAMES_LOG,
  name("ada", 0, 0, "Ada's Lemon Grove"),
  name("bob", 2, 0, "Bob's Workshp"),
  name("bob", 2, 0, "Bob's Workshop and Shed"),
  name("cy", 0, 2, "Fern Hollow"),
  name("cy", 0, 2, "Fern Hollow Green"),
  name("cy", 0, 2, null),
  name("clem", 2, 2, "Quiet Corner"),
  name("clem", 2, 2, "Clem's Quiet Corner"),
  { actor: "clem", command: { type: "release" } },
  { actor: "clem", command: { type: "claim" } },
  name("clem", 2, 2, "Quiet Corner"),
  name("clem", 2, 2, "Clem's Corner"),
  { actor: TOWN_ACTOR, command: { type: "new_day", day: 20017 } },
  name("bob", 2, 0, "Bob's Workshop"),
  name("ada", 0, 0, "The Lemon Grove"),
  name("ada", 0, 0, "Ada's Lemon Grove"),
];

/** `hashWorld(replay(FREE_RENAMES_CONFIG, FREE_RENAMES_LOG))`, pinned when free renames landed. */
export const FREE_RENAMES_HASH = "1cd5d96f";
