import {
  apply,
  type BlockKind,
  type Command,
  cloneWorld,
  commonsPlot,
  displayAt,
  landlocked,
  openingFacts,
  plotKey,
  plotOf,
  type Tile,
  TOWN_ACTOR,
  tileKey,
  type WorldState,
  walkTree,
  worldGround,
} from "@terrakin/sim";
import { type WayFacts, type WayPlan, wayLanding } from "./way-plan";

/**
 * Downtown's public ways from the server's side ([RFC 0046](../../../docs/rfcs/0046-streets.md),
 * Ryan's calls 3 to 5): the planner's facts read from the world, a plan turned into the town's
 * logged inputs, and the check that runs them on a copy of the world first. The staff route
 * `layWays` (`handlers/safety.ts`) runs them.
 */

/** The town's inputs that lay ways. */
export type WayCommand = Extract<
  Command,
  { type: "clear_block" | "open_way" | "close_way" | "rebuild_home" }
>;

/** The planner's facts from the world as it stands. */
export function wayFactsFrom(state: WorldState): WayFacts {
  const { config } = state;
  const downtown = state.lands?.home ?? { width: config.width, height: config.height };
  const commons = commonsPlot(state);
  const blocks = new Map(Object.entries(state.blocks)) as Map<string, BlockKind>;
  const crops = Object.keys(state.items?.crops ?? {});
  // A kiln with a pot in it can't be taken up (RFC 0047), so the town can't clear it either.
  const firing = Object.keys(state.items?.firings ?? {});
  const shown = [...blocks.keys()].filter((key) => {
    const [x, y] = key.split(",").map(Number) as [number, number];
    return displayAt(state, x, y) !== undefined;
  });
  // A surface with something on it (RFC 0050) and a pot set down (RFC 0047) are someone's things,
  // so the town routes round them rather than plan a clear the sim refuses. Ground floor only:
  // an upstairs key carries its floor before a colon.
  const ownedThings = [
    ...Object.keys(state.items?.tops ?? {}),
    ...Object.keys(state.items?.pots ?? {}),
  ].filter((key) => !key.includes(":"));
  const upstairs = Object.values(state.floors ?? {}).flatMap((layer) => [
    ...Object.keys(layer.blocks ?? {}),
    ...Object.keys(layer.ground ?? {}),
  ]);
  return {
    config,
    openings: openingFacts(state),
    downtown,
    commons,
    plots: Object.values(state.plots),
    townsfolk: new Set(state.townsfolk ?? []),
    hearths: Object.values(state.residents).flatMap((r) => (r.hearth ? [r.hearth] : [])),
    blocks,
    fixed: new Set([...crops, ...firing, ...shown, ...ownedThings]),
    facing: new Set(
      Object.keys(state.items?.hung ?? {}).flatMap((key) => {
        if (key.includes(":")) return [];
        const [x, y] = key.split(",");
        return [`${x},${y}`];
      }),
    ),
    upstairs: new Set(upstairs),
    listed: new Set(Object.keys(state.plotMarket?.listings ?? {})),
    ways: new Set(Object.keys(state.ways ?? {})),
    landing: wayLanding(config, downtown, commons),
  };
}

/**
 * The town's inputs that lay a plan, in the order they must go: each block on a way tile cleared
 * and given back to its plot's owner (`clear_block`, decision 0343), the way opened, then each home
 * it cut through rebuilt as its owner would build it, in plot tiles. A plan read again after a run
 * that stopped partway holds only what is left to do.
 */
