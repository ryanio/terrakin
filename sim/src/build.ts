import { isWhole, refuse } from "./check";
import { displayAt } from "./display";
import { isFurnitureKind } from "./furniture";
import { GROUND_KINDS, type GroundKind, groundNeeds, isGroundKind } from "./ground";
import {
  addStack,
  closed,
  countOf,
  GATHER_HINT,
  held,
  ITEMS,
  inventory,
  inventoryEvent,
  inventorySize,
  isDecorKind,
  isHeldBlock,
  isResourceKind,
  STACK_KINDS,
  type StackKind,
} from "./items";
import { plotKey, tileKey } from "./keys";
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
 * reported: someone standing on a tile, a hearth, a tile that already has something.
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
] as const;
export type BuildSkip = (typeof BUILD_SKIPS)[number];

/** Which of a plan's lists a skipped tile came from. */
export const BUILD_PARTS = ["remove", "lift", "block", "ground"] as const;
export type BuildPart = (typeof BUILD_PARTS)[number];

export interface BuildSkipped {
  /** As the plan gave it: tiles from the plot's north-west corner. */
  x: number;
  y: number;
  what: BuildPart;
  why: BuildSkip;
}

/** Everything a plan will do, worked out against the world as it is. World tiles. */
export interface BuildPlan {
  px: number;
  py: number;
  removed: Tile[];
  lifted: Tile[];
  placed: (Tile & { block: BlockKind })[];
  laid: (Tile & { ground: GroundKind })[];
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

/** The most entries in each of a plan's lists: a whole plot. */
export const planMax = (config: WorldConfig) => config.plotSize * config.plotSize;

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
};

/** A list from the plan: absent is empty, anything but a list is a problem. */
function listOf(value: unknown): unknown[] | null {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : null;
}

