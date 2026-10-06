/**
 * Pure helpers for the Town Hall page: tally bars, quorum lines, closing times, and the build
 * editor's taps and plan. The server decides every result; these only describe its numbers.
 */

import type { ProposalView, TallyView, TownResponse } from "@terrakin/protocol";
import {
  type BlockKind,
  type CommonsBlock,
  GROUND_INFO,
  type GroundKind,
  ITEM_INFO,
  isGroundKind,
  isHeldBlock,
  type PlannedBlock,
  type PlannedGround,
  type Tile,
} from "@terrakin/sim";
import { listOf, plural } from "@terrakin/ui/format";

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

/** The quorum line under a closed proposal: whether it got enough yes and no votes to count. */
export function closedQuorum(t: TallyView): string {
  const counted = t.yes + t.no;
  return counted >= t.quorum
    ? `Quorum met with ${plural(counted, "vote", "votes")}`
    : `Short of quorum: ${counted} of ${t.quorum} votes`;
}

/** What a proposal's kind is called on its card. Pure, so tests pin it. */
export function kindLabel(kind: ProposalView["kind"]): string {
  switch (kind) {
    case "commons_build":
      return "Build";
    case "grant":
      return "Grant";
    case "bounty":
      return "Bounty";
    default:
      return "Advisory";
  }
}

/** A grant's handle, typed with or without its `@`, or null when it can't be one. */
export function grantHandle(typed: string): string | null {
  const handle = typed.trim().replace(/^@/, "");
  return /^[A-Za-z][A-Za-z0-9_]{2,19}$/.test(handle) ? handle : null;
}

/**
 * Everything the Town Hall's top card and proposal lists show, as one string, so a refresh that
 * brings nothing new leaves the page alone. The closing times are in it as words, so the page
 * still repaints when "Closes in 35 minutes" turns into 34. `extra` is anything else the cards
 * draw from, like the Commons map.
 */
export function townPaintKey(
  town: Pick<TownResponse, "open" | "queued" | "you" | "nextClose">,
  now: number,
  extra = "",
): string {
  const clocks = [town.nextClose, ...town.open.map((p) => p.closesAt)].map((at) =>
    at ? closesIn(at, now) : "",
  );
  return JSON.stringify([town.open, town.queued, town.you, town.nextClose, clocks, extra]);
}

/**
 * How long until `iso`, to the nearest minute: "1 day, 4 hours", "35 minutes". Null within the
 * last minute, or for a time that doesn't parse.
 */
function timeUntil(iso: string, now: number): string | null {
  const ms = Date.parse(iso) - now;
  if (!Number.isFinite(ms) || ms <= 60_000) return null;
  const minutes = Math.round(ms / 60_000);
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const mins = minutes % 60;
  const unit = (n: number, word: string) => plural(n, word, `${word}s`);
  if (days > 0) return `${unit(days, "day")}${hours ? `, ${unit(hours, "hour")}` : ""}`;
  if (hours > 0) return `${unit(hours, "hour")}${mins ? `, ${unit(mins, "minute")}` : ""}`;
  return unit(mins, "minute");
}

/** "Closes in 1 day, 4 hours", "Closes in 35 minutes", or "Closing now". */
export function closesIn(closesAt: string, now: number): string {
  const left = timeUntil(closesAt, now);
  return left ? `Closes in ${left}` : "Closing now";
}

/** When a notice leaves the board: "Comes down in 1 day, 4 hours", or "Coming down now". */
export function comesDownIn(expiresAt: string, now: number): string {
  const left = timeUntil(expiresAt, now);
  return left ? `Comes down in ${left}` : "Coming down now";
}

/** How long a notice stays up, in its author's words: "3 hours", "1 day", "2 days". */
export function stayWords(hours: number): string {
  if (hours % 24 === 0) return plural(hours / 24, "day", "days");
  return plural(hours, "hour", "hours");
}

/**
 * The board's limits in words: to a visitor, how long notices stay up; to someone who can pin
 * (who picks how long under the box), how many they can have up.
 */
export function boardWords(
  limits: { maxHours: number; perResident: number },
  signedIn: boolean,
): string {
  if (signedIn) return `You can have ${limits.perResident} up at once.`;
  return `Notices stay up for up to ${stayWords(limits.maxHours)}.`;
}

/** What a Commons build can put on a tile: a block, decor, furniture, or a path or floor. */
export type CommonsPick = CommonsBlock | GroundKind;

/**
 * What the build editor plans for one tile: a block placed or the block there taken away, and a
 * path laid or the path there lifted. A tile with nothing planned is `{}`.
 */
export interface PlanTile {
  block?: CommonsBlock | "remove";
  ground?: GroundKind | "lift";
}

/** What stands on a tile of the Commons now. */
export interface TileNow {
  block?: BlockKind | undefined;
  ground?: GroundKind | undefined;
}

