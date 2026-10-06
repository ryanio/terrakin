import type { Input } from "../types";
import { TOWN_ACTOR } from "../types";
import { COMMONS_CONFIG, COMMONS_LOG } from "./commons-log";

/**
 * The Commons world once Town Hall builds keep the game tables' spots clear (decision 0126). The
 * spots here are (9, 10), (14, 10), (9, 13), and (14, 13). Ada's build puts a lamp post on (9, 13)
 * and closes before the server logs `keep_table_spots`, so it goes up, as builds did before the
 * rule. Bob's, filed in the same days, closes after the switch: its bench on (14, 10) is skipped,
 * while the moss under it and its other bench go in. Then Cy's takes Ada's lamp post off the
 * spot, which the rule still allows. `town.test.ts` replays it and checks the hash pinned below,
 * so a change to how the rule files or closes a build fails loudly. Every older fixture, with its
 * blocks on spots from before the rule, hashes as before.
 */
export const TABLE_SPOTS_CONFIG = COMMONS_CONFIG;

const DAY = 20_032;
const town = (command: Input["command"]): Input => ({ actor: TOWN_ACTOR, command });
const votes = (proposal: string): Input[] =>
  ["ada", "bob", "cy", "dee"].map((actor) => ({
    actor,
    command: { type: "vote", proposal, choice: "yes" },
  }));

export const TABLE_SPOTS_LOG: Input[] = [
  ...COMMONS_LOG,
  town({ type: "new_day", day: DAY }),
  {
    actor: "ada",
    command: {
      type: "propose",
      kind: "commons_build",
      title: "A lamp by the tables",
      text: "",
      blocks: [{ x: 9, y: 13, block: "lamp_post" }],
    },
  },
  {
    actor: "bob",
    command: {
      type: "propose",
      kind: "commons_build",
      title: "Benches and moss",
      text: "",
      blocks: [
        { x: 14, y: 10, block: "bench" },
        { x: 13, y: 11, block: "bench" },
      ],
      ground: [{ x: 14, y: 10, ground: "moss" }],
    },
  },
  ...votes("t_7"),
  ...votes("t_8"),
  town({ type: "new_day", day: DAY + 2 }),
  town({ type: "close_proposal", proposal: "t_7" }),
  town({ type: "keep_table_spots" }),
  town({ type: "close_proposal", proposal: "t_8" }),
  {
    actor: "cy",
    command: {
      type: "propose",
      kind: "commons_build",
      title: "Clear the table's spot",
      text: "",
      remove: [{ x: 9, y: 13 }],
    },
  },
  ...votes("t_9"),
  town({ type: "new_day", day: DAY + 4 }),
  town({ type: "close_proposal", proposal: "t_9" }),
  town({ type: "new_day", day: DAY + 5 }),
];

/** `hashWorld(replay(TABLE_SPOTS_CONFIG, TABLE_SPOTS_LOG))`, pinned when the spots were kept. */
export const TABLE_SPOTS_HASH = "2e210329";