/** A tile in a plan: whole numbers on the plot, or why not. */
function planTile(entry: unknown, size: number): Tile | string {
  if (typeof entry !== "object" || entry === null) return "Each tile in a plan has an x and a y.";
  const { x, y } = entry as { x?: unknown; y?: unknown };
  if (!isWhole(x) || !isWhole(y) || x < 0 || y < 0 || x >= size || y >= size) {
    return `(${String(x)}, ${String(y)}) isn't on the plot: x and y count tiles from its north-west corner, 0 to ${size - 1}.`;
  }
  return { x, y };
}

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
  if (!canBuildOn(state.plots[plotKey(px, py)], actor)) {
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
  const tiles: Record<keyof typeof lists, Tile[]> = {
    remove: [],
    lift: [],
    blocks: [],
    ground: [],
  };
  for (const name of ["remove", "lift", "blocks", "ground"] as const) {
    const seen = new Set<string>();
    for (const entry of all[name]) {
      const t = planTile(entry, S);
      if (typeof t === "string") return refuse("invalid_plan", t);
      const key = tileKey(t.x, t.y);
      if (seen.has(key)) return refuse("invalid_plan", `(${t.x}, ${t.y}) is in ${name} twice.`);
      seen.add(key);
      tiles[name].push(t);
    }
  }
  const blockKinds: BlockKind[] = [];
  for (const entry of all.blocks) {
    const block = (entry as { block?: unknown }).block;
    if (!(BLOCK_KINDS as readonly unknown[]).includes(block)) {
      return refuse(
        "unknown_item",
        `${String(block)} isn't a block. Blocks: ${BLOCK_KINDS.join(", ")}.`,
      );
    }
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

  // What happens to each tile, in order: removals, lifts, blocks, ground.
  const x0 = px * S;
  const y0 = py * S;
  const hearths = new Set<string>();
  const standing = new Set<string>();
  for (const r of Object.values(state.residents)) {
    if (r.hearth) hearths.add(tileKey(r.hearth.x, r.hearth.y));
    if (r.online) standing.add(tileKey(r.x, r.y));
  }
  const blocksNow = new Map<string, BlockKind | undefined>();
  const groundNow = new Map<string, GroundKind | undefined>();
  const blockAt = (key: string) => (blocksNow.has(key) ? blocksNow.get(key) : state.blocks[key]);
  const groundAt = (key: string) => (groundNow.has(key) ? groundNow.get(key) : state.ground?.[key]);
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
  const skip = (t: Tile, what: BuildPart, why: BuildSkip) =>
    plan.skipped.push({ x: t.x, y: t.y, what, why });

  for (const t of tiles.remove) {
    const x = x0 + t.x;
    const y = y0 + t.y;
    const key = tileKey(x, y);
    const block = blockAt(key);
    if (block === undefined) skip(t, "remove", "empty");
    else if (state.items?.crops[key]) skip(t, "remove", "growing");
    else if (displayAt(state, x, y)) skip(t, "remove", "on_display");
    else {
      plan.removed.push({ x, y });
      blocksNow.set(key, undefined);
      if (isHeldBlock(block)) add(block, 1);
    }
  }
  for (const t of tiles.lift) {
    const x = x0 + t.x;
    const y = y0 + t.y;
    const key = tileKey(x, y);
    const ground = groundAt(key);
    if (ground === undefined) skip(t, "lift", "empty");
    else {
      plan.lifted.push({ x, y });
      groundNow.set(key, undefined);
      for (const [kind, n] of groundNeeds(ground)) add(kind, n);
    }
  }
  tiles.blocks.forEach((t, i) => {
    const block = blockKinds[i] as BlockKind;
    const x = x0 + t.x;
    const y = y0 + t.y;
    const key = tileKey(x, y);
    const there = blockAt(key);
    if (there === block) skip(t, "block", "same");
    else if (there !== undefined) skip(t, "block", "occupied");
    else if (hearths.has(key)) skip(t, "block", "hearth");
    else if (standing.has(key)) skip(t, "block", "standing");
    else {
      plan.placed.push({ x, y, block });
      blocksNow.set(key, block);
      if (isHeldBlock(block)) add(block, -1);
    }
  });
  tiles.ground.forEach((t, i) => {
    const ground = groundKinds[i] as GroundKind;
    const x = x0 + t.x;
    const y = y0 + t.y;
    const key = tileKey(x, y);
    const there = groundAt(key);
    if (there === ground) skip(t, "ground", "same");
    else if (there !== undefined) skip(t, "ground", "occupied");
    else {
      plan.laid.push({ x, y, ground });
      groundNow.set(key, ground);
      for (const [kind, n] of groundNeeds(ground)) add(kind, -n);
    }
  });

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
      .map((s) => `(${s.x}, ${s.y}): ${WHY_WORDS[s.why]}`);
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

/** Make the changes a plan found. The events are the ones single actions make, then one net `inventory`. */
export function commitBuild(state: WorldState, actor: ResidentId, plan: BuildPlan): WorldEvent[] {
  const events: WorldEvent[] = [];
  for (const { x, y } of plan.removed) {
    delete state.blocks[tileKey(x, y)];
    events.push({ type: "block_removed", x, y, by: actor });
  }
  if (plan.lifted.length > 0) {
    const ground = state.ground as Record<string, GroundKind>;
    for (const { x, y } of plan.lifted) {
      delete ground[tileKey(x, y)];
      events.push({ type: "ground_lifted", x, y, by: actor });
    }
  }
  for (const { x, y, block } of plan.placed) {
    state.blocks[tileKey(x, y)] = block;
    events.push({ type: "block_placed", x, y, block, by: actor });
  }
  if (plan.laid.length > 0) {
    state.ground ??= {};
    for (const { x, y, ground } of plan.laid) {
      state.ground[tileKey(x, y)] = ground;
      events.push({ type: "ground_laid", x, y, ground, by: actor });
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
 * A plot's blocks and ground as a plan for `build` (tiles from its north-west corner), with its
 * hearths, which a build leaves alone. For `GET /v1/plots/{px}/{py}/plan`, so anyone can copy a
 * design they like onto their own plot. Undefined for a plot outside the world.
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
      blocks: (Tile & { block: BlockKind })[];
      ground: (Tile & { ground: GroundKind })[];
      hearths: Tile[];
    }
  | undefined {
  const { config } = state;
  if (!plotInBounds(config, px, py)) return undefined;
  const S = config.plotSize;
  const x0 = px * S;
  const y0 = py * S;
  const blocks: (Tile & { block: BlockKind })[] = [];
  const ground: (Tile & { ground: GroundKind })[] = [];
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const key = tileKey(x0 + x, y0 + y);
      const block = state.blocks[key];
      if (block !== undefined) blocks.push({ x, y, block });
      const g = state.ground?.[key];
      if (g !== undefined) ground.push({ x, y, ground: g });
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