/**
 * A tap on a tile with a pick, as the world's build bar does it: a path lays on bare ground, or
 * lifts the path that's there; a block goes up on an empty tile, or takes away the block that's
 * there. Tapping again with the same pick takes it back, and another pick replaces it.
 */
export function tapPlan(plan: PlanTile, pick: CommonsPick, now: TileNow): PlanTile {
  const next: PlanTile = { ...plan };
  if (isGroundKind(pick)) {
    const ground =
      now.ground !== undefined
        ? plan.ground === "lift"
          ? undefined
          : "lift"
        : plan.ground === pick
          ? undefined
          : pick;
    if (ground === undefined) delete next.ground;
    else next.ground = ground;
  } else {
    const block =
      now.block !== undefined
        ? plan.block === "remove"
          ? undefined
          : "remove"
        : plan.block === pick
          ? undefined
          : pick;
    if (block === undefined) delete next.block;
    else next.block = block;
  }
  return next;
}

/** How many changes a plan makes: a block and a path on one tile are two. */
export function planChanges(plan: ReadonlyMap<string, PlanTile>): number {
  let n = 0;
  for (const t of plan.values()) n += (t.block ? 1 : 0) + (t.ground ? 1 : 0);
  return n;
}

const tileOf = (key: string): Tile => {
  const [x, y] = key.split(",").map(Number) as [number, number];
  return { x, y };
};

/** A plan as `propose` takes it, tiles north to south and west to east. */
export function planLists(plan: ReadonlyMap<string, PlanTile>): {
  blocks: PlannedBlock[];
  remove: Tile[];
  ground: PlannedGround[];
  lift: Tile[];
} {
  const out = {
    blocks: [] as PlannedBlock[],
    remove: [] as Tile[],
    ground: [] as PlannedGround[],
    lift: [] as Tile[],
  };
  const keys = [...plan.keys()].sort((a, b) => {
    const p = tileOf(a);
    const q = tileOf(b);
    return p.y - q.y || p.x - q.x;
  });
  for (const key of keys) {
    const t = plan.get(key) ?? {};
    const tile = tileOf(key);
    if (t.block === "remove") out.remove.push(tile);
    else if (t.block) out.blocks.push({ ...tile, block: t.block });
    if (t.ground === "lift") out.lift.push(tile);
    else if (t.ground) out.ground.push({ ...tile, ground: t.ground });
  }
  return out;
}

/** A proposal's plan, tile by tile, to draw on a map of the Commons. */
export function proposalPlan(
  p: Pick<ProposalView, "blocks" | "remove" | "ground" | "lift">,
): Map<string, PlanTile> {
  const plan = new Map<string, PlanTile>();
  const at = (t: Tile) => {
    const key = `${t.x},${t.y}`;
    const tile = plan.get(key) ?? {};
    plan.set(key, tile);
    return tile;
  };
  for (const t of p.remove) at(t).block = "remove";
  for (const b of p.blocks) at(b).block = b.block;
  for (const t of p.lift) at(t).ground = "lift";
  for (const g of p.ground) at(g).ground = g.ground;
  return plan;
}

/** A block's or a path's name, lowercase: "wood", "garden bench", "cobblestones". */
export function pickName(kind: BlockKind | GroundKind): string {
  if (isGroundKind(kind)) return GROUND_INFO[kind].name.toLowerCase();
  return isHeldBlock(kind) ? ITEM_INFO[kind].name.toLowerCase() : kind.replaceAll("_", " ");
}

/** The line under the build editor's tabs: what a tap with the pick does. */
export function pickLine(pick: CommonsPick): string {
  const name = pickName(pick);
  const Name = name.charAt(0).toUpperCase() + name.slice(1);
  if (isGroundKind(pick)) return `${Name}: tap a tile to lay it, or a path to lift it.`;
  if (pick === "pond") return "Pond: tap a tile to dig it, for everyone to fish beside.";
  return `${Name}: tap a tile to put it up, or a block to take it away.`;
}

/** What a build changes, in words: "2 blocks and 4 paths", "1 block taken away". */
export function planWords(lists: {
  blocks: readonly unknown[];
  remove: readonly unknown[];
  ground: readonly unknown[];
  lift: readonly unknown[];
}): string {
  const parts = [
    lists.blocks.length > 0 ? plural(lists.blocks.length, "block", "blocks") : "",
    lists.ground.length > 0 ? plural(lists.ground.length, "path", "paths") : "",
    lists.remove.length > 0 ? `${plural(lists.remove.length, "block", "blocks")} taken away` : "",
    lists.lift.length > 0 ? `${plural(lists.lift.length, "path", "paths")} lifted` : "",
  ].filter(Boolean);
  return parts.length > 0 ? listOf(parts) : "Nothing";
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
