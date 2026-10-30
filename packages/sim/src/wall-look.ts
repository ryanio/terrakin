/**
 * What each wall and window is made of, as marks over its color: presentation only, like the rest
 * of the palette. It lives in a module of its own so the web client's first load, which reads the
 * palette's colors, doesn't carry it: only the world map, the 3D views, and the server read it.
 */

import type { MaterialKind } from "./catalog";
import { BLOCK_COLORS, type GroundMark, markDot, markLine, markRect } from "./palette";
import type { BlockKind, BuildingBlock } from "./types";

/** The blocks that are walls and windows: the four free ones and the made materials (RFC 0041). */
export type WallKind = BuildingBlock | MaterialKind;

/** Mortar and seams, darker than any wall, and the light catching an edge. */
const JOINT = "rgba(62, 40, 22, 0.34)";
const GRAIN = "rgba(80, 48, 22, 0.16)";
const CATCH = "rgba(255, 248, 232, 0.3)";

/**
 * The surface of each wall kind, as marks over the block's own color, in units of its face: (0, 0)
 * its top left and (1, 1) its bottom right. The map paints them over a wall, the 3D views paint
 * them into each material's texture, and the plot photos draw them too, so a brick wall is a brick
 * wall everywhere. The free four's marks are see-through shades, never colors of their own, so a
 * themed plot (`blockFill`) keeps its colors under them. Marks stay inside the face, since a plot
 * photo can't clip them to its rounded corners.
 */
