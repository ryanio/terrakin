import { oneTimeSwitch, refuse } from "./check";
import { plotKey } from "./keys";
import type { Command, Land, Rejection, Tile, WorldConfig, WorldEvent, WorldState } from "./types";
import { inBounds, isCommons, plotOf } from "./world";

/**
 * New lands beyond the first grid ([RFC 0038](../../../docs/rfcs/0038-new-lands.md)). An island is
 * a region of the same coordinate plane, not a world of its own, so `tileKey`, `biomeAt`, `move`,
 * `visit`, `putter` and the routines all keep working on tiles with no change.
 *
 * Everything geometric arrives in the logged `open_land`: the world's new size, the plot slots the
 * land makes claimable, and the walkable tiles that bridge the water. The rules never work any of
 * it out for themselves, so the same log always builds the same world, and a better server-side
 * planner can never change how a logged input replays.
 *
 * Water is what's left: a tile in bounds that belongs to no land and isn't a bridge tile is sea,
 * and nobody walks on it. Before the first `open_land` there is no sea, because every tile in
 * bounds is downtown, so every older log walks exactly as it did.
 *
 * A land also brings a square, one plot slot nobody can claim, where its own shop counter and a
 * hall building stand, so an island is never a day's walk from the shop ([decision 0332](../../../docs/knowledge/decisions/0332-every-island-gets-a-counter-and-a-hall-door-of-its-own-on-a-.md)).
 * The hall takes no filings: proposals are filed downtown (decision 0352).
 * It is in the logged input like everything else geometric, because which slot is the square is the
 * kind of choice a better planner should be free to make differently for the next land without
 * changing how this one replays.
 *
 * A land may bring **streets** too ([RFC 0046](../../../docs/rfcs/0046-streets.md)): whole plot
 * slots of its own ground that nobody claims or builds on and anyone walks, laid so every plot has
 * a side on one. Which slots they are is in the logged input, like the square; what one is (land,
 * never a plot, nobody's) is the rule here and in `settle` and `claim`.
 */

type Mutation = () => WorldEvent[];
export type LandsChecked = Mutation | Rejection;

/** Every number here. */
export const LANDS = {
  /** The claimable plots left that make the server open the next land. */
  openAt: 9,
  /** A land's id and name are at most this long, so a view can always show them. */
  nameMax: 32,
  /** Plot slots a single land may carry, so one input can't be unbounded. */
  plotsMax: 400,
  /** Bridge tiles a single land may carry. */
  bridgeMax: 200,
} as const;

/**
 * What the lands rules need to know, which is exactly what the world snapshot carries: the
 * rectangle downtown is, and each open land's plot slots and bridge tiles. `LandsState` is one, so
 * a client reading `lands` off the wire answers these questions as the rules do.
 */
export interface LandsFacts {
  readonly home: { readonly width: number; readonly height: number };
  readonly list: readonly {
    readonly plots: readonly (readonly [number, number])[];
    readonly bridge: readonly (readonly [number, number])[];
    /** The land's square: its own ground, where its hall and its counter stand, never claimable. */
    readonly square: readonly [number, number];
    /** Its streets: its own ground nobody claims, between its plots (RFC 0046). */
    readonly streets?: readonly (readonly [number, number])[];
  }[];
}

/**
 * The lands as the world snapshot carries them: slots as `px`/`py` and tiles as `x`/`y`, where
 * the sim names both as `[x, y]` pairs. `landsFromSnapshot` turns them into `LandsFacts`.
 */
export interface SnapshotLands {
  readonly home: { readonly width: number; readonly height: number };
  readonly list: readonly {
    readonly plots: readonly { readonly px: number; readonly py: number }[];
    readonly bridge: readonly { readonly x: number; readonly y: number }[];
    readonly square: { readonly px: number; readonly py: number };
    readonly streets?: readonly { readonly px: number; readonly py: number }[] | undefined;
  }[];
}

/** The snapshot's lands as the rules read them, so every reader of the wire asks the same rules. */
export function landsFromSnapshot(lands: SnapshotLands): LandsFacts {
  return {
    home: lands.home,
    list: lands.list.map((l) => ({
      plots: l.plots.map((p) => [p.px, p.py] as const),
      bridge: l.bridge.map((t) => [t.x, t.y] as const),
      square: [l.square.px, l.square.py] as const,
      streets: (l.streets ?? []).map((p) => [p.px, p.py] as const),
    })),
  };
}

/** Whether a plot slot is inside downtown, the land that needs no `open_land`. */
function inHome(config: WorldConfig, lands: LandsFacts, px: number, py: number): boolean {
  const size = config.plotSize;
  return px >= 0 && py >= 0 && px * size < lands.home.width && py * size < lands.home.height;
}

