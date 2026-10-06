import type { Input } from "../types";
import { PRESENCE_CONFIG, PRESENCE_LOG } from "./presence-log";

/**
 * The presence world after visits (RFC 0020): three residents who had gone idle visit neighbors'
 * plots, each brought back by the visit itself, landing where the server's planner put them and
 * logged with the command. Bob lands at the edge in front of Cy's door, Dee at the edge of Clem's
 * plot nearest its middle (Clem never built a home), and Cy in front of Bob's door, where Dee then
 * lands beside her. `visit.test.ts` replays it and checks the hash pinned below, so a change to
 * how a logged visit is checked or committed fails loudly. Every older fixture hashes as before.
 */
export const VISIT_CONFIG = PRESENCE_CONFIG;

export const VISIT_LOG: Input[] = [
  ...PRESENCE_LOG,
  { actor: "bob", command: { type: "visit", px: 0, py: 2, x: 3, y: 23 } },
  { actor: "dee", command: { type: "visit", px: 2, py: 2, x: 19, y: 16 } },
  { actor: "cy", command: { type: "visit", px: 2, py: 0, x: 19, y: 7 } },
  { actor: "dee", command: { type: "visit", px: 2, py: 0, x: 18, y: 7 } },
];

/** `hashWorld(replay(VISIT_CONFIG, VISIT_LOG))`, pinned when visits landed. */
export const VISIT_HASH = "9828f54e";
