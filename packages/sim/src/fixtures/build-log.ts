import type { Input } from "../types";
import { TOWN_ACTOR } from "../types";
import { PRESENCE_CONFIG, PRESENCE_LOG } from "./presence-log";

/**
 * The presence world after paths, furniture, and plans arrive (RFC 0016). Ada gathers stone and a
 * branch on her plot over two days, makes a low stone wall and a lamp post at her workbench, places
 * the wall, lays fallen leaves on her hearth and a cobble path outside her door, and lifts the
 * cobble again. Then one `build` moves the wall, lays a dirt path and moss, and puts up the lamp
 * post, skipping a lift with nothing there, a block on her hearth, and leaves that are already
 * there. `build.test.ts` replays it and checks the hash pinned below, so a change to a ground or
 * furniture rule, a recipe, or how a plan builds that would replay the real log differently fails
 * loudly.
 */
export const BUILD_CONFIG = PRESENCE_CONFIG;

const town = (command: Input["command"]): Input => ({ actor: TOWN_ACTOR, command });

export const BUILD_LOG: Input[] = [
  ...PRESENCE_LOG,
  // Day 20017: a loose stone inside the hut, two more out past the door.
  town({ type: "new_day", day: 20017 }),
  { actor: "ada", command: { type: "gather", x: 4, y: 4 } },
  { actor: "ada", command: { type: "move", dir: "s" } },
  { actor: "ada", command: { type: "gather", x: 1, y: 7 } },
  { actor: "ada", command: { type: "gather", x: 0, y: 6 } },
  // Day 20019: a branch, and three more stones.
  town({ type: "new_day", day: 20019 }),
  { actor: "ada", command: { type: "gather", x: 6, y: 2 } },
  { actor: "ada", command: { type: "gather", x: 3, y: 4 } },
  { actor: "ada", command: { type: "gather", x: 3, y: 5 } },
  { actor: "ada", command: { type: "gather", x: 1, y: 7 } },
  // The workbench at (4, 3): a wall (1 stone) and a lamp post (1 wood, 2 stone).
  { actor: "ada", command: { type: "craft", recipe: "stone_wall", x: 4, y: 3 } },
  { actor: "ada", command: { type: "craft", recipe: "lamp_post", x: 4, y: 3 } },
  { actor: "ada", command: { type: "place", x: 6, y: 6, block: "stone_wall" } },
  // Ground goes on a hearth, and a costed kind takes its stone and gives it back.
  { actor: "ada", command: { type: "lay", x: 3, y: 3, ground: "leaves" } },
  { actor: "ada", command: { type: "lay", x: 3, y: 6, ground: "cobble" } },
  { actor: "ada", command: { type: "lift", x: 3, y: 6 } },
  // One plan from the hut: the wall moves, a path runs out of the door, the lamp post goes up.
  {
    actor: "ada",
    command: {
      type: "build",
      px: 0,
      py: 0,
      remove: [{ x: 6, y: 6 }],
      lift: [{ x: 3, y: 6 }],
      blocks: [
        { x: 2, y: 7, block: "stone_wall" },
        { x: 4, y: 7, block: "lamp_post" },
        { x: 3, y: 3, block: "wood" },
      ],
      ground: [
        { x: 3, y: 6, ground: "dirt" },
        { x: 3, y: 7, ground: "dirt" },
        { x: 2, y: 6, ground: "moss" },
        { x: 3, y: 3, ground: "leaves" },
      ],
    },
  },
  town({ type: "new_day", day: 20020 }),
];

/** `hashWorld(replay(BUILD_CONFIG, BUILD_LOG))`, pinned when paths, furniture, and plans landed. */
export const BUILD_HASH = "d780ab5f";
