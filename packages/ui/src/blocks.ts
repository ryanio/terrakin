/**
 * What taking a block off a plot costs its owner, by the sim's own rules (decision 0343), for the
 * staff app's Shut homes card, which can't import the sim itself.
 */
import { BUILDING_BLOCKS, blockNeeds, countOf, ITEM_INFO, isHeldBlock } from "@terrakin/sim";

/**
 * How much clearing a block costs its owner, cheapest first: 0 for a free wall, window, or hedge;
 * 1 for something held (decor, furniture, a made material), which comes back to their things; 2
 * for something they use where it stands (a kitchen, a workbench, a planter, a pond, stairs, a
 * pedestal).
 */
export function clearCost(block: string): 0 | 1 | 2 {
  if ((BUILDING_BLOCKS as readonly string[]).includes(block)) return 0;
  return isHeldBlock(block) ? 1 : 2;
}

/** A block's name in lower case: "chair", "stone wall", "kitchen". */
export function blockName(block: string): string {
  return isHeldBlock(block) ? ITEM_INFO[block].name.toLowerCase() : block.replaceAll("_", " ");
}

/** What taking a block up gives back to its owner, in words: "1 chair", "2 stone", or "nothing". */
export function blockBackWords(block: string): string {
  const needs = blockNeeds(block);
  return needs.length === 0 ? "nothing" : needs.map(([kind, n]) => countOf(kind, n)).join(" and ");
}
