import { isWhole, refuse } from "./check";
import { displayAt } from "./display";
import { isFurnitureKind } from "./furniture";
import { GROUND_KINDS, type GroundKind, groundNeeds, isGroundKind } from "./ground";
import {
  addStack,
  blockNeeds,
  closed,
  countOf,
  GATHER_HINT,
  held,
  ITEMS,
  inventory,
  inventoryEvent,
  inventorySize,
  isDecorKind,
  isResourceKind,
  STACK_KINDS,
  type StackKind,
} from "./items";
import { plotKey, tileKey } from "./keys";
import {
  blockKindProblem,
  blockSupportProblem,
  blocksOn,
  floorProblem,
  groundOn,
  layerFor,
  liftProblem,
  removeProblem,
  STOREYS,
  type StoreyView,
  stairwellProblem,
  standingStorey,
  storeyField,
  storeyOf,
} from "./storeys";
import {
  BLOCK_KINDS,
  type BlockKind,
  type Command,
  type Plot,
  type Rejection,
  type ResidentId,
  type Tile,
  type WorldConfig,
  type WorldEvent,
  type WorldState,
} from "./types";
import { canBuildOn, plotInBounds } from "./world";

/**
 * `build` (RFC 0016): a plan of blocks and ground placed on one plot in one input, from anywhere,
 * with no walking and no reach, like `build_starter_home`. Tiles in a plan count from the plot's
 * north-west corner, so the same plan builds the same thing on any plot.
 *
 * `planBuild` is the whole rule: it checks a plan against the world as it is and works out every
 * change, without changing anything. The sim commits what it found, and the server reports it
 * (`buildSummary`), so the answer an agent reads is the one the sim acted on. What depends on the
 * plan itself refuses the whole plan: the plot, its shape, the kinds, the materials, and the room
 * in your things. What depends on things that move while a plan is written is skipped and
 * reported: someone standing on a tile, a hearth, a tile that already has something, and, with
 * storeys (RFC 0028), what holds something up or has nothing holding it up.
 *
 * A plan's tiles may name a `storey`. They go in a fixed order, so what holds a storey up works
 * in one call and older plans build as they did: removals and lifts from the top storey down,
 * then the ground floor's blocks and ground, then each storey up's floors and then its blocks.
 * Each tile is checked against the plan's running view of the world, with what came before it.
 */

/** Why a tile in a plan was left alone. */
export const BUILD_SKIPS = [
  /** It already has exactly that. */
  "same",
  /** It has a different block or ground, and the plan didn't take it away. */
  "occupied",
  /** Someone is standing there (blocks only). */
  "standing",
  /** It's someone's hearth (blocks only). */
  "hearth",
  /** Nothing there to take away. */
  "empty",
  /** A planter with something growing in it can't go. */
  "growing",
  /** A pedestal or frame with something on display can't go. */
  "on_display",
  /** Nothing would hold it up: no wall below a floor upstairs, no floor or wall under a block (RFC 0028). */
  "unsupported",
  /** Taking it away would leave something floating, or someone on stairs without them (RFC 0028). */
  "holds_up",
] as const;
export type BuildSkip = (typeof BUILD_SKIPS)[number];

/** Which of a plan's lists a skipped tile came from. */
export const BUILD_PARTS = ["remove", "lift", "block", "ground"] as const;
export type BuildPart = (typeof BUILD_PARTS)[number];

export interface BuildSkipped {
  /** As the plan gave it: tiles from the plot's north-west corner. */
  x: number;
  y: number;
  /** Above the ground floor only (RFC 0028). */
  storey?: number;
  what: BuildPart;
  why: BuildSkip;
}

/** A world tile a plan changes, with `storey` only above the ground floor. */
type StoreyTile = Tile & { storey?: number };

/** Everything a plan will do, worked out against the world as it is. World tiles. */
export interface BuildPlan {
  px: number;
  py: number;
  removed: StoreyTile[];
  lifted: StoreyTile[];
  placed: (StoreyTile & { block: BlockKind })[];
  laid: (StoreyTile & { ground: GroundKind })[];
  /** The net change to the builder's things, in catalog order: negative uses, positive gives back. */
  changes: { kind: StackKind; amount: number }[];
  skipped: BuildSkipped[];
}