export const WALL_LOOK: Readonly<Record<WallKind, readonly GroundMark[]>> = {
  // Three boards with a butt joint in each, a little grain, and a knot.
  wood: [
    markLine(0.03, 0.34, 0.97, 0.34, 0.035, JOINT),
    markLine(0.03, 0.67, 0.97, 0.67, 0.035, JOINT),
    markLine(0.62, 0.05, 0.62, 0.31, 0.028, JOINT),
    markLine(0.28, 0.38, 0.28, 0.63, 0.028, JOINT),
    markLine(0.76, 0.71, 0.76, 0.95, 0.028, JOINT),
    markLine(0.08, 0.17, 0.5, 0.2, 0.014, GRAIN),
    markLine(0.36, 0.52, 0.92, 0.5, 0.014, GRAIN),
    markLine(0.06, 0.84, 0.6, 0.82, 0.014, GRAIN),
    markLine(0.04, 0.37, 0.96, 0.37, 0.016, CATCH),
    markLine(0.04, 0.7, 0.96, 0.7, 0.016, CATCH),
    { shape: "ellipse", cx: 0.84, cy: 0.18, rx: 0.05, ry: 0.03, turn: 0, fill: JOINT },
  ],
  // Coursed stones of uneven length in soft mortar, a few catching more light than the rest.
  stone: [
    markRect(0.5, 0.05, 0.45, 0.27, 0.06, "rgba(255, 250, 240, 0.14)"),
    markRect(0.05, 0.4, 0.15, 0.25, 0.05, "rgba(40, 30, 20, 0.1)"),
    markRect(0.75, 0.4, 0.2, 0.25, 0.05, "rgba(255, 250, 240, 0.12)"),
    markRect(0.05, 0.72, 0.42, 0.23, 0.06, "rgba(40, 30, 20, 0.08)"),
    markLine(0.03, 0.36, 0.97, 0.36, 0.04, JOINT),
    markLine(0.03, 0.68, 0.97, 0.68, 0.04, JOINT),
    markLine(0.46, 0.05, 0.46, 0.33, 0.035, JOINT),
    markLine(0.22, 0.39, 0.22, 0.65, 0.035, JOINT),
    markLine(0.72, 0.39, 0.72, 0.65, 0.035, JOINT),
    markLine(0.5, 0.71, 0.5, 0.95, 0.035, JOINT),
    markLine(0.08, 0.09, 0.34, 0.09, 0.02, CATCH),
    markLine(0.27, 0.43, 0.6, 0.43, 0.02, CATCH),
    markLine(0.55, 0.75, 0.86, 0.75, 0.02, CATCH),
  ],
  // Four panes behind a white cross, a glint in two of them.
  glass: [
    markLine(0.5, 0.06, 0.5, 0.94, 0.05, "rgba(255, 255, 255, 0.72)"),
    markLine(0.06, 0.5, 0.94, 0.5, 0.05, "rgba(255, 255, 255, 0.72)"),
    markLine(0.14, 0.38, 0.36, 0.16, 0.045, "rgba(255, 255, 255, 0.75)"),
    markLine(0.62, 0.86, 0.84, 0.64, 0.045, "rgba(255, 255, 255, 0.6)"),
  ],
  // A clipped hedge: clumps of leaves in shade and in sun.
  leaf: [
    markDot(0.26, 0.3, 0.17, "rgba(30, 60, 20, 0.2)"),
    markDot(0.72, 0.42, 0.18, "rgba(30, 60, 20, 0.18)"),
    markDot(0.38, 0.74, 0.18, "rgba(30, 60, 20, 0.2)"),
    markDot(0.3, 0.24, 0.1, "rgba(200, 235, 150, 0.22)"),
    markDot(0.76, 0.34, 0.1, "rgba(200, 235, 150, 0.2)"),
    markDot(0.42, 0.66, 0.1, "rgba(200, 235, 150, 0.2)"),
    markDot(0.8, 0.8, 0.05, "rgba(200, 235, 150, 0.25)"),
    markDot(0.14, 0.62, 0.04, "rgba(200, 235, 150, 0.25)"),
  ],
  // Smooth lime plaster: long faint sweeps where the trowel went, and a few pits.
  plaster: [
    {
      shape: "ellipse",
      cx: 0.34,
      cy: 0.26,
      rx: 0.26,
      ry: 0.07,
      turn: -8,
      fill: "rgba(150, 128, 98, 0.12)",
    },
    {
      shape: "ellipse",
      cx: 0.64,
      cy: 0.52,
      rx: 0.28,
      ry: 0.08,
      turn: 6,
      fill: "rgba(255, 255, 255, 0.5)",
    },
    {
      shape: "ellipse",
      cx: 0.38,
      cy: 0.78,
      rx: 0.24,
      ry: 0.06,
      turn: -4,
      fill: "rgba(150, 128, 98, 0.1)",
    },
    {
      shape: "ellipse",
      cx: 0.72,
      cy: 0.2,
      rx: 0.16,
      ry: 0.05,
      turn: 10,
      fill: "rgba(255, 255, 255, 0.4)",
    },
    markDot(0.18, 0.5, 0.014, "rgba(140, 118, 90, 0.3)"),
    markDot(0.82, 0.74, 0.012, "rgba(140, 118, 90, 0.3)"),
    markDot(0.56, 0.12, 0.012, "rgba(140, 118, 90, 0.26)"),
  ],
  // Four courses of brick in pale mortar, the joints staggered, a few bricks fired darker.
  brickwork: [
    markRect(0.52, 0.03, 0.45, 0.2, 0.02, "rgba(90, 30, 18, 0.2)"),
    markRect(0.03, 0.27, 0.2, 0.21, 0.02, "rgba(90, 30, 18, 0.16)"),
    markRect(0.27, 0.52, 0.46, 0.21, 0.02, "rgba(255, 196, 160, 0.16)"),
    markRect(0.77, 0.77, 0.2, 0.2, 0.02, "rgba(90, 30, 18, 0.18)"),
    markLine(0.03, 0.25, 0.97, 0.25, 0.045, "rgba(236, 222, 200, 0.8)"),
    markLine(0.03, 0.5, 0.97, 0.5, 0.045, "rgba(236, 222, 200, 0.8)"),
    markLine(0.03, 0.75, 0.97, 0.75, 0.045, "rgba(236, 222, 200, 0.8)"),
    markLine(0.5, 0.04, 0.5, 0.25, 0.04, "rgba(236, 222, 200, 0.8)"),
    markLine(0.25, 0.25, 0.25, 0.5, 0.04, "rgba(236, 222, 200, 0.8)"),
    markLine(0.75, 0.25, 0.75, 0.5, 0.04, "rgba(236, 222, 200, 0.8)"),
    markLine(0.5, 0.5, 0.5, 0.75, 0.04, "rgba(236, 222, 200, 0.8)"),
    markLine(0.25, 0.75, 0.25, 0.96, 0.04, "rgba(236, 222, 200, 0.8)"),
    markLine(0.75, 0.75, 0.75, 0.96, 0.04, "rgba(236, 222, 200, 0.8)"),
  ],
  // Dark oak beams over plaster panels: a post down the middle, a brace and a rail, and pegs.
  timber_frame: [
    markRect(0.11, 0.11, 0.33, 0.78, 0.02, "#ece2cc"),
    markRect(0.56, 0.11, 0.33, 0.78, 0.02, "#ece2cc"),
    markLine(0.14, 0.86, 0.41, 0.14, 0.085, BLOCK_COLORS.timber_frame),
    markLine(0.58, 0.5, 0.87, 0.5, 0.085, BLOCK_COLORS.timber_frame),
    markLine(0.04, 0.06, 0.96, 0.06, 0.02, "rgba(255, 230, 200, 0.18)"),
    markDot(0.5, 0.06, 0.018, "rgba(30, 18, 10, 0.5)"),
    markDot(0.5, 0.94, 0.018, "rgba(30, 18, 10, 0.5)"),
    markDot(0.06, 0.5, 0.018, "rgba(30, 18, 10, 0.5)"),
    markDot(0.94, 0.5, 0.018, "rgba(30, 18, 10, 0.5)"),
  ],
  // Weathered silver boards of uneven width, a little warped, with streaks and rusty nails.
  driftwood_plank: [
    markLine(0.03, 0.27, 0.97, 0.3, 0.032, "rgba(60, 70, 72, 0.42)"),
    markLine(0.03, 0.56, 0.97, 0.53, 0.032, "rgba(60, 70, 72, 0.42)"),
    markLine(0.03, 0.8, 0.97, 0.82, 0.032, "rgba(60, 70, 72, 0.42)"),
    markLine(0.1, 0.12, 0.7, 0.14, 0.016, "rgba(255, 255, 255, 0.45)"),
    markLine(0.3, 0.42, 0.9, 0.4, 0.016, "rgba(255, 255, 255, 0.4)"),
    markLine(0.08, 0.68, 0.56, 0.67, 0.016, "rgba(255, 255, 255, 0.4)"),
    markLine(0.2, 0.2, 0.6, 0.21, 0.014, "rgba(80, 88, 90, 0.22)"),
    markLine(0.5, 0.92, 0.9, 0.91, 0.014, "rgba(80, 88, 90, 0.22)"),
    markDot(0.08, 0.15, 0.018, "rgba(150, 90, 60, 0.6)"),
    markDot(0.92, 0.42, 0.018, "rgba(150, 90, 60, 0.6)"),
    markDot(0.08, 0.68, 0.018, "rgba(150, 90, 60, 0.6)"),
    markDot(0.92, 0.9, 0.018, "rgba(150, 90, 60, 0.6)"),
  ],
  // Diamond panes of tinted sea glass in dark lead, one catching the light.
  sea_glass_pane: [
    markDot(0.5, 0.25, 0.13, "rgba(170, 225, 205, 0.55)"),
    markDot(0.25, 0.5, 0.13, "rgba(90, 160, 165, 0.4)"),
    markDot(0.75, 0.5, 0.13, "rgba(200, 235, 215, 0.5)"),
    markDot(0.5, 0.75, 0.13, "rgba(110, 175, 150, 0.45)"),
    markLine(0.04, 0.46, 0.46, 0.04, 0.035, "rgba(40, 60, 62, 0.6)"),
    markLine(0.04, 0.96, 0.96, 0.04, 0.035, "rgba(40, 60, 62, 0.6)"),
    markLine(0.54, 0.96, 0.96, 0.54, 0.035, "rgba(40, 60, 62, 0.6)"),
    markLine(0.04, 0.54, 0.46, 0.96, 0.035, "rgba(40, 60, 62, 0.6)"),
    markLine(0.04, 0.04, 0.96, 0.96, 0.035, "rgba(40, 60, 62, 0.6)"),
    markLine(0.54, 0.04, 0.96, 0.46, 0.035, "rgba(40, 60, 62, 0.6)"),
    markLine(0.42, 0.2, 0.52, 0.12, 0.03, "rgba(255, 255, 255, 0.7)"),
  ],
};

/** A wall or window's surface marks (`WALL_LOOK`), or none for any other block. */
export function wallMarks(block: BlockKind): readonly GroundMark[] {
  return Object.hasOwn(WALL_LOOK, block) ? WALL_LOOK[block as WallKind] : [];
}
