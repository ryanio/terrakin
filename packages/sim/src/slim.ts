import { type BuildPlan, checkBuild } from "./build";
import { oneTimeSwitch, refuse } from "./check";
import { EDGE_KINDS, edgeKey, edgesOn, edgeTiles } from "./edges";
import { type Grade, gradeAt, isGrade, unitKey } from "./grades";
import { blockNeeds } from "./items";
import { plotKey, tileKey } from "./keys";
import {
  type BlockKind,
  type Command,
  type Plot,
  type Rejection,
  type ResidentId,
  TOWN_ACTOR,
  type WorldConfig,
  type WorldEvent,
  type WorldState,
} from "./types";
import { canBuildOn } from "./world";

type Mutation = () => WorldEvent[];

/**
 * `starter_edges`, which only TOWN_ACTOR sends: from now on `build_starter_home` builds the hut from
 * walls between tiles (RFC 0050), 25 tiles inside on the same 5 by 5 footprint. Starter homes built
 * before it replay as they were made. Comes once.
 */
export function checkStarterEdges(state: WorldState): Mutation | Rejection {
  return oneTimeSwitch({
    on: state.starterEdges,
    already: "Starter homes are already built from walls between tiles.",
    turnOn: () => {
      state.starterEdges = true;
    },
    event: { type: "starter_edges_set" },
  });
}

/**
 * The starter hut as walls between tiles (RFC 0050): the lines round the same 5 by 5 footprint
 * `starterHome` walls in, from (x0, y0) to (x0 + 4, y0 + 4), with a window in the middle of the
 * west and east sides and the door in the middle of the south side. Each is an `n` or `w` line.
 */
export function starterEdgeHut(
  config: WorldConfig,
  px: number,
  py: number,
  walls: BlockKind,
  windows: BlockKind,
): { x: number; y: number; side: "n" | "w"; block: BlockKind }[] {
  const x0 = px * config.plotSize + 1;
  const y0 = py * config.plotSize + 1;
  const out: { x: number; y: number; side: "n" | "w"; block: BlockKind }[] = [];
  for (let i = 0; i < 5; i++) {
    out.push({ x: x0 + i, y: y0, side: "n", block: walls });
    out.push({ x: x0 + i, y: y0 + 5, side: "n", block: i === 2 ? "door" : walls });
    out.push({ x: x0, y: y0 + i, side: "w", block: i === 2 ? windows : walls });
    out.push({ x: x0 + 5, y: y0 + i, side: "w", block: i === 2 ? windows : walls });
  }
  return out;
}

/**
 * What the lines of a slim take beyond the blocks it gives back, in made materials only, by kind
 * and grade (`unitKey`, RFC 0051), so a fine brick home slims into a fine brick home.
 */
function slimGift(state: WorldState, command: Slim): Record<string, number> {
  const S = state.config.plotSize;
  const x0 = command.px * S;
  const y0 = command.py * S;
  const back = new Map<string, number>();
  for (const t of command.remove) {
    const floor = t.floor ?? 0;
    const blocks = floor === 0 ? state.blocks : (state.floors?.[String(floor)]?.blocks ?? {});
    const key = tileKey(x0 + t.x, y0 + t.y);
    const grade = gradeAt(state, key, floor);
    for (const [kind, n] of blockNeeds(blocks[key])) {
      const unit = unitKey(kind, grade);
      back.set(unit, (back.get(unit) ?? 0) + n);
    }
  }
  const uses = new Map<string, number>();
  for (const w of command.edges) {
    // An unknown grade gets no gift here; `build` refuses it.
    const grade: Grade = isGrade(w.grade) ? w.grade : "plain";
    for (const [kind, n] of blockNeeds(w.block)) {
      const unit = unitKey(kind, grade);
      uses.set(unit, (uses.get(unit) ?? 0) + n);
    }
  }
  const gift: Record<string, number> = {};
  for (const [unit, n] of uses) {
    // Only a kind and grade the home's own walls were made of, and at most a quarter more than
    // they gave back, which is what a ring of walls needs: a slim never yields another material
    // or grade, and an odd shape can't be drawn to win more.
    const had = back.get(unit) ?? 0;
    if (had > 0 && n > had) gift[unit] = Math.min(n - had, Math.ceil(had / 4));
  }
  return gift;
}

