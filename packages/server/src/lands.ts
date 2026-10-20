import {
  apply,
  type Command,
  cloneWorld,
  commonsPlot,
  type Ground,
  LANDS,
  plotCenter,
  plotsLeft,
  type Tile,
  TOWN_ACTOR,
  type WorldState,
  walkTree,
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
 * level with the middle of town. Its middle slot is its square, where its own Town Hall door and
 * shop counter stand, so the rest of its plots are a short walk from both. Every number goes in
 * the input, so replay never works any of it out and tuning this never changes how a logged land
 * replays.
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
  // The middle slot is the land's square, where its own hall and counter stand, so every one of
  // its plots is at most two plots from both ([decision 0332](../../../docs/knowledge/decisions/0332-every-island-gets-a-counter-and-a-hall-door-of-its-own-on-a-.md)).
  // Nobody claims a square, so it is left out of the claimable plots.
  const square: [number, number] = [px0 + Math.floor(span / 2), py0 + Math.floor(span / 2)];
  const plots: [number, number][] = [];
  for (let px = px0; px < px0 + span; px++) {
    for (let py = py0; py < py0 + span; py++) {
      if (px !== square[0] || py !== square[1]) plots.push([px, py]);
    }
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
    square,
  };
  if (reaches(state, command)) return command;
  // A land is due, a name is left, and the plan doesn't carry: without a line this is silent,
  // and `switchOn` drops an undefined command exactly as it drops "not due yet", so nobody
  // would know the town had stopped opening land. It says this once a tick, which is as often
  // as the switch is tried and rare enough: `landDue` is false until the count falls again.
  console.warn(`Lands: ${next.id} is due and its plan doesn't carry, so no land opened.`);
  return undefined;
}

/**
 * Whether a planned land is actually reachable on foot: from a tile in downtown, a walk over the
 * sim's own step rule arrives at every plot slot the land brings and at its square. The sim can't
 * check this, because to it a bridge and a plot list are lists of tiles and nothing works out
 * what joins what.
 *
 * The plan above can't fail this today: the channel is one plot wide, the bridge spans exactly it,
 * and the island's rows always cover the Commons' own row. It is here because `LAND_PLAN` is meant
 * to be tuned, and the input is logged forever. Two ways a tuned plan goes wrong, and both end
 * with a resident stranded on ground they settled in good faith: a bridge laid from water to
 * water, and a plot joined to the rest of its island only at a corner, which no step crosses (a
 * diagonal past two corners of water is refused). Checking the bridge's ends catches the first
 * and not the second, so this walks the whole land instead. Opening no land is the better
 * failure. `lands.test.ts` pins it.
 */
function reaches(state: WorldState, command: Extract<Command, { type: "open_land" }>): boolean {
  // The world as the land would leave it, so the ground knows about its tiles.
  const after = cloneWorld(state);
  const opened = apply(after, { actor: TOWN_ACTOR, command });
  if (!opened.ok) return false;
  const ground = worldGround(after);
  // Somewhere in downtown to walk from. Not the spawn tile alone: the Commons is exactly where
  // the town builds, and a passed `commons_build` may put a lantern on the centre. Hanging the
  // whole thing on one tile would mean a Town Hall vote could stop any land from ever opening,
  // with no line anywhere saying so. Take the first tile of the Commons anyone can stand on.
  const from = standableInCommons(after, ground);
  if (!from) return false;
  const size = after.config.plotSize;
  const reachable = walkTree(ground, from, Math.max(after.config.width, after.config.height));
  const arrived = new Set<string>();
  for (const node of reachable) arrived.add(`${node.x},${node.y}`);
  const slots: readonly (readonly [number, number])[] = [...command.plots, command.square];
  return slots.every(([px, py]) => {
    for (let y = py * size; y < (py + 1) * size; y++) {
      for (let x = px * size; x < (px + 1) * size; x++) {
        if (arrived.has(`${x},${y}`)) return true;
      }
    }
    return false;
  });
}

/** The first tile of the Commons a walker can stand on, reading north to south then west to east. */
function standableInCommons(state: WorldState, ground: Ground): Tile | undefined {
  const { px, py } = commonsPlot(state);
  const size = state.config.plotSize;
  for (let y = py * size; y < (py + 1) * size; y++) {
    for (let x = px * size; x < (px + 1) * size; x++) {
      if (!ground.obstacle(x, y)) return { x, y };
    }
  }
  return undefined;
}

/**
 * Whether the town should open its next land now: the claimable plots left have fallen to
 * `LANDS.openAt`. A count, never a date, and never zero, because a world that waits for its last
 * plot turns someone away in the minutes between the last claim and the next tick.
 */
export function landDue(state: WorldState): boolean {
  return plotsLeft(state) <= LANDS.openAt;
}