/** What a plan did, or would do, as the server reports it. */
export interface BuildSummary {
  px: number;
  py: number;
  placed: number;
  removed: number;
  laid: number;
  lifted: number;
  /** What it takes from your things, net. */
  uses: { kind: StackKind; count: number }[];
  /** What it gives back to your things, net. */
  returns: { kind: StackKind; count: number }[];
  skipped: BuildSkipped[];
}

/** The most entries in each of a plan's lists: a whole plot on every storey a plot may have. */
export const planMax = (config: WorldConfig) =>
  config.plotSize * config.plotSize * (1 + STOREYS.max);

/** Storeys from the top down to the ground floor, the order a plan takes things away in. */
const DOWN = Array.from({ length: STOREYS.max + 1 }, (_, i) => STOREYS.max - i);
/** Storeys from the ground floor up, the order a plan builds in. */
const UP = [...DOWN].reverse();

/** Plots `actor` may build on, owned first, each north to south then west to east. */
function buildablePlots(state: WorldState, actor: ResidentId): Plot[] {
  const order = (a: Plot, b: Plot) => a.py - b.py || a.px - b.px;
  const plots = Object.values(state.plots).sort(order);
  return [
    ...plots.filter((p) => p.ownerId === actor),
    ...plots.filter((p) => p.ownerId !== actor && canBuildOn(p, actor)),
  ];
}

const WHY_WORDS: Record<BuildSkip, string> = {
  same: "already like that",
  occupied: "something else is there",
  standing: "someone is standing there",
  hearth: "it's a hearth",
  empty: "nothing there to take away",
  growing: "something is growing there",
  on_display: "something is on display there",
  unsupported: "nothing holds it up",
  holds_up: "it holds something up",
};

/** A list from the plan: absent is empty, anything but a list is a problem. */
function listOf(value: unknown): unknown[] | null {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : null;
}

/** A tile in a plan, on a storey: absent or 0 is the ground floor. */
type PlanSpot = Tile & { storey: number };

/**
 * A tile in a plan: whole numbers on the plot, on a storey the plot has, or why not. A storey that
 * isn't one refuses the plan as `invalid_plan`; one past the top or not added yet as `too_high` or
 * `no_storey`, as a single action is.
 */
function planTile(entry: unknown, size: number, plot: Plot | undefined): PlanSpot | Rejection {
  if (typeof entry !== "object" || entry === null) {
    return refuse("invalid_plan", "Each tile in a plan has an x and a y.");
  }
  const { x, y } = entry as { x?: unknown; y?: unknown };
  if (!isWhole(x) || !isWhole(y) || x < 0 || y < 0 || x >= size || y >= size) {
    return refuse(
      "invalid_plan",
      `(${String(x)}, ${String(y)}) isn't on the plot: x and y count tiles from its north-west corner, 0 to ${size - 1}.`,
    );
  }
  const storey = storeyOf(plot, (entry as { storey?: unknown }).storey);
  if (typeof storey === "number") return { x, y, storey };
  if (storey.code === "out_of_bounds") return refuse("invalid_plan", storey.message);
  return storey;
}

/** A tile's place in the plan's running view: the tile key, with the storey above the ground. */
const spotKey = (storey: number, key: string) => (storey === 0 ? key : `${storey}:${key}`);

/** How a tile reads in a refusal: "(3, 4)", or "(3, 4) on storey 1". */
const spotWords = (t: { x: number; y: number; storey?: number }) =>
  `(${t.x}, ${t.y})${t.storey ? ` on storey ${t.storey}` : ""}`;

/** Where a refusal can send a builder for what they're short of. */
function shortHint(kinds: readonly StackKind[]): string {
  const hints: string[] = [];
  if (kinds.some((k) => isResourceKind(k))) hints.push(GATHER_HINT);
  if (kinds.some((k) => k === "flower" || k === "herb")) {
    hints.push("Flowers and herbs grow in a planter.");
  }
  if (kinds.some((k) => isFurnitureKind(k)))
    hints.push("Make furniture at a workbench with craft.");
  if (kinds.some((k) => isDecorKind(k))) hints.push("Decor comes from the town shop (shop_buy).");
  return hints.length > 0 ? ` ${hints.join(" ")}` : "";
}

