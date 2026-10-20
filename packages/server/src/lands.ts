import {
  apply,
  type Command,
  cloneWorld,
  commonsPlot,
  DIRECTIONS,
  isSea,
  LANDS,
  onBridge,
  plotCenter,
  plotsLeft,
  stepFrom,
  TOWN_ACTOR,
  type WorldState,
  worldGround,
} from "@terrakin/sim";

/**
 * When the town opens new land, and what it looks like ([RFC 0038](../../../docs/rfcs/0038-new-lands.md)).
 *
 * The sim never counts the world's free plots to grow itself: `open_land` is a logged input from
 * the town carrying every number, so the rules only ever check what is in the log. This is the
 * server side of that: the count it watches, the names it hands out, and the geometry it plans.
 *
 * A land's name comes from the fixed table below, like a job's giver (`JOB_GIVERS`), so it is
 * never a resident's words, never needs a filter, and never needs a takedown.
 */

/**
 * The lands the town opens, in order, one per `open_land`. Fixed words of the team's own. When the
 * list runs out, nothing opens and the count simply stays low: a longer list is an edit here.
 */
const LANDS_TO_OPEN = [
  { id: "willowmere", name: "Willowmere" },
  { id: "harrowfen", name: "Harrowfen" },
  { id: "cobblereach", name: "Cobblereach" },
  { id: "saltmarch", name: "Saltmarch" },
] as const;

/** The shape of a new land. Plots and tiles, never a date. */
export const LAND_PLAN = {
  /** Plots a land is across and down: smaller than downtown, big enough to be worth crossing to. */
  plots: 5,
  /** Plot-widths of open water between the world's edge and the land. */
  channel: 1,
  /** Tile rows the bridge is wide, so two residents pass on it. */
  bridgeRows: 2,
} as const;

/**
 * The next land's `open_land`, or undefined when the town has no name left for one. The land sits
 * a plot-width of water east of the world's edge, `LAND_PLAN.plots` square, bridged across the
 * channel at the Commons' latitude, so walking there needs no new command and the bridge lands
 * level with the middle of town. Every number goes in the input, so replay never works any of it
 * out and tuning this never changes how a logged land replays.
 */
export function planLand(state: WorldState): Extract<Command, { type: "open_land" }> | undefined {
  const next = LANDS_TO_OPEN[state.lands?.list.length ?? 0];
  if (!next) return undefined;
  const { config } = state;
  const size = config.plotSize;
  const { plots: span, channel, bridgeRows } = LAND_PLAN;
  // Plot columns the world already covers. A world's size is whole plots (`validateConfig`) and
  // `open_land` keeps it so, so this divides exactly.
  const edge = config.width / size;
  const px0 = edge + channel;
  // Centered on the Commons' row, so the bridge arrives level with the middle of town.
  const commons = commonsPlot(state);
  const py0 = Math.max(0, commons.py - Math.floor((span - 1) / 2));
  const plots: [number, number][] = [];
  for (let px = px0; px < px0 + span; px++) {
    for (let py = py0; py < py0 + span; py++) plots.push([px, py]);
  }
  const bridge: [number, number][] = [];
  const y0 = plotCenter(config, commons.px, commons.py).y;
  for (let x = edge * size; x < px0 * size; x++) {
    for (let y = y0; y < y0 + bridgeRows; y++) bridge.push([x, y]);
  }
  const command = {
    type: "open_land" as const,
    land: next.id,
    name: next.name,
    width: (px0 + span) * size,
    height: Math.max(config.height / size, py0 + span) * size,
    plots,
    bridge,
  };
  return reaches(state, command) ? command : undefined;
}

/**
 * Whether a planned bridge actually gets anyone across: a walker can stand on each end, and each
 * end has a step onto land. The sim can't check this, because to it a bridge is a list of tiles
 * and it only refuses one that sits *on* land.
 *
 * The plan above can't fail this today: the channel is one plot wide, the bridge spans exactly it,
 * and the island's rows always cover the Commons' own row. It is here because `LAND_PLAN` is meant
 * to be tuned, and the input is logged forever: a wider channel or a taller island could lay a
 * bridge from water to water, and the land's plots would be claimable with the island unreachable
 * on foot, stranding whoever settled one. Opening no land is the better failure. The property this
 * protects is pinned where it can be: `lands.test.ts` walks off both ends of the planned bridge.
 */
function reaches(state: WorldState, command: Extract<Command, { type: "open_land" }>): boolean {
  // The world as the land would leave it, so the ground knows about its tiles.
  const after = cloneWorld(state);
  const opened = apply(after, { actor: TOWN_ACTOR, command });
  if (!opened.ok) return false;
  const ground = worldGround(after);
  const ends = [command.bridge[0], command.bridge[command.bridge.length - 1]];
  return ends.every((end) => {
    if (!end) return false;
    const [x, y] = end;
    if (ground.obstacle(x, y)) return false;
    return DIRECTIONS.some((dir) => {
      const step = stepFrom(ground, { x, y }, dir);
      return (
        step.ok && !isSea(after, step.to.x, step.to.y) && !onBridge(after, step.to.x, step.to.y)
      );
    });
  });
}

/**
 * Whether the town should open its next land now: the claimable plots left have fallen to
 * `LANDS.openAt`. A count, never a date, and never zero, because a world that waits for its last
 * plot turns someone away in the minutes between the last claim and the next tick.
 */
export function landDue(state: WorldState): boolean {
  return plotsLeft(state) <= LANDS.openAt;
}
