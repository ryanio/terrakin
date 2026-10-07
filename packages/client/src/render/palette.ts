import { BLOCK_COLORS, type BlockKind } from "@terrakin/sim";
import { BRAND_HEX } from "@terrakin/ui/brand";

// Storybook palette. Matches the tokens in packages/ui/src/tokens.css. The world's own colors
// (ground, blocks, the hearth) are in the sim's palette, shared with the plot photos drawn at the
// edge.
export const PAPER = BRAND_HEX.paper;
export const PAPER_EDGE = BRAND_HEX.paperEdge;
export const INK = BRAND_HEX.ink;
export const CLAY = BRAND_HEX.clay;
export const CLAY_DEEP = BRAND_HEX.clayDeep;

/** Blocks you grow or make things at (RFC 0005). */
export const WORKSHOP_BLOCKS: ReadonlySet<BlockKind> = new Set(["planter", "kitchen", "workbench"]);

/** Dark wood for posts, legs, and lantern caps. */
export const WOOD_DARK = "#6e4a2c";

export function blockColor(block: BlockKind): string {
  return BLOCK_COLORS[block];
}