/** Check a `build` against the world as it is, and work out everything it does. Reads only. */
export function planBuild(
  state: WorldState,
  actor: ResidentId,
  command: Extract<Command, { type: "build" }>,
): BuildPlan | Rejection {
  const { config } = state;
  if (!state.residents[actor]) return refuse("not_joined", "Join the world first.");
  const { px, py } = command;
  if (!plotInBounds(config, px, py)) {
    return refuse("out_of_bounds", "That plot is outside the world.");
  }
  const plot = state.plots[plotKey(px, py)];
  if (!canBuildOn(plot, actor)) {
    const mine = buildablePlots(state, actor);
    if (mine.length === 0) {
      return refuse(
        "no_plot",
        "You need a plot first. Find a free one in GET /v1/world and settle there.",
      );
    }
    const where = mine.map((p) => `px ${p.px}, py ${p.py}`).join("; ");
    return refuse(
      "not_your_plot",
      `You can only build on your own plot, or one shared with you. You can build on ${where}.`,
    );
  }

  // The plan's shape: whole tiles on the plot, each at most once in each list.
  const S = config.plotSize;
  const max = planMax(config);
  const lists = {
    remove: listOf(command.remove),
    lift: listOf(command.lift),
    blocks: listOf(command.blocks),
    ground: listOf(command.ground),
  };
  for (const [name, list] of Object.entries(lists)) {
    if (list === null) return refuse("invalid_plan", `${name} is a list of tiles.`);
    if (list.length > max) {
      return refuse(
        "invalid_plan",
        `A plan lists at most ${max} tiles in each of blocks, ground, remove, and lift.`,
      );
    }
  }
  const all = lists as Record<keyof typeof lists, unknown[]>;
  if (all.remove.length + all.lift.length + all.blocks.length + all.ground.length === 0) {
    return refuse(
      "invalid_plan",
      "A plan needs at least one tile in blocks, ground, remove, or lift.",
    );
  }
  const tiles: Record<keyof typeof lists, PlanSpot[]> = {
    remove: [],
    lift: [],
    blocks: [],
    ground: [],
  };
  for (const name of ["remove", "lift", "blocks", "ground"] as const) {
    const seen = new Set<string>();
    for (const entry of all[name]) {
      const t = planTile(entry, S, plot);
      if ("code" in t) return t;
      const key = spotKey(t.storey, tileKey(t.x, t.y));
      if (seen.has(key)) return refuse("invalid_plan", `${spotWords(t)} is in ${name} twice.`);
      seen.add(key);
      tiles[name].push(t);
    }
  }
  const blockKinds: BlockKind[] = [];
  for (const [i, entry] of all.blocks.entries()) {
    const block = (entry as { block?: unknown }).block;
    if (!(BLOCK_KINDS as readonly unknown[]).includes(block)) {
      return refuse(
        "unknown_item",
        `${String(block)} isn't a block. Blocks: ${BLOCK_KINDS.join(", ")}.`,
      );
    }
    // What a kind can never be on a storey refuses the plan: a planter upstairs, stairs on the top.
    const never = blockKindProblem(plot, (tiles.blocks[i] as PlanSpot).storey, block as BlockKind);
    if (never) return never;
    blockKinds.push(block as BlockKind);
  }
  const groundKinds: GroundKind[] = [];
  for (const entry of all.ground) {
    const ground = (entry as { ground?: unknown }).ground;
    if (!isGroundKind(ground)) {
      return refuse(
        "unknown_item",
        `${String(ground)} isn't a path or floor. Ground: ${GROUND_KINDS.join(", ")}.`,
      );
    }
    groundKinds.push(ground);
  }

  // What happens to each tile, in the plan's order, against its running view of the world.
  const x0 = px * S;
  const y0 = py * S;
  const hearths = new Set<string>();
  const standing = new Set<string>();
  for (const r of Object.values(state.residents)) {
    if (r.hearth) hearths.add(tileKey(r.hearth.x, r.hearth.y));
    if (r.online) standing.add(spotKey(standingStorey(r), tileKey(r.x, r.y)));
  }
  const blocksNow = new Map<string, BlockKind | undefined>();
  const groundNow = new Map<string, GroundKind | undefined>();
  const view: StoreyView = {
    block: (storey, key) => {
      const at = spotKey(storey, key);
      return blocksNow.has(at) ? blocksNow.get(at) : blocksOn(state, storey)[key];
    },
    ground: (storey, key) => {
      const at = spotKey(storey, key);
      return groundNow.has(at) ? groundNow.get(at) : groundOn(state, storey)[key];
    },
  };
  const delta = new Map<StackKind, number>();
  const add = (kind: StackKind, n: number) => delta.set(kind, (delta.get(kind) ?? 0) + n);
  const plan: BuildPlan = {
    px,
    py,
    removed: [],
    lifted: [],
    placed: [],
    laid: [],
    changes: [],
    skipped: [],
  };
  const skip = (t: PlanSpot, what: BuildPart, why: BuildSkip) =>
    plan.skipped.push({ x: t.x, y: t.y, ...storeyField(t.storey), what, why });
  /** A plan's entries on one storey, with their index in the list. */
  const on = (list: PlanSpot[], storey: number) =>
    [...list.entries()].filter(([, t]) => t.storey === storey);

  const removeOn = (storey: number) => {
    for (const [, t] of on(tiles.remove, storey)) {
      const x = x0 + t.x;
      const y = y0 + t.y;
      const key = tileKey(x, y);
      const block = view.block(storey, key);
      // Crops and displays are on the ground floor, keyed by their tile alone.
      if (block === undefined) skip(t, "remove", "empty");
      else if (storey === 0 && state.items?.crops[key]) skip(t, "remove", "growing");
      else if (storey === 0 && displayAt(state, x, y)) skip(t, "remove", "on_display");
      else if (removeProblem(state, x, y, storey, view)) skip(t, "remove", "holds_up");
      else {
        plan.removed.push({ x, y, ...storeyField(storey) });
        blocksNow.set(spotKey(storey, key), undefined);
        // Decor and furniture come back as themselves, a pond as its stone (RFC 0023).
        for (const [kind, n] of blockNeeds(block)) add(kind, n);
      }
    }
  };
  const liftOn = (storey: number) => {
    for (const [, t] of on(tiles.lift, storey)) {
      const x = x0 + t.x;
      const y = y0 + t.y;
      const key = tileKey(x, y);
      const ground = view.ground(storey, key);
      if (ground === undefined) skip(t, "lift", "empty");
      else if (liftProblem(state, x, y, storey, view)) skip(t, "lift", "holds_up");
      else {
        plan.lifted.push({ x, y, ...storeyField(storey) });
        groundNow.set(spotKey(storey, key), undefined);
        for (const [kind, n] of groundNeeds(ground)) add(kind, n);
      }
    }
  };
  const placeOn = (storey: number) => {
    for (const [i, t] of on(tiles.blocks, storey)) {
      const block = blockKinds[i] as BlockKind;
      const x = x0 + t.x;
      const y = y0 + t.y;
      const key = tileKey(x, y);
      const there = view.block(storey, key);
      // Hearths are on the ground floor; who stands where is on their own storey.
      if (there === block) skip(t, "block", "same");
      else if (there !== undefined) skip(t, "block", "occupied");
      else if (storey === 0 && hearths.has(key)) skip(t, "block", "hearth");
      else if (standing.has(spotKey(storey, key))) skip(t, "block", "standing");
      else if (stairwellProblem(state, x, y, storey, view)) skip(t, "block", "occupied");
      else {
        const unheld = blockSupportProblem(state, x, y, storey, block, view);
        if (unheld) {
          // Stairs come up through the tile above them; anything else has nothing under it.
          skip(t, "block", unheld.code === "tile_occupied" ? "occupied" : "unsupported");
          continue;
        }
        plan.placed.push({ x, y, ...storeyField(storey), block });
        blocksNow.set(spotKey(storey, key), block);
        for (const [kind, n] of blockNeeds(block)) add(kind, -n);
      }
    }
  };
  const layOn = (storey: number) => {
    for (const [i, t] of on(tiles.ground, storey)) {
      const ground = groundKinds[i] as GroundKind;
      const x = x0 + t.x;
      const y = y0 + t.y;
      const key = tileKey(x, y);
      const there = view.ground(storey, key);
      if (there === ground) skip(t, "ground", "same");
      else if (there !== undefined) skip(t, "ground", "occupied");
      else if (stairwellProblem(state, x, y, storey, view)) skip(t, "ground", "occupied");
      else if (floorProblem(state, x, y, storey, view)) skip(t, "ground", "unsupported");
      else {
        plan.laid.push({ x, y, ...storeyField(storey), ground });
        groundNow.set(spotKey(storey, key), ground);
        for (const [kind, n] of groundNeeds(ground)) add(kind, -n);
      }
    }
  };
  for (const storey of DOWN) {
    removeOn(storey);
    liftOn(storey);
  }
  for (const storey of UP) {
    // The ground floor as plans always went, blocks then ground; upstairs a floor comes first.
    if (storey === 0) {
      placeOn(storey);
      layOn(storey);
    } else {
      layOn(storey);
      placeOn(storey);
    }
  }

  const changed = plan.removed.length + plan.lifted.length + plan.placed.length + plan.laid.length;
  if (changed === 0) {
    if (plan.skipped.every((s) => s.why === "same")) {
      return refuse(
        "already_set",
        "Every tile in the plan already looks like that. Nothing to build.",
      );
    }
    const some = plan.skipped
      .filter((s) => s.why !== "same")
      .slice(0, 4)
      .map((s) => `${spotWords(s)}: ${WHY_WORDS[s.why]}`);
    return refuse(
      "tile_occupied",
      `Nothing in the plan can be built right now. ${some.join("; ")}.`,
    );
  }

  plan.changes = STACK_KINDS.flatMap((kind) => {
    const amount = delta.get(kind) ?? 0;
    return amount === 0 ? [] : [{ kind, amount }];
  });
  if (plan.changes.length > 0) {
    const shut = closed(state);
    if (shut) return shut;
    const inv = state.items?.inventories[actor];
    const short = plan.changes.flatMap((c) => {
      const missing = -(held(inv, c.kind) + c.amount);
      return missing > 0 ? [{ kind: c.kind, missing }] : [];
    });
    if (short.length > 0) {
      return refuse(
        "not_enough_items",
        `This plan needs ${short.map((s) => countOf(s.kind, s.missing)).join(", ")} more than you have.${shortHint(short.map((s) => s.kind))}`,
      );
    }
    const net = plan.changes.reduce((sum, c) => sum + c.amount, 0);
    if (net > 0 && inventorySize(inv) + net > ITEMS.inventoryMax) {
      return refuse(
        "inventory_full",
        `This plan gives you back ${net} more things than it uses, and you can hold ${ITEMS.inventoryMax}. Make, place, or give something first.`,
      );
    }
  }
  return plan;
}

