import { expect } from "vitest";
import { bountyHeld } from "./bounties";
import { eventHeld } from "./events";
import type { StackKind } from "./items";
import type { WorldState } from "./types";

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

/** Put things straight into an inventory. */
export function stock(state: WorldState, id: string, stacks: Partial<Record<StackKind, number>>) {
  const items = state.items;
  if (!items) throw new Error("open items first");
  const inv = items.inventories[id] ?? { stacks: {}, goods: [] };
  for (const [kind, n] of Object.entries(stacks) as [StackKind, number][]) {
    inv.stacks[kind] = (inv.stacks[kind] ?? 0) + n;
  }
  items.inventories[id] = inv;
}
