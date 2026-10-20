/**
 * Which plots the "Claim plot" picker offers someone with no plot yet, and in what order: every
 * plot `settle` would take (the sim's own `settleProblem`, decision 0052), nearest to plots someone
 * lives on first, so a newcomer lands among neighbors. Pure, so tests pin it.
 *
 * Downtown comes before any island (RFC 0038, its open question 2): the center fills, and the land
 * across the water opens with a reason. The water between is never offered, because the sim would
 * turn it down.
 */
import type { WorldSnapshot } from "@terrakin/protocol";
import { directionOf, settleProblem } from "@terrakin/sim";
import { listOf } from "@terrakin/ui/format";
import { landNameAt, onLandPlot } from "./lands";

/** One plot the picker offers. */
export interface PlotPick {
  px: number;
  py: number;
  /** Plots to the nearest one someone lives on (a hearth on it), or Infinity with none. */
  near: number;
  /** Owners of the plots around it, north to south, then west to east, each once. */
  neighbors: string[];
  /** The land it's on, by name, when it isn't downtown (RFC 0038). The town writes these names. */
  land?: string;
}

/** What the picker reads from the world: a snapshot will do. */
type World = Pick<WorldSnapshot, "config" | "commons" | "lands"> & {
  plots: readonly { px: number; py: number; ownerId: string }[];
  residents: readonly { hearth?: { x: number; y: number } | null | undefined }[];
};

const key = (px: number, py: number) => `${px},${py}`;

/** Every plot `settle` would take for someone who owns none, best first. */
export function plotPicks(world: World): PlotPick[] {
  const { config, commons, lands } = world;
  // A town square is never claimable: downtown's is the Commons, and each land carries its own
  // (RFC 0038, decision 0332).
  const squares = new Set([
    key(commons.px, commons.py),
    ...(world.lands?.list ?? []).map((l) => key(l.square.px, l.square.py)),
  ]);
  const across = config.width / config.plotSize;
  const down = config.height / config.plotSize;
  const owners = new Map(world.plots.map((p) => [key(p.px, p.py), p.ownerId]));
  // A plot someone lives on has a hearth on it.
  const livedIn: { px: number; py: number }[] = [];
  for (const r of world.residents) {
    if (!r.hearth) continue;
    const px = Math.floor(r.hearth.x / config.plotSize);
    const py = Math.floor(r.hearth.y / config.plotSize);
    if (owners.has(key(px, py))) livedIn.push({ px, py });
  }
  const apart = (a: { px: number; py: number }, b: { px: number; py: number }) =>
    Math.max(Math.abs(a.px - b.px), Math.abs(a.py - b.py));
  const picks: (PlotPick & { fromCommons: number })[] = [];
  for (let py = 0; py < down; py++) {
    for (let px = 0; px < across; px++) {
      const claimed = owners.has(key(px, py));
      // The water between lands is no plot, and a town square is never claimable. The picker
      // asks the sim with both rather than deciding either itself (RFC 0038).
      const land = landNameAt(lands, px, py);
      const onLand = onLandPlot(config, lands, px, py);
      if (
        settleProblem(config, px, py, {
          claimed,
          ownsAPlot: false,
          square: squares.has(key(px, py)),
          onLand,
        })
      )
        continue;
      const here = { px, py };
      const neighbors: string[] = [];
      for (let y = py - 1; y <= py + 1; y++) {
        for (let x = px - 1; x <= px + 1; x++) {
          const owner = owners.get(key(x, y));
          if (owner && !neighbors.includes(owner)) neighbors.push(owner);
        }
      }
      picks.push({
        px,
        py,
        near: livedIn.reduce((best, p) => Math.min(best, apart(here, p)), Infinity),
        neighbors,
        ...(land === undefined ? {} : { land }),
        fromCommons: apart(here, commons),
      });
    }
  }
  picks.sort(
    (a, b) =>
      (a.land ? 1 : 0) - (b.land ? 1 : 0) ||
      a.near - b.near ||
      a.fromCommons - b.fromCommons ||
      a.py - b.py ||
      a.px - b.px,
  );
  return picks.map(({ fromCommons: _, ...pick }) => pick);
}

const COMPASS: Record<string, string> = {
  n: "north",
  ne: "northeast",
  e: "east",
  se: "southeast",
  s: "south",
  sw: "southwest",
  w: "west",
  nw: "northwest",
};

/**
 * Where a plot is: "Just north of the Commons", "2 plots northeast of the Commons", or, on an
 * island, the land's own name and the walk there (RFC 0038).
 */
export function pickWhere(
  pick: { px: number; py: number; land?: string },
  commons: { px: number; py: number },
) {
  if (pick.land) return `On ${pick.land}, across the bridge`;
  const dx = pick.px - commons.px;
  const dy = pick.py - commons.py;
  const d = Math.max(Math.abs(dx), Math.abs(dy));
  const dir = directionOf(Math.sign(dx), Math.sign(dy));
  if (!dir) return "The Commons";
  if (d === 1) return `Just ${COMPASS[dir]} of the Commons`;
  return `${d} plots ${COMPASS[dir]} of the Commons`;
}

/**
 * Who lives around a plot, by name: "Next to Ivy and Wren", "Next to Ivy, Wren, and 3 more", or
 * "No neighbors yet". Names are residents' words: the line only ever reaches the page as text.
 */
export function pickNeighbors(names: readonly string[]): string {
  if (names.length === 0) return "No neighbors yet";
  if (names.length <= 3) return `Next to ${listOf(names)}`;
  return `Next to ${listOf([...names.slice(0, 2), `${names.length - 2} more`])}`;
}