/**
 * Whether a plot slot is land at all, from the facts alone: inside downtown, or a slot some open
 * land brought in. A slot in the water between lands is neither, and `settle` refuses it. The web
 * asks this of the snapshot's `lands` (`onLandPlot`), so there is one rule rather than a copy of
 * it that could answer differently.
 */
export function landedFrom(
  config: WorldConfig,
  lands: LandsFacts,
  px: number,
  py: number,
): boolean {
  if (inHome(config, lands, px, py)) return true;
  return lands.list.some(
    (l) =>
      l.plots.some(([x, y]) => x === px && y === py) ||
      (l.square[0] === px && l.square[1] === py) ||
      streetIn(l, px, py),
  );
}

/** Whether plot slot (`px`, `py`) is one of a land's streets, from the facts alone. */
function streetIn(
  land: { readonly streets?: readonly (readonly [number, number])[] },
  px: number,
  py: number,
): boolean {
  return (land.streets ?? []).some(([x, y]) => x === px && y === py);
}

/** Whether a tile bridges the water, from the facts alone. */
function bridged(lands: LandsFacts, x: number, y: number): boolean {
  return lands.list.some((l) => l.bridge.some(([bx, by]) => bx === x && by === y));
}

/** The land a plot slot belongs to, or undefined when no land claims it. */
export function landOfPlot(state: WorldState, px: number, py: number): Land | undefined {
  return state.lands?.list.find((l) => l.plots.some(([x, y]) => x === px && y === py));
}

/**
 * The land whose square a plot slot is, or undefined when it is nobody's square. A square is
 * ground the land brought in for its own hall and counter, and no resident ever claims it
 * (decision 0332).
 */
export function landOfSquare(state: WorldState, px: number, py: number): Land | undefined {
  return state.lands?.list.find((l) => l.square[0] === px && l.square[1] === py);
}

/**
 * The land whose street a plot slot is, or undefined when it is nobody's street. A street is ground
 * a land brought in for walking, and no resident ever claims it or builds on it (RFC 0046).
 */
function landOfStreet(state: WorldState, px: number, py: number): Land | undefined {
  return state.lands?.list.find((l) => streetIn(l, px, py));
}

/** Whether a plot slot is one of a land's streets (RFC 0046). */
export function isStreet(state: WorldState, px: number, py: number): boolean {
  return landOfStreet(state, px, py) !== undefined;
}

/**
 * The land a plot slot is part of, whatever kind of slot it is: one of its plots, its square, or
 * one of its streets. Undefined downtown and in the water. Someone standing on an island street is
 * on that island, so `nearestCounter` and `nearestPark` send them to its square (RFC 0046).
 */
export function landOfSlot(state: WorldState, px: number, py: number): Land | undefined {
  return landOfPlot(state, px, py) ?? landOfSquare(state, px, py) ?? landOfStreet(state, px, py);
}

/**
 * What a refusal says about a street: whose it is, that it belongs to everyone, and the nearest
 * plot that is there to claim, which the caller adds (RFC 0046).
 */
export function streetWords(state: WorldState, px: number, py: number): string {
  const land = landOfStreet(state, px, py);
  return `That's one of ${land?.name ?? "the town"}'s streets, which belong to everyone and nobody claims.`;
}

/**
 * What a refusal says about a town square: downtown's Commons, or a land's own, which names the
 * land and points at the plots that are there to claim.
 */
export function squareWords(state: WorldState, px: number, py: number): string {
  const land = landOfSquare(state, px, py);
  if (!land) return "The Commons belongs to everyone.";
  return `That's ${land.name}'s square, where its own hall and counter stand. Settle on one of its plots instead.`;
}

/**
 * Whether a plot slot is on land at all: downtown, a slot some open land brought in, or a land's
 * own square. A slot in the water between lands is none of those, and `settle` refuses it.
 */
export function onLand(state: WorldState, px: number, py: number): boolean {
  const { config, lands } = state;
  return landedFrom(config, lands ?? { home: config, list: [] }, px, py);
}

/** Whether a tile is a bridge tile of any open land. */
export function onBridge(state: WorldState, x: number, y: number): boolean {
  return state.lands !== undefined && bridged(state.lands, x, y);
}

/**
 * Whether a tile is open water, from the facts alone: in bounds, on no land's plots, and not a
 * bridge. Undefined in a world that never opened a land, where there is no sea, so `groundOf` is
 * handed nothing and such a world walks exactly as it always did. Past the world's edge is not
 * water but nothing at all, so a view can tell a shore from the edge of the map.
 */
export function seaFrom(
  config: WorldConfig,
  lands: LandsFacts | undefined,
): ((x: number, y: number) => boolean) | undefined {
  if (!lands) return undefined;
  return (x, y) => {
    if (!inBounds(config, x, y)) return false;
    const { px, py } = plotOf(config, x, y);
    return !landedFrom(config, lands, px, py) && !bridged(lands, x, y);
  };
}