/**
 * Make the changes a plan found, in its order. The events are the ones single actions make, then
 * one net `inventory`.
 */
function commitBuild(state: WorldState, actor: ResidentId, plan: BuildPlan): WorldEvent[] {
  const events: WorldEvent[] = [];
  const level = (t: StoreyTile) => t.storey ?? 0;
  const blocksFor = (storey: number) =>
    storey === 0 ? state.blocks : layerFor(state, storey).blocks;
  const groundFor = (storey: number) => {
    if (storey > 0) return layerFor(state, storey).ground;
    state.ground ??= {};
    return state.ground;
  };
  const place = (storey: number) => {
    for (const { x, y, block } of plan.placed.filter((t) => level(t) === storey)) {
      blocksFor(storey)[tileKey(x, y)] = block;
      events.push({ type: "block_placed", x, y, ...storeyField(storey), block, by: actor });
    }
  };
  const lay = (storey: number) => {
    for (const { x, y, ground } of plan.laid.filter((t) => level(t) === storey)) {
      groundFor(storey)[tileKey(x, y)] = ground;
      events.push({ type: "ground_laid", x, y, ...storeyField(storey), ground, by: actor });
    }
  };
  for (const storey of DOWN) {
    for (const { x, y } of plan.removed.filter((t) => level(t) === storey)) {
      delete blocksFor(storey)[tileKey(x, y)];
      events.push({ type: "block_removed", x, y, ...storeyField(storey), by: actor });
    }
    for (const { x, y } of plan.lifted.filter((t) => level(t) === storey)) {
      delete groundFor(storey)[tileKey(x, y)];
      events.push({ type: "ground_lifted", x, y, ...storeyField(storey), by: actor });
    }
  }
  for (const storey of UP) {
    if (storey === 0) {
      place(storey);
      lay(storey);
    } else {
      lay(storey);
      place(storey);
    }
  }
  if (plan.changes.length > 0 && state.items) {
    const mine = inventory(state.items, actor);
    const changes = plan.changes.map((c) => addStack(mine, c.kind, c.amount));
    events.push(inventoryEvent(actor, "built", changes));
  }
  return events;
}

