import type { Input, WorldConfig } from "../types";
import { TOWN_ACTOR } from "../types";

/**
 * A world log written before coins existed (RFC 0008): days, townsfolk, plots, homes, and a Town
 * Hall that proposes, votes, closes, and builds, but no `open_economy`. `economy.test.ts` replays
 * it and checks the hash pinned below, so a coin rule that leaks into worlds without an economy
 * fails loudly.
 */
export const PRE_ECONOMY_CONFIG: WorldConfig = {
  width: 24,
  height: 24,
  plotSize: 8,
  maxPlotsPerResident: 1,
  reach: 3,
};

const DAY = 20_000;
const town = (command: Input["command"]): Input => ({ actor: TOWN_ACTOR, command });

export const PRE_ECONOMY_LOG: Input[] = [
  { actor: "ada", command: { type: "join", name: "Ada", kind: "human" } },
  { actor: "bob", command: { type: "join", name: "Bob", kind: "agent" } },
  { actor: "cy", command: { type: "join", name: "Cy", kind: "human", theme: "meadow" } },
  { actor: "clem", command: { type: "join", name: "Clem", kind: "agent" } },
  town({ type: "new_day", day: DAY }),
  town({ type: "set_townsfolk", ids: ["clem"] }),
  { actor: "ada", command: { type: "settle", px: 0, py: 0 } },
  { actor: "ada", command: { type: "build_starter_home" } },
  { actor: "bob", command: { type: "settle", px: 2, py: 0 } },
  { actor: "bob", command: { type: "build_starter_home", walls: "stone" } },
  { actor: "cy", command: { type: "settle", px: 0, py: 2 } },
  { actor: "cy", command: { type: "build_starter_home" } },
  { actor: "clem", command: { type: "settle", px: 2, py: 2 } },
  { actor: "ada", command: { type: "share_plot", with: "cy" } },
  town({ type: "new_day", day: DAY + 3 }),
  { actor: "ada", command: { type: "move", dir: "e" } },
  { actor: "ada", command: { type: "home" } },
  { actor: "bob", command: { type: "move", dir: "w" } },
  { actor: "cy", command: { type: "move", dir: "n" } },
  {
    actor: "ada",
    command: { type: "propose", kind: "advisory", title: "More benches", text: "By the well." },
  },
  {
    actor: "bob",
    command: {
      type: "propose",
      kind: "commons_build",
      title: "A fountain",
      text: "",
      blocks: [
        { x: 9, y: 13, block: "glass" },
        { x: 10, y: 13, block: "stone" },
      ],
    },
  },
  { actor: "ada", command: { type: "vote", proposal: "t_1", choice: "yes" } },
  { actor: "bob", command: { type: "vote", proposal: "t_1", choice: "no" } },
  { actor: "cy", command: { type: "vote", proposal: "t_1", choice: "yes" } },
  { actor: "ada", command: { type: "vote", proposal: "t_2", choice: "yes" } },
  { actor: "bob", command: { type: "vote", proposal: "t_2", choice: "yes" } },
  { actor: "cy", command: { type: "vote", proposal: "t_2", choice: "abstain" } },
  { actor: "cy", command: { type: "vote", proposal: "t_2", choice: "yes" } },
  town({ type: "new_day", day: DAY + 5 }),
  town({ type: "close_proposal", proposal: "t_1" }),
  town({ type: "close_proposal", proposal: "t_2" }),
  { actor: "bob", command: { type: "home" } },
  { actor: "cy", command: { type: "profile", note: "likes ponds" } },
  { actor: "bob", command: { type: "leave" } },
];

/** `hashWorld(replay(PRE_ECONOMY_CONFIG, PRE_ECONOMY_LOG))`, computed before coins landed. */
export const PRE_ECONOMY_HASH = "603f5f8b";
