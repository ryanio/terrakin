/**
 * Fishing in the world (RFC 0023): which fishing rods you hold, from your things and then from the
 * `inventory` events that bring one or take one away, and the build bar's line for a pond. Pure,
 * so tests pin it. The rules are the sim's: `waterBeside` says whether you can cast where you
 * stand, and `blockNeeds` what a tile of pond takes, so the world holds back only what the server
 * would refuse (decision 0052). What to say with no rod is `noRodLine` in `things.ts`.
 */
import type { WorldEvent } from "@terrakin/protocol";
import { FISHING_ROD, POND } from "@terrakin/sim";
import { blockShort, type Holdings } from "./build-palette";
import { gatherHint, thingCount } from "./things";

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

/** Whether you hold what a tile of pond takes, by the sim's own count. */
export const canDig = (holdings: Holdings) => blockShort(POND.block, holdings).length === 0;

/** The line under the build bar's tabs for a pond: what a tile takes, and what you're short of. */
export function pondLine(holdings: Holdings, clay = false): string {
  // Once pottery is open (RFC 0047), a pond is where clay comes from too.
  const cost = clay
    ? `Pond: ${thingCount("stone", POND.stone)} a tile, to fish beside, and clay lies beside it each day.`
    : `Pond: ${thingCount("stone", POND.stone)} a tile, to fish beside.`;
  const short = blockShort(POND.block, holdings);
  if (short.length === 0) return `${cost} You have enough.`;
  return `${cost} You need ${short.map((s) => thingCount(s.kind, s.count)).join(" and ")} more.${gatherHint(short.map((s) => s.kind))}`;
}

/** The pond chip's name on the build bar, its cost from the sim, and its clay once pottery's open. */
export const pondLabel = (clay: boolean): string =>
  `Pond (${thingCount("stone", POND.stone)} a tile, to fish beside${clay ? ", with clay beside it each day" : ""})`;