export function wayInputs(plan: WayPlan, plotSize: number): WayCommand[] {
  return [
    ...plan.blocks.map((b): WayCommand => ({ type: "clear_block", x: b.x, y: b.y })),
    ...(plan.tiles.length > 0
      ? [
          {
            type: "open_way" as const,
            tiles: plan.tiles.map((t): [number, number] => [t.x, t.y]),
          },
        ]
      : []),
    ...plan.homes
      .filter((h) => h.rebuild.length > 0)
      .map(
        (h): WayCommand => ({
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
 * Closing way tiles (RFC 0046): the one `close_way` that takes them up, north to south, then west
 * to east, each once, and what it touches in a plan's shape: the tiles on each claimed plot with
 * whose it is, and the ones on free slots. Nothing is cleared or rebuilt.
 */
export function wayClose(
  state: WorldState,
  tiles: readonly Tile[],
): { command: Extract<WayCommand, { type: "close_way" }>; plan: WayPlan } {
  const keys = [...new Set(tiles.map((t) => tileKey(t.x, t.y)))];
  const sorted = keys
    .map((key) => {
      const [x, y] = key.split(",").map(Number) as [number, number];
      return { x, y };
    })
    .sort((a, b) => a.y - b.y || a.x - b.x);
  const plots = new Map<string, WayPlan["plots"][number]>();
  const free: Tile[] = [];
  for (const t of sorted) {
    const { px, py } = plotOf(state.config, t.x, t.y);
    const plot = state.plots[plotKey(px, py)];
    if (!plot) {
      free.push(t);
      continue;
    }
    const key = plotKey(px, py);
    const row = plots.get(key) ?? {
      px,
      py,
      ownerId: plot.ownerId,
      townsfolk: state.townsfolk?.includes(plot.ownerId) === true,
      tiles: [],
    };
    row.tiles.push(t);
    plots.set(key, row);
  }
  return {
    command: { type: "close_way", tiles: sorted.map((t): [number, number] => [t.x, t.y]) },
    plan: {
      tiles: sorted,
      plots: [...plots.values()].sort((a, b) => a.py - b.py || a.px - b.px),
      free,
      blocks: [],
      homes: [],
      unjoined: [],
    },
  };
}

/** Something about a plan that stops it being laid. */
export interface WayConflict {
  /** Which input, from 0, or undefined for what the plan does to the town as a whole. */
  input?: number;
  code: string;
  message: string;
  /** The plot's owner, when it is about one plot. */
  ownerId?: string;
  x?: number;
  y?: number;
}

/**
 * Every reason a plan can't be laid, from running all its inputs in order on a copy of the world:
 * each input the sim refuses (a block whose owner has no room for it, `inventory_full`, among
 * them, each listed so staff see them all before anything is laid), then what the whole plan
 * would do: a plot left with no way out that had one (`landlocked`), and a hearth that walked to
 * the Commons and wouldn't. Empty when it can be laid.
 */
export function wayConflicts(state: WorldState, inputs: readonly WayCommand[]): WayConflict[] {
  const copy = cloneWorld(state);
  const out: WayConflict[] = [];
  inputs.forEach((command, input) => {
    const result = apply(copy, { actor: TOWN_ACTOR, command });
    if (result.ok) return;
    const { code, message } = result.rejection;
    if (command.type === "clear_block") {
      const { px, py } = plotOf(copy.config, command.x, command.y);
      const ownerId = copy.plots[plotKey(px, py)]?.ownerId;
      out.push({
        input,
        code,
        message,
        x: command.x,
        y: command.y,
        ...(ownerId ? { ownerId } : {}),
      });
      // Read the rest as if staff had cleared it by hand, so one full inventory names itself
      // rather than every input after it.
      delete copy.blocks[tileKey(command.x, command.y)];
      return;
    }
    out.push({ input, code, message: `${command.type}: ${message}` });
  });
  const before = new Set(landlocked(state).map((p) => plotKey(p.px, p.py)));
  for (const p of landlocked(copy)) {
    if (before.has(plotKey(p.px, p.py))) continue;
    out.push({
      code: "landlocked",
      message: `Plot ${p.px},${p.py} would have no way out.`,
      ownerId: p.ownerId,
    });
  }
  const walking = (world: WorldState) => {
    const ground = worldGround(world);
    const { px, py } = commonsPlot(world);
    const S = world.config.plotSize;
    const radius = Math.max(world.config.width, world.config.height);
    return (from: Tile) =>
      walkTree(ground, from, radius).some(
        (n) => Math.floor(n.x / S) === px && Math.floor(n.y / S) === py,
      );
  };
  const walkedBefore = walking(state);
  const walksAfter = walking(copy);
  for (const r of Object.values(state.residents)) {
    if (!r.hearth || !walkedBefore(r.hearth) || walksAfter(r.hearth)) continue;
    out.push({
      code: "walled_in",
      message: `The hearth at ${r.hearth.x},${r.hearth.y} would no longer walk to the Commons.`,
      ownerId: r.id,
    });
  }
  return out;
}

/** What one owner hears about a plot of theirs a way crossed. */
export interface WayNotice {
  px: number;
  py: number;
  tiles: number;
  blocks: { x: number; y: number; block: string }[];
  rebuilt: boolean;
}

/**
 * What each owner hears, built up as inputs commit, so a run that stops partway tells them about
 * what did change and the run that finishes it tells them about the rest: never twice for one
 * change. Counts, tiles and kinds, never words.
 */
export class WayNotices {
  readonly #byPlot = new Map<string, { ownerId: string; notice: WayNotice }>();

  constructor(private readonly state: WorldState) {}

  #row(px: number, py: number) {
    const key = plotKey(px, py);
    let row = this.#byPlot.get(key);
    const ownerId = this.state.plots[key]?.ownerId;
    if (!row && ownerId) {
      row = { ownerId, notice: { px, py, tiles: 0, blocks: [], rebuilt: false } };
      this.#byPlot.set(key, row);
    }
    return row;
  }

  /** Note an input that committed; read before the next one changes the world. */
  committed(command: WayCommand, block?: BlockKind) {
    const { config } = this.state;
    if (command.type === "clear_block") {
      const { px, py } = plotOf(config, command.x, command.y);
      if (block) this.#row(px, py)?.notice.blocks.push({ x: command.x, y: command.y, block });
    } else if (command.type === "open_way") {
      for (const [x, y] of command.tiles) {
        const { px, py } = plotOf(config, x, y);
        const row = this.#row(px, py);
        if (row) row.notice.tiles += 1;
      }
    } else if (command.type === "rebuild_home") {
      const row = this.#row(command.px, command.py);
      if (row) row.notice.rebuilt = true;
    }
  }

  /** Every owner's notice, by plot, north to south, then west to east. */
  all(): { ownerId: string; notice: WayNotice }[] {
    return [...this.#byPlot.values()].sort(
      (a, b) => a.notice.py - b.notice.py || a.notice.px - b.notice.px,
    );
  }
}
