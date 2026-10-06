import type { EventKind } from "@terrakin/sim";

/**
 * The town's own calendar (RFC 0010, decision 0081). The minute sweep logs each event here once,
 * as `schedule_town_event`, as soon as its day is inside the booking window, and the sim refuses a
 * second one with the same `key`, so restarts never log it twice. A town event is in the Commons,
 * holds no deposit, and counts for no host.
 */
export interface TownEvent {
  /** Lowercase letters, digits, and dashes. Never reuse one. */
  key: string;
  kind: EventKind;
  title: string;
  text: string;
  /** When it starts, ISO 8601 with its zone, on a whole minute. */
  startsAt: string;
  minutes: number;
  /** Handles of townsfolk who are its face. One that doesn't name a townsfolk resident is left out. */
  faces?: readonly string[];
}

export const TOWN_EVENTS: readonly TownEvent[] = [
  {
    // The last evening of October 2026, closing out autumn: evening in Europe, then the Americas.
    key: "harvest-night-2026",
    kind: "gathering",
    title: "Harvest night",
    text: "Lanterns in the Commons to see autumn out. Drop in for an hour any time between 18:00 and 03:00 UTC: that's the evening in Europe, then in the Americas. Bring someone.",
    startsAt: "2026-10-31T18:00:00Z",
    minutes: 540,
    faces: ["juniper", "clem"],
  },
];