type Slim = Extract<Command, { type: "slim_walls" | "town_slim" }>;

/**
 * `slim_walls {px, py, remove, edges}`: the server's plan for turning a home's wall blocks into
 * walls between tiles (RFC 0050), checked exactly as the same `build` by the resident would be,
 * with the plot's first one topped up by the town (`slimGift`) and the plot marked `slimmed`.
 * Every wall it puts up must be a wall kind, so a slim never builds anything else. Its lines are
 * checked before its removals, so a home with an upstairs keeps its flooring held throughout.
 */
export function checkSlimWalls(
  state: WorldState,
  actor: ResidentId,
  command: Extract<Command, { type: "slim_walls" }>,
): { plan: BuildPlan; commit: Mutation } | Rejection {
  const plot = plotFor(command)(state);
  if (!plot || !canBuildOn(plot, actor)) {
    return refuse(
      "not_your_plot",
      "You can only slim the walls of your own plot, or one shared with you.",
    );
  }
  return slim(state, actor, actor, command);
}

/**
 * `town_slim {px, py, remove, edges}`, which only TOWN_ACTOR sends: the same slim, made for a
 * plot's owner by the town (`slim_homes`), checked as their own build, with what comes up given
 * back to them and `home_slimmed` naming the town.
 */
export function checkTownSlim(
  state: WorldState,
  command: Extract<Command, { type: "town_slim" }>,
): { plan: BuildPlan; commit: Mutation } | Rejection {
  const owner = plotFor(command)(state)?.ownerId;
  if (owner === undefined || !state.residents[owner]) {
    return refuse("not_your_plot", "Only a plot someone holds has a home to slim.");
  }
  return slim(state, owner, TOWN_ACTOR, command);
}

const plotFor =
  ({ px, py }: Slim) =>
  (state: WorldState): Plot | undefined =>
    Number.isInteger(px) && Number.isInteger(py) ? state.plots[plotKey(px, py)] : undefined;

function slim(
  state: WorldState,
  builder: ResidentId,
  by: ResidentId,
  command: Slim,
): { plan: BuildPlan; commit: Mutation } | Rejection {
  const { px, py } = command;
  if (!Array.isArray(command.remove) || !Array.isArray(command.edges)) {
    return refuse("invalid_plan", "A slim lists the blocks it takes up and the walls it puts up.");
  }
  if (command.edges.some((w) => !(EDGE_KINDS as readonly unknown[]).includes(w?.block))) {
    return refuse("invalid_plan", "A slim puts up only walls, windows, hedges and doors.");
  }
  const key = plotKey(px, py);
  const first = state.slimmed?.[key] === undefined;
  const gift = first ? slimGift(state, command) : {};
  const built = checkBuild(
    state,
    builder,
    { type: "build", px, py, remove: command.remove, edges: command.edges },
    gift,
    true,
  );
  if ("code" in built) return built;
  return {
    plan: built.plan,
    commit: () => {
      const events = built.commit();
      if (first) {
        state.slimmed = { ...state.slimmed, [key]: true };
        events.push({ type: "home_slimmed", px, py, by });
      }
      return events;
    },
  };
}

/**
 * `slim_homes`, which only TOWN_ACTOR sends, after the server has slimmed every home it could with
 * `town_slim`: marks that done, so it never runs again. Comes once.
 */
export function checkSlimHomes(state: WorldState): Mutation | Rejection {
  return oneTimeSwitch({
    on: state.homesSlimmed,
    already: "The town has already slimmed the homes.",
    turnOn: () => {
      state.homesSlimmed = true;
    },
    event: { type: "homes_slimmed_set" },
  });
}

/** Whether a line already has a wall or its inside tile a block, so a starter hut leaves it be. */
export function edgeTaken(
  state: WorldState,
  e: { x: number; y: number; side: "n" | "w" },
): boolean {
  if (edgesOn(state, 0)[edgeKey(e.x, e.y, e.side)] !== undefined) return true;
  return edgeTiles(e.x, e.y, e.side).some((t) => state.blocks[tileKey(t.x, t.y)] !== undefined);
}