/**
 * Whether a tile is sea. Nobody walks on it, nothing is built there, and nothing lies on it to
 * pick up, but a line cast from the shore goes in it (`isWater` in `fishing.ts`). False everywhere
 * in a world that never opened a land. It takes the two facts it reads rather than the whole
 * world, so a caller holding only those can ask.
 */
export function isSea(state: Pick<WorldState, "config" | "lands">, x: number, y: number): boolean {
  return seaFrom(state.config, state.lands)?.(x, y) === true;
}

/** Every plot slot on land, for a count of what's left to claim. */
export function landPlots(state: WorldState): Tile[] {
  const size = state.config.plotSize;
  const home: Tile[] = [];
  const rect = state.lands?.home ?? state.config;
  for (let px = 0; px * size < rect.width; px++) {
    for (let py = 0; py * size < rect.height; py++) home.push({ x: px, y: py });
  }
  const rest = (state.lands?.list ?? []).flatMap((l) => l.plots.map(([x, y]) => ({ x, y })));
  return [...home, ...rest];
}

/**
 * Plot slots anyone could still claim: on land, outside the Commons, and nobody's yet. The server
 * watches this to decide when to open the next land (`LANDS.openAt`); the sim never counts it to
 * grow itself, so no rule here reads it.
 */
export function plotsLeft(state: WorldState): number {
  // `isCommons` pins itself to the rectangle the world started as (5927c9a8), so this no longer
  // has to work the home rect out for itself.
  return landPlots(state).filter(
    ({ x: px, y: py }) => !isCommons(state, px, py) && state.plots[plotKey(px, py)] === undefined,
  ).length;
}

const whole = (n: unknown): boolean => Number.isInteger(n) && (n as number) >= 0;

/** Tiles as `[x, y]` pairs, each whole and in range, sorted, with no repeats. */
function tiles(list: unknown, max: number, size: number): [number, number][] | null {
  if (!Array.isArray(list) || list.length < 1 || list.length > max) return null;
  const seen = new Set<string>();
  const out: [number, number][] = [];
  for (const pair of list) {
    if (!Array.isArray(pair) || pair.length !== 2) return null;
    const [a, b] = pair as [unknown, unknown];
    if (!whole(a) || !whole(b)) return null;
    if ((a as number) >= size || (b as number) >= size) return null;
    const key = `${a},${b}`;
    if (seen.has(key)) return null;
    seen.add(key);
    out.push([a as number, b as number]);
  }
  const sorted = [...out].sort((p, q) => p[0] - q[0] || p[1] - q[1]);
  if (sorted.some((p, i) => p[0] !== out[i]?.[0] || p[1] !== out[i]?.[1])) return null;
  return out;
}

/**
 * `open_land`, which only TOWN_ACTOR sends, once per land id. It grows the world to the `width`
 * and `height` it carries, records the land's claimable plot slots and its bridge, and emits a
 * public `land_opened`. Refused, changing nothing, unless the world only grows, every slot is
 * inside the new bounds and outside every land already open, the bridge tiles are in bounds and on
 * no land's ground, which is what makes them a crossing rather than a shortcut, every street is
 * held to a plot slot's rules, and the square is the land's own ground, touching its plots or its
 * streets and nothing else.
 */
