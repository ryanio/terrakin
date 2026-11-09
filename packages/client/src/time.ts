/**
 * Day and night, from the server's time anchor in the world snapshot.
 * The client never decides the time; it only renders what the server anchored.
 * Pure functions from the sim, so the map and the server's pictures share the same light.
 */
export { dayPhase, nightAmount } from "@terrakin/sim";

/** A reading of the server's clock (`nowMs`) and this device's clock when it came (`at`). */
export interface ClockAnchor {
  nowMs: number;
  at: number;
}

/**
 * The server's time at this device's `now`, read forward from `anchor`. `now` comes from the same
 * clock as `anchor.at` (`Date.now()` or `performance.now()`).
 */
export function serverTime(anchor: ClockAnchor, now: number): number {
  return anchor.nowMs + (now - anchor.at);
}
