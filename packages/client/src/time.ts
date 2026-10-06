/**
 * Day and night, from the server's time anchor in the world snapshot.
 * The client never decides the time; it only renders what the server anchored.
 * Pure functions, so tests can pin the math.
 */

/**
 * Phase of the day, 0 to 1: 0 is dawn, 0.25 noon, 0.5 dusk, 0.75 midnight.
 * Wraps cleanly, so a client that joins mid-cycle lands in the right light.
 */
export function dayPhase(serverNowMs: number, dayLengthMs: number): number {
  const t = ((serverNowMs % dayLengthMs) + dayLengthMs) % dayLengthMs;
  return t / dayLengthMs;
}

/**
 * How dark the world should look: 0 in full day, 1 at midnight.
 * Smooth curve, darkest at midnight, brightest at noon, dawn and dusk in between.
 */
export function nightAmount(phase: number): number {
  return (1 - Math.cos((phase - 0.25) * Math.PI * 2)) / 2;
}
