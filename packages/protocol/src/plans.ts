import type { Command } from "@terrakin/sim";
import type { BuildAction } from "./actions";
import { DESIGN_SIZE, DESIGNS, designToPlan } from "./designs";
import { type MapInput, mapToPlan, type PlanLists, type PlotNow } from "./maps";

type BuildCommand = Extract<Command, { type: "build" }>;

/**
 * A `build` as the sim takes it (RFC 0032): its lists as sent, or the lists a map or a design
 * expands to, or why not, as `invalid_plan`. The sim never sees a map or a design, so the log holds
 * lists and every plan is checked, priced, and skipped the same way. `plot` is the plot as it
 * stands, which `replace` reads to clear only what differs.
 */
export function buildCommand(
  action: Omit<BuildAction, "dry">,
  plot: {
    size: number;
    now: PlotNow;
    /** The plot's own current map legend and grades, the fallback a sent-back map reads by. */
    current?: Pick<MapInput, "legend" | "grades"> | undefined;
  },
): { command: BuildCommand } | { problem: string } {
  const { px, py, blocks, ground, remove, lift, edges, removeEdges, map, design, replace } = action;
  const lists = [blocks, ground, remove, lift, edges, removeEdges].some((l) => l !== undefined);
  const forms = [lists, map !== undefined, design !== undefined].filter(Boolean).length;
  if (forms > 1) {
    return { problem: "A plan is lists, a map, or a design. Send one of them." };
  }
  const chosen = (["walls", "windows", "path", "turn"] as const).filter(
    (k) => action[k] !== undefined,
  );
  if (design === undefined && chosen.length > 0) {
    return {
      problem: `${chosen.join(", ")} ${chosen.length === 1 ? "goes" : "go"} with a design.`,
    };
  }
  if (lists && replace !== undefined) {
    return {
      problem:
        "replace goes with a map or a design. A list plan says what to take away in remove and lift.",
    };
  }
  const command = (
    plan: {
      [K in "blocks" | "ground" | "remove" | "lift" | "edges" | "removeEdges"]?:
        | BuildCommand[K]
        | undefined;
    },
  ): BuildCommand => ({
    type: "build",
    px,
    py,
    ...(plan.blocks ? { blocks: plan.blocks } : {}),
    ...(plan.ground ? { ground: plan.ground } : {}),
    ...(plan.remove ? { remove: plan.remove } : {}),
    ...(plan.lift ? { lift: plan.lift } : {}),
    // Walls between tiles (RFC 0050): sent as lists, or read from a map's `edges` grid.
    ...(plan.edges ? { edges: plan.edges } : {}),
    ...(plan.removeEdges ? { removeEdges: plan.removeEdges } : {}),
  });
  if (design !== undefined) {
    const found = DESIGNS.find((d) => d.id === design);
    if (!found) return { problem: `There's no design called ${design}. See GET /v1/designs.` };
    if (plot.size < DESIGN_SIZE) {
      return {
        problem: `Designs are drawn for lots of ${DESIGN_SIZE} tiles, and this one is ${plot.size}. Send a map or lists instead.`,
      };
    }
    const drawn = designToPlan(found, action);
    if ("problem" in drawn) return drawn;
    // A design is drawn 8 by 8 and stands in the middle of a bigger lot (RFC 0052): it reads and
    // replaces only its own square, and its tiles move out by the margin.
    const off = Math.floor((plot.size - DESIGN_SIZE) / 2);
    const read = mapToPlan(drawn.map, {
      size: DESIGN_SIZE,
      now: shiftNow(plot.now, -off),
      replace,
    });
    return "problem" in read ? read : { command: command(shiftLists(read.plan, off)) };
  }
  if (map !== undefined) {
    const read = mapToPlan(map, {
      size: plot.size,
      now: plot.now,
      replace,
      current: plot.current,
    });
    return "problem" in read ? read : { command: command(read.plan) };
  }
  return { command: command({ blocks, ground, remove, lift, edges, removeEdges }) };
}

/** A list's tiles moved by `d` on both axes. */
const shifted = <T extends { x: number; y: number }>(list: readonly T[] | undefined, d: number) =>
  list?.map((t) => ({ ...t, x: t.x + d, y: t.y + d }));

/** Every tile of a plan's lists moved by `d` on both axes. */
function shiftLists(lists: PlanLists, d: number): PlanLists {
  const out: PlanLists = {};
  for (const key of ["blocks", "ground", "remove", "lift", "edges", "removeEdges"] as const) {
    const list = shifted(lists[key] as readonly { x: number; y: number }[] | undefined, d);
    if (list) (out as Record<string, unknown>)[key] = list;
  }
  return out;
}

/** What stands on a lot now, moved by `d` on both axes. */
const shiftNow = (now: PlotNow, d: number): PlotNow => ({
  blocks: shifted(now.blocks, d) ?? [],
  ground: shifted(now.ground, d) ?? [],
  ...(now.edges ? { edges: shifted(now.edges, d) ?? [] } : {}),
});
