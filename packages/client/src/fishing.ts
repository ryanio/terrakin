/**
 * Fishing in the world (RFC 0023): which fishing rods you hold, from your things and then from the
 * `inventory` events that bring one or take one away, and the build bar's line for a pond. Pure,
 * so tests pin it. The rules are the sim's: `waterBeside` says whether you can cast where you
 * stand, and `blockNeeds` what a tile of pond takes, so the world holds back only what the server
 * would refuse (decision 0052).
 */
import type { WorldEvent } from "@terrakin/protocol";
import {
  blockNeeds,
  CATALOG,
  FISHING_ROD,
  type ItemKind,
  POND,
  type StackKind,
} from "@terrakin/sim";
import { type Holdings, heldOf } from "./build-palette";
import { thingCount } from "./things";

/** The ids of the fishing rods among the made things you hold. */
export function rodsIn(goods: readonly { id: string; kind: string }[]): ReadonlySet<string> {
  return new Set(goods.filter((g) => g.kind === FISHING_ROD).map((g) => g.id));
}

/**
 * The rods you hold after one of your `inventory` events: ones that arrived (made, given, bought in
 * the market) join, and ones that left go. The same set back when no rod moved.
 */
export function rodsAfter(
  rods: ReadonlySet<string>,
  e: Extract<WorldEvent, { type: "inventory" }>,
): ReadonlySet<string> {
  const came = (e.gained ?? []).filter((g) => g.kind === FISHING_ROD).map((g) => g.id);
  const went = (e.lost ?? []).filter((id) => rods.has(id));
  if (came.length === 0 && went.length === 0) return rods;
  const next = new Set(rods);
  for (const id of came) next.add(id);
  for (const id of went) next.delete(id);
  return next;
}

/** "3 wood": what a fishing rod takes at a workbench, from the catalog. */
const rodNeeds = () =>
  Object.entries(CATALOG[FISHING_ROD].recipe?.needs ?? {})
    .map(([kind, n]) => thingCount(kind as ItemKind, n))
    .join(" and ");

/** What to say when you'd cast with no rod in your things. */
export const noRodLine = () =>
  `Fishing takes a fishing rod. Make one at a workbench from ${rodNeeds()}.`;

/** What a tile of pond still needs from what you hold: empty when you can dig one. */
function pondShort(holdings: Holdings): { kind: StackKind; count: number }[] {
  return blockNeeds(POND.block).flatMap(([kind, n]) => {
    const missing = n - heldOf(holdings, kind);
    return missing > 0 ? [{ kind, count: missing }] : [];
  });
}

/** Whether you hold what a tile of pond takes, by the sim's own count. */
export const canDig = (holdings: Holdings) => pondShort(holdings).length === 0;

/** The line under the build bar's tabs for a pond: what a tile takes, and what you're short of. */
export function pondLine(holdings: Holdings): string {
  const cost = `Pond: ${thingCount("stone", POND.stone)} a tile, to fish beside.`;
  const short = pondShort(holdings);
  if (short.length === 0) return `${cost} You have enough.`;
  return `${cost} You need ${short.map((s) => thingCount(s.kind, s.count)).join(" and ")} more.`;
}
