import type { Input } from "../types";
import { TOWN_ACTOR } from "../types";
import { BUILD_CONFIG, BUILD_LOG } from "./build-log";

/**
 * The build world after staff clear blocks off a plot (decision 0343). Staff take Ada's lamp post
 * off her plot, which comes back to her things, and then her low stone wall. `clear-block.test.ts`
 * replays it and checks the hash pinned below, so a change to what a cleared block gives back, or
 * to whom, fails loudly. Every older fixture hashes as before, because no log before this one ever
 * held a `clear_block`.
 */
export const CLEAR_BLOCK_CONFIG = BUILD_CONFIG;

const town = (command: Input["command"]): Input => ({ actor: TOWN_ACTOR, command });

export const CLEAR_BLOCK_LOG: Input[] = [
  ...BUILD_LOG,
  town({ type: "clear_block", x: 4, y: 7 }),
  town({ type: "clear_block", x: 2, y: 7 }),
];

/** `hashWorld(replay(CLEAR_BLOCK_CONFIG, CLEAR_BLOCK_LOG))`, pinned when clear_block landed. */
export const CLEAR_BLOCK_HASH = "109f0d75";
