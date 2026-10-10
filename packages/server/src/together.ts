import {
  DAY_MS,
  isCommons,
  type Plot,
  plotInBounds,
  plotKey,
  plotOf,
  plotsOwnedBy,
  type WorldState,
} from "@terrakin/sim";

/**
 * Pure helpers for the couples and friends layer (decision 0024): streak day math, invite codes,
 * and which plots an invite suggests. No clocks or storage here, so tests pin them exactly.
 */

/** A UTC day as YYYY-MM-DD. */
export const dayString = (day: number) => new Date(day * DAY_MS).toISOString().slice(0, 10);

/** The same key for (a, b) and (b, a). */
export const pairKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);

export interface StreakRecord {
  /** The last UTC day the pair exchanged a gesture. */
  day: number;
  /** Consecutive days ending on `day`. */
  streak: number;
}

/** The record after a gesture on `today`: same day keeps it, the next day grows it, a gap restarts it. */
export function nextStreak(previous: StreakRecord | undefined, today: number): StreakRecord {
  if (!previous || previous.day < today - 1) return { day: today, streak: 1 };
  if (previous.day >= today) return previous;
  return { day: today, streak: previous.streak + 1 };
}

/** The streak as of `today`. A pair that hasn't gestured yet today still has until midnight UTC. */
export function activeStreak(record: StreakRecord | undefined, today: number): number {
  return record && record.day >= today - 1 ? record.streak : 0;
}

/** No 0/o, 1/l/i: easy to read aloud or retype from a screenshot. */
const CODE_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";
export const INVITE_CODE = /^[a-z2-9]{12}$/;

/** A fresh invite code: 12 characters, about 59 bits, from Web Crypto. */
export function newInviteCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  // 256 % 31 leaves a tiny bias toward the first letters. Codes only need to be unguessable.
  return Array.from(bytes, (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join("");
}

export interface PlotRef {
  px: number;
  py: number;
}

/**
 * The plot an invite is anchored to: the resident's own plot, else the first plot shared with
 * them (north to south, then west to east), else the plot they are standing in.
 */
export function anchorPlot(
  state: WorldState,
  residentId: string,
): (PlotRef & { owned: boolean }) | undefined {
  const order = (a: Plot, b: Plot) => a.py - b.py || a.px - b.px;
  const own = plotsOwnedBy(state, residentId).sort(order)[0];
  if (own) return { px: own.px, py: own.py, owned: true };
  const shared = Object.values(state.plots)
    .filter((p) => p.coOwners?.includes(residentId))
    .sort(order)[0];
  if (shared) return { px: shared.px, py: shared.py, owned: false };
  const r = state.residents[residentId];
  return r ? { ...plotOf(state.config, r.x, r.y), owned: false } : undefined;
}

/**
 * Free plots near `around`, nearest first: ring by ring (Chebyshev distance), and within a ring
 * the four sides before the corners, then north to south and west to east. Free means inside the
 * world, not the Commons, and unclaimed.
 */
export function suggestPlots(state: WorldState, around: PlotRef, count: number): PlotRef[] {
  const { config } = state;
  const across = Math.max(config.width, config.height) / config.plotSize;
  const found: PlotRef[] = [];
  for (let ring = 1; ring <= across && found.length < count; ring++) {
    const cells: (PlotRef & { side: boolean })[] = [];
    for (let dy = -ring; dy <= ring; dy++) {
      for (let dx = -ring; dx <= ring; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== ring) continue;
        cells.push({ px: around.px + dx, py: around.py + dy, side: dx === 0 || dy === 0 });
      }
    }
    cells.sort((a, b) => Number(b.side) - Number(a.side) || a.py - b.py || a.px - b.px);
    for (const { px, py } of cells) {
      if (found.length >= count) break;
      if (!plotInBounds(config, px, py) || isCommons(config, px, py)) continue;
      if (state.plots[plotKey(px, py)]) continue;
      found.push({ px, py });
    }
  }
  return found;
}
