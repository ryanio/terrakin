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
  }[];
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
  return lands.list.some((l) => l.plots.some(([x, y]) => x === px && y === py));
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
 * Whether a plot slot is on land at all: downtown, or a slot some open land brought in. A slot in
 * the water between lands is neither, and `settle` refuses it.
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
 * pick up. False everywhere in a world that never opened a land.
 */
export function isSea(state: WorldState, x: number, y: number): boolean {
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
 * inside the new bounds and outside every land already open, and the bridge tiles are in bounds
 * and on no land's plots, which is what makes them a crossing rather than a shortcut.
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
  for (const [x, y] of bridge) {
    if (x >= width || y >= height) {
      return refuse("server_only", `The bridge at ${x},${y} is outside the world this land makes.`);
    }
    const { px, py } = plotOf(grown, x, y);
    if (onLand(state, px, py) || slots.has(plotKey(px, py))) {
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
      state.lands.list.push({ id: land, name, plots, bridge });
    },
    event: { type: "land_opened", land, name, width, height, plots, bridge },
  });
}

/** The plots a land brought in, for a view: the land each claimable slot belongs to. */
export function landName(state: WorldState, px: number, py: number): string | undefined {
  return landOfPlot(state, px, py)?.name;
}
