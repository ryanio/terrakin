import {
  type AuthorView,
  BOUNTY_RULES,
  type BountiesResponse,
  type BountyView,
  type StaffBountiesResponse,
} from "@terrakin/protocol";
import {
  type Bounty,
  bountyMoves,
  bountyRunning,
  coinsOf,
  findBounty,
  postBountyProblem,
  type WorldState,
} from "@terrakin/sim";
import { unknownAuthor } from "./town";
import { DAY_MS } from "./world-service";

/**
 * Bounties (RFC 0008 phase 5, decision 0062) as the API shows them. The sim holds every bounty and
 * its reward and decides every step; this adds names, the viewer's moves (from the sim's own
 * checks), and hides what the viewer shouldn't see.
 */

type Authors = (id: string) => AuthorView | undefined;

/** The most finished bounties one answer lists. */
const FINISHED_SHOWN = 50;

const iso = (day: number) => new Date(day * DAY_MS).toISOString();

export function bountyView(
  state: WorldState,
  b: Bounty,
  author: Authors,
  viewer?: string,
): BountyView {
  const open = b.status === "open" || b.status === "claimed";
  return {
    id: b.id,
    trust: "untrusted",
    // A bounty a maintainer cancelled keeps its words in the log, but nobody has to read them here.
    title: b.status === "cancelled" && b.by ? "Removed by a maintainer" : b.title,
    text: b.status === "cancelled" && b.by ? "" : b.text,
    poster: author(b.poster) ?? unknownAuthor(b.poster),
    town: b.proposal !== undefined,
    proposal: b.proposal ?? null,
    grant: b.grant === true,
    reward: b.reward,
    status: b.status,
    postedDay: b.postedDay,
    expiresAt: open ? iso(b.expiresDay) : null,
    claimant: b.claimant ? (author(b.claimant) ?? unknownAuthor(b.claimant)) : null,
    doneDay: b.doneDay ?? null,
    closedDay: b.closedDay ?? null,
    moves: viewer ? bountyMoves(state, viewer, b) : [],
  };
}

/**
 * `GET /v1/bounties`. `hidden` leaves out a resident's bounties the viewer shouldn't see: blocks
 * either way, and suspended posters.
 */
export function bountiesView(
  state: WorldState,
  viewer: string | undefined,
  author: Authors,
  hidden: (poster: string) => boolean,
): BountiesResponse {
  const list = state.bounties?.list;
  if (!list) return { bounties: null, you: null, rules: BOUNTY_RULES };
  const shown = list.filter((b) => b.proposal !== undefined || !hidden(b.poster));
  const running = shown.filter(bountyRunning).reverse();
  const finished = shown
    .filter((b) => !bountyRunning(b))
    .sort((a, b) => (b.closedDay ?? 0) - (a.closedDay ?? 0))
    .slice(0, FINISHED_SHOWN);
  let you: BountiesResponse["you"] = null;
  if (viewer && state.residents[viewer]) {
    const why = postBountyProblem(state, viewer);
    you = {
      balance: coinsOf(state, viewer),
      posted: list.filter((b) => b.poster === viewer && !b.proposal && bountyRunning(b)).length,
      claims: list.filter(
        (b) => b.claimant === viewer && (b.status === "claimed" || b.status === "done"),
      ).length,
      canPost: why === null,
      ...(why === null ? {} : { why }),
    };
  }
  const view = (b: Bounty) => bountyView(state, b, author, viewer);
  return {
    bounties: { running: running.map(view), finished: finished.map(view) },
    you,
    rules: BOUNTY_RULES,
  };
}

/**
 * `GET /v1/admin/bounties`: town bounties and grants waiting for a maintainer, then everything else
 * running.
 */
export function staffBountiesView(state: WorldState, author: Authors): StaffBountiesResponse {
  const list = (state.bounties?.list ?? []).filter(bountyRunning);
  const waiting = (b: Bounty) => b.proposal !== undefined && b.status === "done";
  const view = (b: Bounty) => bountyView(state, b, author);
  return {
    waiting: list.filter(waiting).map(view),
    running: list
      .filter((b) => !waiting(b))
      .reverse()
      .map(view),
  };
}

/** A bounty's words and who posted it, for reports on one. Undefined when there's no such bounty. */
export function bountyWords(
  state: WorldState,
  id: string,
): { author: string; title: string; text: string } | undefined {
  const b = findBounty(state, id);
  return b ? { author: b.poster, title: b.title, text: b.text } : undefined;
}
