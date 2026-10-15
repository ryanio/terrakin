/**
 * The designs `build` takes by name (RFC 0032), apart from their maps in `designs.ts` so the action
 * schema names them without bringing the drawings into the web's first load.
 */
export const DESIGN_IDS = [
  "hut",
  "greenhouse",
  "workshop",
  "cafe",
  "post_stop",
  "library",
  "lookout",
  "hill_house",
  "atelier",
] as const;
export type DesignId = (typeof DESIGN_IDS)[number];

/** The turns a design takes, clockwise: at 90 a door on the south side faces west. */
export const DESIGN_TURNS = [0, 90, 180, 270] as const;
export type DesignTurn = (typeof DESIGN_TURNS)[number];