export function checkOpenLand(
  state: WorldState,
  command: Extract<Command, { type: "open_land" }>,
): LandsChecked {
  const { config } = state;
  const { land, name, width, height } = command;
  if (typeof land !== "string" || land.length < 1 || land.length > LANDS.nameMax) {
    return refuse("server_only", `A land's id is 1 to ${LANDS.nameMax} characters.`);
  }
  if (typeof name !== "string" || name.length < 1 || name.length > LANDS.nameMax) {
    return refuse("server_only", `A land's name is 1 to ${LANDS.nameMax} characters.`);
  }
  if (state.lands?.list.some((l) => l.id === land)) {
    return refuse("already_open", `${land} is already open.`);
  }
  // The world only ever grows, and only by whole plots, so every plot slot is a full plot.
  const size = config.plotSize;
  if (!whole(width) || !whole(height) || width < config.width || height < config.height) {
    return refuse("server_only", "A land only grows the world.");
  }
  if (width % size !== 0 || height % size !== 0) {
    return refuse("server_only", `The world's size is whole plots of ${size} tiles.`);
  }
  if (width === config.width && height === config.height) {
    return refuse("server_only", "A land brings new ground with it.");
  }
  const plots = tiles(command.plots, LANDS.plotsMax, Math.max(width, height) / size);
  if (!plots) {
    return refuse(
      "server_only",
      `A land's plots are sorted whole [px, py] pairs, up to ${LANDS.plotsMax}.`,
    );
  }
  const bridge = tiles(command.bridge, LANDS.bridgeMax, Math.max(width, height));
  if (!bridge) {
    return refuse(
      "server_only",
      `A land's bridge is sorted whole [x, y] pairs, up to ${LANDS.bridgeMax}.`,
    );
  }
  // Streets are optional: a land opened without them has none, as every land before RFC 0046.
  const streets =
    command.streets === undefined
      ? []
      : tiles(command.streets, LANDS.plotsMax, Math.max(width, height) / size);
  if (!streets) {
    return refuse(
      "server_only",
      `A land's streets are sorted whole [px, py] pairs, up to ${LANDS.plotsMax}.`,
    );
  }
  const square = tiles([command.square], 1, Math.max(width, height) / size)?.[0];
  if (!square) {
    return refuse("server_only", "A land's square is one whole [px, py] pair.");
  }
  const grown = { ...config, width, height };
  for (const [px, py] of plots) {
    if (px * size >= width || py * size >= height) {
      return refuse("server_only", `Plot ${px},${py} is outside the world this land makes.`);
    }
    if (onLand(state, px, py)) {
      return refuse("server_only", `Plot ${px},${py} is already on land.`);
    }
  }
  const slots = new Set(plots.map(([px, py]) => plotKey(px, py)));
  // A street is held to a plot slot's rules: in the world this land makes, on no land already, and
  // none of this land's plots.
  const ways = new Set<string>();
  for (const [px, py] of streets) {
    if (px * size >= width || py * size >= height) {
      return refuse("server_only", `Street ${px},${py} is outside the world this land makes.`);
    }
    if (onLand(state, px, py) || slots.has(plotKey(px, py))) {
      return refuse("server_only", `Street ${px},${py} is already on land.`);
    }
    ways.add(plotKey(px, py));
  }
  // The square is the land's own ground, so it is held to the plots' rules and to two more: it
  // touches the land it belongs to, side on, or no walk reaches its buildings (a diagonal step
  // past two corners of water is refused, `walk.ts`), and it touches nothing else, or it would be
  // a dry crossing of its own and the bridge below would be for nothing.
  const [sx, sy] = square;
  if (sx * size >= width || sy * size >= height) {
    return refuse("server_only", `The square ${sx},${sy} is outside the world this land makes.`);
  }
  if (onLand(state, sx, sy) || slots.has(plotKey(sx, sy)) || ways.has(plotKey(sx, sy))) {
    return refuse("server_only", `The square ${sx},${sy} is already on land.`);
  }
  const beside = [
    [sx - 1, sy],
    [sx + 1, sy],
    [sx, sy - 1],
    [sx, sy + 1],
  ] as const;
  // Its land is its plots and its streets: where streets cross, a square touches only streets.
  if (!beside.some(([px, py]) => slots.has(plotKey(px, py)) || ways.has(plotKey(px, py)))) {
    return refuse("server_only", `The square ${sx},${sy} doesn't touch the land it belongs to.`);
  }
  if (beside.some(([px, py]) => onLand(state, px, py))) {
    return refuse(
      "server_only",
      `The square ${sx},${sy} touches land across the water, so it would be a crossing of its own.`,
    );
  }
  for (const [x, y] of bridge) {
    if (x >= width || y >= height) {
      return refuse("server_only", `The bridge at ${x},${y} is outside the world this land makes.`);
    }
    const { px, py } = plotOf(grown, x, y);
    if (
      onLand(state, px, py) ||
      slots.has(plotKey(px, py)) ||
      ways.has(plotKey(px, py)) ||
      (px === sx && py === sy)
    ) {
      return refuse("server_only", `The bridge at ${x},${y} is on land, not across the water.`);
    }
  }
  return oneTimeSwitch({
    on: false,
    already: "",
    turnOn: () => {
      // The home rect is the world as it is *now*, so read it before growing the config: `config`
      // is `state.config` by reference, not a copy.
      state.lands ??= { home: { width: config.width, height: config.height }, list: [] };
      state.config.width = width;
      state.config.height = height;
      state.lands.list.push({
        id: land,
        name,
        plots,
        bridge,
        square,
        ...(streets.length > 0 ? { streets } : {}),
      });
    },
    event: {
      type: "land_opened",
      land,
      name,
      width,
      height,
      plots,
      bridge,
      square,
      ...(streets.length > 0 ? { streets } : {}),
    },
  });
}

/** The plots a land brought in, for a view: the land each claimable slot belongs to. */
export function landName(state: WorldState, px: number, py: number): string | undefined {
  return landOfPlot(state, px, py)?.name;
}
