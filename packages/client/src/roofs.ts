import {
  type BlockKind,
  ITEM_INFO,
  isMaterialKind,
  ROOF_MATERIALS,
  ROOF_STYLES,
  type RoofShape,
  type RoofStyle,
  roofNeeds,
  tileKey,
} from "@terrakin/sim";
import type { Holdings } from "./build-palette";
import type { Cutaway } from "./floors";
import { thingCount } from "./things";

/**
 * Roofs on the map (RFC 0041). The rule is the one RFC 0028 already shipped and `floors.ts` draws:
 * you see the floor you're on, and the rest of the world from above. A roof is part of "from
 * above", so the plot you stand on has its roof lifted away, whichever floor you're on, and every
 * other home keeps its roof. Figures are never hidden: someone under a roof is drawn faded, as
 * someone under flooring is. Pure, so tests pin it.
 */

/** A roof the map draws, with the plot it belongs to. */
export interface ShownRoof {
  px: number;
  py: number;
  shape: RoofShape;
}

/**
 * The roofs drawn for a viewer cut away at `cut`: every plot's but that one's. `keys` are plotKeys
 * ("px,py"), as the mirror holds them, and `roofAt` draws one over the walls as they stand. A town
 * can hold more roofs than a screen shows, and working one out reads a plot's walls, so `within`
 * (the plots on screen) is asked before `roofAt` rather than after.
 */
export function roofsShown(
  keys: Iterable<string>,
  roofAt: (px: number, py: number) => RoofShape | undefined,
  cut: Cutaway | undefined,
  within: (px: number, py: number) => boolean = () => true,
): ShownRoof[] {
  const shown: ShownRoof[] = [];
  for (const key of keys) {
    const [px, py] = key.split(",").map(Number) as [number, number];
    if (cut && px === cut.px && py === cut.py) continue;
    if (!within(px, py)) continue;
    const shape = roofAt(px, py);
    if (shape) shown.push({ px, py, shape });
  }
  return shown.sort((a, b) => a.py - b.py || a.px - b.px);
}

/** Every tile a drawn roof covers, so a figure standing under one is drawn faded. */
export function roofCover(shown: readonly ShownRoof[]): Set<string> {
  const covered = new Set<string>();
  for (const roof of shown) {
    for (const tile of roof.shape.tiles) covered.add(tileKey(tile.x, tile.y));
  }
  return covered;
}

/** A roof's style in people's words, the way the picker names it. */
export const ROOF_STYLE_WORDS: Record<RoofStyle, string> = {
  flat: "No roof",
  gable: "Gable",
  hip: "Hip",
  pitched: "Pitched",
};

/** What each style looks like, one line each, so a picker says it rather than showing it. */
export const ROOF_STYLE_ABOUT: Record<RoofStyle, string> = {
  flat: "Open to the sky, the way every home was before roofs.",
  gable: "Two slopes and a ridge down the middle.",
  hip: "Four slopes falling to every eave.",
  pitched: "One slope, high at the back and low at the front.",
};

/** The styles the picker offers, with `flat` last, since it takes a roof down. */
export const ROOF_PICKS: readonly RoofStyle[] = [
  ...ROOF_STYLES.filter((s) => s !== "flat"),
  "flat",
];

/** A covering the picker offers: the block, how many you hold, and how many more it takes. */
export interface RoofChoice {
  kind: BlockKind;
  /** How many of the block the covering takes. 0 for a free block, which roofs for free. */
  takes: number;
  held: number;
  /** How many more you'd need. 0 when you can roof in it now. */
  short: number;
}

/**
 * Every covering a roof can have, with what each takes from what you hold. A free block takes
 * nothing, so it's always there; a made material takes 8 of itself. `was` is the covering already
 * up, whose blocks come back, so swapping to it again costs nothing.
 */
export function roofChoices(holdings: Holdings, was?: BlockKind): RoofChoice[] {
  return ROOF_MATERIALS.map((kind) => {
    const takes = roofNeeds(kind).reduce((sum, [, n]) => sum + n, 0);
    const held = holdings.get(kind) ?? 0;
    const back = was === kind ? takes : 0;
    return { kind, takes, held, short: Math.max(0, takes - held - back) };
  });
}

/** A roof covering's name: a made material's own, else the block's word. */
export function roofMaterialName(kind: BlockKind): string {
  if (isMaterialKind(kind)) return ITEM_INFO[kind].name;
  return kind.charAt(0).toUpperCase() + kind.slice(1);
}

/** The line under the picker: what the covering costs, and what you're short of. */
export function roofLine(choice: RoofChoice): string {
  const name = roofMaterialName(choice.kind);
  if (!isMaterialKind(choice.kind)) return `${name}: free, like the wall it matches.`;
  const cost = `${name}: ${thingCount(choice.kind, choice.takes)}, given back when the roof comes down.`;
  if (choice.short === 0) return `${cost} You have ${choice.held}.`;
  return `${cost} You need ${thingCount(choice.kind, choice.short)} more.`;
}
