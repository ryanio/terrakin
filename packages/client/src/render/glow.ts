import type { BlockKind } from "@terrakin/sim";

/** Where a block lights up after dark on the map, and in what light. */
export interface MapGlow {
  /** Across and down its tile from the top-left corner, as shares of the tile. */
  x: number;
  y: number;
  /** A lamp or a flame is warm; a cauldron's brew is green (RFC 0022). */
  tint: "warm" | "brew";
}

/**
 * The spot a block glows from on the map after dark: a paper lantern's shade, a lamp post's lamp,
 * a campfire's or a jack-o'-lantern's flame, a cauldron's brew. Null for a block that stays dark.
 * A string of lights is its bulbs instead (`lightBulbs`), and a window lights only in 3D. The 3D
 * views light the same kinds (`glowsAfterDark`), and `daylight.test.ts` holds the two together.
 */
export function mapGlow(block: BlockKind): MapGlow | null {
  switch (block) {
    case "lantern":
      return { x: 0.64, y: 0.42, tint: "warm" };
    case "lamp_post":
      return { x: 0.5, y: 0.25, tint: "warm" };
    case "campfire":
    case "jack_o_lantern":
      return { x: 0.5, y: 0.62, tint: "warm" };
    case "cauldron":
      return { x: 0.5, y: 0.42, tint: "brew" };
    default:
      return null;
  }
}
