import { apply } from "./apply";
import type { Input, WorldConfig, WorldState } from "./types";
import { createWorld } from "./world";

/**
 * Which rules an accepted log replays under. The server stores it with every world snapshot and
 * boots only from snapshots written under the same number (RFC 0014), since a snapshot skips
 * re-running the inputs before it.
 *
 * Bump it only for a deliberate, RFC-approved change that makes existing logs replay to a
 * different world. Every other rule change goes behind a logged switch input, so old logs replay
 * exactly and old snapshots stay good. After a bump the next boot replays from the first input
 * under the new rules and writes fresh snapshots; the changelog entry gives the new hash.
 */
export const REPLAY_VERSION = 1;

/**
 * Rebuild a world from its config and the log of accepted inputs.
 * Throws if any logged input is rejected, because an accepted log must always replay cleanly.
 */
export function replay(config: WorldConfig, log: readonly Input[]): WorldState {
  const state = createWorld(config);
  for (const [i, input] of log.entries()) {
    const result = apply(state, input);
    if (!result.ok) {
      throw new Error(`Replay diverged at entry ${i}: ${result.rejection.code}`);
    }
  }
  return state;
}
