import { expect } from "vitest";
import { bountyHeld } from "./bounties";
import { edgesOn } from "./edges";
import { eventHeld } from "./events";
import { blocksOn } from "./floors";
import { type Grade, gradeAt, gradesOn, type PastPlain, unitKey } from "./grades";
import type { StackKind } from "./items";
import { isMaterialKind, MATERIAL_KINDS } from "./materials";
import { roofNeeds } from "./roofs";
import type { WorldEvent, WorldState } from "./types";
import { cloneWorld } from "./world";

/**
 * Helpers the sim's tests share. They reach into state directly, so they're for setting up and
 * checking tests only, never part of a replayed log.
 */

/**
 * Every coin is in a purse, the treasury, a running bounty, or a Commons booking's deposit, every
 * amount is a whole number, and `sum(coins) + treasury + held in bounties and deposits == minted -
 * burned`.
 */
export function expectSupplyHolds(state: WorldState) {
  const econ = state.economy;
  if (!econ) return;
  let held = 0;
  for (const n of Object.values(econ.coins)) {
    expect(Number.isInteger(n) && n > 0).toBe(true);
    held += n;
  }
  expect(Number.isInteger(econ.treasury) && econ.treasury >= 0).toBe(true);
  expect(Number.isInteger(econ.burned) && econ.burned >= 0).toBe(true);
  expect(held + econ.treasury + bountyHeld(state) + eventHeld(state)).toBe(
    econ.minted - econ.burned,
  );
}

/** Put coins straight into a purse, minting them so the supply identity still holds. */
export function fund(state: WorldState, id: string, n: number) {
  const econ = state.economy;
  if (!econ) throw new Error("open the economy first");
  econ.coins[id] = (econ.coins[id] ?? 0) + n;
  econ.minted += n;
}

/** Put things straight into an inventory, at a grade past plain for made materials (RFC 0051). */
export function stock(
  state: WorldState,
  id: string,
  stacks: Partial<Record<StackKind, number>>,
  grade?: PastPlain,
) {
  const items = state.items;
  if (!items) throw new Error("open items first");
  const inv = items.inventories[id] ?? { stacks: {}, goods: [] };
  for (const [kind, n] of Object.entries(stacks) as [StackKind, number][]) {
    if (grade === undefined) {
      inv.stacks[kind] = (inv.stacks[kind] ?? 0) + n;
      continue;
    }
    if (!isMaterialKind(kind)) throw new Error(`${kind} has no grades`);
    inv.graded ??= {};
    const row = inv.graded[kind] ?? {};
    row[grade] = (row[grade] ?? 0) + n;
    inv.graded[kind] = row;
  }
  items.inventories[id] = inv;
}

/**
 * Every made material in the world by kind and grade (`unitKey`, RFC 0051): in someone's things,
 * standing as a block or a wall between tiles on any floor, covering a roof, in a market lot (open
 * or taken down), or in a wrapped present. Nothing else holds one. It also checks that every
 * recorded grade has a made material standing under it.
 */
function materialsIn(state: WorldState): Map<string, number> {
  const tally = new Map<string, number>();
  const add = (kind: StackKind, grade: Grade, n: number) => {
    if (n === 0) return;
    const key = unitKey(kind, grade);
    tally.set(key, (tally.get(key) ?? 0) + n);
  };
  const items = state.items;
  for (const inv of Object.values(items?.inventories ?? {})) {
    for (const kind of MATERIAL_KINDS) add(kind, "plain", inv.stacks[kind] ?? 0);
    for (const [kind, grades] of Object.entries(inv.graded ?? {})) {
      for (const [grade, n] of Object.entries(grades ?? {})) {
        add(kind as StackKind, grade as Grade, n ?? 0);
      }
    }
  }
  for (const floor of [0, ...Object.keys(state.floors ?? {}).map(Number)]) {
    const blocks = blocksOn(state, floor);
    const edges = edgesOn(state, floor);
    for (const [key, block] of [...Object.entries(blocks), ...Object.entries(edges)]) {
      if (isMaterialKind(block)) add(block, gradeAt(state, key, floor), 1);
    }
    for (const key of Object.keys(gradesOn(state, floor))) {
      const under = blocks[key] ?? edges[key];
      expect(isMaterialKind(under), `a grade at ${key} on floor ${floor} with no wall`).toBe(true);
    }
  }
  for (const plot of Object.values(state.plots)) {
    if (!plot.roof) continue;
    for (const [kind, n] of roofNeeds(plot.roof.material)) add(kind, plot.roof.grade ?? "plain", n);
  }
  for (const l of Object.values(state.market?.listings ?? {})) {
    if (isMaterialKind(l.kind)) add(l.kind, l.grade ?? "plain", l.count);
  }
  for (const p of Object.values(items?.presents ?? {})) {
    if (isMaterialKind(p.kind)) add(p.kind, p.grade ?? "plain", p.count);
  }
  return tally;
}

/** Made material walls (blocks and lines, every floor) in `was` that no longer stand in `now`. */
function wallsTakenDown(was: WorldState, now: WorldState): Map<string, number> {
  const out = new Map<string, number>();
  for (const floor of [0, ...Object.keys(was.floors ?? {}).map(Number)]) {
    for (const layer of [blocksOn, edgesOn]) {
      const after = layer(now, floor);
      for (const [key, block] of Object.entries(layer(was, floor))) {
        if (!isMaterialKind(block) || after[key] === block) continue;
        const unit = unitKey(block, gradeAt(was, key, floor));
        out.set(unit, (out.get(unit) ?? 0) + 1);
      }
    }
  }
  return out;
}

/**
 * Run one input and check that every made material is still somewhere at the grade it had, by
 * `materialsIn` before and after. The only changes allowed are a craft's own (what its `craft`
 * inventory event says it took and made) and a first slim's gift (`home_slimmed`), which can only
 * add, and at most a quarter of the walls of that kind and grade it took down (`slimGift`).
 * Returns what `run` returned.
 */
export function expectMaterialsHold<T extends { ok: boolean }>(state: WorldState, run: () => T): T {
  const before = materialsIn(state);
  const was = cloneWorld(state);
  const result = run();
  const after = materialsIn(state);
  const events = "events" in result ? (result.events as WorldEvent[]) : [];
  const expected = new Map(before);
  for (const e of events) {
    if (e.type !== "inventory" || e.reason !== "craft") continue;
    for (const c of e.changes ?? []) {
      if (!isMaterialKind(c.kind)) continue;
      const key = unitKey(c.kind, c.grade ?? "plain");
      expected.set(key, (expected.get(key) ?? 0) + c.amount);
    }
  }
  const gift = events.some((e) => e.type === "home_slimmed") ? wallsTakenDown(was, state) : null;
  const wrong: string[] = [];
  for (const key of new Set([...expected.keys(), ...after.keys()])) {
    const want = expected.get(key) ?? 0;
    const got = after.get(key) ?? 0;
    const most = want + (gift ? Math.ceil((gift.get(key) ?? 0) / 4) : 0);
    if (got < want || got > most) wrong.push(`${key}: ${want} to ${most} expected, ${got} held`);
  }
  expect(wrong).toEqual([]);
  return result;
}
