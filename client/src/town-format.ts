/**
 * Pure helpers for the Town Hall page: tally bars, quorum lines, closing times, and the build
 * editor's tap cycle. The server decides every result; these only describe its numbers.
 */

import type { TallyView } from "@terrakin/protocol";
import { BUILDING_BLOCKS, type BuildingBlock } from "@terrakin/sim";
import { plural } from "@terrakin/ui/format";

export interface TallyBar {
  /** Percent of the bar for yes, no, and abstain. They add up to 100, or are all 0 with no votes. */
  yes: number;
  no: number;
  abstain: number;
  /** Yes plus no so far, out of the quorum it needs. */
  counted: number;
  quorum: number;
  quorumMet: boolean;
  /** Where the leading side stands right now, in plain words. */
  label: string;
}

/** Shares of the bar for each choice, rounded so they add up to exactly 100. */
export function tallyBar(t: TallyView): TallyBar {
  const total = t.yes + t.no + t.abstain;
  const counted = t.yes + t.no;
  const quorumMet = counted >= t.quorum;
  let yes = 0;
  let no = 0;
  let abstain = 0;
  if (total > 0) {
    yes = Math.round((t.yes / total) * 100);
    no = Math.round((t.no / total) * 100);
    abstain = 100 - yes - no;
    // Rounding can push one share below zero when the other two round up.
    if (abstain < 0) {
      if (yes >= no) yes += abstain;
      else no += abstain;
      abstain = 0;
    }
  }
  const label = !quorumMet
    ? `${counted} of ${t.quorum} votes needed`
    : t.yes > t.no
      ? "Passing"
      : "Not passing";
  return { yes, no, abstain, counted, quorum: t.quorum, quorumMet, label };
}

/** "Closes in 1 day, 4 hours", "Closes in 35 minutes", or "Closing now". */
export function closesIn(closesAt: string, now: number): string {
  const ms = Date.parse(closesAt) - now;
  if (!Number.isFinite(ms) || ms <= 60_000) return "Closing now";
  const minutes = Math.floor(ms / 60_000);
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const mins = minutes % 60;
  const unit = (n: number, word: string) => plural(n, word, `${word}s`);
  if (days > 0) return `Closes in ${unit(days, "day")}${hours ? `, ${unit(hours, "hour")}` : ""}`;
  if (hours > 0)
    return `Closes in ${unit(hours, "hour")}${mins ? `, ${unit(mins, "minute")}` : ""}`;
  return `Closes in ${unit(mins, "minute")}`;
}

/** What one tile of the build editor holds. */
export type PlanCell = BuildingBlock | "remove" | null;

/**
 * Tapping a tile in the build editor. An empty tile cycles through the block kinds and back to
 * empty. A tile with a block toggles between keeping it and taking it away.
 */
export function nextCell(current: PlanCell, hasBlock: boolean): PlanCell {
  if (hasBlock) return current === "remove" ? null : "remove";
  if (current === null || current === "remove") return BUILDING_BLOCKS[0];
  const i = BUILDING_BLOCKS.indexOf(current);
  return i + 1 < BUILDING_BLOCKS.length ? (BUILDING_BLOCKS[i + 1] ?? null) : null;
}

const STATUS_WORDS = {
  queued: "Waiting",
  open: "Open",
  passed: "Passed",
  failed: "Didn't pass",
  no_quorum: "Not enough votes",
  withdrawn: "Withdrawn",
  voided: "Voided",
} as const;

export function statusWord(status: keyof typeof STATUS_WORDS): string {
  return STATUS_WORDS[status];
}
