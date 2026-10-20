/**
 * What to do about one townsfolk resident's roof (RFC 0041), from the `roof` on its plot in the
 * world snapshot. Pure, so the tests feed it fixtures; seed.ts does the reading and the writing.
 *
 * Every roof in the cast is covered in a free block (wood, stone, glass, leaf), so putting one up
 * takes nothing out of a resident's things and changing one gives the old covering straight back.
 * That is what keeps a rerun quiet and a change of mind free.
 */
import type { Action, WorldSnapshot } from "../../packages/protocol/src/index";
import type { BuildingBlock, RoofStyle } from "../../packages/sim/src/index";
import type { Plot } from "./plan.ts";

export type SetRoofAction = Extract<Action, { type: "set_roof" }>;

/** A roof as a persona wears it: a style, and the free block it's covered in. */
export interface RoofChoice {
  /** `flat` is no roof at all, so the cast never picks it. */
  style: Exclude<RoofStyle, "flat">;
  /** Wood, stone, glass, or leaf. A made material would mean gathering and crafting first. */
  material: BuildingBlock;
}

/** The roof a plot wears now, as `GET /v1/world` carries it. Absent while the home has none. */
export type RoofOnPlot = WorldSnapshot["plots"][number]["roof"];

/** What a roof step should do. */
export type RoofStep =
  /** The plot wears the persona's roof already. Nothing to send. */
  | { kind: "done"; roof: RoofChoice }
  /** Send `action`. `from` is the roof it wears now, absent when it has none. */
  | { kind: "set"; from: RoofOnPlot; want: RoofChoice; action: SetRoofAction };

/**
 * `want` is the persona's roof and `current` the one on its plot. A plot carries one roof, so the
 * two match when the style and the covering both do; anything else is the whole `set_roof` again,
 * since a style and a covering go up together.
 */
export function planRoof(plot: Plot, want: RoofChoice, current: RoofOnPlot): RoofStep {
  if (current && current.style === want.style && current.material === want.material) {
    return { kind: "done", roof: want };
  }
  return {
    kind: "set",
    from: current,
    want,
    action: { type: "set_roof", px: plot.px, py: plot.py, ...want },
  };
}

/** A roof in plain words: "a gable roof in glass". */
export const describeRoof = (roof: RoofChoice | NonNullable<RoofOnPlot>) =>
  `a ${roof.style} roof in ${roof.material}`;

/** One line for the run's output. */
export function describeRoofStep(step: RoofStep, send: boolean): string {
  if (step.kind === "done") return `roof: has ${describeRoof(step.roof)}`;
  const now = step.from ? describeRoof(step.from) : "flat";
  return `roof: ${now} now, ${send ? "setting" : "would set"} ${describeRoof(step.want)}`;
}
