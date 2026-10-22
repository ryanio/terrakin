import {
  apply,
  type Command,
  cloneWorld,
  commonsPlot,
  counterDoor,
  type Ground,
  LANDS,
  landSquare,
  openingFacts,
  openingsOf,
  plotCenter,
  plotKey,
  plotOf,
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

/**
 * The shape of a new land: a long cross of streets ([RFC 0046](../../../docs/rfcs/0046-streets.md)).
 * Plots and tiles, never a date.
 */
const LAND_PLAN = {
  /** Street slots on each side of the square, west and east. The west street meets the bridge. */
  across: 3,
  /** Street slots on each side of the square, north and south, as far as the world's top allows. */
  down: 4,
  /** Plot-widths of open water between the world's edge and the land. */
  channel: 1,
  /** Tile rows the bridge is wide, so two residents pass on it. */
  bridgeRows: 2,
} as const;

type OpenLand = Extract<Command, { type: "open_land" }>;

/**
 * The next land's `open_land`, or undefined when the town has no name left for one, or its plan
 * doesn't carry (`planProblem`).
 *
 * The land is a long cross: a plot-width of water east of the world's edge, then a street running
 * east from the bridge, a street running north and south through the middle of it, and the square
 * where they cross, where its own Town Hall building and shop counter stand. Every plot sits on a
 * street with a whole side, so no neighbor's block at a corner can close it in, and the bridge
 * lands on a street, so the walk home to the bridge never crosses a yard. The bridge crosses the
 * channel at the Commons' latitude, so walking there needs no new command. On terrakin.org's 9 by
 * 9 downtown it is 24 plots and 14 street slots, 7 slots across and 9 down.
 *
 * Every number goes in the input, so replay never works any of it out and tuning this never
 * changes how a logged land replays. There is no plan without streets: the island waits for its
 * streets rather than open the 5 by 5 the first plan laid (RFC 0046, Ryan's call 2).
 */
export function planLand(state: WorldState): OpenLand | undefined {
  const next = LANDS_TO_OPEN[state.lands?.list.length ?? 0];
  if (!next) return undefined;
  const { config } = state;
  const size = config.plotSize;
  const { across, down, channel, bridgeRows } = LAND_PLAN;
  // Plot columns the world already covers. A world's size is whole plots (`validateConfig`) and
  // `open_land` keeps it so, so this divides exactly.
  const edge = config.width / size;
  const west = edge + channel;
  const commons = commonsPlot(state);
  // The square sits on the Commons' row, so the bridge, which crosses at that latitude, lands on
  // the west street.
  const square: [number, number] = [west + across, commons.py];
  const [sx, sy] = square;
  const north = Math.min(down, sy);
  const streets: [number, number][] = [];
  for (let px = sx - across; px <= sx + across; px++) if (px !== sx) streets.push([px, sy]);
  for (let py = sy - north; py <= sy + down; py++) if (py !== sy) streets.push([sx, py]);
  // A plot is every slot beside a street, side on, that isn't a street or the square, and isn't
  // past either end of one: the west end is the bridge, and the other ends stay open water.
  const taken = new Set([plotKey(sx, sy), ...streets.map(([px, py]) => plotKey(px, py))]);
  const plotSet = new Map<string, [number, number]>();
  const add = (px: number, py: number) => {
    if (py < 0 || taken.has(plotKey(px, py))) return;
    plotSet.set(plotKey(px, py), [px, py]);
  };
  for (let px = sx - across; px <= sx + across; px++) {
    add(px, sy - 1);
    add(px, sy + 1);
  }
  for (let py = sy - north; py <= sy + down; py++) {
    add(sx - 1, py);
    add(sx + 1, py);
  }
  const byPlace = (a: [number, number], b: [number, number]) => a[0] - b[0] || a[1] - b[1];
  const plots = [...plotSet.values()].sort(byPlace);
  streets.sort(byPlace);
  const bridge: [number, number][] = [];
  const y0 = plotCenter(config, commons.px, commons.py).y;
  for (let x = edge * size; x < west * size; x++) {
    for (let y = y0; y < y0 + bridgeRows; y++) bridge.push([x, y]);
  }
  const command: OpenLand = {
    type: "open_land",
    land: next.id,
    name: next.name,
    width: (sx + across + 1) * size,
    height: Math.max(config.height / size, sy + down + 1) * size,
    plots,
    bridge,
    square,
    streets,
  };
  const problem = planProblem(state, command);
  if (!problem) return command;
  // A land is due, a name is left, and the plan doesn't carry: without a line this is silent,
  // and `switchOn` drops an undefined command exactly as it drops "not due yet", so nobody
  // would know the town had stopped opening land. It says this once a tick, which is as often
  // as the switch is tried and rare enough: `landDue` is false until the count falls again.
  console.warn(
    `Lands: ${next.id} is due and its plan doesn't carry (${problem}), so no land opened.`,
  );
  return undefined;
}

/**
 * Why a planned land shouldn't open, or undefined when it carries. Nothing opens on a plan that
 * fails, because the input is logged forever and a resident who settles on it in good faith would
 * be stranded. The sim can't check any of this: to it a bridge, a plot list, and a street list are
 * lists of tiles, and nothing works out what joins what. Three checks, in order:
 *
 * 1. **Streets.** A land with none is refused outright, so no tuning and no other caller can bring
 *    back an island where the bridge lands on a private plot (RFC 0046, Ryan's call 2).
 * 2. **A walk from downtown.** From a tile of the Commons, a walk over the sim's own step rule
 *    arrives at every slot the land brings. Two ways a plan goes wrong here: a bridge laid from
 *    water to water, and a slot joined to the rest of its island only at a corner, which no step
 *    crosses (a diagonal past two corners of water is refused).
 * 3. **A way out for every plot, when every plot is claimed.** With each of the land's plots
 *    counted as someone's, every plot has a way out (`openingsOf`, walked from every tile, as a
 *    claim's notes walk a plot with no hearth) onto ground that joins the bridge and the island's
 *    counter without crossing anyone's plot. That is what lets every island resident walk to the
 *    shop and home over the bridge on public ground, whoever claims what (RFC 0046).
 *
 * `lands.test.ts` pins each.
 */
export function planProblem(state: WorldState, command: OpenLand): string | undefined {
  if (!command.streets || command.streets.length === 0) return "it has no streets";
  // The world as the land would leave it, so the ground knows about its tiles.
  const after = cloneWorld(state);
  const opened = apply(after, { actor: TOWN_ACTOR, command });
  if (!opened.ok) return `the sim refused it: ${opened.rejection.message}`;
  const ground = worldGround(after);
  const size = after.config.plotSize;
  const radius = Math.max(after.config.width, after.config.height);
  // Somewhere in downtown to walk from. Not the spawn tile alone: the Commons is exactly where
  // the town builds, and a passed `commons_build` may put a lantern on the centre. Hanging the
  // whole thing on one tile would mean a Town Hall vote could stop any land from ever opening,
  // with no line anywhere saying so. Take the first tile of the Commons anyone can stand on.
  const from = standableInCommons(after, ground);
  if (!from) return "nobody can stand anywhere on the Commons";
  const arrived = tilesFrom(ground, from, radius);
  const slots = [...command.plots, command.square, ...command.streets];
  const stranded = slots.find(([px, py]) => !slotReached(arrived, size, px, py));
  if (stranded) return `no walk from downtown reaches ${stranded[0]},${stranded[1]}`;

  // Every plot of the land claimed, and every claimed slot is a wall to a walk on public ground.
  const mine = new Set(command.plots.map(([px, py]) => plotKey(px, py)));
  const base = openingFacts(after);
  const claimed = (px: number, py: number) => mine.has(plotKey(px, py)) || base.claimed(px, py);
  const facts = { ground: base.ground, claimed };
  const publicGround: Ground = {
    config: base.ground.config,
    obstacle: (x, y) => {
      const blocked = base.ground.obstacle(x, y);
      if (blocked) return blocked;
      const { px, py } = plotOf(base.ground.config, x, y);
      return claimed(px, py) ? "block" : undefined;
    },
  };
  const [bx, by] = command.bridge[command.bridge.length - 1] as [number, number];
  const fromBridge = tilesFrom(publicGround, { x: bx, y: by }, radius);
  const counter = counterDoor(after.config, landSquare(after.config, ...command.square));
  const reach = after.config.reach;
  const atCounter = [...fromBridge].some((key) => {
    const [x, y] = key.split(",").map(Number) as [number, number];
    return Math.max(Math.abs(x - counter.x), Math.abs(y - counter.y)) <= reach;
  });
  if (!atCounter) return "no public walk joins the bridge and the counter";
  const shut = command.plots.find(
    ([px, py]) => !openingsOf(facts, px, py, []).some((o) => fromBridge.has(`${o.to.x},${o.to.y}`)),
  );
  if (shut) return `plot ${shut[0]},${shut[1]} has no way out onto a street once the land fills`;
  return undefined;
}

/** Every tile a walk from `from` reaches, as `"x,y"`. */
function tilesFrom(ground: Ground, from: Tile, radius: number): Set<string> {
  return new Set(walkTree(ground, from, radius).map((n) => `${n.x},${n.y}`));
}

/** Whether a walk arrived anywhere on plot slot (`px`, `py`). */
function slotReached(arrived: Set<string>, size: number, px: number, py: number): boolean {
  for (let y = py * size; y < (py + 1) * size; y++) {
    for (let x = px * size; x < (px + 1) * size; x++) {
      if (arrived.has(`${x},${y}`)) return true;
    }
  }
  return false;
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
