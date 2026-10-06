import type { Input } from "../types";
import { TOWN_ACTOR } from "../types";
import { VISIT_CONFIG, VISIT_LOG } from "./visit-log";

/**
 * The visit world with plot names (decision 0121): Ada names her plot and Cy her own, from across
 * the map; Bob names his and clears it; staff take Cy's name down. Clem, brought back by acting,
 * names his bare plot, releases it (the name goes with it), and claims it again with no name. The
 * next day Cy renames Ada's plot, which is shared with her, and Bob names his again.
 * `plot-names.test.ts` checks the hash pinned below, so a change to how a logged name is checked or
 * kept fails loudly. Every older fixture hashes as before.
 */
export const PLOT_NAMES_CONFIG = VISIT_CONFIG;

const town = (command: Input["command"]): Input => ({ actor: TOWN_ACTOR, command });

export const PLOT_NAMES_LOG: Input[] = [
  ...VISIT_LOG,
  { actor: "ada", command: { type: "name_plot", px: 0, py: 0, name: "Ada's Lemon Grove" } },
  { actor: "cy", command: { type: "name_plot", px: 0, py: 2, name: "Moss Hollow" } },
  { actor: "bob", command: { type: "name_plot", px: 2, py: 0, name: "Bob's Workshop" } },
  { actor: "bob", command: { type: "name_plot", px: 2, py: 0, name: null } },
  town({ type: "clear_plot_name", px: 0, py: 2 }),
  { actor: "clem", command: { type: "name_plot", px: 2, py: 2, name: "Quiet Corner" } },
  { actor: "clem", command: { type: "release" } },
  { actor: "clem", command: { type: "claim" } },
  town({ type: "new_day", day: 20016 }),
  { actor: "cy", command: { type: "name_plot", px: 0, py: 0, name: "The Lemon Grove" } },
  { actor: "bob", command: { type: "name_plot", px: 2, py: 0, name: "Bob's Workshop" } },
];

/** `hashWorld(replay(PLOT_NAMES_CONFIG, PLOT_NAMES_LOG))`, pinned when plot names landed. */
export const PLOT_NAMES_HASH = "92681ef0";