/**
 * `build`: the plan and the change that makes it, or why not. `prepare` hands the plan on, so the
 * server answers with exactly what the sim commits.
 */
export function checkBuild(
  state: WorldState,
  actor: ResidentId,
  command: Extract<Command, { type: "build" }>,
): { plan: BuildPlan; commit: () => WorldEvent[] } | Rejection {
  const plan = planBuild(state, actor, command);
  if ("code" in plan) return plan;
  return { plan, commit: () => commitBuild(state, actor, plan) };
}

/** What a plan did, or would do, in counts and net things, for the server's answer. */
export function buildSummary(plan: BuildPlan): BuildSummary {
  return {
    px: plan.px,
    py: plan.py,
    placed: plan.placed.length,
    removed: plan.removed.length,
    laid: plan.laid.length,
    lifted: plan.lifted.length,
    uses: plan.changes.filter((c) => c.amount < 0).map((c) => ({ kind: c.kind, count: -c.amount })),
    returns: plan.changes
      .filter((c) => c.amount > 0)
      .map((c) => ({ kind: c.kind, count: c.amount })),
    skipped: plan.skipped.map((s) => ({ ...s })),
  };
}

/**
 * A plot's blocks and ground on every storey as a plan for `build` (tiles from its north-west
 * corner, the ground floor's first, `storey` on the rest), with its hearths, which a build leaves
 * alone. For `GET /v1/plots/{px}/{py}/plan`, so anyone can copy a design they like, lofts and all,
 * onto their own plot. Undefined for a plot outside the world.
 */
