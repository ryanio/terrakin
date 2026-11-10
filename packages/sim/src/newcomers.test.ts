import { describe, expect, it } from "vitest";
import { markNewcomer } from "./economy";
import type { ResidentId, WorldState } from "./types";

/**
 * Today's newcomers on a busy day (RFC 0055): every `join` adds one, so a burst of joins in one
 * world day must cost each join about the same, or an attacker's burst makes replay quadratic.
 * The work is counted, never timed: each id counts the times it is read as a string, which is what
 * comparing two ids costs, whether by `<` or by `sort()`.
 */
function newcomersDay(joins: number) {
  let work = 0;
  const state = { economy: { today: { newcomers: [] as ResidentId[] } } } as unknown as WorldState;
  const ids: string[] = [];
  // Ids in a scrambled order, as random ids arrive, with a repeat of each tenth one.
  for (let i = 0; i < joins; i++) {
    const text = `r_${((i * 7919) % joins).toString(36).padStart(6, "0")}`;
    ids.push(text);
    const id = { [Symbol.toPrimitive]: () => (work++, text) } as unknown as ResidentId;
    markNewcomer(state, id);
    if (i % 10 === 0) markNewcomer(state, id);
  }
  const list = state.economy?.today.newcomers.map(String) ?? [];
  return { work, list, ids };
}

describe("today's newcomers", () => {
  it("stays the sorted list of each day's joins, once each", () => {
    const { list, ids } = newcomersDay(2_000);
    expect(list).toEqual([...new Set(ids)].sort());
  });

  it("costs each join in a burst about the same: twice the joins is about twice the work", () => {
    const half = newcomersDay(10_000).work;
    const full = newcomersDay(20_000).work;
    // A search each is n log n, just over 2 for twice the joins; a sort each was well past 4.
    expect(full / half).toBeLessThan(2.5);
  });
});
