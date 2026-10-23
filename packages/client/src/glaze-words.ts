/**
 * Pottery in words (RFC 0047) for the kiln sheet and the collection book: what a glaze takes and
 * where that comes from ("1 sea glass, found on the sand", by the sim's `glazeWhere`), and how to
 * get a pottery kind not yet in the book. Pure, so tests pin it.
 */
import {
  CATALOG,
  GLAZE_COSTS,
  type Glaze,
  type GoodKind,
  glazeWhere,
  type ItemKind,
  isGoodKind,
  RECIPES,
} from "@terrakin/sim";
import { needsLine, thingCount } from "./things";

/** What `glaze` takes and where it comes from: "1 sea glass, found on the sand". */
export function glazeCostLine(glaze: Glaze): string {
  const kind = GLAZE_COSTS[glaze];
  const where = glazeWhere(glaze);
  if (!kind || !where) return "nothing, the clay's own color";
  return `${thingCount(kind, 1)}, ${where}`;
}

/** A glaze's name: "Sea glaze", "Bare clay". */
export const glazeName = (glaze: Glaze): string =>
  glaze === "bare" ? "Bare clay" : `${glaze.charAt(0).toUpperCase()}${glaze.slice(1)} glaze`;

/**
 * How to get a pottery kind not yet in the book, under its "?": clay where it lies, a pot or a pot
 * of tea from its recipe and station ("2 clay, at a kiln"), and a cup from someone else's tea.
 */
export function potteryHint(kind: ItemKind): string | null {
  if (kind === "clay") return "beside water, by a pond or the sea";
  if (kind === "cup_of_tea") return "a guest's keepsake from a host's tea";
  if (!isGoodKind(kind) || CATALOG[kind].family !== "pottery") return null;
  const recipe = RECIPES[kind as GoodKind];
  if (!recipe) return null;
  const teapot = kind === "pot_of_tea" ? "a teapot and " : "";
  return `${teapot}${needsLine(kind as GoodKind)}, at a ${recipe.station}`;
}
