import type { Input, WorldConfig } from "../types";

/**
 * A world log written before the Town Hall existed (RFC 0004), using every command that existed
 * then. `town.test.ts` replays it and checks the hash pinned below, so a rule change that would
 * make old logs replay differently fails loudly.
 */
export const PRE_TOWN_CONFIG: WorldConfig = {
  width: 24,
  height: 24,
  plotSize: 8,
  maxPlotsPerResident: 1,
  reach: 3,
};

const steps = (actor: string, dir: "n" | "s" | "e" | "w", n: number): Input[] =>
  Array.from({ length: n }, () => ({ actor, command: { type: "move", dir } }));

export const PRE_TOWN_LOG: Input[] = [
  { actor: "ada", command: { type: "join", name: "Ada", kind: "human", color: "plum" } },
  { actor: "bob", command: { type: "join", name: "Bob", kind: "agent", note: "a helper" } },
  { actor: "cy", command: { type: "join", name: "Cy", kind: "human" } },
  { actor: "ada", command: { type: "settle", px: 0, py: 0 } },
  { actor: "ada", command: { type: "build_starter_home", walls: "stone" } },
  { actor: "ada", command: { type: "share_plot", with: "bob" } },
  { actor: "bob", command: { type: "settle", px: 2, py: 0 } },
  { actor: "bob", command: { type: "place", x: 17, y: 1, block: "leaf" } },
  { actor: "bob", command: { type: "remove", x: 17, y: 1 } },
  { actor: "bob", command: { type: "set_hearth", x: 19, y: 3 } },
  ...steps("cy", "w", 5),
  ...steps("cy", "s", 6),
  { actor: "cy", command: { type: "claim" } },
  { actor: "cy", command: { type: "place", x: 7, y: 17, block: "glass" } },
  { actor: "cy", command: { type: "remove", x: 7, y: 17 } },
  { actor: "cy", command: { type: "release" } },
  { actor: "cy", command: { type: "settle", px: 0, py: 2 } },
  { actor: "cy", command: { type: "profile", shape: "diamond", note: "likes ponds" } },
  { actor: "ada", command: { type: "unshare_plot", with: "bob" } },
  ...steps("bob", "s", 2),
  { actor: "bob", command: { type: "home" } },
  { actor: "bob", command: { type: "leave" } },
];

/** `hashWorld(replay(PRE_TOWN_CONFIG, PRE_TOWN_LOG))`, computed before the Town Hall landed. */
export const PRE_TOWN_HASH = "5d04f717";
