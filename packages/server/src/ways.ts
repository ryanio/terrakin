import {
  apply,
  type BlockKind,
  type Command,
  cloneWorld,
  commonsPlot,
  displayAt,
  openingFacts,
  type Rejection,
  TOWN_ACTOR,
  type WorldState,
} from "@terrakin/sim";
import { type WayFacts, type WayPlan, wayLanding } from "./way-plan";

/**
 * Downtown's public ways from the server's side ([RFC 0046](../../../docs/rfcs/0046-streets.md),
 * Ryan's calls 3 to 5): the planner's facts read from the world, and a plan turned into the town's
 * logged inputs. The staff route `layWays` (`handlers/safety.ts`) runs them, dry first.
 */

/** The planner's facts from the world as it stands. */
export function wayFactsFrom(state: WorldState): WayFacts {
  const { config } = state;
  const downtown = state.lands?.home ?? { width: config.width, height: config.height };
  const commons = commonsPlot(state);
  const blocks = new Map(Object.entries(state.blocks)) as Map<string, BlockKind>;
  const crops = Object.keys(state.items?.crops ?? {});
  const shown = [...blocks.keys()].filter((key) => {
    const [x, y] = key.split(",").map(Number) as [number, number];
    return displayAt(state, x, y) !== undefined;
  });
  return {
    config,
    openings: openingFacts(state),
    downtown,
    commons,
    plots: Object.values(state.plots),
    townsfolk: new Set(state.townsfolk ?? []),
    hearths: Object.values(state.residents).flatMap((r) => (r.hearth ? [r.hearth] : [])),
    blocks,
    fixed: new Set([...crops, ...shown]),
    ways: new Set(Object.keys(state.ways ?? {})),
    landing: wayLanding(config, downtown, commons),
  };
}

/**
 * The town's inputs that lay a plan, in the order they must go: each block on a way tile cleared
 * and given back to its plot's owner (`clear_block`, decision 0343), the way opened, then each home
 * it cut through rebuilt as its owner would build it, in plot tiles. Empty for an empty plan.
 */
export function wayInputs(plan: WayPlan, plotSize: number): Command[] {
  if (plan.tiles.length === 0) return [];
  return [
    ...plan.blocks.map((b): Command => ({ type: "clear_block", x: b.x, y: b.y })),
    { type: "open_way", tiles: plan.tiles.map((t): [number, number] => [t.x, t.y]) },
    ...plan.homes
      .filter((h) => h.rebuild.length > 0)
      .map(
        (h): Command => ({
          type: "rebuild_home",
          px: h.px,
          py: h.py,
          blocks: h.rebuild.map((b) => ({
            x: b.x - h.px * plotSize,
            y: b.y - h.py * plotSize,
            block: b.block,
          })),
          remove: [],
        }),
      ),
  ];
}

/**
 * Every input of a plan tried in order against a copy of the world, so a plan is laid whole or
 * not at all: the first refusal, with the input it came from, or null when the sim takes them all.
 */
export function wayRefusal(
  state: WorldState,
  inputs: readonly Command[],
): { command: Command; rejection: Rejection } | null {
  const copy = cloneWorld(state);
  for (const command of inputs) {
    const result = apply(copy, { actor: TOWN_ACTOR, command });
    if (!result.ok) return { command, rejection: result.rejection };
  }
  return null;
}

/**
 * What each owner whose plot a plan changes hears, by owner: the plot, how many of its tiles are
 * now a way, the blocks given back, and whether the town rebuilt their home. Counts, tiles and
 * kinds, never words.
 */
export function wayNotices(plan: WayPlan): {
  ownerId: string;
  notice: {
    px: number;
    py: number;
    tiles: number;
    blocks: { x: number; y: number; block: string }[];
    rebuilt: boolean;
  };
}[] {
  return plan.plots.map((p) => ({
    ownerId: p.ownerId,
    notice: {
      px: p.px,
      py: p.py,
      tiles: p.tiles.length,
      blocks: plan.blocks
        .filter((b) => b.px === p.px && b.py === p.py)
        .map(({ x, y, block }) => ({ x, y, block })),
      rebuilt: plan.homes.some((h) => h.px === p.px && h.py === p.py && h.rebuild.length > 0),
    },
  }));
}
