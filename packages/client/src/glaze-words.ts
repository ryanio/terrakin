/**
 * What a glaze takes and where that comes from (RFC 0047), for the kiln sheet and the collection
 * book's Glazes page: "1 sea glass, found on the sand". Read from the sim's `GLAZE_COSTS` and its
 * finds table, so a glaze not yet used says how to get one. Pure, so tests pin it.
 */
import { FIND_GROUND } from "@terrakin/protocol";
import { FIND_SPAWNS, GLAZE_COSTS, type Glaze, isFindKind } from "@terrakin/sim";
import { thingCount } from "./things";

/** Where a glaze's thing comes from, after its count. */
function whereFrom(kind: string): string {
  if (isFindKind(kind)) {
    const spawn = FIND_SPAWNS.find((s) => s.kind === kind);
    return spawn ? `found ${FIND_GROUND[spawn.biome]}` : "found on walks";
  }
  return "grown in a planter";
}

/** What `glaze` takes and where it comes from: "1 sea glass, found on the sand". */
export function glazeCostLine(glaze: Glaze): string {
  const kind = GLAZE_COSTS[glaze];
  if (!kind) return "nothing, the clay's own color";
  return `${thingCount(kind, 1)}, ${whereFrom(kind)}`;
}

/** A glaze's name: "Sea glaze", "Bare clay". */
export const glazeName = (glaze: Glaze): string =>
  glaze === "bare" ? "Bare clay" : `${glaze.charAt(0).toUpperCase()}${glaze.slice(1)} glaze`;
