import type { Input } from "../types";
import { TOWN_ACTOR } from "../types";
import { BUILD_CONFIG, BUILD_LOG } from "./build-log";

/**
 * The build world after the town can make the Commons lovely (decision 0101). Ada's proposal lays a
 * cobble path from the Town Hall's door to the shop's, across spawn, and puts up a bench, a lamp
 * post, and a well; Bob's and Cy's lay moss and sand on the same tile, so the second to close skips
 * it. A week later Dee's moves the bench, swaps a cobble tile for brick, and takes the old
 * fountain's glass away. The builds take nothing from anyone's things. `town.test.ts` replays it
 * and checks the hash pinned below, so a change to how a Commons build files or closes that would
 * replay the real log differently fails loudly.
 */
export const COMMONS_CONFIG = BUILD_CONFIG;

const DAY = 20_021;
const town = (command: Input["command"]): Input => ({ actor: TOWN_ACTOR, command });
const vote = (actor: string, proposal: string): Input => ({
  actor,
  command: { type: "vote", proposal, choice: "yes" },
});

export const COMMONS_LOG: Input[] = [
  ...BUILD_LOG,
  town({ type: "new_day", day: DAY }),
  // Everyone home first, so they can all take part.
  ...["ada", "bob", "cy", "dee"].map((actor): Input => ({ actor, command: { type: "home" } })),
  {
    actor: "ada",
    command: {
      type: "propose",
      kind: "commons_build",
      title: "A square to sit in",
      text: "A path from the hall to the shop, a bench, a lamp post, and a well.",
      ground: [
        { x: 12, y: 10, ground: "cobble" },
        { x: 12, y: 11, ground: "cobble" },
        { x: 12, y: 12, ground: "cobble" },
        { x: 12, y: 13, ground: "cobble" },
      ],
      blocks: [
        { x: 10, y: 11, block: "bench" },
        { x: 13, y: 10, block: "lamp_post" },
        { x: 14, y: 12, block: "well" },
      ],
    },
  },
  {
    actor: "bob",
    command: {
      type: "propose",
      kind: "commons_build",
      title: "Moss by the well",
      text: "",
      ground: [
        { x: 13, y: 13, ground: "moss" },
        { x: 14, y: 13, ground: "moss" },
      ],
    },
  },
  {
    actor: "cy",
    command: {
      type: "propose",
      kind: "commons_build",
      title: "A sandpit",
      text: "",
      ground: [{ x: 13, y: 13, ground: "sand" }],
    },
  },
  ...["ada", "bob", "cy", "dee"].flatMap((who) => [
    vote(who, "t_3"),
    vote(who, "t_4"),
    vote(who, "t_5"),
  ]),
  town({ type: "new_day", day: DAY + 2 }),
  town({ type: "close_proposal", proposal: "t_3" }),
  town({ type: "close_proposal", proposal: "t_4" }),
  town({ type: "close_proposal", proposal: "t_5" }),
  // A week on: everyone does something, so they can take part again.
  town({ type: "new_day", day: DAY + 7 }),
  { actor: "ada", command: { type: "home" } },
  { actor: "bob", command: { type: "move", dir: "s" } },
  { actor: "cy", command: { type: "move", dir: "n" } },
  { actor: "dee", command: { type: "move", dir: "s" } },
  {
    actor: "dee",
    command: {
      type: "propose",
      kind: "commons_build",
      title: "The bench by the old fountain",
      text: "Move the bench west, brick under the shop's door, and the glass gone.",
      remove: [
        { x: 10, y: 11 },
        { x: 9, y: 13 },
      ],
      blocks: [{ x: 9, y: 11, block: "bench" }],
      lift: [{ x: 12, y: 13 }],
      ground: [{ x: 12, y: 13, ground: "brick" }],
    },
  },
  ...["ada", "bob", "cy", "dee"].map((who) => vote(who, "t_6")),
  town({ type: "new_day", day: DAY + 9 }),
  town({ type: "close_proposal", proposal: "t_6" }),
  town({ type: "new_day", day: DAY + 10 }),
];

/** `hashWorld(replay(COMMONS_CONFIG, COMMONS_LOG))`, pinned when Commons builds took paths. */
export const COMMONS_HASH = "c93c3d50";
