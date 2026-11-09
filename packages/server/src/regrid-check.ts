import {
  apply,
  cloneWorld,
  DIRECTIONS,
  spawnTile,
  stepFrom,
  TOWN_ACTOR,
  type WorldState,
  worldGround,
} from "@terrakin/sim";
import { supplyHolds } from "./snapshots";

/**
 * The dry run on a copy that `regrid` waits for (RFC 0052, "A broken regrid"). The town applies
 * `regrid` to a clone of the world and logs it only when the clone keeps:
 *
 * - `supply`: the coin supply identity (`supplyHolds`, the boot's own check).
 * - `items`: every keyed thing in the world and every thing in someone's hands, by count. A thing
 *   hung on a wall across a slot border goes back to whoever hung it, so the hung count may fall
 *   by exactly what the things in hand (or held aside) rose by.
 * - `standing`: every online resident on the ground floor who stood on an open tile still does.
 * - `hearth`: every hearth a walk from the spawn tile reached still is reached.
 *
 * Counts and codes only, never an id, so the result can go in a log line.
 */
export type RegridProblem = "supply" | "items" | "standing" | "hearth" | "refused";

export type RegridCheck =
  | { ok: true; givenBack: number }
  | { ok: false; problems: { code: RegridProblem; count: number }[] };

export function regridCheck(state: WorldState): RegridCheck {
  const after = cloneWorld(state);
  const done = apply(after, { actor: TOWN_ACTOR, command: { type: "regrid" } });
  if (!done.ok) return { ok: false, problems: [{ code: "refused", count: 1 }] };

  const problems: { code: RegridProblem; count: number }[] = [];
  const add = (code: RegridProblem, n: number) => {
    if (n > 0) problems.push({ code, count: n });
  };

  add("supply", supplyHolds(after) ? 0 : 1);

  const was = tally(state);
  const now = tally(after);
  const givenBack = was.hung - now.hung;
  let wrongItems = 0;
  for (const [key, n] of Object.entries(was.keyed)) if (now.keyed[key] !== n) wrongItems++;
  if (givenBack < 0 || now.held - was.held !== givenBack) wrongItems++;
  add("items", wrongItems);

  const ground0 = worldGround(state);
  const ground1 = worldGround(after);
  let stranded = 0;
  for (const r of Object.values(after.residents)) {
    if (!r.online || (r.floor ?? 0) !== 0) continue;
    const before = state.residents[r.id];
    if (!before || ground0.obstacle(before.x, before.y) !== undefined) continue;
    if (!onWorld(after, r.x, r.y) || ground1.obstacle(r.x, r.y) !== undefined) stranded++;
  }
  add("standing", stranded);

  const reached0 = reachedFromSpawn(state);
  const reached1 = reachedFromSpawn(after);
  let cutOff = 0;
  for (const r of Object.values(after.residents)) {
    const h0 = state.residents[r.id]?.hearth;
    if (!h0 || !reached0.has(`${h0.x},${h0.y}`)) continue;
    if (!r.hearth || !reached1.has(`${r.hearth.x},${r.hearth.y}`)) cutOff++;
  }
  add("hearth", cutOff);

  return problems.length === 0 ? { ok: true, givenBack } : { ok: false, problems };
}

/** The problems as one log line's worth: `hearth 2, items 1`. */
export const regridProblemWords = (problems: { code: RegridProblem; count: number }[]) =>
  problems.map((p) => `${p.code} ${p.count}`).join(", ");

const onWorld = (s: WorldState, x: number, y: number) =>
  x >= 0 && y >= 0 && x < s.config.width && y < s.config.height;

const count = (rec: object | undefined) => Object.keys(rec ?? {}).length;

/** How many things each keyed record holds, how many hang on walls, and how many are in hand. */
function tally(s: WorldState) {
  const items = s.items;
  const keyed: Record<string, number> = {
    blocks: count(s.blocks),
    edges: count(s.edges),
    grades: count(s.grades),
    turns: count(s.turns),
    ground: count(s.ground),
    crops: count(items?.crops),
    displays: count(items?.displays),
    firings: count(items?.firings),
    pots: count(items?.pots),
    tops: count(items?.tops),
    built: count(s.town?.built),
    residents: count(s.residents),
    plots: count(s.plots),
    hearths: Object.values(s.residents).filter((r) => r.hearth).length,
  };
  for (const [floor, layer] of Object.entries(s.floors ?? {})) {
    keyed[`floor ${floor} blocks`] = count(layer.blocks);
    keyed[`floor ${floor} ground`] = count(layer.ground);
    keyed[`floor ${floor} edges`] = count(layer.edges);
    keyed[`floor ${floor} grades`] = count(layer.grades);
    keyed[`floor ${floor} turns`] = count(layer.turns);
  }
  let held = items?.heldAside?.length ?? 0;
  for (const inv of Object.values(items?.inventories ?? {})) {
    held += inv.goods.length;
    for (const n of Object.values(inv.stacks)) held += n ?? 0;
    for (const grades of Object.values(inv.graded ?? {})) {
      for (const n of Object.values(grades ?? {})) held += n ?? 0;
    }
  }
  return { keyed, hung: count(items?.hung), held };
}

/** Every ground-floor tile a walk from the spawn tile reaches. */
function reachedFromSpawn(state: WorldState): Set<string> {
  const ground = worldGround(state);
  const start = spawnTile(state);
  const seen = new Set([`${start.x},${start.y}`]);
  const queue = [start];
  for (let i = 0; i < queue.length; i++) {
    const at = queue[i] as { x: number; y: number };
    for (const dir of DIRECTIONS) {
      const step = stepFrom(ground, at, dir);
      if (!step.ok) continue;
      const key = `${step.to.x},${step.to.y}`;
      if (seen.has(key)) continue;
      seen.add(key);
      queue.push(step.to);
    }
  }
  return seen;
}
