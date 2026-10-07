/**
 * Day and night, from the server's time anchor in the world snapshot.
 * The client never decides the time; it only renders what the server anchored.
 * Pure functions from the sim, so the map and the server's pictures share the same light.
 */
export { dayPhase, nightAmount } from "@terrakin/sim";
