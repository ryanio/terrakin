import type { Command } from "@terrakin/sim";
import { DESIGN_SIZE, DESIGNS, designToPlan } from "./designs";
import { mapToPlan, type PlotNow } from "./maps";
import type { BuildAction } from "./schemas";

type BuildCommand = Extract<Command, { type: "build" }>;

/**
 * A `build` as the sim takes it (RFC 0032): its four lists as sent, or the lists a map or a design
 * expands to, or why not, as `invalid_plan`. The sim never sees a map or a design, so the log holds
 * lists and every plan is checked, priced, and skipped the same way. `plot` is the plot as it
 * stands, which `replace` reads to clear only what differs.
 */
export function buildCommand(
  action: Omit<BuildAction, "dry">,
  plot: { size: number; now: PlotNow },
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
    // Walls between tiles (RFC 0050) come only as lists.
    ...(plan.edges ? { edges: plan.edges } : {}),
    ...(plan.removeEdges ? { removeEdges: plan.removeEdges } : {}),
  });
  if (design !== undefined) {
    const found = DESIGNS.find((d) => d.id === design);
    if (!found) return { problem: `There's no design called ${design}. See GET /v1/designs.` };
    if (plot.size !== DESIGN_SIZE) {
      return {
        problem: `Designs are drawn for plots of ${DESIGN_SIZE} tiles, and this world's are ${plot.size}. Send a map or lists instead.`,
      };
    }
    const drawn = designToPlan(found, action);
    if ("problem" in drawn) return drawn;
    const read = mapToPlan(drawn.map, { size: plot.size, now: plot.now, replace });
    return "problem" in read ? read : { command: command(read.plan) };
  }
  if (map !== undefined) {
    const read = mapToPlan(map, { size: plot.size, now: plot.now, replace });
    return "problem" in read ? read : { command: command(read.plan) };
  }
  return { command: command({ blocks, ground, remove, lift, edges, removeEdges }) };
}
