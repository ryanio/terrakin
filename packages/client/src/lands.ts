/**
 * The lands beyond downtown as a view reads them ([RFC 0038](../../../docs/rfcs/0038-new-lands.md)):
 * the snapshot's `lands` turned into the two questions a drawing or a walk asks, "is this water?"
 * and "is this a bridge?". The first is the sim's own rule (`seaFrom`), so the web draws the water
 * the server walks us around, rather than a copy of the rule that could drift from it.
 */
import type { WorldSnapshot } from "@terrakin/protocol";
import {
  claimLimit,
  isLandPlot,
  islandClaimIsFree,
  landedFrom,
  landsFromSnapshot,
  seaFrom,
  tileKey,
  type WorldConfig,
} from "@terrakin/sim";

/** The lands as the snapshot carries them. */
export type LandsView = NonNullable<WorldSnapshot["lands"]>;

/**
 * Whether a tile is open water, or undefined in a world of one grid, where there is none. Handed
 * to the sim's `groundOf` as it is, so a tap-to-walk route crosses by the bridge.
 */
export function seaOf(
  config: WorldConfig,
  lands: LandsView | undefined,
): ((x: number, y: number) => boolean) | undefined {
  return seaFrom(config, lands && landsFromSnapshot(lands));
}

/**
 * Whether a plot slot is land at all: inside downtown, or a slot some land brought in. The sim's
 * own rule, asked of the snapshot's facts, so the picker never offers a slot `settle` would refuse.
 * True everywhere in a world of one grid, which is every world today.
 */
export function onLandPlot(
  config: WorldConfig,
  lands: LandsView | undefined,
  px: number,
  py: number,
): boolean {
  return !lands || landedFrom(config, landsFromSnapshot(lands), px, py);
}

/** Whether a plot slot is one of a land's streets, which nobody claims (RFC 0046). */
export function onStreet(lands: LandsView | undefined, px: number, py: number): boolean {
  return (lands?.list ?? []).some((l) => (l.streets ?? []).some((p) => p.px === px && p.py === py));
}

/**
 * The name of the land a plot slot is on, one of its plots or its own square, or undefined
 * downtown and in the water.
 */
export function landNameAt(
  lands: LandsView | undefined,
  px: number,
  py: number,
): string | undefined {
  const here = (p: { px: number; py: number }) => p.px === px && p.py === py;
  return (lands?.list ?? []).find((l) => here(l.square) || l.plots.some(here))?.name;
}

/** Every bridge tile, by tileKey, so a view draws planks where the crossing runs. */
export function bridgeOf(lands: LandsView | undefined): Set<string> {
  return new Set((lands?.list ?? []).flatMap((l) => l.bridge.map((t) => tileKey(t.x, t.y))));
}

/**
 * How many plots `claim` would let a resident hold, claiming plot `at`: the sim's `claimLimit`,
 * with its island exception (decision 0427) asked of the snapshot's lands, so Claim plot shows
 * exactly where the claim would go through. `mine` is every plot the resident owns.
 */
export function claimLimitAt(
  config: Pick<WorldConfig, "maxPlotsPerResident">,
  plotMarketOpen: boolean,
  lands: LandsView | undefined,
  mine: readonly { px: number; py: number }[],
  at: { px: number; py: number },
): number {
  const facts = lands && landsFromSnapshot(lands);
  const island = (px: number, py: number) => isLandPlot(facts, px, py);
  const free = plotMarketOpen && islandClaimIsFree(island, mine, at.px, at.py);
  return claimLimit(config, plotMarketOpen, free);
}