export function plotPlan(
  state: WorldState,
  px: number,
  py: number,
):
  | {
      px: number;
      py: number;
      size: number;
      ownerId?: ResidentId;
      blocks: (StoreyTile & { block: BlockKind })[];
      ground: (StoreyTile & { ground: GroundKind })[];
      hearths: Tile[];
    }
  | undefined {
  const { config } = state;
  if (!plotInBounds(config, px, py)) return undefined;
  const S = config.plotSize;
  const x0 = px * S;
  const y0 = py * S;
  const blocks: (StoreyTile & { block: BlockKind })[] = [];
  const ground: (StoreyTile & { ground: GroundKind })[] = [];
  for (const storey of UP) {
    const blocksThere = blocksOn(state, storey);
    const groundThere = groundOn(state, storey);
    const at = storeyField(storey);
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const key = tileKey(x0 + x, y0 + y);
        const block = blocksThere[key];
        if (block !== undefined) blocks.push({ x, y, ...at, block });
        const g = groundThere[key];
        if (g !== undefined) ground.push({ x, y, ...at, ground: g });
      }
    }
  }
  const homes = new Set<string>();
  for (const r of Object.values(state.residents)) {
    const h = r.hearth;
    if (h && h.x >= x0 && h.x < x0 + S && h.y >= y0 && h.y < y0 + S) {
      homes.add(tileKey(h.x - x0, h.y - y0));
    }
  }
  const hearths = [...homes]
    .map((key) => {
      const [x, y] = key.split(",").map(Number) as [number, number];
      return { x, y };
    })
    .sort((a, b) => a.y - b.y || a.x - b.x);
  const owner = state.plots[plotKey(px, py)]?.ownerId;
  return {
    px,
    py,
    size: S,
    ...(owner === undefined ? {} : { ownerId: owner }),
    blocks,
    ground,
    hearths,
  };
}
